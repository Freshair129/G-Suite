import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useStudioStore } from "../store/useStudioStore";
import { useState } from "react";
import { IconImport, IconExport, IconWave } from "./icons";

export default function Header() {
  const { sourcePath, wavPath, clips, setSource } = useStudioStore();
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
    if (!wavPath || clips.length === 0) return;
    const dir = await save({ title: "บันทึก announcer pack", defaultPath: "announcer-pack" });
    if (!dir) return;
    setExporting(true);
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
      alert(`ส่งออกสำเร็จ — ${clips.length} clips\n${result.manifest_path}`);
    } catch (e) {
      alert(`ส่งออกไม่สำเร็จ: ${e}`);
    } finally {
      setExporting(false);
    }
  }

  const fileName = sourcePath?.split(/[\\/]/).pop();

  return (
    <header className="flex items-center gap-4 px-5 h-14 shrink-0 border-b border-line bg-surface/60 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <div className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-mint-400 to-ice-500 text-base shadow-glow">
          <IconWave size={18} />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">G-AnnStudio</div>
          <div className="text-[10px] text-ink-faint -mt-0.5">Announcer Pack Editor</div>
        </div>
      </div>

      {fileName && (
        <div className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-surface-raised border border-line max-w-[280px]">
          <span className="w-1.5 h-1.5 rounded-full bg-mint-400 shrink-0" />
          <span className="text-xs text-ink-muted truncate font-mono">{fileName}</span>
        </div>
      )}

      <div className="flex-1" />

      <button
        onClick={handleImport}
        disabled={importing}
        className="flex items-center gap-2 px-3.5 h-9 rounded-lg bg-surface-raised hover:bg-surface-hover border border-line text-sm font-medium transition-colors disabled:opacity-50"
      >
        <IconImport size={16} className="text-mint-400" />
        {importing ? "กำลังโหลด…" : "นำเข้าไฟล์"}
      </button>

      <button
        onClick={handleExport}
        disabled={exporting || clips.length === 0}
        className="flex items-center gap-2 px-3.5 h-9 rounded-lg bg-mint-500 hover:bg-mint-400 text-base font-semibold text-sm transition-colors disabled:opacity-40 disabled:hover:bg-mint-500"
      >
        <IconExport size={16} />
        {exporting ? "กำลังส่งออก…" : "ส่งออก"}
      </button>
    </header>
  );
}
