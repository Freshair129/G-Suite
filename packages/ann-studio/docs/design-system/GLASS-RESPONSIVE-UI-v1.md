---
title: "G-AnnStudio Glass UI + Responsive Design System v1"
doc_id: "DS-ANN-GLASS-RESPONSIVE-001"
status: proposed
updated: 2026-11-01
owner: G-AnnStudio
scope: packages/ann-studio
---

# G-AnnStudio — Obsidian Glass / Adaptive Workbench v1

## Design intent
Implement a credible, premium **desktop authoring tool**, not a flattened or auto-scaled screenshot. Reference direction: dark obsidian, translucent frosted surfaces, restrained acid-lime actions, finely separated panels, high-legibility Thai/English type, professional audio-tool density. Keep the **manual-first** workflow and existing GANN/native operations; AI Copilot is an optional dock, not the primary editor.

Existing code to evolve: `src/src/App.tsx`, `components/Header.tsx`, `SourceView.tsx`, `SoundLibrary.tsx`, `RightRail.tsx`, `ChatPanel.tsx`, `PackWorkflow.tsx`, `BannerEditor.tsx`, `global.css`, `tailwind.config.*` if present. Do not introduce a parallel project store, GANN format, or second export pipeline.

## Nonnegotiable UI quality invariants
1. **Never scale text with the panel/window.** No app-wide CSS transform scale or viewport-dependent font-size reduction. Use reflow, text clamping, wrapping, scrolling, or a deliberate compact label.
2. No horizontal content overflow at any **supported window size**. At narrow widths the application rearranges its layout; do not squeeze three fixed-width panes until text protrudes. Prefer `min-width:0` on flex/grid children, `minmax(0, 1fr)`, `overflow-wrap:anywhere` for long paths, and `truncate` only for appropriate one-line labels.
3. Buttons: `inline-flex; align-items:center; justify-content:center; min-width:0`; labels either fit, wrap in intentional multi-line buttons, truncate with `title`/tooltip, or switch to a labeled overflow menu. Never let buttons shrink while their text remains overflowing.
4. All editor controls stay keyboard accessible and have visible focus, meaningful tooltips/accessibility names and touch-friendly hit targets. Thai text must not clip at normal line heights.
5. Glass is restrained and performance-conscious. Waveform, timeline, inspector values, code-like text and transcript editing surfaces must remain opaque enough to read. Respect reduced motion and reduced transparency.
6. Do not change existing event contract (24 runtime events), native GANN media validation, project save/recovery, editing semantics, licensing or Store auth.

## Design tokens (starting proposals; fine tune against screenshot review)
| Token | Value | Usage |
|---|---|---|
| `--surface-base` | `#080e13` | Workbench frame |
| `--surface-panel` | `rgba(19,31,40,.82)` | Primary panels |
| `--surface-raised` | `rgba(28,44,53,.9)` | Cards/menus |
| `--surface-glass` | `rgba(18,33,42,.70)` | Toolbars/docks |
| `--border-subtle` | `rgba(179,220,218,.13)` | Surfaces |
| `--border-strong` | `rgba(179,220,218,.26)` | Focused regions |
| `--text-primary` | `#edf6f5` | Main labels |
| `--text-secondary` | `#a7b9bf` | Descriptions |
| `--text-muted` | `#8198a0` | Nonessential metadata |
| `--accent` | `#b9f66c` | Primary action/selection |
| `--accent-on` | `#12200c` | Text on accent |
| `--danger` | `#ff7d8b` | Destructive/error |
| `--warning` | `#ffd07c` | Warnings |
| `--radius-card` | `14px` | Panels |
| `--radius-control` | `9px` | Controls |
| `--glass-blur` | `16px` | Glass-only surfaces |

Use `font-family: "Prompt","Noto Sans Thai","Inter","Segoe UI",system-ui,sans-serif` with gracefully available installed fonts; **do not bundle an unlicensed font**. Text body generally 13–14px, captions 11–12px minimum where possible. Maintain WCAG AA contrast for body text (4.5:1) and controls (3:1). No lime glow on every edge: use it primarily for selected clip/event, actionable CTA, and focus.

## Information architecture
Desktop workbench has:
- Topbar: G-AnnStudio identity, project/draft state, context navigation, Save / Test / Export actions. Secondary actions in overflow when compressed.
- Left asset rail: source media, searchable clip list, selected clip indicator.
- Center primary workspace: Audio waveform/trim, clip transcript & timing, Event Mapping context, banner preview / tools. The editor is always highest priority.
- Right inspector/AI dock: current event inspector and **collapsible AI Copilot**. Current `RightRail` is an AI chat rail; keep backward functionality while changing how it docks/collapses.
- Footer: runtime/project status; less-important CPU/RAM/GPU details can collapse into an expandable diagnostics affordance.
- Creator workflow (currently 6 steps) remains reachable; introduce consistent visual components rather than rewriting project semantics.

