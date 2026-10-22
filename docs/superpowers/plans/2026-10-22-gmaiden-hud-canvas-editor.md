# Real G-Maiden HUD Canvas Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Turn G-AnnStudio's existing HUD surface into a canvas editor for arranging, uniformly scaling, and syncing the 19 real G-Maiden HUD modules.

**Architecture:** Keep OverlayLayout v1 as the sole runtime model. Compose the existing 16:9 Dota reference stage with a fixed module shelf, a property inspector, and actionable overlap warnings. Persist only completed edits and bounded history; keep pointer previews local to the active view; send the complete layout only after an explicit sync action.

**Tech Stack:** React 18, TypeScript, Zustand 4 persist, Tauri v2, Vitest 2, jsdom, and Testing Library 16. No new dependencies.

**Spec:** packages/ann-studio/docs/g-overlay-hud-canvas-editor-design.md

## Global Constraints

- Keep the existing fixed 19-module registry and schemaVersion 1 payload unchanged.
- Each module stores only x, y, scale, and enabled; x/y stay within 0–100 and scale within 0.60–1.60.
- The module anchor remains its center; scale remains uniform.
- Keep the reference stage at 16:9 and the nominal module geometry measured for 1920×1080; non-16:9 support is outside this MVP.
- Keep screenshots in local IndexedDB. Never include screenshots, GSI, match, CV, audio, account, or G-Log data in the sync request.
- Only the explicit Sync action calls the existing Tauri command and POSTs to http://127.0.0.1:3000/overlay/layout.
- G-Maiden remains the runtime owner; its route, settings behavior, renderer, and schema are unchanged.
- Keep BannerEditor, BannerProject, cloud sync, and 3D Studio outside this change.
- Limit each layout undo or redo history to 100 committed edits; do not change the other editor histories.

## Review Focus

1. Blank, NaN, Infinity, and out-of-range X/Y/scale input must leave the current draft unchanged. Pin with OverlayLayout numeric parsing and OverlayInspector tests in Task 2.
2. Pointer movement at each stage edge must clamp the center coordinates to 0–100 without producing non-finite values. Pin with geometry tests in Task 3.
3. Resize attempts below 0.60 or above 1.60 must clamp at the limit and preserve x/y. Pin with scale geometry and stage tests in Task 3.
4. A persisted v1 project with no overlay history fields must retain its saved layout and initialize empty history. Pin with hydration tests in Task 1.
5. G-Maiden offline/rejection and a loaded screenshot must never mutate the saved draft or trigger a request during editing; only explicit sync sends layout v1. Pin with OverlayLab integration tests in Task 5.

---

## Execution Preflight

The implementation checkout must include the already-requested PNPM 11 contract before running the commands below: root and AnnStudio packageManager set to pnpm@11.25.0, Node engine at least 22, and esbuild allowed in pnpm-workspace.yaml. The separate D:\G-Suite checkout currently holds those four uncommitted migration files; preserve them and keep them out of HUD feature commits. Confirm corepack pnpm --version reports 11.25.0 before implementation verification.

## File Map

- packages/ann-studio/src/src/store/useStudioStore.ts: owns persisted OverlayLayout and its isolated history.
- packages/ann-studio/src/src/lib/overlayLayout.ts: owns v1 module IDs, limits, numeric parsing, and warning geometry.
- packages/ann-studio/src/src/lib/overlayCanvasGeometry.ts: pure screen-point and uniform-scale calculations.
- packages/ann-studio/src/src/components/OverlayModuleShelf.tsx: fixed module list, selection, enabled state, warning markers.
- packages/ann-studio/src/src/components/OverlayInspector.tsx: keyboard-accessible enabled, X, Y, and scale controls.
- packages/ann-studio/src/src/components/OverlayCanvasStage.tsx: reference image, mirrored module previews, selection, move, and resize.
- packages/ann-studio/src/src/components/OverlayConflictList.tsx: blocked, transient, accepted, and module collision messages.
- packages/ann-studio/src/src/components/OverlayLab.tsx: composes toolbar and HUD editor surfaces; owns temporary gesture state and explicit sync status.
- packages/ann-studio/docs/g-overlay-lab.md: describes the updated HUD authoring workflow and v1 boundary.

## Implementation Tasks

### Task 1: Add isolated OverlayLayout history

**Files:**
- Modify: packages/ann-studio/src/src/store/useStudioStore.ts
- Modify: packages/ann-studio/src/src/store/useStudioStore.test.ts

