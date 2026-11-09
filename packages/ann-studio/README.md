# G-AnnStudio

Dota 2 announcer-pack editor for **G-Maiden** — part of the [G-Suite](../..) monorepo.
Tauri v2 + React/Vite + Tailwind, with a Python `faster-whisper` sidecar.

Import audio/video → AI auto-split (Whisper) → AI maps each clip to a G-Maiden event →
install straight into G-Maiden's `voice-cache`. AI chat (Ollama / Claude plan) drives it all.

## Run

```bash
# from the G-Suite repo root
pnpm install
pnpm ann-studio:dev      # dev
pnpm ann-studio:build    # build installer
```

Requirements, the speech sidecar setup (CPU/GPU), provider config, and the architecture gotchas
are documented in the repo root [`README.md`](../../README.md) and [`CLAUDE.md`](../../CLAUDE.md),
and the sidecar [`README`](src-tauri/sidecar). The event contract lives in
[`schemas/gmaiden-events.json`](../../schemas/gmaiden-events.json), generated from G-Maiden
`src-tauri/events/g-events.toml` (ADR-21 / CR-049). Studio reads it through the typed adapter
`src/src/data/gmaiden-events.ts`; never add a hand-typed event list.
