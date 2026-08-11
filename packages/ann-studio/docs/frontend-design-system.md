---
version: "0.1.0"
created_at: "2026-08-11T00:00:00+07:00,ATHER"
last_update: "2026-08-11T00:00:00+07:00,ATHER"
status: "beta"
attributes:
  doc_type: "frontend-design-system"
  scope: "G-AnnStudio editor surfaces"
---

# G-AnnStudio Frontend Design System

## Editor shell

The primary composition surface has an asset rail, layer tree, canvas, inspector, and explicit handoff controls. It is inspired by professional design-editor interaction patterns, not by copied branding or assets.

## Interaction rules

- Canvas and numeric inspector must express the same transform state.
- Selection must remain available from the layer tree for keyboard users.
- Visibility, lock, group, reorder, duplicate, undo/redo, and destructive actions require labels or accessible names.
- Lime indicates active authoring action; it must not be the only state signal.
- HUD references are a clearance guide, not simulated game state.

## Accessibility baseline

Visible focus, keyboard-operable controls, labeled icon buttons, non-color-only state, and reduced-motion-friendly previews are required. A canvas-only interaction is not sufficient.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0 | 2026-08-11 | beta | Documented the local editor shell and accessibility baseline. | pending | ATHER |
