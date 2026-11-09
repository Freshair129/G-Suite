/* Parallel PR-B work: an isolated, interactive visual-review surface.
 * This preview intentionally does not read/write a real .ann or .gann project.
 * Production wiring belongs to PR-C after the responsive PR-A merge.
 */
import { useMemo, useState } from "react";
import {
  AudioLines, Check, ChevronDown, Download, FolderOpen, Link2,
  Menu, Play, Save, Scissors, Sparkles, Upload, X,
} from "lucide-react";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { GlassButton, GlassPanel, GlassPill } from "./GlassComponents";
import "./GlassWorkbenchPreview.css";

type DemoClip = { id: string; title: string; start: number; end: number };
const CLIPS: DemoClip[] = [
  { id: "clip_01", title: "เปิดเกมกันเลย!", start: 5, end: 9.1 },
  { id: "clip_02", title: "ดับเบิลคิล!", start: 29.5, end: 32.3 },
  { id: "clip_03", title: "โคตรโหดเลย!", start: 41.2, end: 44.8 },
  { id: "clip_04", title: "ฆ่าหมดทีมแล้ว!", start: 63, end: 67 },
  { id: "clip_05", title: "กลับมาแล้วโว้ย!", start: 92, end: 95.4 },
  { id: "clip_06", title: "ระวังข้างหลัง!", start: 120, end: 122.2 },
];
const INITIAL_MAPPING: Record<string, string> = {
  match_start: "clip_01", double_kill: "clip_02",
  gank: "clip_06", triple_kill: "clip_03",
  respawn: "clip_05", rampage: "clip_04",
};
const filters = ["All", "Kill", "Streak", "Signal", "State", "Other"] as const;
function stamp(t: number) {
  const s = Math.max(0, t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}
function categoryOf(category: string) {
  const c = category.toLowerCase();
  if (c === "kill") return "Kill";
  if (c === "streak") return "Streak";
  if (c === "signal") return "Signal";
  if (c === "state") return "State";
  return "Other";
}

export default function GlassWorkbenchPreview() {
  const [selectedClipId, setSelectedClipId] = useState("clip_03");
  const [selectedEventId, setSelectedEventId] = useState("triple_kill");
  const [assignments, setAssignments] = useState<Record<string, string>>(INITIAL_MAPPING);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [transcript, setTranscript] = useState(CLIPS[2].title);
  const [trimStart, setTrimStart] = useState(41.2);
  const [trimEnd, setTrimEnd] = useState(44.8);
  const [notice, setNotice] = useState("UI preview — ไม่แก้ไขไฟล์จริง");
  const selected = CLIPS.find(c => c.id === selectedClipId) ?? CLIPS[0];
  const selectedEvent = GMAIDEN_EVENTS.find(e => e.id === selectedEventId);
  const mapped = Object.values(assignments).filter(Boolean).length;
  const shownClips = CLIPS.filter(c => c.title.toLowerCase().includes(search.toLowerCase()));
  const shownEvents = useMemo(() => GMAIDEN_EVENTS
    .filter(e => e.id !== "unused" && (filter === "All" || categoryOf(e.category) === filter)),
    [filter]);
  const mapping = CLIPS.find(c => c.id === assignments[selectedEventId]);

  function selectClip(clip: DemoClip) {
    setSelectedClipId(clip.id);
    setTrimStart(clip.start);
    setTrimEnd(clip.end);
    setTranscript(clip.title);
    setLibraryOpen(false);
  }

  function mapSelected() {
    setAssignments(prev => ({ ...prev, [selectedEventId]: selectedClipId }));
    setNotice(`Preview mapping: ${selected.id} → ${selectedEvent?.label ?? selectedEventId}`);
  }

  return <div className="ann-glass ann-preview">
    <div className="ann-preview__viewport">
      <header className="ann-preview__top">
        <div className="ann-preview__brand">
          <div className="ann-preview__logo" aria-hidden="true">G</div>
          <div style={{ minWidth: 0 }}>
            <div className="ann-preview__brand-title">G-ANNSTUDIO</div>
            <div className="ann-preview__brand-sub">ANNOUNCER WORKBENCH</div>
          </div>
        </div>
        <div className="ann-preview__project">
          <FolderOpen size={15} aria-hidden="true" />
          <span className="ann-preview__project-name" title="My First Announcer">My First Announcer</span>
          <GlassPill tone="success">LOCAL DRAFT</GlassPill>
        </div>
        <div className="ann-preview__top-actions">
          <span className="ann-preview__secondary"><GlassButton icon={<Save size={15} />} onClick={() => setNotice("ตัวอย่าง UI: ยังไม่ได้บันทึกโปรเจกต์")}>Save</GlassButton></span>
          <span className="ann-preview__secondary"><GlassButton icon={<Play size={15} />} onClick={() => setNotice("ตัวอย่าง UI: ทดสอบเสียงจริงหลังเชื่อม Tauri")}>Test event</GlassButton></span>
          <GlassButton variant="primary" icon={<Download size={15} />} onClick={() => setNotice("ตัวอย่าง UI: Export .gann ต้องเชื่อมกับ Native Build")}>Export .gann</GlassButton>
        </div>
      </header>

      <nav className="ann-preview__steps" aria-label="Announcer workflow">
        {[
          ["1", "Import audio"], ["2", "Cut clips"], ["3", "Map events"],
          ["4", "Banner & SFX"], ["5", "Test / Export"],
        ].map(([n, label]) => <div key={n} className="ann-preview__step" data-active={n === "3"}>
          <span className="ann-preview__step-index">{n}</span>
          <span className="ann-preview__step-label">{label}</span>
        </div>)}
        <GlassPill>MANUAL FIRST</GlassPill>
      </nav>

      <div className="ann-preview__tools">
        <GlassButton icon={libraryOpen ? <X size={16} /> : <Menu size={16} />} onClick={() => setLibraryOpen(v => !v)} aria-expanded={libraryOpen}>Assets</GlassButton>
        <GlassButton icon={<Sparkles size={15} />} onClick={() => setAgentExpanded(v => !v)} aria-expanded={agentExpanded}>AI Copilot</GlassButton>
      </div>

      <main className="ann-preview__layout" aria-label="Glass UI review workbench">
        <aside className="ann-preview__rail" data-open={libraryOpen}>
          <GlassPanel className="ann-preview__panel" title="Sound Library" action={<GlassPill>{CLIPS.length} CLIPS</GlassPill>}>
            <div className="ann-preview__eyebrow">Assets</div>
            <p className="ann-preview__sub">นำเข้าไฟล์เสียง และเลือกคลิปเพื่อแก้ไข</p>
            <div className="ann-preview__source">
              <Upload size={19} aria-hidden="true" />
              <div style={{ minWidth:0 }}>
                <div className="ann-preview__file">Session_01.wav</div>
                <div className="ann-preview__meta">02:43 · 48 kHz · WAV</div>
              </div>
            </div>
            <label className="ann-preview__caption" htmlFor="glass-clip-search">ค้นหาคลิป</label>
            <input className="ann-glass-field" id="glass-clip-search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="ชื่อคลิปหรือคำพูด" />
            <div className="ann-preview__list">
              {shownClips.map(c=><button key={c.id} className="ann-preview__clip" data-selected={c.id === selectedClipId} onClick={()=>selectClip(c)} title={c.title}>
                <Play size={13} aria-hidden="true" />
                <span className="ann-preview__clip-copy">
                  <span className="ann-preview__clip-name">{c.title}</span>
                  <span className="ann-preview__clip-meta">{c.id} · {stamp(c.start)} – {stamp(c.end)}</span>
                </span>
                <span className="ann-preview__clip-time">{(c.end-c.start).toFixed(1)}s</span>
              </button>)}
              {shownClips.length === 0 && <span className="ann-preview__empty">ไม่พบคลิปที่ค้นหา</span>}
            </div>
          </GlassPanel>
        </aside>

        <div className="ann-preview__editor">
          <GlassPanel className="ann-preview__panel" title={<span>Clip Editor <GlassPill>MANUAL MODE</GlassPill></span>}>
            <div className="ann-preview__eyebrow">Audio Workbench</div>
            <div className="ann-preview__editor-head">
              <div>
                <h1 className="ann-preview__section-title">ตัดเสียงและจัดคลิป</h1>
                <p className="ann-preview__sub">เลือกช่วงเสียงด้วยมือ แล้วจับคู่กับเหตุการณ์</p>
              </div>
              <GlassPill tone="success">{(trimEnd-trimStart).toFixed(1)}s</GlassPill>
            </div>
            <div className="ann-preview__wave-shell">
              <div className="ann-preview__wave-head"><strong title={selected.title}>{selected.id} — {selected.title}</strong><span>{stamp(selected.end-selected.start)}</span></div>
              <div className="ann-preview__wave-visual" role="img" aria-label="Decorative simulated audio waveform">
                {Array.from({length:110},(_,i)=>{
                  const height=7+Math.abs(Math.sin(i*.64)*Math.cos(i*.12)+Math.sin(i*.13)*.28)*64;
                  return <span key={i} className="ann-preview__wave-bar" data-lit={i>=32&&i<=61} style={{height:`${height}%`}}/>;
                })}
                <div className="ann-preview__wave-range" />
              </div>
              <div className="ann-preview__wave-axis"><span>00:00</span><span>00:40</span><span>01:20</span><span>02:00</span><span>02:43</span></div>
            </div>
            <div className="ann-preview__trims">
              <div className="ann-preview__trim"><label htmlFor="glass-start"><span>START</span><strong>{stamp(trimStart)}</strong></label><input id="glass-start" type="range" min="0" max={Math.max(0,trimEnd-.1)} step=".1" value={Math.min(trimStart,trimEnd-.1)} onChange={e=>setTrimStart(Number(e.target.value))}/></div>
              <div className="ann-preview__trim"><label htmlFor="glass-end"><span>END</span><strong>{stamp(trimEnd)}</strong></label><input id="glass-end" type="range" min={Math.min(163,trimStart+.1)} max="163" step=".1" value={trimEnd} onChange={e=>setTrimEnd(Number(e.target.value))}/></div>
            </div>
            <div className="ann-preview__transport">
              <GlassButton icon={<Play size={15}/>} onClick={()=>setNotice("Waveform เป็นภาพตัวอย่าง ยังไม่เล่นไฟล์จริง")}>ฟังตัวอย่าง</GlassButton>
              <GlassButton icon={<Scissors size={15}/>} onClick={()=>setNotice(`จำลองการตัด: ${stamp(trimStart)}–${stamp(trimEnd)}`)}>บันทึกช่วงเสียง</GlassButton>
            </div>
            <label className="ann-preview__caption" htmlFor="glass-transcript">ข้อความของคลิป (แก้ไขได้)</label>
            <textarea id="glass-transcript" className="ann-glass-field ann-preview__transcript" value={transcript} onChange={e=>setTranscript(e.target.value)}/>
          </GlassPanel>

          <div className="ann-preview__preview">
            <GlassPanel material="solid" className="ann-preview__panel ann-preview__banner">
              <div>
                <small>ANNOUNCER EVENT</small>
                <strong>{selectedEvent?.label.toUpperCase() ?? "TRIPLE KILL"}</strong>
                <small>G-MAIDEN · BANNER PREVIEW</small>
              </div>
            </GlassPanel>
            <GlassPanel className="ann-preview__panel">
              <div className="ann-preview__eyebrow">Visual Composer</div>
              <h2 className="ann-preview__section-title">ภาพและ SFX ประกอบ</h2>
              <p className="ann-preview__sub">ปรับภาพ แอนิเมชัน และเอฟเฟกต์ใน Banner Editor เดิม</p>
              <div style={{marginTop:18}}><GlassButton onClick={()=>setNotice("เปิด Banner Editor จริงหลังรวม PR-C")}>Open Banner Editor</GlassButton></div>
            </GlassPanel>
          </div>
        </div>

        <aside className="ann-preview__inspector">
          <GlassPanel className="ann-preview__panel">
            <div className="ann-preview__eyebrow">Event Mapping</div>
            <h2 className="ann-preview__section-title">จับคู่เหตุการณ์</h2>
            <p className="ann-preview__sub">เลือกคลิป แล้วเลือก Event ที่ต้องการ</p>
            <div className="ann-preview__progress" aria-label={`${mapped} of 24 events mapped`} role="progressbar" aria-valuenow={mapped} aria-valuemin={0} aria-valuemax={24}><div className="ann-preview__progress-fill" style={{width:`${mapped/24*100}%`}}/></div>
            <div className="ann-preview__meta">{mapped} / 24 events mapped</div>
            <div className="ann-preview__filters" aria-label="Filter events">
              {filters.map(c=><button className="ann-preview__filter" key={c} type="button" aria-pressed={filter===c} onClick={()=>setFilter(c)}>{c}</button>)}
            </div>
            <div className="ann-preview__right-scroll">
              {shownEvents.map(e=>{
                const existing=CLIPS.find(c=>c.id===assignments[e.id]);
                return <button key={e.id} className="ann-preview__event" data-selected={selectedEventId===e.id} onClick={()=>setSelectedEventId(e.id)}>
                  <span className="ann-preview__event-dot" data-mapped={!!existing}/>
                  <span className="ann-preview__event-copy"><span className="ann-preview__event-name">{e.label}</span><span className="ann-preview__event-desc">{existing?.title ?? "ยังไม่มีคลิป"}</span></span>
                  <ChevronDown size={13} aria-hidden="true"/>
                </button>;
              })}
            </div>
            <div className="ann-preview__selection">
              <div className="ann-preview__eyebrow">Selected Event</div>
              <h3 className="ann-preview__selection-name">{selectedEvent?.label.toUpperCase() ?? "TRIPLE KILL"}</h3>
              <div className="ann-preview__sub">ปัจจุบัน: {mapping?.title ?? "ยังไม่แมปเสียง"}</div>
              <GlassButton variant="primary" icon={<Link2 size={15}/>} onClick={mapSelected}>Map {selected.id}</GlassButton>
              <GlassButton variant="secondary" onClick={()=>{setAssignments(p=>{const n={...p}; delete n[selectedEventId]; return n;});setNotice("ลบ Mapping ในตัวอย่างแล้ว");}}>Remove mapping</GlassButton>
            </div>
          </GlassPanel>
          <GlassPanel className="ann-preview__panel ann-preview__ai">
            <div className="ann-preview__ai-head">
              <strong><Sparkles size={14} style={{verticalAlign:"middle",marginRight:6,color:"var(--ann-lime)"}}/>AI Copilot</strong>
              <GlassButton compact icon={agentExpanded?<X size={16}/>:<ChevronDown size={16}/>} onClick={()=>setAgentExpanded(p=>!p)} aria-expanded={agentExpanded} aria-label={agentExpanded?"Collapse AI Copilot":"Expand AI Copilot"}>{agentExpanded?"ย่อ AI":"เปิด AI"}</GlassButton>
            </div>
            <div className="ann-preview__ai-body">
              <div>เสนอ Mapping · รอผู้ใช้ตรวจและอนุมัติ</div>
              {agentExpanded && <div style={{marginTop:10}}>
                <p className="ann-preview__sub">AI เป็นเครื่องมือเสริม ไม่เปลี่ยน Mapping โดยไม่ได้รับอนุมัติ</p>
                <input className="ann-glass-field" style={{marginTop:10}} aria-label="Sample AI command" placeholder="เช่น ช่วยแนะนำจุดตัดเสียง" />
                <GlassButton style={{marginTop:10}} icon={<Check size={14}/>} onClick={()=>setNotice("UI preview เท่านั้น: ไม่เรียก LLM จริง")}>Review suggestion</GlassButton>
              </div>}
            </div>
          </GlassPanel>
        </aside>
      </main>
      <footer className="ann-preview__foot">
        <span>LOCAL AUTHORING · DESIGN PREVIEW ONLY · NO BACKEND CONNECTION</span>
        <span aria-live="polite" className="ann-preview__notice">{notice}</span>
      </footer>
    </div>
  </div>;
}
