import { invoke } from "@tauri-apps/api/core";
import { useStudioStore } from "../store/useStudioStore";
import { clearTimeline, runAutoSplit, runExport, sendToGMaiden } from "./actions";
import { installGmaidenPack } from "./exportGmaidenPack";
import { eventContractForPrompt, GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { analyzeClip, featuresYaml } from "./features";
import { saveProject } from "./project";
import { matchAnnouncerLabel } from "./honEventMap";

/**
 * The chat is function-calling: the LLM replies with a single JSON object
 * { action, args, reply }. We parse it, run the action against the store, and
 * show the result. Works the same for Ollama and Claude (both just emit text).
 */

const ACTIONS = `
- auto_split            ถอดเสียงด้วย AI แล้วแบ่ง clip ใหม่ทั้งหมด
- auto_map              ให้ AI จับคู่ทุก clip กับ event ของ G-Maiden อัตโนมัติ
- send_gmaiden          ส่ง pack ไป G-Maiden (ติดตั้งเสียงตาม event)
- save_project          บันทึกโปรเจกต์ .ann
- export                ส่งออกแพ็ก .gann
- clear                 ลบ clip ทั้งหมด
- delete_clip {index}   ลบ clip ตามลำดับ (index เริ่มที่ 1)
- rename_clip {index,name}  เปลี่ยนชื่อ clip
- set_event {index,event}   ตั้งหมวด Dota event ให้ clip (เช่น triple_kill, unstoppable, match_start)
- set_model {model}     เปลี่ยนโมเดล Whisper (small | medium | large-v3)
- tune {index,gain?,fadeIn?,fadeOut?,normalize?,speed?,eqLow?,eqMid?,eqHigh?,presence?,compression?,character?,saturation?,deEsserAmt?,deEsserFreq?}
                        ปรับแต่งเสียงของ clip (index เริ่มที่ 1 ตามลำดับที่แสดง) — gain(dB)/fadeIn/fadeOut/normalize/speed เป็นค่าหลัก, ที่เหลือคือ master -100..100
- split {index,atTime}  ตัด clip ที่วินาที atTime ออกเป็นสองท่อน
- reorder {index,toIndex}  ย้าย clip ไปตำแหน่งที่ toIndex (เริ่มที่ 1)
- select {index}        เลือก clip (index เริ่มที่ 1)
- install_gmaiden       ติดตั้ง pack แบบใหม่ลง G-Maiden (มี banner ต่อ event)
- none                  ตอบคำถาม/คุยเฉยๆ ไม่ทำ action
`.trim();

function buildSystem(featuresBlock = ""): string {
  const featuresSection = featuresBlock
    ? `\n\nฟีเจอร์เสียงของ clip ที่เลือก (สกัดจากสัญญาณจริง — ใช้ตัวเลขนี้ตัดสินการจูน):\n${featuresBlock}\n\nแนวทางตัดสิน (ใช้ action tune):\n- lufs_integrated ต่ำกว่าเป้า (เสียงพูด ~-16, YouTube -14, audiobook -18~-20) → เพิ่ม gain หรือ normalize=true\n- clipping_events>0 หรือ peak_db > -1 → ลด gain\n- sibilance_score > 0.4 → เพิ่ม deEsserAmt\n- hum_detected=true → ลด eqLow แรง (ยังไม่มี HPF ตรง)\n- band_high_pct ต่ำ/เสียงทึบ → เพิ่ม eqHigh หรือ presence · band_low_pct สูง/บวม → ลด eqLow\n- crest_db สูง/ไดนามิกกว้าง → เพิ่ม compression\n- silence_ratio สูง → พิจารณา trim`
    : "";
  const s = useStudioStore.getState();
  // NOTE: the UI numbers clips by ARRAY order (s.clips) — new actions
  // (tune/split/reorder/select/delete via index) use that. This preview list
  // keeps the existing start-sorted display for continuity.
  const ordered = s.clips.slice().sort((a, b) => a.start - b.start);
  const clipLines = ordered.length
    ? ordered
        .map((c, i) => `${i + 1}. "${c.name}" [${c.start.toFixed(1)}-${c.end.toFixed(1)}s] event=${c.event}`)
        .join("\n")
    : "(ยังไม่มี clip)";

  const selIdx = s.selectedClipId ? s.clips.findIndex((c) => c.id === s.selectedClipId) : -1;
  const selected = selIdx >= 0 ? `${selIdx + 1}` : "ไม่มี";

  return `คุณคือผู้ช่วยใน G-AnnStudio โปรแกรมตัดเสียงทำ announcer pack เกม Dota 2
ตอบเป็นภาษาไทยสั้นๆ เป็นกันเอง

ผู้ใช้จะพิมพ์คำสั่งภาษาธรรมชาติ คุณต้องตอบกลับเป็น JSON อย่างเดียว รูปแบบ:
{"action":"<ชื่อ action>","args":{...},"reply":"<ข้อความตอบผู้ใช้>"}

action ที่ใช้ได้:
${ACTIONS}

สถานะปัจจุบัน:
- ไฟล์เสียง: ${s.wavPath ? "โหลดแล้ว" : "ยังไม่มี"} (ความยาว ${s.duration.toFixed(1)}s)
- โมเดล Whisper: ${s.model}
- G-Maiden: ${s.gmaidenConnected ? "เชื่อมแล้ว" : "ยังไม่เชื่อม"}
- จำนวน clip: ${ordered.length}
- clip ที่เลือกอยู่: ${selected}
clips:
${clipLines}

หมายเหตุ: แต่ละ clip มีค่าปรับแต่งเสียง: gain(dB), fadeIn, fadeOut, normalize, speed และ master{eqLow,eqMid,eqHigh,presence,deEsserAmt,deEsserFreq,compression,character,saturation} แต่ละตัว -100..100${featuresSection}

กฎ: ตอบ JSON เท่านั้น ห้ามมีข้อความอื่นนอก JSON. ถ้าไม่แน่ใจให้ใช้ action "none" แล้วถามกลับใน reply.`;
}

interface LlmAction {
  action: string;
  args?: Record<string, any>;
  reply?: string;
}

function parseAction(raw: string): LlmAction | null {
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a === -1 || b === -1 || b < a) return null;
  try {
    return JSON.parse(raw.slice(a, b + 1));
  } catch {
    return null;
  }
}

