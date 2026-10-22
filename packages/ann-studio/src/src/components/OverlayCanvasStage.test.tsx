// @vitest-environment jsdom
import { afterEach, beforeEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { cloneDefaultOverlayLayout, type OverlayLayout } from "../lib/overlayLayout";
import { useStudioStore } from "../store/useStudioStore";
import { OverlayCanvasStage } from "./OverlayCanvasStage";

afterEach(cleanup);

beforeAll(() => {
  class TestPointerEvent extends MouseEvent {
    pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  }
  Object.defineProperty(window, "PointerEvent", { configurable: true, value: TestPointerEvent });
});

beforeEach(() => {
  localStorage.clear();
  useStudioStore.setState({
    overlayLayout: cloneDefaultOverlayLayout(),
    pastOverlayLayouts: [],
    futureOverlayLayouts: [],
  } as unknown as Parameters<typeof useStudioStore.setState>[0]);
});

const stageRect = {
  left: 0,
  top: 0,
  right: 1000,
  bottom: 562.5,
  width: 1000,
  height: 562.5,
  x: 0,
  y: 0,
  toJSON: () => ({}),
} as DOMRect;

function setStageRect() {
  Object.defineProperty(screen.getByTestId("overlay-canvas-stage"), "getBoundingClientRect", {
    configurable: true,
    value: () => stageRect,
  });
}

function StoreHarness({ onCancel }: { onCancel?: () => void } = {}) {
  const layout = useStudioStore((state) => state.overlayLayout);
  const [previewLayout, setPreviewLayout] = useState<OverlayLayout | null>(null);
  return (
    <OverlayCanvasStage
      layout={layout}
      previewLayout={previewLayout}
      selectedId="alert"
      screen="ingame"
      screenshotUrl={null}
      previewActive={false}
      onSelect={vi.fn()}
      onPreviewLayout={setPreviewLayout}
      onGestureCommit={(next) => {
        useStudioStore.getState().setOverlayLayout(next);
        setPreviewLayout(null);
      }}
      onGestureCancel={() => {
        setPreviewLayout(null);
        onCancel?.();
      }}
    />
  );
}

describe("OverlayCanvasStage", () => {
  it("selects the module when its canvas target is pressed", () => {
    const onSelect = vi.fn();
    render(
      <OverlayCanvasStage
        layout={cloneDefaultOverlayLayout()}
        previewLayout={null}
        selectedId={null}
        screen="ingame"
        screenshotUrl={null}
        previewActive={false}
        onSelect={onSelect}
        onPreviewLayout={vi.fn()}
        onGestureCommit={vi.fn()}
        onGestureCancel={vi.fn()}
      />,
    );
    setStageRect();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Select Danger alert module" }), {
      pointerId: 4,
      button: 0,
      clientX: 500,
      clientY: 112.5,
    });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("alert");
  });

  it("commits one history entry after a completed move gesture", () => {
    const initial = cloneDefaultOverlayLayout();
    render(<StoreHarness />);
    setStageRect();
    const stage = screen.getByTestId("overlay-canvas-stage");
    const target = screen.getByRole("button", { name: "Select Danger alert module" });

    fireEvent.pointerDown(target, { pointerId: 9, button: 0, clientX: 500, clientY: 112.5 });
    fireEvent.pointerMove(stage, { pointerId: 9, clientX: 550, clientY: 140 });
    expect(useStudioStore.getState().overlayLayout).toEqual(initial);
    expect(useStudioStore.getState().pastOverlayLayouts).toEqual([]);

    fireEvent.pointerUp(stage, { pointerId: 9, clientX: 550, clientY: 140 });

    expect(useStudioStore.getState().overlayLayout.alert).toEqual({ ...initial.alert, x: 55, y: 24.9 });
    expect(useStudioStore.getState().pastOverlayLayouts).toEqual([initial]);
  });

  it("discards a canceled move without a store edit", () => {
    const initial = cloneDefaultOverlayLayout();
    const onCancel = vi.fn();
    render(<StoreHarness onCancel={onCancel} />);
    setStageRect();
    const stage = screen.getByTestId("overlay-canvas-stage");
    fireEvent.pointerDown(screen.getByRole("button", { name: "Select Danger alert module" }), {
      pointerId: 3,
      button: 0,
      clientX: 500,
      clientY: 112.5,
    });
    fireEvent.pointerMove(stage, { pointerId: 3, clientX: 540, clientY: 130 });
    expect(useStudioStore.getState().overlayLayout).toEqual(initial);
    fireEvent.pointerCancel(stage, { pointerId: 3 });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(useStudioStore.getState().overlayLayout).toEqual(initial);
    expect(useStudioStore.getState().pastOverlayLayouts).toEqual([]);
  });

  it("resizes uniformly while preserving the module center", () => {
    const initial = cloneDefaultOverlayLayout();
    const onGestureCommit = vi.fn();
    render(
      <OverlayCanvasStage
        layout={initial}
        previewLayout={null}
        selectedId="alert"
        screen="ingame"
        screenshotUrl={null}
        previewActive={false}
        onSelect={vi.fn()}
        onPreviewLayout={vi.fn()}
        onGestureCommit={onGestureCommit}
        onGestureCancel={vi.fn()}
      />,
    );
    setStageRect();
    const stage = screen.getByTestId("overlay-canvas-stage");
    const handle = screen.getByRole("button", { name: "Resize Danger alert module" });
    fireEvent.pointerDown(handle, { pointerId: 5, button: 0, clientX: 610, clientY: 123 });
    fireEvent.pointerUp(stage, { pointerId: 5, clientX: 650, clientY: 123 });

    const committed = onGestureCommit.mock.calls[0][0] as OverlayLayout;
    expect(onGestureCommit).toHaveBeenCalledTimes(1);
    expect(committed.alert.x).toBe(initial.alert.x);
    expect(committed.alert.y).toBe(initial.alert.y);
    expect(committed.alert.scale).toBeGreaterThan(1);
    expect(committed.alert.scale).toBeLessThanOrEqual(1.6);
  });
});
