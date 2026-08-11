import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Send, Sparkles } from "lucide-react";
import BannerEditor from "./BannerEditor";
import { OverlayModulePreview } from "./OverlayModulePreview";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { toneBannerPngDataUrl } from "../lib/toneBanner";
import {
  BOX_REF,
  boxPercent,
  cloneDefaultOverlayLayout,
  DOTA_HUD_ZONES,
  moduleCollisions,
  moduleRect,
  OVERLAY_MODULE_IDS,
  syncOverlayLayout,
  zoneConflicts,
  type OverlayLayout,
  type OverlayModuleId,
} from "../lib/overlayLayout";
import { useStudioStore } from "../store/useStudioStore";

const LABEL: Record<OverlayModuleId, string> = {
  alert: "Danger alert", gmeter: "G-Meter", toast: "Voice notice", companion: "Maiden", advice: "Advice",
  buyback: "Buyback", missing: "Enemy missing", banner: "Event banner", lowhp: "Low HP", vol: "Volume",
  standby: "Standby", clock: "Clock", kda: "K/D/A", gold: "Gold", gpm: "GPM", xpm: "XPM", nw: "Net worth",
  score: "Score", hero: "HP / Mana",
};

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

export default function OverlayLab() {
  const layout = useStudioStore((s) => s.overlayLayout);
  const setLayout = useStudioStore((s) => s.setOverlayLayout);
  const bannerOverrides = useStudioStore((s) => s.bannerOverrides);
  const stageRef = useRef<HTMLDivElement>(null);
  // Previews are real px, so they must shrink with the stage: the reference is a
  // 1920-wide screen and the stage is whatever the panel gives us.
  const [stageScale, setStageScale] = useState(0);
  const [dragging, setDragging] = useState<OverlayModuleId | null>(null);
  const [eventId, setEventId] = useState("kill");
  const [playing, setPlaying] = useState(false);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("Draft only. Sync when you are happy with the HUD clearance.");
  const [surface, setSurface] = useState<"banner" | "hud">("banner");

  useEffect(() => () => { if (screenUrl) URL.revokeObjectURL(screenUrl); }, [screenUrl]);

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

  const update = (id: OverlayModuleId, patch: Partial<OverlayLayout[OverlayModuleId]>) => {
    setLayout({ ...layout, [id]: { ...layout[id], ...patch } });
  };

  // The old drag rounded to whole percent while the grid overlay is drawn at 5%,
  // so a module could never land on a line the user could actually see — the
  // "magnet is off" report. Snap to the same 5% the grid draws, hold Alt for 1%.
  //
  // A uniform grid still cannot line a module up with Dota's HUD, whose edges sit
  // at no round percentage, so we also snap the module's EDGES to nearby zone
  // edges. Edge snapping is what makes a card sit flush against the top bar
  // instead of "near enough"; centre-only snapping never could.
  const GRID = 5;
  const EDGE_SNAP = 1.5; // % — how close an edge must be before it grabs

  const snapAxis = (
    value: number,
    half: number,
    edges: number[],
    fine: boolean,
  ) => {
    if (!fine) {
      for (const edge of edges) {
        // try aligning this module's near edge, then its far edge, to the guide
        for (const candidate of [edge + half, edge - half]) {
          if (Math.abs(candidate - value) <= EDGE_SNAP) return candidate;
        }
      }
    }
    const step = fine ? 1 : GRID;
    return Math.round(value / step) * step;
  };

  const move = (event: React.PointerEvent) => {
    if (!dragging || !stageRef.current) return;
    const box = stageRef.current.getBoundingClientRect();
    const fine = event.altKey;
    const { w, h } = boxPercent(dragging, layout[dragging].scale);
    const rawX = ((event.clientX - box.left) / box.width) * 100;
    const rawY = ((event.clientY - box.top) / box.height) * 100;
    const xEdges = [0, 100, ...DOTA_HUD_ZONES.flatMap((z) => [z.left, z.right])];
    const yEdges = [0, 100, ...DOTA_HUD_ZONES.flatMap((z) => [z.top, z.bottom])];
    update(dragging, {
      x: clamp(snapAxis(rawX, w / 2, xEdges, fine), 0, 100),
      y: clamp(snapAxis(rawY, h / 2, yEdges, fine), 0, 100),
    });
  };

  const preview = () => {
    setPlaying(true);
    window.setTimeout(() => setPlaying(false), 3500);
  };

  const loadScreenshot = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (screenUrl) URL.revokeObjectURL(screenUrl);
    setScreenUrl(URL.createObjectURL(file));
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
    <main className="flex-1 min-w-0 grid grid-cols-[minmax(0,1fr)_280px] overflow-hidden bg-base">
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
          style={{ background: `center / cover no-repeat url(${screenUrl ?? DOTA_HUD_REFERENCE})` }}
        >
          {/* Zones are drawn over a loaded screenshot too: the whole point is to see
              where Dota will paint, and a screenshot taken between events shows an
              EMPTY kill-feed strip — the one region that matters most at trigger time. */}
          {DOTA_HUD_ZONES.map((zone) => (
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
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] bg-[size:5%_5%]" />
          {OVERLAY_MODULE_IDS.map((id) => {
            const cfg = layout[id];
            if (!cfg.enabled) return null;
            const isBanner = id === "banner";
            const visible = !isBanner || playing;
            // Size the box from MODULE_BOX rather than letting the label size it.
            // A chip that fits its own text tells you nothing about whether the
            // real module clears the HUD — which was the whole complaint.
            const { w, h } = boxPercent(id, cfg.scale);
            const rect = moduleRect(id, cfg);
            const conflicts = zoneConflicts(rect);
            const blocked = conflicts.some((z) => z.kind === "blocked");
            const transient = conflicts.some((z) => z.kind === "transient");
            const edge = blocked ? "border-red-400 bg-red-500/15" : transient ? "border-amber-400 bg-amber-400/15" : "border-white/35 bg-black/55";
            return (
              <div
                key={id}
                title={conflicts.length ? `Overlaps: ${conflicts.map((z) => z.label).join(", ")}` : LABEL[id]}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(id); }}
                className={`absolute cursor-grab active:cursor-grabbing overflow-hidden rounded border ${edge} ${visible ? "" : "opacity-35"}`}
                style={{
                  left: `${cfg.x}%`, top: `${cfg.y}%`,
                  width: `${w}%`, height: `${h}%`,
                  transform: "translate(-50%, -50%)",
                }}
              >
                {/* The real component, drawn at true px and scaled by the stage, so
                    the preview is the actual thing rather than a stand-in. The
                    bordered box around it is the MODULE_BOX footprint used for the
                    overlap maths — when the two disagree visibly, MODULE_BOX is the
                    entry that needs updating. */}
                <div
                  className="pointer-events-none absolute left-1/2 top-1/2 origin-center"
                  style={{ transform: `translate(-50%, -50%) scale(${stageScale * cfg.scale})` }}
                >
                  <OverlayModulePreview id={id} bannerSrc={isBanner ? banner : undefined} />
                </div>
                <span className="pointer-events-none absolute -top-3.5 left-0 whitespace-nowrap text-[9px] font-semibold leading-tight text-white/80 drop-shadow">
                  {LABEL[id]}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-faint">
          Modules are drawn at their real size for a 1920&times;1080 screen. Snaps to the 5% grid and to
          HUD edges; hold <kbd className="rounded border border-line px-1">Alt</kbd> for 1% nudges.
          The banner previews for 3.5 seconds, matching the in-game event window.
        </p>
        {(() => {
          // Overlap is only a problem when two things are on screen together, and the
          // pair that bites is a module sitting under Dota's own kill banner — clear
          // whenever you look at a screenshot, occupied exactly when an event fires.
          const zoneHits = OVERLAY_MODULE_IDS
            .filter((id) => layout[id].enabled)
            .map((id) => ({ id, zones: zoneConflicts(moduleRect(id, layout[id])) }))
            .filter((entry) => entry.zones.length > 0);
          const pairs = moduleCollisions(layout);
          if (!zoneHits.length && !pairs.length) {
            return <p className="mt-1 text-xs text-lime">No overlaps: every enabled module clears the HUD and each other.</p>;
          }
          return (
            <div className="mt-1 space-y-0.5 text-xs">
              {zoneHits.map(({ id, zones }) => (
                <p key={id} className={zones.some((z) => z.kind === "blocked") ? "text-red-400" : "text-amber-400"}>
                  {LABEL[id]} overlaps {zones.map((z) => z.label).join(", ")}
                  {zones.every((z) => z.kind === "transient") && " — clear now, covered when the event fires"}
                </p>
              ))}
              {pairs.map(([a, b]) => (
                <p key={`${a}-${b}`} className="text-amber-400">{LABEL[a]} and {LABEL[b]} overlap each other</p>
              ))}
            </div>
          );
        })()}
      </section>

      <aside className="border-l border-line overflow-y-auto p-4 bg-panel/25">
        <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold">Components</h3><span className="text-[10px] text-ink-faint">{OVERLAY_MODULE_IDS.length} modules</span></div>
        <div className="space-y-2">
          {OVERLAY_MODULE_IDS.map((id) => {
            const cfg = layout[id];
            return <div key={id} className="rounded-lg border border-line bg-black/15 p-2">
              <div className="flex items-center justify-between gap-2"><label className="flex items-center gap-2 text-xs text-ink-muted"><input className="accent-lime" type="checkbox" checked={cfg.enabled} onChange={(event) => update(id, { enabled: event.target.checked })} />{LABEL[id]}</label><span className="text-[10px] text-ink-faint">{cfg.x},{cfg.y}</span></div>
              <div className="mt-1.5 flex items-center gap-2"><span className="text-[10px] text-ink-faint">Scale</span><input className="flex-1" type="range" min="0.6" max="1.6" step="0.05" value={cfg.scale} disabled={!cfg.enabled} onChange={(event) => update(id, { scale: Number(event.target.value) })} /><span className="w-7 text-right text-[10px] text-ink-muted">{cfg.scale.toFixed(2)}</span></div>
            </div>;
          })}
        </div>
        <button disabled={syncing} onClick={sync} className="mt-4 w-full inline-flex justify-center items-center gap-2 h-10 rounded-lg bg-white text-black text-xs font-bold hover:bg-zinc-200 disabled:opacity-50"><Send size={14} />{syncing ? "Syncing…" : "Sync to G-Maiden"}</button>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{notice}</p>
      </aside>
    </main>
  );
}
