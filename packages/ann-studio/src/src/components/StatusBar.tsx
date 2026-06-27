import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Cpu, MemoryStick, Monitor, HardDrive } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";

interface SystemStats {
  cpu_percent: number;
  ram_used_mb: number;
  ram_total_mb: number;
  ram_percent: number;
  gpu_percent: number;
  vram_used_mb: number;
  vram_total_mb: number;
  vram_percent: number;
}

export default function StatusBar() {
  const { sourcePath, duration, clips, transcribing, trackItems } = useStudioStore();
  const covered = clips.reduce((sum, c) => sum + (c.end - c.start), 0);
  const pct = duration > 0 ? Math.min(100, (covered / duration) * 100) : 0;

  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      while (alive) {
        try {
          const s: SystemStats = await invoke("get_system_stats");
          if (alive) setStats(s);
        } catch {}
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    poll();
    return () => { alive = false; };
  }, []);

  return (
    <footer className="flex items-center gap-3 px-4 h-8 shrink-0 border-t border-line bg-base text-[10px] text-ink-faint font-mono">
      {/* Status indicator */}
      <span className={`shrink-0 ${transcribing ? "text-lime animate-pulse" : sourcePath ? "text-lime" : ""}`}>
        {transcribing ? "● Processing" : sourcePath ? "● Ready" : "○ Idle"}
      </span>

      {duration > 0 && (
        <>
          <Sep />
          <span>{duration.toFixed(1)}s</span>
          <Sep />
          <span>{clips.length} clips</span>
          <Sep />
          <span>{pct.toFixed(0)}%</span>
        </>
      )}

      {trackItems.length > 0 && (
        <>
          <Sep />
          <span>{trackItems.length} items</span>
        </>
      )}

      <div className="flex-1" />

      {/* System monitors */}
      {stats && (
        <div className="flex items-center gap-3">
          <UsageBar
            icon={<Cpu size={10} />}
            label="CPU"
            percent={stats.cpu_percent}
            detail={`${stats.cpu_percent.toFixed(0)}%`}
            color="lime"
          />
          <UsageBar
            icon={<MemoryStick size={10} />}
            label="RAM"
            percent={stats.ram_percent}
            detail={`${formatMB(stats.ram_used_mb)}/${formatMB(stats.ram_total_mb)} ${stats.ram_percent.toFixed(0)}%`}
            color="sky"
          />
          <UsageBar
            icon={<Monitor size={10} />}
            label="GPU"
            percent={stats.gpu_percent}
            detail={`${stats.gpu_percent.toFixed(0)}%`}
            color="amber"
          />
          <UsageBar
            icon={<HardDrive size={10} />}
            label="VRAM"
            percent={stats.vram_percent}
            detail={`${stats.vram_used_mb}/${stats.vram_total_mb}MB ${stats.vram_percent.toFixed(0)}%`}
            color="purple"
          />
        </div>
      )}
    </footer>
  );
}

function Sep() {
  return <span className="text-line/40">|</span>;
}

function formatMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  return `${mb}MB`;
}

const BAR_COLORS: Record<string, { bg: string; fill: string; text: string }> = {
  lime: { bg: "bg-lime/10", fill: "bg-lime", text: "text-lime" },
  sky: { bg: "bg-sky-400/10", fill: "bg-sky-400", text: "text-sky-400" },
  amber: { bg: "bg-amber-400/10", fill: "bg-amber-400", text: "text-amber-400" },
  purple: { bg: "bg-purple-400/10", fill: "bg-purple-400", text: "text-purple-400" },
};

function UsageBar({ icon, label, percent, detail, color }: {
  icon: React.ReactNode; label: string; percent: number; detail: string; color: string;
}) {
  const c = BAR_COLORS[color] ?? BAR_COLORS.lime;
  const clamped = Math.max(0, Math.min(100, percent));
  const warn = clamped > 85;

  return (
    <div className="flex items-center gap-1.5 group" title={`${label}: ${detail}`}>
      <span className={`${c.text} shrink-0 ${warn ? "animate-pulse" : ""}`}>{icon}</span>
      <span className="text-[9px] text-ink-faint w-7 shrink-0">{label}</span>
      <div className={`relative w-14 h-[5px] rounded-full overflow-hidden ${c.bg}`}>
        <div
          className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${c.fill} ${warn ? "opacity-100" : "opacity-70"}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="text-[8px] text-ink-faint w-[72px] text-right truncate hidden group-hover:inline-block">
        {detail}
      </span>
      <span className="text-[9px] text-ink-faint w-6 text-right group-hover:hidden">
        {clamped.toFixed(0)}%
      </span>
    </div>
  );
}
