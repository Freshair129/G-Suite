import { useEffect, useRef, useState, useCallback } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";
import { invoke } from "@tauri-apps/api/core";
import { selectProjectVariant } from "../lib/project";
import {
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Sparkles,
  AudioLines,
  Upload,
  Volume2,
  VolumeX,
  Minus,
  Plus,
} from "lucide-react";
import { useStudioStore, genId } from "../store/useStudioStore";
import { runAutoSplit } from "../lib/actions";

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

  const {
    wavPath,
    duration,
    clips,
    selectedClipId,
    addClip,
    updateClip,
    model,
    setModel,
    transcribing,
  } = useStudioStore();

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !wavPath) return;
    if (wsRef.current) wsRef.current.destroy();

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#5a5a4a",
      progressColor: "#e0ff00",
      cursorColor: "#ffffff",
      cursorWidth: 2,
      height: 200,
      barWidth: 2,
      barGap: 1.5,
      barRadius: 3,
      plugins: [regions],
    });
    wsRef.current = ws;

    let cancelled = false;
    invoke<ArrayBuffer>("read_audio_bytes", { path: wavPath })
      .then((buf) => {
        if (!cancelled) ws.loadBlob(new Blob([buf], { type: "audio/wav" }));
      })
      .catch((e) => console.error("read_audio_bytes failed:", e));
    ws.on("error", (e) => console.error("wavesurfer error:", e));

    regions.enableDragSelection({ color: hexToRgba("#e0ff00", 0.18) });

    regions.on("region-created", (region: Region) => {
      if (syncingRef.current) return;
      const id = genId();
      (region as any).id = id;
      addClip({
        id,
        name: `clip ${id.slice(-4)}`,
        start: region.start,
        end: region.end,
        event: "unused",
        color: "",
      });
    });
    regions.on("region-updated", (region: Region) => {
      if (syncingRef.current) return;
      updateClip((region as any).id, { start: region.start, end: region.end });
    });
    regions.on("region-clicked", (region: Region, e: MouseEvent) => {
      e.stopPropagation();
      selectProjectVariant((region as any).id);
      region.play();
    });

    ws.on("play", () => setPlaying(true));
    ws.on("pause", () => setPlaying(false));
    ws.on("finish", () => setPlaying(false));
    ws.on("timeupdate", (t: number) => setTime(t));
    ws.on("ready", () => ws.setVolume(muted ? 0 : volume));

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
        ? hexToRgba("#e0ff00", 0.32)
        : hexToRgba(clip.color || "#22c55e", 0.18);
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

  const applyVolume = useCallback((v: number, m: boolean) => {
    wsRef.current?.setVolume(m ? 0 : v);
  }, []);
  const changeVolume = useCallback(
    (v: number) => {
      const nv = Math.max(0, Math.min(1, v));
      setVolume(nv);
      setMuted(false);
      applyVolume(nv, false);
    },
    [applyVolume],
  );
  const toggleMute = useCallback(() => {
    setMuted((m) => {
      const nm = !m;
      applyVolume(volume, nm);
      return nm;
    });
  }, [volume, applyVolume]);

  const playPause = useCallback(() => wsRef.current?.playPause(), []);
  const zoom = useCallback((dir: 1 | -1) => {
    const ws = wsRef.current;
    if (!ws) return;
    const z = ws.options.minPxPerSec || 60;
    ws.zoom(Math.max(8, Math.min(600, z + dir * 40)));
  }, []);

  async function handleAutoSplit() {
    if (
      clips.length > 0 &&
      !confirm(`มี ${clips.length} clips อยู่แล้ว — ถอดเสียงใหม่จะแทนที่ทั้งหมด ดำเนินการต่อ?`)
    )
      return;
    const msg = await runAutoSplit(model);
    if (msg.includes("ไม่สำเร็จ") || msg.includes("ไม่พบ")) alert(msg);
  }

  if (!wavPath) {
    return (
      <div className="flex-1 grid place-items-center">
        <div className="flex flex-col items-center gap-4 text-center px-8 py-12 rounded-3xl border border-dashed border-line bg-panel/40 max-w-md">
          <div className="grid place-items-center w-16 h-16 rounded-2xl bg-panel text-lime">
            <AudioLines size={30} />
          </div>
          <div>
            <div className="text-base font-semibold">ยังไม่มีไฟล์เสียง</div>
            <div className="text-sm text-ink-muted mt-1">
              นำเข้าคลิปหรือไฟล์เสียงเพื่อเริ่มแบ่ง announcer pack
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-faint mt-1">
            <Upload size={14} />
            <span>กดปุ่ม “นำเข้าไฟล์” ด้านบนขวา</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col rounded-3xl border border-line bg-panel/60 overflow-hidden">
      {/* card header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-line">
        <div className="flex items-center gap-2 text-sm font-medium text-ink-muted">
          <AudioLines size={15} className="text-lime" />
          Waveform
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => zoom(-1)}
            className="grid place-items-center w-8 h-8 rounded-lg text-ink-muted hover:text-ink hover:bg-panel-hover transition"
            title="ซูมออก"
          >
            <ZoomOut size={16} />
          </button>
          <button
            onClick={() => zoom(1)}
            className="grid place-items-center w-8 h-8 rounded-lg text-ink-muted hover:text-ink hover:bg-panel-hover transition"
            title="ซูมเข้า"
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>

      {/* waveform */}
      <div className="flex-1 min-h-0 px-4 py-5 overflow-x-auto overflow-y-hidden grid items-center">
        <div ref={containerRef} className="w-full" />
      </div>

      {/* transport */}
      <div className="flex items-center gap-3 px-4 h-16 border-t border-line bg-base/40">
        <button
          onClick={playPause}
          className="grid place-items-center w-11 h-11 rounded-full bg-lime text-black hover:bg-lime-dim transition shadow-glow shrink-0"
          title="เล่น / หยุด"
        >
          {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>

        <div className="font-mono text-sm tabular-nums shrink-0">
          <span className="text-ink">{fmt(time)}</span>
          <span className="text-ink-faint"> / {fmt(duration)}</span>
        </div>

        {/* volume */}
        <div className="flex items-center gap-1.5 ml-2 shrink-0">
          <button
            onClick={toggleMute}
            className="grid place-items-center w-8 h-8 rounded-lg text-ink-muted hover:text-ink hover:bg-panel-hover transition"
            title={muted ? "เปิดเสียง" : "ปิดเสียง"}
          >
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={() => changeVolume(volume - 0.1)}
            className="grid place-items-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-panel-hover transition"
            title="ลดเสียง"
          >
            <Minus size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => changeVolume(parseFloat(e.target.value))}
            className="w-20"
            title={`เสียง ${Math.round((muted ? 0 : volume) * 100)}%`}
          />
          <button
            onClick={() => changeVolume(volume + 0.1)}
            className="grid place-items-center w-7 h-7 rounded-lg text-ink-muted hover:text-ink hover:bg-panel-hover transition"
            title="เพิ่มเสียง"
          >
            <Plus size={14} />
          </button>
          <span className="w-9 text-right font-mono text-[11px] text-ink-faint tabular-nums">
            {Math.round((muted ? 0 : volume) * 100)}%
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={transcribing}
            className="h-9 rounded-full bg-panel border border-line px-3 text-xs text-ink-muted outline-none focus:border-lime"
            title="โมเดล Whisper — large-v3 แม่นสุดสำหรับภาษาไทย"
          >
            <option value="small">small · เร็ว</option>
            <option value="medium">medium</option>
            <option value="large-v3">large-v3 · แม่นสุด</option>
          </select>
          <button
            onClick={handleAutoSplit}
            disabled={transcribing}
            className="flex items-center gap-2 px-4 h-9 rounded-full bg-gradient-to-r from-lime to-grass text-black font-semibold text-sm transition hover:opacity-90 disabled:opacity-50"
            title="ถอดเสียงด้วย AI แล้วแบ่ง clip ตามประโยคอัตโนมัติ"
          >
            <Sparkles size={16} />
            {transcribing ? "กำลังถอดเสียง…" : "แยกอัตโนมัติ"}
          </button>
        </div>
      </div>
    </div>
  );
}
