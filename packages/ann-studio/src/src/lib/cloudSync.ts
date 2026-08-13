// @req GOE-005, NFR-004 — projects and author assets use the approved owner-only cloud projection.
// @spec SDD-001, SDD-004 — cloud authoring remains separate from local G-Maiden runtime sync.
// @designs docs/gann-cloud-threat-model.md
// @tested src/lib/cloudSync.test.ts
import { gidSupabase } from "./gidAuth";
import type { BannerAsset, BannerLayer, BannerProject } from "./bannerProject";

const MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
const ASSET_MAX_BYTES = 50 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set([
  "gsi", "match", "cv", "glog", "game", "telemetry", "steam", "steamid64",
  "recovery", "email", "phone", "auth", "gid", "gid_code", "source", "sourcepath", "wavpath",
]);
const ALLOWED_MIME = new Set([
  "image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "video/mp4", "video/webm",
]);

export type CloudAssetMetadata = {
  id: string;
  name: string;
  kind: BannerAsset["kind"];
  mime: string;
  byteSize: number;
  sha256: string;
};

export type CloudAssetManifest = CloudAssetMetadata;

export type CloudBannerProject = Omit<BannerProject, "assets" | "revision"> & {
  assets: CloudAssetManifest[];
  revision: number;
};

export type CloudValidationResult =
  | { ok: true; manifest: CloudBannerProject }
  | { ok: false; code: "invalid_project" | "invalid_asset" | "forbidden_data" | "manifest_too_large"; message: string };

export type CloudSyncResult =
  | { state: "synced"; revision: number }
  | { state: "conflict"; reason: "missing_base_revision" | "stale_revision" }
  | { state: "offline"; reason: "signed_out" | "network" }
  | { state: "failed"; message: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function containsForbiddenKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const child of value) {
      const key = containsForbiddenKey(child);
      if (key) return key;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (FORBIDDEN_KEYS.has(normalized)) return normalized;
    const childKey = containsForbiddenKey(child);
    if (childKey) return childKey;
  }
  return null;
}

function projectManifestLayer(layer: BannerLayer): CloudBannerProject["layers"][number] {
  const style = {
    ...(layer.style.fill !== undefined ? { fill: layer.style.fill } : {}),
    ...(layer.style.stroke !== undefined ? { stroke: layer.style.stroke } : {}),
    ...(layer.style.fontSize !== undefined ? { fontSize: layer.style.fontSize } : {}),
    ...(layer.style.fontWeight !== undefined ? { fontWeight: layer.style.fontWeight } : {}),
  };
  const content = {
    ...(layer.content.text !== undefined ? { text: layer.content.text } : {}),
    ...(layer.content.assetId !== undefined ? { assetId: layer.content.assetId } : {}),
  };
  const timing = layer.timing
    ? { startMs: layer.timing.startMs, endMs: layer.timing.endMs }
    : undefined;
  return {
    id: layer.id,
    kind: layer.kind,
    name: layer.name,
    parentId: layer.parentId,
    order: layer.order,
    visible: layer.visible,
    locked: layer.locked,
    transform: { ...layer.transform },
    style,
    content,
    ...(timing ? { timing } : {}),
  };
}

function validateAssetMetadata(asset: CloudAssetMetadata): string | null {
  if (!asset.id || !asset.name || !ALLOWED_MIME.has(asset.mime)) return "asset metadata is not allowlisted";
  if (!Number.isInteger(asset.byteSize) || asset.byteSize < 0 || asset.byteSize > ASSET_MAX_BYTES) return "asset exceeds the 50 MiB limit";
  if (!/^[0-9a-f]{64}$/.test(asset.sha256)) return "asset SHA-256 must be lowercase hexadecimal";
  return null;
}

