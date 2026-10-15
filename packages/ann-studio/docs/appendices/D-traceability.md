---
version: "0.6.0"
created_at: "2026-08-10T00:00:00+07:00,ATHER"
last_update: "2026-10-15T00:00:00+07:00,Codex"
status: "beta"
attributes:
  doc_type: "traceability-matrix"
  scope: "G-Overlay Lab Figma editor and G-AnnStudio standalone runtime readiness"
---

# Appendix D — G-AnnStudio Traceability Matrix

The graph includes the scoped G-Overlay Lab feature and the standalone runtime readiness slice in issue #5; it is not a whole-repository coverage claim. The configured frontend Vitest suite passes 33 tests across seven files, plus the separately maintained G-Maiden pgTAP migration test. Focused Rust tests pass 6/6. A native Windows debug custom-protocol app passed eight isolated-identifier Tauri bridge/IPC checks for diagnostics, synthetic audio import/cut/export and FFmpeg probes, collision guards, disposable pack activation, unchanged source, and SQLite pack persistence across a full app-process restart. A separate debug run passed CPU Whisper through Tauri IPC with an exact normalized 28-word English match; direct CPU RapidOCR returned all three fixture lines. These records do not establish release packaging, bundled-resource fallback, `.ann` project-dialog save/open, visual click-through of every screen, Thai/live-game media quality, or live G-Maiden integration. Runtime requirements remain partial at those boundaries.

| Req ID | Defined in | Current code | Tests | Status |
| --- | --- | --- | --- | --- |
| GOE-001 Layer tree composition | Figma editor spec, Requirement map | `bannerProject.ts`, persisted `BannerProject` state, and `BannerEditor.tsx` implement ordered/nested layers, inherited visibility/lock, import, select, group/ungroup, duplicate, reorder, and delete. Group transform remains open. | Configured Vitest suite includes `bannerProject.test.ts` coverage. | Partial |
| GOE-002 Canvas + inspector parity | Figma editor spec, Required interactions | `BannerEditor.tsx` implements canvas selection, shift-select, marquee selection, drag/resize, snap-to-grid, align/distribute, Ctrl/Cmd undo/redo and inspector transform, text, font-size, and fill edits. | Configured Vitest suite includes `BannerEditor.test.tsx` coverage. | Partial |
| GOE-003 Runtime-safe motion export | Figma editor spec, Media and runtime boundary | `bakeBanner.ts`, `exportGmaidenPack.ts`, and `bake_animated_webp` are present; Sprint 3 adds deterministic BannerProject composition and timing-aware bake handoff. | The configured 33-test suite includes `bannerPreflight.test.ts`; live bake/install and G-Maiden renderer evidence remain open. | Partial |
| GOE-004 HUD event preview | Figma editor spec, Required interactions | `OverlayLab.tsx` previews a selected event on a HUD reference. | `BannerEditor.test.tsx` verifies the local 3.5-second preview state; full selected-event-over-target-HUD runtime parity remains unproven. | Partial |
| GOE-005 Private cloud sync | Figma editor spec, Private cloud sync, approved threat model | `src/lib/cloudSync.ts` implements the allowlisted projection, manifest validation, signed-out/offline result, revision compare-and-update, and private asset upload path; G-Maiden `supabase/` owns the migration. Hosted deployment is not enabled. | `src/lib/cloudSync.test.ts` covers projection, forbidden data, MIME/hash, timing, and data URLs; `supabase/tests/goe005_private_cloud_sync.sql` covers RLS/grants/path/conflict assertions. | Partial — local contract implemented, hosted evidence pending |

## G-AnnStudio standalone runtime readiness — issue #5

