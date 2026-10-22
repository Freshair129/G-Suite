import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  BOX_REF,
  MODULE_BOX,
  OVERLAY_MODULE_LABELS,
  parseLayoutNumber,
  type OverlayLayout,
  type OverlayModuleId,
  type OverlayModuleLayout,
} from "../lib/overlayLayout";

type NumericField = "x" | "y" | "scale";
type LayoutPatch = Partial<OverlayModuleLayout>;
interface OverlayInspectorProps {
  selectedId: OverlayModuleId | null;
  layout: OverlayLayout;
  onCommit: (id: OverlayModuleId, patch: LayoutPatch) => void;
  onPreview: (id: OverlayModuleId, patch: LayoutPatch) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}

const fieldBounds: Record<NumericField, { min: number; max: number }> = {
  x: { min: 0, max: 100 },
  y: { min: 0, max: 100 },
  scale: { min: 0.6, max: 1.6 },
};

export function OverlayInspector({
  selectedId,
  layout,
  onCommit,
  onPreview,
  onGestureStart,
  onGestureEnd,
}: OverlayInspectorProps) {
  const selected = selectedId ? layout[selectedId] : null;
  const [values, setValues] = useState<Record<NumericField, string>>({ x: "", y: "", scale: "" });
  const scaleGestureActive = useRef(false);

  useEffect(() => {
    setValues({
      x: selected ? String(selected.x) : "",
      y: selected ? String(selected.y) : "",
      scale: selected ? String(selected.scale) : "",
    });
  }, [selectedId, selected?.x, selected?.y, selected?.scale]);

  const commitField = (field: NumericField, raw: string) => {
    if (!selectedId || !selected) return;
    const parsed = parseLayoutNumber(raw, fieldBounds[field].min, fieldBounds[field].max);
    if (parsed === null) {
      setValues((current) => ({ ...current, [field]: String(selected[field]) }));
      return;
    }
    onCommit(selectedId, { [field]: parsed });
    setValues((current) => ({ ...current, [field]: String(parsed) }));
  };

  const onNumericKeyDown = (field: NumericField, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commitField(field, event.currentTarget.value);
      return;
    }
    if ((field === "x" || field === "y") && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const step = event.shiftKey ? 1 : 0.1;
      const direction = event.key === "ArrowUp" ? 1 : -1;
      const value = Math.round(Math.max(0, Math.min(100, selected![field] + direction * step)) * 10) / 10;
      onCommit(selectedId!, { [field]: value });
      setValues((current) => ({ ...current, [field]: String(value) }));
    }
  };

  const beginScaleGesture = () => {
    if (scaleGestureActive.current) return;
    scaleGestureActive.current = true;
    onGestureStart();
  };

  const endScaleGesture = () => {
    if (!scaleGestureActive.current) return;
    scaleGestureActive.current = false;
    onGestureEnd();
  };

  const onScaleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (!selectedId) return;
    const scale = parseLayoutNumber(event.target.value, fieldBounds.scale.min, fieldBounds.scale.max);
    if (scale === null) return;
    setValues((current) => ({ ...current, scale: String(scale) }));
    onPreview(selectedId, { scale });
  };

  if (!selectedId || !selected) {
    return <aside aria-label="HUD module inspector" className="rounded-xl border border-line bg-black/15 p-3 text-xs text-ink-faint">Select a HUD module to edit its properties.</aside>;
  }

  const width = Math.round(MODULE_BOX[selectedId].w * selected.scale);
  const height = Math.round(MODULE_BOX[selectedId].h * selected.scale);

  return (
    <section aria-label="HUD module inspector" className="space-y-4">
      <div>
        <p className="text-[10px] uppercase tracking-wider text-ink-faint">Selected module</p>
        <h3 className="mt-1 text-sm font-bold text-ink">{OVERLAY_MODULE_LABELS[selectedId]}</h3>
      </div>

      <label className="flex items-center justify-between rounded-lg border border-line bg-black/15 px-3 py-2 text-xs text-ink-muted">
        <span>Enabled</span>
        <input
          aria-label="Enabled"
          className="accent-lime"
          type="checkbox"
          checked={selected.enabled}
          onChange={(event) => onCommit(selectedId, { enabled: event.target.checked })}
        />
      </label>

      <div className="grid grid-cols-2 gap-2">
        {(["x", "y"] as const).map((field) => (
          <label key={field} className="block text-[10px] text-ink-faint">
            <span>{field === "x" ? "Position X (%)" : "Position Y (%)"}</span>
            <input
              aria-label={field === "x" ? "Position X (%)" : "Position Y (%)"}
              className="mt-1 h-9 w-full rounded-lg border border-line bg-black/25 px-2 text-xs text-ink outline-none focus:border-lime/60"
              type="text"
              inputMode="decimal"
              value={values[field]}
              onChange={(event) => setValues((current) => ({ ...current, [field]: event.target.value }))}
              onBlur={(event) => commitField(field, event.currentTarget.value)}
              onKeyDown={(event) => onNumericKeyDown(field, event)}
            />
          </label>
        ))}
      </div>

      <div className="space-y-2 rounded-lg border border-line bg-black/15 p-3">
        <label className="block text-[10px] text-ink-faint">
          <span>Scale</span>
          <input
            aria-label="Scale"
            className="mt-1 h-9 w-full rounded-lg border border-line bg-black/25 px-2 text-xs text-ink outline-none focus:border-lime/60"
            type="text"
            inputMode="decimal"
            value={values.scale}
            onChange={(event) => setValues((current) => ({ ...current, scale: event.target.value }))}
            onBlur={(event) => commitField("scale", event.currentTarget.value)}
            onKeyDown={(event) => onNumericKeyDown("scale", event)}
          />
        </label>
        <input
          aria-label="Scale slider"
          className="w-full accent-lime"
          type="range"
          min={fieldBounds.scale.min}
          max={fieldBounds.scale.max}
          step="0.05"
          value={selected.scale}
          onPointerDown={beginScaleGesture}
          onPointerUp={endScaleGesture}
          onPointerCancel={endScaleGesture}
          onBlur={endScaleGesture}
          onKeyDown={(event) => {
            if (event.key.startsWith("Arrow")) beginScaleGesture();
          }}
          onKeyUp={(event) => {
            if (event.key.startsWith("Arrow")) endScaleGesture();
          }}
          onChange={onScaleChange}
        />
        <div className="flex justify-between text-[10px] text-ink-faint"><span>0.60×</span><span>1.60×</span></div>
      </div>

      <p className="rounded-lg border border-line bg-black/15 p-3 text-[10px] leading-relaxed text-ink-faint">
        Approx. at {BOX_REF.w} × {BOX_REF.h}: {width} × {height} px
      </p>
    </section>
  );
}
