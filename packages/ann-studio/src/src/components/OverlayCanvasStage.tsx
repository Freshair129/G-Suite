import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  ACCEPTED_OVERLAPS,
  BOX_REF,
  boxPercent,
  MODULE_BOX,
  moduleRect,
  OVERLAY_MODULE_IDS,
  OVERLAY_MODULE_LABELS,
  modulesOnScreen,
  STAGE_ZONES,
  zoneConflicts,
  type OverlayLayout,
  type OverlayModuleId,
  type StageScreen,
} from "../lib/overlayLayout";
import { pointerToLayoutPercent, scaleFromPointerDrag, type ClientPoint, type StageRect } from "../lib/overlayCanvasGeometry";
import { OverlayModulePreview } from "./OverlayModulePreview";

const DOTA_HUD_REFERENCE = "/dota-hud-reference.webp";
const DOTA_MINIMAP_REFERENCE = "/dota-minimap-reference.webp";
type GestureKind = "move" | "resize";

interface PointerGesture {
  id: OverlayModuleId;
  kind: GestureKind;
  pointerId: number;
  initialLayout: OverlayLayout;
  initialPointer: ClientPoint;
  initialPointerPercent: { x: number; y: number };
  center: ClientPoint;
}

interface OverlayCanvasStageProps {
  layout: OverlayLayout;
  previewLayout: OverlayLayout | null;
  selectedId: OverlayModuleId | null;
  screen: StageScreen;
  screenshotUrl: string | null;
  previewActive: boolean;
  bannerSrc?: string;
  onSelect: (id: OverlayModuleId) => void;
  onPreviewLayout: (layout: OverlayLayout) => void;
  onGestureCommit: (layout: OverlayLayout) => void;
  onGestureCancel: () => void;
}

