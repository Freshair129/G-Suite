# Task 3 Report — Final Cross-Document Consistency Audit

**Audit mode:** Read-only consistency review; this report is the only file created.  
**Trust hierarchy:** code > design specification > product requirements.  
**Overall verdict:** **FAIL**

The JSON artifacts and focused tests are structurally sound, but the documentation set does not pass the final consistency gate. Current source and the focused suite confirm the implemented two-field timing model and pure, unwired preflight. Several documents and source annotations still describe a different or more complete state, including a current `keyframes` field, absent frontend tests, preflight occurring before bake/install, and SVG as a runtime export format. These are semantic contradictions, not missing runtime evidence that may be inferred away.

## Audit evidence

- Read the Task 1 and Task 2 briefs/reports, `docs/.rwang-progress.md`, implementation plan, motion-export contract, preflight report, graph, core PRD/SDD, architecture, editor and layout specifications, traceability, risk matrix, glossary, relevant source, and all four focused test files.
- Fresh focused verification: `pnpm -C src exec vitest run` passed **4 files / 18 tests** (4 BannerProject, 2 store, 8 BannerEditor, 4 bannerPreflight).
- Both JSON artifacts parse. The graph declares and contains **49 nodes / 86 edges**; all node IDs are unique, all edge endpoints resolve, and no duplicate edge tuple was found.
- All **38** file-backed SHA-256 prefixes match their current files when sibling-repository paths are resolved explicitly.
- A fresh relative-link scan checked 26 Markdown links and found zero broken targets. The five ambiguous `G-Maiden/...` graph paths remain the already-recorded cross-repository resolver warning.
- No encoded-byte budget, BannerProject bake wiring, Ann Pack composition handoff, or target G-Maiden renderer smoke was found. This report does not claim any of them.

## Six-point review rubric

| # | Review check | Result | Findings |
| --- | --- | --- | --- |
| 1 | Completeness | **WARN** | The plan and candidate contract preserve the open encoded-byte, bake/install, and renderer-smoke gates. However, the handoff design does not define how the implemented 1280×720 / 16:9 `BannerProject` canvas maps into the candidate 840×240 / 3.5:1 runtime asset. Appendix B also omits the now-implemented optional `BannerTiming` field from its schema description. These omissions are acceptable as candidate/open work but prevent a complete Sprint 3 handoff contract. |
| 2 | Requirement traceability | **WARN** | GOE-001..GOE-005, FR-001..FR-005, NFR-001..NFR-004, and SDD-001..SDD-004 retain unique canonical definitions and no sequence gap. GOE-003 remains partial and GOE-005 remains proposed. Trace intent is incomplete: the timing additions in `bannerProject.ts`, `BannerEditor.tsx`, and the BannerEditor timing test are not annotated/edged to GOE-003 and SDD-003, while the graph says it explicitly traces those timing changes. GOE-004 also has a `current` BannerEditor test edge while the traceability matrix says no component test exists; the actual test covers the 3.5-second preview state, not the full selected-event-over-HUD acceptance condition. |
| 3 | Internal consistency | **FAIL** | The editor spec presents `keyframes: Keyframe[]` in the current layer shape, while code and the candidate contract define only `startMs`/`endMs` and explicitly reserve keyframes for future work. The core PRD/SDD and risk matrix still describe frontend tests as absent/open despite the configured 18-test suite. The implementation plan summarizes one preflight warning while the report and ledger record two. Consequently, `.preflight-report.json`'s “no direct contradiction” pass is no longer defensible even though its graph counts/hashes remain correct. |
| 4 | Standards compliance | **WARN** | The Task 1 documents have matching frontmatter versions, dates, statuses, and changelog rows, and the graph/preflight JSON are valid. Version/date freshness is uneven across the broader authoritative set: the 2026-08-10 editor spec was not revised after the 2026-08-12 two-field timing implementation, and the 2026-08-11 PRD/risk records were not revised after frontend tests/preflight were added. The preflight's existing content-taxonomy document-control warning also remains open. |
| 5 | Code alignment | **FAIL** | Runtime truth confirms optional two-field timing and a pure preflight with no production caller. The source header nevertheless says preflight validates “before bake or install” and prevents invalid projects crossing the handoff. The editor spec permits static PNG/SVG, but the current Rust installer accepts `png`, `webp`, `webm`, `gif`, or `apng`; an `svg` extension falls through to `png` without conversion. The editor spec therefore conflicts with the actual pack-write boundary and the narrower PNG/WebP candidate contract. |
| 6 | Writing quality | **WARN** | The plan and contract clearly distinguish candidate behavior from runtime handoff evidence and consistently use `BannerProject`, `OverlayLayout`, Ann Pack, G-AnnStudio, and G-Maiden. Status language is still ambiguous in places: FR-004/GOE-003 is “Planned” in the plan summary while the graph/spec use “Partial,” and the editor spec uses the undefined shorthand “G-Ann” for the bake command. Diagrams are syntactically coherent but should label the bake/pack path as planned/unwired so readers do not mistake intended flow for current integration. |

