// @req GOE-001, GOE-002, GOE-003, GOE-004 — provides layer composition, inspector editing, optional start/end timing metadata, and HUD event preview.
// @spec SDD-001, SDD-002, SDD-003 — uses the local BannerProject and grouped authoring history; timing authoring does not bake or hand off assets.
// @designs docs/g-overlay-lab-figma-editor-spec.md
// @tested src/components/BannerEditor.test.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ChevronUp, Copy, Eye, EyeOff, ImagePlus, Layers3, Lock, LockKeyholeOpen, Minus, MousePointer2,
  Redo2, RotateCw, Type, Undo2, Video, Wand2,
} from "lucide-react";
import { GMAIDEN_EVENTS } from "../data/gmaiden-events";
import {
  bannerId, clampBannerTransform, createBannerLayer, type BannerAsset, type BannerLayer, type BannerLayerKind,
} from "../lib/bannerProject";
import { useStudioStore } from "../store/useStudioStore";

type DragState = {
  kind: "move" | "resize";
  originX: number;
  originY: number;
  transforms: Record<string, BannerLayer["transform"]>;
};

type MarqueeState = { startX: number; startY: number; currentX: number; currentY: number };

const LAYER_ICON: Record<BannerLayerKind, typeof Type> = {
  group: Layers3, text: Type, shape: Wand2, image: ImagePlus, svg: Wand2, video: Video,
};

const MAX_ASSET_BYTES = 3 * 1024 * 1024;
const GRID_STEP = 5;
const snapToGrid = (value: number) => Math.round(value / GRID_STEP) * GRID_STEP;