**Interfaces:**
- Consumes: OverlayLayout from src/lib/overlayLayout.ts.
- Produces:
  - State: pastOverlayLayouts: OverlayLayout[], futureOverlayLayouts: OverlayLayout[].
  - setOverlayLayout(layout: OverlayLayout): void records one atomic edit.
  - undoOverlayLayout(): void and redoOverlayLayout(): void restore exact snapshots.
- Preserve the existing setOverlayLayout name so the HUD view remains the store consumer.

- [ ] **Step 1: Add failing store tests**
  Add tests named records_and_undoes_an_atomic_overlay_layout_edit, caps_overlay_history_at_100_and_clears_redo_after_a_new_edit, keeps_overlay_history_separate_from_banner_history, and rehydrates_legacy_layout_without_history_fields. Assert exact full-layout equality across undo/redo, equal layouts create no history, at most 100 prior snapshots, an empty future stack after a new edit, unchanged BannerProject history, and preservation of a legacy stored layout with empty new stacks.

- [ ] **Step 2: Run the focused store tests and confirm they fail**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/store/useStudioStore.test.ts
  Expected: FAIL because the overlay history state and actions do not exist.

- [ ] **Step 3: Implement OverlayLayout history in the Zustand store**
  Add a separate OVERLAY_LAYOUT_HISTORY_MAX = 100; deep-clone module entries when saving snapshots; make equal-layout edits no-ops; clear redo after a new edit; include both history arrays in persist partialization. Leave clip and BannerProject history limits and behavior unchanged.

- [ ] **Step 4: Run the focused store tests**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/store/useStudioStore.test.ts
  Expected: PASS, including rehydration when persisted state contains layout but no history arrays.

- [ ] **Step 5: Commit**
  Stage only the two files above.
  Commit: feat(ann-studio): add HUD layout history

### Task 2: Build the module shelf and property inspector

**Files:**
- Create: packages/ann-studio/src/src/components/OverlayModuleShelf.tsx
- Create: packages/ann-studio/src/src/components/OverlayModuleShelf.test.tsx
- Create: packages/ann-studio/src/src/components/OverlayInspector.tsx
- Create: packages/ann-studio/src/src/components/OverlayInspector.test.tsx
- Modify: packages/ann-studio/src/src/lib/overlayLayout.ts
- Create: packages/ann-studio/src/src/lib/overlayLayout.test.ts
- Modify: packages/ann-studio/src/src/components/OverlayLab.tsx

**Interfaces:**
- OverlayModuleShelf receives layout, selectedId, onSelect(id), and onToggle(id, enabled).
- OverlayInspector receives selectedId, layout, and callbacks onCommit(id, patch), onPreview(id, patch), onGestureStart(), and onGestureEnd().
- parseLayoutNumber(raw, min, max): number | null parses a non-empty finite number within inclusive limits.
- Selection is view-local and shared by shelf, stage, and inspector; it is not part of OverlayLayout persistence.

- [ ] **Step 1: Add failing shelf, inspector, and input-parser tests**
  Assert the shelf renders all 19 registry entries, shelf selection calls onSelect, and toggles call onToggle without selecting a different module. Assert valid numeric edits commit the requested field and blank, NaN, Infinity, X/Y below 0 or above 100, and scale below 0.60 or above 1.60 do not commit. Assert disabled modules remain selectable and editable. Assert Arrow nudges X/Y by 0.1 percent and Shift+Arrow nudges by 1 percent, creating one committed edit per key action.

  Example parser assertions:
  ~~~ts
  expect(parseLayoutNumber("42.5", 0, 100)).toBe(42.5);
  expect(parseLayoutNumber("", 0, 100)).toBeNull();
  expect(parseLayoutNumber("Infinity", 0, 100)).toBeNull();
  expect(parseLayoutNumber("1.61", 0.6, 1.6)).toBeNull();
  ~~~

- [ ] **Step 2: Run the focused tests and confirm they fail**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/lib/overlayLayout.test.ts src/components/OverlayModuleShelf.test.tsx src/components/OverlayInspector.test.tsx
  Expected: FAIL because the parser and components are not implemented.

- [ ] **Step 3: Implement the v1 numeric parser and focused editor components**
  Use accessible labels Position X (%), Position Y (%), Scale, and Enabled. Keep incomplete text in component-local input state; commit parsed values on Enter or blur. Show computed nominal 1920×1080 dimensions as read-only approximate values.

- [ ] **Step 4: Recompose the HUD view around selection, shelf, and inspector**
  Update OverlayLab.tsx to use a three-surface layout while retaining its existing Dota reference, local screenshot, screen switch, event preview, and explicit sync control. Pass one selected module ID to the shelf and inspector. Keep BannerEditor routing unchanged.

