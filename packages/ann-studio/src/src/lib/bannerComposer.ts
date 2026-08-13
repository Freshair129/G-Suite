// @req GOE-003 — turns the local BannerProject layer tree into deterministic
// runtime-sized frame plans and browser-canvas frames for the existing WebP
// encoder. This module never writes files or sends game data across the seam.
// @spec SDD-003 — authoring inputs are rasterised before Ann Pack handoff.
// @designs docs/motion-export-contract-draft.md
// @tested src/lib/bannerComposer.test.ts

import type { BannerAsset, BannerLayer, BannerProject } from "./bannerProject";
import {
  MOTION_EXPORT_ENVELOPE,
  preflightBannerProject,
  type MotionExportPlan,
} from "./bannerPreflight";

export const BANNER_PROJECT_OUTPUT = {
  width: MOTION_EXPORT_ENVELOPE.width,
  height: MOTION_EXPORT_ENVELOPE.height,
  fps: 24,
  frames: 48,
  durationSec: MOTION_EXPORT_ENVELOPE.maxDurationSec,
} as const;

export type BannerProjectMotionOptions = Partial<{
  width: number;
  height: number;
  fps: number;
  frames: number;
  durationSec: number;
}>;

export type BannerFramePlan = {
  index: number;
  timeMs: number;
  layerIds: string[];
};

export function bannerProjectMotionPlan(
  options: BannerProjectMotionOptions = {},
): MotionExportPlan {
  return {
    width: options.width ?? BANNER_PROJECT_OUTPUT.width,
    height: options.height ?? BANNER_PROJECT_OUTPUT.height,
    fps: options.fps ?? BANNER_PROJECT_OUTPUT.fps,
    frames: options.frames ?? BANNER_PROJECT_OUTPUT.frames,
    durationSec: options.durationSec ?? BANNER_PROJECT_OUTPUT.durationSec,
  };
}

function isActiveAt(layer: BannerLayer, byId: Map<string, BannerLayer>, timeMs: number) {
  let current: BannerLayer | undefined = layer;
  let depth = 0;
  while (current && depth <= byId.size) {
    if (!current.visible) return false;
    if (current.timing && (timeMs < current.timing.startMs || timeMs > current.timing.endMs)) return false;
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth += 1;
  }
  return true;
}

/**
 * Build a stable frame plan without touching the DOM. Layer order and timing
 * are resolved once here, making the browser bake and its tests agree about
 * which layers belong in each output frame.
 */
export function planBannerProjectFrames(
  project: BannerProject,
  plan: MotionExportPlan = bannerProjectMotionPlan(),
): BannerFramePlan[] {
  const byId = new Map(project.layers.map((layer) => [layer.id, layer]));
  const ordered = project.layers
    .filter((layer) => layer.kind !== "group")
    .slice()
    .sort((a, b) => a.order - b.order);
  const lastTimeMs = Math.max(0, plan.durationSec * 1000);
  const denominator = Math.max(1, plan.frames - 1);
  return Array.from({ length: Math.max(0, plan.frames) }, (_, index) => {
    const timeMs = plan.frames <= 1 ? 0 : (index / denominator) * lastTimeMs;
    return {
      index,
      timeMs,
      layerIds: ordered.filter((layer) => isActiveAt(layer, byId, timeMs)).map((layer) => layer.id),
    };
  });
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("asset image decode failed"));
    image.src = source;
  });
}

async function loadVideo(source: string): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = source;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error("asset video decode failed"));
  });
  return video;
}

type DecodedAsset = HTMLImageElement | HTMLVideoElement;

async function decodeAsset(asset: BannerAsset): Promise<DecodedAsset> {
  if (!asset.source) throw new Error(`asset ${asset.id} has no source`);
  return asset.kind === "video" ? loadVideo(asset.source) : loadImage(asset.source);
}

