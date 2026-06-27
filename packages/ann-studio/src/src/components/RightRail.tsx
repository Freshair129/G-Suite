import { useState } from "react";
import { Scissors, MessageSquare } from "lucide-react";
import ClipList from "./ClipList";
import ChatPanel from "./ChatPanel";
import { useStudioStore } from "../store/useStudioStore";

type Tab = "clips" | "chat";

export default function RightRail() {
  const [tab, setTab] = useState<Tab>("clips");
  const clipCount = useStudioStore((s) => s.clips.length);

  return (
    <aside className="w-[340px] shrink-0 flex flex-col border-l border-line bg-base">
      {/* pill tabs */}
      <div className="p-3 shrink-0">
        <div className="flex bg-panel p-1 rounded-full border border-line">
          <button
            onClick={() => setTab("clips")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition ${
              tab === "clips" ? "bg-white/10 text-white" : "text-ink-faint hover:text-ink"
            }`}
          >
            <Scissors size={15} /> Clips
            {clipCount > 0 && (
              <span className="text-[10px] font-mono text-lime">{clipCount}</span>
            )}
          </button>
          <button
            onClick={() => setTab("chat")}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition ${
              tab === "chat" ? "bg-white/10 text-white" : "text-ink-faint hover:text-ink"
            }`}
          >
            <MessageSquare size={15} /> AI Chat
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0">{tab === "clips" ? <ClipList /> : <ChatPanel />}</div>
    </aside>
  );
}
