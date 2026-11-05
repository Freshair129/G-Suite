import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { validateBannerAssetManifest, verifyBannerAssetFiles, parseBannerAssetManifest, BANNER_ASSET_FORMAT, MAX_MANIFEST_BYTES } from "./index.js";

const payload = new Uint8Array([0, 1, 2, 255]);
const base = () => ({
  format: BANNER_ASSET_FORMAT, schemaVersion: 1, assetId: "banner-v001", revision: 1,
  name: "Soft Rise", mediaKind: "baked-video", silent: true, durationMs: 5700,
  editableControls: { title: false, outerMotion: ["outerOpacity", "outerScale"] },
  files: [{ id: "runtime-file", path: "assets/banner.webm", role: "runtimeVideo", mediaType: "video/webm", sizeBytes: 4, sha256: createHash("sha256").update(payload).digest("hex") }],
});
const schema = JSON.parse(readFileSync(fileURLToPath(new URL("../../../schemas/banner-asset-v1.schema.json", import.meta.url)), "utf8"));
const schemaValidate = new Ajv2020({ allErrors: true }).compile(schema);

test("accepts a truthful silent baked banner with supported controls", () => assert.deepEqual(validateBannerAssetManifest(base()), []));
test("rejects unsafe absolute, parent, encoded, duplicate and Windows paths", () => {
  for (const path of ["../payload", "assets/../secret", "C:/outside", "assets\\escape", "/root", "assets/%2e%2e/file", "assets/file.png\n"]) {
    const value = base(); value.files[0].path = path;
    assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("files[0].path")), path);
  }
  const value = base(); value.files.push({ ...value.files[0] });
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("case-insensitive Windows path alias")));
});
test("rejects unknown contract fields instead of ignoring control typos", () => {
  const value = base(); value.editableControls.transalteX = true; value.ignored = "unexpected";
  const issues = validateBannerAssetManifest(value).join("\n");
  assert.match(issues, /editableControls: unknown property transalteX/);
  assert.match(issues, /manifest: unknown property ignored/);
});
test("rejects false editability claims for baked video", () => {
  const value = base(); value.editableControls.title = true;
  value.editableControls.outerMotion.push("arbitraryKeyframes");
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("not directly editable")));
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("supported whole-banner motions")));
});
test("rejects audio video, unsupported version and over-limit render", () => {
  const value = base(); value.silent = false; value.schemaVersion = 99; value.durationMs = 18201;
  const issues = validateBannerAssetManifest(value).join("\n");
  assert.match(issues, /unsupported schema version/); assert.match(issues, /explicitly silent/); assert.match(issues, /durationMs/);
});
test("requires editable source for editable templates", () => {
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent;
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("requires BannerProject")));
});
test("requires a versioned BannerProject and honest edit controls", () => {
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent;
  value.files = [];
  value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [], assets: [] } };
  value.editableControls = { title: true, outerMotion: [] };
  assert.deepEqual(validateBannerAssetManifest(value), []);
});
test("JSON Schema and runtime contract accept the same template, video and still examples", () => {
  const template = base(); template.mediaKind = "editable-template"; delete template.durationMs; delete template.silent;
  template.files = [{ id: "image-1", path: "assets/banner.png", role: "supportingAsset", mediaType: "image/png", sizeBytes: 4, sha256: base().files[0].sha256 }];
  template.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [], assets: [{ id: "image-1", name: "Banner art", kind: "image", mime: "image/png", source: "asset:image-1" }] } };
  template.editableControls = { title: true, outerMotion: ["outerOpacity"] };
  const still = base(); still.mediaKind = "still-image"; delete still.durationMs; delete still.silent; still.editableControls.title = false;
  still.files[0] = { ...still.files[0], id: "image-file", path: "assets/banner.png", role: "stillImage", mediaType: "image/png" };
  for (const manifest of [base(), template, still]) {
    assert.deepEqual(validateBannerAssetManifest(manifest), []);
    assert.equal(schemaValidate(manifest), true, JSON.stringify(schemaValidate.errors));
  }
  const invalid = structuredClone(template); invalid.files = [{ ...base().files[0] }];
  assert.equal(schemaValidate(invalid), false);
});
test("supports distinct BannerProject asset IDs and managed source file IDs", () => {
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent;
  value.files = [{ id: "managed-image", path: "assets/banner.png", role: "supportingAsset", mediaType: "image/png", sizeBytes: 4, sha256: base().files[0].sha256 }];
  value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [], assets: [{ id: "banner-layer-image", name: "Banner art", kind: "image", mime: "image/png", source: "asset:managed-image" }] } };
  value.editableControls = { title: true, outerMotion: [] };
  assert.deepEqual(validateBannerAssetManifest(value), []);
  assert.equal(schemaValidate(value), true, JSON.stringify(schemaValidate.errors));

  const mismatchedMediaType = structuredClone(value);
  mismatchedMediaType.files[0].mediaType = "image/jpeg";
  assert.equal(schemaValidate(mismatchedMediaType), true, JSON.stringify(schemaValidate.errors));
  assert.ok(validateBannerAssetManifest(mismatchedMediaType).some((issue) => issue.includes("must match its indexed file media type")));

  const duplicateSource = structuredClone(value);
  duplicateSource.template.bannerProject.assets.push({ ...duplicateSource.template.bannerProject.assets[0], id: "second-layer-image" });
  assert.ok(validateBannerAssetManifest(duplicateSource).some((issue) => issue.includes("multiple BannerAssets cannot claim one package file ID")));
});
test("returns validation issues for malformed untrusted manifests without throwing", () => {
  const numericIds = base(); numericIds.assetId = 17; numericIds.files[0].id = 42;
  const badMotion = base(); badMotion.editableControls.outerMotion = "outerOpacity";
  const badStill = base(); badStill.mediaKind = "still-image"; delete badStill.durationMs; delete badStill.silent; badStill.editableControls = null;
  for (const value of [numericIds, badMotion, badStill]) {
    let issues;
    assert.doesNotThrow(() => { issues = validateBannerAssetManifest(value); });
    assert.ok(issues.length > 0);
  }
  const parsedStill = new TextEncoder().encode(JSON.stringify(badStill));
  let parsed;
  assert.doesNotThrow(() => { parsed = parseBannerAssetManifest(parsedStill); });
  assert.ok(parsed.issues.length > 0);
});
test("rejects deeply nested malformed project values without recursive overflow", () => {
  let nested = "not-a-fill-color";
  for (let depth = 0; depth < 12_000; depth += 1) nested = [nested];
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent; value.files = [];
  value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [{ id: "title-1", kind: "text", name: "Title", parentId: null, order: 0, visible: true, locked: false, transform: { x: 50, y: 50, width: 50, height: 10, rotation: 0, opacity: 1 }, style: { fill: nested }, content: {} }], assets: [] } };
  value.editableControls = { title: true, outerMotion: [] };
  let issues;
  assert.doesNotThrow(() => { issues = validateBannerAssetManifest(value); });
  assert.ok(issues.length > 0);

  const parseValue = base(); parseValue.mediaKind = "editable-template"; delete parseValue.durationMs; delete parseValue.silent; parseValue.files = [];
  parseValue.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [{ id: "title-1", kind: "text", name: "Title", parentId: null, order: 0, visible: true, locked: false, transform: { x: 50, y: 50, width: 50, height: 10, rotation: 0, opacity: 1 }, style: { fill: "PLACEHOLDER" }, content: {} }], assets: [] } };
  parseValue.editableControls = { title: true, outerMotion: [] };
  const nestedJson = "[".repeat(12_000) + "\"invalid\"" + "]".repeat(12_000);
  const raw = JSON.stringify(parseValue).replace('"fill":"PLACEHOLDER"', `"fill":${nestedJson}`);
  let parsed;
  assert.doesNotThrow(() => { parsed = parseBannerAssetManifest(new TextEncoder().encode(raw)); });
  assert.ok(parsed.issues.length > 0);
});
test("schema and runtime agree on layer structure and reject unknown references", () => {
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent;
  value.files = [];
  value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [{ id: "title-1", kind: "text", name: "Title", parentId: null, order: 0, visible: true, locked: false, transform: { x: 50, y: 50, width: 50, height: 10, rotation: 0, opacity: 1 }, style: { fill: "#fff" }, content: { text: "KILL" } }], assets: [] } };
  value.editableControls = { title: true, outerMotion: [] };
  assert.deepEqual(validateBannerAssetManifest(value), []);
  assert.equal(schemaValidate(value), true, JSON.stringify(schemaValidate.errors));

  for (const layer of [{}, { ...value.template.bannerProject.layers[0], sourcePath: "C:/outside" }]) {
    const invalid = structuredClone(value); invalid.template.bannerProject.layers = [layer];
    assert.ok(validateBannerAssetManifest(invalid).length > 0);
    assert.equal(schemaValidate(invalid), false, JSON.stringify(schemaValidate.errors));
  }
});
test("BannerProject identifiers must be strings in both schema and runtime validator", () => {
  for (const key of ["id", "eventId"]) {
    const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent; value.files = [];
    value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [], assets: [] } };
    value.template.bannerProject[key] = 123;
    value.editableControls = { title: true, outerMotion: [] };
    assert.ok(validateBannerAssetManifest(value).length > 0, key);
    assert.equal(schemaValidate(value), false, key);
  }
});
test("schema and runtime reject a second baked runtime video unless it is the only WebM", () => {
  const value = base();
  value.files.push({ id: "second-video", path: "assets/second.png", role: "runtimeVideo", mediaType: "image/png", sizeBytes: 4, sha256: base().files[0].sha256 });
  assert.ok(validateBannerAssetManifest(value).length > 0);
  assert.equal(schemaValidate(value), false, JSON.stringify(schemaValidate.errors));
});
test("schema and runtime reject media roles that do not belong to their manifest kind", () => {
  const still = base(); still.mediaKind = "still-image"; delete still.durationMs; delete still.silent; still.editableControls.title = false;
  still.files[0] = { ...still.files[0], role: "runtimeVideo", mediaType: "image/png" };
  assert.ok(validateBannerAssetManifest(still).length > 0);
  assert.equal(schemaValidate(still), false, JSON.stringify(schemaValidate.errors));

  const bakedWithTemplate = base(); bakedWithTemplate.template = {};
  assert.ok(validateBannerAssetManifest(bakedWithTemplate).length > 0);
  assert.equal(schemaValidate(bakedWithTemplate), false, JSON.stringify(schemaValidate.errors));
});
test("runtime checks cross-field references and ordering that JSON Schema cannot express", () => {
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent; value.files = [];
  value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [{ id: "child-1", kind: "text", name: "Title", parentId: "missing-group", order: 0, visible: true, locked: false, transform: { x: 50, y: 50, width: 50, height: 10, rotation: 0, opacity: 1 }, style: {}, content: {}, motion: { keyframes: [{ timeMs: 10, transform: { x: 50, y: 50, width: 50, height: 10, rotation: 0, opacity: 1 }, easing: "linear" }, { timeMs: 5, transform: { x: 50, y: 50, width: 50, height: 10, rotation: 0, opacity: 1 }, easing: "linear" }] } }], assets: [] } };
  value.editableControls = { title: true, outerMotion: [] };
  assert.ok(validateBannerAssetManifest(value).length > 0);
  assert.equal(schemaValidate(value), true, JSON.stringify(schemaValidate.errors));
});
test("schema and runtime accept a one-character safe asset filename", () => {
  const value = base(); value.files[0].path = "assets/a";
  assert.deepEqual(validateBannerAssetManifest(value), []);
  assert.equal(schemaValidate(value), true, JSON.stringify(schemaValidate.errors));
});
test("schema and runtime reject whitespace-only provenance and BannerProject titles", () => {
  const value = base(); value.provenance = { application: "  ", version: "1.0" };
  assert.ok(validateBannerAssetManifest(value).length > 0);
  assert.equal(schemaValidate(value), false, JSON.stringify(schemaValidate.errors));
  const template = base(); template.mediaKind = "editable-template"; delete template.durationMs; delete template.silent; template.files = [];
  template.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "  ", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [], assets: [] } };
  template.editableControls = { title: true, outerMotion: [] };
  assert.ok(validateBannerAssetManifest(template).length > 0);
  assert.equal(schemaValidate(template), false, JSON.stringify(schemaValidate.errors));
});
test("uses Unicode code-point lengths for schema string limits", () => {
  const value = base(); value.name = "😀".repeat(120); value.provenance = { application: "😀".repeat(128), version: "😀".repeat(64) };
  assert.deepEqual(validateBannerAssetManifest(value), []);
  assert.equal(schemaValidate(value), true, JSON.stringify(schemaValidate.errors));

  const template = base(); template.mediaKind = "editable-template"; delete template.durationMs; delete template.silent; template.files = [];
  template.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "😀".repeat(160), eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [{ id: "title-1", kind: "text", name: "😀".repeat(160), parentId: null, order: 0, visible: true, locked: false, transform: { x: 50, y: 50, width: 50, height: 10, rotation: 0, opacity: 1 }, style: {}, content: {} }], assets: [] } };
  template.editableControls = { title: true, outerMotion: [] };
  assert.deepEqual(validateBannerAssetManifest(template), []);
  assert.equal(schemaValidate(template), true, JSON.stringify(schemaValidate.errors));
});
test("verifies exact listed bytes, size and digest before import", async () => {
  const value = base();
  const fileMap = new Map([["assets/banner.webm", payload]]);
  assert.deepEqual(await verifyBannerAssetFiles(value, fileMap, webcrypto.subtle), []);
  assert.ok((await verifyBannerAssetFiles(value, new Map(), webcrypto.subtle)).some((issue) => issue.includes("missing bytes")));
  assert.ok((await verifyBannerAssetFiles(value, new Map([["assets/banner.webm", new Uint8Array([1])]]), webcrypto.subtle)).some((issue) => issue.includes("size mismatch")));
  assert.ok((await verifyBannerAssetFiles(value, new Map([["assets/banner.webm", new Uint8Array([1, 2, 3, 4])]]), webcrypto.subtle)).some((issue) => issue.includes("SHA-256 mismatch")));
});
test("rejects unexpected files rather than silently importing unindexed payloads", async () => {
  const value = base(); const files = new Map([["assets/banner.webm", payload], ["assets/extra.png", payload]]);
  assert.ok((await verifyBannerAssetFiles(value, files, webcrypto.subtle)).some((issue) => issue.includes("unexpected entry")));
});

