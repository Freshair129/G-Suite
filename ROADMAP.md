# G-Suite Roadmap

A living draft — adjust freely. Legend: ✅ shipped · 🔜 next · 🧭 later · 🔬 exploring.

G-Suite is the umbrella monorepo for **G-Maiden** developer tools. **G-AnnStudio** (announcer-pack
editor) is the first pack and the proving ground for the suite's conventions.

---

## G-AnnStudio

### ✅ Shipped (v0.1.0)
- Import audio/video → ffmpeg WAV extract (duration from the WAV header — no ffprobe).
- Waveform editor (wavesurfer via Rust `read_audio_bytes`/`loadBlob`), manual region slicing,
  play, zoom, master volume.
- AI auto-split — `faster-whisper` Python sidecar (CPU int8, optional CUDA/large-v3).
- AI chat + "AI map" (function calling) — provider selector **Ollama** (local) / **Claude** (plan
  quota via the `claude` CLI, no API key); bilingual TH/EN commands.
- Event contract (`schemas/gmaiden-events.json`) + **send to G-Maiden** (cuts into
  `voice-cache/{event}/` + `POST /announcer/install`).
- Streak ladder synced 1:1 with G-Maiden's overlay kill banner.
- FluxNode-style dark UI (lime accent, lucide icons).

### 🔜 Next — G-AnnStudio v0.2 (polish)
- Per-clip trim / fade handles + finer split (replace the by-hand 0–2 s edits).
- Provider chip shows online/offline + model-warm status.
- Streaming chat responses (token-by-token) instead of wait-for-complete.
- Pack metadata (name / author / version) + open & re-edit a saved pack; manage multiple packs.
- Event-map review table before send; waveform region labels = event id.

### 🧭 Later
- **Full API delivery** — `/announcer/install` accepts the WAV bytes (cross-machine install, not
  just sibling filesystem); ship a pack as one signed bundle.
- **MCP server** for the suite — expose install/list/build as MCP tools so other agents/apps drive it.
- **Vocal isolation** (Demucs) to lift the announcer voice off music/SFX (the original
  "เอาเสียงออกจากคลิป" ask); speaker diarization for multi-voice sources.

---

## The suite (beyond G-AnnStudio)
- 🧭 More `G-…` packs under `packages/` following the first-pack pattern.
- 🧭 Shared `@g-suite/*` TS package for the event contract + manifest types, generated from
  `schemas/` (today `data/gmaiden-events.ts` is a hand-kept mirror).
- 🔬 Per-pack release pipeline mirroring G-Maiden's tag → sign → in-app-updater flow.

## Distribution / ecosystem
- 🔬 **Announcer pack sharing / marketplace** — community packs for G-Maiden.
  ⚠️ Tension with G-Maiden's **privacy-first** rule (UGC + any training-data angle) — needs an
  explicit opt-in design before it ships.

---

## Contracts to keep in lock-step
- `schemas/gmaiden-events.json` ↔ `packages/ann-studio/src/src/data/gmaiden-events.ts`
  ↔ G-Maiden `src-tauri/src/{announcer.rs, main.rs EVENTS}` ↔ kill banner `App.tsx STREAK_LABELS`.
  Any event-taxonomy change touches all four.
