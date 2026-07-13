// Impact radar — a radial graph of a voice's reach: the voice at the centre,
// the events it serves on the inner ring, and the packs that use it (per event)
// on the outer ring. Data is the indexed `sound_usage` backlink (no scan).

import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import type { LibSound } from "../store/useStudioStore";

interface Usage {
  pack_id: string;
  pack_name: string;
  event: string;
}

const CX = 180;
const CY = 180;
const RE = 88; // event ring
const RP = 150; // pack ring

export default function ImpactRadar({ sound, onClose }: { sound: LibSound; onClose: () => void }) {
  const [usage, setUsage] = useState<Usage[] | null>(null);

  useEffect(() => {
    invoke<Usage[]>("sound_usage", { soundId: sound.id })
      .then(setUsage)
      .catch(() => setUsage([]));
  }, [sound.id]);

  const layout = useMemo(() => {
    const byEvent = new Map<string, Usage[]>();
    for (const u of usage ?? []) {
      const arr = byEvent.get(u.event);
      if (arr) arr.push(u);
      else byEvent.set(u.event, [u]);
    }
    const events = [...byEvent.keys()];
    const evPos = events.map((ev, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, events.length);
      return { ev, a, x: CX + RE * Math.cos(a), y: CY + RE * Math.sin(a) };
    });
    const packNodes: { x: number; y: number; label: string; ca: number }[] = [];
    const packLines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const e of evPos) {
      const packs = byEvent.get(e.ev)!;
      const spread = 0.5;
      packs.forEach((p, j) => {
        const off = packs.length > 1 ? (j - (packs.length - 1) / 2) * (spread / packs.length) : 0;
        const a = e.a + off;
        const x = CX + RP * Math.cos(a);
        const y = CY + RP * Math.sin(a);
        packNodes.push({ x, y, label: p.pack_name, ca: Math.cos(a) });
        packLines.push({ x1: e.x, y1: e.y, x2: x, y2: y });
      });
    }
    return { events, evPos, packNodes, packLines };
  }, [usage]);

  const center = (sound.name_en || sound.name_th || "voice").slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[440px] bg-panel border border-line rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-line">
          <h3 className="text-sm font-bold truncate" title={sound.name_th}>
            Impact — {sound.name_th || sound.name_en}
          </h3>
          <button onClick={onClose} className="grid place-items-center w-7 h-7 rounded-lg hover:bg-panel-hover transition">
            <X size={16} />
          </button>
        </div>

        <div className="p-4">
          {usage === null ? (
            <div className="h-[340px] grid place-items-center text-xs text-ink-faint">กำลังโหลด…</div>
          ) : layout.events.length === 0 ? (
            <div className="h-[340px] grid place-items-center text-xs text-ink-faint">
              ยังไม่มี pack ไหนใช้เสียงนี้
            </div>
          ) : (
            <svg viewBox="0 0 360 360" className="w-full">
              <circle cx={CX} cy={CY} r={RE} fill="none" stroke="rgba(255,255,255,0.06)" />
              <circle cx={CX} cy={CY} r={RP} fill="none" stroke="rgba(255,255,255,0.04)" />

              {layout.evPos.map((e) => (
                <line key={`c-${e.ev}`} x1={CX} y1={CY} x2={e.x} y2={e.y} stroke="rgba(224,255,0,0.35)" strokeWidth={1.2} />
              ))}
              {layout.packLines.map((l, i) => (
                <line key={`p-${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="rgba(255,255,255,0.15)" strokeWidth={1} />
              ))}

              {layout.packNodes.map((p, i) => (
                <g key={`pn-${i}`}>
                  <circle cx={p.x} cy={p.y} r={4} fill="#9ca3af" />
                  <text
                    x={p.x + (p.ca >= 0 ? 7 : -7)}
                    y={p.y + 3}
                    textAnchor={p.ca >= 0 ? "start" : "end"}
                    fontSize="8"
                    fill="#9ca3af"
                  >
                    {p.label.length > 13 ? p.label.slice(0, 12) + "…" : p.label}
                  </text>
                </g>
              ))}

              {layout.evPos.map((e) => (
                <g key={`ev-${e.ev}`}>
                  <circle cx={e.x} cy={e.y} r={6} fill="#e0ff00" />
                  <text x={e.x} y={e.y - 10} textAnchor="middle" fontSize="9" fill="#e0ff00" fontWeight="bold">
                    {e.ev}
                  </text>
                </g>
              ))}

              <circle cx={CX} cy={CY} r={30} fill="#1c1c1e" stroke="#e0ff00" strokeWidth={1.5} />
              <text x={CX} y={CY + 3} textAnchor="middle" fontSize="9" fill="#fff">
                {center}
              </text>
            </svg>
          )}
          <div className="mt-1 text-[10px] text-ink-faint text-center">
            {layout.events.length} event · {(usage ?? []).length} pack ใช้เสียงนี้
          </div>
        </div>
      </div>
    </div>
  );
}
