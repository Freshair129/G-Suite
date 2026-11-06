import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Package,
  FileAudio,
  ChevronRight,
  ChevronDown,
  Play,
  Square,
  GripVertical,
  Trash2,
  RefreshCw,
  Link2,
  Radar,
} from "lucide-react";
import { useStudioStore, genId, type LibPkg, type LibSound, type Clip } from "../store/useStudioStore";
import ImpactRadar from "./ImpactRadar";

export default function SoundLibrary() {
  const { libraryRoot, libraryPackages, setLibrary, setLibraryPackages,
    sourcePath, duration, clips, setClips, setView } = useStudioStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pkgSounds, setPkgSounds] = useState<Record<string, LibSound[]>>({});
  const [ctxMenu, setCtxMenu] = useState<{ pkg: LibPkg; x: number; y: number } | null>(null);
  const [libH, setLibH] = useState(300); // height of the top (Sound Library) section
  const asideRef = useRef<HTMLElement>(null);

  const loadLibrary = useCallback(async () => {
    try {
      const info: { root: string; packages: LibPkg[] } = await invoke("init_library");
      setLibrary(info.root, []);
      setLibraryPackages(info.packages);
    } catch (e) {
      console.error("init_library:", e);
    }
  }, [setLibrary, setLibraryPackages]);

  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  function startSplit(e: React.PointerEvent) {
    e.preventDefault();
    const asideH = asideRef.current?.clientHeight ?? 800;
    const startY = e.clientY;
    const startH = libH;
    function move(ev: PointerEvent) {
      setLibH(Math.max(80, Math.min(asideH - 120, startH + (ev.clientY - startY))));
    }
    function up() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // close the context menu on any outside click / escape
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("contextmenu", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("contextmenu", close);
    };
  }, [ctxMenu]);

  // "open on canvas": load a library pack's sounds into SourceView as
  // standalone-file clips (edit / reorder / remap / add more by dragging in)
  async function openPackOnCanvas(pkg: LibPkg) {
    setCtxMenu(null);
    if (clips.length && !confirm(`เปิด "${pkg.name}" บน canvas จะแทนที่ clip ปัจจุบัน — ต่อไหม?`)) return;
    try {
      const sounds = pkgSounds[pkg.id] ?? (await invoke<LibSound[]>("query_sounds", { pkgId: pkg.id }));
      const next: Clip[] = sounds.map((s) => ({
        id: genId(),
        name: s.name_th || s.name_en,
        start: 0,
        end: s.duration,
        event: s.events?.[0] || "unused",
        color: "",
        filePath: s.file_path,
        fileDur: s.duration,
        source: s.source_path,
      }));
      setClips(next);
      setView("studio");
    } catch (e) {
      alert(`เปิด pack ไม่สำเร็จ: ${e}`);
    }
  }

  async function togglePkg(pkgId: string) {
    const isOpen = expanded[pkgId];
    setExpanded((prev) => ({ ...prev, [pkgId]: !isOpen }));
    if (!isOpen && !pkgSounds[pkgId]) {
      try {
        const sounds: LibSound[] = await invoke("query_sounds", { pkgId });
        setPkgSounds((prev) => ({ ...prev, [pkgId]: sounds }));
      } catch (e) {
        console.error("query_sounds:", e);
      }
    }
  }

  async function handleDeletePkg(pkg: LibPkg, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`ลบ package "${pkg.name}"?`)) return;
    try {
      await invoke("delete_library_pkg", { pkgId: pkg.id });
      loadLibrary();
      setPkgSounds((prev) => {
        const next = { ...prev };
        delete next[pkg.id];
        return next;
      });
    } catch (err) {
      alert(`ลบไม่สำเร็จ: ${err}`);
    }
  }

  return (
    <aside ref={asideRef} className="w-full shrink-0 flex flex-col border-r border-line bg-base">
      {/* ── Sound Library (top, resizable height) ── */}
      <div className="flex flex-col shrink-0 min-h-0" style={{ height: libH }}>
        <div className="flex items-center px-3 h-9 shrink-0 border-b border-line">
          <span className="flex-1 text-xs font-semibold text-ink-muted">Sound Library</span>
          <button
            onClick={loadLibrary}
            className="grid place-items-center w-6 h-6 rounded-md text-ink-faint hover:text-ink hover:bg-panel transition"
            title="Refresh"
          >
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1">
          {libraryPackages.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <Package size={24} className="mx-auto text-ink-faint mb-2" />
              <p className="text-[11px] text-ink-faint leading-relaxed">
                ยังไม่มีเจ้าของเสียง<br />
                กด <span className="text-lime">Save to Library</span> หลังแยกเสียง
              </p>
            </div>
          ) : (
            libraryPackages.map((pkg) => (
              <div key={pkg.id}>
                <button
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("application/x-library-pack", pkg.id);
                    e.dataTransfer.setData("text/plain", pkg.name);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => togglePkg(pkg.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCtxMenu({ pkg, x: e.clientX, y: e.clientY });
                  }}
                  title="ลากมาวางบน canvas / คลิกขวา → เปิดแก้ไข"
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-ink-muted hover:bg-panel-hover transition group cursor-grab active:cursor-grabbing"
                >
                  {expanded[pkg.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Package size={13} className="text-lime/70 shrink-0" />
                  <span className="truncate min-w-0 flex-1 text-left" title={pkg.name}>{pkg.name}</span>
                  <span className="text-[9px] font-mono text-ink-faint shrink-0">{pkg.clip_count}</span>
                  <button
                    onClick={(e) => handleDeletePkg(pkg, e)}
                    className="grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-danger transition shrink-0 opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={10} />
                  </button>
                </button>
                {expanded[pkg.id] &&
                  (pkgSounds[pkg.id] || []).map((sound) => (
                    <SoundRow key={sound.id} sound={sound} libraryRoot={libraryRoot} />
                  ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── draggable divider ── */}
      <div
        onPointerDown={startSplit}
        className="h-2 shrink-0 cursor-row-resize bg-line/40 hover:bg-lime/50 transition flex items-center justify-center group"
        title="ลากปรับสัดส่วน"
      >
        <div className="w-10 h-0.5 rounded-full bg-white/20 group-hover:bg-white/50" />
      </div>

      {/* ── Source (bottom, takes the rest) ── */}
      <div className="flex-1 min-h-0 flex flex-col">
        <div className="flex items-center px-3 h-9 shrink-0 border-b border-line">
          <span className="text-xs font-semibold text-ink-muted">Source</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2" data-src-panel>
          {sourcePath ? (
            <>
              <div className="flex items-center gap-1.5">
                <FileAudio size={13} className="text-lime shrink-0" />
                <span className="text-xs text-ink truncate" title={sourcePath}>
                  {sourcePath.split(/[\\/]/).pop()}
                </span>
              </div>
              <div className="text-[10px] font-mono text-ink-faint mt-0.5">
                {duration.toFixed(1)}s · {clips.length} clips
              </div>
            </>
          ) : (
            <div className="text-[11px] text-ink-faint">ยังไม่มีไฟล์</div>
          )}
        </div>
      </div>

      {/* right-click pack → context menu */}
      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[180px] rounded-lg border border-line bg-panel shadow-xl py-1 text-xs"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => openPackOnCanvas(ctxMenu.pkg)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-ink hover:bg-panel-hover transition"
          >
            <Package size={12} className="text-lime" />
            เปิดแก้ไขบน canvas
          </button>
          <div className="px-3 py-1 text-[10px] text-ink-faint">{ctxMenu.pkg.clip_count} เสียง · ลากเพิ่มได้</div>
        </div>
      )}
    </aside>
  );
}

interface Usage {
  pack_id: string;
  pack_name: string;
  event: string;
}

function SoundRow({ sound, libraryRoot }: { sound: LibSound; libraryRoot: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const [usage, setUsage] = useState<Usage[] | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [radar, setRadar] = useState(false);

  // backlink: which packs/events use this sound (indexed sound_usage lookup)
  async function toggleUsage(e: React.MouseEvent) {
    e.stopPropagation();
    if (usage === null) {
      try {
        setUsage(await invoke<Usage[]>("sound_usage", { soundId: sound.id }));
      } catch {
        setUsage([]);
      }
    }
    setShowUsage((v) => !v);
  }

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("application/x-library-sound", sound.file_path);
    e.dataTransfer.setData("application/x-library-sound-json", JSON.stringify(sound));
    e.dataTransfer.setData("text/plain", sound.name_th || sound.name_en);
    e.dataTransfer.effectAllowed = "copy";
  }

  async function handlePlay(e: React.MouseEvent) {
    e.stopPropagation();
    if (playing) {
      audioRef.current?.pause();
      setPlaying(false);
      return;
    }
    try {
      const absPath = `${libraryRoot}/${sound.file_path}`.replace(/\//g, "\\");
      const buf: ArrayBuffer = await invoke("read_audio_bytes", { path: absPath });
      if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
      const blob = new Blob([buf], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(false);
      audio.play();
      setPlaying(true);
    } catch (err) {
      console.error("play:", err);
    }
  }

  return (
    <div style={{ paddingLeft: "28px" }}>
      <div
        draggable
        onDragStart={handleDragStart}
        className="group flex flex-wrap items-center gap-1 px-2 py-1 text-xs hover:bg-panel-hover transition cursor-grab active:cursor-grabbing"
        title={`${sound.name_th || sound.name_en} (${sound.duration.toFixed(1)}s)`}
      >
        <GripVertical size={10} className="text-ink-faint/40 shrink-0 opacity-0 group-hover:opacity-100 transition" />
        <FileAudio size={12} className="text-lime/70 shrink-0" />
        <span className="truncate flex-1 min-w-[60px] text-ink-muted" title={sound.name_en}>
          {sound.name_th || sound.name_en}
          {sound.name_en && <span className="text-ink-faint/70 ml-1">· {sound.name_en}</span>}
        </span>
        {/* events this voice serves (multi) */}
        {sound.events.slice(0, 2).map((ev) => (
          <span key={ev} className="text-[8px] leading-none px-1 py-0.5 rounded bg-lime/10 text-lime/80 shrink-0">{ev}</span>
        ))}
        {sound.events.length > 2 && (
          <span className="text-[8px] text-ink-faint shrink-0">+{sound.events.length - 2}</span>
        )}
        {/* backlink: who uses this voice */}
        <button
          onClick={toggleUsage}
          title="ใช้ใน pack ไหนบ้าง"
          className={`grid place-items-center w-5 h-5 rounded transition shrink-0 ${showUsage ? "text-lime" : "text-ink-faint opacity-0 group-hover:opacity-100 hover:text-lime"}`}
        >
          <Link2 size={10} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); setRadar(true); }}
          title="impact radar — voice นี้ถูกใช้ที่ไหนบ้าง (กราฟ)"
          className="grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-lime transition shrink-0 opacity-0 group-hover:opacity-100"
        >
          <Radar size={10} />
        </button>
        <span className="text-[9px] font-mono text-ink-faint shrink-0">{sound.duration.toFixed(1)}s</span>
        <button
          onClick={handlePlay}
          className="grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-lime transition shrink-0 opacity-0 group-hover:opacity-100"
        >
          {playing ? <Square size={10} /> : <Play size={10} />}
        </button>
      </div>

      {showUsage && (
        <div className="pl-6 pr-2 pb-1 space-y-0.5">
          {usage === null ? (
            <div className="text-[9px] text-ink-faint">กำลังโหลด…</div>
          ) : usage.length === 0 ? (
            <div className="text-[9px] text-ink-faint">ยังไม่มี pack ไหนใช้เสียงนี้</div>
          ) : (
            usage.map((u, i) => (
              <div key={i} className="flex items-center gap-1 text-[9px] text-ink-muted">
                <Package size={8} className="text-lime/60 shrink-0" />
                <span className="truncate">{u.pack_name}</span>
                <span className="text-ink-faint shrink-0">· {u.event}</span>
              </div>
            ))
          )}
        </div>
      )}

      {radar && <ImpactRadar sound={sound} onClose={() => setRadar(false)} />}
    </div>
  );
}
