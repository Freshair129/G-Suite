import { describe, expect, it } from "vitest";
import { parseLayoutNumber } from "./overlayLayout";

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
