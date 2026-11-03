export type BannerMediaKind = "editable-template" | "baked-video" | "still-image";
export type BannerFileRole = "runtimeVideo" | "stillImage" | "supportingAsset";
export type BannerMediaType = "image/png" | "image/webp" | "image/jpeg" | "video/webm";
export type BannerOuterMotion = "outerOpacity" | "outerTranslateX" | "outerTranslateY" | "outerScale";
export type BannerLayerKind = "group" | "text" | "shape" | "image" | "svg" | "video";

export interface BannerAssetFile {
  id: string;
  path: `assets/${string}`;
  role: BannerFileRole;
  mediaType: BannerMediaType;
  sizeBytes: number;
  sha256: string;
}

export interface BannerTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
}

export interface BannerProjectAsset {
  /** Stable BannerProject identity used by layers; independent of the indexed file ID. */
  id: string;
  name: string;
  kind: "image";
  mime: "image/png" | "image/webp" | "image/jpeg";
  /** Managed package reference in the form asset:<BannerAssetFile.id>. */
  source: `asset:${string}`;
}

export interface BannerLayer {
  id: string;
  kind: BannerLayerKind;
  name: string;
  parentId: string | null;
  order: number;
  visible: boolean;
  locked: boolean;
  transform: BannerTransform;
  style: {
    fill?: string;
    stroke?: string;
    fontSize?: number;
    fontWeight?: number;
    fontFamily?: string;
    fontAssetId?: string;
  };
  content: { text?: string; assetId?: string };
  timing?: { startMs: number; endMs: number };
  motion?: { keyframes: Array<{ timeMs: number; transform: BannerTransform; easing: "linear" | "easeInOut" }> };
}

export interface BannerProject {
  schemaVersion: 1;
  id: string;
  title: string;
  eventId: string;
  artboard: { width: number; height: number; safeZonePreset: "dota-hud" | "none" };
  assets: BannerProjectAsset[];
  layers: BannerLayer[];
  revision: number;
}

export interface BannerAssetProvenance {
  application: string;
  version: string;
}

interface BannerManifestBase {
  format: "g-suite-banner-asset";
  schemaVersion: 1;
  assetId: string;
  revision: number;
  name: string;
  files: BannerAssetFile[];
  provenance?: BannerAssetProvenance;
}

export interface BakedVideoBannerManifest extends BannerManifestBase {
  mediaKind: "baked-video";
  silent: true;
  durationMs: number;
  editableControls: { title: false; outerMotion: BannerOuterMotion[] };
  template?: never;
}

export interface StillImageBannerManifest extends BannerManifestBase {
  mediaKind: "still-image";
  editableControls: { title: false; outerMotion: BannerOuterMotion[] };
  silent?: never;
  durationMs?: never;
  template?: never;
}

export interface EditableTemplateBannerManifest extends BannerManifestBase {
  mediaKind: "editable-template";
  editableControls: { title: true; outerMotion: BannerOuterMotion[] };
  template: { schemaVersion: 1; bannerProject: BannerProject };
  silent?: never;
  durationMs?: never;
}

export type BannerAssetManifest = BakedVideoBannerManifest | StillImageBannerManifest | EditableTemplateBannerManifest;

export declare const BANNER_ASSET_FORMAT: "g-suite-banner-asset";
export declare const BANNER_ASSET_VERSION: 1;
export declare const MAX_MANIFEST_BYTES: number;
export declare const MAX_FILES: number;
export declare const MAX_FILE_BYTES: number;
export declare const MAX_BUNDLE_BYTES: number;
export declare const MAX_RENDER_MS: number;
export declare function validateBannerAssetManifest(input: unknown): string[];
export declare function verifyBannerAssetFiles(manifest: unknown, suppliedFiles: Map<string, Uint8Array>, subtle?: SubtleCrypto): Promise<string[]>;
export declare function parseBannerAssetManifest(bytes: Uint8Array): { manifest: BannerAssetManifest | undefined; issues: string[] };
