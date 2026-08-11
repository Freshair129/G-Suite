---
version: "0.1.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-11T00:00:00+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "contributing-guide"
  scope: "G-AnnStudio"
---

# Contributing to G-AnnStudio

## Change rules

- Preserve the local-only boundary: never add game-data egress.
- Keep HUD layout sync separate from banner-project persistence or future cloud sync.
- Update the linked requirement, traceability matrix, and document graph for feature-boundary changes.
- Do not add a cloud provider, credential, schema migration, or public sharing surface without an approved C-3/HIGH design gate.

## Validation

Run `pnpm exec tsc --noEmit` from `src/`. Run the relevant Tauri/Rust checks when Rust changes. Record any build or local-model verification timeout as a gap; do not call it green.

## Documentation workflow

Use [PRD-SDD v0.1](PRD-SDD-v0.1.md) for requirements and design decisions. Keep feature detail in its own specification. Update [traceability](appendices/D-traceability.md) and `docs/.doc-graph.json` after changes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Added contribution and validation guidance for the approved document structure. | pending | ATHER |
