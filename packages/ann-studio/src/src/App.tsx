import Header from "./components/Header";
import RightRail from "./components/RightRail";
import StatusBar from "./components/StatusBar";
import GameProfile from "./components/GameProfile";
import SoundLibrary from "./components/SoundLibrary";
import Settings from "./components/Settings";
import EventTestGrid from "./components/EventTestGrid";
import SourceView from "./components/SourceView";
import { useStudioStore } from "./store/useStudioStore";
import { restoreGidSession } from "./lib/gidAuth";
import { useEffect, useState } from "react";

export default function App() {
  const view = useStudioStore((s) => s.view);
  const undoClips = useStudioStore((s) => s.undoClips);
  const redoClips = useStudioStore((s) => s.redoClips);
  const [leftW, setLeftW] = useState(220);
  const [rightW, setRightW] = useState(340);

  function startLeftResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX; const startW = leftW;
    function move(ev: PointerEvent) { setLeftW(Math.max(160, Math.min(420, startW + (ev.clientX - startX)))); }
    function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function startRightResize(e: React.PointerEvent) {
    e.preventDefault();
    const startX = e.clientX; const startW = rightW;
    function move(ev: PointerEvent) { setRightW(Math.max(260, Math.min(560, startW + (startX - ev.clientX)))); }
    function up() { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  useEffect(() => {
    void restoreGidSession();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redoClips();
      else undoClips();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undoClips, redoClips]);

  return (
    <div className="h-screen flex flex-col bg-base text-ink overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        {view === "settings" ? (
          <Settings />
        ) : view === "test" ? (
          <EventTestGrid />
        ) : view === "profile" ? (
          <>
            <SoundLibrary />
            <GameProfile />
          </>
        ) : (
          /* studio = library (left) + source/clips editor (main) + agent chat (right) */
          <>
            <div className="shrink-0 flex overflow-hidden" style={{ width: leftW }}><SoundLibrary /></div>
            <div onPointerDown={startLeftResize} className="w-2 shrink-0 cursor-col-resize bg-line/40 hover:bg-lime/50 transition flex items-center justify-center group" title="ลากปรับความกว้าง">
              <div className="h-10 w-0.5 rounded-full bg-white/20 group-hover:bg-white/50" />
            </div>
            <SourceView />
            <div onPointerDown={startRightResize} className="w-2 shrink-0 cursor-col-resize bg-line/40 hover:bg-lime/50 transition flex items-center justify-center group" title="ลากปรับความกว้าง">
              <div className="h-10 w-0.5 rounded-full bg-white/20 group-hover:bg-white/50" />
            </div>
            <div className="shrink-0 flex overflow-hidden" style={{ width: rightW }}><RightRail /></div>
          </>
        )}
      </div>
      <StatusBar />
    </div>
  );
}
