// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { cloneDefaultOverlayLayout } from "../lib/overlayLayout";
import { OverlayModuleShelf } from "./OverlayModuleShelf";

afterEach(cleanup);

describe("OverlayModuleShelf", () => {
  it("renders all 19 registered HUD modules", () => {
    render(
      <OverlayModuleShelf
        layout={cloneDefaultOverlayLayout()}
        selectedId="alert"
        onSelect={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(screen.getByRole("list", { name: "HUD modules" }).querySelectorAll("li")).toHaveLength(19);
    expect(screen.getAllByRole("button").map((button) => button.textContent?.trim())).toEqual([
      "Danger alert", "G-Meter", "Voice notice", "Maiden", "Advice", "Buyback", "Enemy missing",
      "Event banner", "Low HP", "Volume", "Standby", "Clock", "K/D/A", "Gold", "GPM", "XPM",
      "Net worth", "Score", "HP / Mana",
    ]);
  });

  it("selects a row when its module button is pressed", () => {
    const onSelect = vi.fn();
    render(
      <OverlayModuleShelf
        layout={cloneDefaultOverlayLayout()}
        selectedId={null}
        onSelect={onSelect}
        onToggle={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "G-Meter" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("gmeter");
  });

  it("toggles a module without selecting its row", () => {
    const onSelect = vi.fn();
    const onToggle = vi.fn();
    render(
      <OverlayModuleShelf
        layout={cloneDefaultOverlayLayout()}
        selectedId="alert"
        onSelect={onSelect}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByRole("checkbox", { name: "Enable Clock" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("clock", false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("keeps disabled modules selectable", () => {
    const layout = cloneDefaultOverlayLayout();
    const onSelect = vi.fn();
    render(
      <OverlayModuleShelf layout={layout} selectedId={null} onSelect={onSelect} onToggle={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "HP / Mana" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("hero");
    expect((screen.getByRole("checkbox", { name: "Enable HP / Mana" }) as HTMLInputElement).checked).toBe(false);
  });
});