/** Build the only project shape allowed to cross the authoring cloud boundary. */
export function projectToCloudManifest(
  project: BannerProject,
  metadata: Record<string, CloudAssetMetadata>,
  revision = project.revision,
): CloudValidationResult {
  if (project.schemaVersion !== 1 || !project.id || !project.title || !project.eventId || !Number.isInteger(revision) || revision < 1) {
    return { ok: false, code: "invalid_project", message: "BannerProject v1 and a positive revision are required" };
  }
  const forbidden = containsForbiddenKey({
    ...project,
    assets: project.assets.map(({ id, name, kind, mime }) => ({ id, name, kind, mime })),
  });
  if (forbidden) return { ok: false, code: "forbidden_data", message: `cloud manifest contains forbidden key: ${forbidden}` };
  if (![project.artboard.width, project.artboard.height].every(isFiniteNumber)) {
    return { ok: false, code: "invalid_project", message: "artboard dimensions must be finite" };
  }
  for (const layer of project.layers) {
    if (![layer.transform.x, layer.transform.y, layer.transform.width, layer.transform.height, layer.transform.rotation, layer.transform.opacity].every(isFiniteNumber)) {
      return { ok: false, code: "invalid_project", message: `layer ${layer.id} has a non-finite transform` };
    }
    if (layer.timing && (![layer.timing.startMs, layer.timing.endMs].every(isFiniteNumber) || layer.timing.startMs < 0 || layer.timing.endMs < layer.timing.startMs)) {
      return { ok: false, code: "invalid_project", message: `layer ${layer.id} has invalid timing` };
    }
  }
  const assets = project.assets.map((asset) => metadata[asset.id]);
  if (assets.some((asset) => !asset)) return { ok: false, code: "invalid_asset", message: "every local asset needs cloud metadata" };
  for (const asset of assets) {
    const error = validateAssetMetadata(asset);
    if (error) return { ok: false, code: "invalid_asset", message: error };
  }
  const manifest: CloudBannerProject = {
    schemaVersion: 1,
    id: project.id,
    title: project.title,
    eventId: project.eventId,
    artboard: { ...project.artboard },
    assets,
    layers: project.layers.map(projectManifestLayer),
    revision,
  };
  const serialized = JSON.stringify(manifest);
  if (new TextEncoder().encode(serialized).byteLength > MANIFEST_MAX_BYTES) {
    return { ok: false, code: "manifest_too_large", message: "cloud manifest exceeds the 2 MiB limit" };
  }
  return { ok: true, manifest };
}

