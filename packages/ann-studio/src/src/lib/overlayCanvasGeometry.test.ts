import { describe, expect, it } from "vitest";
import { pointerToLayoutPercent, scaleFromPointerDrag } from "./overlayCanvasGeometry";

const rect = { left: 100, top: 50, width: 1000, height: 500 };

describe("pointerToLayoutPercent", () => {
  it.each([
    [{ x: 100, y: 300 }, { x: 0, y: 50 }],
    [{ x: 1100, y: 300 }, { x: 100, y: 50 }],
    [{ x: 600, y: 50 }, { x: 50, y: 0 }],
    [{ x: 600, y: 550 }, { x: 50, y: 100 }],
    [{ x: -5, y: -20 }, { x: 0, y: 0 }],
    [{ x: 1300, y: 700 }, { x: 100, y: 100 }],
  ] as const)("maps client point %j to %j", (point, expected) => {
    expect(pointerToLayoutPercent(point, rect)).toEqual(expected);
  });

  it("rounds to 0.1 percent and stays finite for a degenerate stage", () => {
    expect(pointerToLayoutPercent({ x: 234.56, y: 222.22 }, rect)).toEqual({ x: 13.5, y: 34.4 });
    expect(pointerToLayoutPercent({ x: 12, y: 42 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("scaleFromPointerDrag", () => {
  it("scales uniformly by the pointer distance ratio around the same center", () => {
    const center = { x: 10, y: 20 };
    expect(scaleFromPointerDrag(1, center, { x: 20, y: 20 }, { x: 18, y: 20 })).toBe(0.8);
    expect(scaleFromPointerDrag(1, center, { x: 20, y: 20 }, { x: 22, y: 20 })).toBe(1.2);
    expect(center).toEqual({ x: 10, y: 20 });
  });

  it("clamps scale to the v1 limits and keeps the starting scale for a zero start distance", () => {
    const center = { x: 10, y: 20 };
    expect(scaleFromPointerDrag(1, center, { x: 20, y: 20 }, { x: -10, y: 20 })).toBe(1.6);
    expect(scaleFromPointerDrag(1, center, { x: 20, y: 20 }, { x: 15, y: 20 })).toBe(0.6);
    expect(scaleFromPointerDrag(1.25, center, center, { x: 30, y: 20 })).toBe(1.25);
  });
});
