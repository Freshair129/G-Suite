import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X, Save, Loader2 } from "lucide-react";
import { useStudioStore, type LibPkg } from "../store/useStudioStore";

interface Props {
  onClose: () => void;
}

export default function SaveToLibDialog({ onClose }: Props) {
  const { clips, wavPath, sourcePath, duration, provider, llmModel, setLibraryPackages } = useStudioStore();
  const [pkgName, setPkgName] = useState("");
  const [game, setGame] = useState("Dota 2");
  const [fileType, setFileType] = useState("wav");
  const [quality, setQuality] = useState("medium");
  const [saving, setSaving] = useState(false);
  // per-clip English name (AI-suggested, editable) → filename <idx>_<en>.wav
  const [nameEns, setNameEns] = useState<Record<string, string>>({});
  const [naming, setNaming] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const ownerRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ownerRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === "Tab" && panelRef.current) {
        const controls = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && (document.activeElement === first || !panelRef.current.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !panelRef.current.contains(document.activeElement))) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => { document.removeEventListener("keydown", onKeyDown, true); opener?.focus(); };
  }, []);

  /** Ask the LLM for a short snake_case English name per clip (editable after). */
  async function generateNames() {
    if (!clips.length) return;
    setNaming(true);
    try {
      const list = clips
        .map((c, i) => `${i + 1}. ${c.name}${c.event && c.event !== "unused" ? ` (event: ${c.event})` : ""}`)
        .join("\n");
      const system = `ตั้งชื่อภาษาอังกฤษสั้น ๆ แบบ snake_case (a-z 0-9 _ เท่านั้น, ไม่เกิน 4 คำ) ให้เสียงพากย์ announcer เกม Dota 2 แต่ละอัน สื่อความหมาย/อารมณ์ของประโยค (ไม่ใช่แค่ทับศัพท์).
ตอบ JSON อย่างเดียว: {"names":[{"index":1,"en":"..."},...]} ครบทุกอัน ห้ามมีข้อความอื่น`;
      const raw = await invoke<string>("llm_complete", {
        provider,
        model: provider === "ollama" ? llmModel || undefined : undefined,
        system,
        prompt: `เสียง:\n${list}`,
      });
      const a = raw.indexOf("{");
      const b = raw.lastIndexOf("}");
      if (a === -1 || b === -1) {
        alert("AI ตอบไม่เป็น JSON — ลองใหม่หรือเปลี่ยน provider");
        return;
      }
      const parsed = JSON.parse(raw.slice(a, b + 1)) as { names?: { index: number; en: string }[] };
      const next: Record<string, string> = { ...nameEns };
      for (const n of parsed.names ?? []) {
        const c = clips[n.index - 1];
        if (c && n.en) next[c.id] = n.en;
      }
      setNameEns(next);
    } catch (e) {
      alert(`ตั้งชื่อ AI ไม่สำเร็จ: ${e}`);
    } finally {
      setNaming(false);
    }
  }

  async function handleSave() {
    if (!pkgName.trim()) {
      alert("กรุณาตั้งชื่อ Package");
      return;
    }
    if (!wavPath && clips.some((c) => !c.filePath)) {
      alert("ไม่มีไฟล์เสียงต้นทาง — นำเข้าไฟล์ หรือเปิด pack จากคลัง");
      return;
    }
    setSaving(true);
    try {
      const clipData = clips.map((c) => ({
        nameTh: c.name,
        nameEn: nameEns[c.id] ?? "", // AI-suggested + editable; empty → filename uses the event
        start: c.start,
        end: c.end,
        events: c.event && c.event !== "unused" ? [c.event] : [],
        source: c.source ?? "", // per-clip origin (library sound carries its own)
        filePath: c.filePath ?? "", // file-clip: copy its own wav instead of cutting
      }));
      const result: { pkg_id: string; saved: number } = await invoke(
        "save_clips_to_library",
        {
          sourcePath: wavPath ?? "",
          clips: clipData,
          opts: {
            pkg_name: pkgName.trim(),
            game,
            file_type: fileType,
            quality,
            padding: 2.0,
            origin: sourcePath ?? "",
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/60 backdrop-blur-sm">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="save-library-title" className="w-[520px] max-w-full max-h-full flex flex-col bg-panel border border-line rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-line">
          <h3 id="save-library-title" className="text-sm font-bold">บันทึกเข้าคลัง — เจ้าของเสียง</h3>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="grid place-items-center w-7 h-7 rounded-lg hover:bg-panel-hover transition"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-[11px] text-ink-faint mb-1.5">
              ชื่อเจ้าของเสียง (voice owner)
            </label>
            <input
              ref={ownerRef}
              value={pkgName}
              onChange={(e) => setPkgName(e.target.value)}
              placeholder="เช่น น้าค่อม, เสียงผมอัดเอง, VRZO"
              className="w-full h-9 px-3 rounded-lg bg-base border border-line text-sm text-ink outline-none focus:border-lime/50 transition"
            />
            <p className="text-[10px] text-ink-faint mt-1">แยกคลังตามเจ้าของเสียง — เลือก mapping event ทีหลังได้</p>
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

          {/* per-clip English name (AI-suggested, editable) → filename */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[11px] text-ink-faint">ชื่อ ENG ต่อคลิป (ใช้ตั้ง filename)</label>
              <button
                onClick={generateNames}
                disabled={naming || !clips.length}
                className="text-[11px] text-lime hover:underline disabled:opacity-40"
              >
                {naming ? "AI กำลังตั้งชื่อ…" : "✨ AI ตั้งชื่อ ENG"}
              </button>
            </div>
            <div className="max-h-44 overflow-y-auto rounded-lg border border-line/50 divide-y divide-line/30">
              {clips.map((c, i) => (
                <div key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                  <span className="text-[10px] font-mono text-ink-faint w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <span className="text-[11px] text-ink-muted truncate flex-1 min-w-0" title={c.name}>{c.name}</span>
                  <input
                    value={nameEns[c.id] ?? ""}
                    onChange={(e) => setNameEns((m) => ({ ...m, [c.id]: e.target.value }))}
                    placeholder={c.event && c.event !== "unused" ? c.event : "eng_name"}
                    className="w-36 shrink-0 h-6 px-2 rounded bg-base border border-line text-[10px] font-mono text-ink outline-none focus:border-lime/50"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="px-3 py-2 rounded-lg bg-base border border-line/50 text-[11px] text-ink-faint">
            <span className="text-ink">{clips.length}</span> clips จะถูกตัดแยกเป็นไฟล์เดี่ยว
            (เผื่อหน้า-หลัง 2 วินาที) · filename = <span className="font-mono">NN_&lt;eng&gt;.wav</span>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end gap-2 px-5 py-4 border-t border-line">
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
