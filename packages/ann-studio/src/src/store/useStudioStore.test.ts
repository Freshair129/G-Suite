import { beforeEach, describe, expect, it } from "vitest";
import { cloneBannerProject, createDefaultBannerProject } from "../lib/bannerProject";
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
