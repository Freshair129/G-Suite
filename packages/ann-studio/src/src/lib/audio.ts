// Shared audio: one AudioContext + a decoded-buffer cache. Used by the Mastering
// transport to PREVIEW tuning live (EQ / presence / compressor / gain applied
// through Web Audio nodes) and by peaks.ts to draw waveforms — decode once.

import { invoke } from "@tauri-apps/api/core";

let ctx: AudioContext | null = null;
export function audioCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  return ctx;
}

const cache = new Map<string, AudioBuffer>();
const inflight = new Map<string, Promise<AudioBuffer>>();

export async function loadAudioBuffer(wavPath: string): Promise<AudioBuffer> {
  const hit = cache.get(wavPath);
  if (hit) return hit;
  const pending = inflight.get(wavPath);
  if (pending) return pending;
  const p = (async () => {
    const raw = await invoke<ArrayBuffer>("read_audio_bytes", { path: wavPath });
    const buf = await audioCtx().decodeAudioData(raw.slice(0));
    cache.set(wavPath, buf);
    inflight.delete(wavPath);
    return buf;
  })();
  inflight.set(wavPath, p);
  return p;
}

/** knob(-100..100) → ±max dB */
export function knobDb(v: number, max: number): number {
  return (v / 100) * max;
}
