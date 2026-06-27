import { useStudioStore } from "../store/useStudioStore";
import EventPicker from "./EventPicker";
import { IconTrash, IconScissors } from "./icons";

export default function ClipList() {
  const { clips, selectedClipId, selectClip, updateClip, removeClip, setClips } = useStudioStore();
  const ordered = clips.slice().sort((a, b) => a.start - b.start);

  return (
    <aside className="w-[300px] shrink-0 flex flex-col border-l border-line bg-surface/50">
      <div className="flex items-center justify-between px-4 h-14 border-b border-line shrink-0">
        <div className="flex items-center gap-2">
          <IconScissors size={15} className="text-mint-400" />
          <span className="text-sm font-semibold">Clips</span>
          <span className="text-xs text-ink-faint">{clips.length}</span>
        </div>
        {clips.length > 0 && (
          <button
            onClick={() => confirm("ลบ clips ทั้งหมด?") && setClips([])}
            className="text-xs text-ink-faint hover:text-danger transition-colors"
          >
            ล้างทั้งหมด
          </button>
        )}
      </div>

      {clips.length === 0 ? (
        <div className="flex-1 grid place-items-center p-6">
          <p className="text-sm text-ink-faint text-center leading-relaxed">
            ลากบน waveform เพื่อสร้าง clip
            <br />
            หรือกด <span className="text-mint-400">แยกอัตโนมัติ</span>
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
          {ordered.map((clip, i) => {
            const selected = clip.id === selectedClipId;
            return (
              <div
                key={clip.id}
                onClick={() => selectClip(clip.id)}
                className={`group relative rounded-xl border px-3 py-2.5 cursor-pointer transition-all ${
                  selected
                    ? "border-mint-400/60 bg-mint-400/[0.07] shadow-glow"
                    : "border-line bg-surface-raised/40 hover:bg-surface-hover/60 hover:border-white/12"
                }`}
              >
                <span
                  className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-full"
                  style={{ background: clip.color || "#58afe7" }}
                />
                <div className="flex items-center gap-2 mb-1.5 pl-1.5">
                  <span className="text-[10px] font-mono text-ink-faint w-5 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <input
                    value={clip.name}
                    onChange={(e) => updateClip(clip.id, { name: e.target.value })}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 bg-transparent text-sm text-ink outline-none border-b border-transparent focus:border-mint-400/50 truncate"
                    placeholder="ชื่อ clip"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeClip(clip.id);
                    }}
                    className="grid place-items-center w-6 h-6 rounded-md text-ink-faint opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition-all shrink-0"
                    title="ลบ clip"
                  >
                    <IconTrash size={14} />
                  </button>
                </div>

                <div className="flex items-center gap-2 pl-1.5 mb-2">
                  <span className="font-mono text-[11px] text-ink-muted tabular-nums">
                    {clip.start.toFixed(2)}–{clip.end.toFixed(2)}s
                  </span>
                  <span className="font-mono text-[10px] text-mint-400/80 bg-mint-400/10 rounded px-1.5 py-0.5">
                    {(clip.end - clip.start).toFixed(2)}s
                  </span>
                </div>

                <div className="pl-1.5" onClick={(e) => e.stopPropagation()}>
                  <EventPicker
                    value={clip.event}
                    onChange={(event) => updateClip(clip.id, { event })}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </aside>
  );
}
