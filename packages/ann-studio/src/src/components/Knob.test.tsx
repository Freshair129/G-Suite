// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import Knob from "./Knob";

afterEach(cleanup);

it("exposes a named keyboard slider with bounded values", () => {
  function Example() {
    const [value, setValue] = useState(0);
    return <Knob value={value} min={-100} max={100} label="Low" onChange={setValue} />;
  }
  render(<Example />);
  const slider = screen.getByRole("slider", { name: "Low" });
  slider.focus();
  expect(document.activeElement).toBe(slider);
  expect(slider.getAttribute("aria-valuenow")).toBe("0");
  fireEvent.keyDown(slider, { key: "ArrowUp" });
  expect(slider.getAttribute("aria-valuenow")).toBe("2");
  fireEvent.keyDown(slider, { key: "End" });
  expect(slider.getAttribute("aria-valuenow")).toBe("100");
  fireEvent.keyDown(slider, { key: "ArrowUp" });
  expect(slider.getAttribute("aria-valuenow")).toBe("100");
  fireEvent.keyDown(slider, { key: "Home" });
  expect(slider.getAttribute("aria-valuenow")).toBe("-100");
  fireEvent.keyDown(slider, { key: "ArrowRight" });
  expect(slider.getAttribute("aria-valuenow")).toBe("-98");
});

it("commits keyboard changes before updating, but not for a repeated key", () => {
  const calls: string[] = [];
  render(<Knob value={0} min={-100} max={100} label="Low" onKeyboardCommit={() => calls.push("commit")}
    onChange={(v) => calls.push(`change:${v}`)} />);
  const slider = screen.getByRole("slider", {name: "Low"});
  fireEvent.keyDown(slider, {key: "ArrowUp"});
  fireEvent.keyDown(slider, {key: "ArrowUp", repeat: true});
  expect(calls).toEqual(["commit", "change:2", "change:2"]);
  fireEvent.keyUp(slider, {key: "ArrowUp"});
  fireEvent.keyDown(slider, {key: "ArrowUp"});
  expect(calls.slice(-2)).toEqual(["commit", "change:2"]);
});

it("commits when the first observed key event is a repeat", () => {
  const calls: string[] = [];
  render(<Knob value={0} min={-100} max={100} label="Low" onKeyboardCommit={() => calls.push("commit")}
    onChange={() => calls.push("change")} />);
  fireEvent.keyDown(screen.getByRole("slider", {name: "Low"}), {key: "ArrowUp", repeat: true});
  expect(calls).toEqual(["commit", "change"]);
});
