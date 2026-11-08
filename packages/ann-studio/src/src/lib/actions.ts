import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useStudioStore, genId, type Clip } from "../store/useStudioStore";
import { buildCurrentGann, installGmaidenPack } from "./exportGmaidenPack";
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

export async function sendToGMaiden(): Promise<string> { return installGmaidenPack(); }

export async function runExport(): Promise<string> {
 const path=await save({title:'บันทึก Announcer Package',defaultPath:'announcer.gann',filters:[{name:'G-Ann Package',extensions:['gann']}]});
 if(!path)return 'ยกเลิกการส่งออกแล้ว';
 try{const pack=await buildCurrentGann('session',undefined,path);return `ส่งออก GANN สำเร็จ ✅ ${pack.events} events · ${pack.clips} คู่เสียง/ภาพ\n${pack.path}`;}catch(e){return `ส่งออกไม่สำเร็จ: ${e}`;}
}

export function clearTimeline(): string {
  const {clips, setClips} = useStudioStore.getState();
  if (!clips.length) return "ยังไม่มีคลิป";
  if (!window.confirm(`ล้างทั้ง ${clips.length} คลิปจากไทม์ไลน์?`)) return "ยกเลิกแล้ว";
  setClips([]);
  return `ล้าง ${clips.length} คลิปแล้ว`;
}
