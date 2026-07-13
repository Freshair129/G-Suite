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
} from "lucide-react";
import { useStudioStore, type LibPkg, type LibSound } from "../store/useStudioStore";

export default function SoundLibrary() {
  const { libraryRoot, libraryPackages, setLibrary, setLibraryPackages,
    sourcePath, duration, clips } = useStudioStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pkgSounds, setPkgSounds] = useState<Record<string, LibSound[]>>({});
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
                  onClick={() => togglePkg(pkg.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-ink-muted hover:bg-panel-hover transition group"
                >
                  {expanded[pkg.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                  <Package size={13} className="text-lime/70 shrink-0" />
                  <span className="truncate flex-1 text-left">{pkg.name}</span>
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
        <div className="flex-1 overflow-y-auto px-3 py-2">
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
    </aside>
  );
}

function SoundRow({ sound, libraryRoot }: { sound: LibSound; libraryRoot: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.setData("application/x-library-sound", sound.file_path);
    e.dataTransfer.setData("text/plain", sound.name);
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
    <div
      draggable
      onDragStart={handleDragStart}
      className="group flex items-center gap-1 px-2 py-1 text-xs hover:bg-panel-hover transition cursor-grab active:cursor-grabbing"
      style={{ paddingLeft: "28px" }}
      title={`${sound.name} (${sound.duration.toFixed(1)}s)`}
    >
      <GripVertical size={10} className="text-ink-faint/40 shrink-0 opacity-0 group-hover:opacity-100 transition" />
      <FileAudio size={12} className="text-lime/70 shrink-0" />
      <span className="truncate flex-1 text-ink-muted">{sound.name}</span>
      <span className="text-[9px] font-mono text-ink-faint shrink-0">{sound.duration.toFixed(1)}s</span>
      <button
        onClick={handlePlay}
        className="grid place-items-center w-5 h-5 rounded text-ink-faint hover:text-lime transition shrink-0 opacity-0 group-hover:opacity-100"
      >
        {playing ? <Square size={10} /> : <Play size={10} />}
      </button>
    </div>
  );
}
