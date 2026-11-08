import { expect, it } from "vitest";
import { EVENT_THAI, eventTone } from "./toneBanner";

it("keeps general danger and gank warning captions distinct", () => {
  expect(EVENT_THAI.danger).toBe("อันตราย!");
  expect(EVENT_THAI.gank).toBe("ระวังโดนรุม!");
});

it("gives gank the warning tone from its canonical category and priority", () => {
  expect(eventTone("gank")).toBe("warn");
});
