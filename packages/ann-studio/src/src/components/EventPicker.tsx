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
      className="bg-gray-800 text-gray-200 text-xs rounded px-1.5 py-1 border border-gray-700 focus:border-ice-400 outline-none w-full"
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
