---
version: "0.1.0"
status: "approved"
updated: "2026-08-10"
scope: "G-AnnStudio to G-Maiden overlay-layout sync"
---

# G-Overlay Lab

G-Overlay Lab is a dedicated G-AnnStudio view for arranging G-Maiden's passive Combat HUD before a match. G-Ann owns the editable draft and event simulation. G-Maiden owns persisted settings and the live overlay.

## Contract

- Payload: [`gmaiden-overlay-layout.schema.json`](../../../schemas/gmaiden-overlay-layout.schema.json), version `1`.
- Transport: `POST http://127.0.0.1:3000/overlay/layout`.
- G-Ann sends all 19 known modules. Every position is screen-relative percent, `x/y` are 0–100, and `scale` is 0.60–1.60.
- G-Maiden rejects an unknown, partial, non-finite, or out-of-range layout. On success it changes only `settings.layout`, writes its normal atomic settings file, and emits the normal `settings` event to the open Combat HUD.
- The payload contains no match state, CV result, audio asset, account data, or file path.

## Interaction

1. Choose the in-game or pre-game Dota reference, or load a local screenshot stored on this device.
2. Select a module from the 19-module shelf or directly on the canvas. The inspector edits its enabled state, position, and scale; drag to move and use the canvas handle or inspector slider to resize.
3. Select an event and press **Play event** to inspect its banner slot in context. The banner editor remains a separate surface and project.
4. Blocked Dota HUD regions, transient kill-feed regions, intentional overlaps, and overlapping modules appear as warnings. Select a warning to focus its module; warnings are guidance and do not block Sync.
5. **Undo**, **Redo**, and **Restore default** operate on the HUD draft history, independently of banner history. Numeric edits and completed canvas gestures enter that history; an in-progress drag or resize is preview-only until released.
6. The draft is local until **Sync to G-Maiden** is pressed. That explicit action sends all 19 layout entries; editing, previewing an event, and selecting a screenshot do not send anything. The screenshot remains on this device and is not part of the sync payload.
7. Status distinguishes an unverified draft, an active request, an accepted request, and a failed request. Acceptance is the response to the sync request; the seam has no live layout read-back, so it does not compare the editor draft with G-Maiden's current state. A failure leaves the draft and its undo/redo history available for correction and retry.

## Acceptance criteria

- A kill/streak preview occupies the same `banner` slot that G-Maiden persists.
- A successful sync is acknowledged by G-Maiden and takes effect without restarting it.
- Invalid sync payloads leave the prior G-Maiden layout untouched.
- G-Ann remains useful without G-Maiden running; sync then reports a clear unavailable state.

## Changelog

| Version | Date | Summary |
| --- | --- | --- |
| 0.1.0 | 2026-08-10 | Approved v1 ownership, bounded layout contract, and sync behavior. |
