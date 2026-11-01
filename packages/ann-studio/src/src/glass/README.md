# G-AnnStudio Obsidian Glass — parallel PR-B foundation

This directory implements **scoped, opt-in Glass UI foundations** for CR-ANN-UI-001 while PR-A #18 is still in progress.

## Files
- `tokens.css`: color, type and material tokens, including accessible reduced-motion / high-contrast fallback.
- `components.css`, `GlassComponents.tsx`: usable semantic React UI primitives, no project-store dependencies.
- `GlassWorkbenchPreview.tsx`, `GlassWorkbenchPreview.css`: isolated interactive reference for asset/library, waveform, Event Mapping and collapsible AI.
- `../glass-preview.html`: a Vite development entry point.

## Preview

From repo root (with installed dependencies):

```bash
pnpm -C packages/ann-studio/src dev
```

Then open `http://localhost:5174/glass-preview.html` (or the port Vite prints).
This screen is a **UI-only prototype** and does not read/write projects, play audio, invoke LLM, or export GANN. Its fixture mapping is intentionally isolated from the production store. Use it to review spacing, contrast, behavior, responsive layout and styling without changing the running application.

## Parallel work policy
PR-A #18 owns the production `App.tsx`, `Header.tsx`, `SourceView.tsx`, `global.css` and responsive logic. This branch must not modify those files. After PR-A is merged, rebase this branch and integrate tokens/primitives in a follow-up PR or scoped commits. Roll out page by page; avoid restyling the app shell while someone else is modifying the shell.

See the corresponding spec under `../../../docs/design-system/GLASS-RESPONSIVE-UI-v1.md`.
