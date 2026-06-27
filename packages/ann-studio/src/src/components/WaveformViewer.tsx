import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";
import { invoke } from "@tauri-apps/api/core";
import { useStudioStore, genId, type Clip } from "../store/useStudioStore";
import {
  IconPlay,
  IconPause,
  IconZoomIn,
  IconZoomOut,
  IconWand,
  IconWave,
  IconImport,
} from "./icons";

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}
interface Transcript {
  segments: TranscriptSegment[];
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, "$1$1") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function fmt(t: number): string {
  if (!isFinite(t)) return "0:00.0";
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  const d = Math.floor((t * 10) % 10);
  return `${m}:${s.toString().padStart(2, "0")}.${d}`;
}

export default function WaveformViewer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const syncingRef = useRef(false);

  const { wavPath, duration, clips, selectedClipId, addClip, updateClip, selectClip, setClips } =
    useStudioStore();

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [model, setModel] = useState("medium");
  const [transcribing, setTranscribing] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !wavPath) return;
    if (wsRef.current) wsRef.current.destroy();

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#5b6b7d",
      progressColor: "#34d399",
      cursorColor: "#6ee7b7",
      cursorWidth: 2,
      height: 200,
      barWidth: 2,
      barGap: 1.5,
      barRadius: 3,
      plugins: [regions],
    });
    wsRef.current = ws;

    // Load audio bytes through Rust (loadBlob) rather than the asset protocol —
    // avoids wavesurfer's fetch tripping over CSP/CORS in the webview.
    let cancelled = false;
    invoke<ArrayBuffer>("read_audio_bytes", { path: wavPath })
      .then((buf) => {
        if (!cancelled) ws.loadBlob(new Blob([buf], { type: "audio/wav" }));
      })
      .catch((e) => console.error("read_audio_bytes failed:", e));
    ws.on("error", (e) => console.error("wavesurfer error:", e));

    regions.enableDragSelection({ color: hexToRgba("#34d399", 0.22) });

    regions.on("region-created", (region: Region) => {
      if (syncingRef.current) return;
      const id = genId();
      (region as any).id = id;
      addClip({
        id,
        name: `clip ${id.slice(-4)}`,
        start: region.start,
        end: region.end,
        event: "custom",
        color: "",
      });
    });
    regions.on("region-updated", (region: Region) => {
      if (syncingRef.current) return;
      updateClip((region as any).id, { start: region.start, end: region.end });
    });
    regions.on("region-clicked", (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      selectClip((region as any).id);
      region.play();
    });

    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("timeupdate", (t: number) => setTime(t));

    return () => {
      cancelled = true;
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      setPlaying(false);
      setTime(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wavPath]);

  // store clips -> regions
  useEffect(() => {
    const regions = regionsRef.current;
    if (!regions) return;
    syncingRef.current = true;
    const existing = regions.getRegions();
    const storeIds = new Set(clips.map((c) => c.id));

    for (const r of existing) {
      if (!storeIds.has((r as any).id)) r.remove();
    }
    for (const clip of clips) {
      const found = existing.find((r: any) => r.id === clip.id);
      const selected = clip.id === selectedClipId;
      const color = selected
        ? hexToRgba("#34d399", 0.34)
        : hexToRgba(clip.color || "#58afe7", 0.2);
      if (!found) {
        const r = regions.addRegion({
          start: clip.start,
          end: clip.end,
          color,
          drag: true,
          resize: true,
          content: clip.name,
        });
        (r as any).id = clip.id;
      } else {
        found.setOptions({ color });
      }
    }
    syncingRef.current = false;
  }, [clips, selectedClipId]);

  const playPause = useCallback(() => wsRef.current?.playPause(), []);
  const zoom = useCallback((dir: 1 | -1) => {
    const ws = wsRef.current;
    if (!ws) return;
    const z = ws.options.minPxPerSec || 60;
    ws.zoom(Math.max(8, Math.min(600, z + dir * 40)));
  }, []);

  async function handleAutoSplit() {
    if (!wavPath) return;
    if (
      clips.length > 0 &&
      !confirm(`มี ${clips.length} clips อยู่แล้ว — ถอดเสียงใหม่จะแทนที่ทั้งหมด ดำเนินการต่อ?`)
    )
      return;
    setTranscribing(true);
    try {
      const t: Transcript = await invoke("transcribe_audio", { wavPath, model, lang: "th" });
      const next: Clip[] = t.segments
        .filter((s) => s.end - s.start > 0.1)
        .map((s) => ({
          id: genId(),
          name: s.text || "(ไม่มีข้อความ)",
          start: s.start,
          end: s.end,
          event: "custom",
          color: "",
        }));
      setClips(next);
      if (next.length === 0) alert("ถอดเสียงเสร็จแต่ไม่พบช่วงพูด");
    } catch (e) {
      alert(`ถอดเสียงไม่สำเร็จ: ${e}`);
    } finally {
      setTranscribing(false);
    }
  }

  if (!wavPath) {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="flex flex-col items-center gap-4 text-center px-8 py-12 rounded-2xl border border-dashed border-line bg-surface/40 max-w-md">
          <div className="grid place-items-center w-16 h-16 rounded-2xl bg-surface-raised text-mint-400">
            <IconWave size={30} />
          </div>
          <div>
            <div className="text-base font-semibold">ยังไม่มีไฟล์เสียง</div>
            <div className="text-sm text-ink-muted mt-1">
              นำเข้าคลิปหรือไฟล์เสียงเพื่อเริ่มแบ่ง announcer pack
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-faint mt-1">
            <IconImport size={14} />
            <span>กดปุ่ม “นำเข้าไฟล์” ด้านบนขวา</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col rounded-2xl border border-line bg-surface shadow-panel overflow-hidden">
      {/* card header */}
      <div className="flex items-center justify-between px-4 h-11 border-b border-line">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
          <IconWave size={15} className="text-mint-400" />
          Waveform
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => zoom(-1)}
            className="grid place-items-center w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors"
            title="ซูมออก"
          >
            <IconZoomOut size={16} />
          </button>
          <button
            onClick={() => zoom(1)}
            className="grid place-items-center w-8 h-8 rounded-md text-ink-muted hover:text-ink hover:bg-surface-hover transition-colors"
            title="ซูมเข้า"
          >
            <IconZoomIn size={16} />
          </button>
        </div>
      </div>

      {/* waveform */}
      <div className="flex-1 min-h-0 px-4 py-5 overflow-x-auto overflow-y-hidden grid items-center">
        <div ref={containerRef} className="w-full" />
      </div>

      {/* transport */}
      <div className="flex items-center gap-3 px-4 h-16 border-t border-line bg-surface-raised/40">
        <button
          onClick={playPause}
          className="grid place-items-center w-11 h-11 rounded-full bg-mint-500 hover:bg-mint-400 text-base transition-colors shadow-glow shrink-0"
          title="เล่น / หยุด"
        >
          {playing ? <IconPause size={18} /> : <IconPlay size={18} className="ml-0.5" />}
        </button>

        <div className="font-mono text-sm tabular-nums">
          <span className="text-ink">{fmt(time)}</span>
          <span className="text-ink-faint"> / {fmt(duration)}</span>
        </div>

        <div className="w-px h-8 bg-line mx-1" />

        <div className="flex items-center gap-2 ml-auto">
          <span className="hidden sm:block text-xs text-ink-faint">
            ลากบน waveform เพื่อตัด clip
          </span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={transcribing}
            className="h-9 rounded-lg bg-surface border border-line px-2 text-xs text-ink-muted outline-none focus:border-mint-400"
            title="โมเดล Whisper — large-v3 แม่นสุดสำหรับภาษาไทย"
          >
            <option value="small">small · เร็ว</option>
            <option value="medium">medium</option>
            <option value="large-v3">large-v3 · แม่นสุด</option>
          </select>
          <button
            onClick={handleAutoSplit}
            disabled={transcribing}
            className="flex items-center gap-2 px-3.5 h-9 rounded-lg bg-gradient-to-r from-mint-500 to-ice-500 text-base font-semibold text-sm transition-opacity hover:opacity-90 disabled:opacity-50"
            title="ถอดเสียงด้วย AI แล้วแบ่ง clip ตามประโยคอัตโนมัติ"
          >
            <IconWand size={16} />
            {transcribing ? "กำลังถอดเสียง…" : "แยกอัตโนมัติ"}
          </button>
        </div>
      </div>
    </div>
  );
}
