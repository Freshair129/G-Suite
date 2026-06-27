import { invoke } from "@tauri-apps/api/core";
import { useStudioStore } from "../store/useStudioStore";
import { runAutoSplit, runExport } from "./actions";

/**
 * The chat is function-calling: the LLM replies with a single JSON object
 * { action, args, reply }. We parse it, run the action against the store, and
 * show the result. Works the same for Ollama and Claude (both just emit text).
 */

const ACTIONS = `
- auto_split            ถอดเสียงด้วย AI แล้วแบ่ง clip ใหม่ทั้งหมด
- export                ส่งออก WAV + manifest
- clear                 ลบ clip ทั้งหมด
- delete_clip {index}   ลบ clip ตามลำดับ (index เริ่มที่ 1)
- rename_clip {index,name}  เปลี่ยนชื่อ clip
- set_event {index,event}   ตั้งหมวด Dota event ให้ clip (เช่น triple_kill, unstoppable, match_start)
- set_model {model}     เปลี่ยนโมเดล Whisper (small | medium | large-v3)
- none                  ตอบคำถาม/คุยเฉยๆ ไม่ทำ action
`.trim();

function buildSystem(): string {
  const s = useStudioStore.getState();
  const ordered = s.clips.slice().sort((a, b) => a.start - b.start);
  const clipLines = ordered.length
    ? ordered
        .map((c, i) => `${i + 1}. "${c.name}" [${c.start.toFixed(1)}-${c.end.toFixed(1)}s] event=${c.event}`)
        .join("\n")
    : "(ยังไม่มี clip)";

  return `คุณคือผู้ช่วยใน G-AnnStudio โปรแกรมตัดเสียงทำ announcer pack เกม Dota 2
ตอบเป็นภาษาไทยสั้นๆ เป็นกันเอง

ผู้ใช้จะพิมพ์คำสั่งภาษาธรรมชาติ คุณต้องตอบกลับเป็น JSON อย่างเดียว รูปแบบ:
{"action":"<ชื่อ action>","args":{...},"reply":"<ข้อความตอบผู้ใช้>"}

action ที่ใช้ได้:
${ACTIONS}

สถานะปัจจุบัน:
- ไฟล์เสียง: ${s.wavPath ? "โหลดแล้ว" : "ยังไม่มี"} (ความยาว ${s.duration.toFixed(1)}s)
- โมเดล Whisper: ${s.model}
- จำนวน clip: ${ordered.length}
clips:
${clipLines}

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

async function execute(action: string, args: Record<string, any> = {}): Promise<string> {
  const s = useStudioStore.getState();
  const ordered = s.clips.slice().sort((a, b) => a.start - b.start);
  const idxClip = (i: any) => {
    const n = parseInt(i, 10) - 1;
    return n >= 0 && n < ordered.length ? ordered[n] : null;
  };

  switch (action) {
    case "auto_split":
      return runAutoSplit();
    case "export":
      return runExport();
    case "clear": {
      if (!s.clips.length) return "ยังไม่มี clip อยู่แล้ว";
      const n = s.clips.length;
      s.setClips([]);
      return `ล้าง ${n} clips แล้ว`;
    }
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
    case "none":
    default:
      return "";
  }
}

/** Send a user message through the LLM and run whatever action it picks. */
export async function chatLlm(userText: string): Promise<string> {
  const { provider, llmModel } = useStudioStore.getState();
  const raw = await invoke<string>("llm_complete", {
    provider,
    model: provider === "ollama" ? llmModel || undefined : undefined,
    system: buildSystem(),
    prompt: userText,
  });
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
