import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useStudioStore, type Pack, type LibPkg, type LibSound } from "../store/useStudioStore";
import { open } from "@tauri-apps/plugin-dialog";
import { installSavedPack, installGann } from "../lib/exportGmaidenPack";
import PackCreator from "./PackCreator";
import PackEditor from "./PackEditor";
import {
  Plus,
  Package,
  Trash2,
  Plug,
  RefreshCw,
  CheckCircle2,
  FolderOutput,
  Gamepad2,
  Layers,
  FileAudio,
  Settings2,
  Play,
  Square,
  ChevronDown,
  ChevronRight,
  Headphones,
  Zap,
} from "lucide-react";

const TYPE_ICONS: Record<string, typeof Layers> = {
  full: Layers,
  single: FileAudio,
  custom: Settings2,
};

const TYPE_LABELS: Record<string, string> = {
  full: "Full Pack",
  single: "Single",
  custom: "Custom",
};

interface GMaidenStatus {
  found: boolean;
  path: string;
}

export default function GameProfile() {
  const {
    packs,
    setPacks,
    activePackId,
    setActivePack,
    gmaidenConnected,
    gmaidenPath,
    setGMaiden,
  } = useStudioStore();
  const [showCreator, setShowCreator] = useState(false);
  const [loading, setLoading] = useState(false);
  const [integrating, setIntegrating] = useState(false);
  const [quickInstalling, setQuickInstalling] = useState(false);

  useEffect(() => {
    loadPacks();
  }, []);

  async function loadPacks() {
    setLoading(true);
    try {
      const loaded: Pack[] = await invoke("load_packs");
      setPacks(loaded);
    } catch (e) {
      console.error("load_packs:", e);
    } finally {
      setLoading(false);
    }
  }

  async function handleIntegrate() {
    setIntegrating(true);
    try {
      const status: GMaidenStatus = await invoke("check_gmaiden", {
        gmaidenDir: null,
      });
      if (!status.found) {
        alert(
          "หา G-Maiden ไม่เจอ — ให้แน่ใจว่า repo G-Maiden อยู่ข้าง ๆ G-Suite หรือตั้ง env GMAIDEN_DIR"
        );
        setGMaiden(false, "", {});
        return;
      }
      const scan: {
        voice_cache_path: string;
        entries: { event: string; files: string[] }[];
      } = await invoke("scan_voice_cache", { gmaidenDir: null });
      const cacheMap: Record<string, string[]> = {};
      for (const entry of scan.entries) {
        cacheMap[entry.event] = entry.files;
      }
      setGMaiden(true, status.path, cacheMap);
    } catch (e) {
      alert(String(e));
    } finally {
      setIntegrating(false);
    }
  }

  async function handleDelete(pack: Pack) {
    if (!confirm(`ลบ pack "${pack.name}"?`)) return;
    try {
      await invoke("delete_pack", { packId: pack.id });
      setPacks(packs.filter((p) => p.id !== pack.id));
      if (activePackId === pack.id) setActivePack(null);
    } catch (e) {
      alert(`ลบไม่สำเร็จ: ${e}`);
    }
  }

  async function handleExportToGMaiden(pack: Pack) {
    if (!gmaidenConnected) {
      alert("กรุณา Integrate G-Maiden ก่อน");
      return;
    }
    try {
      const installed=await installSavedPack(pack);
      alert(`ติดตั้ง GANN แล้ว: ${installed.pack_id}`);
      handleIntegrate();
    } catch (e) {
      alert(`ส่งไม่สำเร็จ: ${e}`);
    }
  }

  async function handleQuickInstall() {
    if (!gmaidenConnected) {
      alert("กรุณา Integrate G-Maiden ก่อน");
      return;
    }
    setQuickInstalling(true);
    try {
      const path=await open({title:'ติดตั้ง GANN',filters:[{name:'G-Ann Package',extensions:['gann']}]});if(typeof path!=='string')return;
      const result=await installGann(path);alert(`ติดตั้ง GANN แล้ว: ${result.pack_id}`);
      handleIntegrate();
    } catch (e) {
      alert(`ติดตั้งไม่สำเร็จ: ${e}`);
    } finally {
      setQuickInstalling(false);
    }
  }

  const activePack = packs.find((p) => p.id === activePackId);

  if (activePack) {
    return <PackEditor pack={activePack} />;
  }

  return (
    <div className="flex-1 flex min-w-0 min-h-0">
    {/* Left: main content */}
    <div className="flex-1 flex flex-col min-w-0 min-h-0 p-6 overflow-y-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-10 h-10 rounded-xl bg-panel border border-line">
            <Gamepad2 size={20} className="text-lime" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Game Profile</h2>
            <p className="text-xs text-ink-faint">
              Dota 2 — G-Maiden Announcer Packs
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleIntegrate}
            disabled={integrating}
            className={`flex shrink-0 whitespace-nowrap items-center gap-2 px-4 h-9 rounded-full text-xs font-medium transition disabled:opacity-50 ${
              gmaidenConnected
                ? "bg-panel border border-line text-ink hover:bg-panel-hover"
                : "bg-panel border border-lime/30 text-lime hover:bg-lime/10"
            }`}
          >
            {integrating ? (
              <RefreshCw size={14} className="animate-spin" />
            ) : gmaidenConnected ? (
              <CheckCircle2 size={14} className="text-lime" />
            ) : (
              <Plug size={14} />
            )}
            {integrating
              ? "กำลังเชื่อมต่อ…"
              : gmaidenConnected
              ? "G-Maiden Connected"
              : "Integrate G-Maiden"}
          </button>

          {gmaidenConnected && (
            <button
              onClick={handleQuickInstall}
              disabled={quickInstalling}
              className="flex shrink-0 whitespace-nowrap items-center gap-2 px-4 h-9 rounded-full bg-orange-500/20 border border-orange-500/40 text-orange-400 text-xs font-medium hover:bg-orange-500/30 transition disabled:opacity-50"
            >
              {quickInstalling ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <Zap size={14} />
              )}
              {quickInstalling ? "กำลังติดตั้ง…" : "ติดตั้ง .gann"}
            </button>
          )}

          <button
            onClick={() => setShowCreator(true)}
            className="flex shrink-0 whitespace-nowrap items-center gap-2 px-5 h-9 rounded-full bg-gradient-to-r from-lime to-grass text-black text-xs font-semibold hover:opacity-90 transition"
          >
            <Plus size={15} />
            เพิ่ม Pack
          </button>
        </div>
      </div>

      {/* G-Maiden status */}
      {gmaidenConnected && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-lime/5 border border-lime/20 flex items-center gap-2 text-xs">
          <CheckCircle2 size={14} className="text-lime shrink-0" />
          <span className="text-ink-muted">G-Maiden</span>
          <span className="font-mono text-ink-faint truncate max-w-[400px]">
            {gmaidenPath}
          </span>
        </div>
      )}

      {/* Pack list */}
      {loading ? (
        <div className="flex-1 grid place-items-center">
          <RefreshCw size={24} className="animate-spin text-ink-faint" />
        </div>
      ) : packs.length === 0 ? (
        <div className="flex-1 grid place-items-center">
          <div className="text-center space-y-4">
            <div className="grid place-items-center w-20 h-20 rounded-3xl bg-panel border border-line mx-auto">
              <Package size={32} className="text-ink-faint" />
            </div>
            <div>
              <p className="text-ink-muted text-sm">ยังไม่มี Pack</p>
              <p className="text-ink-faint text-xs mt-1">
                กด <span className="text-lime">เพิ่ม Pack</span> เพื่อเริ่มสร้าง
                voice pack สำหรับ G-Maiden
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3">
          {packs.map((pack) => {
            const Icon = TYPE_ICONS[pack.pack_type] ?? Layers;
            const mapped = Object.keys(pack.mappings).length;
            const total = pack.events.length;
            const pct = total > 0 ? Math.round((mapped / total) * 100) : 0;

            return (
              <div
                key={pack.id}
                onClick={() => setActivePack(pack.id)}
                className="group relative flex items-center gap-4 p-4 rounded-2xl border border-line bg-panel/50 hover:bg-panel-hover/70 hover:border-white/15 cursor-pointer transition"
              >
                <div className="grid place-items-center w-12 h-12 rounded-xl bg-base border border-line shrink-0">
                  <Icon size={22} className="text-lime" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold truncate">
                      {pack.name}
                    </h4>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-panel border border-line text-ink-faint">
                      {TYPE_LABELS[pack.pack_type]}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-ink-faint">
                    <span>
                      {mapped}/{total} events mapped
                    </span>
                    <span className="text-line">·</span>
                    <span>
                      {new Date(pack.updated_at).toLocaleDateString("th-TH", {
                        day: "numeric",
                        month: "short",
                        year: "2-digit",
                      })}
                    </span>
                  </div>
                  {/* mini progress */}
                  <div className="mt-2 h-1 rounded-full bg-base border border-line/50 overflow-hidden max-w-[200px]">
                    <div
                      className="h-full rounded-full bg-lime/60 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                  {gmaidenConnected && mapped > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportToGMaiden(pack);
                      }}
                      className="flex items-center gap-1 px-3 h-8 rounded-full bg-lime/10 text-lime text-[11px] font-medium hover:bg-lime/20 transition"
                      title="ส่งไป G-Maiden"
                    >
                      <FolderOutput size={13} />
                      ส่ง G-Maiden
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(pack);
                    }}
                    className="grid place-items-center w-8 h-8 rounded-xl text-ink-faint hover:text-danger hover:bg-danger/10 transition"
                    title="ลบ pack"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showCreator && <PackCreator onClose={() => setShowCreator(false)} />}
    </div>{/* end left column */}

    {/* Quick Play sidebar */}
    <QuickPlayPanel />
    </div>
  );
}

