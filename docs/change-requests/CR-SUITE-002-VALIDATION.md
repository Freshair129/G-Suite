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

Follow-up branch `codex/banner-asset-integration` is based on PR #20's head
`83717f15b339d64ce98768fadb83400782a89f95` and is submitted as stacked PR #22.
The compatibility fix was validated at code revision
`07730369b2418b71f47eedf21576a92d303dc23d`. It corrects the BannerProject
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
| PR #22 hosted workflow #41690119765 at code head `0773036` | PASS, all four jobs |

The regression first failed because the runtime validator accepted a BannerAsset
whose declared MIME differed from the indexed file, then passed after the validator
change. The test also preserves the distinct-ID fixture and rejects two BannerAssets
claiming the same package file.

The hosted PR #20 workflow validates its own head, not this follow-up branch. PR #22's
workflow validates the code head noted above. No AnnStudio native app, Studio exporter,
archive extraction, install flow, G-Maiden process or external asset data was exercised
or changed by this contract-only fix.

## AnnStudio managed importer validation — 2026-11-04

Implementation branch `codex/annstudio-banner-import` is stacked on PR #22
(`codex/banner-asset-integration`, head `0a948e3ebc6cb86117def45c3ca7a8429ee782ad`).
The checks below cover the importer slice and its source tree; no AnnStudio native
window was launched and no G-Maiden process or data was touched.

| Check | Result |
| --- | --- |
| `corepack pnpm install --frozen-lockfile --ignore-scripts` (pinned pnpm 9.0.0) | PASS |
| `corepack pnpm -C packages/ann-studio/src test` | PASS, 140 tests across 23 files |
| `corepack pnpm -C packages/ann-studio/src exec tsc --noEmit` | PASS |
| `corepack pnpm -C packages/ann-studio/src build` | PASS; Vite reports the emitted 650 kB app chunk exceeds its 500 kB advisory threshold |
| `corepack pnpm -C packages/banner-contracts test` | PASS, 26 tests |
| `cargo test --locked --manifest-path packages/ann-studio/src-tauri/Cargo.toml` | PASS, 32 tests |
| `cargo check --locked --manifest-path packages/ann-studio/src-tauri/Cargo.toml` | PASS |
| `rustfmt --check` on `banner_asset_archive.rs`, `project_io.rs`, and `project_io_tests.rs` | PASS |
| `git diff --check` | PASS |
| `cargo fmt --manifest-path packages/ann-studio/src-tauri/Cargo.toml --check` | FAILS on pre-existing formatting in `lib.rs`; the unchanged base version fails the same check. No broad reformat was applied to that legacy file. |

The first global pnpm 11 install stopped at the non-interactive modules-dir
confirmation; a retry proceeded and failed because pnpm 11 rejects this
repository's `packageExtensions` checksum. The root
`banner-contracts:test` alias also resolved its nested `pnpm` to that global
version and stopped before test execution due to a non-interactive modules-dir
confirmation. The package-local contract test above was rerun directly with the
repository-pinned pnpm 9 and passed.

Not exercised: native-window keyboard/focus behavior, packaged/installed app,
import of a ZIP produced by 3D Studio (producer export is still open), live video
codec/alpha parity, cancellation after the Apply worker starts, a true disk-full
condition, and orphan-file cleanup after a partial managed-cache copy. Unit tests
cover archive validation, stale-generation rejection, lock/copy failure recovery,
and preservation of voice and event data; these do not replace those native and
producer-to-consumer acceptance gates.