## Requested consistency checklist

| Checklist item | Result | Evidence and disposition |
| --- | --- | --- |
| Terminology | **WARN** | Core glossary terms are used consistently, but `G-Ann` is an undefined shorthand and “Planned” versus “Partial” is not normalized for GOE-003. |
| Requirement coverage | **WARN** | The five GOE requirements remain present; GOE-001..004 are partial and GOE-005 is proposed. Timing implementation/test traceability to GOE-003/SDD-003 is incomplete, and GOE-004 test coverage is narrower than the requirement. |
| Data-flow claims | **FAIL** | Preflight is not in the production export/install call graph. The source header overstates its position, the SVG format claim is incompatible with installer behavior, and the 16:9 authoring-to-3.5:1 output transform is undefined. |
| Diagrams and cross-references | **WARN** | All checked Markdown links resolve and the three Mermaid flows are coherent. The workflow/architecture diagrams do not visually distinguish implemented local editing from the open BannerProject bake/install/handoff path. Five graph cross-repo paths remain resolver-ambiguous as already recorded by WARN-003. |
| Version/date alignment | **WARN** | Task 1 plan/contract versions and changelogs align. The editor spec, PRD/SDD, risk matrix, and plan preflight-summary line are stale relative to 2026-08-12 code/report truth. |
| Glossary | **PASS** | Appendix F consistently defines Ann Pack, BannerProject, G-AnnStudio, G-Maiden, GSI, HUD, OverlayLayout, and runtime-safe asset; no conflicting definition was found. |
| ID uniqueness | **PASS** | Graph node IDs are unique; canonical GOE, FR, NFR, and SDD definition sequences have no duplicate or missing ID. |
| Code annotations | **FAIL** | `bannerPreflight.ts` overstates integration; timing-bearing `bannerProject.ts` and `BannerEditor.tsx` omit GOE-003/SDD-003 intent; `labView.ts` and `OverlayModulePreview.tsx` still lack the GOE-004 annotations already recorded by INFO-004. |
| Graph/preflight integrity | **PASS** | JSON parses; 49/86 topology, endpoints, unique IDs, and all 38 hashes verify. This structural pass does not validate the stale semantic “no contradictions” statement. |
| Evidence boundaries | **PASS** | GOE-003 remains partial, GOE-005 remains proposed, `maxEncodedBytes` remains `null`, and no document under review claims measured byte-budget or completed target-runtime handoff evidence. |
| Focused tests | **PASS** | Fresh Vitest execution passed 18/18. The suite proves the implemented unit/component behaviors only; it does not prove bake/install/renderer handoff. |

## Hard-gate contradictions requiring parent disposition

