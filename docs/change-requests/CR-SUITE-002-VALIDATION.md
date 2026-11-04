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
| `cargo fmt --manifest-path packages/ann-studio/src-tauri/Cargo.toml --check` | PASS after the formatting follow-up on `lib.rs` |

The first global pnpm 11 install stopped at the non-interactive modules-dir
confirmation; a retry proceeded and failed because pnpm 11 rejects this
repository's `packageExtensions` checksum. The root
`banner-contracts:test` alias also resolved its nested `pnpm` to that global
version and stopped before test execution due to a non-interactive modules-dir
confirmation. The package-local contract test above was rerun directly with the
repository-pinned pnpm 9 and passed.

Not exercised at this checkpoint: native-window keyboard/focus behavior,
packaged/installed app UI, live video codec/alpha parity, cancellation after the
Apply worker starts, a true disk-full condition, and orphan-file cleanup after a
partial managed-cache copy. Unit tests cover archive validation, stale-generation
rejection, lock/copy failure recovery, and preservation of voice and event data;
the later source-level round-trip evidence is recorded below.

### Formatting follow-up — 2026-11-04

The initial crate-wide `cargo fmt --check` exposed more than 30 rustfmt differences
in the legacy AnnStudio `lib.rs`; the same check failed on its unchanged base
revision. The entrypoint was formatted in a separate style-only commit. The
crate-wide format check now passes, and `cargo test --locked` was rerun afterward:
32 passed.

## Studio producer to AnnStudio project round-trip — 2026-11-04

`tools/test-banner-roundtrip.ps1` connects the production exporter and importer
implementations without using external G-Maiden data. It asks the 3D Studio Rust
exporter to package the checked-in 128×128 PNG fixture, then passes that emitted
ZIP to AnnStudio's archive inspector and managed-project apply path. The test
saves the result as `.ann`, reopens it, and checks the source asset ID/revision,
manifest digest, target event, voice clip/asset, event mapping and exact image
bytes/hash. The runner also asserts that the AnnStudio round-trip test actually
ran, and removes only its uniquely named temporary directory.

| Check | Result |
| --- | --- |
| `cargo test` for the 3D Studio exporter fixture | PASS, 1 test; immutable revision and exact archive bytes |
| `project_io::tests::imports_studio_producer_archive_and_reopens_the_saved_project` | PASS, 1 test; produced ZIP imported and saved/reopened as `.ann` |
| `tools/test-banner-roundtrip.ps1` | PASS on Windows |

The Windows hosted workflow now runs this round-trip after the Studio exporter
checks. Hosted evidence is pending for the updated PR head. This is an application
code integration test, not a native-window UI test.

## Native UI and DPI acceptance gap — 2026-11-04

Both release Tauri executables compiled locally with `--no-bundle`. An installed
Tauri keyboard/focus run and screenshots were not captured. The required
`computer-use` node runtime failed initialization twice and again after a kernel
reset with `failed to write kernel assets (os error 3)`. The primary display scale
reports 100%; 125% and 150% were not available on this host, and display settings
were not changed. NSIS and WiX bundle tools were not installed, so installer-based
UI acceptance remains unrun. No G-Maiden process was found during the read-only
preflight; no G-Maiden app, runtime data or external production assets were
modified.

## Final PR #23 local checks — 2026-11-04

| Check | Result |
| --- | --- |
| Frozen pnpm install (pnpm 9, scripts disabled) | PASS |
| AnnStudio UI | PASS, 142 tests across 23 files |
| AnnStudio TypeScript check and production build | PASS; Vite reports the existing 650 kB chunk-size advisory |
| 3D Studio frontend production build | PASS |
| Banner contract suite | PASS, 26 tests |
| 3D Studio workspace regression suite | PASS, 6 tests |
| 3D Studio Rust suite | PASS, 2 tests |
| AnnStudio Rust suite | PASS, 32 tests; the producer round-trip test is separately invoked by the Windows runner |
| Both Rust `cargo check --locked` and `cargo fmt --check` | PASS |
| Studio-produced ZIP → AnnStudio import → `.ann` save/reopen | PASS, 1 producer test + 1 consumer/reopen test |
| Release Tauri builds (`--no-bundle`) | PASS for both applications; outputs are executables, not installers |
| `git diff --check` | PASS |

The release executables were built with task-specific application identifiers.
They were not launched because the required Windows Computer Use runtime could
not initialize. No native screenshot, keyboard/focus, or 125%/150% DPI result is
claimed. Hosted checks must be read from the exact pushed PR head after this
change is uploaded.
