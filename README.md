# G-Suite

Monorepo of developer tools for the **G-Maiden** ecosystem (the real-time Dota 2 AI companion).
Each tool ships as an independent package but shares contracts and conventions here.

## Packages

| Package | Description | Status |
| --- | --- | --- |
| [`ann-studio`](packages/ann-studio) | **G-AnnStudio** — Tauri desktop app to slice audio/video into per-event WAV clips and export an announcer pack for G-Maiden. | v0.1.0 |

## Contracts

Shared, language-agnostic specs that tie a tool's output to G-Maiden's input live in [`schemas/`](schemas):

- [`announcer-manifest.schema.json`](schemas/announcer-manifest.schema.json) — the JSON
  manifest G-AnnStudio exports and G-Maiden consumes. This is the seam between the two repos;
  neither depends on the other's code.

## Stack

- **pnpm workspaces** (`pnpm-workspace.yaml`)
- Tauri v2 + React 18 + Vite + TypeScript, Tailwind CSS — same stack as G-Maiden, so code/devs
  move freely between repos.

## Develop

```bash
pnpm install                  # install all workspace deps
pnpm ann-studio:dev           # run G-AnnStudio in dev mode
pnpm ann-studio:build         # build the G-AnnStudio installer
```

### Requirements

- Node ≥ 20, pnpm 9
- Rust toolchain (for Tauri)
- **ffmpeg / ffprobe** on `PATH` (or set `FFMPEG_PATH` / `FFPROBE_PATH`). On Windows the easiest
  route is `npm i -g ffmpeg-static`, whose binaries are auto-detected.

## Naming

Tools keep the `G-` prefix (per G-Maiden's ADR-01) for brand unity: **G-AnnStudio**, future
**G-…** packs slot in under `packages/`.
