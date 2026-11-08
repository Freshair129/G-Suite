import { describe, expect, it } from "vitest";
import schema from "../../../../../schemas/gmaiden-events.json";
import { EVENT_CATEGORIES, GMAIDEN_EVENTS, eventLabel } from "./gmaiden-events";

const events = schema["x-events"];

describe("canonical event adapter", () => {
  it("exposes every JSON event in canonical order", () => {
    expect(GMAIDEN_EVENTS.map((event) => event.id)).toEqual(events.map((event) => event.id));
  });

  it("preserves JSON event data with display casing for categories", () => {
    expect(GMAIDEN_EVENTS).toEqual(events.map((event) => ({
      ...event,
      category: event.category.charAt(0).toUpperCase() + event.category.slice(1),
    })));
  });

  it("derives unique categories in their first-seen JSON order", () => {
    expect(EVENT_CATEGORIES).toEqual([...new Set(events.map((event) =>
      event.category.charAt(0).toUpperCase() + event.category.slice(1),
    ))]);
  });

  it.each(["danger", "gank"])("uses the JSON label for %s", (id) => {
    const canonical = events.find((event) => event.id === id);
    expect(canonical).toBeDefined();
    expect(GMAIDEN_EVENTS.find((event) => event.id === id)?.label).toBe(canonical!.label);
    expect(eventLabel(id)).toBe(canonical!.label);
  });
});
