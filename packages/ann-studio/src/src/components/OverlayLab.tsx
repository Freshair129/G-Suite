import { useEffect, useRef, useState } from "react";
import { ImagePlus, RotateCcw, Send, Sparkles } from "lucide-react";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { toneBannerPngDataUrl } from "../lib/toneBanner";
import {
  cloneDefaultOverlayLayout,
  OVERLAY_MODULE_IDS,
  syncOverlayLayout,
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

export default function OverlayLab() {
  const layout = useStudioStore((s) => s.overlayLayout);
  const setLayout = useStudioStore((s) => s.setOverlayLayout);
  const bannerOverrides = useStudioStore((s) => s.bannerOverrides);
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<OverlayModuleId | null>(null);
  const [eventId, setEventId] = useState("kill");
  const [playing, setPlaying] = useState(false);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState("Draft only. Sync when you are happy with the HUD clearance.");

  useEffect(() => () => { if (screenUrl) URL.revokeObjectURL(screenUrl); }, [screenUrl]);

  const update = (id: OverlayModuleId, patch: Partial<OverlayLayout[OverlayModuleId]>) => {
    setLayout({ ...layout, [id]: { ...layout[id], ...patch } });
  };

  const move = (event: React.PointerEvent) => {
    if (!dragging || !stageRef.current) return;
    const box = stageRef.current.getBoundingClientRect();
    update(dragging, {
      x: Math.round(clamp(((event.clientX - box.left) / box.width) * 100, 0, 100)),
      y: Math.round(clamp(((event.clientY - box.top) / box.height) * 100, 0, 100)),
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
          style={screenUrl ? { background: `center / cover no-repeat url(${screenUrl})` } : undefined}
        >
          {!screenUrl && <>
            <div className="absolute inset-x-0 top-0 h-[8%] bg-black/65 border-b border-white/10" />
            <div className="absolute bottom-0 left-0 h-[29%] w-[27%] bg-black/60 border border-white/10" />
            <div className="absolute bottom-0 left-[28%] h-[23%] w-[45%] bg-black/60 border border-white/10" />
            <div className="absolute bottom-0 right-0 h-[26%] w-[25%] bg-black/60 border border-white/10" />
            <span className="absolute top-3 right-3 text-[10px] text-white/40">Load a Dota screenshot for exact HUD clearance</span>
          </>}
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(255,255,255,.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.06)_1px,transparent_1px)] bg-[size:5%_5%]" />
          {OVERLAY_MODULE_IDS.map((id) => {
            const cfg = layout[id];
            if (!cfg.enabled) return null;
            const isBanner = id === "banner";
            const visible = !isBanner || playing;
            return (
              <div
                key={id}
                onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); setDragging(id); }}
                className={`absolute cursor-grab active:cursor-grabbing ${visible ? "" : "opacity-35"}`}
                style={{ left: `${cfg.x}%`, top: `${cfg.y}%`, transform: `translate(-50%, -50%) scale(${cfg.scale})` }}
              >
                {isBanner ? (
                  <div className="w-[230px] rounded-md border border-lime/50 bg-black/70 p-1 shadow-glow">
                    <img src={banner} alt={`${eventId} banner`} className="block w-full rounded-sm" draggable={false} />
                  </div>
                ) : (
                  <div className="rounded-md border border-white/25 bg-black/75 px-2 py-1 text-[10px] font-semibold text-white whitespace-nowrap">
                    {LABEL[id]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-xs text-ink-faint">The banner is shown for 3.5 seconds, matching the in-game event window. Dota HUD areas remain visible as a clearance guide.</p>
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
