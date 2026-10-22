import { invoke } from "@tauri-apps/api/core";

export const OVERLAY_MODULE_IDS = [
  "alert", "gmeter", "toast", "companion", "advice", "buyback", "missing", "banner",
  "lowhp", "vol", "standby", "clock", "kda", "gold", "gpm", "xpm", "nw", "score", "hero",
] as const;

export type OverlayModuleId = (typeof OVERLAY_MODULE_IDS)[number];
export type OverlayModuleLayout = { x: number; y: number; scale: number; enabled: boolean };
export type OverlayLayout = Record<OverlayModuleId, OverlayModuleLayout>;

export const OVERLAY_MODULE_LABELS: Record<OverlayModuleId, string> = {
  alert: "Danger alert", gmeter: "G-Meter", toast: "Voice notice", companion: "Maiden", advice: "Advice",
  buyback: "Buyback", missing: "Enemy missing", banner: "Event banner", lowhp: "Low HP", vol: "Volume",
  standby: "Standby", clock: "Clock", kda: "K/D/A", gold: "Gold", gpm: "GPM", xpm: "XPM", nw: "Net worth",
  score: "Score", hero: "HP / Mana",
};

/** Parse a finite number inside the inclusive bounds used by the v1 layout. */
export function parseLayoutNumber(raw: string, min: number, max: number): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

const module = (x: number, y: number, enabled = true): OverlayModuleLayout => ({ x, y, scale: 1, enabled });

/** Mirrors G-Maiden `overlay/modules.ts::DEFAULT_LAYOUT`. Keep in sync with the v1 schema. */
export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  // Top-centre column restacked 2026-08-11: Dota's own kill feed owns y8–17 at
  // centre, so alert moved out from under it (was y12) and toast/banner shifted
  // down to keep the column clear of itself. vol left the bottom HUD (was 50,92).
  alert: module(50, 20), gmeter: module(7, 47), toast: module(50, 24), companion: module(7, 39),
  advice: module(50, 72), buyback: module(50, 63), missing: module(88, 12), banner: module(50, 34),
  // The three cues that outlive a match, placed to clear BOTH screens (see
  // DOTA_PREGAME_ZONES). standby is pre-game only, so it takes the top band
  // above the rosters; toast and vol take the left band and the bottom gutter,
  // the two strips neither screen uses.
  lowhp: module(50, 44), vol: module(20, 95), standby: module(50, 5),
  // Stat strip compacted left: Dota's portrait bar really begins at ~31%, so the
  // old strip put Net Worth (box 29.5–34.5) underneath it. Everything shifts left
  // to end clear of 30. `score` left the bar entirely — it is disabled by default,
  // but at its old x=58 it would have landed inside the moment anyone enabled it.
  clock: module(4, 4), kda: module(9.5, 4), gold: module(15, 4), gpm: module(20.5, 4),
  xpm: module(20.5, 10, false), nw: module(26, 4), score: module(75, 4, false),
  hero: module(14, 33, false),
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
  // Measured off the bundled reference (luminance profile across y≈3.5%): the bar
  // is bright grass out to 30%, drops to near-black by 32%, and stays dark to
  // ~70%. G-Maiden's module registry claimed "portraits start ≈x35" and this zone
  // was narrowed to 35–65 to match that note — both were wrong, and the narrow
  // zone hid a real overlap on the Net Worth chip. Trust the pixels.
  { id: "topbar", label: "Dota 2 · hero portraits / score", left: 30, top: 0, right: 70, bottom: 8, kind: "blocked" },
  { id: "killfeed", label: "Dota 2 · kill banner / feed", left: 38, top: 8, right: 62, bottom: 17, kind: "transient" },
  { id: "scoreboard", label: "Dota 2 · scoreboard / FPS", left: 88, top: 0, right: 100, bottom: 6, kind: "blocked" },
  { id: "minimap", label: "Dota 2 · minimap", left: 0, top: 78, right: 13, bottom: 100, kind: "blocked" },
  { id: "hud", label: "Dota 2 · bottom HUD", left: 28, top: 77, right: 73, bottom: 100, kind: "blocked" },
  { id: "shop", label: "Dota 2 · items / shop", left: 75, top: 74, right: 100, bottom: 100, kind: "blocked" },
];

/**
 * The pre-game screen: Dota lists one team down each edge with the map in the
 * middle, and G-Maiden already paints over it — `standby` shows whenever the
 * player is out of a match, and `vol` fires on any hotkey press.
 *
 * A layout is one layout: a module has a single position that has to clear BOTH
 * screens, so this is a second set of guides for the same coordinates rather
 * than a second layout. Checking only the in-game HUD is how a module ends up
 * sitting on the roster for the entire loading screen.
 *
 * Coordinates are the standard 16:9 arrangement, not a measured capture — no
 * pre-game screenshot is bundled. Treat them as generous rather than exact.
 */
export const DOTA_PREGAME_ZONES: HudZone[] = [
  { id: "roster-left", label: "Dota 2 · team roster (left)", left: 0, top: 12, right: 24, bottom: 88, kind: "blocked" },
  { id: "pregame-map", label: "Dota 2 · map", left: 30, top: 10, right: 70, bottom: 90, kind: "blocked" },
  { id: "roster-right", label: "Dota 2 · team roster (right)", left: 76, top: 12, right: 100, bottom: 88, kind: "blocked" },
];

