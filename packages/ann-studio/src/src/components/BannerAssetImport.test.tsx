// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../lib/project", () => ({
  captureBannerAssetImportContext: vi.fn(),
  inspectBannerAssetArchive: vi.fn(),
  applyBannerAssetArchive: vi.fn(),
}));

import { open } from "@tauri-apps/plugin-dialog";
import { applyBannerAssetArchive, captureBannerAssetImportContext, inspectBannerAssetArchive } from "../lib/project";
import BannerAssetImport from "./BannerAssetImport";
import { useStudioStore } from "../store/useStudioStore";
import { createPackProject } from "../lib/packProject";

const preview = {
  manifest: {
    format: "g-suite-banner-asset" as const,
    schemaVersion: 1 as const,
    assetId: "champion-rise",
    revision: 4,
    name: "แชมป์ขึ้นจอ",
    mediaKind: "still-image" as const,
    editableControls: { title: false as const, outerMotion: ["outerOpacity" as const] },
    files: [{ id: "hero-image", path: "assets/champion.webp" as const, role: "stillImage" as const, mediaType: "image/webp" as const, sizeBytes: 4, sha256: "a".repeat(64) }],
  },
  manifestSha256: "b".repeat(64),
};

describe("BannerAssetImport", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
    vi.mocked(inspectBannerAssetArchive).mockReset();
    vi.mocked(applyBannerAssetArchive).mockReset();
    vi.mocked(open).mockResolvedValue("C:/design/banner.zip");
    vi.mocked(inspectBannerAssetArchive).mockResolvedValue(preview);
    vi.mocked(applyBannerAssetArchive).mockResolvedValue(true);
    const project=createPackProject();
    useStudioStore.setState({ projectDocument:project, projectGeneration:0, clips: [{ id: "clip-one", name: "เสียง First Blood", start: 0, end: 1, event: "first_blood", color: "#fff" }], selectedClipId: "clip-one" });
    vi.mocked(captureBannerAssetImportContext).mockReturnValue({projectId:project.projectId,announcerId:project.announcerId,generation:useStudioStore.getState().projectGeneration});
  });

  afterEach(cleanup);

  it("shows verified capabilities and waits for an explicit apply", async () => {
    render(<BannerAssetImport />);
    fireEvent.click(screen.getByRole("button", { name: /นำเข้า Banner Asset/ }));

    expect(await screen.findByRole("dialog", { name: /แชมป์ขึ้นจอ/ })).toBeTruthy();
    expect(screen.getByText(/ภาพนิ่ง.*แก้ข้อความต้นฉบับไม่ได้/)).toBeTruthy();
    expect(screen.getByText(/opacity/)).toBeTruthy();
    expect((screen.getByLabelText("คลิปปลายทาง") as HTMLSelectElement).value).toBe("clip-one");
    expect(applyBannerAssetArchive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "นำไปใช้กับคลิปนี้" }));
    await waitFor(() => expect(applyBannerAssetArchive).toHaveBeenCalledWith("C:/design/banner.zip", "b".repeat(64), "clip-one", expect.any(Object)));
    expect(await screen.findByText(/นำเข้าแบนเนอร์แล้ว/)).toBeTruthy();
  });

  it("wraps long Thai and English banner names inside the import dialog", async () => {
    const name = `${"ภาษาไทยยาวมาก ".repeat(12)}${"UnbrokenEnglishBannerName".repeat(8)}`;
    vi.mocked(inspectBannerAssetArchive).mockResolvedValue({
      ...preview,
      manifest: { ...preview.manifest, name },
    });

    render(<BannerAssetImport />);
    fireEvent.click(screen.getByRole("button", { name: /นำเข้า Banner Asset/ }));

    const heading = await screen.findByRole("heading", { name: `ตรวจสอบ Banner Asset: ${name}` });
    expect(heading.className).toContain("break-words");
    expect(heading.className).toContain("[overflow-wrap:anywhere]");
  });

  it("keeps Apply disabled when no voice variant is available", async () => {
    useStudioStore.setState({ clips: [], selectedClipId: null });
    render(<BannerAssetImport />);
    fireEvent.click(screen.getByRole("button", { name: /นำเข้า Banner Asset/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect((screen.getByRole("button", { name: "นำไปใช้กับคลิปนี้" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/เลือกคลิปเสียงที่ต้องการก่อน/)).toBeTruthy();
  });

  it("cancels preview without modifying the selected variant", async () => {
    render(<BannerAssetImport />);
    fireEvent.click(screen.getByRole("button", { name: /นำเข้า Banner Asset/ }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(applyBannerAssetArchive).not.toHaveBeenCalled();
  });

  it("keeps keyboard focus inside the dialog and returns it to the opener", async () => {
    render(<BannerAssetImport />);
    const opener = screen.getByRole("button", { name: /นำเข้า Banner Asset/ });
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog");
    const cancel = screen.getByRole("button", { name: "ยกเลิก" });
    const apply = screen.getByRole("button", { name: "นำไปใช้กับคลิปนี้" });
    const target = screen.getByLabelText("คลิปปลายทาง");
    expect(document.activeElement).toBe(cancel);

    apply.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(target);

    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(apply);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("keeps focus in the dialog while Apply is pending and restores the opener after success", async () => {
    let finishApply!: (value: boolean) => void;
    vi.mocked(applyBannerAssetArchive).mockReturnValue(new Promise(resolve => { finishApply = resolve; }));
    render(<BannerAssetImport />);
    const opener = screen.getByRole("button", { name: /นำเข้า Banner Asset/ });
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "นำไปใช้กับคลิปนี้" }));

    await waitFor(() => expect(applyBannerAssetArchive).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBe(dialog);

    finishApply(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("shows archive verification errors and does not apply invalid input", async () => {
    vi.mocked(inspectBannerAssetArchive).mockRejectedValue(new Error("SHA-256 mismatch"));
    render(<BannerAssetImport />);
    fireEvent.click(screen.getByRole("button", { name: /นำเข้า Banner Asset/ }));
    expect((await screen.findByRole("alert")).textContent).toContain("SHA-256 mismatch");
    expect(applyBannerAssetArchive).not.toHaveBeenCalled();
  });
});
