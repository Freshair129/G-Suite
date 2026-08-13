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
- Keep HUD layout sync separate from banner-project persistence and the approved private cloud sync.
- Update the linked requirement, traceability matrix, and document graph for feature-boundary changes.
- Do not add a cloud provider, credential, or public sharing surface outside the approved [private cloud threat model](gann-cloud-threat-model.md). Schema migrations and client sync are allowed only within that contract, through the G-Maiden `gstore` migration authority and with the required RLS/pgTAP evidence.

## Validation

Run `pnpm exec tsc --noEmit` from `src/`. Run the relevant Tauri/Rust checks when Rust changes. Record any build or local-model verification timeout as a gap; do not call it green.

## Documentation workflow

Use [PRD-SDD v0.1](PRD-SDD-v0.1.md) for requirements and design decisions. Keep feature detail in its own specification. Update [traceability](appendices/D-traceability.md) and `docs/.doc-graph.json` after changes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Added contribution and validation guidance for the approved document structure. | pending | ATHER |
| 0.2.0 | 2026-08-14 | candidate | Bound cloud changes to the approved threat model/RLS contract and migration authority. | pending | ATHER |
