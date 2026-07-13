// Tone-banner renderer (W2). Auto-generates a default banner per G-Maiden event,
// drawn on a TRANSPARENT canvas so it composites over the in-game overlay. The
// tone (accent + glow) encodes the event's intensity — the same ladder as
// G-Maiden's overlay banner. Shared by the event-test grid (live <canvas>) and
// pack export (frames baked to alpha WebP via the ffmpeg sidecar).
//
// Author can override the tone default with their own image/animation later;
// this guarantees every one of the 23 events has a visible banner with zero work.

import { GMAIDEN_EVENTS } from "../data/gmaiden-events";

export type ToneKey = "ice" | "calm" | "warn" | "blood" | "fire" | "gold" | "radiant" | "lime";

interface Tone {
  accent: string; // border + glow + icon
  ink: string;    // title text
  icon: string;   // glyph in the chip
}

export const TONES: Record<ToneKey, Tone> = {
  ice:     { accent: "#8fd4ff", ink: "#dbeeff", icon: "↩" },
  calm:    { accent: "#5be3a7", ink: "#c7f5e2", icon: "✦" },
  warn:    { accent: "#ffcf6b", ink: "#ffe9b8", icon: "⚠" },
  blood:   { accent: "#ff7b85", ink: "#ffd7db", icon: "✚" },
  fire:    { accent: "#ff9b45", ink: "#ffdcb8", icon: "🔥" },
  gold:    { accent: "#ffd76b", ink: "#fff0c2", icon: "★" },
  radiant: { accent: "#fff1c4", ink: "#fffaf0", icon: "♛" },
  lime:    { accent: "#a3e635", ink: "#e6f7c2", icon: "❄" },
};

// Explicit per-event tone (the intensity ladder). Anything unlisted falls back
// to a category/priority guess so new events still get a sane banner.
const EVENT_TONE: Record<string, ToneKey> = {
  danger: "warn", hpLow: "warn",
  revision: "ice", respawn: "ice", manaLow: "ice",
  match_start: "calm", levelUp: "calm",
  first_blood: "blood", kill: "blood", death: "blood",
  double_kill: "fire", triple_kill: "fire", ultra_kill: "fire",
  killing_spree: "fire", dominating: "fire", mega_kill: "fire", unstoppable: "fire",
  rampage: "gold", wicked_sick: "gold", monster_kill: "gold", godlike: "gold",
  beyond_godlike: "radiant",
  advice: "lime",
};

export function eventTone(id: string): ToneKey {
  const explicit = EVENT_TONE[id];
  if (explicit) return explicit;
  const ev = GMAIDEN_EVENTS.find((e) => e.id === id);
  if (!ev) return "ice";
  if (ev.category === "Signal") return ev.priority === "critical" ? "warn" : "ice";
  if (ev.category === "Streak") return ev.priority === "critical" ? "gold" : "fire";
  if (ev.category === "Kill") return "blood";
  if (ev.category === "Strategy") return "lime";
  return "calm";
}

// Thai subtitle per event (banner second line).
export const EVENT_THAI: Record<string, string> = {
  danger: "ระวังโดนรุม!", revision: "เอ๊ะ เดี๋ยวก่อน", hpLow: "เลือดวิกฤต", manaLow: "มานาต่ำ",
  match_start: "เริ่มเกม", levelUp: "เลเวลอัป",
  first_blood: "เลือดแรก!", kill: "สังหาร", death: "ล้มแล้ว", respawn: "เกิดใหม่",
  double_kill: "ดับเบิลคิล", triple_kill: "ทริปเปิลคิล", ultra_kill: "อัลตร้าคิล", rampage: "แรมเพจ!",
  killing_spree: "ไล่สังหาร", dominating: "ครอบครอง", mega_kill: "เมกาคิล", unstoppable: "หยุดไม่อยู่",
  wicked_sick: "โหดสัส", monster_kill: "มอนสเตอร์คิล", godlike: "ดั่งเทพ", beyond_godlike: "เหนือเทพ",
  advice: "เมเดนแนะนำ",
};

export const BANNER_W = 420;
export const BANNER_H = 120;

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Trim `text` with an ellipsis so it fits `maxW` px at the current ctx font. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  const ell = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + ell).width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ell;
}

/**
 * Draw one event's tone banner in LOGICAL coordinates (BANNER_W x BANNER_H).
 * `progress` (0..1) drives a subtle entrance used when baking animation frames;
 * pass 1 for the static/steady banner. `caption` overrides the fixed Thai
 * subtitle with the voice clip's own transcript line (auto-truncated to fit).
 */
export function drawToneBanner(
  ctx: CanvasRenderingContext2D,
  id: string,
  progress = 1,
  caption?: string
) {
  const ev = GMAIDEN_EVENTS.find((e) => e.id === id);
  const label = (ev?.label ?? id).toUpperCase();
  const thai = (caption && caption.trim()) || EVENT_THAI[id] || ev?.trigger || "";
  const tone = TONES[eventTone(id)];

  const W = BANNER_W, H = BANNER_H;
  ctx.clearRect(0, 0, W, H);

  // entrance: slide up + fade (progress<1 only matters when baking frames)
  const p = Math.max(0, Math.min(1, progress));
  const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
  ctx.save();
  ctx.globalAlpha = ease;
  ctx.translate(0, (1 - ease) * 10);

  const px = 6, py = 6, pw = W - 12, ph = H - 12, r = 18;

  // panel fill
  roundRect(ctx, px, py, pw, ph, r);
  ctx.fillStyle = "rgba(18,20,28,0.92)";
  ctx.fill();

  // glow + border
  ctx.save();
  ctx.shadowColor = tone.accent;
  ctx.shadowBlur = 16;
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = tone.accent;
  roundRect(ctx, px, py, pw, ph, r);
  ctx.stroke();
  ctx.restore();

  // icon chip
  const cs = 52, cx = 18, cy = (H - cs) / 2;
  roundRect(ctx, cx, cy, cs, cs, 13);
  ctx.fillStyle = hexA(tone.accent, 0.14);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexA(tone.accent, 0.9);
  ctx.stroke();
  ctx.fillStyle = tone.accent;
  ctx.font = "26px 'Segoe UI Symbol', 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(tone.icon, cx + cs / 2, cy + cs / 2 + 1);

  // title
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = tone.ink;
  ctx.font = "800 22px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(label, 88, H / 2 - 2);

  // thai subtitle (or the voice transcript line) — truncated to the panel width
  ctx.fillStyle = "#8794a6";
  ctx.font = "600 14px 'Segoe UI', system-ui, sans-serif";
  ctx.fillText(fitText(ctx, thai, W - 89 - 16), 89, H / 2 + 22);

  ctx.restore();
}

/** Offscreen canvas with one banner rendered at `scale` (for crisp export). */
export function toneBannerCanvas(id: string, scale = 2, caption?: string): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = BANNER_W * scale;
  c.height = BANNER_H * scale;
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  drawToneBanner(ctx, id, 1, caption);
  return c;
}

/** PNG (alpha) data URL — the static default banner for an event. */
export function toneBannerPngDataUrl(id: string, scale = 2, caption?: string): string {
  return toneBannerCanvas(id, scale, caption).toDataURL("image/png");
}
