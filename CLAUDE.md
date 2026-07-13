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
schemas/                 shared contracts (gmaiden-events.json = event taxonomy; announcer-manifest)
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

**Contract is frozen in `../G-Maiden/docs/change request/CR-009-…md` — read it before changing any of
this.** G-Ann installs a **manifest-based pack** (not the old per-event flat layout), then activates it:

1. **Write** to `voice_cache_root(base)/packs/<id>/` = `clips/*.wav` + `banners/<event>.<ext>` +
   `manifest.json` (camelCase: `id/name/version/locale/author/coverImage/mappings{event:{text,thai,
   banner,bannerAsset,clips[]}}`). `install_gmaiden_pack` cuts from one source wav; `install_library_pack`
   copies already-cut library wavs.
2. **Activate** — POST `http://localhost:3000/announcer/install {packId}` → G-Maiden `gsi.rs`
   `announcer_install` (no auth; only activates a pack already on disk — never writes files).

**Path resolution is the tricky part.** G-Maiden reads packs from its own `voice_cache_dir()`:
exe-adjacent `voice-cache/` (a built/installed run) wins over the dev-tree `assets/voice-cache/`.
`voice_cache_root(base)` in `lib.rs` **mirrors that exactly**, so a pack lands where THIS G-Maiden
reads it. `resolve_gmaiden_dir` picks `base`: Settings path → `GMAIDEN_DIR` → dev sibling repo →
`detect_gmaiden_target` (repo `src-tauri/target/release` → `target/debug` → installed via Start-menu
shortcut). The Settings "G-Maiden Path" field + auto-detect button let the user aim at the exact build
they run (Boss usually tests the repo **release build** → `…/target/release/voice-cache/packs`).

Other invariants: `schemas/gmaiden-events.json` is the event-id source of truth (`src/data/
gmaiden-events.ts` mirrors it — update both). Banners inline as `data:` URLs in G-Maiden's overlay,
whose `image_mime` allows png/jpg/webp/gif/svg (**no apng** → normalize apng→png). The streak ladder
must match G-Maiden's overlay kill banner (`G-Maiden/src/src/App.tsx` `STREAK_LABELS`).

## repo https://github.com/Freshair129/G-Suite (private)
