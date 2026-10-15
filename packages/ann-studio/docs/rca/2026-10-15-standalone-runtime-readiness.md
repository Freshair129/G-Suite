---
version: "0.3.0"
created_at: "2026-10-15T00:00:00+07:00,Codex"
last_update: "2026-10-15T05:27:00+07:00,Codex"
status: "candidate"
attributes:
  doc_type: "rca"
  scope: "G-AnnStudio standalone runtime, issue #5"
---

# RCA — G-AnnStudio standalone runtime readiness

Issue: [Freshair129/G-Suite#5](https://github.com/Freshair129/G-Suite/issues/5)

## Symptoms

- FFmpeg lookup checked overrides, user-profile `ffmpeg-static`, and PATH, but
  did not inspect the shared `AI-Studio/tools` directory used by this machine.
- Python lookup checked an override, the sidecar venv, and bare `python`; no
  command reported whether required modules or scripts were present before a
  media-analysis action.
- `extract_audio`, `cut_clip`, `export_all`, and pack installation passed
  FFmpeg's `-y` flag. Import derived its WAV path beside the selected source.
- The UI called local pack writes “installed/sent” even when G-Maiden was not
  running. Manifest-pack installers discarded the endpoint response; the flat
  installer displayed a status string without treating a non-success response
  as rejected activation.
- Tauri bundle configuration did not declare Python sidecar resources. The
  setup note relied on a manually created `.venv`; it described CPU as the
  default while `transcribe.py` selected `auto`, which attempts CUDA first.
- The first isolated Windows Tauri build exposed an invalid single-file resource destination: mapping exact files to sidecar/ treated that directory as each file's final target and failed with OS error 183 after the .py glob created it.

## Evidence and limits

The worktree is based on the mainline revision recorded with issue #5. Rust
command source is in `src-tauri/src/lib.rs`; UI callers include
`src/src/components/Header.tsx`, `src/src/lib/actions.ts`, and
`src/src/lib/exportGmaidenPack.ts`. The prior frontend suite had 27 tests across
five files and passed TypeScript/Vite checks, but those tests do not launch the
Tauri binary or exercise native FFmpeg/Python commands. Audit fixtures were
disposable; no live G-Maiden install or user media was modified.

## Root cause

G-AnnStudio treated external executable availability and G-Maiden activation
as optimistic implementation details. It had no central runtime-health path
and did not carry filesystem and HTTP operation status through to the UI.
Media generation wrote directly to final paths with overwrite enabled, while
the bundle/setup contract omitted packaged script discovery. The initial resource map also used a directory destination for exact file sources; Tauri preserves each filename under a directory target for a glob, but an exact file source needs a full destination filename.

## Prevention

1. Add runtime diagnostics and a Settings view for resolved executable,
   script, version, and module status.
2. Keep generated writes staged and collision-safe; verify source hashes in
   standalone media tests.
3. Return local-write and activation states independently and render each
   state truthfully.
4. Package sidecar scripts and document CPU-only setup that never downloads
   model weights or selects GPU implicitly.
5. Verify actual Tauri commands against synthetic media and a disposable
   G-Maiden directory before claiming standalone readiness.

6. Map individual Tauri resource files to unique full destinations beneath `sidecar/`; use a directory destination only for a glob whose iterator preserves each filename.

## Fixes and verification

The standalone issue #5 slice now resolves configured local tools and an
app-local CPU Python environment, reports executable versions/scripts and
installed prerequisite metadata in Settings, and explains that these checks
do not validate model files or run inference. Import, cut, export, and pack
installation use staged no-overwrite publication. Install responses keep
local file creation separate from G-Maiden acceptance, rejection, and
unavailability; the actual G-Maiden contract requires both `ok: true` and
`activated: true` for acceptance. The desktop Whisper command explicitly uses
CPU. The setup script accepts explicit Python/venv paths, checks Python 3.11+
and fails with a missing-package list. The build-time endpoint override accepts
only HTTP loopback URLs at `/announcer/install`.

The initial custom-protocol build caught two integration issues: an exact-file
Tauri resource map must name each destination file (a directory destination
collided with the sidecar glob), and `runtime_diagnostics` needed the Tauri
command attribute to be registered. Both were corrected before the passing
build/test runs. The bundle maps the `.py` glob to `sidecar/` and maps each
requirements/setup file to its full path below that directory.

Verification on 2026-10-15:

- TypeScript checking and the configured Vitest suite passed: 33 tests across
  seven files, including install-status component and endpoint validation
  tests.
- `CARGO_BUILD_JOBS=1 cargo test --manifest-path
  packages/ann-studio/src-tauri/Cargo.toml --features custom-protocol --lib
  runtime_safety_tests -- --nocapture` passed 6/6 focused Rust tests.
- The custom-protocol debug binary built successfully. Tauri WebDriver launched
  it with a distinct acceptance identifier and the bridge passed eight checks:
  runtime diagnostics; WAV import, cut, and export; FFmpeg probes; collision
  preservation; fixture pack writes with accepted/rejected HTTP responses;
  unchanged source bytes; and SQLite `save_pack`/`load_packs` persistence
  after closing the first native app process and launching a second process.
  The SQLite file stayed inside that run's local-data fixture and the stored
  manifest fields matched after restart. The harness used owned loopback port
  38431 and a disposable G-Maiden-shaped directory. It invoked Tauri commands
  over IPC after native app launch; it did not visually click through every
  screen.
- A separate native CPU Whisper run matched all 28 expected normalized English
  words. Direct CPU RapidOCR returned the three fixture lines. The isolated
  acceptance-identifier rerun omitted model inference; there is no Thai or
  live-game media-quality claim.
- An early native run created test-only imported WAVs in the default G-AnnStudio
  app cache because Tauri's Windows known-folder resolution ignored overridden
  `APPDATA`/`LOCALAPPDATA`. Each exact task-created file was hash-checked and
  moved into its matching local evidence run; no other cache files were
  touched. The final rerun used a fresh Tauri identifier, verified its cache
  path was new, moved its exact generated WAV by matching SHA-256, and removed
  only its now-empty acceptance-owned cache directories.

Final identity check after the unused-import cleanup: the focused Rust command
above passed 6/6 again, with test executable SHA-256
`AAAD5540B48A443BF230301F49FF7FB623D997ACFF001C2C2801953AE21E5081`. The
acceptance-identifier custom-protocol debug executable SHA-256 is
`C97D2B4700A891C29349A064560D39B74A716428CA4D2AF47E7ABC0C16CABD37`. A final
`RUN_CPU_ASR=0` native rerun, `native-acceptance-2026-10-14T22-25-53-352Z`,
passed 8/8 checks against that exact executable. The 14.48-second synthetic
source stayed at SHA-256
`4A5E0BD7CBBBE5514F7DD8511679F3D22BC3A1E166987EA08F5113B8B1731E77`; the
generated import was preserved at its evidence path after hash verification,
and the unique app-cache directories were empty and removed. The detailed
receipt and cleanup record are in the audit evidence directory. This final
run did not reload Whisper or OCR models.

These results establish the debug native command path, not a release installer.
The acceptance harness supplied `SIDECAR_DIR`, `PYTHON_PATH`, and `FFMPEG_PATH`,
so runtime fallback to scripts embedded in a packaged application remains
unverified. Native OCR, `.ann` project-dialog save/open, a complete visual UI
click-through, a release-profile build/signature, and live G-Maiden integration
remain open.

## Changelog

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-10-15 | candidate | Record standalone path-discovery, overwrite, sidecar packaging, and false-success causes; bound remediation to local authoring flows. | pending | Codex |
| 0.2.0 | 2026-10-15 | candidate | Record the bounded fixes, Rust/frontend/native debug evidence, exact cache cleanup, and remaining release/resource/live-integration gates. | pending | Codex |
| 0.3.0 | 2026-10-15 | candidate | Add final focused Rust test and native acceptance executable hashes, exact 8/8 rerun identity, and verified app-cache cleanup. | pending | Codex |
