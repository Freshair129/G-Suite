import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { Upload, Download, Cpu } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";
import { runExport } from "../lib/actions";

export default function Header() {
  const { sourcePath, wavPath, clips, setSource, model } = useStudioStore();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleImport() {
    const file = await open({
      title: "เลือกไฟล์เสียงหรือคลิป",
      filters: [
        { name: "Media", extensions: ["mp4", "mp3", "wav", "ogg", "m4a", "mkv", "webm", "flac"] },
      ],
    });
    if (!file) return;
    setImporting(true);
    try {
      const result: { path: string; duration: number } = await invoke("extract_audio", {
        inputPath: file,
      });
      setSource(file as string, result.path, result.duration);
    } catch (e) {
      alert(`นำเข้าไม่สำเร็จ: ${e}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const msg = await runExport();
      alert(msg);
    } finally {
      setExporting(false);
    }
  }

  const fileName = sourcePath?.split(/[\\/]/).pop();

  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-line bg-base">
      <div className="flex items-center gap-3">
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-tr from-lime to-grass text-black font-extrabold text-lg">
          G
        </div>
        <div className="leading-tight">
          <h1 className="text-lg font-bold tracking-tight">G-AnnStudio</h1>
          <p className="text-[11px] text-ink-faint -mt-0.5">Announcer Pack Editor</p>
        </div>
      </div>

      {fileName && (
        <div className="hidden md:flex items-center gap-2 px-3.5 py-1.5 bg-panel rounded-full border border-line max-w-[360px]">
          <span className="w-1.5 h-1.5 rounded-full bg-lime shrink-0" />
          <span className="text-xs text-ink-muted truncate font-mono">{fileName}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-panel rounded-full border border-line text-xs">
          <Cpu size={14} className="text-lime" />
          <span className="text-ink-muted">Whisper · {model}</span>
        </div>

        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 px-4 h-9 rounded-full bg-panel hover:bg-panel-hover border border-line text-sm font-medium transition disabled:opacity-50"
        >
          <Upload size={15} className="text-lime" />
          {importing ? "กำลังโหลด…" : "นำเข้าไฟล์"}
        </button>

        <button
          onClick={handleExport}
          disabled={exporting || !wavPath || clips.length === 0}
          className="flex items-center gap-2 px-5 h-9 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40 disabled:hover:bg-white"
        >
          <Download size={15} />
          {exporting ? "กำลังส่งออก…" : "ส่งออก"}
        </button>
      </div>
    </header>
  );
}
