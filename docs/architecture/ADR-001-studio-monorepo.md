# ADR-001: Studio applications in G-Suite

Status: accepted by user, 2026-11-03. Delivery is incremental; this PR implements CR-01 only.

## Decision

Keep AnnStudio and 3D Studio as independent applications in packages/ within the
existing pnpm workspace. Each owns its app state, native commands and installer.
Retain AnnStudio React 18 and Studio React 19 during migration. Share design tokens
before extracting React components; establish peer compatibility before doing so.

Production Blender files, textures, rendered video, caches and revision history stay
outside Git in configurable workspaces, including D:/G-Maiden-3D-Studio/workspace
and G:/G-Maiden-3D-Studio-AssetData. Track schemas, source scripts and small test
fixtures in Git. No machine-specific drive path becomes a required dependency.

## Target dependencies (not all implemented)

```text
ann-studio -------> asset-contracts <------- 3d-studio
     |                                      |
     +-----------> banner-core <------------+
     +-----------> design-tokens <----------+
     |
     +-----------> existing g-ann-package

3d-studio -> external production workspace -> versioned asset delivery
ann-studio -> project-owned asset snapshot -> verified .gann -> Store -> client
```

Apps must not import each other's UI/store/native commands. Shared libraries must
not depend on apps. Do not duplicate the existing GANN verifier. Moving its Rust
crate into crates/ or introducing a root Cargo workspace requires separate checks
of lockfiles, resource paths, profiles and compatibility with runtime consumers.

No always-running service is needed for initial integration. The planned asset
delivery uses a manifest plus files with IDs, revisions, digests, relative paths,
dimensions/duration/alpha, licenses, schema version and editable capabilities.
AnnStudio validates and takes a project-owned snapshot rather than retaining a
mutable external absolute path. New source revisions require explicit adoption.
The authoring delivery is distinct from the final .gann runtime contract.

Editable templates can expose text and entrance/hold/exit controls. Baked videos
must expose only supported operations; arbitrary internal motion/hold changes
require re-rendering. Exact selected clip identity binds voice and banner.

Ordinary announcer creation must finish in AnnStudio without launching Blender.
Advanced source production can open 3D Studio explicitly. Store upload and client
download are downstream stages; no new local-install workflow is introduced here.

## Delivery sequence

1. CR-SUITE-001: import shell, configurable paths, independent commands/checks.
2. CR-SUITE-002: asset contract, versioned delivery/import and snapshot validation.
3. CR-ANN-WORKFLOW-001: reviewed transcript/range workflow, event cards and paired
   banner/motion authoring, paired preview and verified export. Refer to the current
   design proposal; this is separate from responsive-only CR-ANN-UI-001.

Mixed React majors require explicit type peer contexts: the root pnpm packageExtension
keeps lucide-react 0.456 on the React 18 type peer used by AnnStudio. Without it,
implicit type hoisting picks React 19 and AnnStudio JSX compilation fails.

Shared packages are extracted only when their first real consumers are implemented.
Do not create empty packages or imply the bridge exists after shell migration.
CI must test consumers of changed shared code and lockfiles. Native UI, Blender,
alpha/audio parity, packaging lifecycle and runtime acceptance remain distinct gates.
