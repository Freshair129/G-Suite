# Speech sidecar

Auto-splits a clip into per-phrase regions by transcribing it with
[faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CTranslate2 backend —
no PyTorch). The Rust backend spawns `transcribe.py` and reads JSON from stdout.

## Setup

```bash
# from packages/ann-studio/src-tauri/sidecar
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt   # Windows
```

The Rust side looks for Python in this order:
1. `PYTHON_PATH` env var
2. `sidecar/.venv/Scripts/python.exe` (this venv)
3. `python` / `python3` on `PATH`

## GPU (optional, big win for large-v3)

CPU is the default and needs nothing extra. To transcribe on an NVIDIA GPU:

```bash
.venv\Scripts\python -m pip install -r requirements-gpu.txt   # ~1.7 GB, CUDA 12 + cuDNN 9
```

Then pass `--device cuda` (or `auto`, which prefers GPU and falls back to CPU).
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
