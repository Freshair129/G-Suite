# CR-SUITE-002 contract validation — history and follow-up

## Initial contract validation — 2026-11-03

Branch `codex/banner-asset-contract`, based on PR #20 head
`48633b9d0c4f3042e30ea1ec9dec131a79e082fe`. This PR adds the contract foundation;
it does not yet export/import real production assets in either app.

## Local checks

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` using pinned pnpm 9 | PASS |
| `pnpm banner-contracts:test` | PASS, 25 Node tests including strict JSON Schema Draft 2020 validation through Ajv |
| package-local TypeScript declaration check | PASS |
| Schema JSON parse | PASS |
| `git diff --check` | PASS |

The tests cover all three manifest kinds, real BannerProject v1 layer fields,
supported capabilities, malformed and deeply nested input no-throw handling, exact file bytes and
SHA-256, unsupported/extra files, path traversal/absolute paths, duplicate and
case-alias filenames, reserved Windows devices, local/remote/data media references,
missing file IDs, transfer ceilings, and raw UTF-8 size before parse. The checked-in
JSON Schema is compiled in strict Ajv mode with no warnings. Valid baked-video,
still-image and editable-template examples pass both validators; invalid layer shapes
and manifest/media-role combinations are rejected by both.

JSON Schema intentionally covers local structure and role constraints. Cross-field
checks such as asset-ID joins, group-parent references, keyframe ordering, case-folded
duplicates, aggregate byte limits and serialized manifest size require the runtime
validator. Importers must call both validators and then verify the exact payload bytes.

## Contract scope and limits

The standalone validator has no archive extractor, filesystem writer, Tauri command,
Studio exporter or AnnStudio UI binding. It validates parsed manifest objects and
provided byte maps. Call `parseBannerAssetManifest(rawBytes)` before any JSON parse
to apply the actual 1 MiB byte bound. V1 templates use the existing BannerProject
envelope and managed `asset:<id>` references; source paths, URLs, data URLs and
non-raster support files are rejected. ZIP decompression-size/path/cancellation,
managed-project snapshot transactions, project-library UI, paired event selection,
renderer compatibility, Store acceptance and native alpha preview remain future
gates in CR-SUITE-002/CR-ANN-WORKFLOW-001.

The file-count, byte-size and duration limits are documented as proposed bounds.
The file size limits have not been measured against a production asset sample and
must be rechecked before wiring them into export/import UX.

At the time of this initial validation, no native app was launched and no
G-Maiden or external asset data was changed. PR #20's hosted Studio packages
workflow passed at base head `48633b9`; PR #21's hosted workflow was still pending.

## AnnStudio compatibility validation — 2026-11-04

Follow-up branch `codex/banner-asset-integration` is based on PR #20's current
head `83717f15b339d64ce98768fadb83400782a89f95`. It corrects the BannerProject
asset join to match AnnStudio's model: `BannerAsset.id` is the editor identity,
while `BannerAsset.source` references the independent managed package file ID.
The runtime contract also requires a one-to-one source/file join and matching
BannerAsset MIME and indexed file media type.

| Check | Result |
| --- | --- |
| `pnpm banner-contracts:test` using pinned pnpm 9 | PASS, 26 Node tests |
| Strict JSON Schema Draft 2020 validation through Ajv | PASS in the package test suite; cross-field mismatch remains a runtime check |
| `git diff --check` | PASS |
| PR #20 hosted Studio packages workflow #41688633809 at head `83717f1` | PASS, all four jobs |
| Hosted checks for this follow-up branch | Pending until its PR is opened |

The regression first failed because the runtime validator accepted a BannerAsset
whose declared MIME differed from the indexed file, then passed after the validator
change. The test also preserves the distinct-ID fixture and rejects two BannerAssets
claiming the same package file.

The hosted PR #20 workflow validates its own head, not this follow-up branch. No
AnnStudio native app, Studio exporter, archive extraction, install flow, G-Maiden
process or external asset data was exercised or changed by this contract-only fix.
