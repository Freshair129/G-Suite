// @req GOE-001, GOE-003 — defines the non-destructive BannerProject and optional per-layer start/end timing metadata.
// @spec SDD-001, SDD-002, SDD-003 — separates banner projects and bounded authoring history; timing is metadata only, with no bake or handoff wiring.
// @designs docs/g-overlay-lab-figma-editor-spec.md
// @tested src/lib/bannerProject.test.ts
export type BannerLayerKind = "group" | "text" | "shape" | "image" | "svg" | "video";

export interface BannerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface BannerAsset {
  id: string;
  name: string;
  kind: "image" | "svg" | "video";
  mime: string;
  source: string;
}

export interface BannerTiming {
  startMs: number;
  endMs: number;
}

export interface LayerMotion {
  keyframes: Array<{ timeMs:number; transform:BannerTransform; easing:"linear"|"easeInOut" }>;
}

export interface BannerLayer {
  id: string;
  kind: BannerLayerKind;
  name: string;
  parentId: string | null;
  order: number;
  visible: boolean;
  locked: boolean;
  transform: BannerTransform;
  style: { fill?: string; stroke?: string; fontSize?: number; fontWeight?: number; fontFamily?:string; fontAssetId?:string };
  content: { text?: string; assetId?: string };
  timing?: BannerTiming;
  motion?: LayerMotion;
}

export interface BannerProject {
  schemaVersion: 1;
  id: string;
  title: string;
  eventId: string;
  artboard: { width: number; height: number; safeZonePreset: "dota-hud" | "none" };
  assets: BannerAsset[];
  layers: BannerLayer[];
  revision: number;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value));

export function bannerId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function clampBannerTransform(transform: BannerTransform): BannerTransform {
  return {
    x: clamp(transform.x, 0, 100),
    y: clamp(transform.y, 0, 100),
    width: clamp(transform.width, 2, 100),
    height: clamp(transform.height, 2, 100),
    rotation: clamp(transform.rotation, -180, 180),
    opacity: clamp(transform.opacity, 0, 1),
  };
}

export function createBannerLayer(kind: BannerLayerKind, order: number, partial: Partial<BannerLayer> = {}): BannerLayer {
  const isText = kind === "text";
  return {
    id: bannerId("layer"),
    kind,
    name: partial.name ?? (isText ? "New text" : kind === "shape" ? "Rectangle" : "New layer"),
    parentId: partial.parentId ?? null,
    order,
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    transform: clampBannerTransform(partial.transform ?? {
      x: 50, y: 50, width: isText ? 40 : 24, height: isText ? 12 : 18, rotation: 0, opacity: 1,
    }),
    style: partial.style ?? (isText ? { fill: "#ffffff", fontSize: 34, fontWeight: 800 } : { fill: "#9dff3f" }),
    content: partial.content ?? (isText ? { text: "NEW EVENT" } : {}),
    ...(partial.timing ? {timing:structuredClone(partial.timing)} : {}),
    ...(partial.motion ? {motion:structuredClone(partial.motion)} : {}),
  };
}

export function createDefaultBannerProject(): BannerProject {
  const card = createBannerLayer("shape", 0, {
    name: "Banner surface",
    transform: { x: 50, y: 50, width: 72, height: 42, rotation: 0, opacity: 0.9 },
    style: { fill: "#111827", stroke: "#9dff3f" },
  });
  const title = createBannerLayer("text", 1, {
    name: "Event title",
    transform: { x: 50, y: 47, width: 58, height: 12, rotation: 0, opacity: 1 },
    style: { fill: "#ffffff", fontSize: 42, fontWeight: 800 },
    content: { text: "DOUBLE KILL" },
  });
  const subtitle = createBannerLayer("text", 2, {
    name: "Event subtitle",
    transform: { x: 50, y: 58, width: 58, height: 8, rotation: 0, opacity: 1 },
    style: { fill: "#9dff3f", fontSize: 18, fontWeight: 600 },
    content: { text: "Maiden approves." },
  });
  return {
    schemaVersion: 1,
    id: bannerId("project"),
    title: "Untitled event banner",
    eventId: "kill",
    artboard: { width: 1280, height: 720, safeZonePreset: "dota-hud" },
    assets: [],
    layers: [card, title, subtitle],
    revision: 1,
  };
}

export function cloneBannerProject(project: BannerProject): BannerProject {
  return structuredClone(project);
}
