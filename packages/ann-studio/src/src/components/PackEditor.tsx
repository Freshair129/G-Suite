import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Play,
  Square,
  Trash2,
  Volume2,
  Gauge,
  GripVertical,
  Save,
  FolderOutput,
  ArrowLeft,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStudioStore, type Pack, type SoundMapping } from "../store/useStudioStore";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-400",
  high: "bg-amber-400",
  normal: "bg-gray-400",
  low: "bg-gray-600",
  none: "bg-gray-700",
};

export default function PackEditor({ pack }: { pack: Pack }) {
  const { libraryRoot, updatePack, setActivePack } = useStudioStore();
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  const events = GMAIDEN_EVENTS.filter((e) => pack.events.includes(e.id));
  const mappedCount = Object.keys(pack.mappings).length;

  function setMapping(eventId: string, mapping: SoundMapping | null) {
    const updated = { ...pack };
    const newMappings = { ...pack.mappings };
    if (mapping) {
      newMappings[eventId] = mapping;
    } else {
      delete newMappings[eventId];
    }
    updated.mappings = newMappings;
    updated.updated_at = new Date().toISOString();
    updatePack(updated);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const updated = { ...pack, updated_at: new Date().toISOString() };
      await invoke("save_pack", { manifest: updated });
      updatePack(updated);
    } catch (e) {
      alert(`บันทึกไม่สำเร็จ: ${e}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleExport() {
    const dir = await open({
      title: "เลือกโฟลเดอร์ปลายทาง",
      directory: true,
    });
    if (!dir) return;
    setExporting(true);
    try {
      const result: { output_dir: string; total: number } = await invoke(
        "export_pack",
        { packId: pack.id, targetDir: dir }
      );
      alert(`ส่งออกไฟล์แพ็ก ${result.total} ไฟล์แล้ว → ${result.output_dir}\nการส่งออกนี้ยังไม่ได้ยืนยันการเปิดใช้แพ็กใน G-Maiden`);
    } catch (e) {
      alert(`ส่งออกไม่สำเร็จ: ${e}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Pack header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-line shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActivePack(null)}
            className="grid place-items-center w-8 h-8 rounded-xl hover:bg-panel-hover border border-line transition"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h3 className="text-sm font-bold">{pack.name}</h3>
            <p className="text-[11px] text-ink-faint">
              {pack.pack_type === "full"
                ? "Full Pack"
                : pack.pack_type === "single"
                ? "Single Event"
                : "Custom Pack"}{" "}
              · {events.length} events · {mappedCount} mapped
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 h-9 rounded-full bg-panel border border-line text-xs font-medium hover:border-lime/50 transition disabled:opacity-50"
          >
            <Save size={14} className="text-lime" />
            {saving ? "กำลังบันทึก…" : "Save"}
          </button>
          <button
            onClick={handleExport}
            disabled={exporting || mappedCount === 0}
            className="flex items-center gap-1.5 px-4 h-9 rounded-full bg-gradient-to-r from-lime to-grass text-black text-xs font-semibold hover:opacity-90 transition disabled:opacity-50"
          >
            <FolderOutput size={14} />
            {exporting ? "กำลังส่งออก…" : "Export"}
          </button>
        </div>
      </div>

      {/* Coverage bar */}
      <div className="px-6 py-3 border-b border-line/50 shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-ink-faint">
            Mapping Coverage
          </span>
          <span className="text-[11px] font-mono text-lime">
            {events.length > 0
              ? ((mappedCount / events.length) * 100).toFixed(0)
              : 0}
            %
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-panel border border-line overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-lime to-grass transition-all duration-500"
            style={{
              width: `${
                events.length > 0 ? (mappedCount / events.length) * 100 : 0
              }%`,
            }}
          />
        </div>
      </div>

      {/* Event rows */}
      <div className="flex-1 overflow-y-auto">
        {events.map((ev) => (
          <EventSlot
            key={ev.id}
            event={ev}
            mapping={pack.mappings[ev.id] ?? null}
            libraryRoot={libraryRoot}
            onSetMapping={(m) => setMapping(ev.id, m)}
          />
        ))}
      </div>
    </div>
  );
}

