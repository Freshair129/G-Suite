// Event tests build and verify GANN before resolving its indexed audio/video pair.
// Card thumbnails are authoring previews; triggered media is read from the package.

import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import { drawToneBanner, eventTone, TONES, BANNER_W, BANNER_H } from "../lib/toneBanner";
import { installGmaidenPack, installLibraryPack } from "../lib/exportGmaidenPack";
import GannPackage from "./GannPackage";
import { buildCurrentGann } from "../lib/exportGmaidenPack";
import { generateBanner } from "../lib/genBanner";
import { useStudioStore, type Clip, type BannerOverride, type LibSound, type LibPkg } from "../store/useStudioStore";

const EVENTS = GMAIDEN_EVENTS.filter((e) => e.id !== "unused");

const MIME_EXT: Record<string, BannerOverride["ext"]> = {
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/** Read a picked image File into a BannerOverride (or null if unsupported).
 *  APNG is normalized to image/png — it's a valid PNG container that Chromium
 *  animates under image/png, which is the MIME G-Maiden's overlay serves. */
async function fileToOverride(file: File): Promise<BannerOverride | null> {
  const raw = file.type || "image/png";
  const mime = raw === "image/apng" ? "image/png" : raw;
  const ext = MIME_EXT[mime];
  if (!ext) return null;
  const b64 = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? "");
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  if (!b64) return null;
  return { b64, ext, mime };
}

