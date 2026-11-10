import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useStudioStore, genId, type Clip } from "../store/useStudioStore";
import { matchAnnouncerLabel } from "./honEventMap";

const VIDEO_EXT = /\.(mp4|mkv|mov|webm|avi|m4v)$/i;

/** True when the imported source is a video (the vision pipeline can run). */
export function sourceIsVideo(): boolean {
  return VIDEO_EXT.test(useStudioStore.getState().sourcePath ?? "");
}

interface AnalyzedClip {
  start: number;
  end: number;
  text: string;
  label: string;
}

/**
 * Vision auto-split for a showcase VIDEO: chain W1 (boundaries) → whisper (text)
 * → W4 (button label) via the Rust `analyze_video` command, then build clips
 * with the event pre-resolved from the HoN label. Falls back to plain whisper
 * auto-split when there are no vision windows.
 */
export async function runAnalyzeVideo(model?: string): Promise<string> {
  const s = useStudioStore.getState();
  if (!s.sourcePath || !s.wavPath) return "ยังไม่มีไฟล์ — นำเข้าวิดีโอก่อนนะครับ";
  if (!VIDEO_EXT.test(s.sourcePath)) return runAutoSplit(model);
  if (s.transcribing) return "กำลังประมวลผลอยู่…";
  s.setTranscribing(true);
  try {
    const analyzed = await invoke<AnalyzedClip[]>("analyze_video", {
      videoPath: s.sourcePath,
      wavPath: s.wavPath,
      model: model || s.model,
      lang: "th",
    });
    if (!analyzed.length) {
      // no caption windows found by vision — fall back to whisper split
      useStudioStore.getState().setTranscribing(false);
      return runAutoSplit(model);
    }
    let labelled = 0;
    const next: Clip[] = analyzed.map((a) => {
      const event = a.label ? matchAnnouncerLabel(a.label) : null;
      if (event) labelled++;
      return {
        id: genId(),
        name: a.text || a.label || "(ไม่มีข้อความ)",
        start: a.start,
        end: a.end,
        event: event ?? "unused",
        color: "",
      };
    });
    useStudioStore.getState().setClips(next);
    return `วิเคราะห์วิดีโอได้ ${next.length} clips 🎬 (map จากปุ่มอัตโนมัติ ${labelled}/${next.length})`;
  } catch (e) {
    return `วิเคราะห์วิดีโอไม่สำเร็จ: ${e}`;
  } finally {
    useStudioStore.getState().setTranscribing(false);
  }
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
interface Transcript {
  segments: TranscriptSegment[];
}

/** Transcribe the loaded audio and replace clips with one region per phrase. */
export async function runAutoSplit(model?: string): Promise<string> {
  const s = useStudioStore.getState();
  if (!s.wavPath) return "ยังไม่มีไฟล์เสียง — นำเข้าไฟล์ก่อนนะครับ";
  if (s.transcribing) return "กำลังถอดเสียงอยู่…";
  s.setTranscribing(true);
  try {
    const t = await invoke<Transcript>("transcribe_audio", {
      wavPath: s.wavPath,
      model: model || s.model,
      lang: "th",
    });
    const next: Clip[] = t.segments
      .filter((seg) => seg.end - seg.start > 0.1)
      .map((seg) => ({
        id: genId(),
        name: seg.text || "(ไม่มีข้อความ)",
        start: seg.start,
        end: seg.end,
        event: "unused",
        color: "",
      }));
    useStudioStore.getState().setClips(next);
    return next.length
      ? `แยกได้ ${next.length} clips จากการถอดเสียง 🎙️`
      : "ถอดเสียงเสร็จ แต่ไม่พบช่วงพูด";
  } catch (e) {
    return `ถอดเสียงไม่สำเร็จ: ${e}`;
  } finally {
    useStudioStore.getState().setTranscribing(false);
  }
}

interface InstallReport {
  installed: number;
  skipped: number;
  voice_cache: string;
  per_event: Record<string, number>;
  endpoint: string | null;
}

/** Install the event-mapped clips straight into G-Maiden's voice-cache (+ ping its endpoint). */
export async function sendToGMaiden(): Promise<string> {
  const s = useStudioStore.getState();
  if (!s.wavPath) return "ยังไม่มีไฟล์เสียง";
  const mapped = s.clips.filter((c) => c.event && c.event !== "unused");
  if (!mapped.length) return "ยังไม่มี clip ที่ map event — กด “AI map” ก่อนนะครับ";
  try {
    const r = await invoke<InstallReport>("install_pack", {
      sourcePath: s.wavPath,
      clips: s.clips.map((c) => ({
        name: c.name,
        start: c.start,
        end: c.end,
        event: c.event,
      })),
      packName: "ann-pack",
      gmaidenDir: s.gmaidenPath || null,
      notifyGmaiden: true,
    });
    const ev = Object.entries(r.per_event)
      .map(([k, v]) => `${k}×${v}`)
      .join(", ");
    return `ส่งไป G-Maiden แล้ว ✅ ติดตั้ง ${r.installed} clips (ข้าม ${r.skipped})\n${ev}\n${r.voice_cache}${
      r.endpoint ? `\nendpoint: ${r.endpoint}` : ""
    }`;
  } catch (e) {
    return `ส่งไป G-Maiden ไม่สำเร็จ: ${e}`;
  }
}

/** Cut every clip to WAV + write the announcer manifest. */
export async function runExport(): Promise<string> {
  const s = useStudioStore.getState();
  if (!s.wavPath || s.clips.length === 0) return "ยังไม่มี clips ให้ส่งออก";
  const dir = await save({ title: "บันทึก announcer pack", defaultPath: "announcer-pack" });
  if (!dir) return "ยกเลิกการส่งออกแล้ว";
  try {
    const r = await invoke<{ manifest_path: string }>("export_all", {
      sourcePath: s.wavPath,
      clips: s.clips.map((c) => ({
        id: c.id,
        name: c.name,
        start: c.start,
        end: c.end,
        event: c.event,
      })),
      outputDir: dir,
    });
    return `ส่งออก ${s.clips.length} clips สำเร็จ ✅\n${r.manifest_path}`;
  } catch (e) {
    return `ส่งออกไม่สำเร็จ: ${e}`;
  }
}
