// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Header from "./Header";
import { useStudioStore } from "../store/useStudioStore";
vi.mock("@tauri-apps/api/core", () => ({ invoke: (command: string) => Promise.resolve(command === "list_ollama_models" ? [] : null) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => Promise.resolve(null) }));
vi.mock("../lib/gidAuth", () => ({ signInWithGoogle: async () => null, signOutGid: async () => {} }));
vi.mock("../lib/project", () => ({ saveProject: async () => "saved", openProject: async () => "opened" }));
vi.mock("../lib/actions", () => ({ runExport: async () => "exported" }));
vi.mock("../lib/importMedia", () => ({ importProjectMedia: async () => {} }));
vi.mock("./GannPackage", () => ({ default: () => null }));
afterEach(cleanup);
it("keeps primary actions and every navigation destination reachable through the menu", () => {
  useStudioStore.setState({ view: "studio", clips: [], wavPath: null });
  render(<Header />);
  expect(screen.getByRole("button", { name: "บันทึก" })).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "ทดสอบ" })[0]).toBeTruthy();
  expect(screen.getByRole("button", { name: "ส่งออก" })).toBeTruthy();
  fireEvent.click(screen.getByText("เมนู"));
  for (const label of ["เปิด .gann", "เปิดโปรเจกต์", "นำเข้าไฟล์", "สร้างแพ็ก", "Studio", "Profile", "Overlay Lab", "Settings"]) {
    expect(screen.getByRole("button", { name: label })).toBeTruthy();
  }
  fireEvent.click(screen.getByRole("button", { name: "Overlay Lab" }));
  expect(useStudioStore.getState().view).toBe("overlay");
});

it("returns focus to the menu after choosing a navigation action", () => {
  useStudioStore.setState({ view: "studio", clips: [], wavPath: null });
  render(<Header />);
  const menu = screen.getByLabelText("More actions");
  fireEvent.click(menu);
  const destination = screen.getByRole("button", { name: "Overlay Lab" });
  destination.focus();
  fireEvent.click(destination);
  expect(document.activeElement).toBe(menu);
});
