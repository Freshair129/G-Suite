# Speech sidecar

Auto-splits a clip into per-phrase regions by transcribing it with
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2 backend —
no PyTorch). The Rust backend spawns `transcribe.py` and reads JSON from stdout.

## Setup

The application uses Python only for local speech/video sidecars. In Settings,
select the shared `AI-Studio/tools` directory if FFmpeg or Python is outside
`PATH`. The selected directory is saved in app-local settings. Explicit
`FFMPEG_PATH`, `PYTHON_PATH`, and `SIDECAR_DIR` environment overrides still
take precedence.

Run the setup helper in PowerShell to create an app-local CPU environment:

```powershell
./setup-sidecar.ps1 -PythonPath "G:\AI-Studio\tools\python\cpython-3.11-windows-x86_64-none\python.exe" `
  -VenvPath "$env:LOCALAPPDATA\com.gmaiden.ann-studio\sidecar-python"
```

The desktop app discovers that default app-data environment automatically. If
you choose a different `-VenvPath`, set `PYTHON_PATH` to that environment's
`Scripts\python.exe` before launching the app so diagnostics and sidecar
commands use the installed modules.

Use `-PlanOnly` to inspect the selected interpreter, environment path, and
requirements without changing files. The helper installs Python packages from
`requirements.txt`; it does not select CUDA, download Whisper model weights, or
run inference. Model files are fetched only when a user explicitly starts a
transcription and they are not already cached.

Python resolution order is `PYTHON_PATH`, a development `sidecar/.venv`, the
app-local `sidecar-python` environment, Python under `AI_STUDIO_TOOLS_DIR`, then
`PATH`. FFmpeg and packaged sidecar scripts have their own diagnostics in
Settings. Tauri bundles the scripts and requirements; it does not bundle a
Python interpreter.

## GPU (optional, big win for large-v3)

G-AnnStudio sends `--device cpu` for transcription, and CPU is also the
sidecar's default. The desktop app does not expose GPU inference. For an
explicit manual CLI run on a supported NVIDIA machine, install the optional
GPU wheels:

```bash
.venv\Scripts\python -m pip install -r requirements-gpu.txt   # ~1.7 GB, CUDA 12 + cuDNN 9
```

Then pass `--device cuda` (or `auto`, which prefers GPU and falls back to CPU)
when invoking `transcribe.py` manually.
`transcribe.py` registers the wheels' DLL dirs itself — no system CUDA Toolkit
needed. Needs `cublas`, `cudnn`, **and** `cuda-runtime` (cublas depends on
`cudart64_12.dll`); add_dll_directory alone isn't enough, the bin dirs are also
prepended to `PATH` for ctranslate2's native loader.

## Models

Default `medium`. For Thai announcer audio `large-v3` is markedly more accurate
(cleaner text, no hallucinated foreign tokens, full coverage) — pair it with the
GPU. The model downloads from Hugging Face on first run and is cached under
`~/.cache/huggingface`.

## W4 — button-OCR event label (`detect_buttons.py`)

The hybrid vision pipeline is: `detect_boundaries.py` (W1) finds each clip's
time window, whisper gives the spoken text, and **button-OCR gives the event
label**. HoN announcer-pack showcase videos show a fixed grid of event *buttons*;
the user clicks each to play it (a golden Dota-style cursor sits on the active
one) while the green caption + audio fire. `detect_buttons.py` reads which button
was active per line window: OCR the panel → label + position for each button,
find the golden cursor (warm blob, R>G>B), pick the OCR label nearest the cursor,
vote across a few samples.

```
python detect_buttons.py <video> --windows '[[startMs,endMs],...]' \
    [--roi 0.36,0.80,0.82,1.0] [--samples 3] [--cursor-min-area 30]
# → {"labels":[{"startMs":..,"endMs":..,"label":"Hat Trick","cursor":true,"conf":0.85}, ...]}
```

The script emits the **raw** label; the frontend resolves HoN→G-Maiden via
`matchAnnouncerLabel()` in `src/src/lib/honEventMap.ts`, the single source of
truth (streak ladder ≈ Dota's; multikills by count — Double Tap = double_kill,
Hat Trick = triple_kill, Quad Kill = ultra_kill, Annihilation = rampage; it
tolerates OCR noise: camelCase, mild misreads). Unmatched labels fall back to the
LLM / manual mapping — keep the OCR sidecar dumb, resolve in one place.

Verified on `inbound/KOM-ANNOUNCER.mp4`: 11/11 line windows got a cursor + label
(Hat Trick, Bloodlust, Double Tap, Immortal, Annihilation, Genocide, …). OCR is
`rapidocr-onnxruntime` (in `requirements.txt`; ONNX, no PyTorch/tesseract).

Caveat (same as W1): the panel ROI + cursor color are calibrated to the Na Khom /
HoN preview UI; community videos vary, so `--roi` and the cursor thresholds are
parameters a later step should learn per video. The Rust wrapper that chains
W1→whisper→W4 for a full auto-label pass is not wired yet (neither is W1's).
