// Bake an event's auto tone banner into an animated WebP (entrance: slide-up +
// fade, playing once then resting on the steady banner). Frames are rendered on
// an offscreen canvas via drawToneBanner(progress) and handed to the Rust
// `bake_animated_webp` command, which encodes them with ffmpeg's libwebp_anim.
//
// Returns the WebP as base64 (no data prefix), or null if baking failed — the
// caller falls back to the static PNG tone banner so install never breaks.

import { invoke } from "@tauri-apps/api/core";
import { drawToneBanner, BANNER_W, BANNER_H } from "./toneBanner";

const FRAMES = 12; // ~0.5s entrance at 24fps
const FPS = 24;

// audio-reactive bake: frames span the clip, playhead sweeps left→right, the
// waveform + border pulse follow the envelope. Entrance completes in the first
// slice, then the pulse loops for the overlay's display window.
const REACTIVE_FPS = 18;
const REACTIVE_MAX_FRAMES = 48;
const ENTRANCE_FRAC = 0.25;

export async function bakeToneWebp(
  event: string,
  scale = 2,
  caption?: string
): Promise<string | null> {
  const pngs: string[] = [];
  for (let i = 0; i < FRAMES; i++) {
    const progress = i / (FRAMES - 1); // 0 → 1 across the entrance
    const c = document.createElement("canvas");
    c.width = BANNER_W * scale;
    c.height = BANNER_H * scale;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    drawToneBanner(ctx, event, progress, caption);
    const b64 = c.toDataURL("image/png").split(",")[1];
    if (!b64) return null;
    pngs.push(b64);
  }
  try {
    const webp = await invoke<string>("bake_animated_webp", { frames: pngs, fps: FPS });
    return webp || null;
  } catch {
    return null;
  }
}

/**
 * Bake an audio-reactive banner: the playhead sweeps the clip's envelope while
 * the waveform + border glow pulse with loudness. Loops continuously (loopCount
 * 0) so it keeps pulsing for the overlay's display window. Returns webp b64 or
 * null (caller falls back to the entrance bake / static PNG).
 */
export async function bakeReactiveWebp(
  event: string,
  env: number[],
  durationSec: number,
  caption?: string,
  scale = 2
): Promise<string | null> {
  if (!env.length) return null;
  const frames = Math.max(
    8,
    Math.min(REACTIVE_MAX_FRAMES, Math.round(Math.min(3.5, Math.max(0.5, durationSec)) * REACTIVE_FPS))
  );
  const pngs: string[] = [];
  for (let i = 0; i < frames; i++) {
    const t = i / (frames - 1); // 0 → 1 across the clip
    const progress = Math.min(1, t / ENTRANCE_FRAC);
    const c = document.createElement("canvas");
    c.width = BANNER_W * scale;
    c.height = BANNER_H * scale;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    drawToneBanner(ctx, event, progress, caption, { env, head: t });
    const b64 = c.toDataURL("image/png").split(",")[1];
    if (!b64) return null;
    pngs.push(b64);
  }
  try {
    const webp = await invoke<string>("bake_animated_webp", {
      frames: pngs,
      fps: REACTIVE_FPS,
      loopCount: 0,
    });
    return webp || null;
  } catch {
    return null;
  }
}