// Actions that change/destroy data (or push outside the app) require a
// window.confirm before running. Non-destructive edits run silently.
const DESTRUCTIVE = new Set(["auto_split", "delete_clip", "send_gmaiden", "install_gmaiden", "export", "split"]);

// Keys of `tune` args that live under clip.master (each -100..100).
const MASTER_KEYS = [
  "eqLow", "eqMid", "eqHigh", "presence", "compression",
  "character", "saturation", "deEsserAmt", "deEsserFreq",
];

async function execute(action: string, args: Record<string, any> = {}): Promise<string> {
  const s = useStudioStore.getState();
  const ordered = s.clips.slice().sort((a, b) => a.start - b.start);
  const idxClip = (i: any) => {
    const n = parseInt(i, 10) - 1;
    return n >= 0 && n < ordered.length ? ordered[n] : null;
  };
  // Like idxClip but over the ARRAY order (s.clips) — the UI's clip numbering.
  const idxClipArr = (i: any) => {
    const n = parseInt(i, 10) - 1;
    return n >= 0 && n < s.clips.length ? s.clips[n] : null;
  };

  if (DESTRUCTIVE.has(action)) {
    const ok = window.confirm(`ยืนยัน: ${action} ${JSON.stringify(args)}`);
    if (!ok) return "ยกเลิกแล้ว";
  }

  switch (action) {
    case "auto_split":
      return runAutoSplit();
    case "auto_map":
      return autoMapEvents();
    case "send_gmaiden":
      return sendToGMaiden();
    case "export":
      return runExport();
    case "save_project":
      return saveProject();
    case "clear":
      return clearTimeline();
    case "delete_clip": {
      const c = idxClip(args.index);
      if (!c) return `ไม่มี clip หมายเลข ${args.index}`;
      s.removeClip(c.id);
      return `ลบ clip ${args.index} (“${c.name}”) แล้ว`;
    }
    case "rename_clip": {
      const c = idxClip(args.index);
      if (!c) return `ไม่มี clip หมายเลข ${args.index}`;
      s.updateClip(c.id, { name: String(args.name ?? "") });
      return `เปลี่ยนชื่อ clip ${args.index} เป็น “${args.name}” แล้ว`;
    }
    case "set_event": {
      const c = idxClip(args.index);
      if (!c) return `ไม่มี clip หมายเลข ${args.index}`;
      s.updateClip(c.id, { event: String(args.event ?? "custom") });
      return `ตั้ง event ของ clip ${args.index} เป็น ${args.event}`;
    }
    case "set_model": {
      const m = String(args.model ?? "");
      if (!["small", "medium", "large-v3"].includes(m)) return `โมเดลไม่ถูกต้อง: ${m}`;
      s.setModel(m);
      return `เปลี่ยนโมเดลเป็น ${m} แล้ว`;
    }
    case "tune": {
      const c = idxClipArr(args.index);
      if (!c) return `ไม่มี clip หมายเลข ${args.index}`;
      const patch: Record<string, any> = {};
      const changed: string[] = [];
      // top-level tuning fields
      if (args.gain != null) { patch.gain = Number(args.gain); changed.push(`gain=${patch.gain}dB`); }
      if (args.fadeIn != null) { patch.fadeIn = Number(args.fadeIn); changed.push(`fadeIn=${patch.fadeIn}s`); }
      if (args.fadeOut != null) { patch.fadeOut = Number(args.fadeOut); changed.push(`fadeOut=${patch.fadeOut}s`); }
      if (args.normalize != null) { patch.normalize = Boolean(args.normalize); changed.push(`normalize=${patch.normalize}`); }
      if (args.speed != null) { patch.speed = Number(args.speed); changed.push(`speed=${patch.speed}x`); }
      // master (mastering) knobs
      const masterPatch: Record<string, number> = {};
      for (const k of MASTER_KEYS) {
        if (args[k] != null) { masterPatch[k] = Number(args[k]); changed.push(`${k}=${masterPatch[k]}`); }
      }
      if (Object.keys(masterPatch).length) {
        patch.master = { ...(c.master ?? {}), ...masterPatch };
      }
      if (!changed.length) return `ไม่มีค่าให้ปรับสำหรับ clip ${args.index}`;
      s.updateClip(c.id, patch);
      return `ปรับ clip ${args.index} (“${c.name}”): ${changed.join(", ")}`;
    }
    case "split": {
      const c = idxClipArr(args.index);
      if (!c) return `ไม่มี clip หมายเลข ${args.index}`;
      const t = Number(args.atTime);
      if (!Number.isFinite(t) || t <= c.start || t >= c.end)
        return `atTime ต้องอยู่ระหว่าง ${c.start.toFixed(1)}-${c.end.toFixed(1)}s`;
      s.splitClip(c.id, t);
      return `ตัด clip ${args.index} ที่ ${t.toFixed(1)}s แล้ว`;
    }
    case "reorder": {
      const c = idxClipArr(args.index);
      if (!c) return `ไม่มี clip หมายเลข ${args.index}`;
      const to = parseInt(args.toIndex, 10);
      if (!Number.isFinite(to) || to < 1 || to > s.clips.length)
        return `toIndex ต้องอยู่ระหว่าง 1-${s.clips.length}`;
      s.moveClip(c.id, to - 1);
      return `ย้าย clip ${args.index} ไปตำแหน่ง ${to} แล้ว`;
    }
    case "select": {
      const c = idxClipArr(args.index);
      if (!c) return `ไม่มี clip หมายเลข ${args.index}`;
      s.selectClip(c.id);
      return `เลือก clip ${args.index} (“${c.name}”) แล้ว`;
    }
    case "install_gmaiden":
      return installGmaidenPack();
    case "none":
    default:
      return "";
  }
}

