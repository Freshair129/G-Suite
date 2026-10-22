// @req GOE-004 — routes the event preview and preserves the existing HUD-layout surface.
// @spec SDD-004 — keeps explicit local HUD sync separate from BannerProject authoring.
// @designs docs/g-overlay-lab.md
import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Send, Sparkles } from "lucide-react";
import BannerEditor from "./BannerEditor";
import { OverlayCanvasStage } from "./OverlayCanvasStage";
import { OverlayConflictList } from "./OverlayConflictList";
import { OverlayInspector } from "./OverlayInspector";
import { OverlayModuleShelf } from "./OverlayModuleShelf";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { toneBannerPngDataUrl } from "../lib/toneBanner";
import {
  cloneDefaultOverlayLayout,
  getOverlayConflictItems,
  syncOverlayLayout,
  type OverlayLayout,
  type OverlayModuleId,
  type StageScreen,
} from "../lib/overlayLayout";
import {
  labView,
  restoreLabScreenshot,
  setLabEventId,
  setLabScreenshot,
  setLabSurface,
  type LabSurface,
} from "../lib/labView";
import { useStudioStore } from "../store/useStudioStore";

// Surface, event and screenshot live in lib/labView so they survive both a tab
// switch (OverlayLab unmounts) and an app restart. See that file for why the
// screenshot goes to IndexedDB rather than localStorage or the project store.

