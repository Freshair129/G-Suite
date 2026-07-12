// Event-test grid (W3 slice) — the "Na Khom preview" screen: a grid of every
// G-Maiden event; click one to FIRE it exactly like in-game — the tone banner
// pops on the stage and the mapped clip plays. Uses toneBanner.ts for the visual
// and the existing read_audio_bytes → Audio pattern for sound.

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { drawToneBanner, eventTone, TONES, BANNER_W, BANNER_H } from "../lib/toneBanner";
import { installGmaidenPack } from "../lib/exportGmaidenPack";
import { useStudioStore, type Clip } from "../store/useStudioStore";

const EVENTS = GMAIDEN_EVENTS.filter((e) => e.id !== "unused");

/** A single tone banner drawn on a transparent canvas, CSS-scaled to `width`. */
function BannerCanvas({ event, width }: { event: string; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (width / BANNER_W) * dpr;
    c.width = Math.round(BANNER_W * scale);
    c.height = Math.round(BANNER_H * scale);
    c.style.width = `${width}px`;
    c.style.height = `${(width * BANNER_H) / BANNER_W}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    drawToneBanner(ctx, event, 1);
  }, [event, width]);
  return <canvas ref={ref} className="block" />;
}

export default function EventTestGrid() {
  const clips = useStudioStore((s) => s.clips);
  const wavPath = useStudioStore((s) => s.wavPath);

  const [fired, setFired] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const firedTimer = useRef<number | null>(null);
  const urlCache = useRef<{ path: string; url: string } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const byEvent = useMemo(() => {
    const m: Record<string, Clip[]> = {};
    for (const c of clips) (m[c.event] ??= []).push(c);
    return m;
  }, [clips]);

  async function ensureUrl(): Promise<string | null> {
    if (!wavPath) return null;
    if (urlCache.current?.path === wavPath) return urlCache.current.url;
    const buf = await invoke<ArrayBuffer>("read_audio_bytes", { path: wavPath });
    const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
    if (urlCache.current) URL.revokeObjectURL(urlCache.current.url);
    urlCache.current = { path: wavPath, url };
    return url;
  }

  async function fire(id: string) {
    // banner: pop for 3.5s (same lifetime as the in-game overlay)
    setFired(id);
    if (firedTimer.current) window.clearTimeout(firedTimer.current);
    firedTimer.current = window.setTimeout(() => setFired(null), 3500);

    // audio: play the first mapped clip's segment of the source wav
    const cs = byEvent[id];
    if (!cs?.length) return;
    const clip = cs[0];
    const url = await ensureUrl();
    if (!url) return;
    if (audioRef.current) audioRef.current.pause();
    const a = new Audio(url);
    audioRef.current = a;
    a.addEventListener("loadedmetadata", () => {
      a.currentTime = clip.start;
      void a.play().catch(() => {});
    });
    const stopAtEnd = () => {
      if (a.currentTime >= clip.end) {
        a.pause();
        a.removeEventListener("timeupdate", stopAtEnd);
      }
    };
    a.addEventListener("timeupdate", stopAtEnd);
  }

  useEffect(
    () => () => {
      if (firedTimer.current) window.clearTimeout(firedTimer.current);
      if (urlCache.current) URL.revokeObjectURL(urlCache.current.url);
      if (audioRef.current) audioRef.current.pause();
    },
    []
  );

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-base">
      {/* stage — the fired banner pops here, like the in-game overlay */}
      <div className="sticky top-0 z-10 h-[164px] grid place-items-center bg-base border-b border-line">
        {fired ? (
          <div key={fired} style={{ animation: "gannPop .22s ease-out" }}>
            <BannerCanvas event={fired} width={420} />
          </div>
        ) : (
          <p className="text-ink-faint text-sm">
            กด event ด้านล่างเพื่อทดสอบ — โชว์ banner + เล่นเสียง (แบบในเกม)
          </p>
        )}
      </div>

      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-ink">ทดสอบ Event · {EVENTS.length} รายการ</h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-faint">{clips.length} clip แมปแล้ว</span>
            <button
              onClick={async () => {
                setInstalling(true);
                try {
                  alert(await installGmaidenPack());
                } finally {
                  setInstalling(false);
                }
              }}
              disabled={installing || clips.length === 0}
              className="px-3 h-8 rounded-full bg-lime text-black text-xs font-semibold hover:bg-lime/90 transition disabled:opacity-40"
            >
              {installing ? "กำลังติดตั้ง…" : "ติดตั้งลง G-Maiden (พร้อม banner)"}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {EVENTS.map((ev) => {
            const n = byEvent[ev.id]?.length ?? 0;
            const t = TONES[eventTone(ev.id)];
            return (
              <button
                key={ev.id}
                onClick={() => fire(ev.id)}
                className="group relative rounded-xl overflow-hidden border border-line hover:border-white/25 transition"
                title={ev.trigger}
              >
                <BannerCanvas event={ev.id} width={280} />
                <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-black/55">
                  {n > 0 ? (
                    <span style={{ color: t.accent }}>{n} clip</span>
                  ) : (
                    <span className="text-ink-faint">ยังไม่มีเสียง</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <style>{`@keyframes gannPop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}`}</style>
    </div>
  );
}
