import { useState, useRef, useEffect } from "react";
import { Send, Sparkles, Bot } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";
import { runAutoSplit, runExport } from "../lib/actions";
import { chatLlm } from "../lib/llm";

interface Msg {
  role: "user" | "ai";
  text: string;
}

const HELP = [
  "คำสั่งที่ใช้ได้ (พิมพ์ไทยหรืออังกฤษก็ได้):",
  "• “แยกอัตโนมัติ” / “ถอดเสียง” — ถอดเสียงแล้วแบ่ง clip",
  "• “ใช้ large-v3” — เปลี่ยนโมเดล (small / medium / large-v3)",
  "• “ส่งออก” — บันทึก WAV + manifest",
  "• “มีกี่ clip” — สรุปจำนวน/ความยาว",
  "• “ลบ clip 3” — ลบตามลำดับ",
  "• “เปลี่ยนชื่อ 3 เป็น triple-kill” — ตั้งชื่อ clip",
  "• “ล้างทั้งหมด” — ลบ clip ทุกอัน",
].join("\n");

async function handleCommand(raw: string): Promise<string> {
  const text = raw.trim();
  const low = text.toLowerCase();
  const s = useStudioStore.getState();
  const ordered = s.clips.slice().sort((a, b) => a.start - b.start);

  const has = (...kw: string[]) => kw.some((k) => low.includes(k));

  if (has("ช่วย", "help", "คำสั่ง", "ทำอะไรได้")) return HELP;

  // change model
  const m = low.match(/large-v3|large|medium|small/);
  if (m && has("model", "โมเดล", "ใช้", "เปลี่ยนโมเดล", "use")) {
    const model = m[0] === "large" ? "large-v3" : m[0];
    s.setModel(model);
    return `เปลี่ยนโมเดลเป็น ${model} แล้ว`;
  }

  if (has("แยก", "ถอด", "split", "auto", "transcrib")) return runAutoSplit();
  if (has("ส่งออก", "export", "บันทึก", "save")) return runExport();

  if (has("ล้าง", "ลบทั้งหมด", "ลบหมด", "clear", "reset")) {
    if (!s.clips.length) return "ยังไม่มี clip อยู่แล้วครับ";
    const n = s.clips.length;
    s.setClips([]);
    return `ล้าง ${n} clips แล้ว`;
  }

  if (has("กี่", "จำนวน", "count", "how many", "สรุป", "info", "สถานะ")) {
    if (!s.wavPath) return "ยังไม่ได้นำเข้าไฟล์เสียง";
    const covered = s.clips.reduce((x, c) => x + (c.end - c.start), 0);
    const pct = s.duration ? Math.round((covered / s.duration) * 100) : 0;
    return `มี ${s.clips.length} clips · ความยาวไฟล์ ${s.duration.toFixed(1)}s · ครอบคลุม ${pct}%`;
  }

  // delete clip N
  const del = low.match(/(?:ลบ|delete|remove)\D*(\d+)/);
  if (del) {
    const i = parseInt(del[1], 10) - 1;
    if (i < 0 || i >= ordered.length) return `ไม่มี clip หมายเลข ${del[1]}`;
    const c = ordered[i];
    s.removeClip(c.id);
    return `ลบ clip ${del[1]} (“${c.name}”) แล้ว`;
  }

  // rename N to X
  const ren = text.match(/(?:เปลี่ยนชื่อ|rename|ตั้งชื่อ)\D*(\d+)\s*(?:เป็น|to|=|:)\s*(.+)/i);
  if (ren) {
    const i = parseInt(ren[1], 10) - 1;
    const name = ren[2].trim();
    if (i < 0 || i >= ordered.length) return `ไม่มี clip หมายเลข ${ren[1]}`;
    s.updateClip(ordered[i].id, { name });
    return `เปลี่ยนชื่อ clip ${ren[1]} เป็น “${name}” แล้ว`;
  }

  return 'ยังไม่เข้าใจคำสั่งนี้ครับ — พิมพ์ “ช่วย” เพื่อดูคำสั่งที่ใช้ได้';
}

export default function ChatPanel() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "ai", text: "สวัสดีครับ! สั่งงานผมได้เลย เช่น “แยกอัตโนมัติ” หรือพิมพ์ “ช่วย” ดูคำสั่งทั้งหมด" },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const provider = useStudioStore((s) => s.provider);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      // Primary: the chosen LLM (Ollama / Claude) with function calling.
      // Fallback: the offline rule-based parser if the provider is unreachable.
      let reply: string;
      try {
        reply = await chatLlm(text);
      } catch (e) {
        const note =
          provider === "ollama"
            ? "⚠️ ต่อ Ollama ไม่ได้ (เช็คว่ารันอยู่) — ใช้ตัวแปลคำสั่งสำรอง\n"
            : "⚠️ เรียก Claude ไม่ได้ — ใช้ตัวแปลคำสั่งสำรอง\n";
        reply = note + (await handleCommand(text));
      }
      setMessages((m) => [...m, { role: "ai", text: reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "ai", text: `เกิดข้อผิดพลาด: ${e}` }]);
    } finally {
      setBusy(false);
    }
  }

  const quick = ["แยกอัตโนมัติ", "มีกี่ clip", "ส่งออก", "ช่วย"];

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m, i) => (
          <div key={i} className={`flex gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
            {m.role === "ai" && (
              <div className="grid place-items-center w-6 h-6 rounded-lg bg-gradient-to-tr from-lime to-grass text-black shrink-0 mt-0.5">
                <Bot size={14} />
              </div>
            )}
            <div
              className={`max-w-[80%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "bg-white text-black rounded-br-sm"
                  : "bg-panel border border-line text-ink rounded-bl-sm"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex gap-2 items-center text-ink-faint text-xs pl-8">
            <Sparkles size={13} className="text-lime animate-pulse" /> กำลังทำงาน…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="px-3 pb-2 flex flex-wrap gap-1.5">
        {quick.map((q) => (
          <button
            key={q}
            onClick={() => setInput(q)}
            className="px-2.5 py-1 rounded-full bg-panel border border-line text-[11px] text-ink-muted hover:text-ink hover:border-lime/50 transition"
          >
            {q}
          </button>
        ))}
      </div>

      <div className="p-3 border-t border-line">
        <div className="flex items-center gap-2 bg-panel border border-line rounded-2xl px-3 py-2 focus-within:border-lime/60 transition">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="พิมพ์คำสั่ง AI…"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
          <button
            onClick={send}
            disabled={busy || !input.trim()}
            className="grid place-items-center w-8 h-8 rounded-xl bg-lime text-black hover:bg-lime-dim transition disabled:opacity-40"
            title="ส่ง"
          >
            <Send size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
