import { describe, expect, it } from "vitest";
import { createBannerLayer, createDefaultBannerProject } from "./bannerProject";
import {
  decodeDataUrl,
  projectToCloudManifest,
  sha256Hex,
  validateCloudManifest,
  type CloudAssetMetadata,
} from "./cloudSync";

const metadata: CloudAssetMetadata = {
  id: "asset-1",
  name: "banner.png",
  kind: "image",
  mime: "image/png",
  byteSize: 3,
  sha256: "a".repeat(64),
};

function projectWithAsset() {
  const project = createDefaultBannerProject();
  project.assets = [{ id: metadata.id, name: metadata.name, kind: metadata.kind, mime: metadata.mime, source: "data:image/png;base64,AQID" }];
  project.layers.push(createBannerLayer("image", 3, { content: { assetId: metadata.id } }));
  return project;
}

describe("private cloud project projection", () => {
  it("strips local asset sources while preserving allowlisted metadata", () => {
    const result = projectToCloudManifest(projectWithAsset(), { [metadata.id]: metadata });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.assets[0]).toEqual(metadata);
    expect(JSON.stringify(result.manifest)).not.toContain("data:image");
    expect(result.manifest.layers[result.manifest.layers.length - 1]?.content).toEqual({ assetId: metadata.id });
  });

  it("rejects forbidden keys nested in a layer payload", () => {
    const project = projectWithAsset();
    (project.layers[0].content as Record<string, unknown>).gsi = { player: "secret" };
    const result = projectToCloudManifest(project, { [metadata.id]: metadata });
    expect(result).toMatchObject({ ok: false, code: "forbidden_data" });
  });

  it("requires metadata for every local asset", () => {
    const result = projectToCloudManifest(projectWithAsset(), {});
    expect(result).toMatchObject({ ok: false, code: "invalid_asset" });
  });

  it("rejects non-allowlisted MIME and malformed hashes", () => {
    const result = projectToCloudManifest(projectWithAsset(), {
      [metadata.id]: { ...metadata, mime: "application/json", sha256: "bad" },
    });
    expect(result).toMatchObject({ ok: false, code: "invalid_asset" });
  });

  it("rejects invalid layer timing before upload", () => {
    const project = projectWithAsset();
    project.layers[0].timing = { startMs: 500, endMs: 100 };
    const result = projectToCloudManifest(project, { [metadata.id]: metadata });
    expect(result).toMatchObject({ ok: false, code: "invalid_project" });
  });

  it("rejects forbidden keys in a cloud response", () => {
    const manifest = projectToCloudManifest(projectWithAsset(), { [metadata.id]: metadata });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    const unsafe = { ...manifest.manifest, layers: [{ ...manifest.manifest.layers[0], content: { source: "C:\\secret" } }] };
    expect(validateCloudManifest(unsafe)).toBe(false);
    expect(validateCloudManifest(manifest.manifest)).toBe(true);
  });

  it("rejects cloud layers that reference an unknown asset", () => {
    const manifest = projectToCloudManifest(projectWithAsset(), { [metadata.id]: metadata });
    expect(manifest.ok).toBe(true);
    if (!manifest.ok) return;
    const unsafe = { ...manifest.manifest, layers: [{ ...manifest.manifest.layers[0], content: { assetId: "missing" } }] };
    expect(validateCloudManifest(unsafe)).toBe(false);
  });

  it("accepts only allowlisted base64 data URLs", () => {
    expect(decodeDataUrl("data:image/png;base64,AQID")).toEqual({ mime: "image/png", bytes: new Uint8Array([1, 2, 3]) });
    expect(decodeDataUrl("data:text/plain;base64,SGk=")).toBeNull();
    expect(decodeDataUrl("https://example.com/banner.png")).toBeNull();
  });

  it("computes a deterministic SHA-256 for upload metadata", async () => {
    expect(await sha256Hex(new Uint8Array([1, 2, 3]))).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
  });
});
