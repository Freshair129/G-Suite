import { describe, expect, it } from "vitest";
import { createDefaultBannerProject } from "./bannerProject";
import { canUseAuthoredBanner } from "./exportGmaidenPack";

describe("BannerProject Ann Pack priority", () => {
  it("uses the authored composition only for its selected event when animation is enabled", () => {
    const project = createDefaultBannerProject();

    expect(canUseAuthoredBanner(project, project.eventId, true)).toBe(true);
    expect(canUseAuthoredBanner(project, project.eventId, false)).toBe(false);
    expect(canUseAuthoredBanner(project, "death", true)).toBe(false);
  });
});
