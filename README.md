# G-Suite

Monorepo of developer tools for the **G-Maiden** ecosystem (the real-time Dota 2 AI companion).
Each tool ships as an independent package but shares contracts and conventions here.

Where this is headed: [`ROADMAP.md`](ROADMAP.md).

## Packages

| Package | Description | Status |
| --- | --- | --- |
| [`ann-studio`](packages/ann-studio) | **G-AnnStudio** — Tauri desktop app to author Dota 2 announcer packs for G-Maiden: import audio/video, AI auto-split, AI event mapping, and one-click install into G-Maiden. | v0.1.0 |

## G-AnnStudio — what it does

A FluxNode-style dark desktop editor (Tauri v2 + React + Vite + Tailwind, lucide icons) that turns
a raw clip into a working G-Maiden announcer pack:

1. **Import** any media (mp4/mp3/wav/…) — ffmpeg extracts a mono 44.1 kHz WAV. Clip duration is read
   straight from the WAV header (no ffprobe needed; `ffmpeg-static` ships ffmpeg only).
2. **Waveform + manual slicing** — wavesurfer.js viewer (loaded via a Rust `read_audio_bytes` →
   `loadBlob`, not the asset protocol), drag to cut regions, play, zoom, master volume.
3. **AI auto-split** — a Python sidecar (`faster-whisper`, CTranslate2, optional CUDA) transcribes
   the audio and splits it into one clip per phrase, naming each from the transcript.
4. **AI chat + auto-map** — a chat panel (function-calling) and an "AI map" button send the clips +
   the event contract to an LLM, which assigns each clip a G-Maiden event. Provider is chosen from a
   header chip: **Ollama** (local, free) or **Claude** (your plan quota, via the `claude` CLI — no API
   key). Chat also runs split / export / rename / delete / send commands in Thai or English.
5. **Send to G-Maiden** — cuts every event-mapped clip into `G-Maiden/assets/voice-cache/{event}/`
   and `POST`s `http://127.0.0.1:3000/announcer/install` so G-Maiden picks the pack up live.

## Contracts (the seam with G-Maiden)

Shared, language-agnostic specs in [`schemas/`](schemas) — neither repo depends on the other's code:

- [`gmaiden-events.json`](schemas/gmaiden-events.json) — **the announcer event taxonomy**. The
  authoritative list of events a pack can voice (kills, the full streak ladder, state events). Both
  G-AnnStudio (maps clips to these) and G-Maiden (`src-tauri/src/announcer.rs` fires them, plays
  `voice-cache/{event}/*.wav`) follow it. The streak ladder matches G-Maiden's overlay kill banner.
- [`pack-manifest.schema.json`](schemas/pack-manifest.schema.json) — **the install contract**. The
  `manifest.json` at the root of an installed pack (`voice-cache/packs/<id>/`), written by
  `install_gmaiden_pack`/`install_library_pack` and parsed by G-Maiden's
  `src-tauri/src/voice_api/pack_io.rs` `Manifest` — which is the ground truth the schema tracks.
  Carries the pack metadata (`id`/`name`/`version`/`locale`/`author`/optional `authorGid`/
  `description`/`coverImage`) plus the per-event `mappings`.
- [`announcer-manifest.schema.json`](schemas/announcer-manifest.schema.json) — the JSON manifest the
  plain `export` writes alongside the WAV clips. An export inventory only; G-Maiden never reads it.

## Stack

- **pnpm workspaces** (`pnpm-workspace.yaml`)
- Tauri v2 + React 18 + Vite + TypeScript, Tailwind CSS — same stack as G-Maiden, so code/devs move
  freely between repos.
- Python sidecar (`packages/ann-studio/src-tauri/sidecar/`) for speech — own venv, gitignored.

## Develop

```bash
pnpm install                  # install all workspace deps
pnpm ann-studio:dev           # run G-AnnStudio in dev mode
pnpm ann-studio:build         # build the G-AnnStudio installer
```

### Requirements

- Node ≥ 20, pnpm 9; Rust toolchain (for Tauri)
- **ffmpeg** on `PATH` (or `FFMPEG_PATH`). On Windows `npm i -g ffmpeg-static` is auto-detected.
- **Speech (AI auto-split):** `cd packages/ann-studio/src-tauri/sidecar && python -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt`. GPU is optional — add `requirements-gpu.txt` (CUDA 12 / cuDNN 9) for large-v3.
- **AI chat/map:** Ollama running locally, and/or the `claude` CLI signed in. Either works; pick in the header.
- **Send to G-Maiden:** the G-Maiden repo as a sibling of `G-Suite/` (auto-detected) or set `GMAIDEN_DIR`.

See [`packages/ann-studio/src-tauri/sidecar/README.md`](packages/ann-studio/src-tauri/sidecar) for the
speech sidecar (CPU vs GPU, models) and [`CLAUDE.md`](CLAUDE.md) for repo conventions.

## Naming

Tools keep the `G-` prefix (per G-Maiden's ADR-01) for brand unity: **G-AnnStudio**, future
**G-…** packs slot in under `packages/`.
