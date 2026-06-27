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

## Models

Default `medium`. For Thai announcer audio `large-v3` is more accurate but
slower on CPU. The model downloads from Hugging Face on first run and is cached
under `~/.cache/huggingface`.
