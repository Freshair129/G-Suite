---
version: "0.4.0"
created_at: "2026-10-15T00:00:00+07:00,Codex"
last_update: "2026-10-15T00:00:00+07:00,Codex"
status: "candidate"
attributes:
  doc_type: "feature-specification"
  scope: "G-AnnStudio standalone runtime safety, issue #5"
---

# G-AnnStudio standalone runtime safety

Issue: [Freshair129/G-Suite#5](https://github.com/Freshair129/G-Suite/issues/5)

## Problem and boundary

G-AnnStudio invokes FFmpeg and Python sidecars through Tauri commands, but a
working frontend does not establish that those external runtimes or Python
modules are installed. Current import, cut, export, and pack-install paths use
FFmpeg overwrite mode. Pack installation reports success after local files are
written even when G-Maiden is not running or rejects the activation request.
The app bundle does not currently include sidecar scripts.

This change makes the existing standalone authoring features operable and
safe. It does not add a global GPU coordinator, change G-Maiden's live-game
behavior, upload media, install inference models, or verify against a user's
G-Maiden directory.

## Requirements

| ID | Requirement | Acceptance |
| --- | --- | --- |
| ANN-RUNTIME-001 | Resolve FFmpeg, Python, and sidecar scripts from explicit overrides, the configured local tools root, packaged app resources, app-local environment, or PATH; expose version and dependency health in Settings. | Diagnostics identify each executable/script, check FFmpeg version and required Python package metadata, and report missing tools/modules with next steps. It does not import sidecar packages or start inference. |
| ANN-RUNTIME-002 | Keep source and existing destination files unchanged during import, cut, export, and install. | Synthetic media passes import/cut/export and FFmpeg probe; source SHA-256 is unchanged; a collision fails clearly and retains original target bytes. |
| ANN-RUNTIME-003 | Distinguish files written from G-Maiden activation accepted, rejected, or unavailable. | A disposable voice-cache fixture receives only new pack contents; test endpoints cover 2xx, non-2xx, and connection failure; UI never claims activation without acknowledgment. |
| ANN-RUNTIME-004 | Include Python sidecar scripts in the Tauri bundle and provide repeatable CPU-only dependency setup without fetching model weights. | Bundle configuration includes scripts/requirements; setup provisions Python packages only; model download remains a separate inference operation. |

## Runtime resolution and health design

1. `FFMPEG_PATH`, `PYTHON_PATH`, and `SIDECAR_DIR` remain explicit overrides.
2. `AI_STUDIO_TOOLS_DIR` is an optional tools root. The resolver checks known
   `ffmpeg/**/bin/ffmpeg[.exe]` and `python/**/python[.exe]` locations with one
   version-directory level. Discovery stays bounded.
3. The Tauri resource directory supplies packaged `sidecar/*.py`, requirements,
   and the setup helper. The glob preserves script filenames under `sidecar/`; each individually listed requirements/setup file maps to its full destination filename under the same directory. Development builds may use the crate sidecar directory.
4. Python checks the development sidecar venv and app-local `sidecar-python`
   environment before selecting a base interpreter from the shared tools root
   or PATH. The setup helper targets the app-local environment by default.
5. `runtime_diagnostics` checks executable versions, sidecar files, and
   `find_spec` results for `faster_whisper`, `av`, `cv2`, and
   `rapidocr_onnxruntime`. This finds installed package metadata; it does not
   prove imports, Python ABI compatibility, model availability, or inference.
   The setup helper separately requires Python 3.11 or newer. Diagnostics
   never loads a model or probes CUDA. Settings shows paths and prerequisite
   status.
6. The desktop app always passes `--device cpu`. It does not expose GPU
   inference; an explicit manual sidecar CLI invocation is required to select
   an optional CUDA device.

## Safe output and activation design

- Media commands validate finite, positive time ranges and source existence.
- FFmpeg writes into a unique temporary directory with no-overwrite mode. A
  destination is created only if its name remains unused; only files created by
  the current operation may be removed during rollback.
- Audio import stores the extracted WAV under the app cache directory rather
  than beside author-selected source media.
- Pack installation stages under the selected G-Maiden voice-cache, checks for
  name collisions before promotion, and never replaces an existing pack.
- The G-Maiden POST response is checked for HTTP success. The report includes
  local file counts/path and an activation state (`accepted`, `rejected`, or
  `unavailable`) with status/error detail. Local files remain available for
  manual activation when the app is offline.
- The install endpoint defaults to `http://127.0.0.1:3000/announcer/install`.
  A build-time `VITE_GMAIDEN_INSTALL_ENDPOINT` override is accepted only for
  HTTP loopback hosts and the `/announcer/install` path, so acceptance fixtures
  can use a dedicated port without using the shared G-Maiden port.

## Verification plan and evidence boundary

The test fixture is a repository-independent 14.48-second mono 16 kHz WAV
generated for this audit. A native Windows debug custom-protocol build launched
through Tauri WebDriver and passed eight checks with a distinct acceptance
identifier: runtime diagnostics, import and FFmpeg probe, cut and export,
collision preservation, export and probe, accepted and rejected
G-Maiden-shaped fixture responses, unchanged source hash, and SQLite
`save_pack`/`load_packs` persistence across a full native process restart. The
restart fixture used a run-scoped database. The loopback fixture used port
38431; the build-time endpoint override was restricted to loopback. Generated
imported media was moved into run evidence after its hash was checked, and the
acceptance-only cache directories were removed after proving them empty.

A separate native debug run also passed CPU Whisper through Tauri IPC: the
normalized transcript matched all 28 expected English words, with timestamps
inside the 14.48-second sample. That run preceded the isolated-identifier
repeat and wrote one test-generated WAV into the default app cache; the exact
file was preserved in its run evidence after hash verification. Direct CPU
sidecar checks also matched the English fixture and three OCR fixture lines.
These records are separate runs and do not constitute Thai transcription or
live-game quality evidence.

The isolated native runs use an explicit sidecar directory and Python path, so
they do not verify runtime fallback to resources embedded in a packaged
installer. The native harness invokes Tauri commands over the bridge after
launch; it is not a visual click-through of every screen. It verifies SQLite
pack persistence, not `.ann` project-dialog save/open behavior. The component tests
cover accepted, rejected, and unavailable install notices with a mocked Tauri
invoke. Tests use a disposable G-Maiden-shaped directory and an owned loopback
HTTP server. No live game directory, GPU job, or external service is required
for these checks. The verified executable is a debug custom-protocol build,
not a release installer or signed distribution artifact.

CPU Whisper and OCR inference are separate functional checks: they need the
machine's cached model/runtime and coordinated CPU availability. Successful
diagnostics or mocked sidecar tests do not prove transcription quality or OCR
accuracy. Browser unit tests do not prove Tauri command registration, sidecar
packaging, or native UI operation.

## Changelog

| Version | Date | Status | Summary |
| --- | --- | --- | --- |
| 0.1.0 | 2026-10-15 | candidate | Specify bounded standalone runtime, safe output, and install acknowledgment for issue #5. |
| 0.2.0 | 2026-10-15 | candidate | Align Python discovery with the app-local CPU environment and clarify explicit CLI-only GPU use. |
| 0.3.0 | 2026-10-15 | candidate | Restrict acceptance endpoint overrides to HTTP loopback, include OpenCV in video prerequisites, and clarify package-discovery limits. |
| 0.4.0 | 2026-10-15 | candidate | Record focused Rust, frontend, and native debug IPC/media/pack acceptance with artifact hashes and the remaining packaged-resource, UI, and release gates. |
