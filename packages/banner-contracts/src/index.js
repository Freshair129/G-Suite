export const BANNER_ASSET_FORMAT = "g-suite-banner-asset";
export const BANNER_ASSET_VERSION = 1;
export const MAX_MANIFEST_BYTES = 1024 * 1024;
export const MAX_FILES = 64;
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 512 * 1024 * 1024;
export const MAX_RENDER_MS = 18_200;

const HEX_SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const SAFE_FILE = /^assets\/[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/;
const WINDOWS_DEVICES = new Set(["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$", ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`), "COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³"]);
const MEDIA = new Set(["image/png", "image/webp", "image/jpeg", "video/webm"]);
const KINDS = new Set(["editable-template", "baked-video", "still-image"]);
const ROLES = new Set(["runtimeVideo", "stillImage", "supportingAsset"]);
const VIDEO_MOTION = new Set(["outerOpacity", "outerTranslateX", "outerTranslateY", "outerScale"]);
const LAYER_KINDS = new Set(["group", "text", "shape", "image", "svg", "video"]);
const TRANSFORM_KEYS = new Set(["x", "y", "width", "height", "rotation", "opacity"]);
function validTransform(value) {
  if (!isRecord(value) || Object.keys(value).some((key) => !TRANSFORM_KEYS.has(key)) || Object.keys(value).length !== TRANSFORM_KEYS.size) return false;
  return Number.isFinite(value.x) && value.x >= 0 && value.x <= 100
    && Number.isFinite(value.y) && value.y >= 0 && value.y <= 100
    && Number.isFinite(value.width) && value.width >= 2 && value.width <= 100
    && Number.isFinite(value.height) && value.height >= 2 && value.height <= 100
    && Number.isFinite(value.rotation) && value.rotation >= -180 && value.rotation <= 180
    && Number.isFinite(value.opacity) && value.opacity >= 0 && value.opacity <= 1;
}
function rejectUnknown(value, keys, path, issue) {
  if (isRecord(value)) for (const key of Object.keys(value)) if (!keys.has(key)) issue(path, `unknown property ${key}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringLength(value) {
  return Array.from(value).length;
}

/** Pure contract validation shared by producers and importers; returns all readable issues. */
export function validateBannerAssetManifest(input) {
  const issues = [];
  const issue = (path, message) => issues.push(`${path}: ${message}`);
  if (!isRecord(input)) return ["manifest: expected an object"];
  if (input.format !== BANNER_ASSET_FORMAT) issue("format", "unsupported banner asset format");
  rejectUnknown(input, new Set(["format", "schemaVersion", "assetId", "revision", "name", "mediaKind", "silent", "durationMs", "editableControls", "template", "files", "provenance"]), "manifest", issue);
  if (input.schemaVersion !== BANNER_ASSET_VERSION) issue("schemaVersion", "unsupported schema version");
  if (typeof input.assetId !== "string" || !SAFE_ID.test(input.assetId) || input.assetId.trim() !== input.assetId) issue("assetId", "expected a stable ASCII identifier");
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) issue("revision", "expected a positive safe integer");
  if (typeof input.name !== "string" || !input.name.trim() || stringLength(input.name) > 120) issue("name", "expected 1–120 characters");
  if (!KINDS.has(input.mediaKind)) issue("mediaKind", "unknown asset kind");
  if (!isRecord(input.editableControls)) issue("editableControls", "expected an object");
  else {
    rejectUnknown(input.editableControls, new Set(["title", "outerMotion"]), "editableControls", issue);
    if (typeof input.editableControls.title !== "boolean") issue("editableControls.title", "expected a boolean");
    if (!Array.isArray(input.editableControls.outerMotion)) issue("editableControls.outerMotion", "expected an array");
  }
  if (!Array.isArray(input.files) || input.files.length > MAX_FILES) {
    issue("files", `expected an array with at most ${MAX_FILES} entries`);
    return issues;
  }

  const paths = new Set();
  const fileIds = new Set();
  const roles = new Map();
  let totalBytes = 0;
  for (const [index, file] of input.files.entries()) {
    const path = `files[${index}]`;
    if (!isRecord(file)) { issue(path, "expected an object"); continue; }
    rejectUnknown(file, new Set(["id", "path", "role", "mediaType", "sizeBytes", "sha256"]), path, issue);
    if (typeof file.id !== "string" || !SAFE_ID.test(file.id)) issue(`${path}.id`, "expected a stable ASCII identifier");
    else if (fileIds.has(file.id)) issue(`${path}.id`, "duplicate file ID");
    else fileIds.add(file.id);
    if (typeof file.path !== "string" || !SAFE_FILE.test(file.path) || file.path.trim() !== file.path || file.path.includes("..") || file.path.endsWith(".")) issue(`${path}.path`, "expected a safe relative assets/<filename> path");
    else {
      const filename = file.path.slice("assets/".length);
      const windowsDeviceName = filename.split(".")[0].toUpperCase();
      if (WINDOWS_DEVICES.has(windowsDeviceName)) issue(`${path}.path`, "Windows-safe filenames exclude reserved device names");
      const foldedPath = file.path.toUpperCase();
      if (paths.has(foldedPath)) issue(`${path}.path`, "duplicate or case-insensitive Windows path alias");
      else paths.add(foldedPath);
    }
    if (!ROLES.has(file.role)) issue(`${path}.role`, "invalid role");
    else roles.set(file.role, (roles.get(file.role) ?? 0) + 1);
    if (!MEDIA.has(file.mediaType)) issue(`${path}.mediaType`, "unsupported media type");
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 1 || file.sizeBytes > MAX_FILE_BYTES) issue(`${path}.sizeBytes`, `expected 1–${MAX_FILE_BYTES} bytes`);
    else totalBytes += file.sizeBytes;
    if (!HEX_SHA256.test(file.sha256 ?? "")) issue(`${path}.sha256`, "expected lowercase SHA-256 hex");
  }
  if (totalBytes > MAX_BUNDLE_BYTES) issue("files", `combined files exceed ${MAX_BUNDLE_BYTES} bytes`);

  const runtimeVideo = input.mediaKind === "baked-video";
  const still = input.mediaKind === "still-image";
  if (runtimeVideo) {
    if (input.files.length === 0) issue("files", "baked-video requires a runtime file");
    if (roles.get("runtimeVideo") !== 1) issue("files", "baked-video requires exactly one runtimeVideo");
    if (input.files.some((file) => file?.role === "stillImage")) issue("files", "baked-video cannot contain stillImage role entries");
    if (input.files.some((file) => file?.role === "runtimeVideo" && file.mediaType !== "video/webm")) issue("files", "runtimeVideo must use silent video/webm");
    if (input.files.some((file) => file?.role === "supportingAsset" && !["image/png", "image/webp", "image/jpeg"].includes(file.mediaType))) issue("files", "supportingAsset must be PNG, WebP or JPEG");
    if (input.silent !== true) issue("silent", "runtime video must be explicitly silent");
    if (!Number.isSafeInteger(input.durationMs) || input.durationMs < 1 || input.durationMs > MAX_RENDER_MS) issue("durationMs", `expected 1–${MAX_RENDER_MS} ms`);
    if (input.editableControls?.title === true) issue("editableControls.title", "baked video text is not directly editable");
    if (!Array.isArray(input.editableControls?.outerMotion) || input.editableControls.outerMotion.some((control) => !VIDEO_MOTION.has(control)) || new Set(input.editableControls?.outerMotion).size !== input.editableControls?.outerMotion.length) {
      issue("editableControls.outerMotion", "declare only distinct supported whole-banner motions");
    }
  }
  if (still) {
    if (input.files.length === 0) issue("files", "still-image requires a runtime file");
    if (roles.get("stillImage") !== 1) issue("files", "still-image requires exactly one stillImage");
    if (input.files.some((file) => file?.role === "runtimeVideo")) issue("files", "still-image cannot contain runtimeVideo role entries");
    if (input.files.some((file) => file?.role === "stillImage" && !["image/png", "image/webp", "image/jpeg"].includes(file.mediaType))) issue("files", "stillImage must be PNG, WebP or JPEG");
    if (input.files.some((file) => file?.role === "supportingAsset" && !["image/png", "image/webp", "image/jpeg"].includes(file.mediaType))) issue("files", "supportingAsset must be PNG, WebP or JPEG");
    if (!isRecord(input.editableControls) || input.editableControls.title !== false) issue("editableControls.title", "still images do not expose source text editing");
    if (input.durationMs !== undefined) issue("durationMs", "still images have no baked duration");
    if (input.silent !== undefined) issue("silent", "still images have no audio track");
  }
  if (isRecord(input.editableControls) && Array.isArray(input.editableControls.outerMotion) && (input.editableControls.outerMotion.some((control) => !VIDEO_MOTION.has(control)) || new Set(input.editableControls.outerMotion).size !== input.editableControls.outerMotion.length)) issue("editableControls.outerMotion", "declare only distinct supported whole-banner motions");
  if (input.mediaKind === "editable-template") {
    if (input.files.some((file) => file?.role === "supportingAsset" && !["image/png", "image/webp", "image/jpeg"].includes(file.mediaType))) issue("files", "supportingAsset must be PNG, WebP or JPEG");
    if (!isRecord(input.template) || input.template.schemaVersion !== 1 || !isRecord(input.template.bannerProject)) issue("template", "editable-template requires BannerProject schemaVersion 1");
    else {
      rejectUnknown(input.template, new Set(["schemaVersion", "bannerProject"]), "template", issue);
      const project = input.template.bannerProject;
      rejectUnknown(project, new Set(["schemaVersion", "id", "title", "eventId", "artboard", "assets", "layers", "revision"]), "template.bannerProject", issue);
      if (project.schemaVersion !== 1 || typeof project.id !== "string" || !SAFE_ID.test(project.id) || typeof project.title !== "string" || !project.title.trim() || stringLength(project.title) > 160 || typeof project.eventId !== "string" || !SAFE_ID.test(project.eventId) || !isRecord(project.artboard) || !Number.isSafeInteger(project.artboard.width) || project.artboard.width < 1 || !Number.isSafeInteger(project.artboard.height) || project.artboard.height < 1 || !["dota-hud", "none"].includes(project.artboard.safeZonePreset) || !Array.isArray(project.layers) || !Array.isArray(project.assets) || !Number.isSafeInteger(project.revision) || project.revision < 1) issue("template.bannerProject", "invalid BannerProject v1 structure");
      else {
        rejectUnknown(project.artboard, new Set(["width", "height", "safeZonePreset"]), "template.bannerProject.artboard", issue);
        const indexedFiles = input.files.filter((file) => isRecord(file) && typeof file.id === "string" && SAFE_ID.test(file.id));
        const fileById = new Map(indexedFiles.map((file) => [file.id, file]));
        const assetIds = new Set();
        const sourceFileIds = new Set();
        for (const [index, asset] of project.assets.entries()) {
          const at = `template.bannerProject.assets[${index}]`;
          if (!isRecord(asset)) { issue(at, "expected a BannerAsset object"); continue; }
          rejectUnknown(asset, new Set(["id", "name", "kind", "mime", "source"]), at, issue);
          if (typeof asset.id !== "string" || !SAFE_ID.test(asset.id) || assetIds.has(asset.id)) issue(`${at}.id`, "invalid or duplicate asset ID");
          else assetIds.add(asset.id);
          if (typeof asset.name !== "string" || !asset.name.trim() || stringLength(asset.name) > 160) issue(`${at}.name`, "expected 1-160 characters");
          if (asset.kind !== "image" || !["image/png", "image/webp", "image/jpeg"].includes(asset.mime)) issue(at, "v1 templates support only raster image assets");
          if (typeof asset.source !== "string" || !asset.source.startsWith("asset:") || !SAFE_ID.test(asset.source.slice(6))) issue(`${at}.source`, "expected a managed asset:<id> reference; local and remote paths are not portable");
          else {
            const sourceFileId = asset.source.slice(6);
            if (sourceFileIds.has(sourceFileId)) issue(`${at}.source`, "multiple BannerAssets cannot claim one package file ID");
            else sourceFileIds.add(sourceFileId);
            const sourceFile = fileById.get(sourceFileId);
            if (sourceFile && sourceFile.mediaType !== asset.mime) issue(`${at}.mime`, "must match its indexed file media type");
          }
        }
        const foldedFileIds = new Set();
        const fileIdSet = new Set(fileById.keys());
        for (const id of fileIdSet) {
          const folded = id.toUpperCase();
          if (foldedFileIds.has(folded)) issue("files", "file IDs must be unique without case sensitivity");
          foldedFileIds.add(folded);
        }
        if (sourceFileIds.size !== fileIdSet.size || [...sourceFileIds].some((id) => !fileIdSet.has(id))) issue("template.bannerProject.assets", "every project asset must match one indexed supporting file ID");
        for (const file of input.files) if (file?.role !== "supportingAsset") issue("files", "editable-template files must be supporting assets");
        const layerIds = new Set();
        const layers = project.layers;
        for (const [index, layer] of layers.entries()) {
          const at = `template.bannerProject.layers[${index}]`;
          if (!isRecord(layer)) { issue(at, "expected a BannerLayer object"); continue; }
          rejectUnknown(layer, new Set(["id", "kind", "name", "parentId", "order", "visible", "locked", "transform", "style", "content", "timing", "motion"]), at, issue);
          if (typeof layer.id !== "string" || !SAFE_ID.test(layer.id) || layerIds.has(layer.id)) issue(`${at}.id`, "invalid or duplicate layer ID");
          else layerIds.add(layer.id);
          if (!LAYER_KINDS.has(layer.kind)) issue(`${at}.kind`, "unsupported BannerLayer kind");
          if (typeof layer.name !== "string" || !layer.name.trim() || stringLength(layer.name) > 160) issue(`${at}.name`, "expected 1–160 characters");
          if (layer.parentId !== null && (typeof layer.parentId !== "string" || !SAFE_ID.test(layer.parentId))) issue(`${at}.parentId`, "expected null or a layer ID");
          if (!Number.isSafeInteger(layer.order) || layer.order < 0) issue(`${at}.order`, "expected a nonnegative integer");
          if (typeof layer.visible !== "boolean" || typeof layer.locked !== "boolean") issue(at, "visible and locked must be booleans");
          if (!validTransform(layer.transform)) issue(`${at}.transform`, "invalid BannerTransform");
          if (!isRecord(layer.style)) issue(`${at}.style`, "expected an object");
          else {
            rejectUnknown(layer.style, new Set(["fill", "stroke", "fontSize", "fontWeight", "fontFamily", "fontAssetId"]), `${at}.style`, issue);
            for (const key of ["fill", "stroke", "fontFamily"]) if (layer.style[key] !== undefined && typeof layer.style[key] !== "string") issue(`${at}.style.${key}`, "expected a string");
            for (const key of ["fontSize", "fontWeight"]) if (layer.style[key] !== undefined && (!Number.isFinite(layer.style[key]) || layer.style[key] <= 0)) issue(`${at}.style.${key}`, "expected a positive number");
            if (layer.style.fontAssetId !== undefined && (typeof layer.style.fontAssetId !== "string" || !assetIds.has(layer.style.fontAssetId))) issue(`${at}.style.fontAssetId`, "font asset ID is not present in the manifest");
          }
          if (!isRecord(layer.content)) issue(`${at}.content`, "expected an object");
          else {
            rejectUnknown(layer.content, new Set(["text", "assetId"]), `${at}.content`, issue);
            if (layer.content.text !== undefined && typeof layer.content.text !== "string") issue(`${at}.content.text`, "expected a string");
            if (layer.content.assetId !== undefined && (typeof layer.content.assetId !== "string" || !assetIds.has(layer.content.assetId))) issue(`${at}.content.assetId`, "asset ID is not present in the manifest");
          }
          if (layer.timing !== undefined && (!isRecord(layer.timing) || Object.keys(layer.timing).some((key) => !["startMs", "endMs"].includes(key)) || !Number.isFinite(layer.timing.startMs) || !Number.isFinite(layer.timing.endMs) || layer.timing.startMs < 0 || layer.timing.endMs < layer.timing.startMs || layer.timing.endMs > MAX_RENDER_MS)) issue(`${at}.timing`, "invalid BannerTiming range");
          if (layer.motion !== undefined) {
            const keys = layer.motion?.keyframes;
            if (!isRecord(layer.motion) || Object.keys(layer.motion).some((key) => key !== "keyframes") || !Array.isArray(keys) || keys.length > 1024) issue(`${at}.motion`, "expected up to 1024 declarative keyframes");
            else {
              let prior = -1;
              for (const [frameIndex, frame] of keys.entries()) {
                if (!isRecord(frame) || Object.keys(frame).some((key) => !["timeMs", "transform", "easing"].includes(key)) || !Number.isSafeInteger(frame.timeMs) || frame.timeMs < 0 || frame.timeMs > MAX_RENDER_MS || frame.timeMs <= prior || !validTransform(frame.transform) || !["linear", "easeInOut"].includes(frame.easing)) issue(`${at}.motion.keyframes[${frameIndex}]`, "invalid or unordered BannerProject keyframe");
                else prior = frame.timeMs;
              }
            }
          }
        }
        for (const [index, layer] of layers.entries()) if (isRecord(layer) && typeof layer.parentId === "string") {
          const parent = layers.find((candidate) => isRecord(candidate) && candidate.id === layer.parentId);
          if (!parent || parent.kind !== "group") issue(`template.bannerProject.layers[${index}].parentId`, "parent must reference an existing group layer");
        }
      }
    }
    if (!isRecord(input.editableControls) || input.editableControls.title !== true || !Array.isArray(input.editableControls.outerMotion) || input.editableControls.outerMotion.some((control) => !VIDEO_MOTION.has(control)) || new Set(input.editableControls.outerMotion).size !== input.editableControls.outerMotion.length) issue("editableControls", "templates must declare title and supported outer-motion capabilities");
    if (input.durationMs !== undefined || input.silent !== undefined) issue("mediaKind", "editable source projects do not claim baked-media properties");
  } else if (input.template !== undefined) {
    issue("template", "only editable-template may contain a BannerProject");
  }

  if (input.provenance !== undefined) {
    if (!isRecord(input.provenance) || typeof input.provenance.application !== "string" || !input.provenance.application.trim() || stringLength(input.provenance.application) > 128 || typeof input.provenance.version !== "string" || !input.provenance.version.trim() || stringLength(input.provenance.version) > 64) issue("provenance", "application and version must be nonempty strings within their limits");
    rejectUnknown(input.provenance, new Set(["application", "version"]), "provenance", issue);
  }
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > MAX_MANIFEST_BYTES) issue("manifest", `exceeds ${MAX_MANIFEST_BYTES} bytes`);
  } catch {
    issue("manifest", "must serialize as JSON");
  }
  return issues;
}

