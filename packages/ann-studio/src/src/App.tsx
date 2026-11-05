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
        <div className="flex flex-1 min-h-0">
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
      {projectTransitionPending&&<div ref={transitionDialogRef} tabIndex={-1} className="fixed inset-0 z-[110] grid place-items-center bg-black/50" role="dialog" aria-modal="true" aria-labelledby="project-transition-title"><span id="project-transition-title" className="rounded-lg border border-line bg-panel px-4 py-3">กำลังตรวจและเปิดโปรเจกต์…</span></div>}
      {recoveryRequest&&<RecoveryCandidateDialog listing={recoveryRequest.listing} onSelect={candidateId=>{recoveryRequest.resolve(candidateId);setRecoveryRequest(null);}} onCancel={()=>{recoveryRequest.resolve(null);setRecoveryRequest(null);}}/>}
    </div>
  );
}
