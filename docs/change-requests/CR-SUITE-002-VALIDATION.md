# CR-SUITE-002 contract validation — 2026-11-03

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

No native app was launched and no G-Maiden or external asset data was changed.
PR #20's hosted Studio packages workflow passed at base head `48633b9`; PR #21's
hosted workflow is the gate for the complete workspace build/test matrix.
