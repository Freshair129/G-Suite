---
version: "0.2.0b"
created_at: "2026-08-11T11:20:00+07:00,ATHER"
last_update: "2026-08-12T02:06:50+07:00,ATHER"
status: "candidate"
attributes:
  doc_type: "export-contract"
  scope: "G-Overlay Lab motion authoring to G-Maiden"
---

# G-Overlay Lab Motion Export Contract — Draft

## Decision status

This is the Sprint 2 contract proposal and partial implementation record. Optional per-layer timing, Start/End ms inspector fields, and read-only preflight now exist; this is not approval to implement a timeline, file-backed assets, or a new bake path. The encoded-byte limit remains deliberately unapproved until it is measured on the target G-Maiden runtime.

## Evidence used

- The existing generator bakes `420 × 120` logical banners at scale `2`, producing `840 × 240` frames.
- Existing entrance motion is `12` frames at `24 fps`; reactive motion is bounded to `8–48` frames at `18 fps` and `0.5–3.5` seconds.
- Rust accepts `1–60 fps` today, but this is an encoder capability, not an approved authoring budget.
- G-Maiden receives an image or baked animation; raw video is prohibited at runtime.
- `preflightBannerProject` is pure: it returns issues without mutating the source project. The focused test suite has 18 passing tests and the production build passes.

## Proposed v1 runtime-safe envelope

| Field | Proposed rule | Basis | Status |
| --- | --- | --- | --- |
| Output format | Static PNG/WebP or animated WebP | Existing bake and G-Maiden renderer boundary | Candidate |
| Output dimensions | `840 × 240` pixels | Existing `420 × 120 × 2` tone-banner bake | Candidate |
| Frame rate | `1–24 fps`; standard presets `18` and `24` only | Existing reactive and entrance bakes | Candidate |
| Frame count | `1–48` | Existing `REACTIVE_MAX_FRAMES` | Candidate |
| Authored motion duration | `0.5–3.5` seconds | Existing reactive bake clamp | Candidate |
| Loop mode | one-shot/rest or explicit reactive loop only | Existing `loop_count` modes | Candidate |
| Encoded asset bytes | **TBD by measurement** | No runtime size benchmark exists | Approval gate |
| Raw video | Never shipped to the overlay | PRD-SDD NFR-003 / SDD-003 | Approved boundary |

The first implementation must reject, not silently downscale, any project outside the approved envelope. Automated optimization can be proposed later only with a before/after preview and explicit author confirmation.

## Runtime timing boundary

The `0.5–3.5` second envelope is an authored-animation ceiling only. It does not define the G-Maiden runtime card lifetime and must not be presented as a runtime-display match.

Current G-Maiden runtime behavior in `src/src/app/Overlay.tsx` holds built-in, preview, and announcer-pack banners in the `show` phase for `4.0` seconds, then runs an additional `0.8` second `exit` phase before removal. The G-AnnStudio local authoring previews remain `3.5` seconds by design; they exercise the authored envelope and are not a runtime-lifecycle simulation. No bake, Ann Pack composition/install, or target-renderer handoff is wired by this distinction.

## Authoring timeline contract

`BannerProject` currently has optional timing metadata per visual layer:

```ts
timing?: {
  startMs: number;
  endMs: number;
}
```

The current inspector exposes Start/End ms fields for non-group layers. Values default to `0` and `3500` ms when timing is absent and are clamped to non-negative input. Current preflight validates only the export plan's `durationSec`; it does not read or reject individual layer Start/End values. Timeline controls, enter/exit presets, and keyframe authoring are future candidates. In particular, a `keyframes` field is not part of the implemented `BannerTiming` shape and requires an approved contract plus preflight and bake error-path evidence before implementation.

## Export preflight

Preflight is read-only. It returns errors and warnings and must not mutate the current project, overwrite the last valid export, install an Ann Pack, or sync layout data.

| Code | Reject when | Required evidence |
| --- | --- | --- |
| `missing_asset` | A visible layer references no local asset | Layer and asset ID |
| `unsupported_layer` | A layer kind cannot be rendered by the selected bake version | Layer ID and kind |
| `decode_failed` | Imported media cannot be decoded or a frame cannot be rendered | Asset ID and decoder error |
| `invalid_timing` | **Current:** export-plan duration is non-finite or outside the approved duration. **Future acceptance:** a layer Start/End value is absent, non-finite, reversed, or outside that duration. | Current: `MotionExportPlan` duration; future: layer ID and normalized timing |
| `frame_budget_exceeded` | Frame count or fps exceeds the v1 envelope | Requested and permitted values |
| `dimension_mismatch` | Output does not match the approved artboard | Actual and expected dimensions |
| `encoded_size_exceeded` | Encoded WebP exceeds the approved byte budget | Actual and approved bytes |
| `bake_failed` | **Future acceptance:** the Rust encoder returns an error or no bytes. This code is not emitted by current preflight. | Sanitized encoder reason |

Warnings may identify a hidden layer, an unused local asset, or an animation that has no visible change. Warnings never bypass an error.

## Measurement gate before implementation

The owner must approve the encoded-byte budget after recording, for static and maximum-3.5-second authored animated output:

1. encoded bytes and decoded dimensions;
2. G-Maiden overlay decode/render result on the target desktop;
3. render latency and memory evidence compared with the existing banner path;
4. install/export error behavior; and
5. the selected remediation when output exceeds the limit.

Until then, Sprint 2 may implement only the candidate data shape, inspector input, and read-only preflight/failing-path tests. It must not claim a production-safe motion export, bake wiring, or G-Maiden handoff.

## Acceptance criteria

- Raw authoring video never crosses the G-Maiden runtime handoff.
- A valid static and animated project produces a runtime-safe asset within the approved envelope.
- Current preflight validates the export-plan duration without mutating the local project; per-layer Start/End rejection remains future acceptance work.
- Per-layer timing rejection, `bake_failed`, and tests for each bake failure path are future acceptance work.
- The existing 19-module HUD-layout sync remains independent of motion export.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
| --- | --- | --- | --- | --- | --- |
| 0.1.0b | 2026-08-11 | candidate | Proposed measured-boundary contract and fail-safe preflight for Sprint 2; encoded byte budget awaits G-Maiden measurement. | pending | ATHER |
| 0.1.1b | 2026-08-12 | candidate | Recorded optional per-layer timing, inspector fields, pure preflight, and local test/build evidence while retaining the encoded-byte, bake, and runtime-handoff gates. | pending | ATHER |
| 0.1.2b | 2026-08-12 | candidate | Aligned implemented two-field timing and export-plan preflight with code; reserved keyframes, per-layer rejection, and `bake_failed` for future acceptance. | pending | ATHER |
| 0.2.0b | 2026-08-12 | candidate | Distinguished the `0.5–3.5` second authored-motion ceiling from G-Maiden's current `4.0` second show plus `0.8` second exit lifecycle; retained all bake, byte-budget, and handoff gates. | pending | ATHER |
