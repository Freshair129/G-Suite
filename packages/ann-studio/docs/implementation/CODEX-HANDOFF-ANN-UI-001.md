# Codex implementation handoff — G-AnnStudio adaptive Obsidian Glass

## Entry point
Repo: `Freshair129/G-Suite`
Scope: `packages/ann-studio` only.
For the current PR-A acceptance state and unfinished work, see [PR-A responsive open work](PR-A-RESPONSIVE-OPEN-WORK.md) and the latest entries on PR #18.
Read in order:
1. `packages/ann-studio/docs/change-requests/CR-ANN-UI-001.md`
2. `packages/ann-studio/docs/design-system/GLASS-RESPONSIVE-UI-v1.md`
3. `packages/ann-studio/docs/frontend-design-system.md`
4. Existing app layout, `App.tsx`, `Header.tsx`, `SourceView.tsx`, `SoundLibrary.tsx`, `RightRail.tsx`, `ChatPanel.tsx`, Tailwind setup, tests and package scripts.

## Instructions to execute (copy to Codex)
You are implementing CR-ANN-UI-001, not brainstorming. Start with a source-and-tests audit and a concise delta plan, then implement PR-A responsive correctness. Follow the new Design System as a binding visual/UX contract. The problem is that G-AnnStudio's resizing squeezes buttons/panels but Thai/English text overflows; fix root layout sizing and adaptive composition, not merely hiding overflow or shrinking fonts. Preserve all existing authoring and GANN/AI behaviors.

Work in a feature branch; do not commit directly to main. Prefer small components and measured CSS container or ResizeObserver breakpoints. Use exact bounds/constraints on resizable rails; restore rail widths safely after layout mode changes. Keep SourceView functional and the optional AI panel accessible as a drawer/collapsible dock on narrow windows. Refactor topbar actions into accessible primary actions plus overflow. Add automated tests and screenshots/viewport evidence. Check all user-visible controls on 1024×768 and 1280×720, and at the Tauri minimum; Thai long text and long filenames must not escape any button/card. Avoid auto-scaled UI.

After PR-A passes, create further PRs for tokens and primitives (PR-B), complete editor migration (PR-C), and AI dock/screenshot quality gates (PR-D), following the CR dependency order. Keep the user's existing work intact, do not discard unrelated changes, and request review for anything that changes project data, GANN format, Store auth, publishing, or agent permissions.

Report changed files, exact checks with PASS/FAIL, responsive screenshot matrix, remaining gaps, and PR links. Do not claim tests were run unless executed. If running Codex on a disconnected machine, do not report success; instead leave the issue and PR as handoff artifacts.
