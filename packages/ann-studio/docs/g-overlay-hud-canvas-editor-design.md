---
title: "G-Overlay Lab: Real HUD Canvas Editor"
doc_id: "g-overlay-hud-canvas-editor"
status: "draft"
version: "0.1.0"
updated: "2026-10-22"
owner: "G-Suite / G-AnnStudio"
---

# G-Overlay Lab: Real HUD Canvas Editor

## Decision

Evolve the existing HUD surface in G-AnnStudio's G-Overlay Lab into a direct-manipulation editor for the actual 19-module G-Maiden HUD layout. Keep it inside G-AnnStudio and keep its data model as the existing OverlayLayout v1 contract.

The editor will use a module shelf, a Dota reference canvas, and a property inspector. Users can select an existing module, move it, resize it uniformly, toggle it, and inspect its coordinates. Changes remain a local draft until the user explicitly syncs them to a running G-Maiden instance.

The existing BannerEditor and its BannerProject remain a separate surface and model. This design does not move the feature into 3D Studio, add another application, or change the G-Maiden layout schema.

## Problem and current state

The HUD surface already provides:

- A 16:9 stage with a bundled Dota reference and optional user screenshot.
- Faithful visual mirrors of the G-Maiden HUD modules, populated with synthetic preview values.
- Direct drag positioning, enable toggles, uniform scale sliders, in-game/pre-game views, event preview, overlap warnings, and explicit Sync to G-Maiden.
- A local persisted OverlayLayout draft and a separate local screenshot stored in IndexedDB.

The current arrangement puts all controls in one module list beside the stage. It has no persistent selected-module state, numeric X/Y inspector, resize handle on the canvas, or undo/redo history for layout edits. A user can change the real layout, but the workflow does not yet provide the clear canvas-and-inspector interaction expected from a visual editor.

The rendered module previews are mirrors with synthetic content, not components imported from G-Maiden. The nominal module boxes and Dota HUD zones are approximate geometry. A user screenshot improves visual comparison, but the editor does not analyze pixels or identify HUD regions automatically.

## Goals

- Make the existing 19 runtime modules easy to find and select from either the module shelf or canvas.
- Make canvas movement and inspector edits update the same local draft.
- Provide a visible, uniform resize handle while preserving the runtime scale range.
- Make layout edits reversible and persistent without mixing them into BannerProject history.
- Make collision and HUD-zone warnings actionable and honest about their approximate geometry.
- Keep runtime changes explicit and confirm whether G-Maiden accepted the layout.

## Out of scope

- Creating, deleting, or replacing runtime modules. The runtime registry has a fixed set of 19 modules; the shelf selects and enables those modules.
- Independent width and height, rotation, arbitrary styling, colors, or custom components. Layout v1 supports only x, y, scale, and enabled. Such controls require a coordinated, versioned contract and renderer change.
- Automatic CV or image recognition of Dota controls.
- Reading live GSI, match, CV, audio, account, or G-Log data to populate the editor.
- Banner composition, BannerProject changes, cloud sync, collaborative editing, or 3D Studio migration.
- Changing G-Maiden's default positions as part of this editor design.

## Editor layout

### Top toolbar

Keep the current in-game/pre-game switch, screenshot picker, event selector, Play event, Restore default, and explicit Sync to G-Maiden action. Add Undo and Redo controls with disabled states when their histories are empty. Show the current local-draft and most recent sync outcome.

Restore default replaces the HUD draft and is undoable. It does not change G-Maiden until the user presses Sync.

### Module shelf

Show all 19 runtime modules in a scrollable list with:

- A readable module name and current enabled state.
- A selected state matching selection on the canvas.
- A visibility toggle.
- A short warning marker when the module has a known overlap on the selected screen.

The list is a catalog of existing runtime modules, not a drag-to-create palette. Selecting a disabled module still permits editing its position and scale; the module remains hidden in the stage until enabled.

### Canvas stage

Retain the 16:9 canvas, local screenshot, screen-mode switch, synthetic event preview, and existing module preview components. Selecting a module on the canvas selects its shelf row and inspector target. Selecting a shelf row highlights the same module on the canvas.

The selected module gets a clear selection outline, position label, and a single proportional resize handle. Dragging inside the module moves it. Dragging the handle changes uniform scale around the module center. Pointer gestures use pointer capture and commit as one history action on release.

Do not add permanent frames around every module. Preserve the current true-pixel preview sizing and hit-testing based on MODULE_BOX. Make stacking and selection indicators visible without hiding the preview itself.

### Property inspector

For the selected module, provide:

- Enabled toggle.
- X and Y fields in screen-relative percent, with the existing 0–100 limits and center-anchored coordinates.
- Uniform scale input and slider in the existing 0.60–1.60 range.
- Read-only nominal width and height at the 1920×1080 reference size, labeled approximate where content can vary.

All values are editable from the keyboard. Enter or blur commits a numeric edit; invalid or non-finite values are rejected locally and leave the last valid draft intact. Arrow keys nudge the selected coordinates by 0.1 percent; Shift plus an arrow nudges by 1 percent.

### Warnings

