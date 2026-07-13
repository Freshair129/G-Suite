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

## W4 — button-OCR event label (contract, not yet implemented)

The hybrid vision pipeline is: `detect_boundaries.py` (W1) finds each clip's
time window, whisper gives the spoken text, and **button-OCR gives the event
label**. HoN announcer-pack showcase videos highlight an event *button* per line
(Double Tap / Quad Kill / Killing Spree / …); OCRing the active button names the
event far more reliably than guessing from the (Thai) caption.

Planned sidecar (`detect_buttons.py`), mirroring `detect_boundaries.py`'s JSON
contract — video + the same line windows in, one raw label per line out:

```
{ "labels": [ { "startMs": 1234, "endMs": 2750, "label": "Quad Kill" }, ... ] }
```

The frontend does **not** hardcode the HoN→Dota table in Python — it passes the
raw `label` string to `matchAnnouncerLabel()` in `src/src/lib/honEventMap.ts`,
the single source of truth (HoN streak ladder ≈ Dota's; multikills by count:
Quad = ultra_kill, Annihilation = rampage). Unmatched labels fall back to the
LLM / manual mapping. Keep the OCR sidecar dumb: emit text, resolve in one place.

Caveat (same as W1): the button ROI + highlight detection is calibrated to the
HoN preview UI; community videos will need per-video ROI/threshold options.
An OCR engine (tesseract / easyocr) must be added to the venv before this runs.
