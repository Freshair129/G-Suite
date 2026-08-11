import { describe, expect, it } from "vitest";
import {
  clampBannerTransform,
  cloneBannerProject,
  createBannerLayer,
  createDefaultBannerProject,
} from "./bannerProject";

describe("BannerProject model", () => {
  it("creates a valid default project with an event-safe artboard", () => {
    const project = createDefaultBannerProject();

    expect(project.schemaVersion).toBe(1);
    expect(project.artboard).toEqual({ width: 1280, height: 720, safeZonePreset: "dota-hud" });
    expect(project.layers).toHaveLength(3);
    expect(project.layers.map((layer) => layer.order)).toEqual([0, 1, 2]);
  });

  it("clamps transform values to the authoring bounds", () => {
    expect(clampBannerTransform({ x: -10, y: 120, width: 1, height: 101, rotation: 270, opacity: -1 })).toEqual({
      x: 0, y: 100, width: 2, height: 100, rotation: 180, opacity: 0,
    });
  });

  it("preserves a layer parent and applies type defaults", () => {
    const layer = createBannerLayer("text", 4, { parentId: "group_1", content: { text: "KILL" } });

    expect(layer.parentId).toBe("group_1");
    expect(layer.content.text).toBe("KILL");
    expect(layer.style.fontSize).toBe(34);
  });

  it("deep-clones a project without sharing nested layer state", () => {
    const original = createDefaultBannerProject();
    const clone = cloneBannerProject(original);

    clone.layers[0].transform.x = 12;
    clone.layers[0].style.fill = "#000000";

    expect(original.layers[0].transform.x).toBe(50);
    expect(original.layers[0].style.fill).toBe("#111827");
  });
});
