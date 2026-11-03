# CR-SUITE-001 validation — 2026-11-03

Candidate: codex/3d-studio-monorepo, based on origin/main
2520702875f1f9acb5ae26fedb6e7116ff7e9ec7. This branch does not incorporate or alter
the separate responsive PR-A branch. Approval here is for monorepo migration only.

## Completed locally

Commands run from the repository root. This machine's fallback pnpm is 11.25.0;
successful pnpm checks used `npm exec --yes --package=pnpm@9.0.0 -- pnpm ...`.

| Check | Result |
| --- | --- |
| pnpm 9 install --frozen-lockfile | PASS |
| pnpm -C packages/3d-studio build:fe | PASS, TypeScript and Vite 7 production build |
| pnpm -C packages/ann-studio/src build | PASS, TypeScript and Vite 5 production build |
| pnpm -C packages/ann-studio/src test | PASS, 22 files / 133 tests |
| Studio tools/test-workspace.ps1 | PASS, 6 tests |
| cargo check --locked --manifest-path packages/3d-studio/src-tauri/Cargo.toml -j 2 | PASS |
| cargo fmt --check --manifest-path packages/3d-studio/src-tauri/Cargo.toml | PASS |
| git diff --check | PASS |
| Source inventory SHA-256 comparison against original D: files | PASS |
| No imported workspace/GameAssets/third_party; AnnStudio source diff empty | PASS |

Workspace tests cover absent Blender/default read-only path resolution, explicit
paths, relative/empty override rejection, invalid/reserved names, existing directory
and file preservation, actual Unicode/space-root creation and concurrent same-name
creation with exactly one winner. They are pure Rust/filesystem checks, not Tauri UI UAT.

Independent read-only code review found the Studio Node engine floor needed to match
Vite 7. The package now requires ^20.19.0 || >=22.12.0; setup documentation is aligned.
The reviewer rechecked the fixes, Lucide peer context and expanded tests and found
no remaining critical or important findings.

## Failures encountered and resolved

- Initial fallback pnpm execution aborted a non-interactive dependency refresh.
- Fallback pnpm 11 install refused ignored esbuild build scripts and edited workspace
  policy. Restored workspace configuration; used the repository-pinned pnpm 9 and
  regenerated its lockfile. Frozen install then passed. No pnpm 11 policy is retained.
- First combined build exposed React 19 types leaking through lucide-react into
  AnnStudio React 18. An explicit type peer packageExtension resolves the dependency
  context. Both builds and the full AnnStudio test suite passed after the fix.
- AnnStudio Vite build still warns about a bundle larger than 500 kB. Build passes;
  this migration does not claim a bundle-size improvement.

## Acceptance still pending

- Installed/native Studio UI, Blender version/connection execution and project-creation
  workflow through Tauri, plus installer/upgrade/uninstall lifecycle.
- Direct Windows junction/reparse-point regression; code skips reparse project entries,
  but no privileged symlink/junction fixture was exercised here.
- Hosted GitHub Actions results are separate from these local results; consult the PR.
- CR-SUITE-002 asset contract/import and CR-ANN-WORKFLOW-001 banner/event workflow
  remain subsequent work. No shared-library or export integration completion is claimed.

G-Maiden was running at preflight (PID 8808); no matching process was present
at the final read-only process check. Its lifecycle was not controlled by this work. No native app, Blender, installer or audio was launched, and no external
production data or runtime configuration was written during these checks.
