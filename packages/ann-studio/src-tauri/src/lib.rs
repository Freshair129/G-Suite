mod banner_asset_archive;
mod build_jobs;
mod gann;
mod gann_authoring;
mod maiden_client;
mod media_jobs;
mod project_io;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[tauri::command]
fn project_startup_path(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    gann::trusted(&window)?;
    Ok(std::env::args().skip(1).find(|path| {
        Path::new(path)
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("ann"))
    }))
}

#[tauri::command]
async fn prepare_project(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
    asset_paths: std::collections::BTreeMap<String, String>,
    session_token: Option<String>,
) -> Result<project_io::ProjectOpenResult, String> {
    use tauri::Manager;
    gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || {
        project_io::prepare_with_session(snapshot, asset_paths, session_token, &workspace)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn save_project(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
    snapshot: serde_json::Value,
    asset_paths: std::collections::BTreeMap<String, String>,
    session_token: String,
    confirmed_destination_digest: Option<String>,
) -> Result<project_io::ProjectSaveResult, String> {
    use tauri::Manager;
    gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || {
        project_io::save_with_session_confirmed_destination(
            Path::new(&path),
            snapshot,
            asset_paths,
            &session_token,
            confirmed_destination_digest.as_deref(),
            &workspace,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_project(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
) -> Result<project_io::ProjectOpenResult, String> {
    use tauri::Manager;
    gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || project_io::open(Path::new(&path), &workspace))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn recover_project(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_id: String,
) -> Result<project_io::RecoveryListing, String> {
    use tauri::Manager;
    gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || project_io::recover(&project_id, &workspace))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn open_recovery_candidate(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_id: String,
    candidate_id: String,
) -> Result<project_io::ProjectOpenResult, String> {
    use tauri::Manager;
    gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || {
        project_io::open_recovery_candidate(&project_id, &candidate_id, &workspace)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn activate_project_session(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    snapshot: serde_json::Value,
    asset_paths: std::collections::BTreeMap<String, String>,
    expected_session_token: Option<String>,
) -> Result<project_io::ProjectOpenResult, String> {
    use tauri::Manager;
    gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || {
        project_io::activate_project_session(
            snapshot,
            asset_paths,
            expected_session_token,
            &workspace,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn inspect_banner_asset_archive(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<banner_asset_archive::BannerAssetPreview, String> {
    gann::trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || banner_asset_archive::inspect(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_banner_asset_archive(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    path: String,
    manifest_sha256: String,
    variant_id: String,
    expected_generation: u64,
    session_token: String,
    snapshot: serde_json::Value,
    asset_paths: std::collections::BTreeMap<String, String>,
) -> Result<project_io::ProjectOpenResult, String> {
    use tauri::Manager;
    gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || {
        project_io::import_banner_asset_archive_with_session(
            Path::new(&path),
            &manifest_sha256,
            &variant_id,
            expected_generation,
            &session_token,
            snapshot,
            asset_paths,
            &workspace,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

fn ffmpeg_bin() -> Result<PathBuf, String> {
    media_jobs::tool_path()
}

#[derive(Serialize)]
struct AudioInfo {
    path: String,
    duration: f64,
    sample_rate: u32,
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
async fn extract_audio(input_path: String) -> Result<AudioInfo, String> {
    let input = Path::new(&input_path);
    let stem = input.file_stem().unwrap_or_default().to_string_lossy();
    let out_dir = input.parent().unwrap_or(Path::new("."));
    let wav_path = out_dir.join(format!("{stem}_extracted.wav"));

    let output = Command::new(ffmpeg_bin()?)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-y",
            "-i",
            &input_path,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "44100",
            "-ac",
            "1",
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

    let output = Command::new(ffmpeg_bin()?)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-y",
            "-i",
            &source_path,
            "-ss",
            &format!("{start:.3}"),
            "-t",
            &format!("{duration:.3}"),
            "-acodec",
            "pcm_s16le",
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

/// Round seconds to 2 decimals for clean metadata (cutting still uses full
/// precision from clip.start/end — this only tidies the stored/reported number).
fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
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

/// Spawn a sidecar script with `py` and return its raw process output.
async fn spawn_sidecar(
    py: &str,
    script: PathBuf,
    args: Vec<String>,
) -> Result<std::process::Output, String> {
    let mut a = vec![script.to_string_lossy().into_owned()];
    a.extend(args);
    Command::new(py)
        .creation_flags(CREATE_NO_WINDOW)
        .args(&a)
        .output()
        .await
        .map_err(|e| format!("spawn {}: {e}", script.display()))
}

/// One analyzed line from the vision pipeline: a clip window with its spoken
/// text (whisper) and the raw HoN button label (W4). `label` may be empty; the
/// frontend resolves it to a G-Maiden event via honEventMap (single source).
#[derive(Serialize)]
struct AnalyzedClip {
    start: f64,
    end: f64,
    text: String,
    label: String,
}

/// Full vision pipeline for an announcer-showcase VIDEO: chain the three
/// sidecars — detect_boundaries.py (W1, line windows) → transcribe.py (whisper
/// text) → detect_buttons.py (W4, active button label) — and fuse them into
/// pre-labelled clips. Returns an empty vec if W1 finds no caption windows (the
/// caller then falls back to plain whisper auto-split). detect_buttons failing
/// (e.g. rapidocr not installed) degrades to empty labels, not an error.
#[tauri::command]
async fn analyze_video(
    video_path: String,
    wav_path: String,
    model: Option<String>,
    lang: Option<String>,
) -> Result<Vec<AnalyzedClip>, String> {
    let sidecar = sidecar_dir();
    let py = python_bin(&sidecar);
    let model = model.unwrap_or_else(|| "medium".into());
    let lang = lang.unwrap_or_else(|| "th".into());

    // 1. W1 — vision line boundaries from the video
    let b = spawn_sidecar(
        &py,
        sidecar.join("detect_boundaries.py"),
        vec![video_path.clone()],
    )
    .await?;
    let b_json: serde_json::Value = serde_json::from_str(String::from_utf8_lossy(&b.stdout).trim())
        .map_err(|e| {
            format!(
                "detect_boundaries: {e}\n{}",
                String::from_utf8_lossy(&b.stderr)
            )
        })?;
    let lines = b_json["lines"].as_array().cloned().unwrap_or_default();
    if lines.is_empty() {
        return Ok(vec![]);
    }
    let windows: Vec<(f64, f64)> = lines
        .iter()
        .map(|l| {
            (
                l["startMs"].as_f64().unwrap_or(0.0) / 1000.0,
                l["endMs"].as_f64().unwrap_or(0.0) / 1000.0,
            )
        })
        .collect();

    // 2. whisper — transcript segments from the wav
    let t = spawn_sidecar(
        &py,
        sidecar.join("transcribe.py"),
        vec![wav_path, "--model".into(), model, "--lang".into(), lang],
    )
    .await?;
    let t_json: serde_json::Value = serde_json::from_str(String::from_utf8_lossy(&t.stdout).trim())
        .map_err(|e| format!("transcribe: {e}\n{}", String::from_utf8_lossy(&t.stderr)))?;
    let segments = t_json["segments"].as_array().cloned().unwrap_or_default();

    // 3. W4 — active button label per window (best-effort; empty on failure)
    let windows_ms: Vec<[f64; 2]> = lines
        .iter()
        .map(|l| {
            [
                l["startMs"].as_f64().unwrap_or(0.0),
                l["endMs"].as_f64().unwrap_or(0.0),
            ]
        })
        .collect();
    let labels: Vec<String> = match spawn_sidecar(
        &py,
        sidecar.join("detect_buttons.py"),
        vec![
            video_path,
            "--windows".into(),
            serde_json::to_string(&windows_ms).unwrap(),
        ],
    )
    .await
    {
        Ok(o) => {
            serde_json::from_str::<serde_json::Value>(String::from_utf8_lossy(&o.stdout).trim())
                .ok()
                .and_then(|v| v["labels"].as_array().cloned())
                .map(|arr| {
                    arr.iter()
                        .map(|x| x["label"].as_str().unwrap_or("").to_string())
                        .collect()
                })
                .unwrap_or_default()
        }
        Err(_) => Vec::new(),
    };

    // 4. fuse: a window's text = whisper segments whose midpoint lands inside it
    let clips = windows
        .iter()
        .enumerate()
        .map(|(i, &(s, e))| {
            let text = segments
                .iter()
                .filter_map(|seg| {
                    let ss = seg["start"].as_f64()?;
                    let se = seg["end"].as_f64()?;
                    let mid = (ss + se) / 2.0;
                    if mid >= s - 0.15 && mid <= e + 0.15 {
                        Some(seg["text"].as_str().unwrap_or("").trim().to_string())
                    } else {
                        None
                    }
                })
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            AnalyzedClip {
                start: s,
                end: e,
                text,
                label: labels.get(i).cloned().unwrap_or_default(),
            }
        })
        .collect();
    Ok(clips)
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
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallClip {
    // tuning (focused set) — applied as an ffmpeg -af chain on cut. Defaulted so
    // Untuned authoring jobs retain the default chain.
    #[serde(default)]
    gain: f64, // dB
    #[serde(default)]
    fade_in: f64, // seconds
    #[serde(default)]
    fade_out: f64, // seconds
    #[serde(default)]
    normalize: bool,
    #[serde(default)]
    speed: f64, // playback rate; 0/absent => 1.0
    #[serde(default)]
    gain_l: f64, // per-channel dB (stereo balance)
    #[serde(default)]
    gain_r: f64,
    // LANDR-style mastering knobs, keyed camelCase (eqLow/eqMid/eqHigh, presence,
    // deEsserAmt/deEsserFreq, compression/character/saturation), each -100..100.
    #[serde(default)]
    master: std::collections::HashMap<String, f64>,
}

/// Build the ffmpeg `-af` filter chain for a clip's tuning, or None if untuned.
/// Order: de-ess → EQ → dynamics → normalize → gain → fades (a sane master chain).
fn clip_audio_filter(c: &InstallClip, dur: f64) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    let m = |k: &str| c.master.get(k).copied().unwrap_or(0.0);
    let db = |v: f64, max: f64| (v / 100.0) * max; // knob(-100..100) -> ±max dB

    // de-esser (additive; ignore negative)
    let de = m("deEsserAmt");
    if de > 1.0 {
        let f = (m("deEsserFreq") / 100.0).clamp(0.0, 1.0);
        parts.push(format!(
            "deesser=i={:.3}:f={:.3}",
            (de / 100.0).clamp(0.0, 1.0),
            if f > 0.0 { f } else { 0.5 }
        ));
    }
    // EQ (peaking/shelf)
    if m("eqLow").abs() > 0.5 {
        parts.push(format!("bass=g={:.2}", db(m("eqLow"), 12.0)));
    }
    if m("eqMid").abs() > 0.5 {
        parts.push(format!(
            "equalizer=f=1000:width_type=o:width=1:g={:.2}",
            db(m("eqMid"), 12.0)
        ));
    }
    if m("eqHigh").abs() > 0.5 {
        parts.push(format!("treble=g={:.2}", db(m("eqHigh"), 12.0)));
    }
    if m("presence").abs() > 0.5 {
        parts.push(format!(
            "equalizer=f=4000:width_type=o:width=1.2:g={:.2}",
            db(m("presence"), 8.0)
        ));
    }
    // dynamics
    let comp = m("compression");
    if comp > 1.0 {
        let ratio = 1.0 + (comp / 100.0) * 7.0; // 1..8
        parts.push(format!(
            "acompressor=threshold=-18dB:ratio={:.2}:attack=20:release=200",
            ratio
        ));
    }
    let ch = m("character");
    if ch > 1.0 {
        parts.push(format!("acontrast=contrast={:.0}", (ch).clamp(0.0, 100.0)));
    }
    let sat = m("saturation");
    if sat > 1.0 {
        let thr = (1.0 - (sat / 100.0) * 0.7).clamp(0.2, 1.0);
        parts.push(format!("asoftclip=type=atan:threshold={:.3}", thr));
    }
    // normalize / gain / fades
    if c.normalize {
        parts.push("dynaudnorm".to_string());
    }
    if c.gain.abs() > 0.01 {
        parts.push(format!("volume={:.2}dB", c.gain));
    }
    if c.fade_in > 0.001 {
        parts.push(format!("afade=t=in:st=0:d={:.3}", c.fade_in.min(dur)));
    }
    if c.fade_out > 0.001 {
        let d = c.fade_out.min(dur);
        parts.push(format!(
            "afade=t=out:st={:.3}:d={:.3}",
            (dur - d).max(0.0),
            d
        ));
    }
    // playback speed last, so fades/EQ apply on the original then scale together
    let sp = if c.speed <= 0.0 { 1.0 } else { c.speed };
    if (sp - 1.0).abs() > 0.01 {
        parts.push(format!("atempo={:.3}", sp.clamp(0.5, 2.0)));
    }
    // per-channel L/R gains → stereo (only when set); upmix mono with pan
    if c.gain_l.abs() > 0.01 || c.gain_r.abs() > 0.01 {
        let ll = 10f64.powf(c.gain_l / 20.0);
        let rr = 10f64.powf(c.gain_r / 20.0);
        parts.push(format!("pan=stereo|c0={ll:.4}*c0|c1={rr:.4}*c0"));
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(","))
    }
}

/// Locate the G-Maiden repo: arg → `GMAIDEN_DIR` env → sibling of the G-Suite repo.
/// The voice-cache directory G-Maiden actually READS from, mirroring its own
/// `voice_cache_dir()`: the exe-adjacent `voice-cache/` (an installed build)
/// wins over the dev-tree `assets/voice-cache/`. So a pack lands where THIS
/// G-Maiden looks for it — installed or dev — instead of always `assets/`.
fn voice_cache_root(base: &Path) -> PathBuf {
    let installed = base.join("voice-cache");
    if installed.is_dir() {
        return installed;
    }
    let dev = base.join("assets/voice-cache");
    if dev.is_dir() {
        return dev;
    }
    // neither exists yet — a repo checkout has `assets/`, an install dir does not
    if base.join("assets").is_dir() {
        dev
    } else {
        installed
    }
}

/// Best-effort: resolve the INSTALLED G-Maiden's directory from its Start-menu
/// shortcut, so G-Ann can target a real install (not just the dev repo) without
/// the user configuring a path. Returns the exe's folder.
fn detect_installed_gmaiden() -> Option<PathBuf> {
    use std::os::windows::process::CommandExt;
    let appdata = std::env::var_os("APPDATA")?;
    let lnk = Path::new(&appdata).join("Microsoft/Windows/Start Menu/Programs/G-Maiden.lnk");
    if !lnk.exists() {
        return None;
    }
    let script = format!(
        "(New-Object -ComObject WScript.Shell).CreateShortcut('{}').TargetPath",
        lnk.to_string_lossy().replace('\'', "''")
    );
    let out = std::process::Command::new("powershell")
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .ok()?;
    let target = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if target.is_empty() {
        return None;
    }
    Path::new(&target)
        .parent()
        .map(Path::to_path_buf)
        .filter(|p| p.exists())
}

/// The dev sibling repo (`../G-Maiden` next to G-Suite), if present.
fn dev_repo() -> Option<PathBuf> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .and_then(Path::parent)
        .map(|d| d.join("G-Maiden"))
}

/// Best-effort auto-detect of a G-Maiden that already has a `voice-cache/` to
/// write into, in the order Boss actually runs one: a repo RELEASE build, then
/// a debug build, then the installed build (Start-menu shortcut). Returns the
/// directory to pass as the base — `voice_cache_root` picks its layout.
fn detect_gmaiden_target() -> Option<PathBuf> {
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Some(repo) = dev_repo() {
        cands.push(repo.join("src-tauri/target/release"));
        cands.push(repo.join("src-tauri/target/debug"));
    }
    if let Some(installed) = detect_installed_gmaiden() {
        cands.push(installed);
    }
    cands.into_iter().find(|c| c.join("voice-cache").is_dir())
}

/// Locate a G-Maiden install: explicit arg → `GMAIDEN_DIR` env → the dev sibling
/// repo (`../G-Maiden`) → the installed build via its Start-menu shortcut.
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
    // dev sibling repo (`../G-Maiden`) — for running G-Maiden from source
    if let Some(sib) = dev_repo() {
        if sib.exists() {
            return Some(sib);
        }
    }
    // fall back to a real built/installed G-Maiden (release/debug/installed)
    detect_gmaiden_target()
}

/// Return the installed G-Maiden directory (from its Start-menu shortcut), or
/// "" if not found. Lets the Settings UI auto-fill the G-Maiden path.
#[tauri::command]
fn detect_gmaiden_installed() -> String {
    detect_gmaiden_target()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_default()
}

// ---- Game Profile / G-Maiden integration ---------------------------------

#[derive(Serialize)]
struct GMaidenStatus {
    found: bool,
    path: String,
}

/// Bake a sequence of alpha PNG frames (base64, no `data:` prefix) into a single
/// **animated WebP** and return it base64-encoded. The clip plays once and rests
/// on the final frame (`-loop 1`), giving the auto tone banner an entrance
/// animation without an author image. Lossless to keep the banner text crisp.
#[tauri::command]
async fn bake_animated_webp(
    frames: Vec<String>,
    fps: Option<u32>,
    loop_count: Option<u32>,
) -> Result<String, String> {
    use base64::Engine;
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);

    if frames.is_empty() {
        return Err("no frames to bake".into());
    }
    let fps = fps.unwrap_or(24).clamp(1, 60);
    // 0 = loop forever (audio-reactive pulse); 1 = play once, rest on last frame.
    let loop_count = loop_count.unwrap_or(1);

    // unique temp dir (pid + monotonic counter — no wall-clock needed)
    let uid = format!(
        "{}_{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let dir = std::env::temp_dir().join(format!("gann_bake_{uid}"));
    std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir temp: {e}"))?;

    let engine = base64::engine::general_purpose::STANDARD;
    for (i, f) in frames.iter().enumerate() {
        match engine.decode(f.trim()) {
            Ok(bytes) => {
                if let Err(e) = std::fs::write(dir.join(format!("f_{i:03}.png")), bytes) {
                    let _ = std::fs::remove_dir_all(&dir);
                    return Err(format!("write frame {i}: {e}"));
                }
            }
            Err(e) => {
                let _ = std::fs::remove_dir_all(&dir);
                return Err(format!("frame {i} base64: {e}"));
            }
        }
    }

    let out = dir.join("out.webp");
    let pattern = dir.join("f_%03d.png");
    let result = Command::new(ffmpeg_bin()?)
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-y",
            "-framerate",
            &fps.to_string(),
            "-start_number",
            "0",
            "-i",
            &pattern.to_string_lossy(),
            "-c:v",
            "libwebp_anim",
            "-lossless",
            "1",
            "-loop",
            &loop_count.to_string(),
            &out.to_string_lossy(),
        ])
        .output()
        .await;

    let encoded = match result {
        Ok(output) if output.status.success() => match std::fs::read(&out) {
            Ok(bytes) => Ok(engine.encode(bytes)),
            Err(e) => Err(format!("read webp: {e}")),
        },
        Ok(output) => Err(format!(
            "ffmpeg webp bake failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )),
        Err(e) => Err(format!("ffmpeg spawn: {e}")),
    };
    let _ = std::fs::remove_dir_all(&dir);
    encoded
}

/// Generate a banner image via a local **Stable Diffusion WebUI (A1111-
/// compatible)** `txt2img` endpoint. Returns the first image as base64 PNG (no
/// `data:` prefix) for use as a banner override. Requires the WebUI running with
/// `--api` at `endpoint` (default `http://127.0.0.1:7860`); errors clearly if not.
#[tauri::command]
async fn generate_banner_image(
    prompt: String,
    endpoint: String,
    negative: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    steps: Option<u32>,
) -> Result<String, String> {
    use serde_json::{json, Value};

    let ep = endpoint.trim().trim_end_matches('/');
    if ep.is_empty() {
        return Err("ยังไม่ได้ตั้ง Stable Diffusion endpoint (Settings → AI)".into());
    }
    let url = format!("{ep}/sdapi/v1/txt2img");
    let body = json!({
        "prompt": prompt,
        "negative_prompt": negative.unwrap_or_default(),
        "width": width.unwrap_or(768),
        "height": height.unwrap_or(256),
        "steps": steps.unwrap_or(24),
        "cfg_scale": 7,
        "sampler_name": "DPM++ 2M Karras",
    });

    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .timeout(std::time::Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| {
            format!("เชื่อม SD ไม่ได้ ({e}) — เปิด Stable Diffusion WebUI แบบ --api ที่ {ep} หรือยัง?")
        })?;

    if !resp.status().is_success() {
        let code = resp.status();
        let msg = resp.text().await.unwrap_or_default();
        return Err(format!("SD {code}: {msg}"));
    }

    let v: Value = resp
        .json()
        .await
        .map_err(|e| format!("อ่านผล SD ไม่ได้: {e}"))?;
    let img = v["images"]
        .as_array()
        .and_then(|a| a.first())
        .and_then(|s| s.as_str())
        .ok_or("SD ไม่คืนรูปภาพ")?;
    // A1111 returns bare base64; some forks prefix a data: URL — strip either way.
    Ok(img.rsplit(',').next().unwrap_or(img).to_string())
}

/// Check whether the G-Maiden repo can be found. Returns its absolute path if
/// so, empty string otherwise — lets the frontend show "integrate" before doing
/// the heavier voice-cache scan.
#[tauri::command]
fn check_gmaiden(gmaiden_dir: Option<String>) -> GMaidenStatus {
    match resolve_gmaiden_dir(&gmaiden_dir) {
        Some(p) => GMaidenStatus {
            found: true,
            path: p.to_string_lossy().into_owned(),
        },
        None => GMaidenStatus {
            found: false,
            path: String::new(),
        },
    }
}

#[derive(Serialize)]
struct OverlayLayoutSyncReport {
    ok: bool,
}

/// Send an already-edited layout to G-Maiden's dedicated bounded receiver.
/// This intentionally does not share the announcer install route: no pack file,
/// asset, or other settings field can cross this seam.
#[tauri::command]
async fn sync_overlay_layout(layout: serde_json::Value) -> Result<OverlayLayoutSyncReport, String> {
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|error| format!("สร้างการเชื่อมต่อ G-Maiden ไม่สำเร็จ: {error}"))?
        .post("http://127.0.0.1:3000/overlay/layout")
        .json(&serde_json::json!({ "schemaVersion": 1, "layout": layout }))
        .send()
        .await
        .map_err(|error| {
            if error.is_timeout() {
                "G-Maiden ไม่ตอบกลับภายใน 5 วินาที — ตรวจสถานะ GSI แล้วลอง Sync ใหม่".to_string()
            } else {
                format!("เชื่อมต่อ G-Maiden ไม่ได้ — เปิด G-Maiden ก่อนแล้วลอง Sync ใหม่ ({error})")
            }
        })?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("อ่านคำตอบจาก G-Maiden ไม่ได้: {error}"))?;
    let payload: serde_json::Value = serde_json::from_str(&body).map_err(|_| {
        let detail = body.chars().take(160).collect::<String>();
        format!("G-Maiden ตอบกลับ HTTP {status} ในรูปแบบที่อ่านไม่ได้: {detail}")
    })?;
    if !status.is_success() || payload["ok"].as_bool() != Some(true) {
        return Err(payload["error"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| format!("G-Maiden ปฏิเสธ layout (HTTP {status})")));
    }
    Ok(OverlayLayoutSyncReport { ok: true })
}

#[derive(Serialize)]
struct VoiceCacheEntry {
    event: String,
    files: Vec<String>,
}

#[derive(Serialize)]
struct VoiceCacheScan {
    voice_cache_path: String,
    entries: Vec<VoiceCacheEntry>,
}

/// Show only event pairs admitted from installed GANN containers.
#[tauri::command]
fn scan_voice_cache(gmaiden_dir: Option<String>) -> Result<VoiceCacheScan, String> {
    let base = resolve_gmaiden_dir(&gmaiden_dir).ok_or("หา G-Maiden ไม่พบ")?;
    let root = voice_cache_root(&base);
    let mut events: std::collections::BTreeMap<String, Vec<String>> = Default::default();
    if let Ok(entries) = std::fs::read_dir(root.join("packs")) {
        for entry in entries.flatten() {
            let id = entry.file_name().to_string_lossy().into_owned();
            if !g_ann_package::valid_id(&id, "ann_") {
                continue;
            }
            let Some(origin) = std::fs::read(entry.path().join("local-gann.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
            else {
                continue;
            };
            let Some(hash) = origin["container_sha256"].as_str() else {
                continue;
            };
            if hash.len() != 64 || !hash.bytes().all(|b| b.is_ascii_hexdigit()) {
                continue;
            }
            let Ok(package) =
                g_ann_package::Package::open(&root.join("containers").join(format!("{hash}.gann")))
            else {
                continue;
            };
            if package.index.announcer_id != id || package.validate_playback().is_err() {
                continue;
            }
            if let Some(mapped) = package.registry["events"].as_object() {
                for (event, pairs) in mapped {
                    if let Some(pairs) = pairs.as_array() {
                        for pair in pairs {
                            if let Some(sound) = pair["sound_id"].as_str() {
                                events
                                    .entry(event.clone())
                                    .or_default()
                                    .push(format!("{id}/audio/{sound}.wav"));
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(VoiceCacheScan {
        voice_cache_path: root.to_string_lossy().into_owned(),
        entries: events
            .into_iter()
            .map(|(event, files)| VoiceCacheEntry { event, files })
            .collect(),
    })
}

// ---- Sound Library (SQLite) & Pack Management ----------------------------

fn app_data_root() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .or_else(|_| std::env::var("APPDATA"))
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join("G-AnnStudio")
}

fn db_path() -> PathBuf {
    app_data_root().join("library.db")
}

fn sounds_dir() -> PathBuf {
    app_data_root().join("sounds")
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let path = db_path();
    std::fs::create_dir_all(path.parent().unwrap()).map_err(|e| format!("mkdir db: {e}"))?;
    let conn = rusqlite::Connection::open(&path).map_err(|e| format!("open db: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS packages (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            game        TEXT NOT NULL DEFAULT '',
            file_type   TEXT NOT NULL DEFAULT 'wav',
            quality     TEXT NOT NULL DEFAULT 'medium',
            clip_count  INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sounds (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            pkg_id      TEXT NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
            idx         INTEGER NOT NULL,
            name_th     TEXT NOT NULL DEFAULT '',
            name_en     TEXT NOT NULL DEFAULT '',
            file_path   TEXT NOT NULL,
            source_path TEXT NOT NULL DEFAULT '',
            duration    REAL NOT NULL DEFAULT 0,
            events      TEXT NOT NULL DEFAULT '[]'
        );
        CREATE TABLE IF NOT EXISTS packs (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            pack_type   TEXT NOT NULL,
            events      TEXT NOT NULL DEFAULT '[]',
            mappings    TEXT NOT NULL DEFAULT '{}',
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );
        -- reverse index: which packs/events use a sound (rebuilt on pack save/
        -- delete). Lets backlink / impact-radar queries be indexed lookups, not
        -- a full scan of packs.mappings on every render.
        CREATE TABLE IF NOT EXISTS sound_usage (
            sound_id  INTEGER NOT NULL,
            pack_id   TEXT NOT NULL,
            event     TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_packages_name ON packages(name);
        CREATE INDEX IF NOT EXISTS idx_usage_sound ON sound_usage(sound_id);
        CREATE INDEX IF NOT EXISTS idx_usage_pack ON sound_usage(pack_id);
        PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| format!("init tables: {e}"))?;
    migrate_sounds(&conn)?;
    Ok(conn)
}

/// Evolve an old `sounds` table (single `name` + `event`) to the new schema
/// (name_th/name_en/source_path/events). Additive + idempotent — runs on every
/// open_db; a fresh DB already has the new columns so it's a no-op.
fn migrate_sounds(conn: &rusqlite::Connection) -> Result<(), String> {
    let cols: std::collections::HashSet<String> = conn
        .prepare("PRAGMA table_info(sounds)")
        .and_then(|mut s| {
            s.query_map([], |r| r.get::<_, String>(1))?
                .collect::<Result<Vec<_>, _>>()
        })
        .map_err(|e| format!("table_info: {e}"))?
        .into_iter()
        .collect();

    if cols.contains("name") && !cols.contains("name_th") {
        conn.execute_batch("ALTER TABLE sounds RENAME COLUMN name TO name_th;")
            .map_err(|e| format!("rename name: {e}"))?;
    }
    for (c, def) in [("name_en", "''"), ("source_path", "''"), ("events", "'[]'")] {
        if !cols.contains(c) {
            conn.execute_batch(&format!(
                "ALTER TABLE sounds ADD COLUMN {c} TEXT NOT NULL DEFAULT {def};"
            ))
            .map_err(|e| format!("add {c}: {e}"))?;
        }
    }
    // one-time: fold the legacy single `event` into the `events` array
    if cols.contains("event") {
        let rows: Vec<(i64, String)> = conn
            .prepare(
                "SELECT id, event FROM sounds WHERE (events IS NULL OR events='' OR events='[]') AND event IS NOT NULL AND event<>''",
            )
            .and_then(|mut s| {
                s.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<Result<Vec<_>, _>>()
            })
            .map_err(|e| format!("read legacy events: {e}"))?;
        for (id, ev) in rows {
            let arr = serde_json::to_string(&vec![ev]).unwrap_or_else(|_| "[]".into());
            let _ = conn.execute(
                "UPDATE sounds SET events=?1 WHERE id=?2",
                rusqlite::params![arr, id],
            );
        }
    }
    Ok(())
}

// ---- Library commands ---------------------------------------------------

#[derive(Serialize)]
struct LibPkg {
    id: String,
    name: String,
    game: String,
    file_type: String,
    quality: String,
    clip_count: i64,
    created_at: String,
}

#[derive(Serialize, Clone)]
struct LibSound {
    id: i64,
    pkg_id: String,
    idx: i64,
    name_th: String,
    name_en: String,
    file_path: String,
    source_path: String,
    duration: f64,
    events: Vec<String>,
}

#[derive(Serialize)]
struct LibraryInfo {
    root: String,
    packages: Vec<LibPkg>,
}

#[tauri::command]
fn init_library() -> Result<LibraryInfo, String> {
    let conn = open_db()?;
    std::fs::create_dir_all(sounds_dir()).map_err(|e| format!("mkdir sounds: {e}"))?;
    let mut stmt = conn
        .prepare("SELECT id, name, game, file_type, quality, clip_count, created_at FROM packages ORDER BY created_at DESC")
        .map_err(|e| format!("query: {e}"))?;
    let packages: Vec<LibPkg> = stmt
        .query_map([], |row| {
            Ok(LibPkg {
                id: row.get(0)?,
                name: row.get(1)?,
                game: row.get(2)?,
                file_type: row.get(3)?,
                quality: row.get(4)?,
                clip_count: row.get(5)?,
                created_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("map: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(LibraryInfo {
        root: sounds_dir().to_string_lossy().into_owned(),
        packages,
    })
}

#[tauri::command]
fn query_sounds(pkg_id: String) -> Result<Vec<LibSound>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, pkg_id, idx, name_th, name_en, file_path, source_path, duration, events FROM sounds WHERE pkg_id = ?1 ORDER BY idx")
        .map_err(|e| format!("query: {e}"))?;
    let sounds: Vec<LibSound> = stmt
        .query_map([&pkg_id], |row| {
            let events_json: String = row.get(8)?;
            Ok(LibSound {
                id: row.get(0)?,
                pkg_id: row.get(1)?,
                idx: row.get(2)?,
                name_th: row.get(3)?,
                name_en: row.get(4)?,
                file_path: row.get(5)?,
                source_path: row.get(6)?,
                duration: row.get(7)?,
                events: serde_json::from_str(&events_json).unwrap_or_default(),
            })
        })
        .map_err(|e| format!("map: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(sounds)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SaveToLibClip {
    name_th: String,
    #[serde(default)]
    name_en: String,
    start: f64,
    end: f64,
    #[serde(default)]
    events: Vec<String>,
    // this clip's own origin (a library sound carries its source_path); empty →
    // fall back to opts.origin (the current import). Keeps per-clip provenance.
    #[serde(default)]
    source: String,
    // for a file-clip (opened pack / dragged library sound): the clip's OWN audio
    // file relative to the sounds dir. When set, save copies that whole file
    // instead of cutting from the shared source wav (start/end/padding ignored).
    #[serde(default)]
    file_path: String,
}

/// ASCII slug for filenames: lowercase, non-[a-z0-9] runs → single '-', trimmed.
fn slug_ascii(s: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in s.to_ascii_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    out.trim_end_matches('-').to_string()
}

#[derive(Deserialize)]
struct SaveToLibOpts {
    pkg_name: String,
    game: String,
    file_type: String,
    quality: String,
    padding: f64,
    // the ORIGINAL imported file (video/audio) — stored as each sound's
    // source_path for traceability; cutting still uses the `source_path` arg (wav).
    #[serde(default)]
    origin: String,
}

#[derive(Serialize)]
struct SaveToLibResult {
    pkg_id: String,
    saved: usize,
}

/// Cut each clip from the source WAV (with padding) and insert into SQLite.
#[tauri::command]
async fn save_clips_to_library(
    source_path: String,
    clips: Vec<SaveToLibClip>,
    opts: SaveToLibOpts,
    total_duration: f64,
) -> Result<SaveToLibResult, String> {
    let pkg_id = format!(
        "pkg_{}_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        &sanitize_filename(&opts.pkg_name)
    );
    let pkg_dir = sounds_dir().join(&pkg_id);
    std::fs::create_dir_all(&pkg_dir).map_err(|e| format!("mkdir pkg: {e}"))?;

    // Insert package row before async work
    {
        let conn = open_db()?;
        let now = chrono_now();
        conn.execute(
            "INSERT INTO packages (id, name, game, file_type, quality, clip_count, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![pkg_id, opts.pkg_name, opts.game, opts.file_type, opts.quality, clips.len() as i64, now],
        ).map_err(|e| format!("insert pkg: {e}"))?;
    }

    let ext = match opts.file_type.as_str() {
        "mp3" => "mp3",
        "ogg" => "ogg",
        _ => "wav",
    };

    let quality_args: Vec<String> = match opts.file_type.as_str() {
        "mp3" => match opts.quality.as_str() {
            "low" => vec!["-ab".into(), "128k".into()],
            "high" => vec!["-ab".into(), "320k".into()],
            _ => vec!["-ab".into(), "192k".into()],
        },
        "ogg" => match opts.quality.as_str() {
            "low" => vec!["-q:a".into(), "3".into()],
            "high" => vec!["-q:a".into(), "8".into()],
            _ => vec!["-q:a".into(), "5".into()],
        },
        _ => match opts.quality.as_str() {
            "low" => vec![
                "-ar".into(),
                "22050".into(),
                "-acodec".into(),
                "pcm_s16le".into(),
            ],
            "high" => vec![
                "-ar".into(),
                "48000".into(),
                "-acodec".into(),
                "pcm_s16le".into(),
            ],
            _ => vec![
                "-ar".into(),
                "44100".into(),
                "-acodec".into(),
                "pcm_s16le".into(),
            ],
        },
    };

    // Cut clips with ffmpeg (async), collect results
    // (idx, name_th, name_en, rel_path, source, dur, events_json)
    let mut cut_results: Vec<(i64, String, String, String, String, f64, String)> = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        // input + trim: a file-clip (opened pack / dragged library sound) copies
        // its OWN wav whole; a segment-clip cuts from the shared source wav.
        let (input, trim, dur): (String, Vec<String>, f64) = if !clip.file_path.is_empty() {
            let canon = sounds_dir()
                .join(&clip.file_path)
                .canonicalize()
                .map_err(|e| format!("หาไฟล์ {}: {e}", clip.file_path))?;
            if !canon.starts_with(sounds_dir()) {
                return Err(format!("ไฟล์อยู่นอกคลัง: {}", clip.file_path));
            }
            (
                canon.to_string_lossy().into_owned(),
                vec![],
                round2(clip.end - clip.start),
            )
        } else {
            let padded_start = (clip.start - opts.padding).max(0.0);
            let padded_end = (clip.end + opts.padding).min(total_duration);
            let d = padded_end - padded_start;
            if d <= 0.0 {
                continue;
            }
            (
                source_path.clone(),
                vec![
                    "-ss".into(),
                    format!("{padded_start:.3}"),
                    "-t".into(),
                    format!("{d:.3}"),
                ],
                round2(d),
            )
        };

        // filename = <idx>_<eng-name>.ext (ASCII); fall back to the first event
        let base = {
            let s = slug_ascii(&clip.name_en);
            if s.is_empty() {
                clip.events
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "clip".into())
            } else {
                s
            }
        };
        let filename = format!("{:03}_{base}.{ext}", i + 1);
        let out_path = pkg_dir.join(&filename);

        let mut args = vec!["-y".to_string(), "-i".to_string(), input];
        args.extend(trim);
        args.extend(quality_args.iter().cloned());
        args.push(out_path.to_str().unwrap().to_string());

        let output = Command::new(ffmpeg_bin()?)
            .creation_flags(CREATE_NO_WINDOW)
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("ffmpeg clip {i}: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffmpeg error clip {}: {stderr}", clip.name_th));
        }

        let rel_path = format!("{pkg_id}/{filename}");
        let events_json = serde_json::to_string(&clip.events).unwrap_or_else(|_| "[]".into());
        // per-clip origin: the clip's own source (library sound) or the import
        let source = if clip.source.is_empty() {
            opts.origin.clone()
        } else {
            clip.source.clone()
        };
        cut_results.push((
            (i + 1) as i64,
            clip.name_th.clone(),
            clip.name_en.clone(),
            rel_path,
            source,
            round2(dur),
            events_json,
        ));
    }

    // Insert sound rows after all async work is done
    {
        let conn = open_db()?;
        for (idx, name_th, name_en, rel_path, source, dur, events_json) in &cut_results {
            conn.execute(
                "INSERT INTO sounds (pkg_id, idx, name_th, name_en, file_path, source_path, duration, events) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                rusqlite::params![pkg_id, idx, name_th, name_en, rel_path, source, dur, events_json],
            ).map_err(|e| format!("insert sound: {e}"))?;
        }
    }

    Ok(SaveToLibResult {
        pkg_id,
        saved: cut_results.len(),
    })
}

#[tauri::command]
fn delete_library_pkg(pkg_id: String) -> Result<(), String> {
    let conn = open_db()?;
    let pkg_dir = sounds_dir().join(&pkg_id);
    if pkg_dir.exists() && pkg_dir.starts_with(sounds_dir()) {
        let _ = std::fs::remove_dir_all(&pkg_dir);
    }
    conn.execute("DELETE FROM sounds WHERE pkg_id = ?1", [&pkg_id])
        .map_err(|e| format!("delete sounds: {e}"))?;
    conn.execute("DELETE FROM packages WHERE id = ?1", [&pkg_id])
        .map_err(|e| format!("delete pkg: {e}"))?;
    Ok(())
}

fn chrono_now() -> String {
    let d = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = d.as_secs();
    format!(
        "{}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        1970 + secs / 31_536_000,
        (secs % 31_536_000) / 2_592_000 + 1,
        (secs % 2_592_000) / 86_400 + 1,
        (secs % 86_400) / 3600,
        (secs % 3600) / 60,
        secs % 60
    )
}

// ---- Pack management (SQLite) -------------------------------------------

#[derive(Serialize, Deserialize, Clone)]
struct SoundMapping {
    sound_path: String,
    sound_name: String,
    volume: f64,
    speed: f64,
}

#[derive(Serialize, Deserialize, Clone)]
struct PackManifest {
    id: String,
    name: String,
    pack_type: String,
    events: Vec<String>,
    mappings: std::collections::HashMap<String, SoundMapping>,
    created_at: String,
    updated_at: String,
}

#[tauri::command]
fn save_pack(manifest: PackManifest) -> Result<String, String> {
    let conn = open_db()?;
    let events_json = serde_json::to_string(&manifest.events).map_err(|e| format!("json: {e}"))?;
    let mappings_json =
        serde_json::to_string(&manifest.mappings).map_err(|e| format!("json: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO packs (id, name, pack_type, events, mappings, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![manifest.id, manifest.name, manifest.pack_type, events_json, mappings_json, manifest.created_at, manifest.updated_at],
    ).map_err(|e| format!("save pack: {e}"))?;
    rebuild_pack_usage(&conn, &manifest.id, &manifest.mappings)?;
    Ok(manifest.id)
}

/// Rebuild the sound_usage reverse-index rows for one pack (called on save):
/// drop its old rows, then map each event's sound (resolved by file_path) to
/// this pack. Cost is paid on write (rare); backlink/radar reads stay O(1).
fn rebuild_pack_usage(
    conn: &rusqlite::Connection,
    pack_id: &str,
    mappings: &std::collections::HashMap<String, SoundMapping>,
) -> Result<(), String> {
    use rusqlite::OptionalExtension;
    conn.execute("DELETE FROM sound_usage WHERE pack_id = ?1", [pack_id])
        .map_err(|e| format!("clear usage: {e}"))?;
    for (event, m) in mappings {
        let sid: Option<i64> = conn
            .query_row(
                "SELECT id FROM sounds WHERE file_path = ?1",
                [&m.sound_path],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| format!("resolve sound: {e}"))?;
        if let Some(id) = sid {
            conn.execute(
                "INSERT INTO sound_usage (sound_id, pack_id, event) VALUES (?1,?2,?3)",
                rusqlite::params![id, pack_id, event],
            )
            .map_err(|e| format!("insert usage: {e}"))?;
        }
    }
    Ok(())
}

/// One pack/event that references a sound (backlink / impact-radar node).
#[derive(Serialize)]
struct SoundUsage {
    pack_id: String,
    pack_name: String,
    event: String,
}

/// Backlink: which packs + events use a given sound. Indexed lookup on
/// sound_usage — never scans packs.mappings.
#[tauri::command]
fn sound_usage(sound_id: i64) -> Result<Vec<SoundUsage>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT u.pack_id, COALESCE(p.name, u.pack_id), u.event
             FROM sound_usage u LEFT JOIN packs p ON p.id = u.pack_id
             WHERE u.sound_id = ?1 ORDER BY p.name, u.event",
        )
        .map_err(|e| format!("query: {e}"))?;
    let rows: Vec<SoundUsage> = stmt
        .query_map([sound_id], |r| {
            Ok(SoundUsage {
                pack_id: r.get(0)?,
                pack_name: r.get(1)?,
                event: r.get(2)?,
            })
        })
        .map_err(|e| format!("map: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

#[tauri::command]
fn load_packs() -> Result<Vec<PackManifest>, String> {
    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT id, name, pack_type, events, mappings, created_at, updated_at FROM packs ORDER BY updated_at DESC")
        .map_err(|e| format!("query: {e}"))?;
    let packs: Vec<PackManifest> = stmt
        .query_map([], |row| {
            let events_str: String = row.get(3)?;
            let mappings_str: String = row.get(4)?;
            Ok(PackManifest {
                id: row.get(0)?,
                name: row.get(1)?,
                pack_type: row.get(2)?,
                events: serde_json::from_str(&events_str).unwrap_or_default(),
                mappings: serde_json::from_str(&mappings_str).unwrap_or_default(),
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| format!("map: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(packs)
}

#[tauri::command]
fn delete_pack(pack_id: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute("DELETE FROM packs WHERE id = ?1", [&pack_id])
        .map_err(|e| format!("delete pack: {e}"))?;
    conn.execute("DELETE FROM sound_usage WHERE pack_id = ?1", [&pack_id])
        .map_err(|e| format!("delete usage: {e}"))?;
    Ok(())
}

// ---- System monitoring --------------------------------------------------

#[derive(Serialize)]
struct SystemStats {
    cpu_percent: f32,
    ram_used_mb: u64,
    ram_total_mb: u64,
    ram_percent: f32,
    gpu_percent: f32,
    vram_used_mb: u64,
    vram_total_mb: u64,
    vram_percent: f32,
}

#[tauri::command]
async fn get_system_stats(state: tauri::State<'_, SysInfoState>) -> Result<SystemStats, String> {
    let (cpu_percent, ram_used_mb, ram_total_mb) = {
        let mut sys = state.0.lock().map_err(|e| format!("lock: {e}"))?;
        sys.refresh_all();
        let cpu = sys.global_cpu_info().cpu_usage();
        let used = sys.used_memory() / 1_048_576;
        let total = sys.total_memory() / 1_048_576;
        (cpu, used, total)
    };
    let ram_percent = if ram_total_mb > 0 {
        (ram_used_mb as f32 / ram_total_mb as f32) * 100.0
    } else {
        0.0
    };

    // GPU via nvidia-smi (best-effort)
    let (gpu_percent, vram_used_mb, vram_total_mb) = read_nvidia_smi().await.unwrap_or((0.0, 0, 0));
    let vram_percent = if vram_total_mb > 0 {
        (vram_used_mb as f32 / vram_total_mb as f32) * 100.0
    } else {
        0.0
    };

    Ok(SystemStats {
        cpu_percent,
        ram_used_mb,
        ram_total_mb,
        ram_percent,
        gpu_percent,
        vram_used_mb,
        vram_total_mb,
        vram_percent,
    })
}

async fn read_nvidia_smi() -> Result<(f32, u64, u64), String> {
    let output = Command::new("nvidia-smi")
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "--query-gpu=utilization.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await
        .map_err(|e| format!("nvidia-smi: {e}"))?;
    if !output.status.success() {
        return Err("nvidia-smi failed".into());
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let parts: Vec<&str> = text.trim().split(',').map(|s| s.trim()).collect();
    if parts.len() < 3 {
        return Err("unexpected nvidia-smi output".into());
    }
    let gpu_pct = parts[0].parse::<f32>().unwrap_or(0.0);
    let vram_used = parts[1].parse::<u64>().unwrap_or(0);
    let vram_total = parts[2].parse::<u64>().unwrap_or(0);
    Ok((gpu_pct, vram_used, vram_total))
}

struct SysInfoState(std::sync::Mutex<sysinfo::System>);

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

fn claude_program(path: &std::ffi::OsStr) -> Result<Command, String> {
    let dirs: Vec<_> = std::env::split_paths(path)
        .filter(|dir| dir.is_absolute())
        .collect();
    for dir in &dirs {
        let npm = dir.join("node_modules/@anthropic-ai/claude-code");
        for exe in [dir.join("claude.exe"), npm.join("bin/claude.exe")] {
            if exe.is_file() {
                return Ok(Command::new(exe));
            }
        }
        let script = npm.join("cli.js");
        if script.is_file() {
            if let Some(node) = dirs
                .iter()
                .map(|d| d.join("node.exe"))
                .find(|p| p.is_file())
            {
                let mut command = Command::new(node);
                command.arg(script);
                return Ok(command);
            }
        }
    }
    Err("Claude CLI not found. Install Claude Code and add its executable or npm global bin directory to PATH.".into())
}

async fn claude_cli(system: String, prompt: String) -> Result<String, String> {
    let command = claude_program(&std::env::var_os("PATH").unwrap_or_default())?;
    run_claude(command, system, prompt).await
}

async fn run_claude(
    mut command: Command,
    system: String,
    prompt: String,
) -> Result<String, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;
    let mut child = command
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-p",
            "--append-system-prompt",
            &system,
            "--output-format",
            "json",
            "--tools",
            "",
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("claude spawn: {e}"))?;
    let mut stdin = child.stdin.take().ok_or("Claude stdin unavailable")?;
    let write = async move {
        stdin.write_all(prompt.as_bytes()).await?;
        stdin.shutdown().await
    };
    let (_, output) = tokio::try_join!(write, child.wait_with_output())
        .map_err(|e| format!("claude I/O: {e}"))?;
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

#[cfg(all(test, windows))]
mod claude_launch_tests {
    use super::*;

    #[tokio::test]
    async fn npm_entry_receives_literal_utf8_stdin_and_system_argument() {
        let temp = tempfile::tempdir().unwrap();
        std::fs::write(temp.path().join("claude.cmd"), "@exit /b 37").unwrap();
        assert!(claude_program(temp.path().as_os_str()).is_err());

        let npm = temp.path().join("node_modules/@anthropic-ai/claude-code");
        std::fs::create_dir_all(&npm).unwrap();
        std::fs::write(
            npm.join("cli.js"),
            r#"
            let text = '';
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', s => { text += s; });
            process.stdin.on('end', () => console.log(JSON.stringify({
                result: JSON.stringify([text, process.argv.slice(2)])
            })));
        "#,
        )
        .unwrap();
        let node_dir = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .find(|dir| dir.join("node.exe").is_file())
            .expect("CI requires Node.js");
        let path = std::env::join_paths([temp.path(), node_dir.as_path()]).unwrap();
        let prompt = "เสียง & | ^ < > %PATH% ! \"ทดสอบ\"\n".repeat(4096);
        let system = "system & echo %PATH% | \"literal\"";
        let raw = run_claude(
            claude_program(&path).unwrap(),
            system.into(),
            prompt.clone(),
        )
        .await
        .unwrap();
        let (input, args): (String, Vec<String>) = serde_json::from_str(&raw).unwrap();
        assert_eq!(input, prompt);
        assert_eq!(
            args,
            [
                "-p",
                "--append-system-prompt",
                system,
                "--output-format",
                "json",
                "--tools",
                ""
            ]
        );
    }
}

#[tauri::command]
fn save_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// One-shot OAuth loopback: listens on 127.0.0.1:3210 for a single
/// GET /auth/callback?... request, replies with a tiny "return to app" page,
/// and returns the raw query string. Armed only when the user clicks sign-in;
/// the PKCE code is useless without the code_verifier held by supabase-js in
/// the webview, so a rogue local request cannot hijack the session. The
/// authorization code is never logged. Listener stops at a 180-second deadline.
#[tauri::command]
async fn gid_oauth_listen() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(|| {
        use std::io::{Read, Write};
        use std::time::{Duration, Instant};
        let listener = std::net::TcpListener::bind("127.0.0.1:3210")
            .map_err(|e| format!("bind 127.0.0.1:3210: {e}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|e| format!("listener mode: {e}"))?;
        let deadline = Instant::now() + Duration::from_secs(180);
        loop {
            match listener.accept() {
                Ok((mut stream, _)) => {
                    let _ = stream.set_nonblocking(false);
                    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
                    let mut buf = [0u8; 4096];
                    let n = stream.read(&mut buf).unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]).to_string();
                    let first = head.lines().next().unwrap_or("");
                    if let Some(path) = first.split_whitespace().nth(1) {
                        if let Some(q) = path.strip_prefix("/auth/callback?") {
                            let body = "<html><body style=\"font-family:sans-serif;background:#0b0d12;color:#dfe7ff;display:grid;place-items:center;height:100vh\"><div>เข้าสู่ระบบสำเร็จ — กลับไปที่ G-AnnStudio ได้เลย</div></body></html>";
                            let _ = stream.write_all(
                                format!(
                                    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                                    body.len(), body
                                )
                                .as_bytes(),
                            );
                            return Ok(q.to_string());
                        }
                    }
                    let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(format!("accept: {e}")),
            }
            if Instant::now() >= deadline {
                return Err("sign-in timed out (no callback within 180s)".to_string());
            }
        }
    })
    .await
    .map_err(|e| format!("listener task: {e}"))?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            gann::gann_startup_path,
            gann::gann_open,
            gann::gann_read,
            gann::gann_save_copy,
            gann::export_gann_artifact,
            gann_authoring::create_gann_package,
            gann_authoring::install_gann_package,
            maiden_client::discover_maiden_profiles,
            maiden_client::launch_maiden_profile,
            prepare_project,
            save_project,
            open_project,
            recover_project,
            open_recovery_candidate,
            activate_project_session,
            inspect_banner_asset_archive,
            import_banner_asset_archive,
            project_startup_path,
            build_jobs::start_build,
            build_jobs::build_status,
            build_jobs::cancel_build,
            build_jobs::export_artifact,
            media_jobs::import_media,
            media_jobs::inspect_media,
            media_jobs::build_event_capabilities,
            extract_audio,
            cut_clip,
            transcribe_audio,
            analyze_video,
            read_audio_bytes,
            detect_gmaiden_installed,
            bake_animated_webp,
            generate_banner_image,
            check_gmaiden,
            sync_overlay_layout,
            scan_voice_cache,
            init_library,
            query_sounds,
            save_clips_to_library,
            sound_usage,
            delete_library_pkg,
            save_pack,
            load_packs,
            delete_pack,
            list_ollama_models,
            llm_complete,
            get_system_stats,
            save_text_file,
            read_text_file,
            gid_oauth_listen,
        ])
        .manage(gann::OpenPackage::default())
        .manage(SysInfoState(std::sync::Mutex::new(
            sysinfo::System::new_all(),
        )))
        .run(tauri::generate_context!())
        .expect("error running G-AnnStudio");
}

/// Explicit headless authoring uses the same package builder/installer as the UI.
pub fn run_gann_job(args: &[String]) -> Option<Result<String, String>> {
    let command = args.get(1)?;
    if !matches!(command.as_str(), "--gann-build" | "--gann-install") {
        return None;
    }
    Some((|| {
        let path = args.get(2).ok_or("Supply job.json")?;
        let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
        if command == "--gann-build" {
            let report =
                gann_authoring::build(serde_json::from_slice(&bytes).map_err(|e| e.to_string())?)?;
            serde_json::to_string(&report).map_err(|e| e.to_string())
        } else {
            let runtime = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
            let report = runtime.block_on(gann_authoring::install(
                serde_json::from_slice(&bytes).map_err(|e| e.to_string())?,
                None,
            ))?;
            serde_json::to_string(&report).map_err(|e| e.to_string())
        }
    })())
}
