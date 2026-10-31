// Source workspace — clips list (drag the grip to reorder), each with a framed
// waveform (trim/split + playhead needle). Select a row to load it into the
// Mastering deck below (resizable). Zoom scales every waveform.

import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Trash2, Wand2, Download, Send, ZoomIn, GripVertical, Save } from "lucide-react";
import { useStudioStore, genId, type Clip, type LibSound } from "../store/useStudioStore";
import { runAnalyzeVideo, runExport, sourceIsVideo } from "../lib/actions";
import { installGmaidenPack } from "../lib/exportGmaidenPack";
import EventPicker from "./EventPicker";
import ClipWaveform from "./ClipWaveform";
import MasteringPanel from "./MasteringPanel";
import SaveToLibDialog from "./SaveToLibDialog";
import { eventTone, TONES } from "../lib/toneBanner";
import { selectProjectVariant } from "../lib/project";

function accentFor(event: string): string {
  return event && event !== "unused" ? TONES[eventTone(event)].accent : "#8fd4ff";
}

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return "0:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export default function SourceView() {
  const {
    wavPath, duration, clips, transcribing, libraryRoot, addClip, setClips,
    updateClip, updateClipSilent, pushHistory, removeClip, splitClip, moveClip,
    selectedClipId, playheadId, playheadT,
  } = useStudioStore();

  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [dropOver, setDropOver] = useState(false);
  const [tool, setTool] = useState<"select" | "split">("select");

  // abs path + total duration for a clip's waveform (a library-file clip loads
  // its own file; a segment clip loads the shared source wav)
  const clipSrc = (c: Clip): string =>
    c.filePath ? `${libraryRoot}/${c.filePath}`.replace(/\//g, "\\") : (wavPath ?? "");
  const clipDur = (c: Clip): number => (c.filePath ? c.fileDur ?? c.end : duration);

  const clipFromSound = (s: LibSound): Clip => ({
    id: genId(),
    name: s.name_th || s.name_en,
    start: 0,
    end: s.duration,
    event: s.events?.[0] || "unused",
    color: "",
    filePath: s.file_path,
    fileDur: s.duration,
    source: s.source_path,
  });

  // drop a library sound (add one clip) OR a whole pack (load all its sounds)
  async function onDropSound(e: React.DragEvent) {
    e.preventDefault();
    setDropOver(false);
    const packId = e.dataTransfer.getData("application/x-library-pack");
    if (packId) {
      if (clips.length && !window.confirm("วาง pack จะแทนที่ clip ปัจจุบัน — ต่อไหม?")) return;
      try {
        const sounds = await invoke<LibSound[]>("query_sounds", { pkgId: packId });
        setClips(sounds.map(clipFromSound));
      } catch {
        /* ignore */
      }
      return;
    }
    const raw = e.dataTransfer.getData("application/x-library-sound-json");
    if (!raw) return;
    try {
      addClip(clipFromSound(JSON.parse(raw) as LibSound));
    } catch {
      /* ignore malformed drag */
    }
  }

  const DRAG_TYPES = ["application/x-library-sound-json", "application/x-library-pack"];
  const acceptsDrag = (e: React.DragEvent) => DRAG_TYPES.some((t) => e.dataTransfer.types.includes(t));
  const [zoom, setZoom] = useState(1);
  const [deckH, setDeckH] = useState(224);
  const dragId = useRef<string | null>(null);

  function startResize(e: React.PointerEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = deckH;
    function move(ev: PointerEvent) {
      setDeckH(Math.max(150, Math.min(480, startH + (startY - ev.clientY))));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  if (!wavPath && clips.length === 0) {
    return (
      <div
        className={`flex-1 min-w-0 grid place-items-center bg-base text-center px-6 ${dropOver ? "bg-lime/5" : ""}`}
        onDragOver={(e) => {
          if (acceptsDrag(e)) {
            e.preventDefault();
            setDropOver(true);
          }
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={onDropSound}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="text-base font-semibold text-ink">ยังไม่มีไฟล์ต้นฉบับ</div>
          <div className="text-sm text-ink-muted">
            กด “นำเข้าไฟล์” มุมขวาบน · หรือคลิกขวาที่ pack ในคลัง → เปิดแก้ไข · หรือลากเสียงจากคลังมาวางที่นี่
          </div>
        </div>
      </div>
    );
  }

  const mapped = clips.filter((c) => c.event && c.event !== "unused").length;

  async function withBusy(fn: () => Promise<string>) {
    setBusy(true);
    try { setMsg(await fn()); } finally { setBusy(false); }
  }

  return (
    <div className="flex-1 min-w-0 flex flex-col bg-base">
      {/* header */}
      <div className="shrink-0 bg-base border-b border-line px-6 py-3 flex items-center justify-between gap-4">
        <div className="text-xs text-ink-faint shrink-0">
          {fmt(duration)} · {clips.length} clips · map {mapped}/{clips.length}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => withBusy(runAnalyzeVideo)} disabled={transcribing || busy}
            title={sourceIsVideo() ? "วิเคราะห์วิดีโอ: ตัดคลิป + ถอดเสียง + อ่านปุ่ม event อัตโนมัติ" : "ถอดเสียงแล้วแยกเป็นคลิป"}
            className="flex items-center gap-2 px-4 h-9 rounded-full bg-lime text-black text-sm font-bold hover:bg-lime/90 transition disabled:opacity-50">
            <Wand2 size={15} />
            {transcribing ? "กำลังประมวลผล…" : clips.length ? "แยกอีกครั้ง" : sourceIsVideo() ? "วิเคราะห์วิดีโอ" : "แยกอัตโนมัติ"}
          </button>
          <div className="w-px h-6 bg-line mx-0.5" />
          <button onClick={() => setShowSave(true)} disabled={busy || !clips.length}
            className="flex items-center gap-2 px-3 h-9 rounded-full bg-panel border border-line text-sm text-ink hover:border-white/25 transition disabled:opacity-40" title="บันทึกเสียงชุดนี้เข้าคลัง แยกตามเจ้าของเสียง">
            <Save size={15} /> Save to Library
          </button>
          <button onClick={() => withBusy(runExport)} disabled={busy || !clips.length}
            className="flex items-center gap-2 px-3 h-9 rounded-full bg-panel border border-line text-sm text-ink hover:border-white/25 transition disabled:opacity-40" title="ส่งออกเป็นไฟล์ pack">
            <Download size={15} /> Export
          </button>
          <button onClick={() => withBusy(() => installGmaidenPack())} disabled={busy || mapped === 0}
            title={mapped === 0 ? "map event ให้ clip ก่อนอย่างน้อย 1 อัน" : "ติดตั้งลง G-Maiden พร้อม banner"}
            className="flex items-center gap-2 px-3 h-9 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40">
            <Send size={15} /> ติดตั้ง G-Maiden
          </button>
        </div>
      </div>

      {/* zoom bar */}
      <div className="shrink-0 px-4 py-1.5 flex items-center justify-end gap-2 border-b border-line/40 bg-base">
        <ZoomIn size={13} className="text-ink-faint shrink-0" />
        <input type="range" min={0.5} max={3} step={0.1} value={zoom}
          onChange={(e) => setZoom(parseFloat(e.target.value))}
          className="w-48 accent-lime cursor-pointer" title="ย่อ/ขยาย waveform" />
        <span className="text-[10px] font-mono text-ink-faint w-8 shrink-0">{zoom.toFixed(1)}x</span>
      </div>

      {msg && <div className="shrink-0 px-6 py-2 text-xs text-ink-muted whitespace-pre-line">{msg}</div>}

      {/* clip list — grip to reorder, framed waveform w/ playhead. also a drop
          target: drag a library sound in to add it as a standalone clip */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto ${dropOver ? "bg-lime/5" : ""}`}
        onDragOver={(e) => {
          if (acceptsDrag(e)) {
            e.preventDefault();
            setDropOver(true);
          }
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={onDropSound}
      >
        {clips.length === 0 ? (
          <div className="grid place-items-center py-24 text-sm text-ink-faint">
            กด “แยกอัตโนมัติ” เพื่อถอดเสียงเป็น clips · หรือลากเสียงจากคลังมาวาง
          </div>
        ) : (
          <div className="p-4 space-y-2.5">
            {clips.map((c, i) => (
              <div
                key={c.id}
                onClick={() => selectProjectVariant(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragId.current && dragId.current !== c.id) moveClip(dragId.current, i); dragId.current = null; }}
                className={`rounded-xl border p-3 space-y-2.5 transition ${
                  c.id === selectedClipId ? "border-lime/60 bg-panel/60" : "border-line bg-panel/40 hover:border-white/15"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span
                    draggable
                    onDragStart={(e) => { dragId.current = c.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); }}
                    onClick={(e) => e.stopPropagation()}
                    className="grid place-items-center w-5 h-8 text-ink-faint/60 hover:text-ink cursor-grab active:cursor-grabbing shrink-0"
                    title="ลากเพื่อสลับตำแหน่ง"
                  >
                    <GripVertical size={14} />
                  </span>
                  <span className="text-[11px] font-mono text-ink-faint w-6 shrink-0">{String(i + 1).padStart(2, "0")}</span>
                  <input
                    value={c.name}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={() => pushHistory()}
                    onChange={(e) => updateClipSilent(c.id, { name: e.target.value })}
                    placeholder="(ตั้งชื่อ clip)"
                    className="flex-1 min-w-0 text-sm text-ink bg-transparent outline-none border-b border-transparent focus:border-lime/40 transition"
                  />
                  <span className="text-[11px] font-mono text-ink-faint shrink-0">
                    {fmt(c.start)}–{fmt(c.end)} · {(c.end - c.start).toFixed(2)}s
                  </span>
                  <div className="w-40 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <EventPicker value={c.event} onChange={(ev) => updateClip(c.id, { event: ev })} />
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeClip(c.id); }}
                    className="grid place-items-center w-8 h-8 rounded-lg text-ink-faint hover:text-bad shrink-0" title="ลบ clip">
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="rounded-lg border border-line/60 bg-black/25 p-1.5" onClick={(e) => e.stopPropagation()}>
                  <ClipWaveform
                    wavPath={clipSrc(c)}
                    duration={clipDur(c)}
                    clip={c}
                    accent={accentFor(c.event)}
                    mode={tool}
                    zoom={zoom}
                    playhead={playheadId === c.id ? playheadT : undefined}
                    onChange={(s, e) => updateClipSilent(c.id, { start: s, end: e })}
                    onCommitStart={pushHistory}
                    onSplit={(t) => splitClip(c.id, t)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* drag to resize the deck */}
      <div onPointerDown={startResize}
        className="shrink-0 h-2.5 cursor-row-resize bg-line/40 hover:bg-lime/50 transition flex items-center justify-center group"
        title="ลากปรับขนาด deck">
        <div className="w-10 h-0.5 rounded-full bg-white/20 group-hover:bg-white/50" />
      </div>

      <MasteringPanel tool={tool} setTool={setTool} height={deckH} />

      {showSave && <SaveToLibDialog onClose={() => setShowSave(false)} />}
    </div>
  );
}