1. **Current timing schema conflict**
   - Design claim: `docs/g-overlay-lab-figma-editor-spec.md:50,73` presents a motion timeline and `keyframes: Keyframe[]` in the layer shape.
   - Runtime truth: `src/src/lib/bannerProject.ts:24-27,40` implements only optional `startMs`/`endMs`.
   - Correct boundary already stated elsewhere: `docs/motion-export-contract-draft.md:51` and `docs/implementation-plan.md:97` reserve timeline/keyframes for future work.
   - Required disposition: revise/version the editor spec to separate the implemented v1 shape from a future candidate timeline shape.

2. **Verification-status conflict**
   - Stale claims: `docs/PRD-SDD-v0.1.md:86` calls frontend component tests a gap; `docs/appendices/E-risk-matrix.md:19` says to add focused frontend tests.
   - Current evidence: `docs/ARCHITECTURE.md:38`, `docs/appendices/D-traceability.md:17-20`, and fresh Vitest execution confirm a configured 18-test focused suite.
   - Required disposition: update/version the core PRD/SDD and risk matrix; do not weaken the fresh test evidence.

3. **Export format conflict**
   - Design claim: `docs/g-overlay-lab-figma-editor-spec.md:102` permits static PNG/SVG.
   - Candidate contract: `docs/motion-export-contract-draft.md:29` permits static PNG/WebP or animated WebP.
   - Runtime truth: `src-tauri/src/lib.rs:920-928` accepts PNG/WebP/WebM/GIF/APNG extensions and silently names any other extension `.png` without transcoding its bytes.
   - Required disposition: remove SVG from the runtime handoff claim or define and implement an explicit SVG-to-approved-raster conversion before install.

4. **Preflight integration annotation conflict**
   - Source claim: `src/src/lib/bannerPreflight.ts:1-2` says validation occurs before bake/install and prevents invalid projects crossing the handoff.
   - Runtime truth: the only imports/calls are in `bannerPreflight.test.ts`; `exportGmaidenPack.ts` does not call preflight.
   - Correct boundary: graph node `code:ann/bannerPreflight`, architecture, traceability, plan, and contract all call it pure and currently unwired.
   - Required disposition: correct the annotation to describe a pure candidate validator until production wiring exists.

5. **Preflight summary and semantic-pass conflict**
   - `docs/implementation-plan.md:17` reports one quality warning; `.preflight-report.json:22-28` and the progress ledger report two warnings.
   - `.preflight-report.json:99-100` says no direct contradiction exists, but contradictions 1-4 above are present in files included by the scoped graph and source scan.
   - Required disposition: refresh the plan summary and rerun/reconcile semantic preflight after the source documents and annotations are corrected.

## Non-blocking open items retained

- Encoded-byte budget measurement and approval.
- BannerProject composition/timing bake wiring and an explicit 1280×720-to-840×240 mapping rule.
- Per-layer timing validation and `bake_failed` handling/tests.
- Ann Pack installation using the composed asset and target G-Maiden static/animated renderer smoke.
- GOE-005 private cloud sync remains C-3/HIGH and proposed only.
- Existing preflight WARN-002 (content-taxonomy document control), WARN-003 (cross-repo path form), and INFO-004 (missing GOE-004 annotations) remain visible.

## Re-review gate

Re-run the final consistency audit only after contradictions 1-5 are dispositioned. Acceptance requires no source/document claim that elevates pure preflight to production wiring, no unsupported runtime format claim, current verification status in the core documents, and refreshed graph/preflight semantics while preserving GOE-003 partial and GOE-005 proposed until runtime evidence exists.

## Fix note — 2026-08-12

This scoped consistency pass dispositioned the five hard contradictions in source annotations and the named Markdown documents. The editor specification now separates current optional `startMs`/`endMs` timing from future timeline/keyframe work, treats SVG as authoring input that must be rasterized before runtime handoff, and marks bake/export/cloud flow nodes as planned or proposed where appropriate. Core verification records now state the configured 18-test focused suite and the pure, currently unwired preflight; GOE-003 remains partial and GOE-005 remains proposed.