test("enforces entry and per-file transfer ceilings without allocating media", () => {
  const value = base(); value.files[0].sizeBytes = 256 * 1024 * 1024 + 1;
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("sizeBytes")));
  const crowded = base(); crowded.files = Array.from({ length: 65 }, (_, index) => ({ ...base().files[0], path: `assets/${index}.webm` }));
  assert.ok(validateBannerAssetManifest(crowded).some((issue) => issue.includes("files: expected an array with at most 64")));
});

test("rejects Windows path aliases and reserved device filenames", () => {
  for (const path of ["assets/CON", "assets/nul.png", "assets/COM1.webm"]) {
    const value = base(); value.files[0].path = path;
    assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("Windows-safe")), path);
    assert.equal(schemaValidate(value), false, path);
  }
  const trailingDot = base(); trailingDot.files[0].path = "assets/name.";
  assert.ok(validateBannerAssetManifest(trailingDot).some((issue) => issue.includes("safe relative")));
  assert.equal(schemaValidate(trailingDot), false);
  const value = base(); value.files.push({ ...value.files[0], id: "other-file", path: "assets/BANNER.WEBM" });
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("case-insensitive")));
});

test("rejects unindexed external media references inside an otherwise valid BannerProject", () => {
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent; value.files = [];
  value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [], assets: [{ id: "image-1", name: "External", kind: "image", mime: "image/png", source: "C:/Users/me/banner.png" }] } };
  value.editableControls = { title: true, outerMotion: [] };
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("managed asset:<id>")));
});

test("rejects a template that references an asset absent from the package index", () => {
  const value = base(); value.mediaKind = "editable-template"; delete value.durationMs; delete value.silent; value.files = [];
  value.template = { schemaVersion: 1, bannerProject: { schemaVersion: 1, id: "project-1", title: "Project", eventId: "kill", artboard: { width: 1280, height: 560, safeZonePreset: "dota-hud" }, revision: 1, layers: [], assets: [{ id: "missing-file", name: "Missing", kind: "image", mime: "image/png", source: "asset:missing-file" }] } };
  value.editableControls = { title: true, outerMotion: [] };
  assert.ok(validateBannerAssetManifest(value).some((issue) => issue.includes("must match one indexed supporting file ID")));
});

test("bounds raw UTF-8 bytes before parsing and rejects invalid UTF-8", () => {
  assert.ok(parseBannerAssetManifest(new Uint8Array(MAX_MANIFEST_BYTES + 1)).issues[0].includes("input bytes"));
  assert.ok(parseBannerAssetManifest(new Uint8Array([0xff])).issues[0].includes("invalid UTF-8"));
  const valid = new TextEncoder().encode(JSON.stringify(base()));
  assert.deepEqual(parseBannerAssetManifest(valid).issues, []);
});
