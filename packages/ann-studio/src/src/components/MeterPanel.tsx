// Loudness meter (Youlean-style) + per-channel faders. K-weighted LUFS (BS.1770
// approx) drives the readouts + bar fills (program level, mono → same fill).
// Each bar is ALSO a fader: drag it to set that channel's gain — L→gainL,
// R→gainR, M→master (clip.gain) — for stereo balance.

import { useEffect, useRef } from "react";

export interface Lufs { m: number; s: number; i: number; tp: number }

function lufsFrac(v: number) {
  return Math.max(0, Math.min(1, (v + 54) / 54)); // -54..0 → 0..1
}

const TICKS = [0, -6, -12, -18, -27, -36, -54];
const GMIN = -24, GMAX = 12; // fader dB range

function FaderBar({ label, level, gain, onChange, onCommit }: {
  label: string; level: number; gain: number;
  onChange: (v: number) => void; onCommit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const gFrac = (gain - GMIN) / (GMAX - GMIN);

  function onDown(e: React.PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    onCommit();
    const set = (clientY: number) => {
      const f = 1 - Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      onChange(+(GMIN + f * (GMAX - GMIN)).toFixed(1));
    };
    set(e.clientY);
    const move = (ev: PointerEvent) => set(ev.clientY);
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div className="flex flex-col items-center gap-1 h-full">
      <div
        ref={ref}
        onPointerDown={onDown}
        className="relative w-3 flex-1 rounded-sm overflow-hidden bg-black/70 border border-white/5 cursor-ns-resize"
        title={`${label}: ${gain > 0 ? "+" : ""}${gain} dB`}
      >
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top,#3ecf7f 0%,#3ecf7f 52%,#ffd76b 78%,#ff5b5b 100%)" }} />
        <div className="absolute inset-x-0 top-0 bg-[#080b10]" style={{ height: `${(1 - level) * 100}%` }} />
        {/* fader thumb */}
        <div className="absolute inset-x-[-2px] h-[3px] bg-white rounded-sm" style={{ bottom: `calc(${gFrac * 100}% - 1.5px)`, boxShadow: "0 0 3px rgba(0,0,0,0.8)" }} />
      </div>
      <span className="text-[8px] font-mono text-ink-faint">{label}</span>
      <span className="text-[7px] font-mono text-ink-muted">{gain > 0 ? "+" : ""}{gain.toFixed(0)}</span>
    </div>
  );
}

function Readout({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded px-2 py-0.5 text-center min-w-[60px]" style={{ background: "#0b0f16", boxShadow: "inset 0 1px 4px rgba(0,0,0,0.8)" }}>
      <div className="font-mono font-bold text-[12px]" style={{ color: accent ? "#7fd0ff" : "#cfe6ff", textShadow: accent ? "0 0 5px rgba(127,208,255,0.4)" : "none" }}>{value}</div>
      <div className="text-[6.5px] tracking-widest text-ink-faint">{label}</div>
    </div>
  );
}

export default function MeterPanel({ lufs, playing, channels, onChannel, onCommit }: {
  lufs: Lufs;
  playing: boolean;
  channels: { L: number; R: number; M: number };
  onChannel: (ch: "L" | "R" | "M", v: number) => void;
  onCommit: () => void;
}) {
  const histRef = useRef<number[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frac = lufsFrac(lufs.m);

  useEffect(() => {
    const h = histRef.current;
    h.push(frac);
    if (h.length > 200) h.shift();
    if (!playing && h.length === 0) return;
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 200, H = 92;
    c.width = W * dpr; c.height = H * dpr;
    c.style.width = `${W}px`; c.style.height = `${H}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (const t of [-6, -18, -36]) {
      const y = H - lufsFrac(t) * H;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    const n = h.length;
    if (n > 1) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let i = 0; i < n; i++) ctx.lineTo((i / 199) * W, H - h[i] * H);
      ctx.lineTo(((n - 1) / 199) * W, H);
      ctx.closePath();
      ctx.fillStyle = "rgba(78,168,255,0.22)";
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i / 199) * W, y = H - h[i] * H;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#4ea8ff"; ctx.lineWidth = 1.2; ctx.stroke();
    }
  }, [frac, playing]);

  const fmt = (v: number) => (v <= -70 ? "-∞" : v.toFixed(1));

  return (
    <div className="shrink-0 px-4 py-2 border-r border-line/40 flex flex-col">
      <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">Loudness · Fader</div>
      <div className="flex-1 flex items-stretch gap-3">
        <div className="relative w-6 shrink-0">
          {TICKS.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2 text-[7px] font-mono text-ink-faint" style={{ top: `${(1 - lufsFrac(t)) * 100}%` }}>{t}</span>
          ))}
        </div>
        <div className="flex items-stretch gap-2">
          <FaderBar label="L" level={frac} gain={channels.L} onChange={(v) => onChannel("L", v)} onCommit={onCommit} />
          <FaderBar label="R" level={frac} gain={channels.R} onChange={(v) => onChannel("R", v)} onCommit={onCommit} />
          <FaderBar label="M" level={frac} gain={channels.M} onChange={(v) => onChannel("M", v)} onCommit={onCommit} />
        </div>
        <div className="flex flex-col justify-center gap-1 shrink-0">
          <Readout label="INTEGRATED" value={fmt(lufs.i)} accent />
          <Readout label="SHORT TERM" value={fmt(lufs.s)} />
          <Readout label="MOMENTARY" value={fmt(lufs.m)} />
          <Readout label="TRUE PEAK dB" value={fmt(lufs.tp)} />
        </div>
        <div className="self-center rounded overflow-hidden border border-white/5" style={{ background: "#0a0e14" }}>
          <canvas ref={canvasRef} className="block" />
        </div>
      </div>
    </div>
  );
}
