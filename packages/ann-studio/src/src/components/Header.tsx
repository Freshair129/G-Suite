import GannPackage from "./GannPackage";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState, useEffect } from "react";
import { Upload, Download, Sparkles, Gamepad2, AudioWaveform, Settings, Play, Save, FolderOpen, UserCircle2, PanelsTopLeft } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";
import { runExport } from "../lib/actions";
import { saveProject, openProject } from "../lib/project";
import { signInWithGoogle, signOutGid } from "../lib/gidAuth";
import type { AppView } from "../store/useStudioStore";

function shortModel(m: string): string {
  return (m.split("/").pop() || m).split(":")[0].replace(/-gguf$/i, "");
}

export default function Header() {
  const { wavPath, clips, setSource, provider, llmModel, setProvider, setLlmModel, view, setView, gid, gidSignedIn } =
    useStudioStore();
  const [packageOpen,setPackageOpen] = useState(false);
  const [packagePath,setPackagePath] = useState<string>();
  useEffect(()=>{void invoke<string|null>("gann_startup_path").then(path=>{if(path){setPackagePath(path);setPackageOpen(true);}}).catch(()=>{});},[]);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [gidBusy, setGidBusy] = useState(false);

  useEffect(() => {
    invoke<string[]>("list_ollama_models")
      .then((models) => {
        setOllamaModels(models);
        // default to the best small Thai-capable model available
        if (!llmModel && models.length) {
          const PREF = ["chinda", "qwen3", "qwen", "llama3", "llama", "gemma"];
          let pref = models[0];
          for (const p of PREF) {
            const hit = models.find((m) => m.toLowerCase().includes(p));
            if (hit) {
              pref = hit;
              break;
            }
          }
          setLlmModel(pref);
        }
      })
      .catch(() => setOllamaModels([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const providerValue = provider === "claude" ? "claude" : `ollama:${llmModel}`;
  function onProviderChange(v: string) {
    if (v === "claude") setProvider("claude");
    else {
      setProvider("ollama");
      setLlmModel(v.replace(/^ollama:/, ""));
    }
  }

  async function handleImport() {
    const file = await open({
      title: "เลือกไฟล์เสียงหรือคลิป",
      filters: [
        { name: "Media", extensions: ["mp4", "mp3", "wav", "ogg", "m4a", "mkv", "webm", "flac"] },
      ],
    });
    if (!file) return;
    // guard: importing replaces the current clips — don't let unsaved voices mix
    if (clips.length > 0) {
      const ok = window.confirm(
        `มีเสียง ${clips.length} clip ที่ยังไม่ได้บันทึกเข้าคลัง — นำเข้าไฟล์ใหม่จะล้างทิ้ง\n\nกด “ยกเลิก” เพื่อไปกด “Save to Library” ก่อน แล้วค่อยนำเข้าใหม่`
      );
      if (!ok) return;
    }
    setImporting(true);
    try {
      const result: { path: string; duration: number } = await invoke("extract_audio", {
        inputPath: file,
      });
      setSource(file as string, result.path, result.duration);
    } catch (e) {
      alert(`นำเข้าไม่สำเร็จ: ${e}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const msg = await runExport();
      alert(msg);
    } finally {
      setExporting(false);
    }
  }

  async function handleGidSignIn() {
    setGidBusy(true);
    try {
      const err = await signInWithGoogle();
      if (err) alert(`เชื่อม GID ไม่สำเร็จ: ${err}`);
    } finally {
      setGidBusy(false);
    }
  }

  return (
    <>
    {packageOpen && <GannPackage initialPath={packagePath} onClose={()=>setPackageOpen(false)} />}
    <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-line bg-base">
      <div className="flex items-center gap-3">
        <button className="px-3 py-2 rounded border border-line" onClick={()=>setPackageOpen(true)}>เปิด .gann</button>
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-tr from-lime to-grass text-black font-extrabold text-lg">
          G
        </div>
        <div className="leading-tight">
          <h1 className="text-lg font-bold tracking-tight">G-AnnStudio</h1>
          <p className="text-[11px] text-ink-faint -mt-0.5">Announcer Pack Editor</p>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-1">
        {/* View toggle pills */}
        <div className="flex bg-panel p-0.5 rounded-full border border-line">
          <button
            onClick={() => setView("studio")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
              view === "studio"
                ? "bg-white/10 text-white"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            <AudioWaveform size={13} />
            Studio
          </button>
          <button
            onClick={() => setView("profile")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
              view === "profile"
                ? "bg-white/10 text-white"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            <Gamepad2 size={13} />
            Profile
          </button>
          <button
            onClick={() => setView("test")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
              view === "test"
                ? "bg-white/10 text-white"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            <Play size={13} />
            ทดสอบ
          </button>
          <button
            onClick={() => setView("overlay")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
              view === "overlay"
                ? "bg-white/10 text-white"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            <PanelsTopLeft size={13} />
            Overlay Lab
          </button>
          <button
            onClick={() => setView("settings")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition ${
              view === "settings"
                ? "bg-white/10 text-white"
                : "text-ink-faint hover:text-ink"
            }`}
          >
            <Settings size={13} />
          </button>
        </div>

      </div>

      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-1.5 pl-3 pr-1 py-1 bg-panel rounded-full border border-line text-xs">
          <Sparkles size={14} className="text-lime shrink-0" />
          <select
            value={providerValue}
            onChange={(e) => onProviderChange(e.target.value)}
            className="bg-transparent text-ink-muted text-xs outline-none cursor-pointer pr-1 max-w-[160px]"
            title="เลือก AI provider สำหรับ chat"
          >
            <option value="claude">Claude · plan</option>
            {ollamaModels.map((m) => (
              <option key={m} value={`ollama:${m}`}>
                Local · {shortModel(m)}
              </option>
            ))}
            {ollamaModels.length === 0 && <option value="ollama:">Local · (no model)</option>}
          </select>
        </div>

        {gidSignedIn ? (
          <div className="hidden sm:flex items-center gap-1.5 pl-3 pr-1 py-1 bg-panel rounded-full border border-line text-xs">
            <UserCircle2 size={14} className="text-lime shrink-0" />
            <span className="text-ink-muted">GID {gid}</span>
            <button
              onClick={() => void signOutGid()}
              className="px-2 py-0.5 rounded-full text-ink-faint hover:text-ink hover:bg-panel-hover transition"
            >
              ออกจากระบบ
            </button>
          </div>
        ) : (
          <button
            onClick={handleGidSignIn}
            disabled={gidBusy}
            className="flex items-center gap-2 px-4 h-9 rounded-full bg-panel hover:bg-panel-hover border border-line text-sm font-medium transition disabled:opacity-50"
          >
            <UserCircle2 size={15} className="text-lime" />
            {gidBusy ? "กำลังเชื่อม…" : "เชื่อม GID"}
          </button>
        )}

        <button
          onClick={async () => alert(await openProject())}
          className="flex items-center gap-2 px-4 h-9 rounded-full bg-panel hover:bg-panel-hover border border-line text-sm font-medium transition disabled:opacity-50"
        >
          <FolderOpen size={15} className="text-lime" />
          เปิด
        </button>

        <button
          onClick={async () => alert(await saveProject())}
          className="flex items-center gap-2 px-4 h-9 rounded-full bg-panel hover:bg-panel-hover border border-line text-sm font-medium transition disabled:opacity-50"
        >
          <Save size={15} className="text-lime" />
          บันทึก
        </button>

        <button
          onClick={handleImport}
          disabled={importing}
          className="flex items-center gap-2 px-4 h-9 rounded-full bg-panel hover:bg-panel-hover border border-line text-sm font-medium transition disabled:opacity-50"
        >
          <Upload size={15} className="text-lime" />
          {importing ? "กำลังโหลด…" : "นำเข้าไฟล์"}
        </button>

        <button
          onClick={handleExport}
          disabled={exporting || !wavPath || clips.length === 0}
          className="flex items-center gap-2 px-5 h-9 rounded-full bg-white text-black text-sm font-semibold hover:bg-gray-200 transition disabled:opacity-40 disabled:hover:bg-white"
        >
          <Download size={15} />
          {exporting ? "กำลังส่งออก…" : "ส่งออก"}
        </button>
      </div>
    </header>
    </>
  );
}
