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

1. Choose a Dota HUD reference or a local screenshot.
2. Select an event and press **Play event** to inspect its banner slot in context.
3. Drag, enable/disable, or scale overlay modules in the local draft.
4. **Restore default** replaces only the draft. **Sync to G-Maiden** is the sole action that changes G-Maiden.

## Acceptance criteria

- A kill/streak preview occupies the same `banner` slot that G-Maiden persists.
- A successful sync is acknowledged by G-Maiden and takes effect without restarting it.
- Invalid sync payloads leave the prior G-Maiden layout untouched.
- G-Ann remains useful without G-Maiden running; sync then reports a clear unavailable state.

## Changelog

| Version | Date | Summary |
| --- | --- | --- |
| 0.1.0 | 2026-08-10 | Approved v1 ownership, bounded layout contract, and sync behavior. |
