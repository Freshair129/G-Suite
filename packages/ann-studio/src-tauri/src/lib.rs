use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::process::Command;

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

/// Resolve the ffmpeg binary. Order: `FFMPEG_PATH` env → a bundled/global
/// `ffmpeg-static` install → bare `ffmpeg` on `PATH`.
fn ffmpeg_bin() -> String {
    resolve_bin("ffmpeg", "FFMPEG_PATH")
}

/// Resolve the ffprobe binary. Order: `FFPROBE_PATH` env → `ffmpeg-static` →
/// `PATH`.
fn ffprobe_bin() -> String {
    resolve_bin("ffprobe", "FFPROBE_PATH")
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

    let duration = probe_duration(wav_path.to_str().unwrap()).await?;

    Ok(AudioInfo {
        path: wav_path.to_string_lossy().into_owned(),
        duration,
        sample_rate: 44100,
    })
}

async fn probe_duration(path: &str) -> Result<f64, String> {
    let output = Command::new(ffprobe_bin())
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ])
        .output()
        .await
        .map_err(|e| format!("ffprobe failed: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .trim()
        .parse::<f64>()
        .map_err(|_| "could not parse duration".into())
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            extract_audio,
            cut_clip,
            export_all,
        ])
        .run(tauri::generate_context!())
        .expect("error running G-AnnStudio");
}
