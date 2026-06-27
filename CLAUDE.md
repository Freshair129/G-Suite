# CLAUDE.md — G-Suite

Guidance for Claude Code working in this repo.

## What this is

**G-Suite** — a pnpm-workspace monorepo of developer tools for the **G-Maiden** Dota 2 AI
companion. First (only, so far) package: **G-AnnStudio** (`packages/ann-studio`), a Tauri v2
desktop app for authoring announcer voice packs. See [README.md](README.md) for the full pipeline.

G-Maiden lives in a **separate repo** (sibling dir `../G-Maiden`). The two connect only through the
JSON contracts in [`schemas/`](schemas) — neither imports the other's code.

## Layout

```
schemas/                 shared contracts (gmaiden-events.json = event taxonomy; announcer-manifest)
packages/ann-studio/
  package.json           tauri-cli root; `pnpm tauri build/dev` runs from HERE (not src/)
  src/                   React frontend (own package.json; Vite → ../src-tauri/gen/web)
    src/components/       Header, WaveformViewer, ClipList, ChatPanel, RightRail, StatusBar, EventPicker
    src/lib/              actions.ts (split/export/send), llm.ts (chat + auto-map + executor)
    src/data/             gmaiden-events.ts (mirror of schemas/gmaiden-events.json — keep in sync)
  src-tauri/
    src/lib.rs            all Rust commands (extract_audio, cut_clip, export_all, transcribe_audio,
                          read_audio_bytes, install_pack, list_ollama_models, llm_complete)
    capabilities/         REQUIRED Tauri v2 ACL (see gotchas)
    sidecar/              Python faster-whisper speech sidecar (.venv gitignored)
```

## Build / verify

- `pnpm install` (repo root) — installs all workspace deps.
- Frontend type-check: `pnpm -C packages/ann-studio/src exec tsc --noEmit` (or `cd src && npx tsc`).
- Full build: `pnpm -C packages/ann-studio tauri build` (or `pnpm ann-studio:build`).
- Always type-check + build after frontend changes; `cargo check` from `src-tauri/` for Rust.

## Tauri v2 gotchas (these all bit while building ann-studio — don't relearn them)

1. **`capabilities/default.json` is mandatory.** Without it Tauri v2 silently blocks every
   `invoke`/dialog call → "buttons do nothing". Grant `core:default` + the plugin perms you use.
2. **Load audio via bytes, not the asset protocol.** wavesurfer's fetch won't get past the webview
   CSP/CORS even with `assetProtocol` enabled. Use the Rust `read_audio_bytes` command
   (`tauri::ipc::Response`) → `ws.loadBlob(new Blob([buf]))`.
3. **No ffprobe.** `ffmpeg-static` ships `ffmpeg.exe` only. Read WAV duration from the RIFF header in
   Rust (`wav_duration`), never call ffprobe.
4. **Windows spawns** use `creation_flags(CREATE_NO_WINDOW)` (tokio Command has it natively).

## AI / providers

- The chat + auto-map go through Rust `llm_complete(provider, model, system, prompt)`:
  **Ollama** (HTTP `localhost:11434`, free/local) or **Claude** (`cmd /c claude -p … --output-format json`
  = the signed-in Claude plan's quota, no API key). `list_ollama_models` fills the header selector.
- Function-calling is a JSON protocol: the model returns `{action,args,reply}`; `src/lib/llm.ts`
  parses (slice first `{`..last `}`, so reasoning models that emit `<think>` still work) and an
  executor runs it against the zustand store. Falls back to an offline rule parser if the provider
  is unreachable.

## Speech sidecar

faster-whisper (CTranslate2, no PyTorch). CPU int8 by default; GPU is opt-in via `requirements-gpu.txt`
(needs `nvidia-cublas-cu12` + `nvidia-cudnn-cu12` + **`nvidia-cuda-runtime-cu12`** — cublas fails to
load without cudart; the sidecar registers the wheel bin dirs on DLL path **and** PATH). Must
`sys.stdout.reconfigure(encoding="utf-8")` or Thai dies on Windows cp1252.

## The G-Maiden seam

`schemas/gmaiden-events.json` is the source of truth for event ids; `src/data/gmaiden-events.ts`
mirrors it (update both). `install_pack` writes clips to `../G-Maiden/assets/voice-cache/{event}/`
(auto-detected sibling, or `GMAIDEN_DIR`) and POSTs `…:3000/announcer/install`. The streak ladder
must match G-Maiden's overlay kill banner (`G-Maiden/src/src/App.tsx` `STREAK_LABELS`).

## repo https://github.com/Freshair129/G-Suite (private)