- [ ] **Step 5: Run focused shelf, inspector, and parser tests**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/lib/overlayLayout.test.ts src/components/OverlayModuleShelf.test.tsx src/components/OverlayInspector.test.tsx
  Expected: PASS; invalid input never reaches the store.

- [ ] **Step 6: Commit**
  Stage only the files listed for this task.
  Commit: feat(ann-studio): add HUD module inspector

### Task 3: Add canvas selection, movement, and uniform resize

**Files:**
- Create: packages/ann-studio/src/src/lib/overlayCanvasGeometry.ts
- Create: packages/ann-studio/src/src/lib/overlayCanvasGeometry.test.ts
- Create: packages/ann-studio/src/src/components/OverlayCanvasStage.tsx
- Create: packages/ann-studio/src/src/components/OverlayCanvasStage.test.tsx
- Modify: packages/ann-studio/src/src/components/OverlayLab.tsx

**Interfaces:**
- pointerToLayoutPercent(point, rect): { x: number; y: number } maps a client point to center-anchored screen percent, rounds to 0.1, and clamps each coordinate to 0–100.
- scaleFromPointerDrag(startScale, center, initialPointer, currentPointer): number scales uniformly by the distance ratio from the module center, with a 0.60–1.60 clamp.
- OverlayCanvasStage receives the layout, selected ID, screen mode, screenshot URL, preview state, and callbacks for selection, preview layout, gesture commit, and gesture cancel.
- OverlayLab owns an ephemeral gesture layout. Pointer move updates that local draft; pointer release commits one store edit; pointer cancel discards it. No store write or history entry occurs on each pointer move.

- [ ] **Step 1: Add failing geometry and stage tests**
  Test pointer conversion at all four edges and outside the stage; expect finite values clamped to 0 or 100. Test scale below and above bounds, proportional scale change, and unchanged module center. Test canvas selection synchronizes with the selected ID and one completed drag creates exactly one store history entry.

  Example geometry assertions:
  ~~~ts
  expect(pointerToLayoutPercent({ x: -5, y: 120 }, rect)).toEqual({ x: 0, y: 100 });
  expect(scaleFromPointerDrag(1, center, initialHandle, farHandle)).toBeLessThanOrEqual(1.6);
  ~~~

- [ ] **Step 2: Run the focused tests and confirm they fail**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/lib/overlayCanvasGeometry.test.ts src/components/OverlayCanvasStage.test.tsx
  Expected: FAIL because geometry helpers and the stage component do not exist.

- [ ] **Step 3: Implement deterministic pointer and scale helpers**
  Keep DOM measurement outside the pure helpers. Return only finite percentages and clamp scale to the v1 range. If the initial handle distance is zero, return the starting scale.

- [ ] **Step 4: Implement OverlayCanvasStage**
  Render existing OverlayModulePreview instances over the selected 16:9 reference. Select on pointer down, move from the module center, and show one proportional handle for the selected module. Use pointer capture and expose preview/commit/cancel callbacks.

- [ ] **Step 5: Integrate transient gesture state into OverlayLab**
  Synchronize stage previews with shelf and inspector values. On pointer release call the store's atomic setOverlayLayout once; on pointer cancel restore the stored layout. Keep the persisted draft untouched during the gesture.

- [ ] **Step 6: Run focused geometry and stage tests**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/lib/overlayCanvasGeometry.test.ts src/components/OverlayCanvasStage.test.tsx
  Expected: PASS, with one history entry per completed pointer gesture and none for a canceled gesture.

- [ ] **Step 7: Commit**
  Stage only the files listed for this task.
  Commit: feat(ann-studio): add HUD canvas transforms

### Task 4: Add actionable overlap warnings

**Files:**
- Create: packages/ann-studio/src/src/components/OverlayConflictList.tsx
- Create: packages/ann-studio/src/src/components/OverlayConflictList.test.tsx
- Modify: packages/ann-studio/src/src/lib/overlayLayout.ts
- Modify: packages/ann-studio/src/src/lib/overlayLayout.test.ts
- Modify: packages/ann-studio/src/src/components/OverlayModuleShelf.tsx
- Modify: packages/ann-studio/src/src/components/OverlayLab.tsx

**Interfaces:**
- OverlayConflictItem contains moduleId, kind (blocked, transient, accepted, or module), and a human-readable message; module-pair conflicts also contain otherModuleId.
- getOverlayConflictItems(layout, screen): OverlayConflictItem[] derives warnings from existing zone, accepted-overlap, and module-collision rules.
- OverlayConflictList receives items and onSelect(moduleId).

- [ ] **Step 1: Add failing warning tests**
  Test blocked, transient, accepted, and module-to-module items. Test that clicking each item selects its module and that the shelf marks modules with active warnings. Verify the pre-game/in-game mode uses only modules visible on that screen.

