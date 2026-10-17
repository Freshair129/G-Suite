import Header from "./components/Header";
import RightRail from "./components/RightRail";
import StatusBar from "./components/StatusBar";
import GameProfile from "./components/GameProfile";
import SoundLibrary from "./components/SoundLibrary";
import Settings from "./components/Settings";
import EventTestGrid from "./components/EventTestGrid";
import SourceView from "./components/SourceView";
import OverlayLab from "./components/OverlayLab";
import { useStudioStore } from "./store/useStudioStore";
import { restoreGidSession, signInWithGoogle, signOutGid } from "./lib/gidAuth";
import { useEffect, useState } from "react";

export default function App() {
  const view = useStudioStore((s) => s.view);
  const studioAccess = useStudioStore((s) => s.studioAccess);
  const studioAccessError = useStudioStore((s) => s.studioAccessError);
  const undoClips = useStudioStore((s) => s.undoClips);
  const redoClips = useStudioStore((s) => s.redoClips);
  const [leftW, setLeftW] = useState(220);
  const [rightW, setRightW] = useState(340);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

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
    if (studioAccess !== "authorized") return;
    const timer = window.setInterval(() => { void restoreGidSession(); }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [studioAccess]);

  useEffect(() => {
    if (studioAccess !== "authorized") return;
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
  }, [studioAccess, undoClips, redoClips]);

  async function handleStudioSignIn() {
    setAuthBusy(true);
    setAuthError("");
    const error = await signInWithGoogle();
    setAuthError(error ?? "");
    setAuthBusy(false);
  }

  if (studioAccess !== "authorized") {
    return (
      <main className="h-screen grid place-items-center bg-base text-ink p-6">
        <section className="w-full max-w-md rounded-2xl border border-line bg-panel p-7 shadow-2xl">
          <h1 className="text-xl font-bold">G-AnnStudio</h1>
          <p className="mt-3 text-sm text-ink-muted">
            เครื่องมือสำหรับผู้พัฒนาและผู้ร่วมงานที่ได้รับอนุญาต ใช้บัญชี Google ที่อยู่ในรายชื่อทีมเพื่อเข้าใช้งาน
          </p>
          {studioAccess === "checking" ? (
            <p role="status" className="mt-5 text-sm text-ink-muted">กำลังตรวจสอบสิทธิ์…</p>
          ) : (
            <p role="alert" className="mt-5 text-sm text-red-300">
              {authError || studioAccessError || "บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน G-AnnStudio"}
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleStudioSignIn()}
            disabled={authBusy || studioAccess === "checking"}
            className="mt-5 w-full rounded-xl border border-lime/40 bg-lime/10 px-4 py-3 text-sm font-semibold text-lime hover:bg-lime/20 disabled:opacity-50"
          >
            {authBusy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบด้วย Google"}
          </button>
          {studioAccess === "denied" ? (
            <button
              type="button"
              onClick={() => void signOutGid()}
              className="mt-3 w-full rounded-xl border border-line px-4 py-2.5 text-sm text-ink-muted hover:bg-panel-hover"
            >
              ออกจากบัญชีนี้ / เปลี่ยนบัญชี
            </button>
          ) : null}
        </section>
      </main>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-base text-ink overflow-hidden">
      <Header />
      <div className="flex flex-1 min-h-0">
        {view === "settings" ? (
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
  );
}
