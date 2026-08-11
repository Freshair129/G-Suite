---
version: "0.1.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-11T00:00:00+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "local-project-schema"
  scope: "G-Overlay Lab BannerProject"
---

# Appendix B — Local Banner Project Schema

`BannerProject` is a persisted local authoring model, separate from the 19-module `OverlayLayout` draft.

| Entity | Required fields | Notes |
| --- | --- | --- |
| Project | schemaVersion, id, title, eventId, artboard, assets, layers, revision | Current schema version is 1. |
| Asset | id, name, kind, mime, source | Imported asset source remains authoring data. |
| Layer | id, kind, name, parentId, order, visible, locked, transform, style, content | `kind` is group, text, shape, image, svg, or video. |
| Transform | x, y, width, height, rotation, opacity | Canvas and inspector edit the same transform. |

The current localStorage baseline accepts imported assets up to 3 MB. This is a safe provisional limit, not a cloud-storage quota or export budget.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Added the local BannerProject schema appendix. | pending | ATHER |
