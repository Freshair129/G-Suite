# Local G-Ann Package v1

G-AnnStudio creates and uses announcer packs through **สร้างแพ็ก**: Project → Import → Events → Banner/SFX → Build/Test → Export/Install. Local editing, building, testing and installing work without an account, cloud model, terminal, JSON editing or manual cache copying.

## Editable project and playable package

- `.ann` v2 saves the complete portable project: managed source media/fonts, clips, variants, event mappings, banner layers/motion, captions, SFX cues, stable IDs, build history and recovery metadata. Save/Open and explicit Import Old Project are separate operations. localStorage holds preferences, not the document.
- `.gann` is the immutable playable artifact, not an editable project backup. It contains `gann.json`, `ann_<UUID>.json`, ID-named WAV and silent WebM plus optional inert source stock. It does not execute imported scripts.
- The shared `g-ann-package` writer uses `gann-zip-1`: Deflate level6 for JSON/WAV/source/font; Stored for WebM. Fixed metadata and sorted paths give reproducible bytes for unchanged inputs/toolchain. Existing valid v1 methods0/8 remain readable without rewriting files.
- All payloads have byte lengths and SHA-256; archive, paths, media references, PCM/WebM formats and duplicates are validated. Container/expanded limit512MiB, payload32MiB, descriptor/registry2MiB and2048payloads.
- Studio and Maiden vendor identical shared-crate sources. Registry events map explicit original-sound/banner pairs; the banner names the mixed playback sound. Missing/unmapped/invalid pairs stay silent.

## Create and test

Import copies raw media into a managed workspace and creates a normalized WAV there. It never writes a derivative beside the selected source. Trim/map clips manually; analysis/AI tools remain optional.

Select the variant before editing its banner. Layer timing, declarative keyframes, captions, fonts and SFX enter the same project snapshot rendered by the builder. Dry voice and mixed voice+SFX have equal duration; video is silent. New authored audio is at most15000ms, declared visual tail0–3200ms.

Build freezes one snapshot, renders every mapped variant, writes/validates the GANN and commits its revision under a project lock. Failed/cancelled builds retain the preceding revision. Unchanged snapshot/toolchain/raster output reuses its artifact. Changing project during work cannot apply results to another document; superseded artifacts cannot be used as current.

Exporting a saved sound-library pack makes a standalone copy with a fresh announcer identity. Studio reads its mapped sounds from the library and builds in a temporary directory. An export releases its working files after copying the GANN. Direct installation keeps them until the install attempt completes or is canceled. To deliver ongoing revisions with the same announcer identity and profile binding, use an editable `.ann` project.

**ทดสอบแพ็ก** opens that exact GANN with the shared reader. **ส่งออก .gann** copies the same verified bytes; it does not rebuild. Opening a different project or editing after build disables current export/install until a current artifact is selected/built.

## Install in Maiden

Choose a verified Installed/Dev/Test profile explicitly. Studio sends profile/digest/request ID over a current-user Windows named pipe. Maiden owns staging, installation registry and selection; Studio never writes Maiden cache folders or relies on its exe/cwd.

Packs mapping `enemy_missing` require a runtime with event taxonomy v1.2 or later. The v1 registration does not report taxonomy support. Studio checks the chosen file digest, then asks the user to confirm the destination supports v1.2 before sending it. For a headless `--gann-install` job, set `confirmEventTaxonomyV12` to `true` only for a known compatible target. Other event mappings need no additional confirmation.

Installation and activation have distinct results: installed, active, deferred until safe match boundary, or installed with activation error. A project retains Maiden-issued local lineage bindings for updates. Local packages cannot replace System/Store authority. Versions remain available for repair/rollback and active audio/video leases retain the selected revision.

A signed Store release is a separate detached attestation of publisher/package bytes. It is not an entitlement; Store backend/publishing/commerce remain deferred. Local verification never creates a Purchased/Official badge.

## Build tools (developers)

The Windows installer includes pinned FFmpeg plus its original LICENSE/README/provenance. End users do not install it. Source builds prepare the SHA-256-pinned vendor archive using:

```powershell
node tools/prepare-ann-media.mjs
node tools/build-ann-frontend.mjs
```

Tauri beforeBuild runs both. `prepare-ann-media --check` checks existing resources; `--archive <local-zip>` supports an existing pinned download. The executable/cache is ignored by Git and is included by Tauri's resource map. Runtime release builds accept only the pinned bundled executable; a debug override must match its hash. Corresponding-source/build-dependency fulfillment is a release-distribution gate before public publication of the application.

Native jobs accept a materialized ProjectSnapshot plus managed asset paths and per-variant raster frames. `start_build`, `build_status` and `cancel_build` use the same pipeline as `create_gann_package`; `export_artifact` requires committed artifact identity, while exact-copy export also verifies path/digest. The historical clip/image-only build-job format is not a runtime handoff.

## Verification boundaries

Package tests, native core jobs, native desktop compilation, installed UI operation, acoustic sync, live game correctness and CPU/RAM/FPS are different evidence categories. Do not claim installed/live acceptance from a headless job, source check or loose-file preview.
