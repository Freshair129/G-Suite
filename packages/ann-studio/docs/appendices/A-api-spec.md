---
version: "0.1.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-11T00:00:00+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "api-specification"
  scope: "G-AnnStudio to G-Maiden"
---

# Appendix A — Local API Specification

## Overlay layout sync v1

| Field | Value |
| --- | --- |
| Caller | G-AnnStudio Tauri command `sync_overlay_layout` |
| Receiver | G-Maiden GSI server |
| Transport | `POST http://127.0.0.1:3000/overlay/layout` |
| Payload | [`gmaiden-overlay-layout.schema.json`](../../../../schemas/gmaiden-overlay-layout.schema.json) |
| Side effect | G-Maiden updates only persisted `settings.layout` after validation |

The layout has all 19 known module IDs. Coordinates are screen-relative percentages and scale is bounded from 0.60 to 1.60. Unknown, partial, non-finite, or out-of-range layouts are rejected without changing existing settings.

## Exclusions

This API carries no banner media, raw video, game state, CV, G-Log, account data, cloud credential, or local source-file path. Banner-project cloud sync has no API specification because it is not approved for implementation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Extracted the approved local layout sync contract into the appendix. | pending | ATHER |