| Req ID | Defined in | Current code | Tests | Status |
| --- | --- | --- | --- | --- |
| ANN-RUNTIME-001 Runtime resolution and health | PRD-SDD v0.1 FR-006/FR-009; runtime safety spec | Tauri resolves explicit paths, app-local sidecar environment, `AI_STUDIO_TOOLS_DIR`, packaged scripts, and PATH; Settings reports executable versions, scripts, and installed module metadata without model inference. The UI explains that it does not verify model files or run transcription/image analysis. | Focused Rust tests pass 6/6. Native app launch and diagnostics pass with explicit FFmpeg, Python, and sidecar paths. Packaged-resource fallback is not exercised by this harness. | Partial — packaged fallback and model availability remain unverified |
| ANN-RUNTIME-002 Non-destructive media I/O | PRD-SDD v0.1 FR-007; runtime safety spec | Tauri imports to app cache and stages cut/export/install output; `create_new` publication preserves existing destinations. | Native Tauri IPC imports the synthetic WAV, cuts and exports it, and FFmpeg probes every output successfully. Collision attempts preserve existing output/manifest hashes; source fixture hash is unchanged. | Partial — verified synthetic WAV scope only |
| ANN-RUNTIME-003 Installation acknowledgment | PRD-SDD v0.1 FR-008; runtime safety spec | Manifest install reports local writes separately from G-Maiden endpoint acceptance/rejection/unavailability; legacy flat paths do not claim activation. Build-time endpoint override is restricted to HTTP loopback and `/announcer/install`; default remains port 3000. | Vitest endpoint resolver and ClipList component tests pass as part of 33 tests, covering accepted/rejected/unavailable UI notices. Native IPC writes to a disposable G-Maiden-shaped fixture; an owned loopback consumer returns accepted and HTTP-200 application-rejected responses and the command reports each correctly. | Partial — no live G-Maiden connection; unavailable response covered by frontend mock |
| ANN-RUNTIME-004 Sidecar package and CPU setup | PRD-SDD v0.1 FR-009; runtime safety spec | Tauri bundle declares Python scripts/requirements; setup script provisions CPU packages only, and desktop Whisper passes `--device cpu`. | Sidecar setup checks, CPU environment imports, focused Rust tests, and a debug custom-protocol build pass. Separate direct CPU Whisper and RapidOCR fixture runs pass; native Tauri IPC Whisper matches all 28 expected English words. The isolated-identifier native repeat uses explicit sidecar paths and omits model loading; packaged-resource discovery and native OCR are not verified. | Partial — release bundle, packaged fallback, and Thai/live media quality remain unverified |

## Existing local sync boundary

| Contract | Ann side | G-Maiden side | Tests | Status |
| --- | --- | --- | --- | --- |
| Overlay layout v1 | `overlayLayout.ts` invokes `sync_overlay_layout` | `POST /overlay/layout` validates and persists only `settings.layout` | Four GSI layout receiver unit tests | Current |

## Gaps before implementation

1. Group transform and rotation handles are still absent from the local editor.
2. History snapshots are bounded and pointer transforms are grouped; patch-command history is still a future refinement.
3. The local canvas previews the final layer composition over the HUD reference; it is not yet wired to the Ann Pack export path.
4. Animated WebP bake exists and export preflight validates the export plan, but source-video trim, composition, encoded-byte budget, per-layer timing rejection, bake-error handling, and runtime handoff remain open.
5. Private cloud sync has an approved identity, RLS/authorization, storage, conflict, and tombstone contract; migration, client tests, hosted cleanup, and live signed-URL evidence remain open.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-10 | beta | Initial scoped traceability matrix for the approved Figma-grade G-Overlay Lab scope. | pending | ATHER |
| 0.1.1 | 2026-08-10 | beta | Refreshed for the implemented local editor core and its remaining gaps. | pending | ATHER |
| 0.1.2 | 2026-08-10 | beta | Refreshed for group-aware canvas state and arrange interactions. | pending | ATHER |
| 0.1.3 | 2026-08-10 | beta | Refreshed for marquee selection coverage. | pending | ATHER |
| 0.1.4 | 2026-08-12 | beta | Corrected frontend test and export-plan preflight traceability; retained unimplemented layer-timing and bake-error gates. | pending | ATHER |
| 0.1.5 | 2026-08-12 | beta | Recorded the configured 18-test suite and current two-field timing/pure-preflight evidence; retained GOE-003 as partial. | pending | ATHER |
| 0.2.0 | 2026-08-14 | candidate | Added the approved private-cloud threat model as GOE-005 design authority; implementation/tests remain pending. | pending | ATHER |
| 0.3.0 | 2026-10-15 | candidate | Add standalone runtime readiness traceability for path diagnostics, non-destructive media operations, pack acknowledgment and sidecar setup under issue #5. | pending | Codex |
| 0.4.0 | 2026-10-15 | candidate | Track app-local CPU runtime resolution, current install-response contracts, collision-safe publication, and acceptance evidence gaps for issue #5. | pending | Codex |
| 0.5.0 | 2026-10-15 | candidate | Record loopback endpoint validation, the 33-test frontend suite, CPU fixture checks, and remaining native acceptance gates for issue #5. | pending | Codex |
| 0.6.0 | 2026-10-15 | candidate | Record focused Rust and native debug IPC acceptance, safe synthetic media outputs, accepted/rejected fixture installation, and remaining release/package/live-integration gates. | pending | Codex |
