# Task 2 Brief — Preflight and document-graph traceability

## Scope

Reconcile `docs/.preflight-report.json` and `docs/.doc-graph.json` with the current implementation and tests. Ensure the graph includes BannerProject timing, BannerEditor, bannerPreflight, and their tests; all declared counts and hashes must match. Keep GOE-003 partial and GOE-005 intentionally proposed. Do not edit source code or the contract/plan prose.

## Constraints

- Trust hierarchy: code > design specification > product requirements.
- No fabricated runtime byte budget or G-Maiden renderer evidence.
- Requirement IDs remain GOE-001..GOE-005.
- Validate both JSON files and run `git diff --check` before reporting.

## Output contract

Make only graph/preflight edits and write the structured report to `docs/.rwang-tasks/task-2-report.md`.

## Relevant files

- `docs/.doc-graph.json`
- `docs/.preflight-report.json`
- `docs/motion-export-contract-draft.md`
- `src/src/lib/bannerProject.ts`
- `src/src/lib/bannerPreflight.ts`
- `src/src/lib/bannerPreflight.test.ts`
- `src/src/components/BannerEditor.tsx`
- `src/src/components/BannerEditor.test.tsx`
