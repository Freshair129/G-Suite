# CR-SUITE-001 — Import 3D Studio shell into G-Suite

Approved scope: preserve the existing AnnStudio package and external asset data;
import the standalone Studio shell as packages/3d-studio with separate build/dev
commands, configurable Blender/workspace paths and regression checks.

Acceptance: both frontends build; existing AnnStudio tests pass; Studio Rust checks
and workspace tests pass; default status is read-only; paths with spaces/Thai are
supported; invalid names and existing destinations cannot overwrite data; no asset,
vendor, node_modules or build tree is imported. Studio dev port differs from AnnStudio.

No banner integration, GANN schema changes, runtime process manipulation or data
migration is included. Native UI/install checks must be reported separately.
Source inventory: packages/3d-studio/migration-source.json.
Architecture: ../architecture/ADR-001-studio-monorepo.md.
