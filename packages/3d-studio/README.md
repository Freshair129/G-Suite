# G-Maiden 3D Studio

Independent Tauri 2 / React 19 app within G-Suite. This package owns the imported
Studio shell and the first Banner Asset v1 producer: project status/listing/creation
plus immutable still-image `.banner.zip` export for AnnStudio. It is not an
interactive 3D editor or an editable-template/video renderer.

## Development

Requires Node 20.19+ (20.x) or Node 22.12+ and pnpm 9. From the repository root:

```powershell
pnpm install --frozen-lockfile
$env:G_STUDIO_BLENDER_PATH = 'G:\AI-Studio\Blender\blender.exe'
$env:G_STUDIO_WORKSPACE_ROOT = 'D:\G-Maiden-3D-Studio\workspace'
pnpm 3d-studio:dev
```

Both settings are optional, absolute paths, read from the app process environment.
Unset Blender produces a usable status/list view; project creation is disabled.
Unset workspace defaults to `<Tauri app_data_dir>/projects` for the existing
`com.freshair.gmaiden3dstudio` app identifier. Status/listing do not create folders.
Existing external folders remain in place. No automatic data migration occurs.
Set environment variables before launching the installed executable as well.
User-facing persistent settings are a later UI task; these overrides are for this migration.

The independent dev server uses port 1430 (HMR 1431); AnnStudio keeps its own port.
Blender is user-supplied and is not bundled or required to build this package.

```powershell
pnpm 3d-studio:build:fe
pnpm 3d-studio:test
cargo check --locked --manifest-path packages/3d-studio/src-tauri/Cargo.toml
pnpm 3d-studio:build
```

The final command creates the Studio installer separately from AnnStudio. Installing
or native-testing it is a separate acceptance step, especially during G-Maiden tests.
Paths with spaces are passed as executable paths, without a command shell.
Project names use 1–64 ASCII letters/digits/hyphens/underscores, excluding Windows
reserved names. Existing destinations are never reused or overwritten.
Failed writes may leave an incomplete new project folder; it remains review-pending.

## Banner Asset export

Select a Studio project, a stable asset ID, a display name, a revision and one PNG,
WebP or JPEG source. Export writes
`<project>/exports/<asset-id>/r<revision>.banner.zip` and refuses to replace an
existing revision. The ZIP contains a v1 manifest and the verified raster bytes;
the source filename and absolute source path are not included. The AnnStudio user
chooses the voice clip/event pairing during import. V1 does not export editable
BannerProject templates or rendered motion/video.

## Source provenance

Imported from D:/G-Maiden-3D-Studio on 2026-11-03. `migration-source.json` records
the exact original shell file hashes. Workspace/GameAssets/vendor trees, dependencies,
build outputs and production scripts were excluded. Original files remain intact.
See [suite architecture](../../docs/architecture/ADR-001-studio-monorepo.md).