export default function BannerEditor({ onOpenHudLayout }: { onOpenHudLayout: () => void }) {
  const project = useStudioStore((s) => s.bannerProject);
  const selectedIds = useStudioStore((s) => s.selectedBannerLayerIds);
  const setProject = useStudioStore((s) => s.setBannerProject);
  const setProjectSilent = useStudioStore((s) => s.setBannerProjectSilent);
  const pushHistory = useStudioStore((s) => s.pushBannerProjectHistory);
  const undo = useStudioStore((s) => s.undoBannerProject);
  const redo = useStudioStore((s) => s.redoBannerProject);
  const setSelectedIds = useStudioStore((s) => s.setSelectedBannerLayerIds);
  const canUndo = useStudioStore((s) => s.pastBannerProjects.length > 0);
  const canRedo = useStudioStore((s) => s.futureBannerProjects.length > 0);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState("Local banner draft. Export remains explicit.");
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  useEffect(() => () => { if (referenceUrl) URL.revokeObjectURL(referenceUrl); }, [referenceUrl]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  const layers = useMemo(() => [...project.layers].sort((a, b) => b.order - a.order), [project.layers]);
  const selectedLayer = project.layers.find((layer) => layer.id === selectedIds[selectedIds.length - 1]) ?? null;
  const activeEvent = GMAIDEN_EVENTS.find((event) => event.id === project.eventId) ?? GMAIDEN_EVENTS[0];

  const replaceProject = (next: typeof project, record = true) => {
    if (record) setProject(next);
    else setProjectSilent(next);
  };

  const updateLayers = (ids: string[], update: (layer: BannerLayer) => BannerLayer, record = true) => {
    replaceProject({ ...project, layers: project.layers.map((layer) => ids.includes(layer.id) ? update(layer) : layer) }, record);
  };

  const hasAncestorState = (layer: BannerLayer, property: "visible" | "locked", expected: boolean) => {
    const byId = new Map(project.layers.map((candidate) => [candidate.id, candidate]));
    let current: BannerLayer | undefined = layer;
    let depth = 0;
    while (current && depth <= project.layers.length) {
      if (current[property] === expected) return true;
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth += 1;
    }
    return false;
  };

  const selectLayer = (id: string, additive: boolean) => {
    if (additive) {
      setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((selected) => selected !== id) : [...selectedIds, id]);
    } else {
      setSelectedIds([id]);
    }
  };

  const beginDrag = (event: React.PointerEvent, id: string, kind: DragState["kind"]) => {
    event.stopPropagation();
    const layer = project.layers.find((candidate) => candidate.id === id);
    if (!layer || hasAncestorState(layer, "locked", true)) return;
    const nextIds = event.shiftKey
      ? (selectedIds.includes(id) ? selectedIds : [...selectedIds, id])
      : selectedIds.includes(id) ? selectedIds : [id];
    setSelectedIds(nextIds);
    const transforms = Object.fromEntries(project.layers
      .filter((candidate) => nextIds.includes(candidate.id))
      .map((candidate) => [candidate.id, { ...candidate.transform }]));
    pushHistory();
    dragRef.current = { kind, originX: event.clientX, originY: event.clientY, transforms };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const move = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    const box = stageRef.current?.getBoundingClientRect();
    if (!box) return;
    if (!drag) {
      if (!marqueeRef.current) return;
      const current = { ...marqueeRef.current, currentX: ((event.clientX - box.left) / box.width) * 100, currentY: ((event.clientY - box.top) / box.height) * 100 };
      marqueeRef.current = current;
      setMarquee(current);
      return;
    }
    const dx = ((event.clientX - drag.originX) / box.width) * 100;
    const dy = ((event.clientY - drag.originY) / box.height) * 100;
    updateLayers(Object.keys(drag.transforms), (layer) => {
      const origin = drag.transforms[layer.id];
      return {
        ...layer,
        transform: clampBannerTransform(drag.kind === "move"
          ? { ...origin, x: snapToGrid(origin.x + dx), y: snapToGrid(origin.y + dy) }
          : { ...origin, width: snapToGrid(origin.width + dx), height: snapToGrid(origin.height + dy) }),
      };
    }, false);
  };

  const beginMarquee = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-banner-layer]") || !stageRef.current) return;
    const box = stageRef.current.getBoundingClientRect();
    const state = { startX: ((event.clientX - box.left) / box.width) * 100, startY: ((event.clientY - box.top) / box.height) * 100, currentX: ((event.clientX - box.left) / box.width) * 100, currentY: ((event.clientY - box.top) / box.height) * 100 };
    marqueeRef.current = state;
    setMarquee(state);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const finishPointer = () => {
    dragRef.current = null;
    const activeMarquee = marqueeRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!activeMarquee) return;
    const left = Math.min(activeMarquee.startX, activeMarquee.currentX);
    const right = Math.max(activeMarquee.startX, activeMarquee.currentX);
    const top = Math.min(activeMarquee.startY, activeMarquee.currentY);
    const bottom = Math.max(activeMarquee.startY, activeMarquee.currentY);
    const ids = project.layers.filter((layer) => layer.kind !== "group" && !hasAncestorState(layer, "visible", false) && layer.transform.x >= left && layer.transform.x <= right && layer.transform.y >= top && layer.transform.y <= bottom).map((layer) => layer.id);
    setSelectedIds(ids);
  };

  const addLayer = (kind: BannerLayerKind, patch: Partial<BannerLayer> = {}) => {
    const order = Math.max(-1, ...project.layers.map((layer) => layer.order)) + 1;
    const layer = createBannerLayer(kind, order, patch);
    setProject({ ...project, layers: [...project.layers, layer] });
    setSelectedIds([layer.id]);
  };

  const importAsset = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_ASSET_BYTES) {
      setNotice("Assets larger than 3 MB are not persisted in the local editor yet.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const source = String(reader.result ?? "");
      const kind: BannerAsset["kind"] = file.type.includes("svg") || file.name.toLowerCase().endsWith(".svg")
        ? "svg"
        : file.type.startsWith("video/") ? "video" : "image";
      const asset: BannerAsset = { id: bannerId("asset"), name: file.name, kind, mime: file.type || "application/octet-stream", source };
      const layerKind: BannerLayerKind = kind;
      const order = Math.max(-1, ...project.layers.map((layer) => layer.order)) + 1;
      const layer = createBannerLayer(layerKind, order, {
        name: file.name,
        transform: { x: 50, y: 50, width: kind === "video" ? 64 : 40, height: kind === "video" ? 36 : 32, rotation: 0, opacity: 1 },
        content: { assetId: asset.id },
      });
      setProject({ ...project, assets: [...project.assets, asset], layers: [...project.layers, layer] });
      setSelectedIds([layer.id]);
      setNotice(`${file.name} added as a ${kind} layer.`);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const playEvent = () => {
    setPlaying(true);
    window.setTimeout(() => setPlaying(false), 3500);
  };

  const editSelected = (patch: Partial<BannerLayer>) => {
    if (!selectedLayer) return;
    updateLayers([selectedLayer.id], (layer) => ({ ...layer, ...patch }), false);
  };

  const editTransform = (key: keyof BannerLayer["transform"], value: number) => {
    if (!selectedLayer) return;
    editSelected({ transform: clampBannerTransform({ ...selectedLayer.transform, [key]: value }) });
  };

  const editTiming = (key: "startMs" | "endMs", value: number) => {
    if (!selectedLayer) return;
    const timing = selectedLayer.timing ?? { startMs: 0, endMs: 3500 };
    editSelected({ timing: { ...timing, [key]: Math.max(0, value) } });
  };

  const beginInspectorEdit = () => pushHistory();

  const reorderLayer = (id: string, direction: -1 | 1) => {
    const ordered = [...project.layers].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((layer) => layer.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
    setProject({ ...project, layers: ordered.map((layer, order) => ({ ...layer, order })) });
  };

  const duplicateSelected = () => {
    if (!selectedLayer) return;
    const order = Math.max(-1, ...project.layers.map((layer) => layer.order)) + 1;
    const duplicate = { ...selectedLayer, id: bannerId("layer"), name: `${selectedLayer.name} copy`, order, transform: { ...selectedLayer.transform, x: Math.min(100, selectedLayer.transform.x + 3), y: Math.min(100, selectedLayer.transform.y + 3) } };
    setProject({ ...project, layers: [...project.layers, duplicate] });
    setSelectedIds([duplicate.id]);
  };

  const groupSelected = () => {
    const members = project.layers.filter((layer) => selectedIds.includes(layer.id) && layer.kind !== "group");
    if (members.length < 2) {
      setNotice("Select at least two non-group layers to create a group.");
      return;
    }
    const order = Math.max(-1, ...project.layers.map((layer) => layer.order)) + 1;
    const group = createBannerLayer("group", order, { name: `Group ${project.layers.filter((layer) => layer.kind === "group").length + 1}` });
    setProject({ ...project, layers: [...project.layers.map((layer) => members.some((member) => member.id === layer.id) ? { ...layer, parentId: group.id } : layer), group] });
    setSelectedIds([group.id]);
  };

  const ungroupSelected = () => {
    if (!selectedLayer || selectedLayer.kind !== "group") return;
    const memberIds = project.layers.filter((layer) => layer.parentId === selectedLayer.id).map((layer) => layer.id);
    setProject({ ...project, layers: project.layers.filter((layer) => layer.id !== selectedLayer.id).map((layer, index) => ({ ...layer, parentId: layer.parentId === selectedLayer.id ? null : layer.parentId, order: index })) });
    setSelectedIds(memberIds);
  };

  const alignSelected = (mode: "left" | "center" | "right" | "top" | "middle" | "bottom") => {
    const members = project.layers.filter((layer) => selectedIds.includes(layer.id) && layer.kind !== "group" && !hasAncestorState(layer, "locked", true));
    if (members.length < 2) {
      setNotice("Select at least two unlocked visual layers to align them.");
      return;
    }
    const reference = members[0].transform;
    setProject({ ...project, layers: project.layers.map((layer) => {
      if (!members.some((member) => member.id === layer.id)) return layer;
      const transform = layer.transform;
      if (mode === "left") return { ...layer, transform: { ...transform, x: reference.x - reference.width / 2 + transform.width / 2 } };
      if (mode === "center") return { ...layer, transform: { ...transform, x: reference.x } };
      if (mode === "right") return { ...layer, transform: { ...transform, x: reference.x + reference.width / 2 - transform.width / 2 } };
      if (mode === "top") return { ...layer, transform: { ...transform, y: reference.y - reference.height / 2 + transform.height / 2 } };
      if (mode === "middle") return { ...layer, transform: { ...transform, y: reference.y } };
      return { ...layer, transform: { ...transform, y: reference.y + reference.height / 2 - transform.height / 2 } };
    }) });
  };

  const distributeSelected = (axis: "x" | "y") => {
    const members = project.layers.filter((layer) => selectedIds.includes(layer.id) && layer.kind !== "group" && !hasAncestorState(layer, "locked", true)).sort((a, b) => a.transform[axis] - b.transform[axis]);
    if (members.length < 3) {
      setNotice("Select at least three unlocked visual layers to distribute them.");
      return;
    }
    const start = members[0].transform[axis];
    const end = members[members.length - 1].transform[axis];
    const step = (end - start) / (members.length - 1);
    setProject({ ...project, layers: project.layers.map((layer) => {
      const index = members.findIndex((member) => member.id === layer.id);
      return index < 0 ? layer : { ...layer, transform: { ...layer.transform, [axis]: snapToGrid(start + step * index) } };
    }) });
  };

  const layerDepth = (layer: BannerLayer) => {
    const parents = new Map(project.layers.map((candidate) => [candidate.id, candidate.parentId]));
    let cursor = layer.parentId;
    let depth = 0;
    while (cursor && depth < project.layers.length) {
      depth += 1;
      cursor = parents.get(cursor) ?? null;
    }
    return depth;
  };

  return (
    <main className="flex-1 min-w-0 flex flex-col overflow-hidden bg-base">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3 bg-panel/40">
        <div className="flex items-center gap-1 pr-3 border-r border-line">
          <button className="h-8 w-8 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-white/5 hover:text-ink" title="Select tool"><MousePointer2 size={15} /></button>
          <button disabled={!canUndo} onClick={undo} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-white/5 hover:text-ink disabled:opacity-30" title="Undo (Ctrl/Cmd+Z)"><Undo2 size={15} /></button>
          <button disabled={!canRedo} onClick={redo} className="h-8 w-8 inline-flex items-center justify-center rounded-md text-ink-muted hover:bg-white/5 hover:text-ink disabled:opacity-30" title="Redo (Ctrl/Cmd+Shift+Z)"><Redo2 size={15} /></button>
        </div>
        <input value={project.title} onFocus={beginInspectorEdit} onChange={(event) => replaceProject({ ...project, title: event.target.value }, false)} className="h-8 w-48 bg-transparent px-2 text-sm font-semibold text-ink outline-none focus:bg-white/5 rounded-md" aria-label="Banner project title" />
        <span className="ml-auto text-[11px] text-ink-faint">{selectedIds.length ? `${selectedIds.length} layer selected` : "No layer selected"}</span>
        <button onClick={onOpenHudLayout} className="h-8 px-3 rounded-md border border-line text-xs text-ink-muted hover:text-ink">HUD layout</button>
      </header>

      <div className="min-h-0 flex-1 grid grid-cols-[220px_minmax(0,1fr)_300px] overflow-hidden">
        <aside className="min-h-0 overflow-y-auto border-r border-line bg-panel/20">
          <section className="border-b border-line p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Insert</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => addLayer("text")} className="h-16 rounded-lg border border-line bg-black/15 text-xs text-ink-muted hover:text-ink"><Type className="mx-auto mb-1" size={16} />Text</button>
              <button onClick={() => addLayer("shape")} className="h-16 rounded-lg border border-line bg-black/15 text-xs text-ink-muted hover:text-ink"><Wand2 className="mx-auto mb-1" size={16} />Shape</button>
              <button onClick={groupSelected} className="col-span-2 h-8 rounded-lg border border-line bg-black/15 text-xs text-ink-muted hover:text-ink"><Layers3 className="mr-1 inline" size={13} />Group selected</button>
              <label className="col-span-2 flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-lime text-xs font-bold text-black"><ImagePlus size={14} />Import SVG, image, video<input className="hidden" type="file" accept="image/*,video/*,.svg" onChange={importAsset} /></label>
            </div>
          </section>
          <section className="border-b border-line p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Arrange</p>
            <div className="grid grid-cols-3 gap-1"><button onClick={() => alignSelected("left")} className="h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Left</button><button onClick={() => alignSelected("center")} className="h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Center</button><button onClick={() => alignSelected("right")} className="h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Right</button><button onClick={() => alignSelected("top")} className="h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Top</button><button onClick={() => alignSelected("middle")} className="h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Middle</button><button onClick={() => alignSelected("bottom")} className="h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Bottom</button><button onClick={() => distributeSelected("x")} className="col-span-1 h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Dist. X</button><button onClick={() => distributeSelected("y")} className="col-span-2 h-7 rounded border border-line text-[10px] text-ink-muted hover:text-ink">Distribute Y</button></div>
          </section>
          <section className="border-b border-line p-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Assets</p>
            {project.assets.length ? <div className="space-y-1">{project.assets.map((asset) => <button key={asset.id} onClick={() => addLayer(asset.kind, { name: asset.name, content: { assetId: asset.id } })} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-ink-muted hover:bg-white/5 hover:text-ink"><ImagePlus size={13} />{asset.name}</button>)}</div> : <p className="text-xs leading-relaxed text-ink-faint">Import an SVG, image, or short video to add it to the layer canvas.</p>}
          </section>
          <section className="p-3">
            <div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Layers</p><span className="text-[10px] text-ink-faint">{project.layers.length}</span></div>
            <div className="space-y-1">{layers.map((layer) => { const Icon = LAYER_ICON[layer.kind]; return <div key={layer.id} className={`flex items-center gap-1 rounded-md ${selectedIds.includes(layer.id) ? "bg-lime/15 text-lime" : "text-ink-muted hover:bg-white/5"}`}><button onClick={(event) => selectLayer(layer.id, event.shiftKey)} style={{ paddingLeft: `${8 + layerDepth(layer) * 10}px` }} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs"><Icon size={13} /><span className="truncate">{layer.name}</span></button><button onClick={() => reorderLayer(layer.id, 1)} className="p-1" aria-label={`Move ${layer.name} backward`}><ChevronDown size={12} /></button><button onClick={() => reorderLayer(layer.id, -1)} className="p-1" aria-label={`Move ${layer.name} forward`}><ChevronUp size={12} /></button><button onClick={() => updateLayers([layer.id], (current) => ({ ...current, visible: !current.visible }))} className="p-1" aria-label={`Toggle ${layer.name} visibility`}>{layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}</button><button onClick={() => updateLayers([layer.id], (current) => ({ ...current, locked: !current.locked }))} className="p-1" aria-label={`Toggle ${layer.name} lock`}>{layer.locked ? <Lock size={12} /> : <LockKeyholeOpen size={12} />}</button></div>; })}</div>
          </section>
        </aside>

        <section className="min-w-0 min-h-0 overflow-auto bg-[#101216] p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <select value={project.eventId} onChange={(event) => setProject({ ...project, eventId: event.target.value })} className="h-8 rounded-md border border-line bg-panel px-2 text-xs text-ink outline-none">{GMAIDEN_EVENTS.filter((event) => event.id !== "unused").map((event) => <option key={event.id} value={event.id}>{event.label}</option>)}</select>
            <button onClick={playEvent} className="h-8 rounded-md bg-lime px-3 text-xs font-bold text-black">Play event</button>
            <label className="h-8 cursor-pointer rounded-md border border-line px-3 inline-flex items-center text-xs text-ink-muted">HUD reference<input className="hidden" type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) { if (referenceUrl) URL.revokeObjectURL(referenceUrl); setReferenceUrl(URL.createObjectURL(file)); } }} /></label>
            <span className="text-xs text-ink-faint">{activeEvent.trigger}</span>
          </div>
          <div ref={stageRef} data-testid="banner-stage" onPointerMove={move} onPointerUp={finishPointer} onPointerLeave={finishPointer} onPointerDown={beginMarquee} className={`relative mx-auto aspect-video w-full max-w-[1040px] overflow-hidden border border-white/15 bg-[#0b0d10] shadow-2xl ${playing ? "ring-2 ring-lime/70" : ""}`} style={referenceUrl ? { background: `center / cover no-repeat url(${referenceUrl})` } : undefined}>
            {!referenceUrl && <><div className="absolute inset-x-0 top-0 h-[8%] bg-black/70" /><div className="absolute bottom-0 left-0 h-[29%] w-[27%] bg-black/65" /><div className="absolute bottom-0 left-[28%] h-[23%] w-[45%] bg-black/65" /><div className="absolute bottom-0 right-0 h-[26%] w-[25%] bg-black/65" /></>}
            <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,.055)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.055)_1px,transparent_1px)] bg-[size:5%_5%]" />
            {project.layers.filter((layer) => layer.kind !== "group" && !hasAncestorState(layer, "visible", false)).slice().sort((a, b) => a.order - b.order).map((layer) => <LayerBox key={layer.id} layer={layer} asset={project.assets.find((asset) => asset.id === layer.content.assetId)} selected={selectedIds.includes(layer.id)} locked={hasAncestorState(layer, "locked", true)} onPointerDown={(event) => beginDrag(event, layer.id, "move")} onResizePointerDown={(event) => beginDrag(event, layer.id, "resize")} />)}
            {marquee && <div className="pointer-events-none absolute border border-lime bg-lime/10" style={{ left: `${Math.min(marquee.startX, marquee.currentX)}%`, top: `${Math.min(marquee.startY, marquee.currentY)}%`, width: `${Math.abs(marquee.currentX - marquee.startX)}%`, height: `${Math.abs(marquee.currentY - marquee.startY)}%` }} />}
          </div>
          <p className="mx-auto mt-2 max-w-[1040px] text-xs text-ink-faint">{playing ? "Preview active for 3.5 seconds." : "Canvas snaps to a 5% grid. Shift-click or drag a blank-canvas marquee to select multiple layers."}</p>
        </section>

        <aside className="min-h-0 overflow-y-auto border-l border-line bg-panel/30 p-4">
          <div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-bold text-ink">Inspector</h3><RotateCw size={14} className="text-ink-faint" /></div>
          {!selectedLayer ? <p className="text-xs leading-relaxed text-ink-faint">Select a layer on the canvas or in the Layers panel to edit it precisely.</p> : <div className="space-y-4">
            <label className="block text-xs text-ink-muted">Layer name<input value={selectedLayer.name} onFocus={beginInspectorEdit} onChange={(event) => editSelected({ name: event.target.value })} className="mt-1 h-8 w-full rounded-md border border-line bg-black/20 px-2 text-xs text-ink outline-none" /></label>
            {selectedLayer.kind === "text" && <><label className="block text-xs text-ink-muted">Text<textarea value={selectedLayer.content.text ?? ""} onFocus={beginInspectorEdit} onChange={(event) => editSelected({ content: { ...selectedLayer.content, text: event.target.value } })} className="mt-1 min-h-16 w-full rounded-md border border-line bg-black/20 p-2 text-xs text-ink outline-none" /></label><Field label="Font size" value={selectedLayer.style.fontSize ?? 24} onFocus={beginInspectorEdit} onChange={(value) => editSelected({ style: { ...selectedLayer.style, fontSize: value } })} /></>}
            {(selectedLayer.kind === "shape" || selectedLayer.kind === "text") && <label className="block text-xs text-ink-muted">Color<input type="color" value={selectedLayer.style.fill ?? "#ffffff"} onFocus={beginInspectorEdit} onChange={(event) => editSelected({ style: { ...selectedLayer.style, fill: event.target.value } })} className="mt-1 block h-8 w-full rounded-md border border-line bg-black/20" /></label>}
            {selectedLayer.kind === "group" ? <p className="rounded-md border border-line bg-black/15 p-2 text-xs leading-relaxed text-ink-faint">This group is a non-destructive layer-tree container. Ungroup restores its children without modifying their source assets.</p> : <><div className="grid grid-cols-2 gap-2"><Field label="X %" value={selectedLayer.transform.x} onFocus={beginInspectorEdit} onChange={(value) => editTransform("x", value)} /><Field label="Y %" value={selectedLayer.transform.y} onFocus={beginInspectorEdit} onChange={(value) => editTransform("y", value)} /><Field label="W %" value={selectedLayer.transform.width} onFocus={beginInspectorEdit} onChange={(value) => editTransform("width", value)} /><Field label="H %" value={selectedLayer.transform.height} onFocus={beginInspectorEdit} onChange={(value) => editTransform("height", value)} /><Field label="Rotate" value={selectedLayer.transform.rotation} onFocus={beginInspectorEdit} onChange={(value) => editTransform("rotation", value)} /><Field label="Opacity %" value={Math.round(selectedLayer.transform.opacity * 100)} onFocus={beginInspectorEdit} onChange={(value) => editTransform("opacity", value / 100)} /></div><div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Motion timing</p><div className="grid grid-cols-2 gap-2"><Field label="Start ms" value={selectedLayer.timing?.startMs ?? 0} onFocus={beginInspectorEdit} onChange={(value) => editTiming("startMs", value)} /><Field label="End ms" value={selectedLayer.timing?.endMs ?? 3500} onFocus={beginInspectorEdit} onChange={(value) => editTiming("endMs", value)} /></div></div></>}
            <div className="flex flex-wrap gap-2">{selectedLayer.kind === "group" ? <button onClick={ungroupSelected} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-ink-muted hover:text-ink"><Layers3 size={13} />Ungroup</button> : <button onClick={duplicateSelected} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line px-3 text-xs text-ink-muted hover:text-ink"><Copy size={13} />Duplicate</button>}<button onClick={() => { const next = project.layers.filter((layer) => layer.id !== selectedLayer.id).map((layer, index) => ({ ...layer, parentId: layer.parentId === selectedLayer.id ? null : layer.parentId, order: index })); setProject({ ...project, layers: next }); setSelectedIds([]); }} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-red-400/35 px-3 text-xs text-red-300 hover:bg-red-500/10"><Minus size={13} />Delete layer</button></div>
          </div>}
          <p className="mt-6 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">{notice} Private cloud sync contract approved; migration, conflict UI, and hosted evidence are still pending.</p>
        </aside>
      </div>
    </main>
  );
}

function Field({ label, value, onFocus, onChange }: { label: string; value: number; onFocus: () => void; onChange: (value: number) => void }) {
  return <label className="block text-[11px] text-ink-faint">{label}<input type="number" value={Number.isFinite(value) ? value : 0} onFocus={onFocus} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 h-8 w-full rounded-md border border-line bg-black/20 px-2 text-xs text-ink outline-none" /></label>;
}

function LayerBox({ layer, asset, selected, locked, onPointerDown, onResizePointerDown }: { layer: BannerLayer; asset?: BannerAsset; selected: boolean; locked: boolean; onPointerDown: (event: React.PointerEvent) => void; onResizePointerDown: (event: React.PointerEvent) => void }) {
  if (!layer.visible) return null;
  const content = layer.kind === "text"
    ? <div style={{ color: layer.style.fill, fontSize: `${layer.style.fontSize ?? 24}px`, fontWeight: layer.style.fontWeight ?? 600, lineHeight: 1.05 }} className="h-full w-full flex items-center justify-center text-center break-words">{layer.content.text}</div>
    : layer.kind === "shape"
      ? <div className="h-full w-full border" style={{ background: layer.style.fill, borderColor: layer.style.stroke ?? "transparent" }} />
      : asset?.kind === "video"
        ? <video className="h-full w-full object-cover" src={asset.source} muted loop autoPlay playsInline />
        : asset ? <img className="h-full w-full object-contain" src={asset.source} alt={asset.name} draggable={false} /> : <div className="h-full w-full bg-red-500/20" />;
  return <div data-banner-layer onPointerDown={onPointerDown} className={`absolute touch-none ${locked ? "cursor-not-allowed" : "cursor-move"} ${selected ? "ring-2 ring-lime" : ""}`} style={{ left: `${layer.transform.x}%`, top: `${layer.transform.y}%`, width: `${layer.transform.width}%`, height: `${layer.transform.height}%`, transform: `translate(-50%, -50%) rotate(${layer.transform.rotation}deg)`, opacity: layer.transform.opacity }}>{content}{selected && !locked && <button onPointerDown={onResizePointerDown} aria-label={`Resize ${layer.name}`} className="absolute -bottom-1 -right-1 h-3 w-3 rounded-sm border border-black bg-lime cursor-nwse-resize" />}</div>;
}