/** Verify exact listed file bytes before import; external paths are never consulted. */
export async function verifyBannerAssetFiles(manifest, suppliedFiles, subtle = globalThis.crypto?.subtle) {
  const issues = validateBannerAssetManifest(manifest);
  if (issues.length) return issues;
  if (!subtle || typeof subtle.digest !== "function") return ["files: Web Crypto SHA-256 is unavailable"];
  if (!(suppliedFiles instanceof Map)) return ["files: expected Map<relative path, Uint8Array>"];
  const expectedPaths = new Set(manifest.files.map((file) => file.path));
  for (const path of suppliedFiles.keys()) if (!expectedPaths.has(path)) issues.push(`files.${path}: unexpected entry`);
  for (const file of manifest.files) {
    const bytes = suppliedFiles.get(file.path);
    if (!(bytes instanceof Uint8Array)) { issues.push(`files.${file.path}: missing bytes`); continue; }
    if (bytes.byteLength !== file.sizeBytes) { issues.push(`files.${file.path}: size mismatch`); continue; }
    let digest;
    try { digest = new Uint8Array(await subtle.digest("SHA-256", bytes)); }
    catch { issues.push(`files.${file.path}: SHA-256 operation failed`); continue; }
    const actual = Array.from(digest, (value) => value.toString(16).padStart(2, "0")).join("");
    if (actual !== file.sha256) issues.push(`files.${file.path}: SHA-256 mismatch`);
  }
  return issues;
}

/** Bound actual transport bytes before JSON.parse to avoid whitespace/escape expansion. */
export function parseBannerAssetManifest(bytes) {
  if (!(bytes instanceof Uint8Array)) return { manifest: undefined, issues: ["manifest: expected UTF-8 bytes"] };
  if (bytes.byteLength > MAX_MANIFEST_BYTES) return { manifest: undefined, issues: [`manifest: exceeds ${MAX_MANIFEST_BYTES} input bytes`] };
  let manifest;
  try { manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { return { manifest: undefined, issues: ["manifest: invalid UTF-8 or JSON"] }; }
  const issues = validateBannerAssetManifest(manifest);
  return issues.length ? { manifest: undefined, issues } : { manifest, issues: [] };
}