/**
 * Ask the LLM to map each clip's transcribed text to the best G-Maiden event
 * (from the shared contract). Applies the assignments to the store.
 */
export async function autoMapEvents(): Promise<string> {
  const s = useStudioStore.getState();
  const ordered = s.clips.slice().sort((a, b) => a.start - b.start);
  if (!ordered.length) return "ยังไม่มี clip ให้ map";

  const valid = new Set(GMAIDEN_EVENTS.map((e) => e.id));

  // W4 deterministic pass: a clip whose name carries a known announcer label
  // (HoN button text / Dota event name) maps here — no LLM guess needed. The
  // LLM handles only what's left (e.g. Thai transcript lines).
  let direct = 0;
  const remaining: typeof ordered = [];
  for (const c of ordered) {
    const hit = matchAnnouncerLabel(c.name);
    if (hit && valid.has(hit)) {
      useStudioStore.getState().updateClip(c.id, { event: hit });
      direct++;
    } else {
      remaining.push(c);
    }
  }
  const total = ordered.length;
  if (!remaining.length) {
    return `map event ให้ ${direct}/${total} clips แล้ว 🎯 (ทั้งหมดจากป้าย announcer)`;
  }

  const clipList = remaining.map((c, i) => `${i + 1}. ${c.name}`).join("\n");
  const system = `คุณคือผู้ช่วย map เสียงพากย์ announcer เกม Dota 2 ให้ตรงกับ event ของ G-Maiden
จับคู่ข้อความของแต่ละ clip กับ event id ที่เหมาะที่สุดจากรายการนี้ (ใช้ id ตรงตามนี้เท่านั้น):
${eventContractForPrompt()}
ถ้า clip ไหนไม่เข้ากับ event ใดเลย ให้ใช้ "unused"
ตอบเป็น JSON อย่างเดียว: {"map":[{"index":1,"event":"<id>"},...]} ครบทุก clip ห้ามมีข้อความอื่น`;
  const prompt = `clips:\n${clipList}`;

  const raw = await invoke<string>("llm_complete", {
    provider: s.provider,
    model: s.provider === "ollama" ? s.llmModel || undefined : undefined,
    system,
    prompt,
  });

  const doneNote = direct > 0 ? ` (${direct} จากป้าย announcer)` : "";
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a === -1 || b === -1)
    return `map จากป้ายได้ ${direct}/${total} clips แล้ว — ส่วนที่เหลือ AI ตอบไม่เป็น JSON ลองใหม่`;
  let parsed: { map?: Array<{ index: number; event: string }> };
  try {
    parsed = JSON.parse(raw.slice(a, b + 1));
  } catch {
    return `map จากป้ายได้ ${direct}/${total} clips แล้ว — อ่านผล AI ส่วนที่เหลือไม่ได้ ลองใหม่`;
  }

  let applied = 0;
  for (const m of parsed.map || []) {
    const clip = remaining[m.index - 1];
    if (clip && valid.has(m.event)) {
      useStudioStore.getState().updateClip(clip.id, { event: m.event });
      applied++;
    }
  }
  return `map event ให้ ${direct + applied}/${total} clips แล้ว 🎯${doneNote}`;
}

