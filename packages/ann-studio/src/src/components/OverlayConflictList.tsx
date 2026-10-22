import type { OverlayConflictItem, OverlayModuleId } from "../lib/overlayLayout";

interface OverlayConflictListProps {
  items: OverlayConflictItem[];
  onSelect: (id: OverlayModuleId) => void;
}

const styleByKind = {
  blocked: "border-red-400/30 bg-red-400/5 text-red-300",
  transient: "border-amber-400/30 bg-amber-400/5 text-amber-300",
  accepted: "border-sky-400/30 bg-sky-400/5 text-sky-300",
  module: "border-amber-400/30 bg-amber-400/5 text-amber-300",
} as const;

export function OverlayConflictList({ items, onSelect }: OverlayConflictListProps) {
  if (items.length === 0) {
    return <p role="status" className="mt-2 text-xs text-lime">No overlaps: every enabled module clears the HUD and each other.</p>;
  }

  return (
    <ul aria-label="HUD overlap warnings" className="mt-2 space-y-1">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            data-kind={item.kind}
            data-other-module-id={item.otherModuleId}
            onClick={() => onSelect(item.moduleId)}
            className={`w-full rounded-lg border px-2 py-1.5 text-left text-xs hover:brightness-125 ${styleByKind[item.kind]}`}
          >
            {item.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
