// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import BannerEditor from "./BannerEditor";
import { createDefaultBannerProject } from "../lib/bannerProject";
import { useStudioStore } from "../store/useStudioStore";

describe("BannerEditor", () => {
  beforeEach(() => {
    useStudioStore.setState({
      bannerProject: createDefaultBannerProject(),
      pastBannerProjects: [],
      futureBannerProjects: [],
      selectedBannerLayerIds: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("renders the layer canvas and inspector entry points", () => {
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);

    expect(screen.getByText("Inspector")).toBeTruthy();
    expect(screen.getByRole("button", { name: "HUD layout" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Play event" })).toBeTruthy();
  });

  it("edits the selected layer through the inspector", () => {
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Event title" }));

    const nameInput = screen.getByLabelText("Layer name");
    fireEvent.change(nameInput, { target: { value: "Kill headline" } });

    expect(useStudioStore.getState().bannerProject.layers.find((layer) => layer.name === "Kill headline")).toBeTruthy();
  });

  it("groups two selected layers from the arrange rail", () => {
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Event title" }));
    fireEvent.click(screen.getByRole("button", { name: "Event subtitle" }), { shiftKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Group selected" }));

    const project = useStudioStore.getState().bannerProject;
    const group = project.layers.find((layer) => layer.kind === "group");
    expect(group).toBeTruthy();
    expect(project.layers.filter((layer) => layer.parentId === group?.id)).toHaveLength(2);
  });

  it("toggles visibility and locking from the layer tree", () => {
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Toggle Event title visibility" }));
    fireEvent.click(screen.getByRole("button", { name: "Toggle Event title lock" }));

    const title = useStudioStore.getState().bannerProject.layers.find((layer) => layer.name === "Event title");
    expect(title?.visible).toBe(false);
    expect(title?.locked).toBe(true);
  });

  it("records inspector edits for undo", () => {
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Event title" }));
    const nameInput = screen.getByLabelText("Layer name");
    fireEvent.focus(nameInput);
    fireEvent.change(nameInput, { target: { value: "Undo target" } });
    fireEvent.click(screen.getByTitle("Undo (Ctrl/Cmd+Z)"));

    expect(useStudioStore.getState().bannerProject.layers.find((layer) => layer.name === "Event title")).toBeTruthy();
  });

  it("edits optional layer timing in the inspector", () => {
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Event title" }));
    fireEvent.change(screen.getByLabelText("Start ms"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("End ms"), { target: { value: "2000" } });

    expect(useStudioStore.getState().bannerProject.layers.find((layer) => layer.name === "Event title")?.timing).toEqual({ startMs: 250, endMs: 2000 });
  });

  it("selects visible layers with a blank-canvas marquee", () => {
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);
    const stage = screen.getByTestId("banner-stage");
    Object.defineProperty(stage, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0, toJSON: () => ({}) }),
    });
    Object.defineProperty(stage, "setPointerCapture", { configurable: true, value: vi.fn() });

    fireEvent(stage, new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 35 }));
    fireEvent(stage, new MouseEvent("pointermove", { bubbles: true, clientX: 90, clientY: 65 }));
    fireEvent(stage, new MouseEvent("pointerup", { bubbles: true, clientX: 90, clientY: 65 }));

    expect(useStudioStore.getState().selectedBannerLayerIds).toHaveLength(3);
  });

  it("shows the event preview window when Play event is pressed", () => {
    vi.useFakeTimers();
    render(<BannerEditor onOpenHudLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Play event" }));

    expect(screen.getByText("Preview active for 3.5 seconds.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByText(/Canvas snaps to a 5% grid/)).toBeTruthy();
  });
});
