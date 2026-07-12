// Install a G-Maiden manifest-based pack (clips + per-event banners) straight
// into G-Maiden's voice-cache. Banners default to the auto-generated tone banner
// for each mapped event (W2); an author override can replace them later.

import { invoke } from "@tauri-apps/api/core";
import { useStudioStore } from "../store/useStudioStore";
import { toneBannerPngDataUrl } from "./toneBanner";

interface PackInstallReport {
  pack_id: string;
  pack_dir: string;
  events: number;
  clips: number;
  banners: number;
}

export async function installGmaidenPack(packName = "ann-pack", author = ""): Promise<string> {
  const s = useStudioStore.getState();
  if (!s.wavPath) return "ยังไม่มีไฟล์เสียง — นำเข้าไฟล์ก่อนนะครับ";
  const mapped = s.clips.filter((c) => c.event && c.event !== "unused");
  if (!mapped.length) return "ยังไม่มี clip ที่ map event — กด “AI map” ก่อนนะครับ";

  // one tone banner (PNG, alpha) per mapped event
  const events = [...new Set(mapped.map((c) => c.event))];
  const banners = events.map((ev) => ({
    event: ev,
    b64: toneBannerPngDataUrl(ev, 2).split(",")[1],
    ext: "png",
  }));

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
