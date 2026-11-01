import { describe, expect, it } from "vitest";
import { layoutMode, railWidths } from "./responsiveLayout";

describe("workbench layout", () => {
  it("changes modes at measured workbench boundaries", () => {
    expect([959, 999, 1000, 1379, 1380].map(layoutMode)).toEqual(["compact", "compact", "medium", "medium", "wide"]);
  });
  it("clamps rails without starving the center and restores requested widths", () => {
    expect(railWidths(1380, 420, 560)).toEqual({ left: 420, right: 384 });
    expect(railWidths(1920, 420, 560)).toEqual({ left: 420, right: 560 });
    expect(railWidths(1000, 420, 560)).toEqual({ left: 260, right: 0 });
    expect(railWidths(960, 420, 560)).toEqual({ left: 0, right: 0 });
  });
});
