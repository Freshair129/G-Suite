---
version: "0.1.1"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-12T00:00:00+07:00,ATHER"
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
| G-Maiden sync receiver | Validates and persists only HUD layout geometry | `127.0.0.1:3000` |

## Key boundaries

1. `BannerProject` and `OverlayLayout` are different authoring models.
2. An Ann Pack may contain runtime-safe banner assets; raw video is authoring-only.
3. Layout sync sends no source paths, event media, game state, account data, or cloud credentials.
4. Private cloud sync is not a dependency of the local editor and has no selected provider.

## Decisions

- **ADR-ANN-001:** local-first authoring and persistence.
- **ADR-ANN-002:** direct manipulation and numeric inspector must edit the same layer transform.
- **ADR-ANN-003:** G-Maiden integration is an explicit local handoff, not implicit background synchronization.
- **ADR-ANN-004:** future cloud synchronization requires a distinct C-3/HIGH contract.

## Verification boundary

TypeScript compilation validates the frontend type contract. The frontend also has a configured Vitest runner (`src/package.json`); the focused editor/project/preflight suite currently contains 18 cases. `preflightBannerProject` is covered as a pure, export-plan-level check: it validates duration, frame/fps, dimensions, assets, and decoder errors, but does not yet validate individual `BannerLayer.timing` values or encoder failure. Layout receiver validation is owned by G-Maiden. Encoded-byte measurement, bake wiring, and target-runtime handoff remain release-quality gates rather than evidence of a production-safe export.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Added G-AnnStudio component and boundary architecture. | pending | ATHER |
| 0.1.1 | 2026-08-12 | beta | Corrected frontend-test and export-preflight status to the current implementation boundary. | pending | ATHER |
