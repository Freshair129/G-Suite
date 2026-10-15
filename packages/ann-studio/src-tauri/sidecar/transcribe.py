"""
G-AnnStudio speech sidecar — transcribes an audio file with faster-whisper and
emits segment/word timestamps as JSON on stdout. Used by the Rust backend to
auto-split a clip into per-phrase regions.

Usage:
    python transcribe.py <wav_path> [--model MODEL] [--lang LANG] [--device DEV]

Output (stdout, JSON):
    {"language": "th", "duration": 120.7, "segments": [
        {"start": 0.0, "end": 4.0, "text": "...", "words": [
            {"word": "...", "start": 0.0, "end": 0.4}, ...]}, ...]}

Any error is emitted as {"error": "..."} on stdout with exit code 1, so the
Rust side gets a structured message instead of a stack trace on stderr.
"""
import sys
import json
import argparse


def eprint(*a):
    print(*a, file=sys.stderr, flush=True)


def register_cuda_dlls():
    """On Windows, add the pip-installed NVIDIA wheel bin dirs (cublas, cudnn,
    cuda_nvrtc) to the DLL search path so ctranslate2 finds cublas64_12.dll /
    cudnn64_9.dll without a system-wide CUDA Toolkit install."""
    if not sys.platform.startswith("win"):
        return
    import os
    import glob

    roots = []
    try:
        import nvidia
        roots.append(os.path.dirname(nvidia.__file__))
    except Exception:  # noqa: BLE001 — wheels may be absent (CPU-only box)
        roots.append(os.path.join(sys.prefix, "Lib", "site-packages", "nvidia"))
    for root in roots:
        for bindir in glob.glob(os.path.join(root, "*", "bin")):
            if not os.path.isdir(bindir):
                continue
            # add_dll_directory covers Python-driven loads; prepending PATH is
            # what ctranslate2's native runtime actually honours when it
            # LoadLibrary's cublas/cudnn/cudart at first inference.
            try:
                os.add_dll_directory(bindir)
            except OSError as e:
                eprint(f"[sidecar] add_dll_directory failed: {e}")
            os.environ["PATH"] = bindir + os.pathsep + os.environ.get("PATH", "")
            eprint(f"[sidecar] cuda lib dir + {bindir}")


def main() -> int:
    # Windows console/redirect defaults to cp1252, which can't encode Thai —
    # force UTF-8 so the JSON (ensure_ascii=False) round-trips to the Rust side.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass

    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--model", default="medium")
    ap.add_argument("--lang", default=None, help="language code, e.g. 'th'; auto-detect if omitted")
    ap.add_argument("--device", default="cpu", choices=["auto", "cpu", "cuda"])
    args = ap.parse_args()

    if args.device != "cpu":
        register_cuda_dlls()

    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        print(json.dumps({"error": f"faster-whisper not installed: {e}"}))
        return 1

    # CPU is the safe default. `auto` may use the optional NVIDIA wheels and
    # falls back to CPU if initialization or the first GEMM fails.
    if args.device == "cpu":
        attempts = [("cpu", "int8")]
    else:  # auto | cuda
        attempts = [("cuda", "float16"), ("cpu", "int8")]

    model = None
    info = None
    segments = []
    last_err = None
    for device, compute in attempts:
        try:
            eprint(f"[sidecar] loading {args.model} on {device}/{compute}")
            model = WhisperModel(args.model, device=device, compute_type=compute)
            segments, info = model.transcribe(
                args.wav,
                language=args.lang,
                word_timestamps=True,
                vad_filter=True,
            )
            # Force the lazy generator now so a runtime backend error (e.g. a
            # missing CUDA lib) is caught here and can fall back to CPU.
            segments = list(segments)
            break
        except Exception as e:  # noqa: BLE001 — backend init or runtime failure
            last_err = e
            eprint(f"[sidecar] {device} failed: {e}")
            model = None
    if model is None:
        print(json.dumps({"error": f"transcription failed: {last_err}"}))
        return 1

    try:
        out = {
            "language": info.language,
            "duration": info.duration,
            "segments": [],
        }
        for seg in segments:
            out["segments"].append({
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text.strip(),
                "words": [
                    {"word": w.word, "start": round(w.start, 3), "end": round(w.end, 3)}
                    for w in (seg.words or [])
                ],
            })
        print(json.dumps(out, ensure_ascii=False))
        return 0
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"error": f"transcription failed: {e}"}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
