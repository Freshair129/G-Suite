import { invoke } from "@tauri-apps/api/core";

export const OVERLAY_MODULE_IDS = [
  "alert", "gmeter", "toast", "companion", "advice", "buyback", "missing", "banner",
  "lowhp", "vol", "standby", "clock", "kda", "gold", "gpm", "xpm", "nw", "score", "hero",
] as const;

export type OverlayModuleId = (typeof OVERLAY_MODULE_IDS)[number];
export type OverlayModuleLayout = { x: number; y: number; scale: number; enabled: boolean };
export type OverlayLayout = Record<OverlayModuleId, OverlayModuleLayout>;

const module = (x: number, y: number, enabled = true): OverlayModuleLayout => ({ x, y, scale: 1, enabled });

/** Mirrors G-Maiden `overlay/modules.ts::DEFAULT_LAYOUT`. Keep in sync with the v1 schema. */
export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  alert: module(50, 12), gmeter: module(7, 47), toast: module(50, 19), companion: module(7, 39),
  advice: module(50, 72), buyback: module(50, 63), missing: module(88, 12), banner: module(50, 27),
  lowhp: module(50, 44), vol: module(50, 92), standby: module(50, 50), clock: module(5, 4),
  kda: module(12, 4), gold: module(19, 4), gpm: module(26, 4), xpm: module(26, 10, false),
  nw: module(32, 4), score: module(58, 4, false), hero: module(14, 33, false),
};

export function cloneDefaultOverlayLayout(): OverlayLayout {
  return Object.fromEntries(OVERLAY_MODULE_IDS.map((id) => [id, { ...DEFAULT_OVERLAY_LAYOUT[id] }])) as OverlayLayout;
}

export async function syncOverlayLayout(layout: OverlayLayout): Promise<{ ok: boolean; error?: string }> {
  return invoke("sync_overlay_layout", { layout });
}
