export type LayoutMode = "compact" | "medium" | "wide";
export function layoutMode(width: number): LayoutMode {
  return width >= 1380 ? "wide" : width >= 1000 ? "medium" : "compact";
}
export function railWidths(width: number, requestedLeft: number, requestedRight: number) {
  const mode = layoutMode(width);
  if (mode === "compact") return { left: 0, right: 0 };
  const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
  const left = clamp(requestedLeft, 200, mode === "medium" ? 260 : Math.min(420, width - 560 - 260 - 16));
  return { left, right: mode === "wide" ? clamp(requestedRight, 260, Math.min(560, width - left - 560 - 16)) : 0 };
}