Keep blocked Dota zones, transient zones, accepted overlaps, and module-to-module collisions distinct. Clicking a warning selects the affected module and focuses it on the stage. Warnings describe the configured geometry; the bundled/reference screenshot is not an image-analysis input.

Because the geometry is approximate and some overlaps are intentional, warnings do not prevent Sync. The sync button still validates the v1 payload fields and ranges. The user makes the final placement decision.

## Layout model and editing history

The persisted layout remains a record of exactly these 19 modules:

alert, gmeter, toast, companion, advice, buyback, missing, banner, lowhp, vol, standby, clock, kda, gold, gpm, xpm, nw, score, hero.

Each module continues to store x, y, scale, and enabled. The module center is positioned in screen-relative percentages. The stage maps pointer coordinates to those same percentages.

Add a bounded history dedicated to OverlayLayout. Keep it separate from clip and BannerProject histories. Store enough recent layout snapshots with the existing local draft so undo remains available after an app restart; cap the history at 100 completed edits.

One history entry is created for each completed canvas move, resize, scale-slider gesture, inspector field commit, enabled toggle, or Restore default action. Selection, screenshot changes, screen mode, event preview, and Sync do not create layout history entries. Undo and redo change the local draft only.

Existing persisted OverlayLayout data must load without migration. If older persisted state has no overlay history fields, initialize empty histories and retain its current layout.

## Data flow and runtime boundary

1. The user edits the local OverlayLayout draft in G-AnnStudio.
2. Canvas preview, inspector, shelf, and warnings derive from that same draft.
3. No edit gesture makes a request to G-Maiden.
4. Only the explicit Sync to G-Maiden action invokes the existing Tauri sync command.
5. The command sends the complete v1 layout to the loopback G-Maiden endpoint. G-Maiden validates it, updates only its persisted settings.layout, and emits its normal settings event to the open overlay.
6. On failure or an offline G-Maiden instance, show the error and keep the local draft and history unchanged. Retry remains a user action; there is no background retry.

The request contains the existing layout only. A screenshot, module preview content, GSI state, CV output, audio, account information, and match logs never cross the seam.

The sync indicator reports local facts: unsynced edits in the current session, a sync in progress, the last accepted sync, or the last failure. Since the current contract has no read-back endpoint, G-AnnStudio must not claim that it has compared the draft with the live G-Maiden layout.

## Relationship to existing documents and interfaces

- The existing g-overlay-lab.md remains the contract and user flow for OverlayLayout v1 and explicit sync.
- The existing g-overlay-lab-figma-editor-spec.md remains the design for BannerProject and the banner authoring surface. This document scopes only the real HUD layout surface.
- The schema at schemas/gmaiden-overlay-layout.schema.json remains version 1 and unchanged.
- The G-Maiden route, settings behavior, and runtime renderer remain unchanged.
- The layout editor stays in G-AnnStudio. BannerEditor remains an independent surface, even if both surfaces reuse generic selection, inspector, or history primitives later.

## Acceptance criteria

1. All 19 runtime modules appear in the shelf. Selecting a module from the shelf or canvas shows the same selection and inspector values.
2. Dragging a module and editing its X/Y fields produce the same center-anchored position. Values remain within the schema's 0–100 range.
3. The canvas resize handle and inspector control change uniform scale only, remain within 0.60–1.60, and preserve the module center.
4. A completed move, resize, scale gesture, field commit, toggle, or restore is one undoable action. Undo and redo restore the exact prior layout draft, with a maximum of 100 completed edits.
5. Layout edits and history survive an app restart. Existing persisted v1 layouts still load unchanged.
6. A local screenshot remains local, is not included in the sync request, and does not replace the standard layout model.
7. The selected screen's known overlap warnings identify affected modules and distinguish blocked areas, transient areas, accepted overlaps, and module collisions.
8. No layout request occurs during editing. A successful explicit sync is acknowledged; an offline or rejected sync leaves G-Maiden's last accepted layout untouched and preserves the draft for retry.
9. The serialized request contains all 19 modules and only the schema v1 fields. No G-Maiden code or shared contract change is required for this MVP.
10. Manual in-game acceptance uses a 16:9 capture from the target Dota resolution and HUD configuration, including the supplied gameplay view where the death/voice card covers the center of the screen. Identify the existing module that renders that card, position it clear of Dota controls, explicitly sync, and confirm the live overlay moved. A synthetic canvas preview alone does not satisfy this criterion. Non-16:9 support is outside this MVP.

## Implementation boundaries

Likely G-AnnStudio areas:

- OverlayLab.tsx: organize the HUD surface into toolbar, module shelf, canvas, inspector, and warning views.
- OverlayModulePreview.tsx and overlayLayout.ts: retain the preview mirror and v1 geometry; adjust only what the editor needs.
- useStudioStore.ts: add isolated, bounded OverlayLayout history and persist it with the local draft.
- Small focused HUD editor components may be extracted from OverlayLab when that makes the shelf, stage, inspector, or history easier to understand.

Do not modify BannerProject, cloud sync, the G-Maiden runtime, or the layout schema for this scope.

## Changelog

| Version | Date | Summary |
| --- | --- | --- |
| 0.1.0 | 2026-10-22 | Drafted the G-Maiden HUD canvas editor scope on OverlayLayout v1. |
