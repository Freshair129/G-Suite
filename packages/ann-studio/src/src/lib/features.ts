// Audio feature extraction — the AGENT's ears. Reads the decoded AudioBuffer for
// a clip's region and returns numeric features (BS.1770-gated LUFS, spectral
// balance, noise/sibilance/hum, peak/DR). These go into the LLM prompt so the
// agent decides from numbers, not from a visualizer. Cached per clip region.

import { loadAudioBuffer } from "./audio";
import type { Clip } from "../store/useStudioStore";

export interface Features {
  duration_s: number;
  peak_db: number;
  rms_db: number;
  crest_db: number;
  lufs_integrated: number;
  dynamic_range: number; // loud vs quiet spread (LU-ish)
  silence_ratio: number;
  speech_ratio: number;
  noise_floor_db: number;
  snr_db: number;
  spectral_centroid_hz: number;
  spectral_rolloff_hz: number;
  band_low_pct: number; // 20–250 Hz
  band_mid_pct: number; // 250–4k Hz
  band_high_pct: number; // 4k–16k Hz
  hum_ratio: number;
  hum_detected: boolean;
  sibilance_score: number; // energy 5–9 kHz / total
  zcr: number;
  clipping_events: number;
}

// ── RBJ biquad (a0-normalized) ──────────────────────────────────────────────
type BQ = [number, number, number, number, number]; // b0,b1,b2,a1,a2
function biquad(type: "highpass" | "highshelf", f0: number, sr: number, Q: number, gainDb: number): BQ {
  const w0 = (2 * Math.PI * f0) / sr;
  const cos = Math.cos(w0), sin = Math.sin(w0);
  const alpha = sin / (2 * Q);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  if (type === "highpass") {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
  } else {
    const A = Math.pow(10, gainDb / 40);
    const s = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * cos + s);
    b1 = -2 * A * (A - 1 + (A + 1) * cos);
    b2 = A * (A + 1 + (A - 1) * cos - s);
    a0 = A + 1 - (A - 1) * cos + s;
    a1 = 2 * (A - 1 - (A + 1) * cos);
    a2 = A + 1 - (A - 1) * cos - s;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
function applyBiquad(x: Float32Array, c: BQ): Float32Array {
  const [b0, b1, b2, a1, a2] = c;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xn = x[i];
    const yn = b0 * xn + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xn; y2 = y1; y1 = yn;
    y[i] = yn;
  }
  return y;
}

// ── in-place radix-2 FFT ─────────────────────────────────────────────────────
function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const db = (x: number) => (x > 1e-10 ? 20 * Math.log10(x) : -120);
const lufsFromMs = (ms: number) => (ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -70);

const cache = new Map<string, Features>();

