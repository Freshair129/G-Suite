import { importProjectMedia } from "../lib/importMedia";
import GannPackage from "./GannPackage";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useState, useEffect } from "react";
import { Download, Play, Save } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";
import { runExport } from "../lib/actions";
import { saveProject, openProject } from "../lib/project";
import { signInWithGoogle, signOutGid } from "../lib/gidAuth";


function shortModel(m: string): string {
  return (m.split("/").pop() || m).split(":")[0].replace(/-gguf$/i, "");
}

export default function Header() {
  const { wavPath, clips, provider, llmModel, setProvider, setLlmModel, view, setView, gid, gidSignedIn } =
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
      await importProjectMedia(file as string);
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
      {packageOpen && <GannPackage initialPath={packagePath} onClose={() => setPackageOpen(false)} />}
      <header className="relative z-30 min-h-16 shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-line bg-base">
        <div className="min-w-0 flex-1 font-bold truncate" title="G-AnnStudio — Announcer Pack Editor">G-AnnStudio</div>
        <button onClick={async () => alert(await saveProject())} className="header-action"><Save size={15} /> บันทึก</button>
        <button onClick={() => setView("test")} aria-pressed={view === "test"} className="header-action"><Play size={15} /> ทดสอบ</button>
        <button onClick={handleExport} disabled={exporting || !wavPath || clips.length === 0} className="header-action bg-white text-black disabled:opacity-40"><Download size={15} /> {exporting ? "กำลังส่งออก…" : "ส่งออก"}</button>
        <details className="relative" onKeyDown={(event) => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector<HTMLElement>("summary")?.focus();
        }}>
          <summary className="header-action cursor-pointer" aria-label="More actions">เมนู</summary>
          <div onClick={(e) => {
            if (!(e.target as HTMLElement).closest("button")) return;
            const details = e.currentTarget.closest("details");
            details?.querySelector<HTMLElement>("summary")?.focus();
            details?.removeAttribute("open");
          }} className="absolute right-0 top-full mt-1 w-64 max-h-[70vh] overflow-y-auto rounded border border-line bg-panel shadow-xl p-2 flex flex-col gap-1">
            <button className="menu-action" onClick={() => setPackageOpen(true)}>เปิด .gann</button>
            <button className="menu-action" onClick={async () => alert(await openProject())}>เปิดโปรเจกต์</button>
            <button className="menu-action" onClick={handleImport} disabled={importing}>{importing ? "กำลังโหลด…" : "นำเข้าไฟล์"}</button>
            {([ ["creator", "สร้างแพ็ก"], ["studio", "Studio"], ["profile", "Profile"], ["test", "ทดสอบ"], ["overlay", "Overlay Lab"], ["settings", "Settings"] ] as const).map(([id, label]) => <button key={id} className="menu-action" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>)}
            <label className="menu-action">AI provider
              <select value={providerValue} onChange={(e) => onProviderChange(e.target.value)} className="block w-full min-w-0 bg-base text-ink" title="เลือก AI provider สำหรับ chat">
                <option value="claude">Claude · plan</option>
                {ollamaModels.map((m) => <option key={m} value={`ollama:${m}`}>Local · {shortModel(m)}</option>)}
                {ollamaModels.length === 0 && <option value="ollama:">Local · (no model)</option>}
              </select>
            </label>
            {gidSignedIn ? <div className="menu-action break-all">GID {gid}<button className="block" onClick={() => void signOutGid()}>ออกจากระบบ</button></div> : <button className="menu-action" disabled={gidBusy} onClick={handleGidSignIn}>{gidBusy ? "กำลังเชื่อม…" : "เชื่อม GID"}</button>}
          </div>
        </details>
      </header>
    </>
  );
}
