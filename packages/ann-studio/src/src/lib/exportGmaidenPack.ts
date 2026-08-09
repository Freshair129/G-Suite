// Install a G-Maiden manifest-based pack (clips + per-event banners) straight
// into G-Maiden's voice-cache. Banners default to the auto-generated tone banner
// for each mapped event (W2); an author override can replace them later.

import { invoke } from "@tauri-apps/api/core";
import { useStudioStore, type LibSound } from "../store/useStudioStore";
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
  const authorGid = s.gidSignedIn && s.gid ? s.gid : undefined;
  const authorName = author || (s.gidSignedIn ? s.gidDisplayName : "");
  const wavPath = s.wavPath;
  const mapped = s.clips.filter((c) => c.event && c.event !== "unused");
  if (!mapped.length) return "ยังไม่มี clip ที่ map event — กด “AI map” ก่อนนะครับ";
  // segment clips need the source wav; file-clips (opened pack) bring their own file
  if (!wavPath && mapped.some((c) => !c.filePath))
    return "ยังไม่มีไฟล์เสียงต้นฉบับ — นำเข้าไฟล์ หรือเปิด pack จากคลัง";

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
        // envelope source = the clip's own file (opened pack) or the source wav
        const src = c?.filePath ? `${s.libraryRoot}/${c.filePath}`.replace(/\//g, "\\") : wavPath;
        if (c && src) {
          const total = c.filePath ? c.fileDur ?? c.end : s.duration;
          const env = await clipEnvelope(src, c.start, c.end, total).catch(() => []);
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
      author: authorName,
      authorGid,
      sourcePath: s.wavPath ?? "",
      clips: mapped.map((c) => ({
        name: c.name,
        start: c.start,
        end: c.end,
        event: c.event,
        filePath: c.filePath ?? "",
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
      gmaidenDir: s.gmaidenPath || null,
      endpoint: "http://localhost:3000/announcer/install",
    });
    return `ติดตั้งลง G-Maiden ✅  ${r.events} events · ${r.clips} clips · ${r.banners} banners\n${r.pack_dir}`;
  } catch (e) {
    return `ติดตั้งไม่สำเร็จ: ${e}`;
  }
}

/**
 * Install the test-screen pack builder (event → library sounds) into G-Maiden.
 * Each sound is an already-cut library wav copied into the pack; banners follow
 * the same priority (override → animated tone → static PNG) as the session path.
 */
export async function installLibraryPack(
  packName = "ann-pack",
  author = "",
  animate = true,
  voiceCaption = true,
  reactive = false
): Promise<string> {
  const s = useStudioStore.getState();
  const authorGid = s.gidSignedIn && s.gid ? s.gid : undefined;
  const authorName = author || (s.gidSignedIn ? s.gidDisplayName : "");
  const pb = s.packBuilder;
  const libraryRoot = s.libraryRoot;
  const events = Object.keys(pb).filter((ev) => (pb[ev]?.length ?? 0) > 0);
  if (!events.length) return "ยังไม่มีเสียงในหน้าประกอบ pack — ลากเสียงจากคลังมาวางก่อนนะครับ";

  const clips = events.flatMap((ev) => pb[ev].map((snd) => ({ event: ev, filePath: snd.file_path })));

  // banner per event, mirroring the session path but sourced from the first
  // assigned library sound: caption = its name, reactive envelope = the whole file.
  const overrides = s.bannerOverrides;
  const firstOf = (ev: string): LibSound | undefined => pb[ev][0];
  const absOf = (snd: LibSound) => `${libraryRoot}/${snd.file_path}`.replace(/\//g, "\\");
  const banners = await Promise.all(
    events.map(async (ev) => {
      const ov = overrides[ev];
      if (ov) return { event: ev, b64: ov.b64, ext: ov.ext };
      const snd = firstOf(ev);
      const cap = voiceCaption ? snd?.name_th || snd?.name_en : undefined;
      if (reactive && snd) {
        const env = await clipEnvelope(absOf(snd), 0, snd.duration, snd.duration).catch(() => []);
        const webp = await bakeReactiveWebp(ev, env, snd.duration, cap);
        if (webp) return { event: ev, b64: webp, ext: "webp" };
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
    const r = await invoke<PackInstallReport>("install_library_pack", {
      packId,
      packName,
      author: authorName,
      authorGid,
      clips,
      banners,
      gmaidenDir: s.gmaidenPath || null,
      endpoint: "http://localhost:3000/announcer/install",
    });
    return `ติดตั้งจากคลังลง G-Maiden ✅  ${r.events} events · ${r.clips} clips · ${r.banners} banners\n${r.pack_dir}`;
  } catch (e) {
    return `ติดตั้งไม่สำเร็จ: ${e}`;
  }
}
