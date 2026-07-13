import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Settings as SettingsIcon,
  Cpu,
  FolderOpen,
  Sparkles,
  Music,
  Gamepad2,
  Info,
  ChevronRight,
} from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";

type Section = "general" | "audio" | "ai" | "gmaiden" | "about";

const SECTIONS: { id: Section; icon: typeof Cpu; label: string }[] = [
  { id: "general", icon: SettingsIcon, label: "ทั่วไป" },
  { id: "audio", icon: Music, label: "เสียง" },
  { id: "ai", icon: Sparkles, label: "AI Provider" },
  { id: "gmaiden", icon: Gamepad2, label: "G-Maiden" },
  { id: "about", icon: Info, label: "เกี่ยวกับ" },
];

export default function Settings() {
  const [section, setSection] = useState<Section>("general");
  const { libraryRoot, provider, llmModel, gmaidenPath, gmaidenConnected } = useStudioStore();
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

  useEffect(() => {
    invoke<string[]>("list_ollama_models")
      .then(setOllamaModels)
      .catch(() => setOllamaModels([]));
  }, []);

  return (
    <div className="flex-1 flex min-h-0 bg-base">
      {/* Sidebar nav */}
      <div className="w-[220px] shrink-0 border-r border-line bg-panel/50 py-4">
        <div className="px-4 mb-4">
          <h2 className="text-sm font-semibold text-ink">Settings</h2>
          <p className="text-[10px] text-ink-faint mt-0.5">การตั้งค่าแอปพลิเคชัน</p>
        </div>
        <nav className="space-y-0.5 px-2">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition ${
                  active
                    ? "bg-lime/10 text-lime border border-lime/20"
                    : "text-ink-muted hover:bg-panel-hover hover:text-ink border border-transparent"
                }`}
              >
                <Icon size={14} />
                <span className="flex-1 text-left">{s.label}</span>
                {active && <ChevronRight size={12} />}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-[600px] mx-auto space-y-6">
          {section === "general" && <GeneralSection libraryRoot={libraryRoot} />}
          {section === "audio" && <AudioSection />}
          {section === "ai" && <AISection provider={provider} llmModel={llmModel} ollamaModels={ollamaModels} />}
          {section === "gmaiden" && <GMaidenSection path={gmaidenPath} connected={gmaidenConnected} />}
          {section === "about" && <AboutSection />}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h3 className="text-lg font-bold text-ink">{title}</h3>
      <p className="text-xs text-ink-faint mt-1">{subtitle}</p>
    </div>
  );
}

function FieldGroup({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3 border-b border-line/30">
      <div className="flex-1">
        <div className="text-xs font-medium text-ink">{label}</div>
        {description && <p className="text-[10px] text-ink-faint mt-0.5">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function GeneralSection({ libraryRoot }: { libraryRoot: string }) {
  return (
    <>
      <SectionTitle title="ทั่วไป" subtitle="การตั้งค่าทั่วไปของแอป" />

      <FieldGroup label="Library Path" description="ตำแหน่งที่เก็บ Sound Library (SQLite + ไฟล์เสียง)">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-ink-faint max-w-[240px] truncate" title={libraryRoot}>
            {libraryRoot || "Not set"}
          </span>
          <button className="grid place-items-center w-7 h-7 rounded-lg border border-line text-ink-faint hover:text-ink hover:bg-panel-hover transition">
            <FolderOpen size={13} />
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="ภาษา" description="ภาษาของ UI">
        <select className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer">
          <option value="th">ไทย</option>
          <option value="en">English</option>
        </select>
      </FieldGroup>

      <FieldGroup label="Theme" description="โทนสีของแอป">
        <select className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer">
          <option value="dark">Dark (FluxNode)</option>
          <option value="midnight">Midnight</option>
        </select>
      </FieldGroup>
    </>
  );
}

function AudioSection() {
  return (
    <>
      <SectionTitle title="เสียง" subtitle="ตั้งค่าเริ่มต้นสำหรับ Audio Processing" />

      <FieldGroup label="Default Format" description="ฟอร์แมตไฟล์เสียงเริ่มต้นสำหรับการ Export">
        <select className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer">
          <option value="wav">WAV (Lossless)</option>
          <option value="mp3">MP3</option>
          <option value="ogg">OGG Vorbis</option>
        </select>
      </FieldGroup>

      <FieldGroup label="Sample Rate" description="อัตราสุ่มตัวอย่างเสียง">
        <select className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer">
          <option value="44100">44.1 kHz</option>
          <option value="48000">48 kHz</option>
          <option value="22050">22.05 kHz</option>
        </select>
      </FieldGroup>

      <FieldGroup label="Bit Depth" description="ความละเอียดของเสียง">
        <select className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer">
          <option value="16">16-bit</option>
          <option value="24">24-bit</option>
          <option value="32">32-bit float</option>
        </select>
      </FieldGroup>

      <FieldGroup label="Clip Padding" description="ระยะเวลา padding ก่อน/หลังเมื่อตัด clip (วินาที)">
        <input
          type="number"
          min={0}
          max={10}
          step={0.5}
          defaultValue={2}
          className="w-16 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-ink text-center font-mono outline-none"
        />
      </FieldGroup>

      <FieldGroup label="Whisper Model" description="ขนาดโมเดลสำหรับ Speech-to-Text">
        <select className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer">
          <option value="tiny">Tiny (ไว แต่แม่นน้อย)</option>
          <option value="small">Small</option>
          <option value="medium">Medium (แนะนำ)</option>
          <option value="large-v3">Large-v3 (แม่นมาก)</option>
        </select>
      </FieldGroup>
    </>
  );
}

function AISection({ provider, llmModel, ollamaModels }: { provider: string; llmModel: string; ollamaModels: string[] }) {
  const { setProvider, setLlmModel, sdEndpoint, setSdEndpoint } = useStudioStore();

  return (
    <>
      <SectionTitle title="AI Provider" subtitle="เลือก AI สำหรับ Chat และ Auto-Map" />

      <FieldGroup label="Provider" description="ใช้ Ollama (ฟรี, local) หรือ Claude (plan quota)">
        <select
          value={provider}
          onChange={(e) => setProvider(e.target.value as "ollama" | "claude")}
          className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer"
        >
          <option value="ollama">Ollama (Local)</option>
          <option value="claude">Claude (Plan)</option>
        </select>
      </FieldGroup>

      {provider === "ollama" && (
        <FieldGroup label="Ollama Model" description="เลือกโมเดลที่ติดตั้งไว้ใน Ollama">
          <select
            value={llmModel}
            onChange={(e) => setLlmModel(e.target.value)}
            className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer max-w-[200px]"
          >
            {ollamaModels.length === 0 && <option value="">ไม่พบโมเดล</option>}
            {ollamaModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </FieldGroup>
      )}

      <FieldGroup label="Function Calling" description="รูปแบบ JSON protocol สำหรับ AI chat">
        <span className="text-[10px] font-mono text-lime">{`{action, args, reply}`}</span>
      </FieldGroup>

      <FieldGroup label="SD Banner Endpoint" description="Stable Diffusion WebUI (--api) สำหรับสร้างภาพ banner ด้วย AI">
        <input
          type="text"
          value={sdEndpoint}
          onChange={(e) => setSdEndpoint(e.target.value)}
          placeholder="http://127.0.0.1:7860"
          className="w-52 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-ink font-mono outline-none focus:border-lime"
        />
      </FieldGroup>

      <div className="mt-4 p-3 rounded-lg bg-panel/50 border border-line/30">
        <p className="text-[10px] text-ink-faint leading-relaxed">
          <strong className="text-ink">Ollama</strong> — ทำงาน local ที่ localhost:11434 ไม่เสียค่าใช้จ่าย ต้องติดตั้ง Ollama และดึงโมเดลก่อน
          <br /><br />
          <strong className="text-ink">Claude</strong> — ใช้ Claude CLI ผ่าน plan quota ของ Anthropic ไม่ต้องใส่ API key
        </p>
      </div>
    </>
  );
}

function GMaidenSection({ path, connected }: { path: string; connected: boolean }) {
  return (
    <>
      <SectionTitle title="G-Maiden" subtitle="เชื่อมต่อกับ G-Maiden Dota 2 AI Companion" />

      <FieldGroup label="สถานะ" description="การเชื่อมต่อกับ G-Maiden">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? "bg-grass" : "bg-ink-faint"}`} />
          <span className={`text-xs ${connected ? "text-grass" : "text-ink-faint"}`}>
            {connected ? "Connected" : "Not connected"}
          </span>
        </div>
      </FieldGroup>

      <FieldGroup label="G-Maiden Path" description="ตำแหน่งโฟลเดอร์ G-Maiden (sibling dir หรือ GMAIDEN_DIR)">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-ink-faint max-w-[200px] truncate" title={path}>
            {path || "Auto-detect"}
          </span>
          <button className="grid place-items-center w-7 h-7 rounded-lg border border-line text-ink-faint hover:text-ink hover:bg-panel-hover transition">
            <FolderOpen size={13} />
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="Install Endpoint" description="URL ของ G-Maiden server สำหรับ install pack">
        <input
          type="text"
          defaultValue="localhost:3000"
          className="w-40 bg-panel border border-line rounded-lg px-2 py-1.5 text-xs text-ink font-mono outline-none"
        />
      </FieldGroup>

      <FieldGroup label="Auth Mode" description="ระดับ Authentication (Phase 1=local, 2=HMAC, 3=cloud)">
        <select className="bg-panel border border-line rounded-lg px-3 py-1.5 text-xs text-ink outline-none cursor-pointer">
          <option value="local">Phase 1 — Local</option>
          <option value="hmac">Phase 2 — HMAC-SHA256</option>
          <option value="cloud">Phase 3 — Cloud</option>
        </select>
      </FieldGroup>
    </>
  );
}