export type StageScreen = "ingame" | "pregame";

export const STAGE_ZONES: Record<StageScreen, HudZone[]> = {
  ingame: DOTA_HUD_ZONES,
  pregame: DOTA_PREGAME_ZONES,
};

/**
 * Modules that can actually be on screen before a match.
 *
 * G-Maiden's `FullOverlay` gates almost everything behind `inGame &&`. Only
 * three survive that gate: `standby` renders exactly when `!inGame`, `vol` is
 * hotkey-driven and ungated, and `toast` mirrors a spoken cue whenever one
 * fires. Checking the other sixteen against the pre-game screen would report
 * conflicts for modules that are not drawn — the same false-positive trap that
 * made an earlier version of this tool untrustworthy.
 *
 * Keep aligned with the render conditions in `overlay/FullOverlay.tsx`.
 */
export const PREGAME_MODULES: ReadonlySet<OverlayModuleId> = new Set<OverlayModuleId>([
  "standby",
  "vol",
  "toast",
]);

/**
 * The mirror of PREGAME_MODULES: `standby` renders on `!inGame`, so it is the
 * one module the in-game screen never draws. Judging it there is the same
 * false positive in the other direction.
 */
export const INGAME_HIDDEN: ReadonlySet<OverlayModuleId> = new Set<OverlayModuleId>(["standby"]);

/**
 * Overlaps that are a deliberate trade, not a defect — reported as accepted
 * rather than as a red warning.
 *
 * A checker that keeps flagging something nobody intends to fix teaches people
 * to ignore it, which costs more than the overlap does. Recording the reason
 * here keeps the red list strictly actionable while leaving the fact visible.
 */
export const ACCEPTED_OVERLAPS: Partial<Record<OverlayModuleId, string>> = {
  toast:
    "in-game it belongs to the alert → toast → banner column, which is where it fires " +
    "almost always; pre-game it is a ≤3s notification passing over the map",
};

/** Modules a given screen actually draws — the only ones worth judging on it. */
export function modulesOnScreen(screen: StageScreen): readonly OverlayModuleId[] {
  return screen === "pregame"
    ? OVERLAY_MODULE_IDS.filter((id) => PREGAME_MODULES.has(id))
    : OVERLAY_MODULE_IDS.filter((id) => !INGAME_HIDDEN.has(id));
}

/**
 * Zones a module's rect intrudes on. Defaults to the in-game HUD so existing
 * callers keep their behaviour; pass a set to check the pre-game screen.
 */
export function zoneConflicts(
  rect: { left: number; right: number; top: number; bottom: number },
  zones: HudZone[] = DOTA_HUD_ZONES,
): HudZone[] {
  return zones.filter(
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

export type OverlayConflictKind = HudZone["kind"] | "accepted" | "module";

export interface OverlayConflictItem {
  id: string;
  moduleId: OverlayModuleId;
  otherModuleId?: OverlayModuleId;
  kind: OverlayConflictKind;
  message: string;
}

/** Actionable, screen-aware warnings shared by the canvas, shelf and inspector. */
export function getOverlayConflictItems(layout: OverlayLayout, screen: StageScreen): OverlayConflictItem[] {
  const visible = new Set(modulesOnScreen(screen));
  const items: OverlayConflictItem[] = [];

  for (const id of OVERLAY_MODULE_IDS) {
    if (!layout[id].enabled || !visible.has(id)) continue;
    const conflicts = zoneConflicts(moduleRect(id, layout[id]), STAGE_ZONES[screen]);
    if (conflicts.length === 0) continue;

    const acceptedReason = ACCEPTED_OVERLAPS[id];
    if (acceptedReason) {
      items.push({
        id: `${id}:accepted:${screen}`,
        moduleId: id,
        kind: "accepted",
        message: `${OVERLAY_MODULE_LABELS[id]} has an accepted overlap with ${conflicts.map((zone) => zone.label).join(", ")}: ${acceptedReason}.`,
      });
      continue;
    }

    for (const zone of conflicts) {
      items.push({
        id: `${id}:${zone.id}:${screen}`,
        moduleId: id,
        kind: zone.kind,
        message: zone.kind === "transient"
          ? `${OVERLAY_MODULE_LABELS[id]} overlaps ${zone.label}; it is clear now but covered when the event appears.`
          : `${OVERLAY_MODULE_LABELS[id]} overlaps ${zone.label}; move it clear of this Dota control.`,
      });
    }
  }

  for (const [moduleId, otherModuleId] of moduleCollisions(layout)) {
    if (!visible.has(moduleId) || !visible.has(otherModuleId)) continue;
    items.push({
      id: `${moduleId}:${otherModuleId}:module`,
      moduleId,
      otherModuleId,
      kind: "module",
      message: `${OVERLAY_MODULE_LABELS[moduleId]} overlaps ${OVERLAY_MODULE_LABELS[otherModuleId]}; move one module to separate them.`,
    });
  }

  return items;
}

export function cloneDefaultOverlayLayout(): OverlayLayout {
  return Object.fromEntries(OVERLAY_MODULE_IDS.map((id) => [id, { ...DEFAULT_OVERLAY_LAYOUT[id] }])) as OverlayLayout;
}

export async function syncOverlayLayout(layout: OverlayLayout): Promise<{ ok: boolean; error?: string }> {
  return invoke("sync_overlay_layout", { layout });
}
