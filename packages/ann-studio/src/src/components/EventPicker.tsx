import { DOTA_EVENTS, EVENT_CATEGORIES } from "../data/dota-events";

interface Props {
  value: string;
  onChange: (eventId: string) => void;
}

export default function EventPicker({ value, onChange }: Props) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full h-7 rounded-md bg-base/60 border border-line px-1.5 text-[11px] text-ink-muted outline-none focus:border-mint-400 hover:border-white/15 transition-colors"
    >
      {EVENT_CATEGORIES.map((cat) => (
        <optgroup key={cat} label={cat}>
          {DOTA_EVENTS.filter((e) => e.category === cat).map((e) => (
            <option key={e.id} value={e.id}>
              {e.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
