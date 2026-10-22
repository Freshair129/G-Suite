import { describe, expect, it } from "vitest";
import {
  cloneDefaultOverlayLayout,
  getOverlayConflictItems,
  parseLayoutNumber,
} from "./overlayLayout";

describe("parseLayoutNumber", () => {
  it.each([
    ["42.5", 0, 100, 42.5],
    ["0", 0, 100, 0],
    ["100", 0, 100, 100],
    ["0.6", 0.6, 1.6, 0.6],
    ["1.6", 0.6, 1.6, 1.6],
  ] as const)("parses %s inside the inclusive limits", (raw, min, max, expected) => {
    expect(parseLayoutNumber(raw, min, max)).toBe(expected);
  });

  it.each([
    "",
    "   ",
    "NaN",
    "Infinity",
    "-Infinity",
  ])("rejects empty or non-finite input %j", (raw) => {
    expect(parseLayoutNumber(raw, 0, 100)).toBeNull();
  });

  it.each([
    ["-0.1", 0, 100],
    ["100.1", 0, 100],
    ["0.59", 0.6, 1.6],
    ["1.61", 0.6, 1.6],
  ] as const)("rejects %s outside %s..%s", (raw, min, max) => {
    expect(parseLayoutNumber(raw, min, max)).toBeNull();
  });
});

describe("getOverlayConflictItems", () => {
  it("reports blocked and transient Dota zones as different warning kinds", () => {
    const layout = cloneDefaultOverlayLayout();
    layout.clock = { ...layout.clock, x: 50, y: 4 };
    layout.alert = { ...layout.alert, x: 50, y: 12 };

    const items = getOverlayConflictItems(layout, "ingame");

    expect(items).toContainEqual(expect.objectContaining({
      moduleId: "clock",
      kind: "blocked",
      message: expect.stringContaining("hero portraits / score"),
    }));
    expect(items).toContainEqual(expect.objectContaining({
      moduleId: "alert",
      kind: "transient",
      message: expect.stringContaining("kill banner / feed"),
    }));
  });

  it("reports intentional overlap reasons as accepted warnings", () => {
    const items = getOverlayConflictItems(cloneDefaultOverlayLayout(), "pregame");

    expect(items).toContainEqual(expect.objectContaining({
      moduleId: "toast",
      kind: "accepted",
      message: expect.stringContaining("passes over the map"),
    }));
  });

  it("still reports blocked roster overlaps for the toast outside its accepted map zone", () => {
    const layout = cloneDefaultOverlayLayout();
    layout.toast = { ...layout.toast, x: 8, y: 50 };

    expect(getOverlayConflictItems(layout, "pregame")).toContainEqual(expect.objectContaining({
      moduleId: "toast",
      kind: "blocked",
      message: expect.stringContaining("team roster (left)"),
    }));
  });

  it("includes the other module on actionable module collision warnings", () => {
    const layout = cloneDefaultOverlayLayout();
    layout.alert = { ...layout.alert, x: 70, y: 50 };
    layout.companion = { ...layout.companion, x: 70, y: 50 };

    expect(getOverlayConflictItems(layout, "ingame")).toContainEqual(expect.objectContaining({
      moduleId: "alert",
      otherModuleId: "companion",
      kind: "module",
      message: expect.stringContaining("Maiden"),
    }));
  });

  it("uses only modules visible on the selected screen", () => {
    const layout = cloneDefaultOverlayLayout();
    layout.standby = { ...layout.standby, x: 50, y: 50 };
    layout.clock = { ...layout.clock, x: 50, y: 4 };
    const inGame = getOverlayConflictItems(layout, "ingame");
    const preGame = getOverlayConflictItems(layout, "pregame");

    expect(inGame.some((item) => item.moduleId === "standby" || item.otherModuleId === "standby")).toBe(false);
    expect(preGame.some((item) => item.moduleId === "clock" || item.otherModuleId === "clock")).toBe(false);
    expect(preGame.some((item) => item.moduleId === "standby" && item.kind === "blocked")).toBe(true);
    expect(inGame.some((item) => item.moduleId === "clock" && item.kind === "blocked")).toBe(true);
  });
});
