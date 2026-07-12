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
