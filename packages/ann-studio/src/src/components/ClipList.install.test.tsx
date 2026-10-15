// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import ClipList from "./ClipList";
import { useStudioStore } from "../store/useStudioStore";

const { invokeMock, autoMapEventsMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  autoMapEventsMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("../lib/llm", () => ({ autoMapEvents: autoMapEventsMock }));
vi.mock("./EventPicker", () => ({ default: () => null }));
vi.mock("./SaveToLibDialog", () => ({ default: () => null }));

const initialState = useStudioStore.getState();
const nativeAlert = window.alert;

function installReport(state: "accepted" | "rejected" | "unavailable") {
  return {
    pack_id: "pack-fixture",
    pack_dir: "C:\\ann-studio-fixture\\pack-fixture",
    events: 1,
    clips: 1,
    banners: 1,
    activation: {
      state,
      endpoint: "http://127.0.0.1:3000/announcer/install",
      http_status: state === "accepted" ? 200 : state === "rejected" ? 422 : null,
      detail: state === "accepted" ? null : `fixture ${state}`,
    },
  };
}

describe("ClipList G-Maiden install result flow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    autoMapEventsMock.mockReset();
    window.alert = vi.fn();
    useStudioStore.setState({
      wavPath: "C:\\fixtures\\standalone-audio-16k.wav",
      gmaidenPath: "C:\\ann-studio-fixture",
      gidSignedIn: false,
      clips: [{
        id: "clip-1",
        name: "Standalone fixture line",
        start: 0,
        end: 1,
        event: "first_blood",
        color: "#ffffff",
      }],
      bannerOverrides: {
        first_blood: { b64: "aGVsbG8=", ext: "png", mime: "image/png" },
      },
    });
  });

  afterEach(() => {
    cleanup();
    useStudioStore.setState(initialState, true);
    window.alert = nativeAlert;
  });

  it.each([
    ["accepted", "G-Maiden ยืนยันการเปิดใช้แพ็กแล้ว"],
    ["rejected", "G-Maiden ปฏิเสธการเปิดใช้"],
    ["unavailable", "ยังยืนยันการเปิดใช้จาก G-Maiden ไม่ได้"],
  ] as const)("sends through installGmaidenPack and displays %s", async (state, expectedMessage) => {
    invokeMock.mockResolvedValue(installReport(state));
    const { getByRole } = render(<ClipList />);

    fireEvent.click(getByRole("button", { name: "ส่ง G-Maiden" }));

    await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(1));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining(expectedMessage));
    if (state !== "accepted") {
      expect(window.alert).toHaveBeenCalledWith(expect.stringContaining("เขียนไฟล์แพ็กแล้ว"));
    }
    expect(invokeMock).toHaveBeenCalledWith(
      "install_gmaiden_pack",
      expect.objectContaining({
        endpoint: "http://127.0.0.1:3000/announcer/install",
        clips: [expect.objectContaining({ name: "Standalone fixture line", event: "first_blood" })],
      }),
    );
  });
});
