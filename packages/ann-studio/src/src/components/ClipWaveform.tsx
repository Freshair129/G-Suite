// Per-clip waveform trimmer — a short timeline showing the source waveform in a
// window around the clip, with the play region drawn as a draggable box: drag the
// body to slide it, drag either edge handle to grow/shrink. Play plays the region.
//
// Live drags call onChange (history-silent); the caller snapshots once via
// onCommitStart at pointer-down so one drag = one undo step.

import { useEffect, useRef, useState } from "react";
import { loadPeaks } from "../lib/peaks";
import type { Clip } from "../store/useStudioStore";

interface Props {
  wavPath: string;
  duration: number;
  clip: Clip;
  accent: string;
  mode: "select" | "split";
  zoom: number;
  playhead?: number; // absolute seconds; draws a needle when within the window
  onChange: (start: number, end: number) => void;
  onCommitStart: () => void;
  onSplit: (t: number) => void;
}

const H = 60;
const HANDLE_PX = 9;
const MIN_LEN = 0.05;

export default function ClipWaveform({ wavPath, duration, clip, accent, mode, zoom, playhead, onChange, onCommitStart, onSplit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [w, setW] = useState(600);
  const [cursor, setCursor] = useState("default");

  // window follows the region with padding so there's room to grow both edges
  const len = Math.max(MIN_LEN, clip.end - clip.start);
  const pad = (len * 0.7 + 0.35) / Math.max(0.3, zoom);
  const w0 = Math.max(0, clip.start - pad);
  const w1 = Math.min(duration, clip.end + pad);
  const winLen = Math.max(0.1, w1 - w0);

  useEffect(() => {
    let live = true;
    loadPeaks(wavPath).then((p) => live && setPeaks(p)).catch(() => {});
    return () => { live = false; };
  }, [wavPath]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    setW(el.clientWidth || 600);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !peaks) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(w * dpr);
    c.height = Math.round(H * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${H}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, H);

    const buckets = peaks.length;
    const i0 = Math.floor((w0 / duration) * buckets);
    const i1 = Math.ceil((w1 / duration) * buckets);
    const n = Math.max(1, i1 - i0);
    const bw = w / n;
    const xs = ((clip.start - w0) / winLen) * w;
    const xe = ((clip.end - w0) / winLen) * w;

    // region fill behind bars
    ctx.fillStyle = accent + "1f";
    ctx.fillRect(xs, 2, xe - xs, H - 4);

    // waveform bars — bright inside the region, dim outside
    for (let i = 0; i < n; i++) {
      const p = peaks[i0 + i] || 0;
      const bh = Math.max(1, p * (H - 10));
      const t = w0 + (i / n) * winLen;
      ctx.fillStyle = t >= clip.start && t <= clip.end ? accent : "rgba(255,255,255,0.16)";
      ctx.fillRect(i * bw, (H - bh) / 2, Math.max(1, bw - 0.5), bh);
    }

    // region border + edge handles
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(xs + 0.5, 2.5, xe - xs - 1, H - 5);
    ctx.fillStyle = accent;
    ctx.fillRect(xs - 1, 2, 3, H - 4);
    ctx.fillRect(xe - 2, 2, 3, H - 4);

    // playhead needle
    if (playhead != null && playhead >= w0 && playhead <= w1) {
      const nx = ((playhead - w0) / winLen) * w;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(nx - 0.5, 0, 1.5, H);
    }
  }, [peaks, w, clip.start, clip.end, accent, w0, w1, winLen, duration, playhead]);

  function xToTime(clientX: number): number {
    const c = canvasRef.current;
    if (!c) return clip.start;
    const rect = c.getBoundingClientRect();
    const x = Math.max(0, Math.min(w, clientX - rect.left));
    return w0 + (x / w) * winLen;
  }

  function hitMode(clientX: number): "start" | "end" | "move" | null {
    const c = canvasRef.current;
    if (!c) return null;
    const x = clientX - c.getBoundingClientRect().left;
    const xs = ((clip.start - w0) / winLen) * w;
    const xe = ((clip.end - w0) / winLen) * w;
    if (Math.abs(x - xs) < HANDLE_PX) return "start";
    if (Math.abs(x - xe) < HANDLE_PX) return "end";
    if (x > xs && x < xe) return "move";
    return null;
  }

  function onMoveHover(e: React.PointerEvent) {
    if (mode === "split") {
      setCursor("crosshair");
      return;
    }
    const m = hitMode(e.clientX);
    setCursor(m === "move" ? "grab" : m ? "ew-resize" : "default");
  }

  function onDown(e: React.PointerEvent) {
    if (mode === "split") {
      e.preventDefault();
      onSplit(xToTime(e.clientX));
      return;
    }
    const hit = hitMode(e.clientX);
    if (!hit) return;
    e.preventDefault();
    onCommitStart();
    const s0 = clip.start;
    const e0 = clip.end;
    const t0 = xToTime(e.clientX);

    function move(ev: PointerEvent) {
      const t = xToTime(ev.clientX);
      if (hit === "start") onChange(Math.min(t, e0 - MIN_LEN), e0);
      else if (hit === "end") onChange(s0, Math.max(t, s0 + MIN_LEN));
      else {
        let ns = s0 + (t - t0);
        let ne = e0 + (t - t0);
        if (ns < 0) { ne -= ns; ns = 0; }
        if (ne > duration) { ns -= ne - duration; ne = duration; }
        onChange(ns, ne);
      }
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <div ref={wrapRef} className="w-full min-w-0">
      {peaks ? (
        <canvas
          ref={canvasRef}
          onPointerDown={onDown}
          onPointerMove={onMoveHover}
          style={{ cursor, display: "block", touchAction: "none" }}
        />
      ) : (
        <div className="h-[60px] grid place-items-center text-xs text-ink-faint">กำลังโหลด waveform…</div>
      )}
    </div>
  );
}
