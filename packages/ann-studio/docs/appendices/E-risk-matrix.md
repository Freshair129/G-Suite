---
version: "0.1.1"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-12T00:00:00+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "risk-matrix"
  scope: "G-AnnStudio"
---

# Appendix E — Risk Matrix

| ID | Risk | Impact | Control | Status |
| --- | --- | --- | --- | --- |
| R-001 | Author accidentally changes live overlay | High | Draft and explicit Sync to G-Maiden are separate | Controlled |
| R-002 | Raw video reaches G-Maiden runtime | High | Runtime-safe static/animated export boundary; pure, unwired candidate preflight | Partial — encoded-byte approval, bake/install wiring, and runtime handoff remain open |
| R-003 | Local storage quota corrupts a draft | Medium | 3 MB imported-asset cap and bounded history | Partial — file-backed store open |
| R-004 | Cloud sync exposes private author work or game data | High | No cloud implementation; future C-3/HIGH gate | Controlled by exclusion |
| R-005 | Editor behavior regresses without tests | Medium | Type-check, alignment, and configured focused Vitest suite (18 tests across four files) | Partial — focused behavior is covered; bake/install/runtime handoff remains unverified |
| R-006 | Documentation drifts from implementation | Medium | Doc graph, traceability, preflight, code-doc alignment | Partial — structured annotations open |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Created initial editor, handoff, privacy, and verification risk matrix. | pending | ATHER |
| 0.1.1 | 2026-08-12 | beta | Corrected focused-test and pure-preflight controls; retained export and handoff gaps. | pending | ATHER |
