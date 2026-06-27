use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

/// Resolve the ffmpeg binary. Order: `FFMPEG_PATH` env → a bundled/global
/// `ffmpeg-static` install → bare `ffmpeg` on `PATH`.
fn ffmpeg_bin() -> String {
    resolve_bin("ffmpeg", "FFMPEG_PATH")
}

fn resolve_bin(name: &str, env_key: &str) -> String {
    // 1. Explicit override.
    if let Ok(p) = std::env::var(env_key) {
        if !p.is_empty() && Path::new(&p).exists() {
            return p;
        }
    }
    // 2. ffmpeg-static next to the node toolchain (common on this project's
    //    Windows setup). Probe a couple of likely roots.
    let file = format!("{name}{EXE}");
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = Path::new(&home);
        for root in [
            home.join("AppData/Local/GoVibeToolchains"),
            home.join("AppData/Roaming/npm/node_modules"),
        ] {
            if let Some(hit) = find_ffmpeg_static(&root, &file) {
                return hit;
            }
        }
    }
    // 3. Fall back to PATH.
    name.to_string()
}

/// Shallow search for `node_modules/ffmpeg-static/<file>` under `root`
/// (one level of node version dirs deep), returning the first hit.
fn find_ffmpeg_static(root: &Path, file: &str) -> Option<String> {
    let direct = root.join("ffmpeg-static").join(file);
    if direct.exists() {
        return Some(direct.to_string_lossy().into_owned());
    }
    let entries = std::fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let candidate = entry
            .path()
            .join("node_modules/ffmpeg-static")
            .join(file);
        if candidate.exists() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

#[derive(Serialize)]
struct AudioInfo {
    path: String,
    duration: f64,
    sample_rate: u32,
}

#[derive(Deserialize)]
struct ClipRegion {
    id: String,
    name: String,
    start: f64,
    end: f64,
    event: String,
}

#[derive(Serialize)]
struct ExportResult {
    clips: Vec<ExportedClip>,
    manifest_path: String,
}

#[derive(Serialize)]
struct ExportedClip {
    id: String,
    name: String,
    path: String,
    event: String,
    duration: f64,
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
async fn extract_audio(input_path: String) -> Result<AudioInfo, String> {
    let input = Path::new(&input_path);
    let stem = input.file_stem().unwrap_or_default().to_string_lossy();
    let out_dir = input.parent().unwrap_or(Path::new("."));
    let wav_path = out_dir.join(format!("{stem}_extracted.wav"));

    let output = Command::new(ffmpeg_bin())
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-y",
            "-i", &input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "1",
            wav_path.to_str().unwrap(),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {stderr}"));
    }

    let duration = wav_duration(wav_path.to_str().unwrap())?;

    Ok(AudioInfo {
        path: wav_path.to_string_lossy().into_owned(),
        duration,
        sample_rate: 44100,
    })
}

/// Duration of a PCM WAV, read straight from its header — no ffprobe needed
/// (`ffmpeg-static` ships ffmpeg.exe only, not ffprobe). Walks RIFF chunks for
/// `fmt ` (rate/channels/bits) and `data` (byte length).
fn wav_duration(path: &str) -> Result<f64, String> {
    let b = std::fs::read(path).map_err(|e| format!("read wav: {e}"))?;
    if b.len() < 44 || &b[0..4] != b"RIFF" || &b[8..12] != b"WAVE" {
        return Err("not a WAV file".into());
    }
    let le16 = |o: usize| u16::from_le_bytes([b[o], b[o + 1]]);
    let le32 = |o: usize| u32::from_le_bytes([b[o], b[o + 1], b[o + 2], b[o + 3]]);

    let (mut rate, mut channels, mut bits, mut data_len) = (0u32, 0u16, 0u16, 0u64);
    let mut pos = 12usize;
    while pos + 8 <= b.len() {
        let id = &b[pos..pos + 4];
        let size = le32(pos + 4) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= b.len() {
            channels = le16(body + 2);
            rate = le32(body + 4);
            bits = le16(body + 14);
        } else if id == b"data" {
            data_len = size as u64;
        }
        pos = body + size + (size & 1); // chunks are word-aligned
    }
    let bytes_per_sec = rate as u64 * channels as u64 * (bits as u64 / 8);
    if bytes_per_sec == 0 {
        return Err("invalid WAV header".into());
    }
    if data_len == 0 {
        data_len = b.len().saturating_sub(44) as u64;
    }
    Ok(data_len as f64 / bytes_per_sec as f64)
}

#[tauri::command]
async fn cut_clip(
    source_path: String,
    start: f64,
    end: f64,
    output_path: String,
) -> Result<String, String> {
    let duration = end - start;

    let output = Command::new(ffmpeg_bin())
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-y",
            "-i", &source_path,
            "-ss", &format!("{start:.3}"),
            "-t", &format!("{duration:.3}"),
            "-acodec", "pcm_s16le",
            &output_path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg cut failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {stderr}"));
    }

    Ok(output_path)
}

