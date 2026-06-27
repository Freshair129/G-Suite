import { useStudioStore } from "../store/useStudioStore";
import EventPicker from "./EventPicker";

export default function ClipList() {
  const { clips, selectedClipId, selectClip, updateClip, removeClip } =
    useStudioStore();

  if (clips.length === 0) {
    return (
      <div className="w-80 bg-panel border-l border-gray-800 flex items-center justify-center p-4">
        <p className="text-gray-600 text-sm text-center">
          ลาก region บน waveform เพื่อสร้าง clip
        </p>
      </div>
    );
  }

  return (
    <div className="w-80 bg-panel border-l border-gray-800 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-ice-300">
        Clips ({clips.length})
      </div>
      <div className="flex-1 overflow-y-auto">
        {clips
          .slice()
          .sort((a, b) => a.start - b.start)
          .map((clip) => (
            <div
              key={clip.id}
              onClick={() => selectClip(clip.id)}
              className={`px-3 py-2 border-b border-gray-800/50 cursor-pointer transition-colors ${
                clip.id === selectedClipId
                  ? "bg-ice-600/20 border-l-2 border-l-ice-400"
                  : "hover:bg-gray-800/50"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <input
                  value={clip.name}
                  onChange={(e) => updateClip(clip.id, { name: e.target.value })}
                  onClick={(e) => e.stopPropagation()}
                  className="flex-1 bg-transparent text-sm text-gray-200 outline-none border-b border-transparent focus:border-ice-400"
                  placeholder="ชื่อ clip"
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeClip(clip.id);
                  }}
                  className="text-red-500/60 hover:text-red-400 text-xs px-1"
                  title="ลบ clip"
                >
                  ✕
                </button>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>
                  {clip.start.toFixed(2)}s — {clip.end.toFixed(2)}s
                </span>
                <span className="text-gray-600">
                  ({(clip.end - clip.start).toFixed(2)}s)
                </span>
              </div>

              <div className="mt-1" onClick={(e) => e.stopPropagation()}>
                <EventPicker
                  value={clip.event}
                  onChange={(event) => updateClip(clip.id, { event })}
                />
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
