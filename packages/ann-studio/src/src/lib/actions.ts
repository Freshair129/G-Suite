import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useStudioStore, genId, type Clip } from "../store/useStudioStore";

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
      gmaidenDir: null,
      endpoint: "http://localhost:3000/announcer/install",
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