## Adaptive layout: responsive to container, not a scaled screenshot
Use `ResizeObserver` on the workbench shell or CSS container queries to react to *actual available content width*; avoid relying only on `md:` viewport classes. Persist user panel widths only when applicable, clamp to available area. When narrower than the sum of minimum panel sizes + gutters, **switch modes instead of shrinking below min**.

Suggested modes, subject to real window min-size:
- **Wide** (work area >= 1380px): three panes, asset rail about 240–300px, center flexible min 560px, right dock about 300–380px; resizable with clamped drag handles.
- **Medium** (work area 1000–1379px): asset rail 200–260px, center flexible, right panel collapsible (drawer/tab); inspector stays accessible by click/keyboard.
- **Compact** (work area 760–999px): single main workspace with Asset/Events/AI in tabs/drawers; topbar secondary actions migrate to overflow; no horizontal scroll for the app shell. Local tool-specific horizontal scroll (e.g. waveform timeline) is allowed.
- **Below declared minimum**: set meaningful Tauri window min width/height if needed; test behavior at that minimum. Do not pretend phone UI is the product target.

Height behavior: on 720px displays and at 150% Windows text scaling, the center editor and side panels scroll independently; fixed topbar/footer may persist. No clipped dialogs or unreachable buttons.

## Components / interaction
Build reusable primitives (GlassPanel, AppButton, IconButton, SectionHeader, TextClamp, ResponsiveDock, ResizeHandle, CollapsiblePanel) and documented variants. Preserve existing callbacks, keyboard shortcuts, event ids, actions and Tauri invocations.

- **Buttons:** icon+label wide; compact icon with accessible label; overflow menu when too many. Avoid pure icon buttons without accessible name.
- **Text:** titles can line-clamp 2 where needed, paths/filenames can use ellipsis + tooltip; numeric inspector labels wrap as designed. No `white-space:nowrap` on whole toolbars.
- **Resize:** accessible handles where practicable; pointer release cleanup; persist widths across mode transitions without causing negative center width; use minimums and clamp to measured shell width.
- **Glass:** backdrop blur only on chrome/panels, with `@supports` fallback, `prefers-reduced-transparency` alternative if available, and `prefers-reduced-motion` rules. Test performance while waveform animates.
- **AI Copilot:** collapse, dock, expand and potentially pop-out later. Existing chat must work in all modes. Workbench stays usable with AI hidden or provider disconnected. Do not silently turn AI suggested edits into irreversible state; future approval/preview workflow is separate scoped task.

## Reference-based verification
The visual direction is the approved conversation mockup (dark glass/lime G-AnnStudio with side assets, center waveform, Event Mapping and AI dock). It is a **visual reference**, not an implementation that should be copied as absolute-positioned pixels.

Capture actual rendered screenshots and inspect:
- 2560×1440, 1920×1080, 1440×900, 1280×720, 1024×768, and application's actual minimum allowed window;
- Windows DPI 100%, 125%, 150%; browser/WebView text zoom 100% and 125%;
- Thai/English mixed long filenames, 80-character titles, long model names, 24 populated events, absent source, busy operation, error notice, live AI chat, dialogs, split-pane drag to extrema;
- keyboard Tab/Shift-Tab and screen-reader labels; no horizontal shell scrolling, no cropped text, no overlapping controls, no missing actions.

Automated regression: component/unit tests for layout modes, collapse/restore, resizing bounds, and actions preserved; E2E or instrumented viewport tests for overflow (`scrollWidth <= clientWidth` on shell and button/content containment), plus screenshot evidence. CI should run TypeScript, lint, frontend Vitest/build, Rust/GANN regression where touched, docs gate if present.

## Explicit exclusions
Do not rework GANN package format, 24-event taxonomy, release signing, Store billing, native audio engine or game event detection. Do not replace current `llm.ts` function calling in this visual phase unless addressing direct safety regressions through a separate issue/PR.

## Ship criteria
- User can shrink the **actual Tauri window** without overlapping, clipped or protruding text.
- Functional audio edit, clip selection, manual event mapping, project save/reopen, banner view, Export and AI Chat remain available.
- New appearance feels coherent and legible with/without transparency; render at wide/compact widths.
- Merge only with before/after screenshots, viewport matrix, tests and documented residual exceptions.