/** Validate a manifest received from cloud before it can touch local state. */
export function validateCloudManifest(manifest: unknown): manifest is CloudBannerProject {
  if (!manifest || typeof manifest !== "object") return false;
  if (containsForbiddenKey(manifest)) return false;
  const candidate = manifest as Partial<CloudBannerProject>;
  if (candidate.schemaVersion !== 1 || typeof candidate.id !== "string" || typeof candidate.title !== "string" || typeof candidate.eventId !== "string") return false;
  if (!Number.isInteger(candidate.revision) || (candidate.revision ?? 0) < 1 || !Array.isArray(candidate.assets) || !Array.isArray(candidate.layers)) return false;
  if (!candidate.artboard || !isFiniteNumber(candidate.artboard.width) || !isFiniteNumber(candidate.artboard.height) || !["dota-hud", "none"].includes(candidate.artboard.safeZonePreset)) return false;
  if (new TextEncoder().encode(JSON.stringify(manifest)).byteLength > MANIFEST_MAX_BYTES) return false;
  if (!candidate.assets.every((asset) => !validateAssetMetadata(asset))) return false;
  const assetIds = new Set(candidate.assets.map((asset) => asset.id));
  return candidate.layers.every((layer) => {
    if (!layer || typeof layer !== "object" || typeof layer.id !== "string" || typeof layer.name !== "string") return false;
    if (!["group", "text", "shape", "image", "svg", "video"].includes(layer.kind)) return false;
    if (!(layer.parentId === null || typeof layer.parentId === "string") || !Number.isInteger(layer.order) || typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") return false;
    if (!layer.transform || !Object.values(layer.transform).every(isFiniteNumber)) return false;
    if (layer.content.assetId !== undefined && !assetIds.has(layer.content.assetId)) return false;
    return !layer.timing || (
      isFiniteNumber(layer.timing.startMs)
      && isFiniteNumber(layer.timing.endMs)
      && layer.timing.startMs >= 0
      && layer.timing.endMs >= layer.timing.startMs
    );
  });
}

export function decodeDataUrl(source: string): { mime: string; bytes: Uint8Array } | null {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(source);
  if (!match || !ALLOWED_MIME.has(match[1])) return null;
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return { mime: match[1], bytes };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Persist one project with optimistic concurrency. The caller supplies the last
 * cloud revision it observed; an existing row without that value is a conflict.
 * Asset rows are written before object bytes, and any failure leaves local state intact.
 */
export async function syncBannerProject(project: BannerProject, baseRevision?: number): Promise<CloudSyncResult> {
  const { data: { user }, error: userError } = await gidSupabase.auth.getUser();
  if (userError) return { state: "offline", reason: "network" };
  if (!user) return { state: "offline", reason: "signed_out" };

  const prepared: Array<{ asset: BannerAsset; bytes: Uint8Array; metadata: CloudAssetMetadata }> = [];
  for (const asset of project.assets) {
    const decoded = decodeDataUrl(asset.source);
    if (!decoded || decoded.mime !== asset.mime) return { state: "failed", message: `asset ${asset.id} is not a supported data URL` };
    if (decoded.bytes.byteLength > ASSET_MAX_BYTES) return { state: "failed", message: `asset ${asset.id} exceeds the 50 MiB limit` };
    prepared.push({
      asset,
      bytes: decoded.bytes,
      metadata: {
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        mime: asset.mime,
        byteSize: decoded.bytes.byteLength,
        sha256: await sha256Hex(decoded.bytes),
      },
    });
  }
  const existing = await gidSupabase.from("ann_projects").select("revision").eq("id", project.id).maybeSingle<{ revision: number }>();
  if (existing.error) return { state: "offline", reason: "network" };
  if (existing.data && baseRevision === undefined) return { state: "conflict", reason: "missing_base_revision" };
  if (existing.data && baseRevision !== existing.data.revision) return { state: "conflict", reason: "stale_revision" };
  const nextRevision = existing.data ? existing.data.revision + 1 : 1;
  const metadata = Object.fromEntries(prepared.map(({ metadata: item }) => [item.id, item]));
  const projected = projectToCloudManifest(project, metadata, nextRevision);
  if (!projected.ok) return { state: "failed", message: projected.message };

  const row = {
    id: project.id,
    owner_id: user.id,
    title: project.title,
    event_id: project.eventId,
    schema_version: 1,
    revision: nextRevision,
    project_json: projected.manifest,
  };
  const write = existing.data
    ? await gidSupabase.from("ann_projects").update({
      title: row.title,
      event_id: row.event_id,
      schema_version: row.schema_version,
      revision: row.revision,
      project_json: row.project_json,
    }).eq("id", project.id).eq("revision", baseRevision as number).is("deleted_at", null).select("revision").maybeSingle<{ revision: number }>()
    : await gidSupabase.from("ann_projects").insert(row).select("revision").maybeSingle<{ revision: number }>();
  if (write.error) return { state: "failed", message: write.error.message };
  if (!write.data) return { state: "conflict", reason: "stale_revision" };

  for (const { asset, bytes, metadata: item } of prepared) {
    const assetPayload = {
      id: asset.id,
      project_id: project.id,
      owner_id: user.id,
      name: item.name,
      kind: item.kind,
      mime: item.mime,
      byte_size: item.byteSize,
      sha256: item.sha256,
    };
    const insertedAsset = await gidSupabase.from("ann_project_assets").insert(assetPayload).select("object_path").maybeSingle<{ object_path: string }>();
    const assetRow = insertedAsset.error?.code === "23505"
      ? await gidSupabase.from("ann_project_assets").update({
        name: item.name,
        kind: item.kind,
        mime: item.mime,
        byte_size: item.byteSize,
        sha256: item.sha256,
      }).eq("id", asset.id).eq("project_id", project.id).select("object_path").maybeSingle<{ object_path: string }>()
      : insertedAsset;
    if (assetRow.error || !assetRow.data) return { state: "failed", message: assetRow.error?.message ?? "asset metadata write failed" };
    const upload = await gidSupabase.storage.from("ann-project-assets").upload(assetRow.data.object_path, bytes, {
      contentType: item.mime,
      upsert: true,
    });
    if (upload.error) return { state: "failed", message: upload.error.message };
  }
  return { state: "synced", revision: nextRevision };
}
