// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import { useStudioStore } from "./store/useStudioStore";
vi.mock("./lib/project", () => ({ initializeProject: () => Promise.resolve(null) }));
vi.mock("./lib/gidAuth", () => ({ restoreGidSession: vi.fn() }));
vi.mock("./components/Header", () => ({ default: () => <div>Header</div> }));
vi.mock("./components/StatusBar", () => ({ default: () => <div>Status</div> }));
vi.mock("./components/SoundLibrary", () => ({ default: () => <input aria-label="Library state" /> }));
vi.mock("./components/RightRail", () => ({ default: () => <input aria-label="Agent state" /> }));
vi.mock("./components/SourceView", () => ({ default: () => <input aria-label="Editor state" /> }));
vi.mock("./components/PackWorkflow", () => ({ default: () => null }));
vi.mock("./components/Settings", () => ({ default: () => null }));
vi.mock("./components/EventTestGrid", () => ({ default: () => null }));
vi.mock("./components/GameProfile", () => ({ default: () => null }));
vi.mock("./components/OverlayLab", () => ({ default: () => null }));
let resize: (entries: { contentRect: { width: number } }[]) => void;
class Observer { constructor(cb: typeof resize) { resize = cb; } observe() {} disconnect() {} }
vi.stubGlobal("ResizeObserver", Observer);
afterEach(cleanup);
it("keeps editor and rail state as measured width changes and drawers open", () => {
  useStudioStore.setState({ view: "studio" });
  render(<App />);
  act(() => resize([{ contentRect: { width: 1440 } }]));
  fireEvent.change(screen.getByLabelText("Editor state"), { target: { value: "unsaved" } });
  fireEvent.change(screen.getByLabelText("Agent state"), { target: { value: "chat" } });
  act(() => resize([{ contentRect: { width: 960 } }]));
  expect((screen.getByLabelText("Editor state") as HTMLInputElement).value).toBe("unsaved");
  fireEvent.click(screen.getByRole("button", { name: "Agent" }));
  expect((screen.getByLabelText("Agent state") as HTMLInputElement).value).toBe("chat");
  fireEvent.click(screen.getByRole("button", { name: "Assets" }));
  expect(screen.getByLabelText("Library state")).toBeTruthy();
  act(() => resize([{ contentRect: { width: 1440 } }]));
  expect((screen.getByLabelText("Editor state") as HTMLInputElement).value).toBe("unsaved");
});

it("returns focus to Agent when a resize closes its focused drawer", () => {
  useStudioStore.setState({ view: "studio" });
  render(<App />);
  act(() => resize([{ contentRect: { width: 1200 } }]));
  fireEvent.click(screen.getByRole("button", { name: "Agent" }));
  screen.getByLabelText("Agent state").focus();
  act(() => resize([{ contentRect: { width: 960 } }]));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "Agent" }));
});

it.each([
  { from: 1440, to: 1200, rail: "Agent state", button: "Agent" },
  { from: 1200, to: 960, rail: "Library state", button: "Assets" },
])("returns focus when a docked rail becomes a hidden drawer", ({from, to, rail, button}) => {
  useStudioStore.setState({ view: "studio" });
  render(<App />);
  act(() => resize([{ contentRect: { width: from } }]));
  screen.getByLabelText(rail).focus();
  act(() => resize([{ contentRect: { width: to } }]));
  expect(document.activeElement).toBe(screen.getByRole("button", { name: button }));
});
