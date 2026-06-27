// Mirror of G-Suite/schemas/gmaiden-events.json (the shared contract with
// G-Maiden). Keep in sync with that file — it is the source of truth.

export interface GMaidenEvent {
  id: string;
  label: string;
  category: string;
  priority: "critical" | "high" | "normal" | "low" | "none";
  status: "active" | "new";
  trigger: string;
}

export const GMAIDEN_EVENTS: GMaidenEvent[] = [
  { id: "danger",        label: "Gank Warning",   category: "Signal",   priority: "critical", status: "active", trigger: "ศัตรูหายจาก vision + เสี่ยงโดนรุม > 85%" },
  { id: "revision",      label: "Belief Revision", category: "Signal",  priority: "high",     status: "active", trigger: "เตือน gank แล้วเสี่ยงตก — แก้คำกลางคัน" },
  { id: "match_start",   label: "Match Start",    category: "Flow",     priority: "normal",   status: "new",    trigger: "เกมเริ่ม" },
  { id: "first_blood",   label: "First Blood",    category: "Kill",     priority: "high",     status: "new",    trigger: "ฆ่าครั้งแรกของเกม" },
  { id: "kill",          label: "Kill",           category: "Kill",     priority: "normal",   status: "active", trigger: "ฆ่าศัตรู (เดี่ยว)" },
  { id: "double_kill",   label: "Double Kill",    category: "Kill",     priority: "normal",   status: "new",    trigger: "ฆ่า 2 ศพในช่วงสั้น" },
  { id: "triple_kill",   label: "Triple Kill",    category: "Kill",     priority: "high",     status: "new",    trigger: "ฆ่า 3 ศพต่อเนื่อง" },
  { id: "ultra_kill",    label: "Ultra Kill",     category: "Kill",     priority: "high",     status: "new",    trigger: "ฆ่า 4 ศพต่อเนื่อง" },
  { id: "rampage",       label: "Rampage",        category: "Kill",     priority: "critical", status: "new",    trigger: "ฆ่า 5 ศพต่อเนื่อง" },
  { id: "killing_spree", label: "Killing Spree",  category: "Streak",   priority: "normal",   status: "new",    trigger: "ฆ่าต่อเนื่องไม่ตาย 3 ครั้ง" },
  { id: "unstoppable",   label: "Unstoppable",    category: "Streak",   priority: "high",     status: "new",    trigger: "streak ไม่ตาย ~6 ครั้ง" },
  { id: "godlike",       label: "Godlike",        category: "Streak",   priority: "critical", status: "new",    trigger: "streak ไม่ตาย ~9 ครั้ง" },
  { id: "death",         label: "Death",          category: "State",    priority: "normal",   status: "active", trigger: "ผู้เล่นตาย" },
  { id: "respawn",       label: "Respawn",        category: "State",    priority: "low",      status: "active", trigger: "เกิดใหม่" },
  { id: "levelUp",       label: "Level Up",       category: "State",    priority: "low",      status: "active", trigger: "เลเวลเพิ่ม" },
  { id: "hpLow",         label: "HP Low",         category: "State",    priority: "high",     status: "new",    trigger: "เลือด < 20%" },
  { id: "manaLow",       label: "Mana Low",       category: "State",    priority: "normal",   status: "active", trigger: "มานา < 15%" },
  { id: "advice",        label: "Maiden Advice",  category: "Strategy", priority: "low",      status: "active", trigger: "ให้คำแนะนำ" },
  { id: "unused",        label: "(ไม่ใช้)",        category: "Other",    priority: "none",     status: "active", trigger: "ไม่ผูก event — ไม่ส่งไป G-Maiden" },
];

export const EVENT_CATEGORIES = [...new Set(GMAIDEN_EVENTS.map((e) => e.category))];

export const eventLabel = (id: string) =>
  GMAIDEN_EVENTS.find((e) => e.id === id)?.label ?? id;

/** Compact list for an LLM prompt: "id — trigger". */
export const eventContractForPrompt = () =>
  GMAIDEN_EVENTS.filter((e) => e.id !== "unused")
    .map((e) => `${e.id} — ${e.trigger}`)
    .join("\n");