// ============================================================
// QUICK PLAY PANEL — waveform rows for auditioning pack sounds
// ============================================================
function QuickPlayPanel() {
  const { libraryRoot, libraryPackages } = useStudioStore();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [pkgSounds, setPkgSounds] = useState<Record<string, LibSound[]>>({});

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

  return (
    <div className="w-[300px] shrink-0 border-l border-line bg-panel/30 flex flex-col">
      <div className="flex items-center gap-2 px-4 h-12 shrink-0 border-b border-line">
        <Headphones size={15} className="text-lime" />
        <span className="text-xs font-semibold text-ink-muted">Quick Play</span>
        <span className="text-[9px] text-ink-faint ml-auto">Ann Pack Preview</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {libraryPackages.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Headphones size={24} className="mx-auto text-ink-faint mb-2" />
            <p className="text-[11px] text-ink-faint leading-relaxed">
              ยังไม่มีเสียงใน Library
              <br />
              ใช้ <span className="text-lime">Save to Lib</span> ใน Studio ก่อน
            </p>
          </div>
        ) : (
          libraryPackages.map((pkg) => (
            <div key={pkg.id}>
              <button
                onClick={() => togglePkg(pkg.id)}
                className="w-full flex items-center gap-2 px-4 py-2.5 text-xs text-ink-muted hover:bg-panel-hover transition border-b border-line/20"
              >
                {expanded[pkg.id] ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                <Package size={13} className="text-lime/70 shrink-0" />
                <span className="truncate flex-1 text-left font-medium">{pkg.name}</span>
                <span className="text-[9px] font-mono text-ink-faint">{pkg.clip_count}</span>
              </button>
              {expanded[pkg.id] && (
                <div className="py-1">
                  {(pkgSounds[pkg.id] || []).map((sound) => (
                    <QuickPlayRow key={sound.id} sound={sound} libraryRoot={libraryRoot} />
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function QuickPlayRow({ sound, libraryRoot }: { sound: LibSound; libraryRoot: string }) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);

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

  const barCount = Math.max(12, Math.min(40, Math.floor(sound.duration * 10)));

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2 hover:bg-panel-hover/50 transition ${
        playing ? "bg-white/[0.03]" : ""
      }`}
    >
      {/* Play button */}
      <button
        onClick={handlePlay}
        className={`grid place-items-center w-7 h-7 rounded-full border shrink-0 transition ${
          playing
            ? "border-lime/40 text-lime bg-lime/10"
            : "border-white/20 text-ink-faint hover:text-lime hover:border-lime/40"
        }`}
      >
        {playing ? <Square size={9} /> : <Play size={9} className="ml-0.5" />}
      </button>

      {/* Waveform bars */}
      <div className="flex-1 flex items-center gap-[1px] h-5 overflow-hidden">
        {Array.from({ length: barCount }).map((_, i) => {
          const h = 18 + Math.sin(i * 0.8 + sound.idx) * 30 + Math.cos(i * 1.5) * 25 + Math.sin(i * 2.3) * 12;
          const isPlayed = playing && i / barCount < 0.5;
          return (
            <div
              key={i}
              className="shrink-0 rounded-sm transition-colors"
              style={{
                width: 2,
                height: `${Math.max(12, Math.min(100, h))}%`,
                background: isPlayed ? "#e0ff00" : "rgba(255,255,255,0.2)",
              }}
            />
          );
        })}
      </div>

      {/* Duration */}
      <span className="text-[9px] font-mono text-ink-faint shrink-0 tabular-nums">
        {Math.floor(sound.duration / 60).toString().padStart(2, "0")}:
        {Math.floor(sound.duration % 60).toString().padStart(2, "0")}
      </span>
    </div>
  );
}
