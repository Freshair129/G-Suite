// Waveform peaks for a source wav — derived from the shared decoded AudioBuffer
// (so decode happens once, reused by the Mastering preview). Peak index i maps to
// time = i / buckets * duration.

import { loadAudioBuffer } from "./audio";

const cache = new Map<string, Float32Array>();
const inflight = new Map<string, Promise<Float32Array>>();

export async function loadPeaks(wavPath: string, buckets = 6000): Promise<Float32Array> {
  const hit = cache.get(wavPath);
  if (hit) return hit;
  const pending = inflight.get(wavPath);
  if (pending) return pending;

  const p = (async () => {
    const audio = await loadAudioBuffer(wavPath);
    const data = audio.getChannelData(0);
    const block = Math.max(1, Math.floor(data.length / buckets));
    const peaks = new Float32Array(buckets);
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const s = i * block;
      for (let j = 0; j < block; j++) {
        const v = Math.abs(data[s + j] || 0);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    cache.set(wavPath, peaks);
    inflight.delete(wavPath);
    return peaks;
  })();
  inflight.set(wavPath, p);
  return p;
}

/**
 * Loudness envelope of the [start, end] window of a clip, downsampled to
 * `buckets` values normalized to 0..1 (peak of the window = 1). Used to drive
 * the audio-reactive banner. Returns a plain number[] for easy IPC.
 */
export async function clipEnvelope(
  wavPath: string,
  start: number,
  end: number,
  duration: number,
  buckets = 48
): Promise<number[]> {
  const peaks = await loadPeaks(wavPath);
  if (!(duration > 0) || !(end > start)) return new Array(buckets).fill(0);
  const total = peaks.length;
  const i0 = Math.max(0, Math.floor((start / duration) * total));
  const i1 = Math.min(total, Math.ceil((end / duration) * total));
  const span = Math.max(1, i1 - i0);
  const out = new Array(buckets).fill(0);
  let peak = 0;
  for (let b = 0; b < buckets; b++) {
    const s = i0 + Math.floor((b / buckets) * span);
    const e = i0 + Math.floor(((b + 1) / buckets) * span);
    let max = 0;
    for (let i = s; i < Math.max(s + 1, e); i++) {
      const v = peaks[i] || 0;
      if (v > max) max = v;
    }
    out[b] = max;
    if (max > peak) peak = max;
  }
  if (peak > 0) for (let b = 0; b < buckets; b++) out[b] = out[b] / peak;
  return out;
}
