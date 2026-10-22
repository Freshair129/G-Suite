// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cloneDefaultOverlayLayout, OVERLAY_MODULE_IDS } from "../lib/overlayLayout";
import { useStudioStore } from "../store/useStudioStore";
import OverlayLab from "./OverlayLab";

const { syncOverlayLayoutMock, setLabScreenshotMock, restoreLabScreenshotMock } = vi.hoisted(() => ({
  syncOverlayLayoutMock: vi.fn(),
  setLabScreenshotMock: vi.fn(),
  restoreLabScreenshotMock: vi.fn(),
}));

vi.mock("../lib/overlayLayout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/overlayLayout")>();
  return { ...actual, syncOverlayLayout: syncOverlayLayoutMock };
});

vi.mock("../lib/labView", () => ({
  labView: { eventId: "first_blood", screenUrl: null, surface: "hud" },
  restoreLabScreenshot: restoreLabScreenshotMock,
  setLabEventId: vi.fn(),
  setLabScreenshot: setLabScreenshotMock,
  setLabSurface: vi.fn(),
}));

vi.mock("../lib/toneBanner", () => ({ toneBannerPngDataUrl: () => "data:image/png;base64,AA==" }));

vi.mock("./OverlayCanvasStage", () => ({
  OverlayCanvasStage: () => <div aria-label="HUD canvas preview" />,
}));

vi.mock("./BannerEditor", () => ({ default: () => <div>Banner editor</div> }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  localStorage.removeItem("gann-project");
  useStudioStore.setState({
    overlayLayout: cloneDefaultOverlayLayout(),
    pastOverlayLayouts: [],
    futureOverlayLayouts: [],
    bannerOverrides: {},
  });
  restoreLabScreenshotMock.mockResolvedValue(null);
  setLabScreenshotMock.mockResolvedValue("blob:local-capture");
  syncOverlayLayoutMock.mockResolvedValue({ ok: true });
});

function editAlertX(value: string) {
  const field = screen.getByRole("textbox", { name: "Position X (%)" });
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
}

describe("OverlayLab HUD draft workflow", () => {
  it("keeps a fresh draft unverified and does not sync edits, preview, screenshot, or restore", async () => {
    render(<OverlayLab />);
    expect(screen.getByTestId("sync-status").textContent).toMatch(/unverified this session/i);
    expect(screen.getByRole("button", { name: "Undo layout" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "Redo layout" }).hasAttribute("disabled")).toBe(true);

    editAlertX("52");
    expect(useStudioStore.getState().overlayLayout.alert.x).toBe(52);
    expect(screen.getByRole("button", { name: "Undo layout" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Undo layout" }));
    expect(useStudioStore.getState().overlayLayout.alert.x).toBe(50);
    expect(screen.getByRole("button", { name: "Redo layout" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Redo layout" }));
    expect(useStudioStore.getState().overlayLayout.alert.x).toBe(52);

    fireEvent.click(screen.getByRole("button", { name: "Play event" }));
    const screenshot = new File(["local image"], "capture.png", { type: "image/png" });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [screenshot] } });
    await waitFor(() => expect(setLabScreenshotMock).toHaveBeenCalledWith(screenshot));
    fireEvent.click(screen.getByRole("button", { name: "Restore default" }));

    expect(useStudioStore.getState().overlayLayout.alert.x).toBe(50);
    expect(screen.getByRole("button", { name: "Undo layout" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Undo layout" }));
    expect(useStudioStore.getState().overlayLayout.alert.x).toBe(52);
    expect(syncOverlayLayoutMock).not.toHaveBeenCalled();
  });

  it("sends the complete layout only after explicit Sync and reports the saved layout", async () => {
    render(<OverlayLab />);
    editAlertX("53");

    fireEvent.click(screen.getByRole("button", { name: "Sync to G-Maiden" }));

    await waitFor(() => expect(syncOverlayLayoutMock).toHaveBeenCalledTimes(1));
    const [payload] = syncOverlayLayoutMock.mock.calls[0];
    expect(Object.keys(payload)).toHaveLength(OVERLAY_MODULE_IDS.length);
    expect(payload.alert.x).toBe(53);
    expect(payload).not.toHaveProperty("screenshot");
    expect(payload).not.toHaveProperty("screenUrl");
    expect(screen.getByTestId("sync-status").textContent).toMatch(/saved the layout and notified the overlay/i);

    editAlertX("54");
    expect(screen.getByTestId("sync-status").textContent).toMatch(/draft changed.*not been verified/i);
  });

  it("shows sync rejection and retains the draft plus undo history", async () => {
    render(<OverlayLab />);
    editAlertX("61");
    const draftBeforeSync = useStudioStore.getState().overlayLayout;
    const historyBeforeSync = useStudioStore.getState().pastOverlayLayouts;
    // Tauri's invoke rejects a Rust Result<String> as the string value itself.
    syncOverlayLayoutMock.mockRejectedValueOnce("G-Maiden offline");

    fireEvent.click(screen.getByRole("button", { name: "Sync to G-Maiden" }));

    await waitFor(() => expect(screen.getByTestId("sync-status").textContent).toMatch(/G-Maiden offline/));
    expect(useStudioStore.getState().overlayLayout).toEqual(draftBeforeSync);
    expect(useStudioStore.getState().pastOverlayLayouts).toEqual(historyBeforeSync);
    expect(screen.getByRole("button", { name: "Undo layout" }).hasAttribute("disabled")).toBe(false);
  });
});
