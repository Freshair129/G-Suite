import { useState, useEffect, useCallback } from "react";
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
  RefreshCw,
  Wrench,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useStudioStore } from "../store/useStudioStore";
import { GMAIDEN_INSTALL_ENDPOINT } from "../lib/gmaidenEndpoint";

type Section = "general" | "audio" | "ai" | "runtime" | "gmaiden" | "about";

const SECTIONS: { id: Section; icon: typeof Cpu; label: string }[] = [
  { id: "general", icon: SettingsIcon, label: "ทั่วไป" },
  { id: "audio", icon: Music, label: "เสียง" },
  { id: "ai", icon: Sparkles, label: "AI Provider" },
  { id: "runtime", icon: Wrench, label: "Media Runtime" },
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
          {section === "runtime" && <RuntimeSection />}
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

type RuntimeToolStatus = {
  available: boolean;
  path: string;
  version: string | null;
  error: string | null;
};

type RuntimeDiagnostics = {
  tools_dir: string;
  ffmpeg: RuntimeToolStatus;
  python: RuntimeToolStatus;
  sidecar_path: string;
  scripts: Record<string, boolean>;
  python_modules: Record<string, boolean>;
  ready_for_media: boolean;
  ready_for_speech: boolean;
  ready_for_video_analysis: boolean;
};

function RuntimeSection() {
  const [report, setReport] = useState<RuntimeDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      setReport(await invoke<RuntimeDiagnostics>("runtime_diagnostics"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function chooseToolsDirectory() {
    const selected = await open({
      title: "เลือก AI-Studio tools directory",
      directory: true,
      multiple: false,
    });
    if (typeof selected !== "string") return;
    setNotice("");
    setError("");
    try {
      await invoke("set_runtime_tools_dir", { path: selected });
      setNotice("บันทึกตำแหน่ง tools แล้ว");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function clearToolsDirectory() {
    setNotice("");
    setError("");
    try {
      await invoke("set_runtime_tools_dir", { path: null });
      setNotice("ล้างตำแหน่ง tools ที่กำหนดเองแล้ว");
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <>
      <SectionTitle title="Media Runtime" subtitle="ตรวจ FFmpeg, Python และ sidecar ก่อนเริ่มงานเสียงหรือวิดีโอ" />
      <div className="rounded-xl border border-line/40 bg-panel/40 p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-medium text-ink">AI-Studio tools directory</div>
            <p className="text-[10px] text-ink-faint mt-1 break-all">
              {report?.tools_dir || "ยังไม่ได้กำหนด — ใช้ PATH และตำแหน่งมาตรฐาน"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => void chooseToolsDirectory()} className="px-2.5 py-1.5 rounded-lg border border-line text-[10px] text-ink-muted hover:text-ink hover:bg-panel-hover">
              เลือกโฟลเดอร์
            </button>
            {report?.tools_dir && (
              <button onClick={() => void clearToolsDirectory()} className="px-2.5 py-1.5 rounded-lg border border-line text-[10px] text-ink-muted hover:text-ink hover:bg-panel-hover">
                ล้าง
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void refresh()} disabled={busy} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-line text-[10px] text-ink-muted hover:text-ink hover:bg-panel-hover disabled:opacity-50">
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
            ตรวจอีกครั้ง
          </button>
          {notice && <span role="status" className="text-[10px] text-lime">{notice}</span>}
          {error && <span role="alert" className="text-[10px] text-red-300 break-all">{error}</span>}
        </div>
      </div>

      {report ? (
        <div className="space-y-3">
          <RuntimeToolRow label="FFmpeg · import / cut / export" tool={report.ffmpeg} />
          <RuntimeToolRow label="Python · sidecar runner" tool={report.python} />
          <div className="rounded-xl border border-line/40 bg-panel/40 p-4 space-y-2">
            <div className="text-[10px] text-ink-faint">Sidecar files · {report.sidecar_path}</div>
            {Object.entries(report.scripts).map(([name, available]) => (
              <RuntimeCheck key={name} label={name} available={available} />
            ))}
          </div>
          <div className="rounded-xl border border-line/40 bg-panel/40 p-4 space-y-2">
            <div className="text-[10px] text-ink-faint">Python modules</div>
            {Object.entries(report.python_modules).map(([name, available]) => (
              <RuntimeCheck key={name} label={name} available={available} />
            ))}
          </div>
          <div className="rounded-xl border border-line/40 bg-panel/40 p-4 space-y-2 text-[11px]">
            <RuntimeCheck label="Media import and export" available={report.ready_for_media} />
            <RuntimeCheck label="Whisper runner prerequisites" available={report.ready_for_speech} />
            <RuntimeCheck label="Video OCR and event mapping prerequisites" available={report.ready_for_video_analysis} />
            <p className="pt-1 text-[10px] text-ink-faint">การตรวจนี้ตรวจ executable, เวอร์ชัน, ไฟล์ sidecar และ prerequisites ที่ติดตั้งแล้วเท่านั้น ไม่ได้ตรวจไฟล์โมเดลหรือทดสอบการถอดเสียงและวิเคราะห์ภาพ</p>
            <p className="pt-1 text-[10px] text-ink-faint">
              หากไม่พบ FFmpeg/Python ให้กำหนด tools directory หรือ path override; หากขาด Python modules ให้รัน `sidecar/setup-sidecar.ps1` ด้วย Python 3.11 ขึ้นไป; หากขาดสคริปต์ ให้ติดตั้งแอปใหม่หรือกำหนด `SIDECAR_DIR`
            </p>
          </div>
        </div>
      ) : (
        <p className="text-xs text-ink-faint">{busy ? "กำลังตรวจ runtime…" : "ยังไม่มีผลตรวจ"}</p>
      )}
    </>
  );
}

function RuntimeToolRow({ label, tool }: { label: string; tool: RuntimeToolStatus }) {
  return (
    <div className="rounded-xl border border-line/40 bg-panel/40 p-4">
      <RuntimeCheck label={label} available={tool.available} />
      <p className="mt-2 text-[10px] font-mono text-ink-faint break-all">{tool.path}</p>
      {tool.version && <p className="mt-1 text-[10px] text-ink-muted break-all">{tool.version}</p>}
      {tool.error && <p className="mt-1 text-[10px] text-red-300 break-all">{tool.error}</p>}
    </div>
  );
}

function RuntimeCheck({ label, available }: { label: string; available: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span className="text-ink-muted">{label}</span>
      <span className={available ? "text-lime" : "text-amber-300"}>
        {available ? "พบ" : "ไม่พบ / ยังไม่พร้อม"}
      </span>
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
  const { setGmaidenPath } = useStudioStore();
  const [detecting, setDetecting] = useState(false);

  async function autoDetect() {
    setDetecting(true);
    try {
      const p = await invoke<string>("detect_gmaiden_installed");
      if (p) setGmaidenPath(p);
      else alert("หา G-Maiden ที่ติดตั้งไม่เจอ — พิมพ์ path เอง (เช่น G:\\GM\\G-Maiden)");
    } catch (e) {
      alert(`ตรวจหาไม่สำเร็จ: ${e}`);
    } finally {
      setDetecting(false);
    }
  }

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

      <FieldGroup label="G-Maiden Path" description="โฟลเดอร์ G-Maiden ที่จะติดตั้ง pack — กดปุ่มเพื่อ auto-detect (release build → installed)">
        <div className="flex items-center gap-2">
          <input
            value={path}
            onChange={(e) => setGmaidenPath(e.target.value)}
            placeholder="auto — เช่น ...\target\release หรือ G:\GM\G-Maiden"
            className="w-56 bg-panel border border-line rounded-lg px-2 py-1.5 text-[11px] text-ink font-mono outline-none focus:border-lime"
          />
          <button
            onClick={autoDetect}
            disabled={detecting}
            title="ตรวจหา G-Maiden ที่ติดตั้ง (จาก Start Menu)"
            className="grid place-items-center w-7 h-7 rounded-lg border border-line text-ink-faint hover:text-ink hover:bg-panel-hover transition disabled:opacity-50"
          >
            <FolderOpen size={13} />
          </button>
        </div>
      </FieldGroup>

      <FieldGroup label="G-Maiden install endpoint" description="ตัวรับแพ็กบน loopback ที่แอปเรียกเพื่อยืนยันการเปิดใช้">
        <input
          type="text"
          readOnly
          value={GMAIDEN_INSTALL_ENDPOINT}
          className="w-64 bg-panel border border-line rounded-lg px-2 py-1.5 text-[10px] text-ink font-mono outline-none"
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
