import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  MousePointer2, Scissors, MoveHorizontal, Expand,
  Play, Pause, SkipBack, SkipForward,
  Plus, Trash2, Copy, AudioLines, Upload,
} from "lucide-react";
import {
  useStudioStore, genId,
  type EditorTool, type TrackItem,
} from "../store/useStudioStore";
import Knob from "./Knob";
import { runAutoSplit } from "../lib/actions";

const TRACK_H = 56;
const HEADER_W = 140;
const RULER_H = 24;

const TOOLS: { id: EditorTool; icon: typeof MousePointer2; label: string; key: string }[] = [
  { id: "select", icon: MousePointer2, label: "Select", key: "V" },
  { id: "cut", icon: Scissors, label: "Cut", key: "C" },
  { id: "trim", icon: MoveHorizontal, label: "Trim", key: "T" },
  { id: "stretch", icon: Expand, label: "Stretch", key: "S" },
];

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) return "00:00:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const f = Math.floor((t % 1) * 100);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}:${f.toString().padStart(2, "0")}`;
}

function fmtShort(t: number): string {
  if (!isFinite(t) || t < 0) return "00:00";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ============================================================
// MAIN COMPONENT
// ============================================================
export default function AudioEditor() {
  const {
    editorTool, setEditorTool,
    trackItems, trackCount,
    selectedItemId, timelineZoom, playheadPos,
    addTrackItem, updateTrackItem, removeTrackItem,
    selectItem, setTimelineZoom, setPlayheadPos, setTrackCount,
    libraryRoot, masterVolume, setMasterVolume,
    sourcePath, wavPath, duration, clips, transcribing,
  } = useStudioStore();

  const [playing, setPlaying] = useState(false);
  const [splitMsg, setSplitMsg] = useState("");
  const [dragOverTrack, setDragOverTrack] = useState<number | null>(null);
  const [effectsTab, setEffectsTab] = useState<"mix" | "eq" | "comp">("mix");
  const [waveformData, setWaveformData] = useState<Float32Array | null>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioSourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());

  const selectedItem = trackItems.find((i) => i.id === selectedItemId);

  // load waveform data for selected item
  useEffect(() => {
    if (!selectedItem) { setWaveformData(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const absPath = `${libraryRoot}/${selectedItem.filePath}`.replace(/\//g, "\\");
        const buf: ArrayBuffer = await invoke("read_audio_bytes", { path: absPath });
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const audioBuf = await audioCtxRef.current.decodeAudioData(buf.slice(0));
        if (cancelled) return;
        setWaveformData(audioBuf.getChannelData(0));
      } catch { setWaveformData(null); }
    })();
    return () => { cancelled = true; };
  }, [selectedItemId]);

  // keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const k = e.key.toUpperCase();
      const tool = TOOLS.find((t) => t.key === k);
      if (tool) { setEditorTool(tool.id); return; }
      if (k === "DELETE" || k === "BACKSPACE") { if (selectedItemId) removeTrackItem(selectedItemId); }
      if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedItemId, playing]);

  const maxTime = Math.max(60, ...trackItems.map((i) => i.offset + i.duration / i.speed + 5));
  const totalDuration = Math.max(0, ...trackItems.map((i) => i.offset + i.duration / i.speed));
  const timelineW = maxTime * timelineZoom;
  const totalW = HEADER_W + timelineW;

  const togglePlay = useCallback(() => {
    if (playing) stopPlayback(); else startPlayback();
  }, [playing, playheadPos, trackItems]);

  function startPlayback() {
    setPlaying(true);
    const startWall = performance.now();
    const startPos = playheadPos;
    playIntervalRef.current = window.setInterval(() => {
      setPlayheadPos(startPos + (performance.now() - startWall) / 1000);
    }, 50);
    playAudioItems(startPos);
  }

  function stopPlayback() {
    setPlaying(false);
    if (playIntervalRef.current) { clearInterval(playIntervalRef.current); playIntervalRef.current = null; }
    audioSourcesRef.current.forEach((s) => { try { s.stop(); } catch {} });
    audioSourcesRef.current.clear();
  }

  async function playAudioItems(fromPos: number) {
    if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
    const ctx = audioCtxRef.current;
    for (const item of trackItems) {
      const itemEnd = item.offset + item.duration / item.speed;
      if (itemEnd <= fromPos) continue;
      try {
        const absPath = `${libraryRoot}/${item.filePath}`.replace(/\//g, "\\");
        const buf: ArrayBuffer = await invoke("read_audio_bytes", { path: absPath });
        const audioBuf = await ctx.decodeAudioData(buf.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuf;
        source.playbackRate.value = item.speed;
        const gain = ctx.createGain();
        gain.gain.value = item.volume * masterVolume;
        source.connect(gain).connect(ctx.destination);
        const offsetInItem = Math.max(0, fromPos - item.offset) * item.speed;
        const delay = Math.max(0, item.offset - fromPos);
        source.start(ctx.currentTime + delay, offsetInItem);
        audioSourcesRef.current.set(item.id, source);
      } catch {}
    }
  }

  function handleStop() { stopPlayback(); setPlayheadPos(0); }

  function handleRulerClick(e: React.MouseEvent) {
    const rect = e.currentTarget.getBoundingClientRect();
    setPlayheadPos(Math.max(0, (e.clientX - rect.left) / timelineZoom));
  }

  function handleTrackDrop(trackIdx: number, e: React.DragEvent) {
    e.preventDefault();
    setDragOverTrack(null);
    const filePath = e.dataTransfer.getData("application/x-library-sound");
    const soundName = e.dataTransfer.getData("text/plain");
    if (!filePath) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const offset = Math.max(0, x / timelineZoom);
    const newId = genId();
    addTrackItem({
      id: newId, trackIdx, offset, duration: 3,
      name: soundName || filePath.split("/").pop() || "sound",
      filePath, volume: 1, speed: 1, fadeIn: 0, fadeOut: 0, color: "",
      reverb: 0, delay: 0, noise: 0, bass: 0, mid: 0, treble: 0,
      pitch: 0, normalize: false, compRatio: 4, compAttack: 0.01,
      compRelease: 0.1, makeup: 0,
    });
    (async () => {
      try {
        const absPath = `${libraryRoot}/${filePath}`.replace(/\//g, "\\");
        const buf: ArrayBuffer = await invoke("read_audio_bytes", { path: absPath });
        if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
        const audioBuf = await audioCtxRef.current.decodeAudioData(buf.slice(0));
        updateTrackItem(newId, { duration: audioBuf.duration });
      } catch {}
    })();
  }

  function handleTrackDragOver(trackIdx: number, e: React.DragEvent) {
    if (e.dataTransfer.types.includes("application/x-library-sound")) {
      e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDragOverTrack(trackIdx);
    }
  }

  function handleItemMouseDown(item: TrackItem, e: React.MouseEvent) {
    e.stopPropagation(); selectItem(item.id);
    if (editorTool !== "select") return;
    const startX = e.clientX; const startOffset = item.offset;
    function onMove(ev: MouseEvent) { updateTrackItem(item.id, { offset: Math.max(0, startOffset + (ev.clientX - startX) / timelineZoom) }); }
    function onUp() { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }

  function handleTrimStart(item: TrackItem, e: React.MouseEvent) {
    e.stopPropagation(); selectItem(item.id);
    const startX = e.clientX; const origOffset = item.offset; const origDur = item.duration;
    function onMove(ev: MouseEvent) {
      const dt = (ev.clientX - startX) / timelineZoom;
      const newOff = Math.max(0, origOffset + dt);
      updateTrackItem(item.id, { offset: newOff, duration: Math.max(0.1, origDur - (newOff - origOffset)) });
    }
    function onUp() { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }

  function handleTrimEnd(item: TrackItem, e: React.MouseEvent) {
    e.stopPropagation(); selectItem(item.id);
    const startX = e.clientX; const origDur = item.duration;
    function onMove(ev: MouseEvent) { updateTrackItem(item.id, { duration: Math.max(0.1, origDur + (ev.clientX - startX) / timelineZoom) }); }
    function onUp() { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }

  function handleCutClick(item: TrackItem, e: React.MouseEvent) {
    if (editorTool !== "cut") return;
    e.stopPropagation();
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const clickTime = x / timelineZoom;
    if (clickTime <= 0.05 || clickTime >= item.duration / item.speed - 0.05) return;
    const leftDur = clickTime * item.speed;
    updateTrackItem(item.id, { duration: leftDur });
    addTrackItem({
      ...item, id: genId(), offset: item.offset + clickTime,
      duration: item.duration - leftDur, name: `${item.name} (R)`,
      fadeIn: 0, color: "",
    });
  }

  function handleStretchMouseDown(item: TrackItem, e: React.MouseEvent) {
    if (editorTool !== "stretch") return;
    e.stopPropagation(); selectItem(item.id);
    const startX = e.clientX; const origW = (item.duration / item.speed) * timelineZoom;
    function onMove(ev: MouseEvent) { const newW = Math.max(20, origW + ev.clientX - startX); updateTrackItem(item.id, { speed: Math.max(0.25, Math.min(4, item.duration / (newW / timelineZoom))) }); }
    function onUp() { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); }
    window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
  }

  function handleDuplicate() {
    const sel = trackItems.find((i) => i.id === selectedItemId);
    if (!sel) return;
    addTrackItem({ ...sel, id: genId(), offset: sel.offset + sel.duration / sel.speed + 0.2, color: "" });
  }

  const ticks: number[] = [];
  const tickStep = timelineZoom >= 100 ? 1 : timelineZoom >= 40 ? 5 : 10;
  for (let t = 0; t <= maxTime; t += tickStep) ticks.push(t);

  // ---- EMPTY STATE ----
  if (trackItems.length === 0) {
    return (
      <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 relative grid place-items-center">
          <div className="absolute inset-0 bg-[#0a0a0a] pointer-events-none">
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(224,255,0,0.02)_0%,transparent_70%)]" />
            <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.1) 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
          </div>
          <div className="relative z-10 flex flex-col items-center gap-4 text-center max-w-md px-6">
            <div className="grid place-items-center w-16 h-16 rounded-2xl bg-white/[0.04] border border-white/10 backdrop-blur-md text-lime"><AudioLines size={30} /></div>
            {wavPath ? (
              <>
                <div>
                  <div className="text-base font-semibold truncate max-w-xs">{sourcePath?.split(/[\\/]/).pop()}</div>
                  <div className="text-sm text-ink-muted mt-1">{fmtShort(duration)} · {clips.length} clips</div>
                </div>
                <button
                  onClick={async () => { setSplitMsg(""); setSplitMsg(await runAutoSplit()); }}
                  disabled={transcribing}
                  className="px-6 h-11 rounded-full bg-lime text-black text-sm font-bold hover:bg-lime/90 transition disabled:opacity-50"
                >
                  {transcribing ? "กำลังถอดเสียง…" : clips.length ? "แยกอัตโนมัติอีกครั้ง" : "แยกอัตโนมัติ (ถอดเสียง → clips)"}
                </button>
                {clips.length > 0 && (
                  <div className="text-xs text-ink-faint">แยกได้ {clips.length} clips ✅ — map event ที่ panel “Clips” (ขวา) แล้วไปแท็บ “ทดสอบ”</div>
                )}
                {splitMsg && <div className="text-xs text-ink-muted whitespace-pre-line">{splitMsg}</div>}
              </>
            ) : (
              <>
                <div>
                  <div className="text-base font-semibold">Audio Editor</div>
                  <div className="text-sm text-ink-muted mt-1">นำเข้าไฟล์เสียง/วิดีโอ แล้วแยกอัตโนมัติ</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-ink-faint mt-1">
                  <Upload size={14} /><span>กด “นำเข้าไฟล์” มุมขวาบน</span>
                </div>
              </>
            )}
          </div>
        </div>
        {renderTimeline()}
      </div>
    );
  }

  // ---- FULL EDITOR ----
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* === WAVEFORM DISPLAY === */}
      <div className="shrink-0 bg-[#0e0e12] border-b border-line/30" style={{ height: 180 }}>
        <div className="h-full flex">
          {/* Waveform canvas area */}
          <div className="flex-1 relative overflow-hidden">
            {waveformData ? (
              <WaveformCanvas data={waveformData} color={selectedItem?.color || "#7c6cff"} playheadRatio={selectedItem ? (playheadPos - selectedItem.offset) / (selectedItem.duration / selectedItem.speed) : -1} />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-ink-faint text-xs">
                เลือก clip เพื่อแสดง waveform
              </div>
            )}
            {/* time markers at bottom */}
            {selectedItem && (
              <div className="absolute bottom-0 left-0 right-0 h-5 flex items-center px-2 bg-gradient-to-t from-black/40">
                {Array.from({ length: 7 }).map((_, i) => {
                  const t = (selectedItem.duration / selectedItem.speed / 6) * i;
                  return <span key={i} className="flex-1 text-[8px] font-mono text-ink-faint/50">{fmt(t)}</span>;
                })}
              </div>
            )}
          </div>
          {/* dB scale */}
          <div className="w-10 shrink-0 flex flex-col justify-between py-2 pr-2 text-right">
            <span className="text-[8px] font-mono text-ink-faint">+20</span>
            <span className="text-[8px] font-mono text-ink-faint">+10</span>
            <span className="text-[8px] font-mono text-ink-faint">0</span>
            <span className="text-[8px] font-mono text-ink-faint">-10</span>
            <span className="text-[8px] font-mono text-ink-faint">-20</span>
          </div>
        </div>
      </div>

      {/* === MINI OVERVIEW === */}
      <MiniOverview trackItems={trackItems} totalDuration={totalDuration} playheadPos={playheadPos} selectedItem={selectedItem} />

      {/* === EFFECTS RACK === */}
      {selectedItem && (
        <div className="shrink-0 border-b border-line/30 bg-[#111114]">
          {/* Tabs */}
          <div className="flex items-center gap-0.5 px-4 pt-2">
            {(["mix", "eq", "comp"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setEffectsTab(tab)}
                className={`px-3 py-1.5 rounded-t-lg text-[10px] font-medium transition border border-b-0 ${
                  effectsTab === tab
                    ? "bg-[#1a1a1e] border-line/30 text-ink"
                    : "bg-transparent border-transparent text-ink-faint hover:text-ink"
                }`}
              >
                {tab === "mix" ? "Mix & FX" : tab === "eq" ? "EQ" : "Compressor"}
              </button>
            ))}
            <div className="flex-1" />
            {selectedItem && (
              <span className="text-[10px] text-ink-faint font-mono">{selectedItem.name}</span>
            )}
          </div>

          {/* Tab content */}
          <div className="px-4 py-4 bg-[#1a1a1e] border-t border-line/30">
            {effectsTab === "mix" && (
              <div className="flex items-start gap-6">
                <Knob value={selectedItem.delay} min={0} max={1} label="Delay" color="#ff6b35" format={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => updateTrackItem(selectedItem.id, { delay: v })} />
                <Knob value={selectedItem.noise} min={0} max={1} label="Noise" color="#ff6b35" format={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => updateTrackItem(selectedItem.id, { noise: v })} />
                <Knob value={selectedItem.reverb} min={0} max={1} label="Reverb" color="#ff6b35" format={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => updateTrackItem(selectedItem.id, { reverb: v })} />
                <div className="w-px h-16 bg-line/20 self-center" />
                <Knob value={masterVolume} min={0} max={2} label="Master Volume" size="lg" color="#ff6b35" format={(v) => `${(v * 100).toFixed(0)}%`} onChange={setMasterVolume} />
                <div className="w-px h-16 bg-line/20 self-center" />
                <Knob value={selectedItem.volume} min={0} max={2} label="Volume" format={(v) => `${(v * 100).toFixed(0)}%`} onChange={(v) => updateTrackItem(selectedItem.id, { volume: v })} />
                <Knob value={selectedItem.speed} min={0.25} max={4} label="Speed" format={(v) => `${v.toFixed(2)}x`} onChange={(v) => updateTrackItem(selectedItem.id, { speed: v })} />
                <Knob value={selectedItem.pitch} min={-12} max={12} label="Pitch" format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(0)}st`} onChange={(v) => updateTrackItem(selectedItem.id, { pitch: v })} />
                <div className="w-px h-16 bg-line/20 self-center" />
                {/* Fades */}
                <div className="flex flex-col gap-2 self-center">
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-ink-faint w-12">Fade In</span>
                    <input type="number" min={0} max={5} step={0.1} value={selectedItem.fadeIn} onChange={(e) => updateTrackItem(selectedItem.id, { fadeIn: parseFloat(e.target.value) || 0 })} className="w-14 h-5 px-1 rounded bg-black/40 border border-line text-ink text-center font-mono text-[9px]" />
                    <span className="text-[9px] text-ink-faint">s</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-ink-faint w-12">Fade Out</span>
                    <input type="number" min={0} max={5} step={0.1} value={selectedItem.fadeOut} onChange={(e) => updateTrackItem(selectedItem.id, { fadeOut: parseFloat(e.target.value) || 0 })} className="w-14 h-5 px-1 rounded bg-black/40 border border-line text-ink text-center font-mono text-[9px]" />
                    <span className="text-[9px] text-ink-faint">s</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-ink-faint text-[10px] w-12">Normalize</span>
                    <button
                      onClick={() => updateTrackItem(selectedItem.id, { normalize: !selectedItem.normalize })}
                      className={`w-7 h-[14px] rounded-full transition-colors ${selectedItem.normalize ? "bg-lime" : "bg-white/10"}`}
                    >
                      <div className={`w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${selectedItem.normalize ? "translate-x-[14px]" : "translate-x-[2px]"}`} />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {effectsTab === "eq" && (
              <div className="flex items-start gap-6">
                <Knob value={selectedItem.bass} min={-10} max={10} label="Bass" color="#ff3366" format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`} onChange={(v) => updateTrackItem(selectedItem.id, { bass: v })} />
                <Knob value={selectedItem.mid} min={-10} max={10} label="Middle" color="#ff9933" format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`} onChange={(v) => updateTrackItem(selectedItem.id, { mid: v })} />
                <Knob value={selectedItem.treble} min={-10} max={10} label="Treble" color="#33ccff" format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`} onChange={(v) => updateTrackItem(selectedItem.id, { treble: v })} />
                <div className="w-px h-16 bg-line/20 self-center" />
                <EQCurve bass={selectedItem.bass} mid={selectedItem.mid} treble={selectedItem.treble} />
              </div>
            )}

            {effectsTab === "comp" && (
              <div className="flex items-start gap-6">
                <Knob value={selectedItem.compRatio} min={1} max={20} label="Ratio" format={(v) => `${v.toFixed(1)}:1`} onChange={(v) => updateTrackItem(selectedItem.id, { compRatio: v })} />
                <Knob value={selectedItem.compAttack} min={0.001} max={0.5} label="Attack" format={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => updateTrackItem(selectedItem.id, { compAttack: v })} />
                <Knob value={selectedItem.compRelease} min={0.01} max={1} label="Release" format={(v) => `${(v * 1000).toFixed(0)}ms`} onChange={(v) => updateTrackItem(selectedItem.id, { compRelease: v })} />
                <div className="w-px h-16 bg-line/20 self-center" />
                <Knob value={selectedItem.makeup} min={0} max={24} label="Makeup" size="lg" color="#ff6b35" format={(v) => `+${v.toFixed(1)}dB`} onChange={(v) => updateTrackItem(selectedItem.id, { makeup: v })} />
                <div className="w-px h-16 bg-line/20 self-center" />
                <CompressorViz ratio={selectedItem.compRatio} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* === TIMELINE === */}
      {renderTimeline()}
    </div>
  );

  // ---- Timeline render (shared between empty & full) ----
  function renderTimeline() {
    return (
      <div className="shrink-0 border-t border-line bg-base flex-1 min-h-[160px] flex flex-col">
        {/* Toolbar */}
        <div className="flex items-center gap-1.5 px-3 h-10 border-b border-line/50 shrink-0">
          {/* Tools */}
          <div className="flex items-center bg-panel rounded-lg border border-line p-0.5 gap-0.5">
            {TOOLS.map((t) => {
              const Icon = t.icon;
              const active = editorTool === t.id;
              return (
                <button key={t.id} onClick={() => setEditorTool(t.id)} className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition ${active ? "bg-lime/15 text-lime" : "text-ink-faint hover:text-ink"}`} title={`${t.label} (${t.key})`}>
                  <Icon size={12} />{t.label}
                </button>
              );
            })}
          </div>

          <div className="w-px h-5 bg-line/30 mx-1" />

          {/* Transport */}
          <button onClick={handleStop} className="grid place-items-center w-7 h-7 rounded-lg text-ink-faint hover:text-ink hover:bg-panel-hover transition"><SkipBack size={14} /></button>
          <button onClick={togglePlay} className="grid place-items-center w-9 h-9 rounded-full bg-lime text-black hover:bg-lime-dim transition">
            {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
          </button>
          <button className="grid place-items-center w-7 h-7 rounded-lg text-ink-faint hover:text-ink hover:bg-panel-hover transition"><SkipForward size={14} /></button>

          <div className="w-px h-5 bg-line/30 mx-1" />

          <span className="font-mono text-sm text-ink tabular-nums">{fmt(playheadPos)}</span>

          <div className="flex-1" />

          <span className="font-mono text-[11px] text-ink-faint tabular-nums">{fmt(totalDuration)}</span>

          <div className="w-px h-5 bg-line/30 mx-1" />

          {/* Zoom */}
          <div className="flex items-center gap-1">
            <button onClick={() => setTimelineZoom(Math.max(10, timelineZoom - 15))} className="grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-ink transition"><span className="text-xs font-bold">−</span></button>
            <input type="range" min={10} max={200} value={timelineZoom} onChange={(e) => setTimelineZoom(parseInt(e.target.value))} className="w-20" />
            <button onClick={() => setTimelineZoom(Math.min(300, timelineZoom + 15))} className="grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-ink transition"><span className="text-xs font-bold">+</span></button>
          </div>

          {selectedItem && (
            <>
              <div className="w-px h-5 bg-line/30 mx-1" />
              <button onClick={handleDuplicate} className="grid place-items-center w-7 h-7 rounded-lg text-ink-faint hover:text-ink hover:bg-panel-hover transition" title="Duplicate"><Copy size={13} /></button>
              <button onClick={() => selectedItemId && removeTrackItem(selectedItemId)} className="grid place-items-center w-7 h-7 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition" title="Delete"><Trash2 size={13} /></button>
            </>
          )}
        </div>

        {/* Scrollable tracks */}
        <div ref={timelineRef} className="relative overflow-x-auto overflow-y-auto flex-1">
          {/* Ruler */}
          <div className="sticky top-0 z-20 flex" style={{ width: totalW }}>
            <div className="shrink-0 bg-base border-r border-line/30 flex items-center px-2" style={{ width: HEADER_W, height: RULER_H }}>
              <span className="text-[9px] font-semibold text-ink-faint">Fixed Material</span>
              <button onClick={() => setTrackCount(trackCount + 1)} className="ml-auto grid place-items-center w-4 h-4 rounded text-ink-faint hover:text-lime transition"><Plus size={10} /></button>
            </div>
            <div className="relative bg-base/90 cursor-pointer" style={{ width: timelineW, height: RULER_H }} onClick={handleRulerClick}>
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 bottom-0 border-l border-line/20" style={{ left: t * timelineZoom }}>
                  <span className="absolute top-1 left-1.5 text-[8px] font-mono text-ink-faint select-none">{fmtShort(t)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Track rows */}
          {Array.from({ length: trackCount }).map((_, ti) => {
            const items = trackItems.filter((i) => i.trackIdx === ti);
            const isOver = dragOverTrack === ti;
            const hue = [260, 30, 350, 180, 90][ti % 5];
            const trackColor = `hsl(${hue}, 50%, 45%)`;
            const firstName = items[0]?.name || `Track ${ti + 1}`;
            return (
              <div key={ti} className="flex" style={{ height: TRACK_H, width: totalW }}>
                {/* Track header */}
                <div className="shrink-0 flex items-center gap-2 px-2 border-r border-line/30 border-b border-b-line/10 bg-[#111114]" style={{ width: HEADER_W }}>
                  {/* Mini album art */}
                  <div className="w-8 h-8 rounded-md shrink-0 flex items-center justify-center" style={{ background: `linear-gradient(135deg, ${trackColor}40, ${trackColor}20)` }}>
                    <AudioLines size={14} style={{ color: trackColor }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] font-medium text-ink truncate">{firstName}</div>
                  </div>
                  {items.length > 0 && (
                    <button onClick={() => items.forEach((i) => removeTrackItem(i.id))} className="grid place-items-center w-5 h-5 rounded text-ink-faint/30 hover:text-danger transition shrink-0">
                      <Trash2 size={10} />
                    </button>
                  )}
                </div>
                {/* Track lane */}
                <div
                  className={`relative border-b border-line/10 transition ${isOver ? "bg-lime/[0.06]" : ""}`}
                  style={{ width: timelineW }}
                  onDragOver={(e) => handleTrackDragOver(ti, e)}
                  onDragLeave={() => setDragOverTrack(null)}
                  onDrop={(e) => handleTrackDrop(ti, e)}
                  onClick={() => selectItem(null)}
                >
                  {/* Grid dots */}
                  {ticks.map((t) => (
                    <div key={t} className="absolute top-0 bottom-0" style={{ left: t * timelineZoom }}>
                      {Array.from({ length: 5 }).map((_, di) => (
                        <div key={di} className="absolute w-[1px] h-[1px] rounded-full bg-white/10" style={{ top: `${20 + di * 15}%` }} />
                      ))}
                    </div>
                  ))}

                  {items.map((item) => {
                    const w = Math.max(8, (item.duration / item.speed) * timelineZoom);
                    const sel = item.id === selectedItemId;
                    return (
                      <div
                        key={item.id}
                        className={`absolute top-1 bottom-1 rounded-md overflow-hidden transition-shadow group ${
                          sel ? "ring-2 ring-lime shadow-glow z-10" : "ring-1 ring-white/10 hover:ring-white/20"
                        }`}
                        style={{ left: item.offset * timelineZoom, width: w, background: `linear-gradient(180deg, ${item.color}40 0%, ${item.color}15 100%)` }}
                        onMouseDown={(e) => {
                          if (editorTool === "select") handleItemMouseDown(item, e);
                          else if (editorTool === "stretch") handleStretchMouseDown(item, e);
                          else { e.stopPropagation(); selectItem(item.id); }
                        }}
                        onClick={(e) => { if (editorTool === "cut") handleCutClick(item, e); }}
                      >
                        <div className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-lime/50 z-10" onMouseDown={(e) => handleTrimStart(item, e)} />
                        <div className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-lime/50 z-10" onMouseDown={(e) => handleTrimEnd(item, e)} />
                        <div className="absolute inset-0 flex items-center px-1 opacity-60"><InlineWaveform width={w} color={item.color} /></div>
                        <div className="relative z-[5] px-1.5 py-0.5 pointer-events-none"><div className="text-[9px] font-medium text-ink truncate">{item.name}</div></div>
                        {item.fadeIn > 0 && <div className="absolute left-0 top-0 bottom-0 pointer-events-none" style={{ width: item.fadeIn * timelineZoom, background: "linear-gradient(90deg, #0d0d0d, transparent)" }} />}
                        {item.fadeOut > 0 && <div className="absolute right-0 top-0 bottom-0 pointer-events-none" style={{ width: item.fadeOut * timelineZoom, background: "linear-gradient(-90deg, #0d0d0d, transparent)" }} />}
                      </div>
                    );
                  })}

                  {isOver && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="text-[10px] text-lime/60 font-medium">วางที่นี่</span></div>}
                </div>
              </div>
            );
          })}

          {/* Playhead */}
          <div className="absolute z-30 pointer-events-none" style={{ left: HEADER_W + playheadPos * timelineZoom, top: 0, bottom: 0, width: 2 }}>
            <div className="absolute inset-0" style={{ background: "#ff4444", boxShadow: "0 0 8px rgba(255,68,68,0.5)" }} />
            <div className="absolute -top-0.5 -left-[3px] w-2 h-2 bg-[#ff4444] border border-black" style={{ clipPath: "polygon(50% 100%, 0 0, 100% 0)" }} />
          </div>
        </div>
      </div>
    );
  }
}

// ============================================================
// WAVEFORM CANVAS
// ============================================================
function WaveformCanvas({ data, color, playheadRatio }: { data: Float32Array; color: string; playheadRatio: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const step = Math.ceil(data.length / w);
    const mid = h / 2;

    // draw waveform
    for (let i = 0; i < w; i++) {
      let minVal = 1, maxVal = -1;
      for (let j = 0; j < step; j++) {
        const idx = i * step + j;
        if (idx < data.length) {
          const val = data[idx];
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }
      const top = (1 - maxVal) * mid;
      const bottom = (1 - minVal) * mid;

      // before playhead = bright, after = dim
      const ratio = i / w;
      if (playheadRatio >= 0 && ratio > playheadRatio) {
        ctx.fillStyle = "rgba(120,120,120,0.5)";
      } else {
        ctx.fillStyle = color;
      }
      ctx.fillRect(i, top, 1, Math.max(1, bottom - top));
    }

    // playhead line
    if (playheadRatio >= 0 && playheadRatio <= 1) {
      const px = playheadRatio * w;
      ctx.fillStyle = "#ff4444";
      ctx.fillRect(px - 1, 0, 2, h);
    }
  }, [data, color, playheadRatio]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
}

// ============================================================
// MINI OVERVIEW
// ============================================================
function MiniOverview({ trackItems, totalDuration, playheadPos, selectedItem }: {
  trackItems: TrackItem[]; totalDuration: number; playheadPos: number; selectedItem: TrackItem | undefined;
}) {
  if (totalDuration <= 0) return null;
  return (
    <div className="shrink-0 h-8 bg-[#111114] border-b border-line/30 px-2 flex items-center gap-2">
      {/* Overview waveform */}
      <div className="flex-1 h-5 relative rounded-sm overflow-hidden bg-black/30">
        {trackItems.map((item) => {
          const left = (item.offset / totalDuration) * 100;
          const width = ((item.duration / item.speed) / totalDuration) * 100;
          return (
            <div
              key={item.id}
              className="absolute top-0 bottom-0 flex items-center"
              style={{ left: `${left}%`, width: `${width}%` }}
            >
              <InlineWaveform width={80} color={item.color} />
            </div>
          );
        })}
        {/* Playhead */}
        <div className="absolute top-0 bottom-0 w-[2px] bg-[#ff4444] z-10" style={{ left: `${(playheadPos / totalDuration) * 100}%` }} />
        {/* Viewport indicator */}
        {selectedItem && (
          <div
            className="absolute top-0 bottom-0 border border-white/20 bg-white/[0.03]"
            style={{
              left: `${(selectedItem.offset / totalDuration) * 100}%`,
              width: `${((selectedItem.duration / selectedItem.speed) / totalDuration) * 100}%`,
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// EQ CURVE
// ============================================================
function EQCurve({ bass, mid, treble }: { bass: number; mid: number; treble: number }) {
  const w = 280, h = 100;
  const bN = bass / 10, mN = mid / 10, tN = treble / 10;

  const points = [
    { x: 0, y: 50 - bN * 35 },
    { x: w * 0.15, y: 50 - bN * 40 },
    { x: w * 0.35, y: 50 - (bN * 15 + mN * 20) },
    { x: w * 0.5, y: 50 - mN * 40 },
    { x: w * 0.65, y: 50 - (mN * 15 + tN * 20) },
    { x: w * 0.85, y: 50 - tN * 40 },
    { x: w, y: 50 - tN * 35 },
  ];

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cpx = (prev.x + curr.x) / 2;
    path += ` C ${cpx} ${prev.y}, ${cpx} ${curr.y}, ${curr.x} ${curr.y}`;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-[10px] font-medium text-ink-faint">EQ Curve</span>
        <div className="flex gap-2">
          <span className="text-[8px] font-mono text-ink-faint">12 dB</span>
          <span className="text-[8px] font-mono text-ink-faint">0 dB</span>
          <span className="text-[8px] font-mono text-ink-faint">-12 dB</span>
        </div>
      </div>
      <svg width={w} height={h} className="bg-black/30 rounded-lg border border-line/20">
        {/* Grid */}
        <line x1={0} y1={25} x2={w} y2={25} stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />
        <line x1={0} y1={50} x2={w} y2={50} stroke="rgba(255,255,255,0.08)" />
        <line x1={0} y1={75} x2={w} y2={75} stroke="rgba(255,255,255,0.05)" strokeDasharray="4" />
        {/* Curve */}
        <path d={path} fill="none" stroke="#e0ff00" strokeWidth="2" opacity={0.8} />
        <path d={`${path} L ${w} ${h} L 0 ${h} Z`} fill="#e0ff00" opacity={0.05} />
        {/* Control points */}
        {[points[1], points[3], points[5]].map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="none" stroke={["#ff3366", "#ff9933", "#33ccff"][i]} strokeWidth="1.5" />
        ))}
      </svg>
    </div>
  );
}

// ============================================================
// COMPRESSOR VISUALIZATION
// ============================================================
function CompressorViz({ ratio }: { ratio: number }) {
  const w = 140, h = 100;
  const threshold = 0.5;
  const threshX = threshold * w;
  const threshY = (1 - threshold) * h;
  const slope = 1 / ratio;
  const endY = threshY - (w - threshX) * slope * (h / w);

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-medium text-ink-faint">Transfer Curve</span>
      <svg width={w} height={h} className="bg-black/30 rounded-lg border border-line/20">
        <line x1={0} y1={h} x2={w} y2={0} stroke="rgba(255,255,255,0.06)" strokeDasharray="4" />
        <line x1={threshX} y1={0} x2={threshX} y2={h} stroke="rgba(255,255,255,0.1)" strokeDasharray="2" />
        {/* 1:1 line up to threshold */}
        <line x1={0} y1={h} x2={threshX} y2={threshY} stroke="#e0ff00" strokeWidth="2" />
        {/* compressed line after threshold */}
        <line x1={threshX} y1={threshY} x2={w} y2={Math.max(0, endY)} stroke="#ff6b35" strokeWidth="2" />
        <circle cx={threshX} cy={threshY} r="3" fill="#e0ff00" />
        <text x={threshX + 4} y={threshY - 6} fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace">-{((1 - threshold) * 40).toFixed(0)}dB</text>
      </svg>
    </div>
  );
}

// ============================================================
// INLINE WAVEFORM (for tracks & overview)
// ============================================================
function InlineWaveform({ width, color }: { width: number; color: string }) {
  const barCount = Math.max(4, Math.floor(width / 3));
  return (
    <div className="flex items-center gap-px h-full" style={{ width }}>
      {Array.from({ length: barCount }).map((_, i) => {
        const h = 20 + Math.sin(i * 0.7) * 30 + Math.cos(i * 1.3) * 25 + Math.sin(i * 2.1) * 12;
        return (
          <div key={i} className="shrink-0 rounded-sm" style={{
            width: 2,
            height: `${Math.max(10, Math.min(90, h))}%`,
            background: color || "#e0ff00",
            opacity: 0.6,
          }} />
        );
      })}
    </div>
  );
}