export async function analyzeClip(wavPath: string, clip: Clip): Promise<Features> {
  const key = `${clip.id}:${clip.start.toFixed(3)}:${clip.end.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const buf = await loadAudioBuffer(wavPath);
  const sr = buf.sampleRate;
  const full = buf.getChannelData(0);
  const s0 = Math.max(0, Math.floor(clip.start * sr));
  const s1 = Math.min(full.length, Math.floor(clip.end * sr));
  const x = full.slice(s0, s1);
  const N = x.length || 1;

  // time domain
  let peak = 0, sumSq = 0, zc = 0, clip99 = 0;
  for (let i = 0; i < N; i++) {
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
    sumSq += x[i] * x[i];
    if (a >= 0.98) clip99++;
    if (i > 0 && (x[i] >= 0) !== (x[i - 1] >= 0)) zc++;
  }
  const rms = Math.sqrt(sumSq / N);

  // frame RMS (for silence / noise floor / DR)
  const FR = 1024, HOP = 512;
  const frameDb: number[] = [];
  for (let i = 0; i + FR <= N; i += HOP) {
    let s = 0;
    for (let j = 0; j < FR; j++) s += x[i + j] * x[i + j];
    frameDb.push(db(Math.sqrt(s / FR)));
  }
  frameDb.sort((a, b) => a - b);
  const pct = (p: number) => (frameDb.length ? frameDb[Math.min(frameDb.length - 1, Math.floor(p * frameDb.length))] : -70);
  const noiseFloor = pct(0.1);
  const loud = pct(0.95);
  const silenceThresh = Math.max(-55, noiseFloor + 8);
  const silent = frameDb.filter((d) => d < silenceThresh).length;
  const silenceRatio = frameDb.length ? silent / frameDb.length : 0;

  // K-weighted gated integrated LUFS (BS.1770 approx)
  const kw = applyBiquad(applyBiquad(x, biquad("highshelf", 1500, sr, 0.707, 4)), biquad("highpass", 38, sr, 0.5, 0));
  const BLK = Math.floor(0.4 * sr);
  const blocks: number[] = [];
  for (let i = 0; i + BLK <= kw.length; i += BLK) {
    let s = 0;
    for (let j = 0; j < BLK; j++) s += kw[i + j] * kw[i + j];
    blocks.push(s / BLK);
  }
  let lufsInt = -70;
  if (blocks.length) {
    const g1 = blocks.filter((ms) => lufsFromMs(ms) > -70);
    if (g1.length) {
      const relThresh = lufsFromMs(g1.reduce((a, b) => a + b, 0) / g1.length) - 10;
      const g2 = g1.filter((ms) => lufsFromMs(ms) > relThresh);
      const kept = g2.length ? g2 : g1;
      lufsInt = lufsFromMs(kept.reduce((a, b) => a + b, 0) / kept.length);
    }
  }

  // averaged magnitude spectrum (Hann-windowed 2048 FFT)
  const FN = 2048;
  const mag = new Float32Array(FN / 2);
  let frames = 0;
  const re = new Float32Array(FN), im = new Float32Array(FN);
  for (let i = 0; i + FN <= N; i += FN) {
    for (let j = 0; j < FN; j++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (FN - 1));
      re[j] = x[i + j] * w; im[j] = 0;
    }
    fft(re, im);
    for (let k = 0; k < FN / 2; k++) mag[k] += Math.hypot(re[k], im[k]);
    frames++;
  }
  const binHz = sr / FN;
  let totalE = 0, centNum = 0, low = 0, midE = 0, high = 0, humE = 0, sibE = 0;
  const cum: number[] = [];
  for (let k = 1; k < FN / 2; k++) {
    const f = k * binHz;
    const e = mag[k] * mag[k];
    totalE += e; centNum += f * mag[k];
    cum[k] = (cum[k - 1] || 0) + e;
    if (f >= 20 && f < 250) low += e;
    else if (f < 4000) midE += e;
    else if (f < 16000) high += e;
    if ((f >= 45 && f <= 65) || (f >= 95 && f <= 125)) humE += e;
    if (f >= 5000 && f <= 9000) sibE += e;
  }
  const totMag = mag.reduce((a, b) => a + b, 0) || 1;
  const centroid = centNum / totMag;
  let rolloff = 0;
  const target = totalE * 0.85;
  for (let k = 1; k < FN / 2; k++) { if ((cum[k] || 0) >= target) { rolloff = k * binHz; break; } }
  const bandSum = low + midE + high || 1;

  const speechFrames = frameDb.filter((d) => d >= silenceThresh);
  const speechMed = speechFrames.length ? speechFrames[Math.floor(speechFrames.length / 2)] : loud;

  const f: Features = {
    duration_s: +(N / sr).toFixed(2),
    peak_db: +db(peak).toFixed(1),
    rms_db: +db(rms).toFixed(1),
    crest_db: +(db(peak) - db(rms)).toFixed(1),
    lufs_integrated: +lufsInt.toFixed(1),
    dynamic_range: +(loud - noiseFloor).toFixed(1),
    silence_ratio: +silenceRatio.toFixed(2),
    speech_ratio: +(1 - silenceRatio).toFixed(2),
    noise_floor_db: +noiseFloor.toFixed(1),
    snr_db: +(speechMed - noiseFloor).toFixed(1),
    spectral_centroid_hz: Math.round(centroid),
    spectral_rolloff_hz: Math.round(rolloff),
    band_low_pct: +((low / bandSum) * 100).toFixed(0),
    band_mid_pct: +((midE / bandSum) * 100).toFixed(0),
    band_high_pct: +((high / bandSum) * 100).toFixed(0),
    hum_ratio: +(humE / (totalE || 1)).toFixed(3),
    hum_detected: humE / (totalE || 1) > 0.03,
    sibilance_score: +(sibE / (totalE || 1)).toFixed(2),
    zcr: +(zc / N).toFixed(3),
    clipping_events: clip99,
  };
  cache.set(key, f);
  return f;
}

/** Compact YAML for the LLM prompt. */
export function featuresYaml(f: Features): string {
  return Object.entries(f)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n");
}