#[tauri::command]
async fn export_all(
    source_path: String,
    clips: Vec<ClipRegion>,
    output_dir: String,
) -> Result<ExportResult, String> {
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("cannot create output dir: {e}"))?;

    let mut exported: Vec<ExportedClip> = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        let filename = format!(
            "{:02}_{}.wav",
            i + 1,
            sanitize_filename(&clip.name)
        );
        let out_path = Path::new(&output_dir).join(&filename);
        let duration = clip.end - clip.start;

        let output = Command::new(ffmpeg_bin())
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-y",
                "-i", &source_path,
                "-ss", &format!("{:.3}", clip.start),
                "-t", &format!("{duration:.3}"),
                "-acodec", "pcm_s16le",
                out_path.to_str().unwrap(),
            ])
            .output()
            .await
            .map_err(|e| format!("ffmpeg cut failed for {}: {e}", clip.name))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffmpeg error for {}: {stderr}", clip.name));
        }

        exported.push(ExportedClip {
            id: clip.id.clone(),
            name: clip.name.clone(),
            path: filename,
            event: clip.event.clone(),
            duration,
        });
    }

    let manifest = serde_json::json!({
        "version": "1.0",
        "pack_name": "announcer-pack",
        "clips": exported,
    });
    let manifest_path = Path::new(&output_dir).join("announcer-manifest.json");
    std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .map_err(|e| format!("failed to write manifest: {e}"))?;

    Ok(ExportResult {
        clips: exported,
        manifest_path: manifest_path.to_string_lossy().into_owned(),
    })
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Locate the speech sidecar directory: `SIDECAR_DIR` env → `<exe>/sidecar`
/// (bundled) → the compile-time crate's `sidecar/` (dev).
fn sidecar_dir() -> PathBuf {
    if let Ok(d) = std::env::var("SIDECAR_DIR") {
        let p = PathBuf::from(d);
        if p.exists() {
            return p;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("sidecar");
            if p.exists() {
                return p;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar")
}

/// Resolve the sidecar Python: `PYTHON_PATH` env → the sidecar venv → `python`.
fn python_bin(sidecar: &Path) -> String {
    if let Ok(p) = std::env::var("PYTHON_PATH") {
        if !p.is_empty() && Path::new(&p).exists() {
            return p;
        }
    }
    let venv = if cfg!(windows) {
        sidecar.join(".venv/Scripts/python.exe")
    } else {
        sidecar.join(".venv/bin/python")
    };
    if venv.exists() {
        return venv.to_string_lossy().into_owned();
    }
    "python".to_string()
}

/// Transcribe a WAV via the faster-whisper sidecar and return its raw JSON
/// (`{language, duration, segments:[{start,end,text,words}]}`). The frontend
/// turns segments into regions.
#[tauri::command]
async fn transcribe_audio(
    wav_path: String,
    model: Option<String>,
    lang: Option<String>,
) -> Result<serde_json::Value, String> {
    let sidecar = sidecar_dir();
    let script = sidecar.join("transcribe.py");
    if !script.exists() {
        return Err(format!("sidecar script not found at {}", script.display()));
    }
    let py = python_bin(&sidecar);
    let model = model.unwrap_or_else(|| "medium".into());
    let lang = lang.unwrap_or_else(|| "th".into());

    let output = Command::new(&py)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            script.to_str().unwrap(),
            &wav_path,
            "--model",
            &model,
            "--lang",
            &lang,
        ])
        .output()
        .await
        .map_err(|e| format!("failed to spawn python ({py}): {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value = serde_json::from_str(stdout.trim()).map_err(|e| {
        let stderr = String::from_utf8_lossy(&output.stderr);
        format!("bad sidecar output: {e}\nstderr:\n{stderr}")
    })?;
    if let Some(err) = value.get("error") {
        return Err(format!("sidecar error: {err}"));
    }
    Ok(value)
}

/// Return raw file bytes to the webview as an ArrayBuffer. The waveform loads
/// audio via this (loadBlob) instead of the asset protocol, which sidesteps
/// CSP/CORS issues with wavesurfer's fetch.
#[tauri::command]
fn read_audio_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("read {path}: {e}"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

// ---- install a pack into G-Maiden ---------------------------------------

#[derive(Deserialize)]
struct InstallClip {
    name: String,
    start: f64,
    end: f64,
    event: String,
}

#[derive(Serialize)]
struct InstallReport {
    installed: usize,
    skipped: usize,
    voice_cache: String,
    per_event: std::collections::BTreeMap<String, usize>,
    endpoint: Option<String>,
}

/// Locate the G-Maiden repo: arg → `GMAIDEN_DIR` env → sibling of the G-Suite repo.
fn resolve_gmaiden_dir(arg: &Option<String>) -> Option<PathBuf> {
    if let Some(d) = arg {
        let p = PathBuf::from(d);
        if !d.is_empty() && p.exists() {
            return Some(p);
        }
    }
    if let Ok(d) = std::env::var("GMAIDEN_DIR") {
        let p = PathBuf::from(d);
        if p.exists() {
            return Some(p);
        }
    }
    // <manifest>/../../.. = G-Suite ; its sibling G-Maiden
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let gsuite = manifest.parent()?.parent()?.parent()?;
    let sib = gsuite.parent()?.join("G-Maiden");
    if sib.exists() {
        return Some(sib);
    }
    None
}

/// Cut every event-mapped clip to WAV into G-Maiden's `assets/voice-cache/{event}/`
/// and (optionally) POST a notify to G-Maiden's install endpoint so it reloads.
#[tauri::command]
async fn install_pack(
    source_path: String,
    clips: Vec<InstallClip>,
    pack_name: String,
    gmaiden_dir: Option<String>,
    endpoint: Option<String>,
) -> Result<InstallReport, String> {
    let base = resolve_gmaiden_dir(&gmaiden_dir)
        .ok_or("หา G-Maiden ไม่เจอ — ตั้ง env GMAIDEN_DIR หรือระบุ path")?;
    let vc = base.join("assets/voice-cache");

    let mut per_event: std::collections::BTreeMap<String, usize> = Default::default();
    let mut installed = 0usize;
    let mut skipped = 0usize;

    for clip in &clips {
        if clip.event.is_empty() || clip.event == "unused" {
            skipped += 1;
            continue;
        }
        let dir = vc.join(&clip.event);
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
        let n = per_event.entry(clip.event.clone()).or_insert(0);
        *n += 1;
        let fname = format!("{}_{:02}.wav", sanitize_filename(&pack_name), *n);
        let out_path = dir.join(&fname);
        let duration = clip.end - clip.start;

        let output = Command::new(ffmpeg_bin())
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-y",
                "-i",
                &source_path,
                "-ss",
                &format!("{:.3}", clip.start),
                "-t",
                &format!("{duration:.3}"),
                "-acodec",
                "pcm_s16le",
                out_path.to_str().unwrap(),
            ])
            .output()
            .await
            .map_err(|e| format!("ffmpeg: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "ffmpeg cut failed for {}: {}",
                clip.name,
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        installed += 1;
    }

    // Notify G-Maiden's install endpoint (best-effort — works once Phase 3 lands).
    let mut endpoint_result = None;
    if let Some(ep) = endpoint {
        if !ep.is_empty() {
            let body = serde_json::json!({
                "pack": pack_name,
                "installed": installed,
                "voice_cache": vc.to_string_lossy(),
            });
            match reqwest::Client::new().post(&ep).json(&body).send().await {
                Ok(r) => endpoint_result = Some(format!("{ep} → {}", r.status())),
                Err(e) => endpoint_result = Some(format!("{ep} (POST ไม่ติด: {e})")),
            }
        }
    }

    Ok(InstallReport {
        installed,
        skipped,
        voice_cache: vc.to_string_lossy().into_owned(),
        per_event,
        endpoint: endpoint_result,
    })
}

// ---- AI providers (for the chat) ----------------------------------------

/// List locally installed Ollama models (short — only when the daemon is up).
#[tauri::command]
async fn list_ollama_models() -> Result<Vec<String>, String> {
    let resp = reqwest::Client::new()
        .get("http://localhost:11434/api/tags")
        .send()
        .await
        .map_err(|e| format!("ollama not reachable: {e}"))?;
    let v: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    Ok(v["models"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|m| m["name"].as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default())
}

/// One-shot completion from the chosen provider. Returns the model's raw text
/// (the chat expects a JSON action object — see the system prompt).
#[tauri::command]
async fn llm_complete(
    provider: String,
    model: Option<String>,
    system: String,
    prompt: String,
) -> Result<String, String> {
    match provider.as_str() {
        "ollama" => ollama_chat(model.unwrap_or_else(|| "llama3".into()), system, prompt).await,
        "claude" => claude_cli(system, prompt).await,
        other => Err(format!("unknown provider: {other}")),
    }
}

async fn ollama_chat(model: String, system: String, prompt: String) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": prompt}
        ],
        "stream": false,
        "format": "json",
        "options": { "temperature": 0.2 }
    });
    let resp = reqwest::Client::new()
        .post("http://localhost:11434/api/chat")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("ollama: {e}"))?;
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("ollama json: {e}"))?;
    v["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "ollama: empty response".into())
}

async fn claude_cli(system: String, prompt: String) -> Result<String, String> {
    // Drive the installed `claude` CLI in print mode — uses the user's signed-in
    // Claude plan, no API key. Routed through cmd so the npm shim resolves.
    let output = Command::new("cmd")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "/c",
            "claude",
            "-p",
            &prompt,
            "--append-system-prompt",
            &system,
            "--output-format",
            "json",
        ])
        .output()
        .await
        .map_err(|e| format!("claude spawn: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("claude: {err}"));
    }
    let v: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("claude output not JSON: {e}"))?;
    v["result"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "claude: no result field".into())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            extract_audio,
            cut_clip,
            export_all,
            transcribe_audio,
            read_audio_bytes,
            install_pack,
            list_ollama_models,
            llm_complete,
        ])
        .run(tauri::generate_context!())
        .expect("error running G-AnnStudio");
}