function EventSlot({
  event,
  mapping,
  libraryRoot,
  onSetMapping,
}: {
  event: (typeof GMAIDEN_EVENTS)[number];
  mapping: SoundMapping | null;
  libraryRoot: string;
  onSetMapping: (m: SoundMapping | null) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [showControls, setShowControls] = useState(false);

  function handleDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes("application/x-library-sound")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setDragOver(true);
    }
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const soundPath = e.dataTransfer.getData("application/x-library-sound");
    const soundName = e.dataTransfer.getData("text/plain");
    if (soundPath) {
      onSetMapping({
        sound_path: soundPath,
        sound_name: soundName || soundPath.split("/").pop() || soundPath,
        volume: mapping?.volume ?? 1.0,
        speed: mapping?.speed ?? 1.0,
      });
    }
  }

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    if (!mapping) return;
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      const absPath = `${libraryRoot}/${mapping.sound_path}`.replace(
        /\//g,
        "\\"
      );
      const buf: ArrayBuffer = await invoke("read_audio_bytes", {
        path: absPath,
      });
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blob = new Blob([buf], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.volume = mapping.volume;
      audio.playbackRate = mapping.speed;
      audio.onended = () => setPlaying(false);
      audio.play();
      setPlaying(true);
    } catch (err) {
      console.error("play:", err);
    }
  }

  function handleVolumeChange(v: number) {
    if (!mapping) return;
    onSetMapping({ ...mapping, volume: v });
    if (audioRef.current) audioRef.current.volume = v;
  }

  function handleSpeedChange(v: number) {
    if (!mapping) return;
    onSetMapping({ ...mapping, speed: v });
    if (audioRef.current) audioRef.current.playbackRate = v;
  }

  return (
    <div
      className={`border-b border-line/50 transition ${
        dragOver ? "bg-lime/10 border-lime/40" : ""
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Event info */}
        <div className="min-w-[150px]">
          <div className="flex items-center gap-2">
            <span
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                PRIORITY_DOT[event.priority]
              }`}
            />
            <span className="text-sm font-medium">{event.label}</span>
          </div>
          <span className="text-[10px] font-mono text-ink-faint ml-3.5">
            {event.id}
          </span>
        </div>

        {/* Drop zone / mapping */}
        <div className="flex-1 min-w-0">
          {mapping ? (
            <div className="flex items-center gap-2">
              <button
                onClick={handlePlay}
                className="grid place-items-center w-7 h-7 rounded-lg bg-lime/10 hover:bg-lime/20 text-lime transition shrink-0"
              >
                {playing ? <Square size={12} /> : <Play size={12} />}
              </button>
              <div
                className="flex-1 min-w-0 px-3 py-1.5 rounded-lg bg-panel border border-line cursor-pointer hover:border-lime/30 transition"
                onClick={() => setShowControls(!showControls)}
              >
                <div className="flex items-center gap-2">
                  <GripVertical size={10} className="text-ink-faint/40" />
                  <span className="text-xs text-ink truncate">
                    {mapping.sound_name}
                  </span>
                  <span className="text-[9px] font-mono text-ink-faint ml-auto shrink-0">
                    vol:{mapping.volume.toFixed(1)} spd:
                    {mapping.speed.toFixed(1)}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onSetMapping(null)}
                className="grid place-items-center w-7 h-7 rounded-lg text-ink-faint hover:text-danger hover:bg-danger/10 transition shrink-0"
              >
                <Trash2 size={13} />
              </button>
            </div>
          ) : (
            <div
              className={`flex items-center justify-center h-10 rounded-xl border-2 border-dashed transition ${
                dragOver
                  ? "border-lime/60 bg-lime/5"
                  : "border-line/60 text-ink-faint"
              }`}
            >
              <span className="text-[11px]">
                {dragOver ? "ปล่อยที่นี่" : "ลากเสียงมาวางที่นี่"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Expanded controls */}
      {mapping && showControls && (
        <div className="px-4 pb-3 pl-[170px]">
          <div className="flex items-center gap-4 p-3 rounded-xl bg-base border border-line">
            <div className="flex items-center gap-2 flex-1">
              <Volume2 size={13} className="text-ink-faint shrink-0" />
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={mapping.volume}
                onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                className="flex-1 accent-lime h-1"
              />
              <span className="text-[10px] font-mono text-ink-faint w-8 text-right">
                {(mapping.volume * 100).toFixed(0)}%
              </span>
            </div>
            <div className="w-px h-5 bg-line" />
            <div className="flex items-center gap-2 flex-1">
              <Gauge size={13} className="text-ink-faint shrink-0" />
              <input
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                value={mapping.speed}
                onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                className="flex-1 accent-lime h-1"
              />
              <span className="text-[10px] font-mono text-ink-faint w-8 text-right">
                {mapping.speed.toFixed(2)}x
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
