# AGENTS.md — G-Suite

Cross-agent entrypoint for this pnpm monorepo. [CLAUDE.md](CLAUDE.md) remains the primary project working guide. Read its applicable package, build and contract guidance; narrower package instructions apply within their scope.

- Preserve monorepo package boundaries and shared schemas; G-Maiden is a separate repository connected through its approved contracts and install channel.
- Read [AnnStudio's contribution guide](packages/ann-studio/docs/CONTRIBUTING.md) for its change/document rules. Where present, 3D Studio has its own package instructions and external production-data ownership.
- Derive validation commands from the current package scripts, CLAUDE.md and applicable workflows. Type checks, source tests, native builds, installed application behavior and acoustic/live runtime acceptance are separate claims.

## Git, Worktree & Multi-Agent Lifecycle

- For Git/worktree operations, read the relevant sections of [the local lifecycle policy](docs/engineering/GIT-WORKTREE-POLICY.md); it is portable without a local Codex profile.
- Reuse an appropriate owned checkout/branch before creating one. One active writer per mutable worktree; serialize shared generators/lockfiles and writer handoffs. Read-only subagents can share it.
- Active AnnStudio and 3D Studio branches, native jobs and external production data are protected. Unknown ownership stays protected: prepare a patch rather than switching branches or taking over.
- Follow PR review and exact-head applicable CI. Merge stacked prerequisites in dependency order; do not merge a dependent PR independently before prerequisites reach the intended target.
- Preserve unrelated/unpushed work and existing commit conventions. Record blockers, resume triggers and final disposition in existing task/PR/handoff records. No controller or mandatory registry is introduced.
- MERGED is not cleanup eligibility. Removal needs separate authorization, verified current ownership release, dependency/UAT checks and recoverable preservation of all unique tracked/untracked/ignored work.
- Documentation/source validation does not authorize installation, asset activation, migration, publication or stopping another session's runtime.
