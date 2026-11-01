import PackWorkflow from "./components/PackWorkflow";
import Header from "./components/Header";
import RightRail from "./components/RightRail";
import StatusBar from "./components/StatusBar";
import GameProfile from "./components/GameProfile";
import SoundLibrary from "./components/SoundLibrary";
import Settings from "./components/Settings";
import EventTestGrid from "./components/EventTestGrid";
import SourceView from "./components/SourceView";
import OverlayLab from "./components/OverlayLab";
import RecoveryCandidateDialog from "./components/RecoveryCandidateDialog";
import { useStudioStore } from "./store/useStudioStore";
import { initializeProject, registerRecoveryPicker, type RecoveryListing } from "./lib/project";
import { restoreGidSession } from "./lib/gidAuth";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { layoutMode, railWidths } from "./responsiveLayout";

export default function App() {
  const view = useStudioStore((s) => s.view);
  const undoClips = useStudioStore((s) => s.undoClips);
  const redoClips = useStudioStore((s) => s.redoClips);
  const projectTransitionPending = useStudioStore((s) => s.projectTransitionPending);
  const [projectMessage,setProjectMessage]=useState<string|null>(null);
  const [recoveryRequest,setRecoveryRequest]=useState<{listing:RecoveryListing;resolve:(candidateId:string|null)=>void}|null>(null);
  const appContentRef=useRef<HTMLDivElement>(null);
  const transitionDialogRef=useRef<HTMLDivElement>(null);
  const [leftW, setLeftW] = useState(220);
  const [rightW, setRightW] = useState(340);

  const shellRef = useRef<HTMLDivElement>(null);
  const assetsButtonRef = useRef<HTMLButtonElement>(null);
  const agentButtonRef = useRef<HTMLButtonElement>(null);
  const resizeCleanup = useRef<(() => void) | null>(null);
  const [shellWidth, setShellWidth] = useState(0);
  const [drawer, setDrawer] = useState<"assets" | "agent" | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const mode = layoutMode(shellWidth);
  const widths = railWidths(shellWidth, leftW, rightW);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    let previousMode = layoutMode(0);
    const observer = new ResizeObserver(([entry]) => {
      const nextMode = layoutMode(entry.contentRect.width);
      if (nextMode !== previousMode) {
        const active = document.activeElement;
        if (nextMode === "compact" && document.getElementById("asset-rail")?.contains(active)) {
          assetsButtonRef.current?.focus();
        } else if (nextMode !== "wide" && document.getElementById("agent-rail")?.contains(active)) {
          agentButtonRef.current?.focus();
        }
      }
      previousMode = nextMode;
      setShellWidth(entry.contentRect.width);
    });
    observer.observe(shell);
    return () => { observer.disconnect(); resizeCleanup.current?.(); };
  }, []);

  useEffect(() => {
    if (drawer) {
      const rail = document.getElementById(drawer === "agent" ? "agent-rail" : "asset-rail");
      if (rail?.contains(document.activeElement)) {
        (drawer === "agent" ? agentButtonRef : assetsButtonRef).current?.focus();
      }
    }
    setDrawer(null);
    resizeCleanup.current?.();
  }, [mode, view]);
  useEffect(() => {
    function close(e: KeyboardEvent) {
      if (e.key !== "Escape" || !drawer) return;
      const rail = document.getElementById(drawer === "agent" ? "agent-rail" : "asset-rail");
      if (rail?.contains(document.activeElement)) {
        (drawer === "agent" ? agentButtonRef : assetsButtonRef).current?.focus();
      }
      setDrawer(null);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);

  function resizeKey(e: React.KeyboardEvent, side: "left" | "right") {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = (e.key === "ArrowRight" ? 10 : -10) * (side === "left" ? 1 : -1);
    if (side === "left") setLeftW(Math.max(200, Math.min(420, widths.left + delta)));
    else setRightW(Math.max(260, Math.min(560, widths.right + delta)));
  }

  function startResize(e: React.PointerEvent, side: "left" | "right") {
    e.preventDefault();
    resizeCleanup.current?.();
    const startX = e.clientX;
    const startW = side === "left" ? widths.left : widths.right;
    function move(ev: PointerEvent) {
      const proposed = startW + (side === "left" ? ev.clientX - startX : startX - ev.clientX);
      if (side === "left") setLeftW(Math.max(200, Math.min(420, proposed)));
      else setRightW(Math.max(260, Math.min(560, proposed)));
    }
    function cleanup() {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", cleanup);
      window.removeEventListener("pointercancel", cleanup);
      window.removeEventListener("blur", cleanup);
      resizeCleanup.current = null;
    }
    resizeCleanup.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", cleanup);
    window.addEventListener("pointercancel", cleanup);
    window.addEventListener("blur", cleanup);
  }

  useEffect(() => {
    const unregister=registerRecoveryPicker((listing)=>new Promise(resolve=>setRecoveryRequest(current=>{current?.resolve(null);return {listing,resolve};})));
    void restoreGidSession();
    void initializeProject().then(setProjectMessage).catch(e=>setProjectMessage(String(e)));
    return ()=>{unregister();setRecoveryRequest(current=>{current?.resolve(null);return null;});};
  }, []);

  useLayoutEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (projectTransitionPending) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || e.key.toLowerCase() !== "z") return;
      if (recoveryRequest) { e.preventDefault(); return; }
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) redoClips();
      else undoClips();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [undoClips, redoClips, projectTransitionPending, recoveryRequest]);

  useLayoutEffect(() => {
    const content=appContentRef.current;
    if(!content)return;
    if(!projectTransitionPending){content.removeAttribute("inert");return;}
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    content.setAttribute("inert","");
    transitionDialogRef.current?.focus();
    return ()=>{content.removeAttribute("inert");previousFocus?.focus();};
  }, [projectTransitionPending]);

  return (
    <div className="relative h-screen bg-base text-ink">
      <div ref={appContentRef} className="h-full flex flex-col overflow-hidden" aria-hidden={projectTransitionPending}>
        <Header />
        {projectMessage&&<p role="status" className="px-4 py-2 text-sm">{projectMessage}<button className="ml-3" onClick={()=>setProjectMessage(null)}>ปิด</button></p>}
        <div ref={shellRef} className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {view === "creator" ? (
          <PackWorkflow />
        ) : view === "settings" ? (
          <Settings />
        ) : view === "overlay" ? (
          <OverlayLab />
        ) : view === "test" ? (
          <EventTestGrid />
        ) : view === "profile" ? (
          <>
            <div className="w-[220px] shrink-0 flex min-h-0 overflow-hidden"><SoundLibrary /></div>
            <GameProfile />
          </>
        ) : (
          <div className="flex flex-col flex-1 min-w-0 min-h-0">
            <div className="shrink-0 flex gap-2 p-2 border-b border-line">
              <button ref={assetsButtonRef} className="px-3 py-2 rounded bg-panel border border-line" aria-expanded={mode === "compact" ? drawer === "assets" : !leftCollapsed} aria-controls="asset-rail" onClick={() => mode === "compact" ? setDrawer(drawer === "assets" ? null : "assets") : setLeftCollapsed(!leftCollapsed)}>Assets</button>
              <button ref={agentButtonRef} className="px-3 py-2 rounded bg-panel border border-line" aria-expanded={mode === "wide" ? !rightCollapsed : drawer === "agent"} aria-controls="agent-rail" onClick={() => mode === "wide" ? setRightCollapsed(!rightCollapsed) : setDrawer(drawer === "agent" ? null : "agent")}>Agent</button>
            </div>
            <div className="relative flex flex-1 min-w-0 min-h-0 overflow-hidden">
            <div id="asset-rail" className={mode === "compact" ? `absolute z-10 top-0 bottom-0 left-0 flex shadow-xl ${drawer === "assets" ? "" : "hidden"}` : `shrink-0 flex overflow-hidden ${leftCollapsed ? "hidden" : ""}`} style={{ width: mode === "compact" ? 260 : widths.left }}><SoundLibrary /></div>
            {mode !== "compact" && !leftCollapsed && <div role="separator" tabIndex={0} aria-label="Resize assets" aria-orientation="vertical" aria-valuemin={200} aria-valuemax={mode === "medium" ? 260 : 420} aria-valuenow={widths.left} onKeyDown={(e) => resizeKey(e, "left")} onPointerDown={(e) => startResize(e, "left")} className="w-2 shrink-0 cursor-col-resize bg-line/40 hover:bg-lime/50" title="ลากปรับความกว้าง" />}
            <div className="flex flex-1 min-w-0 min-h-0"><SourceView /></div>
            {mode === "wide" && !rightCollapsed && <div role="separator" tabIndex={0} aria-label="Resize agent" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={Math.min(560, shellWidth - widths.left - 576)} aria-valuenow={widths.right} onKeyDown={(e) => resizeKey(e, "right")} onPointerDown={(e) => startResize(e, "right")} className="w-2 shrink-0 cursor-col-resize bg-line/40 hover:bg-lime/50" title="ลากปรับความกว้าง" />}
            <div id="agent-rail" className={mode !== "wide" ? `absolute z-10 top-0 bottom-0 right-0 flex shadow-xl ${drawer === "agent" ? "" : "hidden"}` : `shrink-0 flex overflow-hidden ${rightCollapsed ? "hidden" : ""}`} style={{ width: mode === "wide" ? widths.right : 340 }}><RightRail /></div>
            </div>
          </div>
        )}
        </div>
        <StatusBar />
      </div>
      {projectTransitionPending&&<div ref={transitionDialogRef} tabIndex={-1} className="fixed inset-0 z-[110] grid place-items-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="project-transition-title"><span id="project-transition-title" className="rounded-lg border border-line bg-panel px-4 py-3">กำลังตรวจและเปิดโปรเจกต์…</span></div>}
      {recoveryRequest&&<RecoveryCandidateDialog listing={recoveryRequest.listing} onSelect={candidateId=>{recoveryRequest.resolve(candidateId);setRecoveryRequest(null);}} onCancel={()=>{recoveryRequest.resolve(null);setRecoveryRequest(null);}}/>}
    </div>
  );
}
