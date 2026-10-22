// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { cloneDefaultOverlayLayout } from "../lib/overlayLayout";
import { OverlayInspector } from "./OverlayInspector";

afterEach(cleanup);

const renderInspector = (
  selectedId: "alert" | "hero" = "alert",
  layout = cloneDefaultOverlayLayout(),
) => {
  const onCommit = vi.fn();
  const onPreview = vi.fn();
  const onGestureStart = vi.fn();
  const onGestureEnd = vi.fn();
  render(
    <OverlayInspector
      selectedId={selectedId}
      layout={layout}
      onCommit={onCommit}
      onPreview={onPreview}
      onGestureStart={onGestureStart}
      onGestureEnd={onGestureEnd}
    />,
  );
  return { onCommit, onPreview, onGestureStart, onGestureEnd };
};

describe("OverlayInspector", () => {
  it("commits valid numeric fields on Enter and blur", () => {
    const { onCommit } = renderInspector();
    const x = screen.getByLabelText("Position X (%)");
    fireEvent.change(x, { target: { value: "42.5" } });
    fireEvent.keyDown(x, { key: "Enter" });
    expect(onCommit).toHaveBeenNthCalledWith(1, "alert", { x: 42.5 });

    const y = screen.getByLabelText("Position Y (%)");
    fireEvent.change(y, { target: { value: "31.5" } });
    fireEvent.blur(y);
    expect(onCommit).toHaveBeenNthCalledWith(2, "alert", { y: 31.5 });
  });

  it.each([
    ["Position X (%)", ""],
    ["Position X (%)", "NaN"],
    ["Position X (%)", "Infinity"],
    ["Position X (%)", "-0.1"],
    ["Position X (%)", "100.1"],
    ["Position Y (%)", "-0.1"],
    ["Position Y (%)", "100.1"],
    ["Scale", "0.59"],
    ["Scale", "1.61"],
  ])("does not commit invalid %s value %j", (label, value) => {
    const { onCommit } = renderInspector();
    const input = screen.getByLabelText(label);
    fireEvent.change(input, { target: { value } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("leaves disabled modules editable in the inspector", () => {
    const layout = cloneDefaultOverlayLayout();
    expect(layout.hero.enabled).toBe(false);
    const { onCommit } = renderInspector("hero", layout);
    const x = screen.getByLabelText("Position X (%)");
    expect((x as HTMLInputElement).disabled).toBe(false);
    fireEvent.change(x, { target: { value: "42" } });
    fireEvent.keyDown(x, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith("hero", { x: 42 });
  });

  it("nudges X and Y by 0.1 or 1 percent once per arrow action", () => {
    const { onCommit } = renderInspector();
    const x = screen.getByLabelText("Position X (%)");
    const y = screen.getByLabelText("Position Y (%)");
    fireEvent.keyDown(x, { key: "ArrowUp" });
    fireEvent.keyDown(y, { key: "ArrowDown", shiftKey: true });

    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(onCommit).toHaveBeenNthCalledWith(1, "alert", { x: 50.1 });
    expect(onCommit).toHaveBeenNthCalledWith(2, "alert", { y: 19 });
  });

  it("previews scale while one slider gesture is active", () => {
    const { onCommit, onPreview, onGestureStart, onGestureEnd } = renderInspector();
    const scale = screen.getByLabelText("Scale slider");
    fireEvent.pointerDown(scale);
    fireEvent.change(scale, { target: { value: "1.25" } });
    fireEvent.pointerUp(scale);

    expect(onGestureStart).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledTimes(1);
    expect(onPreview).toHaveBeenCalledWith("alert", { scale: 1.25 });
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });
});