function AboutSection() {
  return (
    <>
      <SectionTitle title="เกี่ยวกับ" subtitle="G-AnnStudio — Announcer Pack Editor for G-Maiden" />

      <div className="flex items-center gap-4 py-4">
        <div className="grid place-items-center w-14 h-14 rounded-2xl bg-gradient-to-tr from-lime to-grass text-black font-extrabold text-2xl shrink-0">
          G
        </div>
        <div>
          <h4 className="text-sm font-bold text-ink">G-AnnStudio</h4>
          <p className="text-[11px] text-ink-faint mt-0.5">Version 0.1.0</p>
          <p className="text-[10px] text-ink-faint mt-1">Part of the G-Suite monorepo</p>
        </div>
      </div>

      <div className="space-y-3 mt-4">
        <InfoRow label="Framework" value="Tauri v2 + React + TypeScript" />
        <InfoRow label="Audio" value="FFmpeg + faster-whisper (CTranslate2)" />
        <InfoRow label="Database" value="SQLite (rusqlite bundled)" />
        <InfoRow label="AI" value="Ollama (local) / Claude CLI (plan)" />
        <InfoRow label="Repo" value="github.com/Freshair129/G-Suite" />
      </div>

      <div className="mt-6 p-3 rounded-lg bg-panel/50 border border-line/30">
        <p className="text-[10px] text-ink-faint leading-relaxed">
          สร้างเสียง Announcer Pack สำหรับ G-Maiden — Dota 2 AI Companion
          <br />
          ตัด ต่อ แก้ไข เสียง แล้ว export ไปใช้ใน Dota 2 ได้ทันที
        </p>
      </div>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-line/20 text-xs">
      <span className="text-ink-faint">{label}</span>
      <span className="font-mono text-[10px] text-ink">{value}</span>
    </div>
  );
}
