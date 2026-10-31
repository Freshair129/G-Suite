import { useState } from "react";
import { useStudioStore } from "../store/useStudioStore";
import EventPicker from "./EventPicker";
import SaveToLibDialog from "./SaveToLibDialog";
import { Trash2, Wand2, Send, FolderDown } from "lucide-react";
import { autoMapEvents } from "../lib/llm";
import { sendToGMaiden } from "../lib/actions";
import { selectProjectVariant } from "../lib/project";

export default function ClipList() {
  const { clips, selectedClipId, updateClip, removeClip, setClips } = useStudioStore();
  const ordered = clips.slice().sort((a, b) => a.start - b.start);
  const [busy, setBusy] = useState<"map" | "send" | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  async function doMap() {
    setBusy("map");
    try {
      alert(await autoMapEvents());
    } catch (e) {
      alert(`AI map ไม่สำเร็จ: ${e}`);
    } finally {
      setBusy(null);
    }
  }
  async function doSend() {
    setBusy("send");
    try {
      alert(await sendToGMaiden());
    } catch (e) {
      alert(`ส่งไม่สำเร็จ: ${e}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 h-10 shrink-0">
        <span className="text-xs text-ink-faint">{clips.length} clips</span>
        {clips.length > 0 && (
          <button
            onClick={() => confirm("ลบ clips ทั้งหมด?") && setClips([])}
            className="text-xs text-ink-faint hover:text-danger transition"
          >
            ล้างทั้งหมด
          </button>
        )}
      </div>

      {clips.length > 0 && (
        <div className="flex flex-col gap-2 px-3 pb-2 shrink-0">
          <div className="flex gap-2">
            <button
              onClick={doMap}
              disabled={busy !== null}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-full bg-panel border border-line text-xs font-medium hover:border-lime/50 transition disabled:opacity-50"
              title="ให้ AI จับคู่ทุก clip กับ event ของ G-Maiden"
            >
              <Wand2 size={14} className="text-lime" />
              {busy === "map" ? "กำลัง map…" : "AI map events"}
            </button>
            <button
              onClick={doSend}
              disabled={busy !== null}
              className="flex-1 flex items-center justify-center gap-1.5 h-8 rounded-full bg-gradient-to-r from-lime to-grass text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
              title="ติดตั้ง pack ลง G-Maiden ตาม event"
            >
              <Send size={13} />
              {busy === "send" ? "กำลังส่ง…" : "ส่ง G-Maiden"}
            </button>
          </div>
          <button
            onClick={() => setShowSaveDialog(true)}
            className="flex items-center justify-center gap-1.5 h-8 rounded-full bg-panel border border-lime/30 text-xs font-medium text-lime hover:bg-lime/10 transition"
            title="บันทึก clips ลง Sound Library"
          >
            <FolderDown size={14} />
            Save to Lib
          </button>
        </div>
      )}

      {clips.length === 0 ? (
        <div className="flex-1 grid place-items-center p-6">
          <p className="text-sm text-ink-faint text-center leading-relaxed">
            ลากบน waveform เพื่อสร้าง clip
            <br />
            หรือกด <span className="text-lime">แยกอัตโนมัติ</span>
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1.5">
          {ordered.map((clip, i) => {
            const selected = clip.id === selectedClipId;
            return (
              <div
                key={clip.id}
                onClick={() => selectProjectVariant(clip.id)}
                className={`group relative rounded-2xl border px-3 py-2.5 cursor-pointer transition ${
                  selected
                    ? "border-lime/60 bg-lime/[0.06] shadow-glow"
                    : "border-line bg-panel/50 hover:bg-panel-hover/70 hover:border-white/15"
                }`}
              >
                <span
                  className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-full"
                  style={{ background: clip.color || "#22c55e" }}
                />
                <div className="flex items-center gap-2 mb-1.5 pl-1.5">
                  <span className="text-[10px] font-mono text-ink-faint w-5 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={clip.name}
                    onChange={(e) => updateClip(clip.id, { name: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none border-b border-transparent focus:border-lime/50 truncate"
                    placeholder="ชื่อ clip"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeClip(clip.id);
                    }}
                    className="grid place-items-center w-6 h-6 rounded-lg text-ink-faint opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition shrink-0"
                    title="ลบ clip"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-2 pl-1.5 mb-2">
                  <span className="font-mono text-[11px] text-ink-muted tabular-nums">
                    {clip.start.toFixed(2)}–{clip.end.toFixed(2)}s
                  </span>
                  <span className="font-mono text-[10px] text-lime/90 bg-lime/10 rounded px-1.5 py-0.5">
                    {(clip.end - clip.start).toFixed(2)}s
                  </span>
                </div>

                <div className="pl-1.5" onClick={(e) => e.stopPropagation()}>
                  <EventPicker
                    value={clip.event}
                    onChange={(event) => updateClip(clip.id, { event })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showSaveDialog && (
        <SaveToLibDialog onClose={() => setShowSaveDialog(false)} />
      )}
    </div>
  );
}
