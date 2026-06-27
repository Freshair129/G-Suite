import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStudioStore, genId, type Clip } from "../store/useStudioStore";
import { useState } from "react";

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
interface Transcript {
  language: string;
  duration: number;
  segments: TranscriptSegment[];
}

export default function Toolbar() {
  const { sourcePath, wavPath, clips, setSource, setClips } = useStudioStore();
  const [loading, setLoading] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [model, setModel] = useState("medium");

  async function handleImport() {
    const file = await open({
      title: "เลือกไฟล์เสียงหรือคลิป",
      filters: [
        { name: "Media", extensions: ["mp4", "mp3", "wav", "ogg", "m4a", "mkv", "webm"] },
      ],
    });
    if (!file) return;

    setLoading(true);
    try {
      const result: { path: string; duration: number } = await invoke("extract_audio", {
        inputPath: file,
      });
      setSource(file as string, result.path, result.duration);
    } catch (e) {
      alert(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleAutoSplit() {
    if (!wavPath) return;
    if (
      clips.length > 0 &&
      !confirm(`มี ${clips.length} clips อยู่แล้ว — ถอดเสียงใหม่จะแทนที่ทั้งหมด ดำเนินการต่อ?`)
    ) {
      return;
    }

    setTranscribing(true);
    try {
      const t: Transcript = await invoke("transcribe_audio", {
        wavPath,
        model,
        lang: "th",
      });
      const newClips: Clip[] = t.segments
        .filter((s) => s.end - s.start > 0.1)
        .map((s) => ({
          id: genId(),
          name: s.text || "(ไม่มีข้อความ)",
          start: s.start,
          end: s.end,
          event: "custom",
          color: "",
        }));
      setClips(newClips);
      if (newClips.length === 0) {
        alert("ถอดเสียงเสร็จแต่ไม่พบช่วงพูด");
      }
    } catch (e) {
      alert(`Transcribe error: ${e}`);
    } finally {
      setTranscribing(false);
    }
  }

  async function handleExport() {
    if (!wavPath || clips.length === 0) return;

    const dir = await save({
      title: "เลือกโฟลเดอร์ส่งออก",
      defaultPath: "announcer-pack",
    });
    if (!dir) return;

    setLoading(true);
    try {
      const result: { manifest_path: string } = await invoke("export_all", {
        sourcePath: wavPath,
        clips: clips.map((c) => ({
          id: c.id,
          name: c.name,
          start: c.start,
          end: c.end,
          event: c.event,
        })),
        outputDir: dir,
      });
      alert(`ส่งออกสำเร็จ!\n${result.manifest_path}`);
    } catch (e) {
      alert(`Export error: ${e}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-panel border-b border-gray-800">
      <h1 className="text-ice-300 font-bold text-lg mr-4">G-AnnStudio</h1>

      <button
        onClick={handleImport}
        disabled={loading}
        className="px-3 py-1.5 bg-ice-500 hover:bg-ice-400 text-white rounded text-sm font-medium disabled:opacity-50"
      >
        {loading ? "กำลังโหลด..." : "นำเข้าไฟล์"}
      </button>

      {wavPath && (
        <div className="flex items-center gap-1">
          <button
            onClick={handleAutoSplit}
            disabled={transcribing}
            className="px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm font-medium disabled:opacity-50"
            title="ถอดเสียงด้วย faster-whisper แล้วแบ่ง clip ตามประโยคอัตโนมัติ"
          >
            {transcribing ? "กำลังถอดเสียง..." : "แยกอัตโนมัติ (ถอดเสียง)"}
          </button>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={transcribing}
            className="bg-gray-800 text-gray-300 text-xs rounded px-1 py-1.5 border border-gray-700 outline-none"
            title="โมเดล Whisper — large-v3 แม่นกว่าสำหรับภาษาไทยแต่ช้ากว่า"
          >
            <option value="medium">medium</option>
            <option value="large-v3">large-v3</option>
            <option value="small">small</option>
          </select>
        </div>
      )}

      {sourcePath && (
        <span className="text-xs text-gray-400 truncate max-w-[220px]">
          {sourcePath}
        </span>
      )}

      <div className="flex-1" />

      <span className="text-xs text-gray-500">{clips.length} clips</span>

      <button
        onClick={handleExport}
        disabled={loading || clips.length === 0}
        className="px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium disabled:opacity-50"
      >
        ส่งออก WAV + Manifest
      </button>
    </div>
  );
}
