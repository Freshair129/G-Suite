// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cloneBannerProject, createDefaultBannerProject } from "../lib/bannerProject";
import { cloneDefaultOverlayLayout } from "../lib/overlayLayout";
import { useStudioStore } from "./useStudioStore";

describe("BannerProject store history", () => {
  beforeEach(() => {
    const project = createDefaultBannerProject();
    useStudioStore.setState({ bannerProject: project, pastBannerProjects: [], futureBannerProjects: [], selectedBannerLayerIds: [] });
  });

  it("undoes and redoes a project edit as one history action", () => {
    const initial = cloneBannerProject(useStudioStore.getState().bannerProject);

    useStudioStore.getState().setBannerProject({ ...initial, title: "Kill banner" });
    expect(useStudioStore.getState().bannerProject.title).toBe("Kill banner");

    useStudioStore.getState().undoBannerProject();
    expect(useStudioStore.getState().bannerProject.title).toBe(initial.title);

    useStudioStore.getState().redoBannerProject();
    expect(useStudioStore.getState().bannerProject.title).toBe("Kill banner");
  });

  it("keeps silent pointer updates out of the history stack", () => {
    const initial = cloneBannerProject(useStudioStore.getState().bannerProject);
    useStudioStore.getState().pushBannerProjectHistory();
    useStudioStore.getState().setBannerProjectSilent({ ...initial, layers: initial.layers.map((layer) => ({ ...layer, transform: { ...layer.transform, x: 60 } })) });

    expect(useStudioStore.getState().pastBannerProjects).toHaveLength(1);
    useStudioStore.getState().undoBannerProject();
    expect(useStudioStore.getState().bannerProject.layers[0].transform.x).toBe(50);
  });
});

describe("OverlayLayout store history", () => {
  beforeEach(() => {
    localStorage.clear();
    useStudioStore.setState({
      overlayLayout: cloneDefaultOverlayLayout(),
      pastOverlayLayouts: [],
      futureOverlayLayouts: [],
    } as unknown as Parameters<typeof useStudioStore.setState>[0]);
  });

  it("records_and_undoes_an_atomic_overlay_layout_edit", () => {
    const initial = cloneDefaultOverlayLayout();
    const edited = { ...initial, alert: { ...initial.alert, x: 47 } };

    useStudioStore.getState().setOverlayLayout(edited);
    useStudioStore.getState().setOverlayLayout(edited);

    expect(useStudioStore.getState().overlayLayout).toEqual(edited);
    expect(useStudioStore.getState().pastOverlayLayouts).toEqual([initial]);
    const persisted = JSON.parse(localStorage.getItem("gann-preferences") ?? "{}") as {
      state?: { pastOverlayLayouts?: unknown[]; futureOverlayLayouts?: unknown[] };
    };
    expect(persisted.state?.pastOverlayLayouts).toBeUndefined();
    expect(persisted.state?.futureOverlayLayouts).toBeUndefined();

    useStudioStore.getState().undoOverlayLayout();
    expect(useStudioStore.getState().overlayLayout).toEqual(initial);
    expect(useStudioStore.getState().futureOverlayLayouts).toEqual([edited]);

    useStudioStore.getState().redoOverlayLayout();
    expect(useStudioStore.getState().overlayLayout).toEqual(edited);
    expect(useStudioStore.getState().pastOverlayLayouts).toEqual([initial]);
    expect(useStudioStore.getState().futureOverlayLayouts).toEqual([]);
  });

  it("caps_overlay_history_at_100_and_clears_redo_after_a_new_edit", () => {
    for (let x = 1; x <= 105; x += 1) {
      const layout = useStudioStore.getState().overlayLayout;
      useStudioStore.getState().setOverlayLayout({
        ...layout,
        alert: { ...layout.alert, x: x % 100 },
      });
    }

    expect(useStudioStore.getState().pastOverlayLayouts).toHaveLength(100);

    useStudioStore.getState().undoOverlayLayout();
    expect(useStudioStore.getState().futureOverlayLayouts).toHaveLength(1);

    const layout = useStudioStore.getState().overlayLayout;
    useStudioStore.getState().setOverlayLayout({ ...layout, alert: { ...layout.alert, x: 44 } });
    expect(useStudioStore.getState().futureOverlayLayouts).toEqual([]);
  });

  it("keeps_overlay_history_separate_from_banner_history", () => {
    const initialOverlay = cloneDefaultOverlayLayout();
    const initialBanner = cloneBannerProject(useStudioStore.getState().bannerProject);
    useStudioStore.getState().setBannerProject({ ...initialBanner, title: "Test banner" });

    useStudioStore.getState().setOverlayLayout({
      ...initialOverlay,
      alert: { ...initialOverlay.alert, x: 47 },
    });

    expect(useStudioStore.getState().pastBannerProjects).toEqual([initialBanner]);
    useStudioStore.getState().undoBannerProject();
    expect(useStudioStore.getState().bannerProject.title).toBe(initialBanner.title);
    expect(useStudioStore.getState().overlayLayout.alert.x).toBe(47);
    expect(useStudioStore.getState().pastOverlayLayouts).toHaveLength(1);

    useStudioStore.getState().undoOverlayLayout();
    expect(useStudioStore.getState().overlayLayout).toEqual(initialOverlay);
    expect(useStudioStore.getState().bannerProject.title).toBe(initialBanner.title);
    expect(useStudioStore.getState().pastBannerProjects).toEqual([]);
  });

  it("keeps_legacy_localStorage_documents_out_of_the_native_project", async () => {
    const legacyLayout = cloneDefaultOverlayLayout();
    legacyLayout.alert.x = 47;
    localStorage.setItem(
      "gann-project",
      JSON.stringify({ state: { overlayLayout: legacyLayout }, version: 1 }),
    );

    await vi.resetModules();
    const { useStudioStore: rehydratedStore } = await import("./useStudioStore");
    await rehydratedStore.persist.rehydrate();

    expect(rehydratedStore.getState().overlayLayout).toEqual(cloneDefaultOverlayLayout());
    expect(rehydratedStore.getState().pastOverlayLayouts).toEqual([]);
    expect(rehydratedStore.getState().futureOverlayLayouts).toEqual([]);
  });
});
