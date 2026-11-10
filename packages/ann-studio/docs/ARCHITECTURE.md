---
version: "0.2.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-14T00:00:00+07:00,ATHER"
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
| G-Maiden sync receiver | Validates and persists only HUD layout geometry | Loopback port discovered from `%LOCALAPPDATA%/G-Maiden/gsi-port.txt`; verified with `GET /health` |
| Private cloud sync (approved contract) | Owner-only project manifest and author-asset persistence | Supabase `gstore`, `ann_` tables, private bucket |

## Key boundaries

1. `BannerProject` and `OverlayLayout` are different authoring models.
2. An Ann Pack may contain runtime-safe banner assets; raw video is authoring-only.
3. Layout sync sends no source paths, event media, game state, account data, or cloud credentials.
4. Private cloud sync is not a dependency of the local editor or G-Maiden runtime. Its approved provider boundary is the existing Supabase `gstore` project with dedicated `ann_` tables and a private `ann-project-assets` bucket.
5. The cloud projection contains only BannerProject metadata and opaque asset references. GSI, match, CV, G-Log, Steam, recovery, entitlement, and Google security data remain excluded.

## Decisions

- **ADR-ANN-001:** local-first authoring and persistence.
- **ADR-ANN-002:** direct manipulation and numeric inspector must edit the same layer transform.
- **ADR-ANN-003:** G-Maiden integration is an explicit local handoff, not implicit background synchronization.
- **ADR-ANN-004:** private cloud synchronization uses the approved C-3/HIGH contract in [the threat model](gann-cloud-threat-model.md): Google OAuth/Supabase Auth, `auth.uid()` owner RLS, private assets, tombstones, and revision conflicts. It never writes to G-Maiden runtime state.

## Verification boundary

TypeScript compilation validates the frontend type contract. The frontend also has a configured Vitest runner (`src/package.json`); the focused editor/project/preflight/cloud suite currently contains 27 cases after the approved cloud helper slice. `preflightBannerProject` is covered as a pure, export-plan-level check; layout receiver validation is owned by G-Maiden. Cloud sync is separately verified through manifest projection, forbidden-data, signed-out/offline, and RLS/pgTAP tests. Hosted migration, cleanup-worker retention, and live signed-URL evidence remain release-quality gates rather than evidence of production enablement.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Added G-AnnStudio component and boundary architecture. | pending | ATHER |
| 0.1.1 | 2026-08-12 | beta | Corrected frontend-test and export-preflight status to the current implementation boundary. | pending | ATHER |
| 0.2.0 | 2026-08-14 | candidate | Recorded the approved Supabase private-cloud boundary and retained local-first/runtime isolation. | pending | ATHER |
