// W4 — HoN → G-Maiden (Dota) announcer-label mapping.
//
// The hybrid vision pipeline is: vision=clip boundary (W1), whisper=text, and
// button-OCR=event label (W4). HoN announcer-pack showcase videos highlight an
// event *button* per line (Double Tap / Quad Kill / Killing Spree / …). The OCR
// step reads that (noisy) button text; this module resolves it to a G-Maiden
// event id. It also gives the transcript-based auto-map a deterministic
// fast-path — an English announcer term maps here without asking the LLM.
//
// This resolver is the shared contract: the OCR sidecar emits raw label text and
// the frontend resolves it here, so there is one mapping table, not two.

import { GMAIDEN_EVENTS } from "../data/gmaiden-events";

/**
 * High-confidence announcer phrase → G-Maiden event id. Only mappings we are
 * sure about — HoN's kill-streak ladder is ~1:1 with Dota's, and its multikill
 * tiers map by kill count (Quad = 4 = ultra_kill; Annihilation = 5 = rampage).
 * Anything not here resolves to null so the caller falls back to the LLM /
 * manual mapping rather than guessing wrong.
 */
export const ANNOUNCER_ALIASES: Record<string, string> = {
  "first blood": "first_blood",
  // multikill (rapid succession) — by kill count
  "double kill": "double_kill",
  "double tap": "double_kill",
  "triple kill": "triple_kill",
  "hat trick": "triple_kill", // HoN's 3-kill button
  "quad kill": "ultra_kill",
  "ultra kill": "ultra_kill",
  "annihilation": "rampage",
  "rampage": "rampage",
  // kill-streak (no death) ladder — HoN wording matches Dota's tiers
  "killing spree": "killing_spree",
  "dominating": "dominating",
  "mega kill": "mega_kill",
  "unstoppable": "unstoppable",
  "wicked sick": "wicked_sick",
  "monster kill": "monster_kill",
  "godlike": "godlike",
  "beyond godlike": "beyond_godlike",
  "holy shit": "beyond_godlike",
  // flow / state
  "match start": "match_start",
  "level up": "levelUp",
  "respawn": "respawn",
};

/** Split camelCase (OCR concatenates "HatTrick"/"DoubleTap"), lowercase,
 *  collapse every non-alphanumeric run to a single space, trim. */
function norm(s: string): string {
  return s
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Normalized lookup: the aliases above, plus every event's own label and id, so
// Dota-native text ("Triple Kill", "triple_kill") resolves too. Built once.
const NORM_ALIASES: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [k, v] of Object.entries(ANNOUNCER_ALIASES)) m[norm(k)] = v;
  for (const e of GMAIDEN_EVENTS) {
    if (e.id === "unused") continue;
    const nl = norm(e.label);
    const ni = norm(e.id);
    if (nl && !(nl in m)) m[nl] = e.id;
    if (ni && !(ni in m)) m[ni] = e.id;
  }
  return m;
})();

/**
 * Resolve a (possibly OCR-noisy) announcer label to a G-Maiden event id, or
 * null when there is no confident match. Tries: exact normalized hit, then the
 * longest alias phrase that is either contained in the text (OCR added words) or
 * is a whole word of a multi-word alias (OCR dropped words). Word-boundary
 * matching keeps a bare "kill" from resolving to "killing spree".
 */
export function matchAnnouncerLabel(raw: string): string | null {
  const n = norm(raw);
  if (n.length < 3) return null;
  if (NORM_ALIASES[n]) return NORM_ALIASES[n];

  let best: string | null = null;
  let bestLen = 0;
  for (const [phrase, id] of Object.entries(NORM_ALIASES)) {
    const words = phrase.split(" ");
    const hit = n.includes(phrase) || words.includes(n);
    if (hit && phrase.length > bestLen) {
      best = id;
      bestLen = phrase.length;
    }
  }
  return best;
}
