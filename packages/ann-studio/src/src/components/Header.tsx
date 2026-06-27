import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState, useEffect } from "react";
import { Upload, Download, Sparkles } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";
import { runExport } from "../lib/actions";

function shortModel(m: string): string {
  return (m.split("/").pop() || m).split(":")[0].replace(/-gguf$/i, "");
}

export default function Header() {
  const { sourcePath, wavPath, clips, setSource, provider, llmModel, setProvider, setLlmModel } =
    useStudioStore();
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

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

  const fileName = sourcePath?.split(/[\\/]/).pop();

  return (
    <header className="h-16 shrink-0 flex items-center justify-between px-6 border-b border-line bg-base">
      <div className="flex items-center gap-3">
        <div className="grid place-items-center w-9 h-9 rounded-xl bg-gradient-to-tr from-lime to-grass text-black font-extrabold text-lg">
          G
        </div>
        <div className="leading-tight">
          <h1 className="text-lg font-bold tracking-tight">G-AnnStudio</h1>
          <p className="text-[11px] text-ink-faint -mt-0.5">Announcer Pack Editor</p>
        </div>
      </div>

      {fileName && (
        <div className="hidden md:flex items-center gap-2 px-3.5 py-1.5 bg-panel rounded-full border border-line max-w-[360px]">
          <span className="w-1.5 h-1.5 rounded-full bg-lime shrink-0" />
          <span className="text-xs text-ink-muted truncate font-mono">{fileName}</span>
        </div>
      )}

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
  );
}
