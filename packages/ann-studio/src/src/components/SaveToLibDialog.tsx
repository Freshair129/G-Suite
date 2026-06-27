import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, Loader2 } from "lucide-react";
import { useStudioStore, type LibPkg } from "../store/useStudioStore";

interface Props {
  onClose: () => void;
}

export default function SaveToLibDialog({ onClose }: Props) {
  const { clips, wavPath, duration, setLibraryPackages } = useStudioStore();
  const [pkgName, setPkgName] = useState("");
  const [game, setGame] = useState("Dota 2");
  const [fileType, setFileType] = useState("wav");
  const [quality, setQuality] = useState("medium");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!pkgName.trim()) {
      alert("กรุณาตั้งชื่อ Package");
      return;
    }
    if (!wavPath) {
      alert("ไม่มีไฟล์เสียงต้นทาง");
      return;
    }
    setSaving(true);
    try {
      const clipData = clips.map((c) => ({
        name: c.name,
        start: c.start,
        end: c.end,
        event: c.event || "unused",
      }));
      const result: { pkg_id: string; saved: number } = await invoke(
        "save_clips_to_library",
        {
          sourcePath: wavPath,
          clips: clipData,
          opts: {
            pkg_name: pkgName.trim(),
            game,
            file_type: fileType,
            quality,
            padding: 2.0,
          },
          totalDuration: duration,
        }
      );
      alert(`บันทึกสำเร็จ: ${result.saved} เสียง → ${result.pkg_id}`);
      const lib: { packages: LibPkg[] } = await invoke("init_library");
      setLibraryPackages(lib.packages);
      onClose();
    } catch (e) {
      alert(`บันทึกไม่สำเร็จ: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] bg-panel border border-line rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 className="text-sm font-bold">Save to Library</h3>
          <button
            onClick={onClose}
            className="grid place-items-center w-7 h-7 rounded-lg hover:bg-panel-hover transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-[11px] text-ink-faint mb-1.5">
              ชื่อ Package
            </label>
            <input
              value={pkgName}
              onChange={(e) => setPkgName(e.target.value)}
              placeholder="เช่น Thai_Caster_Pack_01"
              className="w-full h-9 px-3 rounded-lg bg-base border border-line text-sm text-ink outline-none focus:border-lime/50 transition"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[11px] text-ink-faint mb-1.5">
              ชื่อเกม
            </label>
            <input
              value={game}
              onChange={(e) => setGame(e.target.value)}
              className="w-full h-9 px-3 rounded-lg bg-base border border-line text-sm text-ink outline-none focus:border-lime/50 transition"
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[11px] text-ink-faint mb-1.5">
                ประเภทไฟล์
              </label>
              <select
                value={fileType}
                onChange={(e) => setFileType(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-base border border-line text-sm text-ink outline-none focus:border-lime/50 transition"
              >
                <option value="wav">WAV (lossless)</option>
                <option value="mp3">MP3</option>
                <option value="ogg">OGG Vorbis</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-[11px] text-ink-faint mb-1.5">
                ความละเอียด
              </label>
              <select
                value={quality}
                onChange={(e) => setQuality(e.target.value)}
                className="w-full h-9 px-3 rounded-lg bg-base border border-line text-sm text-ink outline-none focus:border-lime/50 transition"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>

          <div className="px-3 py-2 rounded-lg bg-base border border-line/50 text-[11px] text-ink-faint">
            <span className="text-ink">{clips.length}</span> clips จะถูกตัดแยกเป็นไฟล์เดี่ยว
            (เผื่อหน้า-หลัง 2 วินาที)
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-line">
          <button
            onClick={onClose}
            className="px-4 h-9 rounded-full bg-panel border border-line text-xs font-medium hover:bg-panel-hover transition"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !pkgName.trim()}
            className="flex items-center gap-1.5 px-5 h-9 rounded-full bg-gradient-to-r from-lime to-grass text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            {saving ? "กำลังบันทึก…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