function setFont(ctx: CanvasRenderingContext2D, layer: BannerLayer, scaleY: number) {
  const weight = layer.style.fontWeight ?? 600;
  const size = Math.max(1, (layer.style.fontSize ?? 24) * scaleY);
  ctx.font = `${weight} ${size}px 'Segoe UI', system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
}

function drawAsset(
  ctx: CanvasRenderingContext2D,
  source: DecodedAsset,
  asset: BannerAsset,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth;
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight;
  if (!sourceWidth || !sourceHeight) {
    ctx.drawImage(source, x, y, width, height);
    return;
  }
  const cover = asset.kind === "video";
  const fit = cover ? Math.max(width / sourceWidth, height / sourceHeight) : Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * fit;
  const drawHeight = sourceHeight * fit;
  ctx.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: BannerLayer,
  asset: BannerAsset | undefined,
  decoded: DecodedAsset | undefined,
  width: number,
  height: number,
  artboardWidth: number,
  artboardHeight: number,
) {
  const x = (layer.transform.x / 100) * width;
  const y = (layer.transform.y / 100) * height;
  const layerWidth = (layer.transform.width / 100) * width;
  const layerHeight = (layer.transform.height / 100) * height;
  ctx.save();
  ctx.globalAlpha = layer.transform.opacity;
  ctx.translate(x, y);
  ctx.rotate((layer.transform.rotation * Math.PI) / 180);
  if (layer.kind === "text") {
    setFont(ctx, layer, height / artboardHeight);
    ctx.fillStyle = layer.style.fill ?? "#ffffff";
    ctx.fillText(layer.content.text ?? "", 0, 0, layerWidth);
  } else if (layer.kind === "shape") {
    ctx.fillStyle = layer.style.fill ?? "transparent";
    ctx.fillRect(-layerWidth / 2, -layerHeight / 2, layerWidth, layerHeight);
    if (layer.style.stroke) {
      ctx.strokeStyle = layer.style.stroke;
      ctx.strokeRect(-layerWidth / 2, -layerHeight / 2, layerWidth, layerHeight);
    }
  } else if (asset && decoded) {
    drawAsset(ctx, decoded, asset, -layerWidth / 2, -layerHeight / 2, layerWidth, layerHeight);
  }
  ctx.restore();
}

/** Render one frame as a transparent PNG data URL. */
export async function composeBannerProjectFrame(
  project: BannerProject,
  frame: BannerFramePlan,
  plan: MotionExportPlan = bannerProjectMotionPlan(),
  decodedAssets?: Map<string, DecodedAsset>,
): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = plan.width;
  canvas.height = plan.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));
  const decoded = decodedAssets ?? new Map<string, DecodedAsset>();
  for (const layerId of frame.layerIds) {
    const layer = project.layers.find((candidate) => candidate.id === layerId);
    if (!layer) continue;
    const asset = layer.content.assetId ? assets.get(layer.content.assetId) : undefined;
    if (asset && !decoded.has(asset.id)) decoded.set(asset.id, await decodeAsset(asset));
    const source = asset ? decoded.get(asset.id) : undefined;
    if (layer.kind === "video" && source instanceof HTMLVideoElement && Number.isFinite(frame.timeMs)) {
      const target = frame.timeMs / 1000;
      if (Math.abs(source.currentTime - target) > 0.01) {
        source.currentTime = target;
        await new Promise<void>((resolve) => { source.onseeked = () => resolve(); });
      }
    }
    drawLayer(ctx, layer, asset, source, plan.width, plan.height, project.artboard.width, project.artboard.height);
  }
  return canvas.toDataURL("image/png").split(",")[1] ?? "";
}

/** Render all preflight-approved frames for the existing Tauri WebP command. */
export async function composeBannerProjectFrames(
  project: BannerProject,
  plan: MotionExportPlan = bannerProjectMotionPlan(),
): Promise<string[]> {
  const issues = preflightBannerProject(project, plan);
  if (issues.length) throw new Error(issues.map((issue) => `${issue.code}: ${issue.detail}`).join("; "));
  const decoded = new Map<string, DecodedAsset>();
  const frames = planBannerProjectFrames(project, plan);
  return Promise.all(frames.map((frame) => composeBannerProjectFrame(project, frame, plan, decoded)));
}
