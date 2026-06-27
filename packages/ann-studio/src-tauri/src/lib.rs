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

// ---- Game Profile / G-Maiden integration ---------------------------------

#[derive(Serialize)]
struct GMaidenStatus {
    found: bool,
    path: String,
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
struct VoiceCacheEntry {
    event: String,
    files: Vec<String>,
}

#[derive(Serialize)]
struct VoiceCacheScan {
    voice_cache_path: String,
    entries: Vec<VoiceCacheEntry>,
}

/// Walk `G-Maiden/assets/voice-cache/` and return a list of (event → files[])
/// so the frontend can show which events have audio installed.
#[tauri::command]
fn scan_voice_cache(gmaiden_dir: Option<String>) -> Result<VoiceCacheScan, String> {
    let base = resolve_gmaiden_dir(&gmaiden_dir)
        .ok_or("หา G-Maiden ไม่เจอ — ตั้ง env GMAIDEN_DIR หรือระบุ path")?;
    let vc = base.join("assets/voice-cache");
    if !vc.exists() {
        return Ok(VoiceCacheScan {
            voice_cache_path: vc.to_string_lossy().into_owned(),
            entries: vec![],
        });
    }

    let mut entries = Vec::new();
    let mut dirs: Vec<_> = std::fs::read_dir(&vc)
        .map_err(|e| format!("read voice-cache: {e}"))?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .collect();
    dirs.sort_by_key(|d| d.file_name());

    for dir in dirs {
        let event = dir.file_name().to_string_lossy().into_owned();
        let mut files: Vec<String> = std::fs::read_dir(dir.path())
            .map_err(|e| format!("read {event}: {e}"))?
            .flatten()
            .filter(|f| {
                f.path()
                    .extension()
                    .map(|ext| ext == "wav" || ext == "mp3" || ext == "ogg")
                    .unwrap_or(false)
            })
            .map(|f| f.file_name().to_string_lossy().into_owned())
            .collect();
        files.sort();
        entries.push(VoiceCacheEntry { event, files });
    }

    Ok(VoiceCacheScan {
        voice_cache_path: vc.to_string_lossy().into_owned(),
        entries,
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
    std::fs::create_dir_all(path.parent().unwrap())
        .map_err(|e| format!("mkdir db: {e}"))?;
    let conn =
        rusqlite::Connection::open(&path).map_err(|e| format!("open db: {e}"))?;
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
            name        TEXT NOT NULL,
            file_path   TEXT NOT NULL,
            duration    REAL NOT NULL DEFAULT 0,
            event       TEXT NOT NULL DEFAULT 'unused'
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
        PRAGMA foreign_keys = ON;",
    )
    .map_err(|e| format!("init tables: {e}"))?;
    Ok(conn)
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
    name: String,
    file_path: String,
    duration: f64,
    event: String,
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
        .prepare("SELECT id, pkg_id, idx, name, file_path, duration, event FROM sounds WHERE pkg_id = ?1 ORDER BY idx")
        .map_err(|e| format!("query: {e}"))?;
    let sounds: Vec<LibSound> = stmt
        .query_map([&pkg_id], |row| {
            Ok(LibSound {
                id: row.get(0)?,
                pkg_id: row.get(1)?,
                idx: row.get(2)?,
                name: row.get(3)?,
                file_path: row.get(4)?,
                duration: row.get(5)?,
                event: row.get(6)?,
            })
        })
        .map_err(|e| format!("map: {e}"))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(sounds)
}

#[derive(Deserialize)]
struct SaveToLibClip {
    name: String,
    start: f64,
    end: f64,
    event: String,
}

#[derive(Deserialize)]
struct SaveToLibOpts {
    pkg_name: String,
    game: String,
    file_type: String,
    quality: String,
    padding: f64,
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
            "low" => vec!["-ar".into(), "22050".into(), "-acodec".into(), "pcm_s16le".into()],
            "high" => vec!["-ar".into(), "48000".into(), "-acodec".into(), "pcm_s16le".into()],
            _ => vec!["-ar".into(), "44100".into(), "-acodec".into(), "pcm_s16le".into()],
        },
    };

    // Cut clips with ffmpeg (async), collect results
    let mut cut_results: Vec<(i64, String, String, f64, String)> = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        let padded_start = (clip.start - opts.padding).max(0.0);
        let padded_end = (clip.end + opts.padding).min(total_duration);
        let dur = padded_end - padded_start;
        if dur <= 0.0 {
            continue;
        }

        let filename = format!("{:03}_{}.{ext}", i + 1, sanitize_filename(&clip.name));
        let out_path = pkg_dir.join(&filename);

        let mut args = vec![
            "-y".to_string(),
            "-i".to_string(),
            source_path.clone(),
            "-ss".to_string(),
            format!("{padded_start:.3}"),
            "-t".to_string(),
            format!("{dur:.3}"),
        ];
        args.extend(quality_args.iter().cloned());
        args.push(out_path.to_str().unwrap().to_string());

