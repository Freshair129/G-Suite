/**
 * Faithful mock renders of G-Maiden's overlay modules, for the Overlay Lab.
 *
 * The lab used to draw labelled chips, which told you nothing about whether the
 * real module clears Dota's HUD. These mirror `FullOverlay.tsx` — same glass
 * treatment, same palette, same paddings and font sizes — filled with mock data
 * so a layout can be judged before a match instead of during one.
 *
 * Rendered at TRUE px and scaled by the stage, so what you see is the real
 * footprint. Mock text is chosen to be representative-to-long (a five-hero gank
 * list, a two-line advice card): a layout that clears at the widest realistic
 * content clears everywhere.
 *
 * KEEP IN SYNC with G-Maiden `overlay/FullOverlay.tsx`. This is a mirror, not a
 * shared component — the two apps have no common package — so a visual change
 * there needs the same change here, and `MODULE_BOX` updated alongside both.
 */
import type { CSSProperties } from "react";
import type { OverlayModuleId } from "../lib/overlayLayout";

const C = {
  ice: "#8fd4ff", txt: "#e7eef6", mut: "#8794a6",
  ok: "#5be3a7", warn: "#ffcf6b", bad: "#ff7b85", edge: "rgba(143,212,255,0.22)",
};

const glass = (op = 0.72): CSSProperties => ({
  background: `rgba(14,17,24,${op})`,
  border: `1px solid ${C.edge}`,
  borderRadius: 16,
  boxShadow: "0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(143,212,255,0.22)",
  fontFamily: '"Segoe UI", system-ui, sans-serif',
  color: C.txt,
});

const chip = (label: string, value: React.ReactNode, color?: string) => (
  <div style={{ ...glass(), padding: "7px 13px", textAlign: "center", minWidth: 46 }}>
    <div style={{ fontSize: 16, fontWeight: 700, color: color ?? C.txt, lineHeight: 1 }}>{value}</div>
    {label && <div style={{ fontSize: 9, color: C.mut, textTransform: "uppercase", letterSpacing: 0.6, marginTop: 2 }}>{label}</div>}
  </div>
);

const bar = (pct: number, color: string) => (
  <div style={{ height: 5, width: 120, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99 }} />
  </div>
);

const card = (accent: string, children: React.ReactNode): React.ReactNode => (
  <div style={{ ...glass(0.72), padding: "12px 18px", maxWidth: 420, fontSize: 13, lineHeight: 1.5, border: `1px solid ${accent}` }}>
    {children}
  </div>
);

