## Writer Report â€” Task 1: Sprint 2 contract/status documentation

**Status**: DONE_WITH_CONCERNS

**Output file(s)**:
- `docs/implementation-plan.md` â€” recorded the implemented candidate Sprint 2 timing/preflight slice and retained the open encoded-byte, bake, and runtime-handoff gates.
- `docs/motion-export-contract-draft.md` â€” aligned the candidate contract with optional timing, Start/End ms inspector fields, and pure preflight behavior.

**Requirement IDs created**: None; preserved GOE-001 through GOE-005 and SDD-001 through SDD-004.

**Cross-references added**: None.

**Concerns** (if DONE_WITH_CONCERNS):
- Source inspection confirms 18 focused test cases and the requested code behavior. A fresh combined `pnpm test; pnpm build` verification attempt exceeded the 120-second command timeout without output, so this report preserves the brief's stated passing test/build evidence but does not treat the timed-out rerun as independent completion evidence.
- The encoded-byte budget is still `null` in `MOTION_EXPORT_ENVELOPE`; bake wiring, Ann Pack installation, and target G-Maiden renderer smoke remain open and are not claimed complete.

## Review Gate — Task 1: Sprint 2 contract/status documentation

**Verdict**: FAIL

| Check | Result | Findings |
| --- | --- | --- |
| 1. Completeness | PASS | Both files named in the brief were updated. They record optional `BannerLayer.timing`, non-group Start/End ms fields, pure `preflightBannerProject`, and leave encoded-byte measurement, bake wiring, Ann Pack installation, and renderer smoke explicitly open. No TODO/TBD placeholders or required diagrams apply to this task. |
| 2. Requirement Traceability | PASS | No IDs were created or renamed. The Task 1 files preserve GOE-001..GOE-005 and SDD-001..SDD-004, and their FR/NFR mappings remain in the established format. Project-wide search found repeated references but no duplicate requirement definitions or sequence gaps. |
| 3. Internal Consistency | FAIL | The new claims of an installed focused test suite and implemented preflight conflict with current project records: `docs/ARCHITECTURE.md` says no frontend test runner is configured, and `docs/appendices/D-traceability.md` says no frontend test runner and no dedicated export-preflight test exist. The new documents are more consistent with code, but these unresolved contradictions violate the cross-document hard gate. In addition, the draft’s declared `BannerProject` timing shape includes `keyframes: Keyframe[]`, while its own next paragraph says keyframe authoring is not part of the first implementation. |
| 4. Standards Compliance | PASS | Both edited documents retain frontmatter with version, dates, status, scope, and a changelog. The implementation plan maintains its established requirement-to-sprint mapping and the draft clearly labels candidate versus approved boundaries. |
| 5. Code Alignment | WARN | `BannerTiming` currently contains only `startMs` and `endMs` (`src/src/lib/bannerProject.ts`); no `Keyframe` type or `keyframes` property exists. `preflightBannerProject` validates the export plan duration, fps/frames, dimensions, assets, and optional decoder error, but never reads `layer.timing`; it therefore does not currently reject absent, non-finite, reversed, or per-layer out-of-range timing as the draft’s `invalid_timing` row states. `bake_failed` is also only a proposed contract code; it is absent from `BannerPreflightCode`. The documented `18` focused cases match the current test inventory (8 component + 2 store + 4 project + 4 preflight), but this review's independent `pnpm test` attempt timed out after 64 seconds without output, so passing execution remains writer-reported rather than newly verified. |
| 6. Writing Quality | WARN | The prose is concise and preserves candidate/open boundaries, but it should distinguish the implemented two-field timing metadata from proposed keyframes and distinguish implemented plan-level duration validation from proposed layer-timing validation. |

### Required fix before re-review

1. Reconcile the current test-runner and export-preflight status in the authoritative architecture/traceability records, or explicitly scope/supersede those stale statements through the next assigned traceability task.
2. In `docs/motion-export-contract-draft.md`, change the current `BannerProject` shape to the implemented two-field `BannerTiming` shape; reserve keyframes for a clearly marked future candidate shape.
3. State that current preflight validates export-plan duration, not individual layer Start/End values; retain per-layer timing rejection as a future acceptance condition until code and tests implement it.

## Hard-gate Fix Note — Task 1

- Reconciled `docs/ARCHITECTURE.md` and `docs/appendices/D-traceability.md` with the configured Vitest suite and the implemented pure, export-plan-level preflight.
- Corrected the current `BannerTiming` contract to `startMs` and `endMs` only; keyframes are explicitly a future candidate.
- Recorded that per-layer timing rejection and `bake_failed` are future acceptance work. Encoded-byte measurement, bake wiring, and G-Maiden runtime-handoff gates remain open.

**Review evidence**:
- `src/src/lib/bannerProject.ts:24-40` — implemented optional timing has only `startMs` and `endMs`.
- `src/src/components/BannerEditor.tsx:213-216,362` — non-group Start/End ms fields default to 0/3500 and clamp input to non-negative values.
- `src/src/lib/bannerPreflight.ts:17-65` — pure plan-level validation; no `layer.timing` access; encoded-byte limit remains `null`.
- `src/src/lib/bannerPreflight.test.ts:1-27` — four focused preflight cases; full focused inventory totals 18 cases.
- `docs/ARCHITECTURE.md:31` and `docs/appendices/D-traceability.md:13-16` — stale test/preflight claims that contradict Task 1 status text.
## Re-review Gate — Task 1: Sprint 2 contract/status documentation