export default function OverlayLab() {
  const layout = useStudioStore((s) => s.overlayLayout);
  const setLayout = useStudioStore((s) => s.setOverlayLayout);
  const bannerOverrides = useStudioStore((s) => s.bannerOverrides);
  const [selectedId, setSelectedId] = useState<OverlayModuleId | null>("alert");
  const [previewLayout, setPreviewLayout] = useState<OverlayLayout | null>(null);
  const gestureStartLayout = useRef<OverlayLayout | null>(null);
  const gesturePreviewLayout = useRef<OverlayLayout | null>(null);
  const [screen, setScreen] = useState<StageScreen>("ingame");
  const [playing, setPlaying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("Draft only. Sync when you are happy with the HUD clearance.");
  const viewLayout = previewLayout ?? layout;
  const conflictItems = useMemo(() => getOverlayConflictItems(viewLayout, screen), [viewLayout, screen]);
  const warningIds = useMemo(() => new Set(conflictItems.flatMap(({ moduleId, otherModuleId }) =>
    otherModuleId ? [moduleId, otherModuleId] : [moduleId],
  )), [conflictItems]);

  // Seed from the cache above and write back on every change, so a tab switch
  // returns you to the surface, event and screenshot you left.
  const [eventId, setEventIdState] = useState(labView.eventId);
  const [screenUrl, setScreenUrlState] = useState<string | null>(labView.screenUrl);
  const [surface, setSurfaceState] = useState<"banner" | "hud">(labView.surface);

  const setEventId = (value: string) => { setLabEventId(value); setEventIdState(value); };
  const setSurface = (value: LabSurface) => { setLabSurface(value); setSurfaceState(value); };

  // Rehydrate a screenshot saved by a previous run. No revoke-on-unmount here:
  // the object URL has to outlive this component, or returning to the tab would
  // show a dead image. labView owns the single live URL and revokes the old one
  // when a new screenshot replaces it.
  useEffect(() => {
    let live = true;
    void restoreLabScreenshot().then((url) => { if (live && url) setScreenUrlState(url); });
    return () => { live = false; };
  }, []);

  const update = (id: OverlayModuleId, patch: Partial<OverlayLayout[OverlayModuleId]>) => {
    setLayout({ ...layout, [id]: { ...layout[id], ...patch } });
  };

  const beginLayoutGesture = () => {
    gestureStartLayout.current = layout;
    gesturePreviewLayout.current = layout;
    setPreviewLayout(layout);
  };

  const setGesturePreview = (next: OverlayLayout) => {
    gesturePreviewLayout.current = next;
    setPreviewLayout(next);
  };

  const previewLayoutPatch = (id: OverlayModuleId, patch: Partial<OverlayLayout[OverlayModuleId]>) => {
    const current = gesturePreviewLayout.current ?? layout;
    const next = { ...current, [id]: { ...current[id], ...patch } };
    setGesturePreview(next);
  };

  const clearLayoutGesture = () => {
    gestureStartLayout.current = null;
    gesturePreviewLayout.current = null;
    setPreviewLayout(null);
  };

  const commitLayoutGesture = (next = gesturePreviewLayout.current) => {
    if (next) setLayout(next);
    clearLayoutGesture();
  };

  const endLayoutGesture = () => {
    if (gestureStartLayout.current) commitLayoutGesture();
  };

  const preview = () => {
    setPlaying(true);
    window.setTimeout(() => setPlaying(false), 3500);
  };

  const loadScreenshot = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    // labView stores the Blob and returns the new URL, revoking the previous one.
    void setLabScreenshot(file).then((url) => setScreenUrlState(url));
  };

  const sync = async () => {
    setSyncing(true);
    try {
      await syncOverlayLayout(layout);
      setNotice("Synced to G-Maiden. The open Combat HUD received the new layout now.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sync to G-Maiden failed.");
    } finally {
      setSyncing(false);
    }
  };

  const activeEvent = GMAIDEN_EVENTS.find((event) => event.id === eventId) ?? GMAIDEN_EVENTS[0];
  const banner = bannerOverrides[eventId]
    ? `data:${bannerOverrides[eventId].mime};base64,${bannerOverrides[eventId].b64}`
    : toneBannerPngDataUrl(eventId, 2);

  if (surface === "banner") {
    return <BannerEditor onOpenHudLayout={() => setSurface("hud")} />;
  }

  return (
    <main className="flex-1 min-w-0 grid grid-cols-[228px_minmax(0,1fr)_272px] overflow-hidden bg-base">
      <aside aria-label="HUD module shelf" className="min-w-0 overflow-y-auto border-r border-line bg-panel/25 p-3">
        <OverlayModuleShelf
          layout={viewLayout}
          selectedId={selectedId}
          warningIds={warningIds}
          onSelect={setSelectedId}
          onToggle={(id, enabled) => update(id, { enabled })}
        />
      </aside>

      <section className="min-w-0 overflow-y-auto p-5">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <p className="text-xs font-semibold text-lime">G-Overlay Lab</p>
            <h2 className="text-lg font-bold text-ink mt-0.5">Arrange the real event slot before a match</h2>
            <p className="text-xs text-ink-faint mt-1">Drag modules over a 16:9 Dota reference. Only Sync changes G-Maiden.</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-lime/40 text-xs text-lime hover:bg-lime/10" onClick={() => setSurface("banner")}>
              Banner editor
            </button>
            <label className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-xs text-ink-muted hover:text-ink cursor-pointer">
              <ImagePlus size={14} /> Screenshot
              <input type="file" accept="image/*" className="hidden" onChange={loadScreenshot} />
            </label>
            <button className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-line text-xs text-ink-muted hover:text-ink" onClick={() => setLayout(cloneDefaultOverlayLayout())}>
              <RotateCcw size={14} /> Restore default
            </button>
            {/* One layout, two screens to clear. `standby` is up whenever the
                player is out of a match and `vol` fires on any hotkey, so a
                position that clears the in-game HUD can still sit on the roster
                for the whole loading screen. */}
            <div className="inline-flex h-8 overflow-hidden rounded-lg border border-line text-xs">
              {([["ingame", "ในเกม"], ["pregame", "ก่อนเกม"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => setScreen(value)}
                  className={`px-3 ${screen === value ? "bg-lime/15 text-lime" : "text-ink-muted hover:text-ink"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 mb-3">
          <select value={eventId} onChange={(event) => setEventId(event.target.value)} className="h-9 rounded-lg border border-line bg-panel px-2 text-xs text-ink outline-none">
            {GMAIDEN_EVENTS.filter((event) => event.id !== "unused").map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}
          </select>
          <button onClick={preview} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-lime text-xs font-bold text-black hover:bg-lime/90">
            <Sparkles size={14} /> Play event
          </button>
          <span className="text-xs text-ink-faint">{activeEvent.trigger}</span>
        </div>

        <OverlayCanvasStage
          layout={layout}
          previewLayout={previewLayout}
          selectedId={selectedId}
          screen={screen}
          screenshotUrl={screenUrl}
          previewActive={playing}
          bannerSrc={banner}
          onSelect={setSelectedId}
          onPreviewLayout={setGesturePreview}
          onGestureCommit={commitLayoutGesture}
          onGestureCancel={clearLayoutGesture}
        />
        <p className="mt-2 text-xs text-ink-faint">
          Modules are drawn at their real size for a 1920&times;1080 screen and drag freely — no grid,
          no snapping. Smaller modules sit above larger ones, so a stat chip over a card is still
          the thing you grab. The local authored preview runs for 3.5 seconds; G-Maiden currently uses a
          4.0-second show phase plus a 0.8-second exit phase.
        </p>
        <OverlayConflictList items={conflictItems} onSelect={setSelectedId} />
      </section>

      <aside className="min-w-0 overflow-y-auto border-l border-line bg-panel/25 p-4">
        <OverlayInspector
          selectedId={selectedId}
          layout={viewLayout}
          onCommit={update}
          onPreview={previewLayoutPatch}
          onGestureStart={beginLayoutGesture}
          onGestureEnd={endLayoutGesture}
        />
        <div className="mt-5 border-t border-line pt-4">
          <button disabled={syncing} onClick={sync} className="w-full inline-flex justify-center items-center gap-2 h-10 rounded-lg bg-white text-black text-xs font-bold hover:bg-zinc-200 disabled:opacity-50"><Send size={14} />{syncing ? "Syncing…" : "Sync to G-Maiden"}</button>
          <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{notice}</p>
        </div>
      </aside>
    </main>
  );
}