`labView.ts` and `OverlayModulePreview.tsx` were outside this timing/preflight slice and remain unchanged. This pass did not edit `.doc-graph.json` or `.preflight-report.json`; encoded-byte approval, composition/bake wiring, Ann Pack installation, and G-Maiden renderer evidence remain open.

## Fresh re-audit verdict — 2026-08-12

**Overall verdict:** **FAIL** — the five content contradictions recorded above are dispositioned, but the unchanged graph/preflight artifacts now contradict the corrected files.

Fresh focused verification passed **4 files / 18 tests**. The current graph still declares and contains **49 nodes / 86 edges**, but **8 of 38** file-backed SHA-256 prefixes no longer match after the fixes.

| # | Review check | Result | Re-audit finding |
| --- | --- | --- | --- |
| 1 | Completeness | **WARN** | The encoded-byte budget, 1280×720-to-840×240 mapping, composition/bake wiring, Ann Pack installation, and target-renderer smoke remain explicitly open. These are retained candidate gaps, not hard contradictions. |
| 2 | Requirement traceability | **FAIL** | Current source annotations correctly link `bannerProject.ts`, `BannerEditor.tsx`, and `bannerPreflight.ts` to GOE-003/SDD-003. The graph still contains the pre-fix annotation arrays for `bannerProject.ts` and `BannerEditor.tsx` and has no corresponding GOE-003 timing edges, so its trace representation is stale. |
| 3 | Internal consistency | **PASS** | The editor spec now matches optional `startMs`/`endMs` timing and reserves timeline/keyframes for future work. Current PRD/architecture/risk/traceability text recognizes the configured 18-test suite. The plan reports two preflight warnings, matching `.preflight-report.json`. |
| 4 | Standards compliance | **FAIL** | The graph's 49/86 topology is valid, but eight recorded hashes are stale. The preflight `document-graph` pass still says every file-backed prefix matches, which is false for the current corrected files. |
| 5 | Code alignment | **PASS** | SVG is authoring-only unless rasterized to approved PNG/WebP output. `preflightBannerProject` is pure and currently unwired in both source annotations and current documents; source search finds no production import/call. |
| 6 | Writing quality | **PASS** | Current status language keeps implemented timing separate from future keyframes, distinguishes authoring input from runtime raster output, and retains GOE-005 as proposed C-3/HIGH work. |

### Requested confirmation checklist

| Item | Result | Evidence boundary |
| --- | --- | --- |
| Two-field timing; future keyframes | **PASS** | Editor spec, motion contract, implementation plan, `BannerTiming`, and inspector all agree on optional `startMs`/`endMs`; keyframes remain future candidate work. |
| Stale frontend-test claims removed | **PASS** | PRD/SDD, architecture, traceability, and risk matrix state the current 18-test focused suite; fresh Vitest execution passed 18/18. |
| SVG authoring-only | **PASS** | The editor spec requires rasterization before handoff and limits runtime output to static PNG/WebP or animated WebP. |
| Preflight pure and unwired | **PASS** | Source annotation, implementation, architecture, editor spec, contract, plan, and traceability agree; only the test imports the validator. |
| Plan warning count | **PASS** | `implementation-plan.md` and `.preflight-report.json` both report two warnings and zero critical findings. |
| GOE-003 / SDD-003 source annotations | **PASS** | All three timing/preflight source headers accurately state timing metadata or pure validation without claiming bake/install wiring. The graph copy remains stale as recorded below. |
| GOE-005 status | **PASS** | Editor spec, PRD/SDD, traceability, plan, graph, and preflight retain proposed/C-3/HIGH status with no implementation or test claim. |

### Only remaining hard contradiction