**Verdict**: FAIL

| Check | Result | Findings |
| --- | --- | --- |
| 1. Completeness | PASS | Both Task 1 target documents contain the requested optional two-field timing status, inspector status, pure preflight status, focused-test/build claims, and explicit encoded-byte, bake, installation, and runtime-handoff open gates. |
| 2. Requirement Traceability | PASS | GOE-001..GOE-005 and SDD-001..SDD-004 remain intact. The revised plan and contract retain the established Sprint and requirement mappings without duplicate or redefined IDs. |
| 3. Internal Consistency | FAIL | `docs/appendices/D-traceability.md` still says `preflightBannerProject` performs validation “before bake or install,” while `docs/implementation-plan.md` says bake wiring is open and source search finds no production caller of `preflightBannerProject` outside its defining module and test. This overstates an unwired integration path and conflicts with the corrected open-gate wording. |
| 4. Standards Compliance | PASS | The target documents preserve required frontmatter, status vocabulary, candidate/partial boundaries, changelogs, and the existing requirement identifiers. |
| 5. Code Alignment | WARN | `BannerTiming` is correctly documented as only `startMs`/`endMs`, and the draft correctly limits current preflight to export-plan duration rather than per-layer timing. The 18-case inventory matches the current test files. A fresh `pnpm test` run again exceeded the 64-second command limit without output, and the RWANG local alignment script likewise timed out; neither timeout disproves the writer-reported test/build result, but neither supplies fresh execution evidence. |
| 6. Writing Quality | PASS | The revised contract is concise and clearly separates implemented behavior from future timing, bake-failure, encoded-byte, and handoff acceptance work. |

### Required correction before acceptance

Amend the GOE-003 traceability row to say that preflight is a pure, currently **unwired** export-plan validator, not a check performed before bake or install. Retain bake/install integration as Sprint 3/open work. Then re-review the three hard gates.

- Fix applied: GOE-003 now describes `preflightBannerProject` as a pure, currently unwired export-plan validator and retains bake/install integration as Sprint 3/open work.

**Re-review evidence**:

## Final Fresh Review - Task 1: Sprint 2 contract/status documentation

**Verdict**: WARN

| Check | Result | Findings |
| --- | --- | --- |
| 1. Completeness | PASS | The implementation plan and motion-export contract both record the implemented candidate timing/inspector/preflight slice, and retain encoded-byte measurement, composition bake wiring, Ann Pack integration, and G-Maiden renderer smoke as open gates. |
| 2. Requirement Traceability | PASS | GOE-001 through GOE-005 and SDD-001 through SDD-004 remain present and retain their established FR, sprint, source, and test mappings; this review found no renamed, duplicated, or skipped requirement ID. |
| 3. Internal Consistency | PASS | The prior GOE-003 correction is present: `D-traceability.md` calls `preflightBannerProject` a pure, currently unwired export-plan validator and keeps bake/install integration in Sprint 3. `ARCHITECTURE.md`, the implementation plan, and the contract consistently limit current validation to export-plan duration and retain the runtime-handoff gates. |
| 4. Standards Compliance | PASS | The revised documents retain valid project frontmatter, lifecycle status, candidate/open boundaries, changelogs, and the existing requirement-to-sprint structure. |
| 5. Code Alignment | WARN | Source confirms optional `BannerTiming` contains only `startMs` and `endMs`; the non-group inspector supplies those fields; `preflightBannerProject` is pure and has no production caller; and neither `keyframes` nor `bake_failed` is implemented. The contract does not overclaim either. A fresh `pnpm test` and `pnpm build` each exceeded the 64-second execution bound without output, so the documented passing test/build status remains prior recorded evidence rather than independently reproduced in this review. The source-file `@req` comment still says validation occurs before bake or install, but the authoritative architecture and traceability records correctly state that it is unwired. |
| 6. Writing Quality | PASS | The current wording is concise, distinguishes implemented behavior from future acceptance work, and avoids claiming keyframes, per-layer timing rejection, or runtime integration as shipped. |

### Final evidence

- `src/src/lib/bannerProject.ts:24-40` - optional timing is the two-field `BannerTiming` shape only.
- `src/src/components/BannerEditor.tsx:213-216,362` - Start/End ms fields apply only to non-group layers and default to `0`/`3500`.
- `src/src/lib/bannerPreflight.ts:32-65` and `src/src/lib/exportGmaidenPack.ts:1-96` - preflight is side-effect free and is not imported by the install path.
- `docs/ARCHITECTURE.md:38` and `docs/appendices/D-traceability.md:19` - stale frontend-test/preflight claims are reconciled and GOE-003 is explicitly unwired.

- `src/src/lib/bannerPreflight.ts:32-65` — defines a pure validator only; no side effects or bake/install invocation.
- `src/src/lib/exportGmaidenPack.ts:19-96` — current pack-install path bakes tone banners and invokes `install_gmaiden_pack` without importing or calling `preflightBannerProject`.
- `docs/implementation-plan.md:27,111-113` — explicitly retains bake wiring and install/export integration as open Sprint 3 work.
- `docs/appendices/D-traceability.md:19` — contains the conflicting “before bake or install” claim.
