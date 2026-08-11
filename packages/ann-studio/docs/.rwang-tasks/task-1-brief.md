# Task 1 Brief — Sprint 2 contract/status documentation

## Scope

Update only the documentation that describes Sprint 2 progress: `docs/implementation-plan.md` and `docs/motion-export-contract-draft.md`. Reflect the current code truth: optional `BannerLayer.timing` with Start/End ms inspector fields, pure `preflightBannerProject`, 18 passing tests, and production build passing. Keep encoded-byte measurement, bake wiring, and G-Maiden runtime handoff explicitly open. Do not edit source code, graph, or preflight JSON.

## Constraints

- Trust hierarchy: code > design specification > product requirements.
- Preserve existing requirement IDs GOE-001..GOE-005 and SDD-001..SDD-004.
- Use technical English with concise Thai context only when already used by the project.
- Preserve candidate/partial status where runtime evidence is missing.

## Output contract

Make the smallest documentation edits needed and write the structured report to `docs/.rwang-tasks/task-1-report.md` using the writer report contract in the subagent-driven skill.

## Relevant files

- `docs/implementation-plan.md`
- `docs/motion-export-contract-draft.md`
- `src/src/lib/bannerProject.ts`
- `src/src/lib/bannerPreflight.ts`
- `src/src/components/BannerEditor.tsx`
- `src/src/lib/bannerPreflight.test.ts`