1. **Graph/preflight artifact drift after the fix**
   - Stale graph hashes: `PRD-SDD-v0.1.md`, `implementation-plan.md`, `appendices/E-risk-matrix.md`, `g-overlay-lab-figma-editor-spec.md`, `appendices/D-traceability.md`, `bannerProject.ts`, `BannerEditor.tsx`, and `bannerPreflight.ts`.
   - Stale graph intent: the `code:ann/bannerProject` and `code:ann/BannerEditor` annotation arrays omit the corrected GOE-003/SDD-003 timing intent, and the graph has no matching timing trace edges.
   - Contradicting preflight claim: `.preflight-report.json` says all file-backed SHA prefixes match and the graph explicitly traces the corrected timing/preflight files.
   - Required disposition: refresh `.doc-graph.json`, then refresh `.preflight-report.json` against that graph while preserving GOE-003 as partial, GOE-005 as proposed, and the two existing non-blocking warnings.

No other hard cross-document contradiction remains in the requested timing, test-status, SVG, preflight, warning-count, annotation, or GOE-005 checks.

## Traceability refresh â€” 2026-08-12

Refreshed `docs/.doc-graph.json` and `docs/.preflight-report.json` against the corrected Task 3 files. The graph now has **49 nodes / 88 edges**; all **38** file-backed SHA-256 prefixes verify when `G-Maiden/...` entries resolve from the sibling checkout. `bannerProject.ts` and `BannerEditor.tsx` now carry their current GOE-003/SDD-003 annotation metadata and each has a partial GOE-003 implementation edge. Requirement statuses are unchanged: GOE-003 remains partial and GOE-005 remains proposed. The preflight document-graph pass now reports this refreshed evidence truthfully; the two existing non-blocking warnings remain.

## Final independent gate audit — 2026-08-12

**Verdict:** **FAIL** — refreshed graph/preflight structure is current, but one runtime timing contradiction remains and invalidates the semantic no-contradiction pass.

### Hard-gate contradiction

1. **The claimed 3.5-second in-game banner window does not match G-Maiden runtime truth.**
   - G-AnnStudio preview code uses `3500` ms in `BannerEditor.tsx:198-200` and `OverlayLab.tsx:157-160`. `OverlayLab.tsx:359-362` explicitly says this matches the in-game event window, and `BannerEditor.test.tsx` asserts that 3.5-second preview behavior.
   - G-Maiden currently keeps the built-in preview, live kill banner, and announcer-pack banner in the `show` phase for `4000` ms before an additional `800` ms exit phase (`G-Maiden/src/src/app/Overlay.tsx:142-168,287-306`). Its nearby comment still says 3.5 seconds, but the executable timeout is 4.0 seconds and wins under the audit trust hierarchy.
   - The motion contract's 3.5-second authored-animation ceiling can remain a separate asset-envelope decision, but it must not be described as the runtime display lifetime unless G-Maiden is changed to match it.
   - **Required disposition:** choose and document the canonical preview/display lifetime, distinguish authored animation duration from show and exit duration, align both applications and the focused test, then refresh graph hashes and semantic preflight.

Because this contradiction is present in current code and scanned documents, `.preflight-report.json`'s `internal-contradictions` PASS and the prior statement that no other hard contradiction remains are not final-gate-safe.

### Independently confirmed passes

- Both generated JSON files parse. The graph declares and contains **49 nodes / 88 edges**; all 49 node IDs are unique, every edge endpoint resolves, and no duplicate `(from,to,type)` edge exists.
- All **38/38** file-backed SHA-256 prefixes match current files, including sibling G-Maiden paths. The graph/preflight refresh itself is structurally current.
- The implementation plan reports **0 critical / 2 warnings**, matching the preflight summary and its two warning findings.
- Timing schema claims otherwise align: `BannerTiming` contains only optional `startMs`/`endMs`; keyframes and per-layer timing rejection remain future work.
- SVG claims align at the current G-AnnStudio boundary: SVG is an authoring input, no BannerProject bake/install path exists, and approved handoff remains rasterized PNG/WebP. G-Maiden has broader SVG rendering capability, but that does not constitute an implemented G-AnnStudio SVG handoff.
- `preflightBannerProject` is pure, plan-level, and production-unwired; source search finds no non-test caller. `maxEncodedBytes` remains `null`.
- GOE-003 remains **partial** with composition/bake/install/runtime proof open. GOE-005 remains **proposed C-3/HIGH**; source search finds only the deliberate unavailable-state UI and no cloud-sync implementation.
- Fresh verification passed: Vitest **4 files / 18 tests**, TypeScript `--noEmit`, and the Vite production build. `git diff --check` also passed.

