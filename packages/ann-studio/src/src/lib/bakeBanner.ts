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
