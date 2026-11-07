# G-Suite Git and Worktree Lifecycle Policy

This is the portable workspace/PR policy for the monorepo. CLAUDE.md remains its primary working guide; package instructions and approved contracts supply narrower rules. Codex users can consult their global lifecycle policy when available. Read only the sections needed for the operation; no centralized controller, registry service or admission framework is added.

## Reuse and ownership

Inspect repository/common-dir identity, branch/HEAD, remotes, upstream, local changes and existing worktrees before writing. Reuse the assigned checkout and an appropriate owned branch. Do not create a worktree for every task, session or subagent. Allocate only for actual concurrent writes, destructive tests, incompatible builds or environment isolation after checking free space, ownership and resource separation.

One active writer owns a mutable worktree. Establish the owner from existing task/session evidence and a current handoff. Idle/archived chats, clean status, a merged PR or no process-search match do not release ownership. Unknown ownership is protected. Active AnnStudio and 3D Studio development branches, native build/installer jobs and runtime profiles must not be modified or switched by another session; prepare a scoped patch if no owned workspace exists.

Read-only subagents can share a checkout. Serialize writer turns, lockfiles, shared schemas, generated docs and build output. Concurrent file-disjoint edits still require isolation if a generator/build/Git operation touches common state. Do not mutate G-Maiden's workspace or launch/stop its runtime as a Studio check. Preserve external 3D production assets and their established authority; importing a package is not asset activation.

Preserve unrelated working changes and unpushed commits. Stage intended paths, keep existing commit/hook/signing conventions, name the intended remote explicitly, and review the final diff. Branch naming should match the task lane's established conventions; a documentation branch may use `docs/<topic>` where no more specific rule applies. Do not repurpose an active implementation branch for unrelated governance.

## Dependency and PR lifecycle

Use DISCOVER → REUSE OR ALLOCATE → EXECUTE → VERIFY → REVIEW → MERGE OR RETIRE → CLEANUP and existing issues/PRs/handoffs for state. Record owner, path, branch/HEAD, scope, base, prerequisite chain, checks, dirty/ignored/unpushed work, runtime users, blockers and resume triggers. Transfer writer ownership only after release and receiver verification; no new registry is required.

Use task states ACTIVE, READY_TO_FINISH, BLOCKED_BY_DEPENDENCY, BLOCKED_BY_UAT, BLOCKED_BY_DECISION, SUPERSEDED, COMPLETED, MERGED, RETIRED or UNKNOWN with evidence. Finish valid work before cleanup; retire cancelled/obsolete work only with authorized disposition, replacement links and preservation of unique changes. An archived chat is not a completed development task.

For every stacked PR, identify its actual base/head and prerequisite contract/artifact revisions. Prerequisites must be integrated into the intended final target before a dependent PR is independently merged there. Merging a child into an unmerged feature branch is not delivery to main. Do not retarget/cherry-pick away a dependency merely to obtain a green PR. After authorized prerequisite integration/retargeting, review the resulting diff and rerun relevant exact-head checks.

As a concrete dependency pattern, a 3D Studio package change can precede banner-contract integration, which can precede an AnnStudio import consumer. The prerequisite code/contracts must land before the dependent consumer. Current PR numbers and base/head relationships belong in the live PR/handoff, not a permanent hardcoded merge queue.

Use the intended PR base and the repository's actual current review/protection settings. Never bypass required CI, review or conversation-resolution gates. Report settings that cannot be inspected as unverified rather than enforced. Keep unfinished work draft where appropriate; name blockers and responsible owners. Do not self-merge based solely on repository administrator capability. Preserve branches and worktrees still required by children or installed/native acceptance.

## Package validation and acceptance

Use the current workspace package manager/version and package scripts. Reuse safe existing installations/caches and avoid installing every workspace merely to check a Markdown patch.

- AnnStudio frontend changes require the type-check and build described by CLAUDE.md; Rust changes require the applicable Tauri/Rust checks. Its contribution guide owns documentation/traceability rules.
- When the branch includes 3D Studio, follow that package's AGENTS.md, build/test scripts and native workflow. Preserve external production-data revisions, clip identities and pairing; never copy production media/caches into the package.
- Shared banner/schema changes require producer/consumer contract checks and the current round-trip tests where selected by CI. Neither source builds nor a round-trip fixture certifies installed playback, acoustic identity, performance or live G-Maiden delivery.

Inspect the current branch's workflows and path filters before choosing validation. Where present, `.github/workflows/studio-packages.yml` defines Studio package jobs; its package-oriented filter does not select arbitrary root documentation changes. Main and feature branches may have different workflow coverage. An absent or skipped workflow is not a successful required check. Validate links and patch scope locally and obtain applicable review/manual checks. Do not silently edit CI filters or invent a documentation exemption for other required gates. Record unrun package/integration/native gates explicitly.

## Independent cleanup eligibility

Classify worktrees as PROTECTED, REVIEW_REQUIRED, VERIFIED_SAFE or CLEANED independently of task state. MERGED never implies VERIFIED_SAFE. Cleanup is a separately authorized operation.

Before any removal, verify current owner release and relevant session/process/resource users; complete task disposition and dependency/native/UAT/evidence needs; inventory staged/unstaged/untracked/ignored files, refs and unpushed commits; preserve unique content in a verified recoverable artifact. Clean status misses ignored installer output, local libraries, media and runtime data. A Git bundle/patch alone does not preserve all of those.

Check exact resolved path, junction/symlink boundaries, retained common Git directory and recovery coverage immediately before an authorized operation. Never force-remove because a PR merged, discard unrelated work, delete common Git metadata or equate a missing/prunable record with safe cleanup. Branch deletion needs a separate reachability/dependency decision. After cleanup verify registrations and retained recovery material and record the exact result.

Check relevant source/build/temp/cache drive capacity. Avoid duplicate/heavy parallel builds on critically full disks. Shared pnpm/Cargo caches, Codex/Dot state, Docker volumes, runtime profiles, external assets and installed-app data need verified ownership, recovery evidence and applicable authority before cleanup. This policy does not authorize runtime cleanup or asset installation.

## Drift, enforcement and recovery

Before integration compare current schemas/contracts, package ADRs, source diffs and shared generated outputs; resolve semantic drift as well as textual conflicts. Preserve approved cloud/privacy boundaries and the GANN-only install contract. Changes to authority, migrations or deployment require their existing approvals.

Markdown does not enforce writer exclusion or filesystem safety. GitHub rulesets/branch protection enforce only verified settings; workflows enforce only selected jobs. PR templates, CODEOWNERS and hooks are effective only where configured and required. Propose automation separately; do not change settings or gates as part of documentation implementation.

On an ownership conflict or unexpected destructive effect, stop dependent writes, preserve refs/diffs/logs/recovery, and report through the authorized task channel. Restore only affected owned files after checking for newer work. Retain incident evidence under the repository's existing process; never use cleanup to hide a failed operation.
