// Install a G-Maiden manifest-based pack (clips + per-event banners) straight
// into G-Maiden's voice-cache. Banners default to the auto-generated tone banner
// for each mapped event (W2); an author override can replace them later.

import { invoke } from "@tauri-apps/api/core";
import { useStudioStore } from "../store/useStudioStore";
import { toneBannerPngDataUrl } from "./toneBanner";
import { bakeToneWebp, bakeReactiveWebp } from "./bakeBanner";
import { clipEnvelope } from "./peaks";

interface PackInstallReport {
  pack_id: string;
  pack_dir: string;
  events: number;
  clips: number;
  banners: number;
}

export async function installGmaidenPack(
  packName = "ann-pack",
  author = "",
  animate = true,
  voiceCaption = true,
  reactive = false
): Promise<string> {
  const s = useStudioStore.getState();
  const wavPath = s.wavPath;
  if (!wavPath) return "ยังไม่มีไฟล์เสียง — นำเข้าไฟล์ก่อนนะครับ";
  const mapped = s.clips.filter((c) => c.event && c.event !== "unused");
  if (!mapped.length) return "ยังไม่มี clip ที่ map event — กด “AI map” ก่อนนะครับ";

  // caption per event = the first mapped clip's transcript (the voice line),
  // so a pack's banners read out its own spoken words instead of a fixed label.
  const firstClip = (ev: string) => mapped.find((c) => c.event === ev);
  const captionOf = (ev: string): string | undefined =>
    voiceCaption ? firstClip(ev)?.name : undefined;

  // one banner per mapped event, in priority order:
  //   1. the author's override image (animated webp/gif pass straight through)
  //   2. an audio-reactive bake (when `reactive`) — waveform pulses with voice
  //   3. a baked animated-WebP entrance of the tone banner (when `animate`)
  //   4. the static PNG tone banner (also the fallback if a bake fails)
  const overrides = s.bannerOverrides;
  const events = [...new Set(mapped.map((c) => c.event))];
  const banners = await Promise.all(
    events.map(async (ev) => {
      const ov = overrides[ev];
      if (ov) return { event: ev, b64: ov.b64, ext: ov.ext };
      const cap = captionOf(ev);
      if (reactive) {
        const c = firstClip(ev);
        if (c) {
          const env = await clipEnvelope(wavPath, c.start, c.end, s.duration).catch(() => []);
          const webp = await bakeReactiveWebp(ev, env, c.end - c.start, cap);
          if (webp) return { event: ev, b64: webp, ext: "webp" };
        }
      }
      if (animate) {
        const webp = await bakeToneWebp(ev, 2, cap);
        if (webp) return { event: ev, b64: webp, ext: "webp" };
      }
      return { event: ev, b64: toneBannerPngDataUrl(ev, 2, cap).split(",")[1], ext: "png" };
    })
  );

  const packId = `pack_${Date.now().toString(36)}`;
  try {
    const r = await invoke<PackInstallReport>("install_gmaiden_pack", {
      packId,
      packName,
      author,
      sourcePath: s.wavPath,
      clips: mapped.map((c) => ({
        name: c.name,
        start: c.start,
        end: c.end,
        event: c.event,
        gain: c.gain ?? 0,
        fadeIn: c.fadeIn ?? 0,
        fadeOut: c.fadeOut ?? 0,
        normalize: c.normalize ?? false,
        speed: c.speed ?? 1,
        gainL: c.gainL ?? 0,
        gainR: c.gainR ?? 0,
        master: c.master ?? {},
      })),
      banners,
      gmaidenDir: null,
      endpoint: "http://localhost:3000/announcer/install",
    });
    return `ติดตั้งลง G-Maiden ✅  ${r.events} events · ${r.clips} clips · ${r.banners} banners\n${r.pack_dir}`;
  } catch (e) {
    return `ติดตั้งไม่สำเร็จ: ${e}`;
  }
}
