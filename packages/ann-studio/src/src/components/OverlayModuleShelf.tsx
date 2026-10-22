import { OVERLAY_MODULE_IDS, OVERLAY_MODULE_LABELS, type OverlayLayout, type OverlayModuleId } from "../lib/overlayLayout";

interface OverlayModuleShelfProps {
  layout: OverlayLayout;
  selectedId: OverlayModuleId | null;
  warningIds?: ReadonlySet<OverlayModuleId>;
  onSelect: (id: OverlayModuleId) => void;
  onToggle: (id: OverlayModuleId, enabled: boolean) => void;
}

export function OverlayModuleShelf({ layout, selectedId, warningIds, onSelect, onToggle }: OverlayModuleShelfProps) {
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-ink">HUD modules</h3>
        <span className="text-[10px] text-ink-faint">{OVERLAY_MODULE_IDS.length}</span>
      </div>
      <ul aria-label="HUD modules" className="space-y-1.5">
        {OVERLAY_MODULE_IDS.map((id) => {
          const label = OVERLAY_MODULE_LABELS[id];
          const config = layout[id];
          const selected = selectedId === id;
          return (
            <li key={id} className={`flex items-center gap-1.5 rounded-lg border p-1.5 ${selected ? "border-lime bg-lime/10" : "border-line bg-black/15"}`}>
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onSelect(id)}
                  className="block w-full truncate rounded px-1 py-1 text-left text-xs text-ink-muted hover:text-ink"
                >
                  {label}
                </button>
                {warningIds?.has(id) && (
                  <span role="img" aria-label={`${label} has layout warning`} className="ml-1 text-amber-300" title="Layout warning">!</span>
                )}
                <span className="block px-1 text-[10px] text-ink-faint">{config.x}% · {config.y}%</span>
              </div>
              <label className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-white/5" title={`Enable ${label}`}>
                <input
                  aria-label={`Enable ${label}`}
                  className="accent-lime"
                  type="checkbox"
                  checked={config.enabled}
                  onChange={(event) => onToggle(id, event.target.checked)}
                />
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
