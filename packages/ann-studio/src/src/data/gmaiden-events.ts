import schema from '../../../../../schemas/gmaiden-events.json';

// Event eligibility and authoring choices share the runtime taxonomy.

export interface GMaidenEvent {
  id: string;
  label: string;
  category: string;
  priority: "critical" | "high" | "normal" | "low" | "none";
  status: "active" | "new";
  trigger: string;
}

export const GMAIDEN_EVENTS: GMaidenEvent[] = schema['x-events'].map(event=>({
  ...event,
  category: event.category.charAt(0).toUpperCase()+event.category.slice(1),
  priority: event.priority as GMaidenEvent['priority'],
  status: event.status as GMaidenEvent['status'],
}));

export const EVENT_CATEGORIES = [...new Set(GMAIDEN_EVENTS.map((e) => e.category))];

export const eventLabel = (id: string) =>
  GMAIDEN_EVENTS.find((e) => e.id === id)?.label ?? id;

/** Compact list for an LLM prompt: "id — trigger". */
export const eventContractForPrompt = () =>
  GMAIDEN_EVENTS.filter((e) => e.id !== "unused")
    .map((e) => `${e.id} — ${e.trigger}`)
    .join("\n");