export function OverlayModulePreview({ id, bannerSrc }: { id: OverlayModuleId; bannerSrc?: string }) {
  switch (id) {
    case "alert":
      return (
        <div style={{ ...glass(0.84), padding: "10px 24px", border: `1px solid ${C.warn}`, color: C.warn, fontWeight: 700, fontSize: 15, whiteSpace: "nowrap", boxShadow: "0 0 30px rgba(255,207,107,0.4)" }}>
          ⚠️ ระวังแก๊งค์! Pudge, Lion, Nyx Assassin — 87%
        </div>
      );
    case "gmeter":
      return (
        <div style={{ ...glass(), padding: "7px 12px", display: "flex", alignItems: "center", gap: 10, minWidth: 158 }}>
          <span style={{ fontSize: 10, color: C.mut, textTransform: "uppercase", letterSpacing: 0.7 }}>Risk</span>
          <div style={{ display: "flex", gap: 3 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ width: 16, height: 8, borderRadius: 2, background: i <= 2 ? C.warn : "rgba(255,255,255,0.08)" }} />
            ))}
          </div>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: C.warn, marginLeft: "auto" }}>ระวัง</span>
        </div>
      );
    case "toast":
      return (
        <div style={{ ...glass(0.88), padding: "8px 16px", display: "flex", alignItems: "center", gap: 10, maxWidth: 460, border: `1px solid ${C.ice}` }}>
          <span style={{ fontSize: 10, color: C.ice, textTransform: "uppercase", letterSpacing: 0.7, flex: "none", whiteSpace: "nowrap" }}>🔔 double_kill (voice)</span>
          <span style={{ fontSize: 12.5, opacity: 0.92, whiteSpace: "nowrap" }}>สองศพแล้วค่ะ เก่งมาก!</span>
        </div>
      );
    case "companion":
      return (
        <div style={{ ...glass(), padding: "10px 14px", display: "flex", alignItems: "center", gap: 11, minWidth: 142 }}>
          <div style={{ width: 44, height: 44, borderRadius: 14, flex: "none", background: "radial-gradient(circle at 35% 30%, #bfe6ff, #4a7fb5)", boxShadow: "0 0 16px rgba(143,212,255,0.5)" }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: 0.6 }}>Maiden</div>
            <div style={{ fontSize: 10.5, color: C.ok, whiteSpace: "nowrap" }}>● กำลังดูแล</div>
          </div>
        </div>
      );
    case "advice":
      return card(C.edge, <>ตอนนี้ Net Worth ตามอยู่ 2,400 — เก็บ farm ป่าฝั่งเราก่อนนะคะ อย่าเพิ่งเปิดเทีมไฟท์</>);
    case "buyback":
      return card(C.bad, (
        <>
          <div style={{ fontWeight: 700, color: C.bad, marginBottom: 4 }}>อย่าเพิ่ง buyback</div>
          รอ respawn 42s แล้วค่อยกลับมาพร้อมกัน — ทองไม่พอซื้อ BKB ถ้าซื้อตอนนี้
        </>
      ));
    case "missing":
      return (
        <div style={{ ...glass(), padding: "8px 14px", border: "1px solid rgba(255,207,107,0.45)", color: C.warn, fontSize: 12.5, display: "flex", gap: 8, whiteSpace: "nowrap" }}>
          <span style={{ opacity: 0.7 }}>👁️</span>
          <span>หาย: Pudge, Lion, Nyx Assassin</span>
        </div>
      );
    case "banner":
      return (
        <div style={{ position: "relative", display: "inline-block", lineHeight: 0, borderRadius: 16, overflow: "hidden", boxShadow: "0 0 24px rgba(91,227,167,0.25)" }}>
          {bannerSrc
            ? <img src={bannerSrc} alt="event banner" style={{ display: "block", maxWidth: 420, maxHeight: 150, width: "auto", height: "auto", objectFit: "contain" }} draggable={false} />
            : <div style={{ width: 420, height: 150, background: "rgba(12,20,32,0.75)", border: "1px solid rgba(91,227,167,0.35)" }} />}
        </div>
      );
    case "lowhp":
      return (
        <div style={{ ...glass(0.82), padding: "9px 22px", border: `1px solid ${C.warn}`, color: C.warn, fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", boxShadow: "0 0 24px rgba(255,207,107,0.35)" }}>
          ⚠ HP เหลือ 18% — ถอยก่อนค่ะเพื่อน!
        </div>
      );
    case "vol":
      return (
        <div style={{ ...glass(), padding: "8px 18px", display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
          <span>🔊</span>
          <div style={{ width: 80, height: 5, background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden" }}>
            <div style={{ height: "100%", width: "70%", background: C.ice, borderRadius: 99 }} />
          </div>
          <span style={{ color: C.ice, fontWeight: 600, minWidth: 32, textAlign: "right" }}>70%</span>
        </div>
      );
    case "standby":
      return (
        <div style={{ ...glass(), padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 8, height: 8, borderRadius: 99, background: C.ok }} />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>G-Maiden</div>
            <div style={{ fontSize: 11, color: C.mut }}>GSI Signal</div>
          </div>
        </div>
      );
    case "clock": return chip("", "12:34", C.ice);
    case "kda": return chip("K / D / A", "7/2/11");
    case "gold": return chip("Gold", "2,480", C.warn);
    case "gpm": return chip("GPM", "512");
    case "xpm": return chip("XPM", "604");
    case "nw": return chip("NW", "14,230", C.ice);
    case "score": return chip("Score", <span><span style={{ color: C.ok }}>21</span> <span style={{ color: C.mut }}>:</span> <span style={{ color: C.bad }}>17</span></span>);
    case "hero":
      return (
        <div style={{ ...glass(), padding: "9px 13px", minWidth: 140 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5, whiteSpace: "nowrap" }}>
            Crystal Maiden <span style={{ color: C.mut, fontWeight: 400 }}>Lv7</span>
          </div>
          <div style={{ marginBottom: 3 }}>{bar(86, C.ok)}</div>
          {bar(64, C.ice)}
        </div>
      );
    default: return null;
  }
}
