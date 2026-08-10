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

/** Reference viewport the boxes below are measured against. */
export const BOX_REF = { w: 1920, h: 1080 } as const;

/**
 * Mirrors G-Maiden `overlay/modules.ts::MODULE_BOX` — nominal footprint of each
 * module in CSS px at [`BOX_REF`], `scale: 1`.
 *
 * Deliberately NOT part of `OverlayModuleLayout`: size belongs to the renderer,
 * not to the user's layout (a player positions and scales a module but never
 * resizes it), so the synced layout schema stays unchanged.
 *
 * Nominal, not exact — overlay modules size themselves from content, so real
 * boxes move with hero-name length, advice wrapping and banner art. Good enough
 * to draw true-to-scale, reserve space and detect overlap.
 *
 * KEEP IN SYNC with G-Maiden. If a module's padding/minWidth/font changes there,
 * update both tables in the same change.
 */
export const MODULE_BOX: Record<OverlayModuleId, { w: number; h: number }> = {
  alert: { w: 420, h: 40 }, gmeter: { w: 158, h: 30 }, toast: { w: 460, h: 34 },
  companion: { w: 190, h: 64 }, advice: { w: 420, h: 63 }, buyback: { w: 420, h: 63 },
  missing: { w: 300, h: 34 }, banner: { w: 420, h: 150 }, lowhp: { w: 300, h: 38 },
  vol: { w: 190, h: 34 }, standby: { w: 150, h: 50 }, clock: { w: 78, h: 30 },
  kda: { w: 90, h: 43 }, gold: { w: 90, h: 43 }, gpm: { w: 78, h: 43 },
  xpm: { w: 78, h: 43 }, nw: { w: 96, h: 43 }, score: { w: 96, h: 43 },
  hero: { w: 160, h: 62 },
};

/** Module footprint as % of `viewport`, honouring scale. Centre-anchored callers halve it. */
export function boxPercent(
  id: OverlayModuleId,
  scale: number,
  viewport: { w: number; h: number } = BOX_REF,
): { w: number; h: number } {
  const box = MODULE_BOX[id];
  return { w: ((box.w * scale) / viewport.w) * 100, h: ((box.h * scale) / viewport.h) * 100 };
}

/** Edges (%) of a centre-anchored module, for snapping and overlap tests. */
export function moduleRect(id: OverlayModuleId, cfg: { x: number; y: number; scale: number }) {
  const { w, h } = boxPercent(id, cfg.scale);
  return { left: cfg.x - w / 2, right: cfg.x + w / 2, top: cfg.y - h / 2, bottom: cfg.y + h / 2, w, h };
}

export type HudZone = {
  id: string;
  label: string;
  left: number; top: number; right: number; bottom: number;
  /** `blocked`: Dota UI the overlay must never cover. `transient`: clear most of
   *  the time, but the game draws here when an event fires — overlapping is only
   *  wrong at the moment it matters, which is exactly when the player is looking. */
  kind: "blocked" | "transient";
};

/**
 * Regions Dota 2 owns on a 16:9 screen, in % — the prose in G-Maiden
 * `overlay/modules.ts` turned into geometry the planner can actually test
 * against. Approximated from the HUD reference; tune against a real capture
 * before treating any edge as exact.
 */
export const DOTA_HUD_ZONES: HudZone[] = [
  // left edge is 35, not a rounder 30: G-Maiden's own module registry records that
  // Dota's portrait bar "starts ≈x35", and the default stat strip is tuned to end
  // just short of it. A wider guess here flags that deliberate clearance as a bug.
  { id: "topbar", label: "Hero portraits / score", left: 35, top: 0, right: 65, bottom: 8, kind: "blocked" },
  { id: "killfeed", label: "Kill banner / feed", left: 38, top: 8, right: 62, bottom: 17, kind: "transient" },
  { id: "scoreboard", label: "Scoreboard / FPS", left: 88, top: 0, right: 100, bottom: 6, kind: "blocked" },
  { id: "minimap", label: "Minimap", left: 0, top: 78, right: 13, bottom: 100, kind: "blocked" },
  { id: "hud", label: "Bottom HUD", left: 28, top: 77, right: 73, bottom: 100, kind: "blocked" },
  { id: "shop", label: "Items / shop", left: 75, top: 74, right: 100, bottom: 100, kind: "blocked" },
];

/** Zones a module's rect currently intrudes on. */
export function zoneConflicts(rect: { left: number; right: number; top: number; bottom: number }): HudZone[] {
  return DOTA_HUD_ZONES.filter(
    (z) => rect.left < z.right && rect.right > z.left && rect.top < z.bottom && rect.bottom > z.top,
  );
}

/**
 * Pairs that can never be on screen together, so sharing space is intentional
 * rather than a clash. `FullOverlay` renders the voice toast as
 * `toastUi && !packBanner` — the announcer banner already carries the transcript
 * for the same event, so the toast stands down while it is up (consolidation,
 * 2026-07-20). Reporting that pair would train the user to ignore the warnings.
 */
const MUTUALLY_EXCLUSIVE: ReadonlyArray<readonly [OverlayModuleId, OverlayModuleId]> = [
  ["toast", "banner"],
];

const exclusive = (a: OverlayModuleId, b: OverlayModuleId) =>
  MUTUALLY_EXCLUSIVE.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Module pairs whose boxes overlap — the "don't stack at event time" check. */
export function moduleCollisions(layout: OverlayLayout): [OverlayModuleId, OverlayModuleId][] {
  const live = OVERLAY_MODULE_IDS.filter((id) => layout[id].enabled);
  const hits: [OverlayModuleId, OverlayModuleId][] = [];
  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      if (exclusive(live[i], live[j])) continue;
      const a = moduleRect(live[i], layout[live[i]]);
      const b = moduleRect(live[j], layout[live[j]]);
      if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
        hits.push([live[i], live[j]]);
      }
    }
  }
  return hits;
}

export function cloneDefaultOverlayLayout(): OverlayLayout {
  return Object.fromEntries(OVERLAY_MODULE_IDS.map((id) => [id, { ...DEFAULT_OVERLAY_LAYOUT[id] }])) as OverlayLayout;
}

export async function syncOverlayLayout(layout: OverlayLayout): Promise<{ ok: boolean; error?: string }> {
  return invoke("sync_overlay_layout", { layout });
}