- [ ] **Step 2: Run focused warning tests and confirm they fail**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/components/OverlayConflictList.test.tsx src/lib/overlayLayout.test.ts
  Expected: FAIL because conflict derivation and the warning component do not exist.

- [ ] **Step 3: Implement typed conflict derivation**
  Add getOverlayConflictItems(layout, screen) beside the existing geometry helpers. Filter both zone and module-pair checks through modulesOnScreen(screen), so hidden modules do not create false warnings. Preserve blocked versus transient semantics, accepted-overlap reasons, and the existing mutual-exclusion rules. Do not turn warnings into sync blockers.

- [ ] **Step 4: Implement warning display and module navigation**
  Render each conflict kind distinctly. Clicking an item selects its primary module and focuses it on the stage; pair items retain the other module ID in their message and data.

- [ ] **Step 5: Run focused warning tests**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/components/OverlayConflictList.test.tsx src/lib/overlayLayout.test.ts
  Expected: PASS, including screen-specific visibility and all four warning kinds.

- [ ] **Step 6: Commit**
  Stage only the files listed for this task.
  Commit: feat(ann-studio): add actionable HUD overlap warnings

### Task 5: Add explicit sync feedback and complete the HUD workflow

**Files:**
- Create: packages/ann-studio/src/src/components/OverlayLab.test.tsx
- Modify: packages/ann-studio/src/src/components/OverlayLab.tsx
- Modify: packages/ann-studio/docs/g-overlay-lab.md

**Interfaces:**
- Continue calling syncOverlayLayout(layout) from src/lib/overlayLayout.ts.
- Sync status is view-local and reports draft/unverified, syncing, last accepted sync, or last failure. It never claims a comparison with live state because the seam has no read-back endpoint.

- [ ] **Step 1: Add failing sync and toolbar tests**
  Mock syncOverlayLayout. Assert edits, preview, screenshot selection, and Restore default do not call it. Assert one explicit Sync click sends the complete 19-module layout only, without screenshot data. Assert a successful response updates the status and an offline/rejected response shows an error while retaining the draft and history. Assert a fresh app session reports the draft as unverified this session. Assert Undo/Redo enabled states follow their store stacks.

- [ ] **Step 2: Run the focused integration tests and confirm they fail**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/components/OverlayLab.test.tsx
  Expected: FAIL because sync status, history controls, and the integration tests do not exist.

- [ ] **Step 3: Implement explicit sync status and toolbar controls**
  Add Undo and Redo buttons disabled when their stacks are empty. Keep Restore default undoable. Show draft/unverified, syncing, last accepted sync, and last failure states. Sync only from the explicit button; preserve draft/history on all failures.

- [ ] **Step 4: Update the HUD workflow documentation**
  Update g-overlay-lab.md with the module shelf, inspector, canvas resize, history, warnings, local screenshot, and sync behavior. Keep the v1 transport and privacy boundary unchanged.

- [ ] **Step 5: Run the focused integration tests**
  Run: corepack pnpm -C packages/ann-studio/src exec vitest run src/components/OverlayLab.test.tsx
  Expected: PASS, including no request during editing and draft retention on offline/rejected sync.

- [ ] **Step 6: Commit**
  Stage only the files listed for this task.
  Commit: feat(ann-studio): add explicit HUD sync feedback

### Task 6: Run repository verification and live-layout acceptance

**Files:**
- No additional source files.

- [ ] **Step 1: Run the complete AnnStudio Vitest suite**
  Run: corepack pnpm -C packages/ann-studio/src test
  Expected: all tests pass.

- [ ] **Step 2: Run the TypeScript check**
  Run: corepack pnpm -C packages/ann-studio/src exec tsc --noEmit
  Expected: zero TypeScript errors.

- [ ] **Step 3: Run the AnnStudio build**
  Run: corepack pnpm ann-studio:build
  Expected: frontend and Tauri release build succeed.

- [ ] **Step 4: Perform the manual 16:9 Dota acceptance**
  Load a local target-resolution screenshot, including the supplied gameplay view with the central death/voice card. Identify its existing runtime module, move the preview clear of Dota controls, sync explicitly to the running G-Maiden instance, and confirm the live overlay moves. Confirm the screenshot did not leave G-AnnStudio. Record separately whether the real Dota run was completed; a synthetic preview or host build is not live-game acceptance.

- [ ] **Step 5: Review the final diff**
  Run: git diff --check and review the exact changed paths. Expected: only the planned HUD implementation files, g-overlay-lab.md, and the approved spec and plan documents changed; no schema, Rust runtime, BannerProject, cloud, package-manager, or user-owned unrelated files changed.