### Non-blocking structural warnings retained

- `.rwang-progress.md` still records the pre-refresh Task 2 snapshot as 49 nodes / 86 edges. This is understandable as historical task evidence, but it should be labeled historical or updated so readers do not mistake it for the current 49/88 topology.
- GOE-004 trace wording remains imprecise: the graph has a current BannerEditor-test verification edge, while the traceability matrix says no component test was found. The existing test proves only the local 3.5-second preview state, not the full selected-event-over-target-HUD acceptance condition; requirement status correctly remains partial.
- Encoded-byte approval, 1280×720-to-840×240 composition mapping, bake/install wiring, and target-renderer smoke remain explicit open gates and were not inferred complete.

## Runtime timing consistency fix — 2026-08-12

This scoped correction resolves the remaining claim-level timing contradiction without changing G-Maiden runtime timing or the local G-AnnStudio authored-preview behavior. `motion-export-contract-draft.md` now defines `0.5–3.5` seconds as the authored-animation ceiling only. G-Maiden's current runtime remains a `4.0` second `show` phase followed by a `0.8` second `exit` phase; the local G-AnnStudio 3.5-second previews are explicitly not runtime-lifecycle simulations.

The explicit runtime-parity copy in `OverlayLab.tsx` and `EventTestGrid.tsx` was corrected. `BannerEditor.tsx` and its focused 3.5-second preview test remain unchanged because they state only local preview behavior. GOE-003 remains partial; the encoded-byte budget, composition/bake wiring, Ann Pack handoff, and target-renderer smoke gates remain open. `.doc-graph.json` and `.preflight-report.json` were intentionally not edited in this cycle.

## Traceability timing refresh — 2026-08-12

Refreshed only `docs/.doc-graph.json` and `docs/.preflight-report.json` after the timing-consistency correction. The valid topology remains **49 nodes / 88 edges**; all **38/38** file-backed SHA-256 prefixes now match, including the updated motion contract and `OverlayLab` files. Current graph annotation metadata was rechecked with no node or edge change required. The preflight record now distinguishes the authored-animation ceiling, local preview, and G-Maiden runtime lifecycle without claiming any export, install, or renderer evidence. GOE-003 remains **partial**, GOE-005 remains **proposed C-3/HIGH**, and the two existing warnings remain.

## Final acceptance-gate re-audit — 2026-08-12

**Verdict: FAIL** — graph/preflight structure and fresh verification pass, but three linked timing statements still contradict the documented and executable runtime boundary. The semantic `internal-contradictions` PASS is therefore not acceptance-safe.

### Six-point final checklist

| # | Review check | Result | Final-gate evidence |
| --- | --- | --- | --- |
| 1 | Completeness | **WARN** | The authored-motion ceiling, local preview, and target runtime are now explicitly named, and open byte-budget/bake/install/renderer gates remain visible. The current requirements still do not specify whether the accepted HUD preview must simulate the target lifecycle or only exercise the authored envelope. |
| 2 | Requirement traceability | **FAIL** | GOE-003 remains correctly partial and GOE-005 correctly proposed. GOE-004 is only partial, but the graph gives `test:ann/BannerEditor -> req:GOE-004` a `current` verification edge even though the test proves only a 3.5-second local preview and the traceability matrix says no GOE-004 component test was found. It does not prove the specified "real display/event window." |
| 3 | Internal consistency | **FAIL** | `motion-export-contract-draft.md:42-44` says the local 3.5-second preview is not a runtime-lifecycle simulation, while `g-overlay-lab-figma-editor-spec.md:96` still requires preview for the "real display window" and `PRD-SDD-v0.1.md:56` requires the "real event window." Those current statements cannot all be true. |
| 4 | Standards compliance | **FAIL** | JSON structure is sound (49/49 nodes, 88/88 edges, 38/38 hashes), but `.preflight-report.json` records `internal-contradictions` PASS for the corrected editor spec and scanned implementation. The remaining timing statements make that semantic pass false despite correct hashes. |
| 5 | Code alignment | **FAIL** | Executable G-Maiden behavior is `4000` ms in `show` followed by `800` ms in `exit` for built-in preview, live kill banners, and announcer-pack banners (`Overlay.tsx:142-168,290-306`). The source comment at `Overlay.tsx:287` still says the live kill banner appears for 3.5 seconds. |
| 6 | Writing quality | **WARN** | `OverlayLab.tsx` and `EventTestGrid.tsx` now clearly label 3.5 seconds as local authored preview and 4.0 + 0.8 seconds as target runtime. The phrases "real display window" and "real event window," plus the stale G-Maiden comment, reintroduce ambiguity at the authoritative requirement/source levels. |

