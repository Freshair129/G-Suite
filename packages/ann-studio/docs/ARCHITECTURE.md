---
version: "0.6.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-10-15T00:00:00+07:00,Codex"
status: "beta"
attributes:
  doc_type: "architecture"
  scope: "G-AnnStudio"
---

# G-AnnStudio Architecture

## Components

| Component | Responsibility | Boundary |
| --- | --- | --- |
| React editor | Source, mastering, pack authoring, and G-Overlay Lab UI | Local WebView |
| Zustand studio store | Local drafts, clips, overlay layout, and `BannerProject` state | Persisted locally |
| Tauri Rust commands | File, audio, bake, and explicit installation operations | Desktop process |
| Runtime health and sidecars | Resolve FFmpeg/Python/packaged scripts, report dependency status, and execute CPU-default local media workflows | Tauri resources, app-local Python environment, and explicitly configured local tools |
| G-Maiden sync receiver | Validates and persists only HUD layout geometry | `127.0.0.1:3000` |
| Private cloud sync (approved contract) | Owner-only project manifest and author-asset persistence | Supabase `gstore`, `ann_` tables, private bucket |

## Key boundaries

1. `BannerProject` and `OverlayLayout` are different authoring models.
2. An Ann Pack may contain runtime-safe banner assets; raw video is authoring-only.
3. Layout sync sends no source paths, event media, game state, account data, or cloud credentials.
4. Private cloud sync is not a dependency of the local editor or G-Maiden runtime. Its approved provider boundary is the existing Supabase `gstore` project with dedicated `ann_` tables and a private `ann-project-assets` bucket.
5. The cloud projection contains only BannerProject metadata and opaque asset references. GSI, match, CV, G-Log, Steam, recovery, entitlement, and Google security data remain excluded.
6. Media output uses temporary staging and collision-safe promotion. G-Maiden activation is reported separately from successful local pack-file creation.

## Decisions

- **ADR-ANN-001:** local-first authoring and persistence.
- **ADR-ANN-002:** direct manipulation and numeric inspector must edit the same layer transform.
- **ADR-ANN-003:** G-Maiden integration is an explicit local handoff, not implicit background synchronization.
- **ADR-ANN-004:** private cloud synchronization uses the approved C-3/HIGH contract in [the threat model](gann-cloud-threat-model.md): Google OAuth/Supabase Auth, `auth.uid()` owner RLS, private assets, tombstones, and revision conflicts. It never writes to G-Maiden runtime state.

## Verification boundary

TypeScript compilation validates the frontend type contract. The configured Vitest suite (`src/package.json`) passes 33 tests across seven files, including the loopback-only endpoint resolver and ClipList install-result flow. Focused Rust tests pass 6/6. A Windows debug custom-protocol app launched in Tauri WebDriver and passed eight isolated-identifier bridge/IPC checks for diagnostics, WAV import/cut/export, FFmpeg probes, collision guards, disposable pack activation, source preservation, and SQLite pack persistence across a full app-process restart. A separate native CPU Whisper run matched the 28-word English fixture exactly after normalization. The acceptance harness invokes Tauri commands after launching the native app; it does not click through every visual screen or exercise `.ann` project-dialog save/open. The isolated runs use explicit sidecar paths, so packaged-resource fallback remains open. No release installer, live G-Maiden app, native OCR, or Thai/live-game media quality was validated. `preflightBannerProject` remains a pure export-plan check; layout receiver validation is owned by G-Maiden. Cloud sync is separately verified through manifest projection, forbidden-data, signed-out/offline, and RLS/pgTAP tests. Hosted migration, cleanup-worker retention, and live signed-URL evidence remain release-quality gates.
Standalone FFmpeg/Python discovery, sidecar setup, and output safety are specified in [the runtime safety specification](g-annstudio-runtime-safety-spec.md). This is separate from G-Overlay Lab editor and cloud qualification.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Added G-AnnStudio component and boundary architecture. | pending | ATHER |
| 0.1.1 | 2026-08-12 | beta | Corrected frontend-test and export-preflight status to the current implementation boundary. | pending | ATHER |
| 0.2.0 | 2026-08-14 | candidate | Recorded the approved Supabase private-cloud boundary and retained local-first/runtime isolation. | pending | ATHER |
| 0.3.0 | 2026-10-15 | candidate | Add the local runtime-health boundary, packaged sidecar resource path, staged media output, and separate G-Maiden activation acknowledgment. | pending | Codex |
| 0.4.0 | 2026-10-15 | candidate | Record app-local CPU sidecar discovery, Settings diagnostics, collision-safe exports, and confirmation-aware pack handoff. | pending | Codex |
| 0.5.0 | 2026-10-15 | candidate | Record loopback-only endpoint validation, 33 passing frontend tests, and native command acceptance still in progress. | pending | Codex |
| 0.6.0 | 2026-10-15 | candidate | Record focused Rust and native debug IPC/media/pack acceptance while keeping packaged-resource, release, and live G-Maiden gates explicit. | pending | Codex |
