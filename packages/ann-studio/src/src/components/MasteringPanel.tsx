// Mastering deck — the control hub for the SELECTED clip: transport + tools +
// tuning. Transport previews through Web Audio with EQ/presence/compressor/gain
// APPLIED, so the knobs are audible live (de-esser/character/saturation are
// export-only). The knob grid writes clip.master (wired to ffmpeg on export).

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Square, MousePointer2, Scissors, Undo2, Redo2 } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";
import { audioCtx, loadAudioBuffer, knobDb } from "../lib/audio";
import Knob from "./Knob";
import LedDisplay from "./LedDisplay";
import MeterPanel from "./MeterPanel";

const PRESETS = ["Warm", "Balanced", "Open"];

const MOCK_GROUPS: { title: string; knobs: [string, string][] }[] = [
  { title: "Equalizer", knobs: [["eqLow", "Low"], ["eqMid", "Mid"], ["eqHigh", "High"]] },
  { title: "Presence", knobs: [["presence", "Amount"]] },
  { title: "De-Esser", knobs: [["deEsserAmt", "Amount"], ["deEsserFreq", "Freq"]] },
  { title: "Dynamics", knobs: [["compression", "Comp"], ["character", "Character"], ["saturation", "Sat"]] },
];

// BS.1770 loudness from a mean-square (single K-weighted channel).
const lufsFromMs = (ms: number) => (ms > 1e-10 ? -0.691 + 10 * Math.log10(ms) : -70);


