// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { OverlayConflictItem } from "../lib/overlayLayout";
import { OverlayConflictList } from "./OverlayConflictList";

afterEach(cleanup);

const items: OverlayConflictItem[] = [
  { id: "clock-topbar", moduleId: "clock", kind: "blocked", message: "Clock overlaps Dota 2 top bar" },
  { id: "alert-killfeed", moduleId: "alert", kind: "transient", message: "Danger alert overlaps the kill banner" },
  { id: "toast-map", moduleId: "toast", kind: "accepted", message: "Voice notice overlap is accepted: passing over the map" },
  { id: "buyback-advice", moduleId: "buyback", otherModuleId: "advice", kind: "module", message: "Buyback overlaps Advice" },
];

describe("OverlayConflictList", () => {
  it("distinguishes the four conflict kinds and retains the paired module", () => {
    render(<OverlayConflictList items={items} onSelect={vi.fn()} />);

    expect(screen.getByRole("list", { name: "HUD overlap warnings" }).querySelectorAll("li")).toHaveLength(4);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("data-kind"))).toEqual([
      "blocked", "transient", "accepted", "module",
    ]);
    expect(screen.getByRole("button", { name: "Buyback overlaps Advice" }).getAttribute("data-other-module-id")).toBe("advice");
  });

  it("selects the primary module when each warning is clicked", () => {
    const onSelect = vi.fn();
    render(<OverlayConflictList items={items} onSelect={onSelect} />);

    screen.getAllByRole("button").forEach((button) => fireEvent.click(button));

    expect(onSelect.mock.calls).toEqual([["clock"], ["alert"], ["toast"], ["buyback"]]);
  });

  it("explains when there are no active overlap warnings", () => {
    render(<OverlayConflictList items={[]} onSelect={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toMatch(/No overlaps/);
  });
});