### Required acceptance confirmations

| Item | Result | Evidence |
| --- | --- | --- |
| Authored `0.5–3.5s` is not runtime lifetime | **FAIL** | The motion contract and corrected G-AnnStudio UI copy pass, but the editor spec and PRD still describe the 3.5-second local preview as the real display/event window. |
| G-Maiden `4.0s show + 0.8s exit` is distinguished | **FAIL** | Contract and executable timers agree; the live-kill source comment still states 3.5 seconds. |
| Graph/preflight counts and hashes | **PASS (structural)** | Both JSON files parse; declared and actual topology is 49 nodes / 88 edges; node IDs are unique; every endpoint resolves; no duplicate edge tuple exists; all 38 file-backed SHA-256 prefixes match, including sibling G-Maiden files. |
| Timing/SVG/preflight/test claims | **FAIL (semantic)** | Two-field timing, future keyframes, SVG authoring-only/raster handoff, and pure unwired preflight align. Fresh Vitest passed 4 files / 18 tests. The preflight semantic no-contradiction claim and the GOE-004 current verification edge do not align with the remaining timing statements or test scope. |
| GOE-003 | **PASS** | Remains partial; encoded-byte approval, composition/timing bake, Ann Pack install, and target-renderer proof remain open. |
| GOE-005 | **PASS** | Remains proposed C-3/HIGH with no implementation/test claim. |

### Fresh verification

- Vitest: **4 files / 18 tests passed**.
- TypeScript: `tsc --noEmit` passed.
- Vite production build passed; the existing chunk-size notice is non-blocking.
- `git diff --check` passed.

### Hard-gate disposition required

1. Replace or explicitly redefine the "real display/event window" requirements so they do not present the 3.5-second authored preview as target-runtime lifecycle evidence.
2. Correct the G-Maiden `Overlay.tsx:287` comment to match the executable 4.0-second `show` plus 0.8-second `exit` lifecycle, or change the executable behavior under an approved runtime decision.
3. Reconcile the GOE-004 test edge and traceability statement with the actual 3.5-second local-preview test scope.
4. Refresh semantic preflight after those corrections; structural rehashing alone is insufficient.

## Final timing/evidence consistency fix — 2026-08-12

The acceptance findings above are now dispositioned without changing executable timing. The editor specification distinguishes the local 3.5-second authored-animation preview ceiling from G-Maiden's current 4.0-second `show` phase plus 0.8-second `exit` phase, and keeps full runtime parity open. AC-002 now requires only a selected-event preview over the HUD reference before installation. The stale G-Maiden kill-banner comment now matches the executable lifecycle.

The graph remains 49 nodes / 88 edges with all 38 file-backed SHA-256 prefixes refreshed. The `test:ann/BannerEditor` → `req:GOE-004` verification edge is **partial**: it proves local preview behavior only, not full runtime HUD acceptance. The semantic preflight detail records that evidence boundary; GOE-003 remains partial, GOE-005 remains proposed, and the two warnings remain unchanged.
