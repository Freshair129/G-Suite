# CLAUDE.md — G-Suite

Guidance for Claude Code working in this repo.

## What this is

**G-Suite** — a pnpm-workspace monorepo of developer tools for the **G-Maiden** Dota 2 AI
companion. First (only, so far) package: **G-AnnStudio** (`packages/ann-studio`), a Tauri v2
desktop app for authoring announcer voice packs. See [README.md](README.md) for the full pipeline.

End-to-end flow: **import audio/video → auto-split (vision + whisper) → map each clip to a
G-Maiden event → tune (mastering deck) → build a per-event banner → install into G-Maiden**.
Packs can also be saved to a local **library** (by voice owner) and re-assembled on the test screen.

G-Maiden lives in a **separate repo** (sibling dir `../G-Maiden`). The two connect only through the
JSON contracts in [`schemas/`](schemas) + the install channel — neither imports the other's code.
The interface contract is frozen in **`../G-Maiden/docs/change request/CR-009-…md`** (read it before
changing anything under "The G-Maiden seam" below).

## Layout

```
schemas/                 shared contracts (gmaiden-events.json = event taxonomy; pack-manifest =
                         installed pack manifest.json, the real install contract; announcer-manifest
                         = plain-export sidecar, G-Maiden never reads it)
packages/ann-studio/
  package.json           tauri-cli root; `pnpm tauri build/dev` runs from HERE (not src/)
  src/                   React frontend (own package.json; Vite → ../src-tauri/gen/web)
    src/components/       SourceView (authoring), MasteringPanel/MeterPanel (deck), EventTestGrid
                          (test + library pack builder), SoundLibrary, SaveToLibDialog, Settings, Header
    src/lib/              actions.ts (split/analyze/export/send), llm.ts (chat + auto-map + executor),
                          exportGmaidenPack.ts (install to G-Maiden), toneBanner/bakeBanner/bannerPrompt/
                          genBanner (banner suite), honEventMap.ts (HoN→event resolver), peaks/audio/features
    src/data/             gmaiden-events.ts (mirror of schemas/gmaiden-events.json — keep in sync)
    src/store/            useStudioStore.ts (zustand: clips, packBuilder, bannerOverrides, gmaidenPath)
  src-tauri/
    src/lib.rs            all Rust commands — audio: extract_audio/cut_clip/export_all/read_audio_bytes;
                          speech+vision: transcribe_audio, analyze_video (W1→whisper→W4 chain);
                          install: install_pack/install_gmaiden_pack/install_library_pack,
                          detect_gmaiden_installed, check_gmaiden; banner: bake_animated_webp,
                          generate_banner_image (SD txt2img); library: init_library/query_sounds/
                          save_clips_to_library; LLM: llm_complete/list_ollama_models
    .taurignore           keeps `tauri dev`'s watcher off sidecar/.venv (see gotchas)
    capabilities/         REQUIRED Tauri v2 ACL (see gotchas)
    sidecar/              Python sidecars: transcribe.py (faster-whisper) + G-Vision:
                          detect_boundaries.py (W1 caption windows), detect_buttons.py (W4 button OCR).
                          .venv gitignored (faster-whisper + rapidocr-onnxruntime)
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
5. **`.taurignore` keeps the dev watcher off `sidecar/.venv`.** `tauri dev` watches `src-tauri/`;
   the venv (rapidocr + whisper, thousands of files) triggers a full Rust rebuild when a sidecar
   runs and writes `__pycache__`. Without the ignore, every "analyze" mid-session rebuilds the app.

## AI / providers

- The chat + auto-map go through Rust `llm_complete(provider, model, system, prompt)`:
  **Ollama** (HTTP `localhost:11434`, free/local) or **Claude** (`cmd /c claude -p … --output-format json`
  = the signed-in Claude plan's quota, no API key). `list_ollama_models` fills the header selector.
- Function-calling is a JSON protocol: the model returns `{action,args,reply}`; `src/lib/llm.ts`
  parses (slice first `{`..last `}`, so reasoning models that emit `<think>` still work) and an
  executor runs it against the zustand store. Falls back to an offline rule parser if the provider
  is unreachable.
- **AI banner art** is a separate backend: `generate_banner_image` POSTs a per-event prompt to a local
  **Stable Diffusion WebUI** (`--api`, `/sdapi/v1/txt2img`, default `127.0.0.1:7860`, set in Settings).
  Optional — every event still gets an auto tone banner without it.

## Sidecars — speech + G-Vision

**Speech** (`transcribe.py`): faster-whisper (CTranslate2, no PyTorch). CPU int8 by default; GPU is
opt-in via `requirements-gpu.txt` (needs `nvidia-cublas-cu12` + `nvidia-cudnn-cu12` +
**`nvidia-cuda-runtime-cu12`** — cublas fails to load without cudart; the sidecar registers the wheel
bin dirs on DLL path **and** PATH). Must `sys.stdout.reconfigure(encoding="utf-8")` or Thai dies on
Windows cp1252.

**G-Vision** — for HoN-style showcase *videos* (a preview UI clicks each event button; a green Thai
caption + audio fire per line). Two scripts + a Rust chain, each a JSON-stdout contract mirroring
transcribe.py:
- `detect_boundaries.py` (W1) — green-caption appear→disappear → line windows.
- `detect_buttons.py` (W4) — OCR the button panel (`rapidocr-onnxruntime`, ONNX; no PyTorch/tesseract)
  + find the golden cursor → the active button label per window. Emits **raw** label text; the frontend
  resolves HoN→G-Maiden via `matchAnnouncerLabel()` (`lib/honEventMap.ts`, the single source — keep
  the table there, not in Python). ROI + cursor thresholds are `--args` (per-video calibration).
- Rust `analyze_video` fuses W1 windows + whisper text + W4 labels into pre-mapped clips.

## The G-Maiden seam

Event audio and visuals come only from verified `.gann` containers. `gann_authoring.rs` creates the indexed archive, normalizes mastered voice to mono48k PCM16 and renders authored visuals to silent VP8 WebM. `create_gann_package` is shared by Export and Event Test. Event Test reads `registry.events` pairs through `gann_open`/`gann_read`; raw source/library auditions remain authoring operations.

`install_gann_package` uses the vendored `g_ann_package::install` to install verified indexed media plus `local-gann.json` and the original archive. It discovers `%LOCALAPPDATA%/G-Maiden/gsi-port.txt`, checks `/health`, then calls `/announcer/install {packId}` only to activate an already installed pack. A failed/mismatched activation is an error, not success. The old direct-manifest and flat-cache installers are retired. See `packages/ann-studio/docs/gann-package.md` for the CLI job protocol and limits. Signed Store provenance remains separate.

## repo https://github.com/Freshair129/G-Suite (private)
