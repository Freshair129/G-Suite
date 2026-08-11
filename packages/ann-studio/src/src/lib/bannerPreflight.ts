// @req GOE-003 — pure candidate validator for a runtime-safe motion export plan; it is not wired into bake or install.
// @spec SDD-003 — reports invalid candidate plans without mutating the local project or completing a runtime handoff.
// @designs docs/motion-export-contract-draft.md
// @tested src/lib/bannerPreflight.test.ts
import type { BannerProject } from "./bannerProject";

export const MOTION_EXPORT_ENVELOPE = {
  width: 840,
  height: 240,
  minDurationSec: 0.5,
  maxDurationSec: 3.5,
  maxFps: 24,
  maxFrames: 48,
  maxEncodedBytes: null as number | null,
} as const;

export type BannerPreflightCode =
  | "missing_asset"
  | "unsupported_layer"
  | "decode_failed"
  | "invalid_timing"
  | "frame_budget_exceeded"
  | "dimension_mismatch"
  | "encoded_size_exceeded";

export type BannerPreflightIssue = { code: BannerPreflightCode; layerId?: string; detail: string };

export type MotionExportPlan = {
  fps: number;
  frames: number;
  durationSec: number;
  width: number;
  height: number;
  encodedBytes?: number;
  decodeError?: string;
};

const ASSET_LAYER_KINDS = new Set(["image", "svg", "video"]);
const SUPPORTED_LAYER_KINDS = new Set(["group", "text", "shape", "image", "svg", "video"]);

export function preflightBannerProject(project: BannerProject, plan: MotionExportPlan): BannerPreflightIssue[] {
  const issues: BannerPreflightIssue[] = [];
  const assets = new Set(project.assets.map((asset) => asset.id));

  for (const layer of project.layers) {
    if (!SUPPORTED_LAYER_KINDS.has(layer.kind)) {
      issues.push({ code: "unsupported_layer", layerId: layer.id, detail: `Unsupported layer kind: ${layer.kind}` });
    }
    if (layer.visible && ASSET_LAYER_KINDS.has(layer.kind) && (!layer.content.assetId || !assets.has(layer.content.assetId))) {
      issues.push({ code: "missing_asset", layerId: layer.id, detail: "Visible asset layer has no local source asset." });
    }
  }

  if (!Number.isFinite(plan.durationSec) || plan.durationSec < MOTION_EXPORT_ENVELOPE.minDurationSec || plan.durationSec > MOTION_EXPORT_ENVELOPE.maxDurationSec) {
    issues.push({ code: "invalid_timing", detail: `Duration must be ${MOTION_EXPORT_ENVELOPE.minDurationSec}-${MOTION_EXPORT_ENVELOPE.maxDurationSec}s.` });
  }
  if (!Number.isInteger(plan.frames) || plan.frames < 1 || plan.frames > MOTION_EXPORT_ENVELOPE.maxFrames || !Number.isFinite(plan.fps) || plan.fps <= 0 || plan.fps > MOTION_EXPORT_ENVELOPE.maxFps) {
    issues.push({ code: "frame_budget_exceeded", detail: `Frame plan exceeds ${MOTION_EXPORT_ENVELOPE.maxFrames} frames or ${MOTION_EXPORT_ENVELOPE.maxFps} fps.` });
  }
  if (plan.width !== MOTION_EXPORT_ENVELOPE.width || plan.height !== MOTION_EXPORT_ENVELOPE.height) {
    issues.push({ code: "dimension_mismatch", detail: `Output must be ${MOTION_EXPORT_ENVELOPE.width}×${MOTION_EXPORT_ENVELOPE.height}.` });
  }
  if (plan.decodeError) issues.push({ code: "decode_failed", detail: plan.decodeError });
  if (MOTION_EXPORT_ENVELOPE.maxEncodedBytes !== null && plan.encodedBytes !== undefined && plan.encodedBytes > MOTION_EXPORT_ENVELOPE.maxEncodedBytes) {
    issues.push({ code: "encoded_size_exceeded", detail: "Encoded asset exceeds the approved byte budget." });
  }
  return issues;
}
