// W? / Banner build #3 — Stable Diffusion prompt builder for AI banner art.
// Pure + deterministic (testable): turns a G-Maiden event into a txt2img prompt
// whose mood follows the same tone ladder as the auto tone banner, so the AI art
// still reads as the right intensity. The generated image becomes a banner
// override, flowing through the existing install/preview pipeline.

import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { eventTone, type ToneKey } from "./toneBanner";

const TONE_MOOD: Record<ToneKey, string> = {
  ice: "cool icy blue, frost crystals, calm composed",
  calm: "serene teal glow, gentle, hopeful",
  warn: "amber warning glow, tense, alert",
  blood: "deep crimson, aggressive, sharp",
  fire: "blazing orange fire, explosive, intense",
  gold: "radiant gold, triumphant, heroic",
  radiant: "brilliant white-gold light, divine, godlike",
  lime: "electric lime energy, crisp, tactical",
};

export const BANNER_NEGATIVE =
  "text, words, letters, caption, watermark, signature, ui frame, border, blurry, low quality, jpeg artifacts, deformed";

/** Build the txt2img prompt for an event's banner art. */
export function bannerPrompt(eventId: string): string {
  const ev = GMAIDEN_EVENTS.find((e) => e.id === eventId);
  const subject = ev?.label ?? eventId;
  const mood = TONE_MOOD[eventTone(eventId)];
  return [
    `${subject}, Dota 2 esports announcer event banner`,
    mood,
    "glassmorphism HUD, dark background, cinematic dramatic lighting, glowing accents",
    "highly detailed, wide cinematic 21:9 banner, no text",
  ].join(", ");
}