export default function MasteringPanel({ tool, setTool, height }: {
  tool: "select" | "split";
  setTool: (t: "select" | "split") => void;
  height: number;
}) {
  const clips = useStudioStore((s) => s.clips);
  const selectedId = useStudioStore((s) => s.selectedClipId);
  const wavPath = useStudioStore((s) => s.wavPath);
  const updateClip = useStudioStore((s) => s.updateClip);
  const updateClipSilent = useStudioStore((s) => s.updateClipSilent);
  const undoClips = useStudioStore((s) => s.undoClips);
  const redoClips = useStudioStore((s) => s.redoClips);
  const setPlayhead = useStudioStore((s) => s.setPlayhead);
  const pushHistory = useStudioStore((s) => s.pushHistory);
  const canUndo = useStudioStore((s) => s.pastClips.length > 0);
  const canRedo = useStudioStore((s) => s.futureClips.length > 0);

  const clip = clips.find((c) => c.id === selectedId);
  const [preset, setPreset] = useState("Balanced");
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0); // absolute playhead position (seconds)
  const [lufs, setLufs] = useState({ m: -70, s: -70, i: -70, tp: -70 }); // momentary/short/integrated/true-peak
  const kAnalyserRef = useRef<AnalyserNode | null>(null);
  const kBufRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const winRef = useRef<Array<[number, number]>>([]); // [ctxTime, frameMeanSquare]
  const integSumRef = useRef(0);
  const integCntRef = useRef(0);
  const tpRef = useRef(0); // true-peak (linear)
  const srcRef = useRef<AudioBufferSourceNode | null>(null);
  const psCtxRef = useRef(0); // ctx.currentTime at (re)start
  const psPosRef = useRef(0); // clip position at (re)start
  const rafRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  function stopSrc() {
    if (srcRef.current) {
      try { srcRef.current.stop(); } catch { /* already stopped */ }
      srcRef.current = null;
    }
  }
  function stopRaf() {
    runningRef.current = false;
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
  }
  function startRaf() {
    runningRef.current = true;
    const tick = () => {
      if (!runningRef.current || !clip) return;
      const p = Math.min(clip.end, psPosRef.current + (audioCtx().currentTime - psCtxRef.current) * (clip.speed ?? 1));
      setPos(p);
      setPlayhead(clip.id, p);
      const kAn = kAnalyserRef.current, kb = kBufRef.current;
      if (kAn && kb) {
        kAn.getFloatTimeDomainData(kb);
        let sq = 0, pk = 0;
        for (let i = 0; i < kb.length; i++) { const v = kb[i]; sq += v * v; const a = Math.abs(v); if (a > pk) pk = a; }
        const frameMs = sq / kb.length;
        const now = audioCtx().currentTime;
        const win = winRef.current;
        win.push([now, frameMs]);
        while (win.length && now - win[0][0] > 3) win.shift();
        let mSum = 0, mCnt = 0, sSum = 0, sCnt = 0;
        for (const [t, ms] of win) { sSum += ms; sCnt++; if (now - t <= 0.4) { mSum += ms; mCnt++; } }
        if (lufsFromMs(frameMs) > -70) { integSumRef.current += frameMs; integCntRef.current++; }
        if (pk > tpRef.current) tpRef.current = pk;
        setLufs({
          m: lufsFromMs(mCnt ? mSum / mCnt : 0),
          s: lufsFromMs(sCnt ? sSum / sCnt : 0),
          i: integCntRef.current ? lufsFromMs(integSumRef.current / integCntRef.current) : -70,
          tp: tpRef.current > 1e-6 ? 20 * Math.log10(tpRef.current) : -70,
        });
      }
      if (p < clip.end) rafRef.current = requestAnimationFrame(tick);
      else runningRef.current = false;
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  // stop + reset the playhead when the selection changes / on unmount
  useEffect(() => {
    setPlaying(false);
    stopSrc();
    stopRaf();
    setPos(clip?.start ?? 0);
    setPlayhead(null, 0);
    resetMeters();
    void audioCtx().resume().catch(() => {});
    return () => { stopSrc(); stopRaf(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  async function play() {
    if (!clip || !wavPath) return;
    const c = audioCtx();
    // resume a paused playback
    if (c.state === "suspended" && srcRef.current) {
      await c.resume();
      psCtxRef.current = c.currentTime;
      psPosRef.current = pos;
      startRaf();
      setPlaying(true);
      return;
    }
    stopSrc();
    const buf = await loadAudioBuffer(wavPath);
    await c.resume();
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = clip.speed ?? 1;
    const m = clip.master ?? {};
    const mk = (type: BiquadFilterType, f: number, q: number, g: number) => {
      const n = c.createBiquadFilter();
      n.type = type;
      n.frequency.value = f;
      n.Q.value = q;
      n.gain.value = g;
      return n;
    };
    const low = mk("lowshelf", 120, 1, knobDb(m.eqLow ?? 0, 12));
    const mid = mk("peaking", 1000, 1, knobDb(m.eqMid ?? 0, 12));
    const high = mk("highshelf", 6000, 1, knobDb(m.eqHigh ?? 0, 12));
    const pres = mk("peaking", 4000, 1.2, knobDb(m.presence ?? 0, 8));
    const comp = c.createDynamicsCompressor();
    const cAmt = m.compression ?? 0;
    if (cAmt > 1) {
      comp.threshold.value = -18;
      comp.ratio.value = 1 + (cAmt / 100) * 7;
      comp.attack.value = 0.02;
      comp.release.value = 0.2;
    } else {
      comp.ratio.value = 1;
      comp.threshold.value = 0;
    }
    const g = c.createGain();
    g.gain.value = Math.pow(10, (clip.gain ?? 0) / 20);
    src.connect(low).connect(mid).connect(high).connect(pres).connect(comp).connect(g);
    // per-channel L/R gains → stereo output
    const gL = c.createGain(); gL.gain.value = Math.pow(10, (clip.gainL ?? 0) / 20);
    const gR = c.createGain(); gR.gain.value = Math.pow(10, (clip.gainR ?? 0) / 20);
    const merger = c.createChannelMerger(2);
    g.connect(gL); gL.connect(merger, 0, 0);
    g.connect(gR); gR.connect(merger, 0, 1);
    merger.connect(c.destination);
    // K-weighted tap for LUFS (program loudness, pre-split; BS.1770 pre-filter ≈ high-shelf + RLB high-pass)
    const kShelf = c.createBiquadFilter(); kShelf.type = "highshelf"; kShelf.frequency.value = 1500; kShelf.gain.value = 4;
    const kHP = c.createBiquadFilter(); kHP.type = "highpass"; kHP.frequency.value = 38; kHP.Q.value = 0.5;
    const kAn = c.createAnalyser(); kAn.fftSize = 2048;
    g.connect(kShelf).connect(kHP).connect(kAn);
    kAnalyserRef.current = kAn;
    kBufRef.current = new Float32Array(kAn.fftSize);
    winRef.current = []; integSumRef.current = 0; integCntRef.current = 0; tpRef.current = 0;
    src.onended = () => { setPlaying(false); stopRaf(); setPlayhead(null, 0); };
    src.start(0, clip.start, Math.max(0.01, clip.end - clip.start));
    srcRef.current = src;
    psCtxRef.current = c.currentTime;
    psPosRef.current = clip.start;
    startRaf();
    setPlaying(true);
  }

  function resetMeters() {
    setLufs({ m: -70, s: -70, i: -70, tp: -70 });
    winRef.current = []; integSumRef.current = 0; integCntRef.current = 0; tpRef.current = 0;
  }
  function pause() {
    void audioCtx().suspend();
    stopRaf();
    setPlaying(false);
  }
  function stop() {
    stopSrc();
    stopRaf();
    void audioCtx().resume().catch(() => {});
    resetMeters();
    setPos(clip?.start ?? 0);
    setPlayhead(null, 0);
    setPlaying(false);
  }

  const iconBtn = "grid place-items-center w-7 h-7 rounded-md text-ink-faint hover:text-ink disabled:opacity-30 transition";

  if (!clip) {
    return (
      <div className="shrink-0 border-t border-line bg-[#0e1119] grid place-items-center text-sm text-ink-faint" style={{ height }}>
        เลือก clip ด้านบนเพื่อเปิด Mastering
      </div>
    );
  }

  const master = clip.master ?? {};
  const setMaster = (k: string, v: number) => updateClipSilent(clip.id, { master: { ...master, [k]: v } });
  const dur = clip.end - clip.start;

  return (
    <div className="shrink-0 border-t border-line bg-[#0e1119] flex flex-col" style={{ height }}>
      {/* header bar: label · tools · undo/redo · transport · LED · speed · presets */}
      <div className="flex items-center gap-2 px-4 py-2 shrink-0 border-b border-line/60 overflow-x-auto">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">Mastering</span>

        <div className="flex bg-panel p-0.5 rounded-md border border-line ml-2">
          <button onClick={() => setTool("select")} title="เลือก / ลากปรับช่วง"
            className={`grid place-items-center w-7 h-7 rounded transition ${tool === "select" ? "bg-white/10 text-lime" : "text-ink-faint hover:text-ink"}`}>
            <MousePointer2 size={13} />
          </button>
          <button onClick={() => setTool("split")} title="ตัดแยก — คลิกบน waveform ของ row"
            className={`grid place-items-center w-7 h-7 rounded transition ${tool === "split" ? "bg-white/10 text-lime" : "text-ink-faint hover:text-ink"}`}>
            <Scissors size={13} />
          </button>
        </div>
        <button onClick={() => undoClips()} disabled={!canUndo} title="เลิกทำ (Ctrl+Z)" className={iconBtn}><Undo2 size={14} /></button>
        <button onClick={() => redoClips()} disabled={!canRedo} title="ทำซ้ำ" className={iconBtn}><Redo2 size={14} /></button>

        <div className="flex items-center gap-1 ml-1">
          <button onClick={() => (playing ? pause() : play())} title={playing ? "พัก" : "เล่น"}
            className="grid place-items-center w-8 h-8 rounded-full bg-lime text-black hover:bg-lime-dim transition">
            {playing ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <button onClick={stop} title="หยุด"
            className="grid place-items-center w-7 h-7 rounded-full bg-panel border border-line text-ink-muted hover:text-ink transition">
            <Square size={12} />
          </button>
        </div>

        <LedDisplay seconds={pos - clip.start} bpm={Math.round(120 * (clip.speed ?? 1))} />

        <div className="flex bg-panel p-0.5 rounded-full border border-line ml-auto shrink-0">
          {PRESETS.map((p) => (
            <button key={p} onClick={() => setPreset(p)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition ${preset === p ? "bg-[#2b6cff] text-white" : "text-ink-faint hover:text-ink"}`}>
              {p}
            </button>
          ))}
        </div>

        <div className="flex flex-col items-center gap-0.5 shrink-0">
          <input
            type="range" min={0.5} max={2} step={0.05} value={clip.speed ?? 1}
            onChange={(e) => updateClipSilent(clip.id, { speed: parseFloat(e.target.value) })}
            className="w-24 accent-lime cursor-pointer"
            title="ความเร็วเล่น (ลง export ด้วย)"
          />
          <span className="text-[9px] font-mono text-ink-faint tracking-wide">SPEED {(clip.speed ?? 1).toFixed(2)}x</span>
        </div>
      </div>

      {/* knob grid */}
      <div className="flex-1 min-h-0 flex items-stretch overflow-x-auto px-2">
        <MeterPanel
          lufs={lufs}
          playing={playing}
          channels={{ L: clip.gainL ?? 0, R: clip.gainR ?? 0, M: clip.gain ?? 0 }}
          onChannel={(ch, v) => updateClipSilent(clip.id, ch === "L" ? { gainL: v } : ch === "R" ? { gainR: v } : { gain: v })}
          onCommit={pushHistory}
        />
        {MOCK_GROUPS.map((g) => (
          <div key={g.title} className="shrink-0 px-4 py-2 border-r border-line/40 flex flex-col">
            <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1 text-center">{g.title}</div>
            <div className="flex-1 flex items-center gap-3">
              {g.knobs.map(([key, label]) => (
                <Knob key={key} value={master[key] ?? 0} min={-100} max={100} label={label} size="sm" color="#4ea8ff"
                  onChange={(v) => setMaster(key, v)} format={(v) => `${Math.round(v)}`} />
              ))}
            </div>
          </div>
        ))}

        <div className="shrink-0 px-4 py-2 border-r border-line/40 flex flex-col">
          <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1 text-center">Fades / Norm</div>
          <div className="flex-1 flex items-center gap-3">
            <Knob value={clip.fadeIn ?? 0} min={0} max={Math.max(0.5, Math.min(2, dur))} label="In" size="sm"
              onChange={(v) => updateClipSilent(clip.id, { fadeIn: v })} format={(v) => `${Math.round(v * 1000)}ms`} />
            <Knob value={clip.fadeOut ?? 0} min={0} max={Math.max(0.5, Math.min(2, dur))} label="Out" size="sm"
              onChange={(v) => updateClipSilent(clip.id, { fadeOut: v })} format={(v) => `${Math.round(v * 1000)}ms`} />
            <button onClick={() => updateClip(clip.id, { normalize: !(clip.normalize ?? false) })}
              className={`self-center px-2.5 py-2 rounded-xl border text-[10px] font-medium transition ${clip.normalize ? "bg-lime/15 border-lime/50 text-lime" : "bg-panel border-line text-ink-muted hover:text-ink"}`}>
              Norm
            </button>
          </div>
        </div>

        <div className="shrink-0 px-5 py-2 flex items-center gap-4 ml-auto">
          <div className="flex flex-col items-center">
            <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Loudness</div>
            <Knob value={clip.gain ?? 0} min={-24} max={24} label="Amount" size="lg" color="#4ea8ff"
              onChange={(v) => updateClipSilent(clip.id, { gain: v })} format={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}dB`} />
          </div>
          <div className="flex flex-col items-center gap-1 self-stretch justify-center py-3">
            <div className="w-2 flex-1 rounded-full bg-black/50 overflow-hidden relative min-h-[70px]">
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-lime via-yellow-400 to-red-500"
                style={{ height: `${Math.max(8, Math.min(100, 60 + (clip.gain ?? 0) * 1.5))}%` }} />
            </div>
            <span className="text-[9px] font-mono text-ink-faint">LUFS</span>
          </div>
        </div>
      </div>
    </div>
  );
}
