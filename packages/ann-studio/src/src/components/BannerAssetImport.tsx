import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  applyBannerAssetArchive,
  captureBannerAssetImportContext,
  inspectBannerAssetArchive,
  type BannerAssetArchivePreview,
  type BannerAssetImportContext,
} from "../lib/project";
import { useStudioStore } from "../store/useStudioStore";

type Inspection = { path: string; preview: BannerAssetArchivePreview; context: BannerAssetImportContext };

const motionLabel: Record<string, string> = {
  outerOpacity: "opacity / fade",
  outerTranslateX: "เลื่อนแนวนอน",
  outerTranslateY: "เลื่อนแนวตั้ง",
  outerScale: "ย่อและขยาย",
};

function capabilities(manifest: BannerAssetArchivePreview["manifest"]): string {
  const motion = manifest.editableControls.outerMotion.map(value => motionLabel[value] ?? value).join(", ") || "ไม่มี";
  if (manifest.mediaKind === "editable-template") return `เทมเพลตแก้ไขได้: ข้อความและเลเยอร์ต้นฉบับ · outer motion: ${motion}`;
  if (manifest.mediaKind === "still-image") return `ภาพนิ่ง · แก้ข้อความต้นฉบับไม่ได้ · สร้าง outer motion เพิ่มได้: ${motion}`;
  return `วิดีโอเงียบ ${manifest.durationMs} ms · แก้ข้อความภายในวิดีโอไม่ได้ · สร้าง outer motion เพิ่มได้: ${motion}`;
}

function isCurrent(context: BannerAssetImportContext): boolean {
  const state = useStudioStore.getState(), project = state.projectDocument;
  return !!project && project.projectId === context.projectId && project.announcerId === context.announcerId && state.projectGeneration === context.generation;
}

export default function BannerAssetImport() {
  const clips = useStudioStore(state => state.clips);
  const selectedClipId = useStudioStore(state => state.selectedClipId);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [targetVariantId, setTargetVariantId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (inspection && busy) dialogRef.current?.focus();
    else if (inspection) cancelRef.current?.focus();
    else openerRef.current?.focus();
  }, [inspection, busy]);

  async function chooseArchive() {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const context = captureBannerAssetImportContext();
      const path = await open({
        title: "เลือก Banner Asset ZIP",
        multiple: false,
        directory: false,
        filters: [{ name: "G-Suite Banner Asset", extensions: ["zip"] }],
      });
      if (typeof path !== "string") return;
      const preview = await inspectBannerAssetArchive(path);
      if (!isCurrent(context)) throw new Error("โปรเจกต์เปลี่ยนระหว่างตรวจ archive กรุณาเริ่มนำเข้าใหม่");
      setTargetVariantId(selectedClipId && clips.some(clip => clip.id === selectedClipId) ? selectedClipId : clips[0]?.id ?? "");
      setInspection({ path, preview, context });
    } catch (cause) {
      setError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  function cancel() {
    if (busy) return;
    setInspection(null);
    setError("");
  }

  async function apply() {
    if (!inspection || !targetVariantId) return;
    setBusy(true);
    setError("");
    try {
      const applied = await applyBannerAssetArchive(
        inspection.path,
        inspection.preview.manifestSha256,
        targetVariantId,
        inspection.context,
      );
      if (!applied) throw new Error("โปรเจกต์หรือคลิปเปลี่ยนระหว่างนำเข้า ผลที่ตรวจไว้ไม่ได้แทนงานปัจจุบัน กรุณาเปิดสำเนากู้คืนก่อนเริ่มใหม่");
      setInspection(null);
      setStatus("นำเข้าแบนเนอร์แล้ว และเลือกคลิปเสียงปลายทางไว้ให้แล้ว");
    } catch (cause) {
      setError(String(cause).replace(/^Error:\s*/, ""));
    } finally {
      setBusy(false);
    }
  }

  const manifest = inspection?.preview.manifest;
  const target = clips.find(clip => clip.id === targetVariantId);
  return <div className="relative">
    <button type="button" disabled={busy} onClick={event => { openerRef.current = event.currentTarget; void chooseArchive(); }} className="rounded border border-line px-3 py-2 text-xs text-ink-muted hover:border-lime hover:text-ink disabled:opacity-40">
      นำเข้า Banner Asset (.zip)
    </button>
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
    {status && <p role="status" className="mt-2 text-xs text-lime">{status}</p>}
    {inspection && manifest && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onMouseDown={event => { if (event.target === event.currentTarget) cancel(); }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="banner-import-title"
        tabIndex={-1}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === "Escape") { event.preventDefault(); cancel(); }
          if (event.key === "Tab" && dialogRef.current) {
            const controls = [...dialogRef.current.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)")];
            const first = controls[0], last = controls[controls.length - 1];
            if (controls.length === 0) event.preventDefault();
            else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
          }
        }}
        className="w-full max-w-xl rounded-xl border border-line bg-panel p-5 text-ink shadow-2xl outline-none"
      >
        <h2 id="banner-import-title" className="min-w-0 break-words [overflow-wrap:anywhere] text-lg font-bold">ตรวจสอบ Banner Asset: {manifest.name}</h2>
        <p className="mt-1 text-xs text-ink-muted">{manifest.assetId} · revision {manifest.revision} · {manifest.mediaKind}</p>
        <p className="mt-3 rounded border border-line bg-black/20 p-3 text-sm leading-relaxed">{capabilities(manifest)}</p>
        {manifest.mediaKind === "baked-video" && <p className="mt-2 text-xs text-amber-200">Importer เก็บวิดีโอเป็น media layer เงียบ; ไม่รับรอง alpha/playback parity ของ G-Maiden</p>}
        <ul className="mt-3 max-h-28 space-y-1 overflow-auto text-xs text-ink-muted" aria-label="ไฟล์ที่ตรวจแล้ว">
          {manifest.files.map(file => <li key={file.id}>{file.path} · {file.mediaType} · {(file.sizeBytes / (1024 * 1024)).toFixed(2)} MiB</li>)}
        </ul>
        <label className="mt-4 block text-xs text-ink-muted">คลิปปลายทาง
          <select aria-label="คลิปปลายทาง" className="mt-1 block w-full rounded border border-line bg-black/30 p-2 text-ink" value={targetVariantId} disabled={busy} onChange={event => setTargetVariantId(event.target.value)}>
            <option value="">เลือกคลิปเสียง</option>
            {clips.map(clip => <option key={clip.id} value={clip.id}>{clip.name} · {clip.event}</option>)}
          </select>
        </label>
        <p className="mt-2 text-xs text-ink-faint">การจับคู่เหตุการณ์ เสียง และช่วงภาพเดิมจะคงเดิม ตัวแบนเนอร์จะใช้ event ของคลิปเสียงที่เลือก</p>
        {!target && <p className="mt-2 text-xs text-amber-200">เลือกคลิปเสียงที่ต้องการก่อน จึงจะนำเข้าได้</p>}
        {error && <p role="alert" className="mt-3 text-xs text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button ref={cancelRef} type="button" disabled={busy} onClick={cancel} className="rounded border border-line px-3 py-2 text-xs">ยกเลิก</button>
          <button type="button" disabled={busy || !target} onClick={() => void apply()} className="rounded bg-lime px-3 py-2 text-xs font-bold text-black disabled:opacity-40">{busy ? "กำลังตรวจ/นำเข้า…" : "นำไปใช้กับคลิปนี้"}</button>
        </div>
      </section>
    </div>}
  </div>;
}