        let output = Command::new(ffmpeg_bin())
            .creation_flags(CREATE_NO_WINDOW)
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("ffmpeg clip {i}: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffmpeg error clip {}: {stderr}", clip.name));
        }

        let rel_path = format!("{pkg_id}/{filename}");
        cut_results.push(((i + 1) as i64, clip.name.clone(), rel_path, dur, clip.event.clone()));
    }

    // Insert sound rows after all async work is done
    {
        let conn = open_db()?;
        for (idx, name, rel_path, dur, event) in &cut_results {
            conn.execute(
                "INSERT INTO sounds (pkg_id, idx, name, file_path, duration, event) VALUES (?1,?2,?3,?4,?5,?6)",
                rusqlite::params![pkg_id, idx, name, rel_path, dur, event],
            ).map_err(|e| format!("insert sound: {e}"))?;
        }
    }

    Ok(SaveToLibResult { pkg_id, saved: cut_results.len() })
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
    let events_json =
        serde_json::to_string(&manifest.events).map_err(|e| format!("json: {e}"))?;
    let mappings_json =
        serde_json::to_string(&manifest.mappings).map_err(|e| format!("json: {e}"))?;
    conn.execute(
        "INSERT OR REPLACE INTO packs (id, name, pack_type, events, mappings, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        rusqlite::params![manifest.id, manifest.name, manifest.pack_type, events_json, mappings_json, manifest.created_at, manifest.updated_at],
    ).map_err(|e| format!("save pack: {e}"))?;
    Ok(manifest.id)
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
    Ok(())
}

#[derive(Serialize)]
struct ExportPackResult {
    output_dir: String,
    files: Vec<String>,
    total: usize,
}

#[tauri::command]
async fn export_pack(
    pack_id: String,
    target_dir: String,
) -> Result<ExportPackResult, String> {
    let manifest = {
        let conn = open_db()?;
        let mut stmt = conn
            .prepare("SELECT name, pack_type, events, mappings FROM packs WHERE id = ?1")
            .map_err(|e| format!("query: {e}"))?;
        stmt.query_row([&pack_id], |row| {
            let events_str: String = row.get(2)?;
            let mappings_str: String = row.get(3)?;
            Ok(PackManifest {
                id: pack_id.clone(),
                name: row.get(0)?,
                pack_type: row.get(1)?,
                events: serde_json::from_str(&events_str).unwrap_or_default(),
                mappings: serde_json::from_str(&mappings_str).unwrap_or_default(),
                created_at: String::new(),
                updated_at: String::new(),
            })
        })
        .map_err(|e| format!("pack not found: {e}"))?
    };

    let snd_root = sounds_dir();
    let out = Path::new(&target_dir).join(&manifest.name);
    std::fs::create_dir_all(&out).map_err(|e| format!("mkdir output: {e}"))?;

    let mut files = Vec::new();

    for (event, mapping) in &manifest.mappings {
        let src = snd_root.join(&mapping.sound_path);
        if !src.exists() {
            continue;
        }
        let event_dir = out.join(event);
        std::fs::create_dir_all(&event_dir)
            .map_err(|e| format!("mkdir {event}: {e}"))?;

        let fname = src
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let dest = event_dir.join(&fname);

        let needs_filter =
            (mapping.volume - 1.0).abs() > 0.01 || (mapping.speed - 1.0).abs() > 0.01;

        if needs_filter {
            let mut af = Vec::new();
            if (mapping.volume - 1.0).abs() > 0.01 {
                af.push(format!("volume={:.2}", mapping.volume));
            }
            if (mapping.speed - 1.0).abs() > 0.01 {
                af.push(format!("atempo={:.2}", mapping.speed.clamp(0.5, 2.0)));
            }
            let filter_str = af.join(",");
            let output = Command::new(ffmpeg_bin())
                .creation_flags(CREATE_NO_WINDOW)
                .args([
                    "-y",
                    "-i",
                    src.to_str().unwrap(),
                    "-af",
                    &filter_str,
                    "-acodec",
                    "pcm_s16le",
                    dest.to_str().unwrap(),
                ])
                .output()
                .await
                .map_err(|e| format!("ffmpeg: {e}"))?;
            if !output.status.success() {
                return Err(format!(
                    "ffmpeg error {event}/{fname}: {}",
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        } else {
            std::fs::copy(&src, &dest).map_err(|e| format!("copy {fname}: {e}"))?;
        }
        files.push(format!("{event}/{fname}"));
    }

    let out_manifest = serde_json::json!({
        "version": "1.0",
        "pack_name": manifest.name,
        "pack_type": manifest.pack_type,
        "events": manifest.events,
        "mappings": manifest.mappings,
    });
    std::fs::write(
        out.join("manifest.json"),
        serde_json::to_string_pretty(&out_manifest).unwrap(),
    )
    .map_err(|e| format!("write manifest: {e}"))?;

    let total = files.len();
    Ok(ExportPackResult {
        output_dir: out.to_string_lossy().into_owned(),
        files,
        total,
    })
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
    let (gpu_percent, vram_used_mb, vram_total_mb) = match read_nvidia_smi().await {
        Ok(g) => g,
        Err(_) => (0.0, 0, 0),
    };
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
            check_gmaiden,
            scan_voice_cache,
            init_library,
            query_sounds,
            save_clips_to_library,
            delete_library_pkg,
            save_pack,
            load_packs,
            delete_pack,
            export_pack,
            list_ollama_models,
            llm_complete,
            get_system_stats,
        ])
        .manage(SysInfoState(std::sync::Mutex::new(sysinfo::System::new_all())))
        .run(tauri::generate_context!())
        .expect("error running G-AnnStudio");
}
