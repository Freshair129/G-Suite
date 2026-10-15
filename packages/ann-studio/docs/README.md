---
version: "0.6.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-10-15T00:00:00+07:00,Codex"
status: "beta"
attributes:
  doc_type: "documentation-index"
  scope: "G-AnnStudio"
---

# G-AnnStudio Documentation

This is the canonical documentation hub for the G-AnnStudio desktop authoring tool. Code is the runtime truth; the design documents record approved intent and acceptance boundaries.

## Start here

- [PRD-SDD v0.1](PRD-SDD-v0.1.md) — product, requirements, design, and quality strategy.
- [Architecture](ARCHITECTURE.md) — components, boundaries, and design decisions.
- [Frontend design system](frontend-design-system.md) — editor interaction and visual rules.
- [API index](api/README.md) — local G-Maiden integration.

## Feature and proposal documents

- [G-Overlay Lab sync](g-overlay-lab.md)
- [G-Overlay Lab Figma-grade editor](g-overlay-lab-figma-editor-spec.md)
- [Private cloud threat model and RLS contract](gann-cloud-threat-model.md)
- [Motion export contract draft](motion-export-contract-draft.md)
- [Content-type taxonomy](content-taxonomy.md)
- [Standalone runtime safety specification](g-annstudio-runtime-safety-spec.md)
- [Standalone runtime readiness RCA](rca/2026-10-15-standalone-runtime-readiness.md)

## Appendices

- [A — API specification](appendices/A-api-spec.md)
- [B — local project schema](appendices/B-local-project-schema.md)
- [D — traceability](appendices/D-traceability.md)
- [E — risk matrix](appendices/E-risk-matrix.md)
- [F — glossary](appendices/F-glossary.md)

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Established the canonical 3-Layer + Appendix documentation hub. | pending | ATHER |
| 0.1.1 | 2026-08-11 | beta | Indexed the candidate Sprint 2 motion export contract. | pending | ATHER |
| 0.2.0 | 2026-08-14 | candidate | Indexed the approved private-cloud threat model and RLS contract. | pending | ATHER |
| 0.3.0 | 2026-10-15 | candidate | Linked standalone runtime health, safe media writes, and truthful G-Maiden install status specification and RCA for issue #5. | pending | Codex |
| 0.4.0 | 2026-10-15 | candidate | Updated the standalone-runtime links for configured tools, sidecar setup, CPU default, non-overwriting exports, and activation results. | pending | Codex |
| 0.5.0 | 2026-10-15 | candidate | Record loopback-only acceptance endpoint validation and current frontend evidence; native command acceptance remains pending. | pending | Codex |
| 0.6.0 | 2026-10-15 | candidate | Record 6/6 focused Rust tests, 33 frontend tests, and native debug IPC/media/pack acceptance; packaged-resource, release, and live-integration evidence remains open. | pending | Codex |
