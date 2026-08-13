import { describe, expect, it } from "vitest";
import { createBannerLayer, createDefaultBannerProject } from "./bannerProject";
import { preflightBannerProject, type MotionExportPlan } from "./bannerPreflight";

const validPlan: MotionExportPlan = { fps: 24, frames: 48, durationSec: 3.5, width: 840, height: 240 };

describe("Banner motion export preflight", () => {
  it("accepts the current runtime-safe envelope without mutating the project", () => {
    const project = createDefaultBannerProject();
    const before = structuredClone(project);
    expect(preflightBannerProject(project, validPlan)).toEqual([]);
    expect(project).toEqual(before);
  });

  it("rejects a visible asset layer with no local asset", () => {
    const project = createDefaultBannerProject();
    project.layers.push(createBannerLayer("video", 3, { content: { assetId: "missing" } }));
    expect(preflightBannerProject(project, validPlan).map((issue) => issue.code)).toContain("missing_asset");
  });

  it("rejects invalid timing and frame budgets", () => {
    const issues = preflightBannerProject(createDefaultBannerProject(), { ...validPlan, durationSec: 4, fps: 25, frames: 49 });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["invalid_timing", "frame_budget_exceeded"]));
  });

  it("rejects incompatible dimensions and decode failures", () => {
    const issues = preflightBannerProject(createDefaultBannerProject(), { ...validPlan, width: 1280, decodeError: "decoder unavailable" });
    expect(issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["dimension_mismatch", "decode_failed"]));
  });
});
