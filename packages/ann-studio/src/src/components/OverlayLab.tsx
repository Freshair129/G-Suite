// @req GOE-004 — routes the event preview and preserves the existing HUD-layout surface.
// @spec SDD-004 — keeps explicit local HUD sync separate from BannerProject authoring.
// @designs docs/g-overlay-lab.md
import { useEffect, useMemo, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Send, Sparkles } from "lucide-react";
import BannerEditor from "./BannerEditor";
import { OverlayInspector } from "./OverlayInspector";
import { OverlayModuleShelf } from "./OverlayModuleShelf";
import { OverlayModulePreview } from "./OverlayModulePreview";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { toneBannerPngDataUrl } from "../lib/toneBanner";
import {
  BOX_REF,
  boxPercent,
  cloneDefaultOverlayLayout,
  DOTA_HUD_ZONES,
  STAGE_ZONES,
  modulesOnScreen,
  ACCEPTED_OVERLAPS,
  moduleCollisions,
  moduleRect,
  OVERLAY_MODULE_IDS,
  OVERLAY_MODULE_LABELS,
  syncOverlayLayout,
  zoneConflicts,
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

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Annotated 16:9 Dota 2 HUD reference, bundled so the stage shows the real game
 * out of the box instead of grey placeholder blocks — you cannot judge clearance
 * against rectangles. Users can still load their own capture over it, which is
 * the accurate option: HUD geometry shifts with aspect ratio and HUD skins.
 *
 * Valve/Dota 2 artwork, used as a layout reference inside a companion tool.
 */
const DOTA_HUD_REFERENCE = "/dota-hud-reference.webp";
const DOTA_MINIMAP_REFERENCE = "/dota-minimap-reference.webp";

// Surface, event and screenshot live in lib/labView so they survive both a tab
// switch (OverlayLab unmounts) and an app restart. See that file for why the
// screenshot goes to IndexedDB rather than localStorage or the project store.

export default function OverlayLab() {
  const layout = useStudioStore((s) => s.overlayLayout);
  const setLayout = useStudioStore((s) => s.setOverlayLayout);
  const bannerOverrides = useStudioStore((s) => s.bannerOverrides);
  const stageRef = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState<OverlayModuleId | null>("alert");
  const [previewLayout, setPreviewLayout] = useState<OverlayLayout | null>(null);
  const gestureStartLayout = useRef<OverlayLayout | null>(null);
  const gesturePreviewLayout = useRef<OverlayLayout | null>(null);
  // Previews are real px, so they must shrink with the stage: the reference is a
  // 1920-wide screen and the stage is whatever the panel gives us.
  const [stageScale, setStageScale] = useState(0);
  const [dragging, setDragging] = useState<OverlayModuleId | null>(null);
  const [screen, setScreen] = useState<StageScreen>("ingame");
  const [playing, setPlaying] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("Draft only. Sync when you are happy with the HUD clearance.");
  const viewLayout = previewLayout ?? layout;

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

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageScale(stage.getBoundingClientRect().width / BOX_REF.w);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
    // `surface` matters even though it is unused above: this component returns
    // <BannerEditor/> before the stage exists, so on the first mount the ref is
    // null and this effect bails. Without the dep it never re-runs when the user
    // switches to the HUD surface, stageScale stays 0, and every preview renders
    // at scale(0) — an invisible module inside a correctly-sized box.
  }, [surface]);

  const zones = STAGE_ZONES[screen];
  // Only judge (and only ring) modules that this screen actually draws.
  const onScreen = useMemo(() => new Set(modulesOnScreen(screen)), [screen]);

  const update = (id: OverlayModuleId, patch: Partial<OverlayLayout[OverlayModuleId]>) => {
    setLayout({ ...layout, [id]: { ...layout[id], ...patch } });
  };

  const beginLayoutGesture = () => {
    gestureStartLayout.current = layout;
    gesturePreviewLayout.current = layout;
    setPreviewLayout(layout);
  };

  const previewLayoutPatch = (id: OverlayModuleId, patch: Partial<OverlayLayout[OverlayModuleId]>) => {
    const current = gesturePreviewLayout.current ?? layout;
    const next = { ...current, [id]: { ...current[id], ...patch } };
    gesturePreviewLayout.current = next;
    setPreviewLayout(next);
  };

  const endLayoutGesture = () => {
    const start = gestureStartLayout.current;
    const next = gesturePreviewLayout.current;
    if (start && next) setLayout(next);
    gestureStartLayout.current = null;
    gesturePreviewLayout.current = null;
    setPreviewLayout(null);
  };

  /**
   * Stacking order by footprint: the biggest boxes go to the bottom, the
   * smallest to the top.
   *
   * Hit areas are MODULE_BOX-sized, and the widest are ~22% of the stage, so a
   * small chip parked over the advice card was unreachable — you grabbed the
   * card behind it. Ordering by area makes the smaller thing win, which is also
   * the right answer visually: a stat chip should never hide behind a panel.
   *
   * Ties are broken by id so the order is stable rather than dependent on sort
   * implementation, and the module being dragged is lifted above everything so
   * it cannot slip underneath whatever it is dragged across.
   */
  const zByArea = useMemo(() => {
    const area = (id: OverlayModuleId) => {
      const { w, h } = boxPercent(id, viewLayout[id].scale);
      return w * h;
    };
    const ranked = [...OVERLAY_MODULE_IDS].sort(
      (a, b) => area(b) - area(a) || a.localeCompare(b),
    );
    return Object.fromEntries(ranked.map((id, index) => [id, index + 1])) as Record<OverlayModuleId, number>;
  }, [viewLayout]);

  // Free positioning, no magnet. Snapping was added to fix a grid that never
  // lined up, but the real answer is that a uniform grid is the wrong tool here:
  // Dota's HUD edges sit at no round percentage, so any grid fights the layout
  // instead of helping it. Placement is now continuous and the conflict readout
  // — which knows the actual geometry — is what tells you when you are wrong.
  // Values are rounded to 0.1% purely to keep the synced layout tidy.
  const move = (event: React.PointerEvent) => {
    if (!dragging || !stageRef.current) return;
    const box = stageRef.current.getBoundingClientRect();
    const round = (value: number) => Math.round(value * 10) / 10;
    update(dragging, {
      x: clamp(round(((event.clientX - box.left) / box.width) * 100), 0, 100),
      y: clamp(round(((event.clientY - box.top) / box.height) * 100), 0, 100),
    });
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

        <div
          ref={stageRef}
          onPointerMove={move}
          onPointerUp={() => setDragging(null)}
          onPointerLeave={() => setDragging(null)}
          className="relative aspect-video overflow-hidden rounded-xl border border-line bg-[#111214] select-none"
          // In-game shows a real capture. Pre-game is drawn, not photographed:
          // no loading-screen shot ships with the app, and a synthetic backdrop
          // that looks obviously synthetic is honest, where a mocked-up "photo"
          // would invite pixel-matching against something that was never real.
          // A user-loaded screenshot always wins on the in-game screen.
          style={
            screen === "pregame"
              ? { background: "#0b0d12" }
              : { background: `center / cover no-repeat url(${screenUrl ?? DOTA_HUD_REFERENCE})` }
          }
        >
          {/* Zones are drawn over a loaded screenshot too: the whole point is to see
              where Dota will paint, and a screenshot taken between events shows an
              EMPTY kill-feed strip — the one region that matters most at trigger time. */}
          {zones.map((zone) => (
            <div
              key={zone.id}
              // Outline only, never filled: there is always a real screen underneath
              // now, and blanking out the HUD would hide the very thing being cleared.
              className={`absolute pointer-events-none ${
                zone.kind === "transient"
                  ? "border border-dashed border-amber-400/80 bg-amber-400/10"
                  : "border border-white/25"
              }`}
              style={{
                left: `${zone.left}%`, top: `${zone.top}%`,
                width: `${zone.right - zone.left}%`, height: `${zone.bottom - zone.top}%`,
              }}
            >
              <span className="absolute left-1 top-0.5 text-[9px] leading-tight text-white/45">{zone.label}</span>
            </div>
          ))}
          {!screenUrl && (
            <span className="absolute bottom-1 right-2 text-[9px] text-white/50">
              Dota 2 reference — load your own capture for your aspect ratio / HUD skin
            </span>
          )}
          {/* Pre-game backdrop: the map sits centre, one roster down each edge.
              Drawn from the zone rectangles themselves so the picture and the
              clearance test can never disagree. */}
          {screen === "pregame" && (
            <img
              src={DOTA_MINIMAP_REFERENCE}
              alt=""
              draggable={false}
              className="pointer-events-none absolute object-contain opacity-70"
              style={{
                left: "30%", top: "10%", width: "40%", height: "80%",
              }}
            />
          )}
          {/* Grid overlay removed with the magnet: lines you cannot snap to are
              just texture over the game screenshot. */}
          {OVERLAY_MODULE_IDS.map((id) => {
            const cfg = viewLayout[id];
            if (!cfg.enabled) return null;
            const isBanner = id === "banner";
            const visible = !isBanner || playing;
            // Size the box from MODULE_BOX rather than letting the label size it.
            // A chip that fits its own text tells you nothing about whether the
            // real module clears the HUD — which was the whole complaint.
            const { w, h } = boxPercent(id, cfg.scale);
            const rect = moduleRect(id, cfg);
            const drawn = onScreen.has(id);
            const accepted = ACCEPTED_OVERLAPS[id] !== undefined;
            const conflicts = drawn && !accepted ? zoneConflicts(rect, zones) : [];
            const blocked = conflicts.some((z) => z.kind === "blocked");
            const transient = conflicts.some((z) => z.kind === "transient");
            // Ring ONLY when something is wrong. The permanent grey box that used
            // to sit here framed every module in furniture that was not part of the
            // overlay, and its overflow-hidden clipped any preview wider than the
            // nominal MODULE_BOX — the advice and buyback cards lost their last
            // line. The box still drives hit-testing and the overlap maths; it is
            // just no longer painted.
            const ring = dragging === id
              ? "ring-1 ring-lime/70"
              : selectedId === id
                ? "ring-2 ring-sky-300"
                : blocked
                  ? "ring-1 ring-red-400"
                  : transient
                    ? "ring-1 ring-amber-400"
                    : "";
            return (
              <div
                key={id}
                title={conflicts.length ? `Overlaps: ${conflicts.map((z) => z.label).join(", ")}` : OVERLAY_MODULE_LABELS[id]}
                onPointerDown={(event) => { setSelectedId(id); event.currentTarget.setPointerCapture(event.pointerId); setDragging(id); }}
                className={`absolute cursor-grab active:cursor-grabbing rounded ${ring} ${visible && drawn ? "" : "opacity-35"}`}
                style={{
                  left: `${cfg.x}%`, top: `${cfg.y}%`,
                  width: `${w}%`, height: `${h}%`,
                  transform: "translate(-50%, -50%)",
                  zIndex: dragging === id ? 100 : zByArea[id],
                }}
              >
                {/* The real component at true px, scaled by the stage. Centred with
                    flex so the scale is about its own centre and nothing is clipped:
                    the wrapper keeps MODULE_BOX dimensions for hit-testing while the
                    preview is free to overflow it. */}
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="origin-center" style={{ transform: `scale(${stageScale * cfg.scale})` }}>
                    <OverlayModulePreview id={id} bannerSrc={isBanner ? banner : undefined} />
                  </div>
                </div>
                {/* Name only the module being moved. A permanent label on all 19 is
                    the same clutter the grey boxes were — and the modules now look
                    like themselves, so they no longer need naming to be identified. */}
                {dragging === id && (
                  <span className="pointer-events-none absolute -top-4 left-0 whitespace-nowrap rounded bg-black/80 px-1 text-[10px] font-semibold leading-tight text-lime">
                    {OVERLAY_MODULE_LABELS[id]} · {cfg.x},{cfg.y}
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Modules are drawn at their real size for a 1920&times;1080 screen and drag freely — no grid,
          no snapping. Smaller modules sit above larger ones, so a stat chip over a card is still
          the thing you grab. The local authored preview runs for 3.5 seconds; G-Maiden currently uses a
          4.0-second show phase plus a 0.8-second exit phase.
        </p>
        {(() => {
          // Overlap is only a problem when two things are on screen together, and the
          // pair that bites is a module sitting under Dota's own kill banner — clear
          // whenever you look at a screenshot, occupied exactly when an event fires.
          const zoneHits = OVERLAY_MODULE_IDS
            .filter((id) => viewLayout[id].enabled && onScreen.has(id) && ACCEPTED_OVERLAPS[id] === undefined)
            .map((id) => ({ id, zones: zoneConflicts(moduleRect(id, viewLayout[id]), zones) }))
            .filter((entry) => entry.zones.length > 0);
          const pairs = moduleCollisions(viewLayout);
          if (!zoneHits.length && !pairs.length) {
            return <p className="mt-1 text-xs text-lime">No overlaps: every enabled module clears the HUD and each other.</p>;
          }
          return (
            <div className="mt-1 space-y-0.5 text-xs">
              {zoneHits.map(({ id, zones }) => (
                <p key={id} className={zones.some((z) => z.kind === "blocked") ? "text-red-400" : "text-amber-400"}>
                  {OVERLAY_MODULE_LABELS[id]} overlaps {zones.map((z) => z.label).join(", ")}
                  {zones.every((z) => z.kind === "transient") && " — clear now, covered when the event fires"}
                </p>
              ))}
              {pairs.map(([a, b]) => (
                <p key={`${a}-${b}`} className="text-amber-400">{OVERLAY_MODULE_LABELS[a]} and {OVERLAY_MODULE_LABELS[b]} overlap each other</p>
              ))}
            </div>
          );
        })()}
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
