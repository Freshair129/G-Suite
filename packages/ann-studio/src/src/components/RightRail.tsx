import { Bot } from "lucide-react";
import ChatPanel from "./ChatPanel";

// The right rail is the agent chat only (clips editing lives in the main area).
export default function RightRail() {
  return (
    <aside className="w-full shrink-0 flex flex-col border-l border-line bg-base">
      <div className="shrink-0 flex items-center gap-2 px-4 h-12 border-b border-line">
        <div className="grid place-items-center w-6 h-6 rounded-lg bg-gradient-to-tr from-lime to-grass text-black">
          <Bot size={14} />
        </div>
        <span className="text-sm font-semibold text-ink">Agent</span>
      </div>
      <div className="flex-1 min-h-0">
        <ChatPanel />
      </div>
    </aside>
  );
}
