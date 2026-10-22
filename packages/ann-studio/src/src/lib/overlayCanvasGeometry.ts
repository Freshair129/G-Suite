const MIN_LAYOUT_PERCENT = 0;
const MAX_LAYOUT_PERCENT = 100;
const MIN_LAYOUT_SCALE = 0.6;
const MAX_LAYOUT_SCALE = 1.6;

export interface ClientPoint {
  x: number;
  y: number;
}

export interface StageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundTenth = (value: number) => Math.round(value * 10) / 10;

function coordinatePercent(value: number, origin: number, size: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(origin) || !Number.isFinite(size) || size <= 0) return 0;
  return roundTenth(clamp(((value - origin) / size) * 100, MIN_LAYOUT_PERCENT, MAX_LAYOUT_PERCENT));
}

/** Convert a client point to finite, center-anchored percentages of a 16:9 stage. */
export function pointerToLayoutPercent(point: ClientPoint, rect: StageRect): { x: number; y: number } {
  return {
    x: coordinatePercent(point.x, rect.left, rect.width),
    y: coordinatePercent(point.y, rect.top, rect.height),
  };
}

/** Uniformly resize around the module center, clamped to OverlayLayout v1 limits. */
export function scaleFromPointerDrag(
  startScale: number,
  center: ClientPoint,
  initialPointer: ClientPoint,
  currentPointer: ClientPoint,
): number {
  const safeStart = Number.isFinite(startScale) ? clamp(startScale, MIN_LAYOUT_SCALE, MAX_LAYOUT_SCALE) : 1;
  const initialDistance = Math.hypot(initialPointer.x - center.x, initialPointer.y - center.y);
  const currentDistance = Math.hypot(currentPointer.x - center.x, currentPointer.y - center.y);
  if (!Number.isFinite(initialDistance) || !Number.isFinite(currentDistance) || initialDistance === 0) return safeStart;
  return clamp(safeStart * (currentDistance / initialDistance), MIN_LAYOUT_SCALE, MAX_LAYOUT_SCALE);
}
