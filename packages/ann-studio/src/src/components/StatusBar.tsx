import { useStudioStore } from "../store/useStudioStore";

export default function StatusBar() {
  const { sourcePath, duration, clips, transcribing } = useStudioStore();
  const covered = clips.reduce((sum, c) => sum + (c.end - c.start), 0);
  const pct = duration > 0 ? Math.min(100, (covered / duration) * 100) : 0;

  return (
    <footer className="flex items-center gap-4 px-6 h-7 shrink-0 border-t border-line bg-base text-[11px] text-ink-faint font-mono">
      <span className={transcribing ? "text-lime animate-pulse" : sourcePath ? "text-lime" : ""}>
        {transcribing ? "● กำลังถอดเสียง" : sourcePath ? "● พร้อมใช้งาน" : "○ ยังไม่มีไฟล์"}
      </span>
      {duration > 0 && (
        <>
          <span className="text-line">|</span>
          <span>ความยาว {duration.toFixed(1)}s</span>
          <span className="text-line">|</span>
          <span>{clips.length} clips</span>
          <span className="text-line">|</span>
          <span>ครอบคลุม {pct.toFixed(0)}%</span>
        </>
      )}
      <span className="ml-auto">WAV · 44.1 kHz · mono</span>
    </footer>
  );
}
