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
