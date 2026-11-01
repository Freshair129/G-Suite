---
title: "CR-ANN-UI-001 — G-AnnStudio responsive reliability and Obsidian Glass redesign"
doc_id: "CR-ANN-UI-001"
status: proposed
updated: 2026-11-01
owner: G-AnnStudio
affected_packages: ["packages/ann-studio"]
design_system: "../design-system/GLASS-RESPONSIVE-UI-v1.md"
---

# CR-ANN-UI-001 — Reliable adaptive glass editor

## User problem
Resizing the current desktop application causes controls to shrink independently of the text; labels escape buttons and panels, producing an unreliable/unprofessional impression. The visual design also lacks a coherent premium hierarchy. Desired appearance: professional dark **glassmorphism** (Obsidian Glass) with restrained lime-green accent and an optional IDE-style Copilot dock.

## Decision / priority
**P0 responsive correctness first**, then P1 design system, then P1 surface adoption, then P2 agent dock polish. Correct resizing is a release blocker; decorative glass alone does not solve it.

## Proven starting point (2026-11-01 main)
- `src/src/App.tsx` has resizable left/right panes with fixed minima 160px/260px but does not negotiate with available center width; center `SourceView` must keep adequate width.
- `components/Header.tsx` uses a 64px row and a large collection of actions; `hidden md:flex` alone does not guarantee action fit in a Tauri WebView.
- `components/SourceView.tsx` has `shrink-0` toolbar groups, a resizable mastering deck, and potential width/height pressure.
- `components/RightRail.tsx` always allocates the Agent chat as a pane in Studio view.
- `components/ChatPanel.tsx` and `lib/llm.ts` already work with Ollama / Claude and editor commands. Do not replace them in this CR.
- `src/src/global.css` has global defaults but no complete adaptive glass tokens/overflows.

## Functional requirements
- FR-01: At supported Tauri window widths, app chrome and all buttons must remain inside their allocated bounds. No overflowing Thai/English labels.
- FR-02: Window resizing transitions automatically between Wide/Medium/Compact layout modes measured against the **actual workbench container**. Maintain selected clip/event and unsaved state.
- FR-03: Resizable rails clamp to available width; collapse/restore accessible using buttons/keyboard; avoid center workspace starvation.
- FR-04: Topbar prioritizes project state, Save, Test, Export; secondary actions migrate to overflow.
- FR-05: AI dock collapses/expands and does not trap editor space; current ChatPanel remains fully functional.
- FR-06: Apply Obsidian Glass tokens/components consistently to shell, Asset Library, Clip Editor, Event Mapping/Creator, Banner panel, dialogs, and AI dock. Provide low-transparency fallback.
- FR-07: Preserve manual mapping, source import, clip cut, project save/reopen, playback preview, verified GANN build/export/install, and existing Event Contract.

## Nonfunctional requirements
- NFR-01: Readability: WCAG AA 4.5:1 text, 3:1 active controls; meaningful focus states and keyboard labels.
- NFR-02: Respect `prefers-reduced-motion` and reduced transparency; no GPU-heavy blurred effect over constantly redrawn waveform.
- NFR-03: No layout shift/clipped content at high DPI or Thai text scaling.
- NFR-04: Keep local-first mode independent of AI/cloud/auth.
- NFR-05: No changes to GANN format, Store entitlement, native event detection, audio pipeline or G-AnnStudio project schema without separately approved CR.

## Implementation PR sequence
1. **PR-A — Responsive shell**: add workbench width measurement / container queries, layout modes and constraints, adaptable topbar, dock collapse, overflows. Write tests. **Gate: P0 acceptance**.
2. **PR-B — Glass foundation**: tokens, shared primitives, type scale/focus states, glass opacity/reduced-motion fallback, migrate shell/actions. Write visual/component tests. Depends on PR-A.
3. **PR-C — Editor and Creator migration**: apply components to SoundLibrary, SourceView, ClipWaveform, PackWorkflow, EventPicker, Banner/preview/dialogs. No business logic changes. Depends on PR-B.
4. **PR-D — AI dock + proof**: ChatPanel docking/collapse, long-content resilience, screenshot matrix and polished regression validation. Depends on PR-C. Agent tool orchestration/review approvals are **another CR**, not hidden in UI scope.

One PR per coherent implementation slice, no unreviewed batch reformat of entire app. Codex may work in one session but must preserve separate commits/PR boundaries.

## Verification / acceptance matrix
- Real Tauri renders at 2560×1440, 1920×1080, 1440×900, 1280×720, 1024×768, window minimum and 125/150% Windows scaling.
- Test long labels, long paths, mixed Thai/English, 24 events, 0 and 100+ clips, missing models, error/retry/toast/confirmation overlays and dialog focus.
- Capture **before/after screenshots** for Wide/Medium/Compact. Confirm the shell does not gain horizontal scroll, controls do not overlap, text never paints outside buttons/cards.
- Drag rails to min/max, change window size during clip audition, save/reopen and AI chat, test hover tooltip and keyboard navigation.
- Verify TypeScript, ESLint, Vitest, frontend production build, native smoke and GANN tests as applicable. Record pass/fail per command; no claim of success based only on source inspection.

## Rejection criteria
- Styling changes that leave the shrink/overflow defect unresolved.
- Replacing typography with ever-shrinking `vw` font sizes or transforming the whole app.
- Absolute pixel recreation of a static mockup.
- Disabling or hiding workflow operations without a discoverable alternative.
- Silent mutation of mappings by AI as part of cosmetic redesign.

## Rollout / rollback
Use isolated feature branches and small reviewed PRs, preserve existing creator workspace and project store. New appearance may be feature-flagged during migration. Roll back presentation code without touching project files or GANN cache. No signed release until real-Tauri visual gates pass.