export class ChatProviderUnavailable extends Error {}

/** Send a user message through the LLM and run whatever action it picks. */
export async function chatLlm(userText: string): Promise<string> {
  const s = useStudioStore.getState();
  const { provider, llmModel } = s;
  if (/^(?:บันทึก(?:โปรเจกต์)?|save(?: project)?)$/i.test(userText.trim())) return saveProject();

  // extract audio features for the selected clip — the agent decides from numbers
  let featuresBlock = "";
  const sel = s.clips.find((c) => c.id === s.selectedClipId);
  if (sel && s.wavPath) {
    try {
      featuresBlock = featuresYaml(await analyzeClip(s.wavPath, sel));
    } catch { /* features are best-effort */ }
  }
  const raw = await invoke<string>("llm_complete", {
    provider,
    model: provider === "ollama" ? llmModel || undefined : undefined,
    system: buildSystem(featuresBlock),
    prompt: userText,
  }).catch(error => { throw new ChatProviderUnavailable(String(error)); });
  const current = useStudioStore.getState();
  if (current.projectSession !== s.projectSession || current.projectDocument?.projectId !== s.projectDocument?.projectId ||
      current.projectGeneration !== s.projectGeneration) throw new Error("โปรเจกต์เปลี่ยนแล้ว กรุณาส่งคำสั่งอีกครั้ง");
  const parsed = parseAction(raw);
  if (!parsed) {
    // model didn't return JSON — just surface its text
    return raw.trim().slice(0, 500) || "(ไม่มีคำตอบ)";
  }
  const result = await execute(parsed.action, parsed.args || {});
  const reply = (parsed.reply || "").trim();
  if (result && reply) return `${reply}\n${result}`;
  return result || reply || "(เสร็จ)";
}