function cloneLayout(layout: OverlayLayout): OverlayLayout {
  return Object.fromEntries(OVERLAY_MODULE_IDS.map((id) => [id, { ...layout[id] }])) as OverlayLayout;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const roundTenth = (value: number) => Math.round(value * 10) / 10;

export function OverlayCanvasStage({
  layout,
  previewLayout,
  selectedId,
  screen,
  screenshotUrl,
  previewActive,
  bannerSrc,
  onSelect,
  onPreviewLayout,
  onGestureCommit,
  onGestureCancel,
}: OverlayCanvasStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<PointerGesture | null>(null);
  const [stageScale, setStageScale] = useState(0);
  const viewLayout = previewLayout ?? layout;
  const zones = STAGE_ZONES[screen];
  const onScreen = useMemo(() => new Set(modulesOnScreen(screen)), [screen]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => setStageScale(stage.getBoundingClientRect().width / BOX_REF.w);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const zByArea = useMemo(() => {
    const area = (id: OverlayModuleId) => {
      const { w, h } = boxPercent(id, viewLayout[id].scale);
      return w * h;
    };
    const ranked = [...OVERLAY_MODULE_IDS].sort((a, b) => area(b) - area(a) || a.localeCompare(b));
    return Object.fromEntries(ranked.map((id, index) => [id, index + 1])) as Record<OverlayModuleId, number>;
  }, [viewLayout]);

  const stageRect = (): (StageRect & DOMRect) | null => stageRef.current?.getBoundingClientRect() ?? null;

  const beginGesture = (kind: GestureKind, id: OverlayModuleId, event: PointerEvent<HTMLButtonElement>) => {
    const rect = stageRect();
    if (!rect || rect.width <= 0 || rect.height <= 0 || event.button !== 0) return;
    const currentLayout = previewLayout ?? layout;
    const config = currentLayout[id];
    const center = {
      x: rect.left + (config.x / 100) * rect.width,
      y: rect.top + (config.y / 100) * rect.height,
    };
    const initialPointer = { x: event.clientX, y: event.clientY };
    gestureRef.current = {
      id,
      kind,
      pointerId: event.pointerId,
      initialLayout: cloneLayout(currentLayout),
      initialPointer,
      initialPointerPercent: pointerToLayoutPercent(initialPointer, rect),
      center,
    };
    onSelect(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const previewGesture = (point: ClientPoint, rect: StageRect & DOMRect): OverlayLayout | null => {
    const gesture = gestureRef.current;
    if (!gesture) return null;
    const start = gesture.initialLayout[gesture.id];
    const next = cloneLayout(gesture.initialLayout);
    if (gesture.kind === "move") {
      const current = pointerToLayoutPercent(point, rect);
      next[gesture.id] = {
        ...start,
        x: roundTenth(clamp(start.x + current.x - gesture.initialPointerPercent.x, 0, 100)),
        y: roundTenth(clamp(start.y + current.y - gesture.initialPointerPercent.y, 0, 100)),
      };
    } else {
      next[gesture.id] = {
        ...start,
        scale: scaleFromPointerDrag(start.scale, gesture.center, gesture.initialPointer, point),
      };
    }
    return next;
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const rect = stageRect();
    if (!gesture || !rect || gesture.pointerId !== event.pointerId) return;
    const next = previewGesture({ x: event.clientX, y: event.clientY }, rect);
    if (next) onPreviewLayout(next);
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    const rect = stageRect();
    if (!gesture || !rect || gesture.pointerId !== event.pointerId) return;
    const next = previewGesture({ x: event.clientX, y: event.clientY }, rect);
    gestureRef.current = null;
    if (next) {
      onPreviewLayout(next);
      onGestureCommit(next);
    }
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    onGestureCancel();
  };

  return (
    <div
      ref={stageRef}
      data-testid="overlay-canvas-stage"
      role="group"
      aria-label="HUD canvas"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      className="relative aspect-video overflow-hidden rounded-xl border border-line bg-[#111214] select-none"
      style={screen === "pregame"
        ? { background: "#0b0d12" }
        : { background: `center / cover no-repeat url(${screenshotUrl ?? DOTA_HUD_REFERENCE})` }}
    >
      {zones.map((zone) => (
        <div
          key={zone.id}
          className={`absolute pointer-events-none ${zone.kind === "transient" ? "border border-dashed border-amber-400/80 bg-amber-400/10" : "border border-white/25"}`}
          style={{ left: `${zone.left}%`, top: `${zone.top}%`, width: `${zone.right - zone.left}%`, height: `${zone.bottom - zone.top}%` }}
        >
          <span className="absolute left-1 top-0.5 text-[9px] leading-tight text-white/45">{zone.label}</span>
        </div>
      ))}

      {!screenshotUrl && (
        <span className="absolute bottom-1 right-2 text-[9px] text-white/50">
          Dota 2 reference — load your own capture for your aspect ratio / HUD skin
        </span>
      )}

      {screen === "pregame" && (
        <img
          src={DOTA_MINIMAP_REFERENCE}
          alt=""
          draggable={false}
          className="pointer-events-none absolute object-contain opacity-70"
          style={{ left: "30%", top: "10%", width: "40%", height: "80%" }}
        />
      )}

      {OVERLAY_MODULE_IDS.map((id) => {
        const config = viewLayout[id];
        if (!config.enabled) return null;
        const label = OVERLAY_MODULE_LABELS[id];
        const isSelected = selectedId === id;
        const isBanner = id === "banner";
        const visible = !isBanner || previewActive;
        const { w, h } = boxPercent(id, config.scale);
        const conflicts = onScreen.has(id) && ACCEPTED_OVERLAPS[id] === undefined
          ? zoneConflicts(moduleRect(id, config), zones)
          : [];
        const blocked = conflicts.some((zone) => zone.kind === "blocked");
        const transient = conflicts.some((zone) => zone.kind === "transient");
        const ring = isSelected
          ? "ring-2 ring-sky-300"
          : blocked
            ? "ring-1 ring-red-400"
            : transient
              ? "ring-1 ring-amber-400"
              : "";
        return (
          <div
            key={id}
            data-testid={`overlay-module-${id}`}
            title={conflicts.length ? `Overlaps: ${conflicts.map((zone) => zone.label).join(", ")}` : label}
            className={`absolute rounded ${ring} ${visible && onScreen.has(id) ? "" : "opacity-35"}`}
            style={{
              left: `${config.x}%`, top: `${config.y}%`, width: `${w}%`, height: `${h}%`,
              transform: "translate(-50%, -50%)", zIndex: isSelected ? 100 : zByArea[id],
            }}
          >
            <button
              type="button"
              aria-label={`Select ${label} module`}
              aria-pressed={isSelected}
              onPointerDown={(event) => {
                event.preventDefault();
                beginGesture("move", id, event);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelect(id);
              }}
              className="absolute inset-0 z-10 cursor-grab rounded bg-transparent active:cursor-grabbing"
              style={{ touchAction: "none" }}
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="origin-center" style={{ transform: `scale(${stageScale * config.scale})` }}>
                <OverlayModulePreview id={id} bannerSrc={isBanner ? bannerSrc : undefined} />
              </div>
            </div>
            {isSelected && (
              <span className="pointer-events-none absolute -top-4 left-0 z-20 whitespace-nowrap rounded bg-black/80 px-1 text-[10px] font-semibold leading-tight text-sky-200">
                {label} · {config.x},{config.y} · {config.scale.toFixed(2)}×
              </span>
            )}
            {isSelected && (
              <button
                type="button"
                aria-label={`Resize ${label} module`}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  beginGesture("resize", id, event);
                }}
                className="absolute right-1 bottom-1 z-30 flex h-4 w-4 cursor-nwse-resize items-center justify-center rounded-full border border-white bg-sky-500 shadow"
                style={{ touchAction: "none" }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