/** A single tone banner drawn on a transparent canvas, CSS-scaled to `width`. */
function BannerCanvas({
  event,
  width,
  caption,
}: {
  event: string;
  width: number;
  caption?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (width / BANNER_W) * dpr;
    c.width = Math.round(BANNER_W * scale);
    c.height = Math.round(BANNER_H * scale);
    c.style.width = `${width}px`;
    c.style.height = `${(width * BANNER_H) / BANNER_W}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    drawToneBanner(ctx, event, 1, caption);
  }, [event, width, caption]);
  return <canvas ref={ref} className="block" />;
}

function BannerView({
  event,
  width,
  override,
  caption,
}: {
  event: string;
  width: number;
  override?: BannerOverride;
  caption?: string;
}) {
  if (override) {
    return (
      <img
        src={`data:${override.mime};base64,${override.b64}`}
        alt={event}
        width={width}
        height={(width * BANNER_H) / BANNER_W}
        className="block object-contain"
        style={{ width, height: (width * BANNER_H) / BANNER_W }}
      />
    );
  }
  return <BannerCanvas event={event} width={width} caption={caption} />;
}

export default function EventTestGrid() {
  const clips = useStudioStore((s) => s.clips);
  const bannerOverrides = useStudioStore((s) => s.bannerOverrides);
  const setBannerOverride = useStudioStore((s) => s.setBannerOverride);
  const sdEndpoint = useStudioStore((s) => s.sdEndpoint);
  const [genEvent, setGenEvent] = useState<string | null>(null);

  // pack builder (event → library sounds assembled here)
  const packBuilder = useStudioStore((s) => s.packBuilder);
  const addToPackBuilder = useStudioStore((s) => s.addToPackBuilder);
  const removeFromPackBuilder = useStudioStore((s) => s.removeFromPackBuilder);
  const libraryRoot = useStudioStore((s) => s.libraryRoot);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pickerEvent, setPickerEvent] = useState<string | null>(null);
  const [libSounds, setLibSounds] = useState<Array<LibSound & { owner: string }>>([]);
  const [installingLib, setInstallingLib] = useState(false);


  const [preview,setPreview]=useState<{path:string;event:string}|null>(null);
  const [previewBusy,setPreviewBusy]=useState(false);
  const [previewError,setPreviewError]=useState('');
  const projectId = useStudioStore((s) => s.projectDocument?.projectId ?? null);
  const projectSession = useStudioStore((s) => s.projectSession);
  const projectOwner = `${projectSession}:${projectId ?? ''}`;
  const previewSession = useRef(0);
  const previewOwner = useRef(projectOwner);
  useEffect(() => {
    if (previewOwner.current === projectOwner) return;
    previewOwner.current = projectOwner;
    previewSession.current += 1;
    setPreview(null);
    setPreviewBusy(false);
    setPreviewError('');
  }, [projectOwner]);
  useEffect(() => () => { previewSession.current += 1; }, []);
  const [installing, setInstalling] = useState(false);
  const [animate, setAnimate] = useState(true);
  const [voiceCaption, setVoiceCaption] = useState(true);
  const [reactive, setReactive] = useState(false);
  // one shared hidden file input; `pendingEvent` is the card awaiting an image
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingEvent = useRef<string | null>(null);

  const byEvent = useMemo(() => {
    const m: Record<string, Clip[]> = {};
    for (const c of clips) (m[c.event] ??= []).push(c);
    return m;
  }, [clips]);

  const overrideCount = Object.keys(bannerOverrides).length;

  // caption per event = the first mapped clip's transcript (the voice line)
  const captionOf = (id: string): string | undefined =>
    voiceCaption ? byEvent[id]?.[0]?.name : undefined;

  function pickOverride(event: string) {
    pendingEvent.current = event;
    fileInput.current?.click();
  }

  // drop a library sound onto an event card → assign it to that event
  function onDropSound(event: string, e: React.DragEvent) {
    e.preventDefault();
    setDropTarget(null);
    const raw = e.dataTransfer.getData("application/x-library-sound-json");
    if (!raw) return;
    try {
      addToPackBuilder(event, JSON.parse(raw) as LibSound);
    } catch {
      /* ignore malformed drag */
    }
  }

  // lazy-load a flat list of every library sound (with owner) for the picker
  async function ensureLibSounds() {
    if (libSounds.length) return;
    try {
      const info = await invoke<{ packages: LibPkg[] }>("init_library");
      const all = await Promise.all(
        info.packages.map(async (p) => {
          const sounds = await invoke<LibSound[]>("query_sounds", { pkgId: p.id });
          return sounds.map((s) => ({ ...s, owner: p.name }));
        })
      );
      setLibSounds(all.flat());
    } catch {
      /* library not ready */
    }
  }

  async function openPicker(event: string) {
    setPickerEvent((cur) => (cur === event ? null : event));
    await ensureLibSounds();
  }

  const packBuilderTotal = Object.values(packBuilder).reduce((n, list) => n + list.length, 0);

  async function genAiBanner(event: string) {
    if (genEvent) return;
    setGenEvent(event);
    try {
      const ov = await generateBanner(event, sdEndpoint);
      if (ov) setBannerOverride(event, ov);
      else alert("SD ไม่คืนรูป — ลองใหม่นะครับ");
    } catch (e) {
      alert(`สร้างภาพ AI ไม่สำเร็จ: ${e}`);
    } finally {
      setGenEvent(null);
    }
  }

  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const event = pendingEvent.current;
    e.target.value = ""; // allow re-picking the same file
    pendingEvent.current = null;
    if (!file || !event) return;
    const ov = await fileToOverride(file);
    if (!ov) {
      alert("รองรับเฉพาะ PNG / WebP / GIF / APNG นะครับ");
      return;
    }
    setBannerOverride(event, ov);
  }

  async function fire(id:string) {
    if(previewBusy)return;
    const session = previewSession.current;
    setPreviewBusy(true);setPreviewError('');
    const pending = buildCurrentGann('event',id,undefined,'Event preview','',animate,voiceCaption,reactive);
    const current = useStudioStore.getState();
    const owner = `${current.projectSession}:${current.projectDocument?.projectId ?? ''}`;
    previewOwner.current = owner;
    const isCurrent = () => { const state = useStudioStore.getState(); return session === previewSession.current && `${state.projectSession}:${state.projectDocument?.projectId ?? ''}` === owner; };
    try{const pack=await pending;if(isCurrent())setPreview({path:pack.path,event:id});}
    catch(error){if(isCurrent())setPreviewError(String(error));}finally{if(isCurrent())setPreviewBusy(false);}
  }

  return (
    <div className="flex-1 min-w-0 overflow-y-auto bg-base">
      {preview&&<GannPackage initialPath={preview.path} initialEvent={preview.event} autoPlay onClose={()=>setPreview(null)}/>}
      <div className="sticky top-0 z-10 h-[164px] grid place-items-center bg-base border-b border-line">
        <p role={previewError?'alert':undefined} className="text-ink-faint text-sm">{previewError|| (previewBusy?'กำลังสร้างและตรวจ GANN…':'กด event เพื่อสร้าง GANN แล้วเล่นเสียงและภาพจากแพ็กที่ตรวจแล้ว')}</p>
      </div>

      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-bold text-ink">ทดสอบ Event · {EVENTS.length} รายการ</h2>
            {overrideCount > 0 && (
              <span className="text-xs text-lime">{overrideCount} banner ภาพเอง</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-ink-faint">{clips.length} clip · คลัง {packBuilderTotal}</span>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={voiceCaption}
                onChange={(e) => setVoiceCaption(e.target.checked)}
                className="accent-lime"
              />
              ข้อความจาก voice
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={animate}
                onChange={(e) => setAnimate(e.target.checked)}
                className="accent-lime"
              />
              banner เคลื่อนไหว
            </label>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={reactive}
                onChange={(e) => setReactive(e.target.checked)}
                className="accent-lime"
              />
              คลื่นเสียง (reactive)
            </label>
            <button
              onClick={async () => {
                setInstalling(true);
                try {
                  alert(await installGmaidenPack("ann-pack", "", animate, voiceCaption, reactive));
                } finally {
                  setInstalling(false);
                }
              }}
              disabled={installing || clips.length === 0}
              className="px-3 h-8 rounded-full bg-lime text-black text-xs font-semibold hover:bg-lime/90 transition disabled:opacity-40"
            >
              {installing ? "กำลังติดตั้ง…" : "ติดตั้งลง G-Maiden (พร้อม banner)"}
            </button>
            <button
              onClick={async () => {
                setInstallingLib(true);
                try {
                  alert(await installLibraryPack("ann-pack", "", animate, voiceCaption, reactive));
                } finally {
                  setInstallingLib(false);
                }
              }}
              disabled={installingLib || packBuilderTotal === 0}
              title="ติดตั้ง pack ที่ประกอบจากคลังเสียง (ลากเสียงมาวางบนการ์ด)"
              className="px-3 h-8 rounded-full bg-white text-black text-xs font-semibold hover:bg-gray-200 transition disabled:opacity-40"
            >
              {installingLib ? "กำลังติดตั้ง…" : `ติดตั้งจากคลัง (${packBuilderTotal})`}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {EVENTS.map((ev) => {
            const n = byEvent[ev.id]?.length ?? 0;
            const libList = packBuilder[ev.id] ?? [];
            const total = n + libList.length;
            const t = TONES[eventTone(ev.id)];
            const ov = bannerOverrides[ev.id];
            return (
              <div
                key={ev.id}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dropTarget !== ev.id) setDropTarget(ev.id);
                }}
                onDragLeave={() => setDropTarget((c) => (c === ev.id ? null : c))}
                onDrop={(e) => onDropSound(ev.id, e)}
                className={`rounded-xl overflow-hidden border transition ${
                  dropTarget === ev.id ? "border-lime bg-lime/10" : "border-line hover:border-white/25"
                }`}
              >
                <button
                  onClick={() => fire(ev.id)}
                  className="group relative block w-full"
                  aria-label={`ทดสอบ event: ${ev.label} (${total} เสียง)`}
                  title={ev.trigger}
                >
                  <BannerView event={ev.id} width={280} override={ov} caption={captionOf(ev.id)} />
                  <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-black/55">
                    {total > 0 ? (
                      <span style={{ color: t.accent }}>{total} เสียง</span>
                    ) : (
                      <span className="text-ink-faint">ลากเสียงมาวาง</span>
                    )}
                  </span>
                  {ov && (
                    <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-black/55 text-lime">
                      ภาพเอง · {ov.ext}
                    </span>
                  )}
                </button>
                <div className="flex items-center justify-between px-2 h-8 bg-panel/40 border-t border-line">
                  <button
                    onClick={() => pickOverride(ev.id)}
                    className="text-[11px] text-ink-muted hover:text-ink transition"
                  >
                    {ov ? "เปลี่ยนภาพ" : "แทนภาพเอง"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => genAiBanner(ev.id)}
                      disabled={genEvent !== null}
                      className="text-[11px] text-ink-muted hover:text-lime transition disabled:opacity-40"
                      title={`สร้างภาพด้วย Stable Diffusion (${sdEndpoint})`}
                    >
                      {genEvent === ev.id ? "กำลังวาด…" : "✨ AI"}
                    </button>
                    {ov && (
                      <button
                        onClick={() => setBannerOverride(ev.id, null)}
                        className="text-[11px] text-ink-faint hover:text-danger transition"
                      >
                        ล้าง
                      </button>
                    )}
                  </div>
                </div>

                {/* pack builder: library sounds assigned to this event */}
                <div className="px-2 py-1.5 bg-black/20 border-t border-line/60 space-y-1">
                  {libList.map((snd, i) => (
                    <div key={snd.id} className="flex items-center gap-1.5 text-[10px] text-ink-muted">
                      <span className="text-lime/70 shrink-0">♪</span>
                      <span className="truncate flex-1" title={snd.name_en}>{snd.name_th || snd.name_en}</span>
                      <span className="text-ink-faint shrink-0">{snd.duration.toFixed(1)}s</span>
                      <button
                        onClick={() => removeFromPackBuilder(ev.id, i)}
                        className="text-ink-faint hover:text-danger shrink-0"
                        title="เอาออก"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => openPicker(ev.id)}
                    className="text-[10px] text-lime hover:underline"
                  >
                    + เพิ่มเสียงจากคลัง
                  </button>
                  {pickerEvent === ev.id && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-line bg-panel">
                      {libSounds.length === 0 ? (
                        <div className="px-2 py-2 text-[10px] text-ink-faint">
                          ยังไม่มีเสียงในคลัง — กด Save to Library ก่อน
                        </div>
                      ) : (
                        libSounds.map((snd) => (
                          <button
                            key={snd.id}
                            onClick={() => {
                              addToPackBuilder(ev.id, snd);
                              setPickerEvent(null);
                            }}
                            className="w-full flex items-center gap-1.5 px-2 py-1 text-[10px] text-left hover:bg-panel-hover transition"
                          >
                            <span className="text-lime/70 shrink-0">{snd.owner}</span>
                            <span className="truncate flex-1 text-ink-muted">{snd.name_th || snd.name_en}</span>
                            <span className="text-ink-faint shrink-0">{snd.duration.toFixed(1)}s</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/webp,image/gif,image/apng"
        className="hidden"
        onChange={onFilePicked}
      />

    </div>
  );
}
