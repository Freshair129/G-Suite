import { describe, expect, it } from "vitest";
import { createBannerLayer, createDefaultBannerProject } from "./bannerProject";
import { bannerProjectMotionPlan, planBannerProjectFrames } from "./bannerComposer";
import { preflightBannerProject } from "./bannerPreflight";

describe("BannerProject frame composition plan", () => {
  it("keeps layer order and applies per-layer timing at frame boundaries", () => {
    const project = createDefaultBannerProject();
    const timed = createBannerLayer("text", 3, {
      name: "Late title",
      timing: { startMs: 1750, endMs: 3500 },
    });
    project.layers.push(timed);

    const frames = planBannerProjectFrames(project, { ...bannerProjectMotionPlan(), frames: 3 });

    expect(frames.map((frame) => frame.layerIds)).toEqual([
      project.layers.slice(0, 3).map((layer) => layer.id),
      project.layers.map((layer) => layer.id),
      project.layers.map((layer) => layer.id),
    ]);
  });

  it("inherits hidden group state without changing the project", () => {
    const project = createDefaultBannerProject();
    const group = createBannerLayer("group", 3, { visible: false });
    const child = createBannerLayer("text", 4, { parentId: group.id });
    project.layers.push(group, child);
    const before = structuredClone(project);

    const frames = planBannerProjectFrames(project, { ...bannerProjectMotionPlan(), frames: 1 });

    expect(frames[0].layerIds).not.toContain(child.id);
    expect(project).toEqual(before);
  });

  it("rejects timing metadata that cannot be represented by the bake envelope", () => {
    const project = createDefaultBannerProject();
    project.layers[1].timing = { startMs: 2500, endMs: 4000 };

    const issues = preflightBannerProject(project, bannerProjectMotionPlan());

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invalid_timing", layerId: project.layers[1].id }),
    ]));
  });
});
