// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import MeterPanel from "./MeterPanel";

afterEach(cleanup);

it("exposes named channel faders and commits before keyboard changes", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const calls: string[] = [];
  render(<MeterPanel lufs={{m: -70, s: -70, i: -70, tp: -70}} playing={false}
    channels={{L: 0, R: 0, M: 0}} onCommit={() => calls.push("commit")}
    onChannel={(channel, value) => calls.push(`${channel}:${value}`)} />);
  const left = screen.getByRole("slider", {name: "L gain"});
  expect(left.getAttribute("aria-valuenow")).toBe("0");
  fireEvent.keyDown(left, {key: "ArrowUp"});
  expect(calls).toEqual(["commit", "L:0.5"]);
  fireEvent.keyDown(left, {key: "End"});
  expect(calls.slice(-2)).toEqual(["commit", "L:12"]);
  expect(screen.getByRole("slider", {name: "R gain"})).toBeTruthy();
  expect(screen.getByRole("slider", {name: "M gain"})).toBeTruthy();
});

it("keeps master gain above +12 dB within the accessible range", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const onChannel = vi.fn();
  render(<MeterPanel lufs={{m: -70, s: -70, i: -70, tp: -70}} playing={false}
    channels={{L: 0, R: 0, M: 24}} onCommit={() => {}} onChannel={onChannel} />);
  const master = screen.getByRole("slider", {name: "M gain"});
  expect(master.getAttribute("aria-valuemax")).toBe("24");
  fireEvent.keyDown(master, {key: "ArrowDown"});
  expect(onChannel).toHaveBeenCalledWith("M", 23.5);
});

it("commits when the first observed fader key event is a repeat", () => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  const calls: string[] = [];
  render(<MeterPanel lufs={{m: -70, s: -70, i: -70, tp: -70}} playing={false}
    channels={{L: 0, R: 0, M: 0}} onCommit={() => calls.push("commit")}
    onChannel={() => calls.push("change")} />);
  fireEvent.keyDown(screen.getByRole("slider", {name: "L gain"}), {key: "ArrowUp", repeat: true});
  expect(calls).toEqual(["commit", "change"]);
});
