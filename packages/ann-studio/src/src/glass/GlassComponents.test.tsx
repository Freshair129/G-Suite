// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlassButton, GlassPanel, GlassPill } from "./GlassComponents";
import GlassWorkbenchPreview from "./GlassWorkbenchPreview";

describe("Obsidian Glass opt-in components", () => {
  it("keeps an accessible label when the button is icon-only", () => {
    render(<GlassButton compact icon={<span aria-hidden="true">+</span>} aria-label="Add clip">Add clip</GlassButton>);
    expect(screen.getByRole("button", { name: "Add clip" }).getAttribute("title")).toBe("Add clip");
  });
  it("uses a disabled native button and preserves its click gate", () => {
    let hits = 0;
    render(<GlassButton disabled onClick={() => hits++}>Export</GlassButton>);
    fireEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(hits).toBe(0);
  });
  it("exposes panel content and status with semantic elements", () => {
    const { container } = render(<GlassPanel title="Events"><GlassPill tone="success">6 mapped</GlassPill></GlassPanel>);
    expect(container.querySelector("section")).not.toBeNull();
    expect(screen.getByText("6 mapped")).not.toBeNull();
  });
});

describe("isolated G-AnnStudio visual preview", () => {
  it("maps manually and shows the new selection without touching a real project", () => {
    render(<GlassWorkbenchPreview />);
    fireEvent.click(screen.getByRole("button", { name: /First Blood/i }));
    fireEvent.click(screen.getByRole("button", { name: /Map clip_03/i }));
    expect(screen.getByText(/Preview mapping: clip_03/)).not.toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("7");
  });
  it("keeps AI optional and exposes a narrow-mode assets toggle", () => {
    render(<GlassWorkbenchPreview />);
    const expand = screen.getByRole("button", { name: "Expand AI Copilot" });
    fireEvent.click(expand);
    expect(screen.getByRole("textbox", { name: "Sample AI command" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assets" }));
    expect(screen.getByRole("button", { name: "Assets" }).getAttribute("aria-expanded")).toBe("true");
  });
});
