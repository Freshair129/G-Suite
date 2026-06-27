import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStudioStore } from "../store/useStudioStore";
import { useState } from "react";

export default function Toolbar() {
  const { sourcePath, wavPath, clips, setSource } = useStudioStore();
  const [loading, setLoading] = useState(false);

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

      {sourcePath && (
        <span className="text-xs text-gray-400 truncate max-w-[300px]">
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
