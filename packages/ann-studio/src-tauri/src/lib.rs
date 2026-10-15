use serde::{Deserialize, Serialize};
use std::fs::{self, File, OpenOptions};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::process::Command as StdCommand;
use tauri::Manager;
use tokio::process::Command;

const EXE: &str = if cfg!(windows) { ".exe" } else { "" };

/// Resolve FFmpeg. Order: explicit path → shared tools root → legacy
/// ffmpeg-static install → PATH.
fn ffmpeg_bin() -> String {
    resolve_bin("ffmpeg", "FFMPEG_PATH")
}

fn resolve_bin(name: &str, env_key: &str) -> String {
    resolve_tool_path(name, env_key)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| name.to_string())
}

fn resolve_tool_path(name: &str, env_key: &str) -> Option<PathBuf> {
    // 1. Explicit override.
    if let Ok(p) = std::env::var(env_key) {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }

    let file = format!("{name}{EXE}");
    if let Some(root) = std::env::var_os("AI_STUDIO_TOOLS_DIR") {
        if let Some(hit) = find_tool_in_root(Path::new(&root), name) {
            return Some(hit);
        }
    }

    // 3. Legacy ffmpeg-static locations used by older G-Suite setups.
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = Path::new(&home);
        for root in [
            home.join("AppData/Local/GoVibeToolchains"),
            home.join("AppData/Roaming/npm/node_modules"),
        ] {
            if let Some(hit) = find_ffmpeg_static(&root, &file) {
                return Some(PathBuf::from(hit));
            }
        }
    }

    find_on_path(&file)
}

/// Probe only the named tool directory and one version-directory level.
fn find_tool_in_root(root: &Path, name: &str) -> Option<PathBuf> {
    let file = format!("{name}{EXE}");
    let tool_root = root.join(name);
    for candidate in [tool_root.join(&file), tool_root.join("bin").join(&file)] {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    for entry in std::fs::read_dir(&tool_root).ok()?.flatten() {
        let version_dir = entry.path();
        for candidate in [version_dir.join(&file), version_dir.join("bin").join(&file)] {
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn find_on_path(file: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|directory| directory.join(file))
        .find(|candidate| candidate.is_file())
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

static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct StagingDir(PathBuf);

impl StagingDir {
    fn create(parent: &Path, label: &str) -> Result<Self, String> {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create staging parent {}: {e}", parent.display()))?;
        for _ in 0..128 {
            let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let candidate = parent.join(format!(
                ".gann-{label}-{}-{sequence}",
                std::process::id()
            ));
            match fs::create_dir(&candidate) {
                Ok(()) => return Ok(Self(candidate)),
                Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                Err(error) => return Err(format!("create staging directory: {error}")),
            }
        }
        Err("could not allocate a unique staging directory".into())
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for StagingDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

/// Copy one staged file into a new destination. `create_new` prevents a race
/// from replacing a file created after an earlier collision check.
fn copy_file_new(source: &Path, destination: &Path) -> io::Result<()> {
    let mut input = File::open(source)?;
    let mut output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)?;
    let result = (|| {
        io::copy(&mut input, &mut output)?;
        output.sync_all()
    })();
    if result.is_err() {
        drop(output);
        let _ = fs::remove_file(destination);
    }
    result.map(|_| ())
}

fn rollback_created_files(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        let _ = fs::remove_file(path);
    }
}

/// Create a directory tree and remember only directories that did not exist
/// before this operation. `remove_dir` is used during rollback so any
/// concurrent or pre-existing contents are never recursively deleted.
fn create_dir_all_tracking(path: &Path, created: &mut Vec<PathBuf>) -> io::Result<()> {
    let mut missing = Vec::new();
    let mut current = Some(path);
    while let Some(directory) = current {
        if directory.exists() {
            break;
        }
        missing.push(directory.to_path_buf());
        current = directory.parent();
    }

    let result = fs::create_dir_all(path);
    for directory in missing.into_iter().rev() {
        if directory.is_dir() && !created.contains(&directory) {
            created.push(directory);
        }
    }
    result
}

fn rollback_created_dirs(paths: &[PathBuf]) {
    for path in paths.iter().rev() {
        // remove_dir succeeds only for an empty directory; it leaves any
        // concurrent content in place.
        let _ = fs::remove_dir(path);
    }
}

fn validate_media_range(source: &Path, start: f64, end: f64) -> Result<(), String> {
    if !source.is_file() {
        return Err(format!("source media does not exist: {}", source.display()));
    }
    if !start.is_finite() || !end.is_finite() || start < 0.0 || end <= start {
        return Err(format!("invalid media range: start={start}, end={end}"));
    }
    Ok(())
}

fn output_parent(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn publish_unique_file(source: &Path, directory: &Path, prefix: &str) -> Result<PathBuf, String> {
    for attempt in 0..256u32 {
        let destination = directory.join(format!(
            "{prefix}-{}-{attempt}.wav",
            std::process::id()
        ));
        match copy_file_new(source, &destination) {
            Ok(()) => return Ok(destination),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("publish {}: {error}", destination.display())),
        }
    }
    Err("could not allocate a unique output filename".into())
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
async fn extract_audio(app: tauri::AppHandle, input_path: String) -> Result<AudioInfo, String> {
    let input = Path::new(&input_path);
    if !input.is_file() {
        return Err(format!("source media does not exist: {}", input.display()));
    }
    let cache = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("resolve app cache directory: {e}"))?
        .join("imports");
    let staging = StagingDir::create(&cache, "import")?;
    let staged_wav = staging.path().join("extracted.wav");

    let output = Command::new(ffmpeg_bin())
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-nostdin",
            "-n",
            "-i", &input_path,
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "44100",
            "-ac", "1",
            staged_wav.to_str().unwrap(),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {stderr}"));
    }

    let duration = wav_duration(staged_wav.to_str().unwrap())?;
    let wav_path = publish_unique_file(&staged_wav, &cache, "imported-audio")?;

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
    let source = Path::new(&source_path);
    let destination = PathBuf::from(&output_path);
    validate_media_range(source, start, end)?;
    let duration = end - start;
    let staging = StagingDir::create(output_parent(&destination), "cut")?;
    let staged_output = staging.path().join(
        destination
            .file_name()
            .unwrap_or_else(|| std::ffi::OsStr::new("cut.wav")),
    );

    let output = Command::new(ffmpeg_bin())
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-nostdin",
            "-n",
            "-i", &source_path,
            "-ss", &format!("{start:.3}"),
            "-t", &format!("{duration:.3}"),
            "-acodec", "pcm_s16le",
            staged_output.to_str().unwrap(),
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg cut failed: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg error: {stderr}"));
    }

    copy_file_new(&staged_output, &destination).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            format!("refusing to replace existing output: {}", destination.display())
        } else {
            format!("publish clip {}: {error}", destination.display())
        }
    })?;
    Ok(destination.to_string_lossy().into_owned())
}

#[tauri::command]
async fn export_all(
    source_path: String,
    clips: Vec<ClipRegion>,
    output_dir: String,
) -> Result<ExportResult, String> {
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("cannot create output dir: {e}"))?;

    let output_root = Path::new(&output_dir);
    let mut filenames = std::collections::HashSet::new();
    let manifest_path = output_root.join("announcer-manifest.json");
    if manifest_path.exists() {
        return Err(format!(
            "refusing to replace existing manifest: {}",
            manifest_path.display()
        ));
    }
    for (i, clip) in clips.iter().enumerate() {
        validate_media_range(Path::new(&source_path), clip.start, clip.end)?;
        let filename = format!("{:02}_{}.wav", i + 1, sanitize_filename(&clip.name));
        if !filenames.insert(filename.clone()) {
            return Err(format!("clip filenames collide after sanitizing: {filename}"));
        }
        let destination = output_root.join(&filename);
        if destination.exists() {
            return Err(format!(
                "refusing to replace existing output: {}",
                destination.display()
            ));
        }
    }

    let staging = StagingDir::create(output_root, "export")?;

    let mut exported: Vec<ExportedClip> = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        let filename = format!(
            "{:02}_{}.wav",
            i + 1,
            sanitize_filename(&clip.name)
        );
        let out_path = staging.path().join(&filename);
        let duration = clip.end - clip.start;

        let output = Command::new(ffmpeg_bin())
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-nostdin",
                "-n",
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
            duration: round2(duration),
        });
    }

    let manifest = serde_json::json!({
        "version": "1.0",
        "pack_name": "announcer-pack",
        "clips": exported,
    });
    let staged_manifest = staging.path().join("announcer-manifest.json");
    std::fs::write(
        &staged_manifest,
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .map_err(|e| format!("failed to write manifest: {e}"))?;

    let mut created = Vec::new();
    for clip in &exported {
        let staged = staging.path().join(&clip.path);
        let destination = output_root.join(&clip.path);
        if let Err(error) = copy_file_new(&staged, &destination) {
            rollback_created_files(&created);
            return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                format!("refusing to replace existing output: {}", destination.display())
            } else {
                format!("publish output {}: {error}", destination.display())
            });
        }
        created.push(destination);
    }
    if let Err(error) = copy_file_new(&staged_manifest, &manifest_path) {
        rollback_created_files(&created);
        return Err(if error.kind() == io::ErrorKind::AlreadyExists {
            format!("refusing to replace existing manifest: {}", manifest_path.display())
        } else {
            format!("publish manifest {}: {error}", manifest_path.display())
        });
    }

    Ok(ExportResult {
        clips: exported,
        manifest_path: manifest_path.to_string_lossy().into_owned(),
    })
}

/// Round seconds to 2 decimals for clean metadata (cutting still uses full
/// precision from clip.start/end — this only tidies the stored/reported number).
fn round2(x: f64) -> f64 {
    (x * 100.0).round() / 100.0
}

fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
        .collect()
}

/// Locate scripts from an explicit override, Tauri bundle resources, the
/// executable-adjacent resource directory, or the development crate.
fn sidecar_dir(app: &tauri::AppHandle) -> PathBuf {
    if let Ok(d) = std::env::var("SIDECAR_DIR") {
        let p = PathBuf::from(d);
        if p.is_dir() {
            return p;
        }
    }
    if let Ok(p) = app
        .path()
        .resolve("sidecar", tauri::path::BaseDirectory::Resource)
    {
        if p.is_dir() {
            return p;
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let p = dir.join("sidecar");
            if p.is_dir() {
                return p;
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar")
}

/// Resolve Python: explicit path → sidecar/app environment → shared tools root → PATH.
fn python_bin(sidecar: &Path, app_local_data: Option<&Path>) -> String {
    if let Ok(p) = std::env::var("PYTHON_PATH") {
        let path = PathBuf::from(p);
        if path.is_file() {
            return path.to_string_lossy().into_owned();
        }
    }
    let venv = if cfg!(windows) {
        sidecar.join(".venv/Scripts/python.exe")
    } else {
        sidecar.join(".venv/bin/python")
    };
    if venv.is_file() {
        return venv.to_string_lossy().into_owned();
    }
    if let Some(root) = app_local_data {
        let app_venv = if cfg!(windows) {
            root.join("sidecar-python/Scripts/python.exe")
        } else {
            root.join("sidecar-python/bin/python")
        };
        if app_venv.is_file() {
            return app_venv.to_string_lossy().into_owned();
        }
    }
    if let Some(root) = std::env::var_os("AI_STUDIO_TOOLS_DIR") {
        if let Some(path) = find_tool_in_root(Path::new(&root), "python") {
            return path.to_string_lossy().into_owned();
        }
    }
    for file in [format!("python{EXE}"), "python3".to_string()] {
        if let Some(path) = find_on_path(&file) {
            return path.to_string_lossy().into_owned();
        }
    }
    "python".to_string()
}

fn load_runtime_tools_dir(app: &tauri::AppHandle) {
    if std::env::var_os("AI_STUDIO_TOOLS_DIR").is_some() {
        return;
    }
    let Ok(app_data) = app.path().app_local_data_dir() else {
        return;
    };
    let Ok(contents) = fs::read_to_string(app_data.join("runtime-tools-dir.txt")) else {
        return;
    };
    let path = contents.trim();
    if !path.is_empty() && Path::new(path).is_dir() {
        std::env::set_var("AI_STUDIO_TOOLS_DIR", path);
    }
}

#[tauri::command]
fn set_runtime_tools_dir(app: tauri::AppHandle, path: Option<String>) -> Result<String, String> {
    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("resolve app data directory: {e}"))?;
    fs::create_dir_all(&app_data).map_err(|e| format!("create app data directory: {e}"))?;
    let config = app_data.join("runtime-tools-dir.txt");
    match path.map(|path| path.trim().to_string()).filter(|path| !path.is_empty()) {
        Some(path) => {
            if !Path::new(&path).is_dir() {
                return Err(format!("tools directory does not exist: {path}"));
            }
            fs::write(&config, &path).map_err(|e| format!("save tools directory: {e}"))?;
            std::env::set_var("AI_STUDIO_TOOLS_DIR", &path);
            Ok(path)
        }
        None => {
            match fs::remove_file(&config) {
                Ok(()) => {}
                Err(error) if error.kind() == io::ErrorKind::NotFound => {}
                Err(error) => return Err(format!("remove tools directory setting: {error}")),
            }
            std::env::remove_var("AI_STUDIO_TOOLS_DIR");
            Ok(String::new())
        }
    }
}

#[derive(Serialize)]
struct RuntimeToolStatus {
    available: bool,
    path: String,
    version: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct RuntimeDiagnostics {
    tools_dir: String,
    ffmpeg: RuntimeToolStatus,
    python: RuntimeToolStatus,
    sidecar_path: String,
    scripts: std::collections::BTreeMap<String, bool>,
    python_modules: std::collections::BTreeMap<String, bool>,
    ready_for_media: bool,
    ready_for_speech: bool,
    ready_for_video_analysis: bool,
}

#[cfg(windows)]
fn hide_console(command: &mut StdCommand) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn hide_console(_command: &mut StdCommand) {}

fn probe_tool_version(path: &str, arguments: &[&str]) -> RuntimeToolStatus {
    let mut command = StdCommand::new(path);
    hide_console(&mut command);
    match command.args(arguments).output() {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            let version = text.lines().next().unwrap_or_default().trim().to_string();
            RuntimeToolStatus {
                available: !version.is_empty(),
                path: path.to_string(),
                version: (!version.is_empty()).then_some(version),
                error: None,
            }
        }
        Ok(output) => RuntimeToolStatus {
            available: false,
            path: path.to_string(),
            version: None,
            error: Some(format!("version command exited with {}", output.status)),
        },
        Err(error) => RuntimeToolStatus {
            available: false,
            path: path.to_string(),
            version: None,
            error: Some(error.to_string()),
        },
    }
}

#[tauri::command]
fn video_prerequisites_present(
    python_modules: &std::collections::BTreeMap<String, bool>,
    scripts: &std::collections::BTreeMap<String, bool>,
) -> bool {
    ["av", "cv2", "rapidocr_onnxruntime"]
        .iter()
        .all(|name| python_modules.get(*name) == Some(&true))
        && ["detect_boundaries.py", "detect_buttons.py"]
            .iter()
            .all(|name| scripts.get(*name) == Some(&true))
}

#[tauri::command]
fn runtime_diagnostics(app: tauri::AppHandle) -> RuntimeDiagnostics {
    let ffmpeg = resolve_tool_path("ffmpeg", "FFMPEG_PATH")
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_else(|| "ffmpeg".to_string());
    let sidecar = sidecar_dir(&app);
    let app_local_data = app.path().app_local_data_dir().ok();
    let python = python_bin(&sidecar, app_local_data.as_deref());
    let ffmpeg_status = probe_tool_version(&ffmpeg, &["-version"]);
    let python_version = probe_tool_version(&python, &["--version"]);
    let scripts: std::collections::BTreeMap<String, bool> = [
        "transcribe.py",
        "detect_boundaries.py",
        "detect_buttons.py",
    ]
    .into_iter()
    .map(|name| (name.to_string(), sidecar.join(name).is_file()))
    .collect();

    let python_modules: std::collections::BTreeMap<String, bool> = if python_version.available {
        let script = "import importlib.util,json; print(json.dumps({m: importlib.util.find_spec(m) is not None for m in ['faster_whisper','av','cv2','rapidocr_onnxruntime']}))";
        let mut command = StdCommand::new(&python);
        hide_console(&mut command);
        command.args(["-c", script]);
        match command.output() {
            Ok(output) if output.status.success() => serde_json::from_slice(&output.stdout)
                .unwrap_or_default(),
            _ => Default::default(),
        }
    } else {
        Default::default()
    };

    let speech_ready = python_version.available
        && python_modules.get("faster_whisper") == Some(&true)
        && scripts.get("transcribe.py") == Some(&true);
    let video_ready = speech_ready && video_prerequisites_present(&python_modules, &scripts);

    RuntimeDiagnostics {
        tools_dir: std::env::var("AI_STUDIO_TOOLS_DIR").unwrap_or_default(),
        ready_for_media: ffmpeg_status.available,
        ready_for_speech: speech_ready,
        ready_for_video_analysis: video_ready,
        ffmpeg: ffmpeg_status,
        python: python_version,
        sidecar_path: sidecar.to_string_lossy().into_owned(),
        scripts,
        python_modules,
    }
}

/// Transcribe a WAV via the faster-whisper sidecar and return its raw JSON
/// (`{language, duration, segments:[{start,end,text,words}]}`). The frontend
/// turns segments into regions.
#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    wav_path: String,
    model: Option<String>,
    lang: Option<String>,
) -> Result<serde_json::Value, String> {
    let sidecar = sidecar_dir(&app);
    let script = sidecar.join("transcribe.py");
    if !script.exists() {
        return Err(format!("sidecar script not found at {}", script.display()));
    }
    let py = python_bin(&sidecar, app.path().app_local_data_dir().ok().as_deref());
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
            "--device",
            "cpu",
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
    app: tauri::AppHandle,
    video_path: String,
    wav_path: String,
    model: Option<String>,
    lang: Option<String>,
) -> Result<Vec<AnalyzedClip>, String> {
    let sidecar = sidecar_dir(&app);
    let py = python_bin(&sidecar, app.path().app_local_data_dir().ok().as_deref());
    let model = model.unwrap_or_else(|| "medium".into());
    let lang = lang.unwrap_or_else(|| "th".into());

    // 1. W1 — vision line boundaries from the video
    let b = spawn_sidecar(&py, sidecar.join("detect_boundaries.py"), vec![video_path.clone()]).await?;
    if !b.status.success() {
        return Err(format!(
            "detect_boundaries failed: {}",
            String::from_utf8_lossy(&b.stderr)
        ));
    }
    let b_json: serde_json::Value = serde_json::from_str(String::from_utf8_lossy(&b.stdout).trim())
        .map_err(|e| format!("detect_boundaries: {e}\n{}", String::from_utf8_lossy(&b.stderr)))?;
    let lines = b_json["lines"].as_array().cloned().unwrap_or_default();
    if lines.is_empty() {
        return Ok(vec![]);
    }
    let windows: Vec<(f64, f64)> = lines
        .iter()
        .map(|l| (l["startMs"].as_f64().unwrap_or(0.0) / 1000.0, l["endMs"].as_f64().unwrap_or(0.0) / 1000.0))
        .collect();

    // 2. whisper — transcript segments from the wav
    let t = spawn_sidecar(
        &py,
        sidecar.join("transcribe.py"),
        vec![
            wav_path,
            "--model".into(),
            model,
            "--lang".into(),
            lang,
            "--device".into(),
            "cpu".into(),
        ],
    )
    .await?;
    if !t.status.success() {
        return Err(format!(
            "transcribe failed: {}",
            String::from_utf8_lossy(&t.stderr)
        ));
    }
    let t_json: serde_json::Value = serde_json::from_str(String::from_utf8_lossy(&t.stdout).trim())
        .map_err(|e| format!("transcribe: {e}\n{}", String::from_utf8_lossy(&t.stderr)))?;
    let segments = t_json["segments"].as_array().cloned().unwrap_or_default();

    // 3. W4 — active button label per window (best-effort; empty on failure)
    let windows_ms: Vec<[f64; 2]> = lines
        .iter()
        .map(|l| [l["startMs"].as_f64().unwrap_or(0.0), l["endMs"].as_f64().unwrap_or(0.0)])
        .collect();
    let labels: Vec<String> = match spawn_sidecar(
        &py,
        sidecar.join("detect_buttons.py"),
        vec![video_path, "--windows".into(), serde_json::to_string(&windows_ms).unwrap()],
    )
    .await
    {
        Ok(o) => serde_json::from_str::<serde_json::Value>(String::from_utf8_lossy(&o.stdout).trim())
            .ok()
            .and_then(|v| v["labels"].as_array().cloned())
            .map(|arr| arr.iter().map(|x| x["label"].as_str().unwrap_or("").to_string()).collect())
            .unwrap_or_default(),
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
            AnalyzedClip { start: s, end: e, text, label: labels.get(i).cloned().unwrap_or_default() }
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
struct InstallClip {
    name: String,
    start: f64,
    end: f64,
    event: String,
    // standalone library-file clip: path relative to the sounds dir. When set,
    // this clip is cut from that file (start/end within it) instead of the shared
    // source wav — lets a pack opened on the canvas mix file-clips + segments.
    #[serde(default)]
    file_path: String,
    // tuning (focused set) — applied as an ffmpeg -af chain on cut. Defaulted so
    // callers that don't tune (install_pack / sendToGMaiden) still deserialize.
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
        parts.push(format!("equalizer=f=1000:width_type=o:width=1:g={:.2}", db(m("eqMid"), 12.0)));
    }
    if m("eqHigh").abs() > 0.5 {
        parts.push(format!("treble=g={:.2}", db(m("eqHigh"), 12.0)));
    }
    if m("presence").abs() > 0.5 {
        parts.push(format!("equalizer=f=4000:width_type=o:width=1.2:g={:.2}", db(m("presence"), 8.0)));
    }
    // dynamics
    let comp = m("compression");
    if comp > 1.0 {
        let ratio = 1.0 + (comp / 100.0) * 7.0; // 1..8
        parts.push(format!("acompressor=threshold=-18dB:ratio={:.2}:attack=20:release=200", ratio));
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
        parts.push(format!("afade=t=out:st={:.3}:d={:.3}", (dur - d).max(0.0), d));
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

#[derive(Serialize)]
struct ActivationReport {
    state: String,
    endpoint: Option<String>,
    http_status: Option<u16>,
    detail: Option<String>,
}

fn activation_unavailable(endpoint: Option<&str>, detail: impl Into<String>) -> ActivationReport {
    ActivationReport {
        state: "unavailable".into(),
        endpoint: endpoint.map(str::to_string),
        http_status: None,
        detail: Some(detail.into()),
    }
}

async fn request_pack_activation(
    endpoint: Option<&str>,
    pack_id: &str,
) -> ActivationReport {
    let Some(endpoint) = endpoint.filter(|endpoint| !endpoint.trim().is_empty()) else {
        return activation_unavailable(None, "No G-Maiden activation endpoint was configured.");
    };
    let result = reqwest::Client::new()
        .post(endpoint)
        .timeout(std::time::Duration::from_secs(8))
        .json(&serde_json::json!({ "packId": pack_id }))
        .send()
        .await;
    let response = match result {
        Ok(response) => response,
        Err(error) => return activation_unavailable(Some(endpoint), error.to_string()),
    };
    let status = response.status();
    let response_text = response.text().await.unwrap_or_default();
    let payload: serde_json::Value = serde_json::from_str(&response_text).unwrap_or_default();
    let confirmed = status.is_success()
        && payload.get("ok").and_then(serde_json::Value::as_bool) == Some(true)
        && payload
            .get("activated")
            .and_then(serde_json::Value::as_bool)
            == Some(true);
    if confirmed {
        ActivationReport {
            state: "accepted".into(),
            endpoint: Some(endpoint.to_string()),
            http_status: Some(status.as_u16()),
            detail: Some("G-Maiden confirmed pack activation.".into()),
        }
    } else {
        let detail = payload
            .get("error")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                (!response_text.trim().is_empty()).then_some(response_text.clone())
            })
            .unwrap_or_else(|| "G-Maiden did not confirm pack activation.".into());
        ActivationReport {
            state: "rejected".into(),
            endpoint: Some(endpoint.to_string()),
            http_status: Some(status.as_u16()),
            detail: Some(detail),
        }
    }
}

#[derive(Serialize)]
struct InstallReport {
    installed: usize,
    skipped: usize,
    voice_cache: String,
    per_event: std::collections::BTreeMap<String, usize>,
    activation: ActivationReport,
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
    Path::new(&target).parent().map(Path::to_path_buf).filter(|p| p.exists())
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

/// Cut every event-mapped clip to WAV into G-Maiden's voice-cache
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
        .ok_or("หา G-Maiden ไม่เจอ — ตั้ง path ใน Settings หรือ env GMAIDEN_DIR")?;
    let vc = voice_cache_root(&base);

    let staging = StagingDir::create(&vc, "flat-install")?;
    let mut per_event: std::collections::BTreeMap<String, usize> = Default::default();
    let mut staged_files: Vec<(PathBuf, PathBuf)> = Vec::new();
    let mut skipped = 0usize;

    for clip in &clips {
        if clip.event.is_empty() || clip.event == "unused" {
            skipped += 1;
            continue;
        }
        validate_media_range(Path::new(&source_path), clip.start, clip.end)?;
        let event_dir = sanitize_filename(&clip.event);
        if event_dir.is_empty() {
            return Err(format!("invalid event name: {}", clip.event));
        }
        let dir = vc.join(&event_dir);
        let n = per_event.entry(clip.event.clone()).or_insert(0);
        *n += 1;
        let fname = format!("{}_{:02}.wav", sanitize_filename(&pack_name), *n);
        let out_path = dir.join(&fname);
        if out_path.exists() {
            return Err(format!(
                "refusing to replace existing voice-cache file: {}",
                out_path.display()
            ));
        }
        let duration = clip.end - clip.start;
        let staged_path = staging.path().join(format!("clip_{:04}.wav", staged_files.len() + 1));

        let output = Command::new(ffmpeg_bin())
            .creation_flags(CREATE_NO_WINDOW)
            .args([
                "-nostdin",
                "-n",
                "-i",
                &source_path,
                "-ss",
                &format!("{:.3}", clip.start),
                "-t",
                &format!("{duration:.3}"),
                "-acodec",
                "pcm_s16le",
                staged_path.to_str().unwrap(),
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
        staged_files.push((staged_path, out_path));
    }

    let mut created_directories = Vec::new();
    for (_, destination) in &staged_files {
        if let Some(parent) = destination.parent() {
            if let Err(error) = create_dir_all_tracking(parent, &mut created_directories) {
                rollback_created_dirs(&created_directories);
                return Err(format!(
                    "create voice-cache directory {}: {error}",
                    parent.display()
                ));
            }
        }
    }

    let mut created = Vec::new();
    for (staged, destination) in &staged_files {
        if let Err(error) = copy_file_new(staged, destination) {
            rollback_created_files(&created);
            rollback_created_dirs(&created_directories);
            return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                format!("refusing to replace existing voice-cache file: {}", destination.display())
            } else {
                format!("write voice-cache file {}: {error}", destination.display())
            });
        }
        created.push(destination.clone());
    }

    // This legacy flat voice-cache path has no manifest for G-Maiden's current
    // pack activation endpoint. Report local output without claiming reload.
    let activation = activation_unavailable(
        endpoint.as_deref(),
        "Flat voice-cache clips were written locally; G-Maiden's activation endpoint accepts manifest packs only.",
    );

    Ok(InstallReport {
        installed: staged_files.len(),
        skipped,
        voice_cache: vc.to_string_lossy().into_owned(),
        per_event,
        activation,
    })
}

// ---- Game Profile / G-Maiden integration ---------------------------------

#[derive(Serialize)]
struct GMaidenStatus {
    found: bool,
    path: String,
}

#[derive(Deserialize)]
struct BannerAsset {
    event: String,
    /// base64 payload (no `data:` prefix)
    b64: String,
    ext: String,
}

#[derive(Serialize)]
struct PackInstallReport {
    pack_id: String,
    pack_dir: String,
    events: usize,
    clips: usize,
    banners: usize,
    activation: ActivationReport,
}

/// Promote a fully built staging pack only after claiming a previously unused
/// destination directory. `manifest.json` is copied last so pack discovery
/// cannot observe a half-written pack.
fn commit_staged_pack(staging: &Path, pack_dir: &Path) -> Result<(), String> {
    if let Some(parent) = pack_dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("create pack parent {}: {e}", parent.display()))?;
    }
    fs::create_dir(pack_dir).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            format!("refusing to replace existing pack: {}", pack_dir.display())
        } else {
            format!("create pack {}: {error}", pack_dir.display())
        }
    })?;

    let result = (|| {
        for child in ["clips", "banners"] {
            let source_dir = staging.join(child);
            let destination_dir = pack_dir.join(child);
            fs::create_dir(&destination_dir)
                .map_err(|e| format!("create pack {child} directory: {e}"))?;
            for entry in fs::read_dir(&source_dir)
                .map_err(|e| format!("read staged {child}: {e}"))?
            {
                let source = entry.map_err(|e| format!("read staged {child} entry: {e}"))?.path();
                let filename = source
                    .file_name()
                    .ok_or_else(|| format!("invalid staged filename: {}", source.display()))?;
                copy_file_new(&source, &destination_dir.join(filename))
                    .map_err(|e| format!("copy staged {child} file: {e}"))?;
            }
        }
        copy_file_new(&staging.join("manifest.json"), &pack_dir.join("manifest.json"))
            .map_err(|e| format!("publish pack manifest: {e}"))
    })();

    if let Err(error) = result {
        let _ = fs::remove_dir_all(pack_dir);
        return Err(error);
    }
    Ok(())
}

/// Build a G-Maiden **manifest-based** pack (clips/ + banners/ + manifest.json in
/// G-Maiden's camelCase schema) under `<gmaiden>/assets/voice-cache/packs/<id>/`.
/// Unlike [`install_pack`] (flat, audio-only), this carries a per-event banner so
/// the in-game overlay shows the pack's own image. Manifest text/thai are left
/// empty on purpose — the tone banner image is already self-labelled, so the
/// overlay renders image-only with no duplicate caption.
#[tauri::command]
async fn install_gmaiden_pack(
    pack_id: String,
    pack_name: String,
    author: String,
    author_gid: Option<String>,
    source_path: String,
    clips: Vec<InstallClip>,
    banners: Vec<BannerAsset>,
    gmaiden_dir: Option<String>,
    endpoint: Option<String>,
) -> Result<PackInstallReport, String> {
    use base64::Engine;
    use serde_json::{json, Map, Value};

    let base = resolve_gmaiden_dir(&gmaiden_dir)
        .ok_or("หา G-Maiden ไม่เจอ — ตั้ง path ใน Settings หรือ env GMAIDEN_DIR")?;
    let id = sanitize_filename(&pack_id);
    if id.is_empty() {
        return Err("pack id is empty after sanitizing".into());
    }
    let packs_root = voice_cache_root(&base).join("packs");
    let pack_dir = packs_root.join(&id);
    if pack_dir.exists() {
        return Err(format!("refusing to replace existing pack: {}", pack_dir.display()));
    }
    let staging = StagingDir::create(&packs_root, "pack")?;
    let clips_dir = staging.path().join("clips");
    let banners_dir = staging.path().join("banners");
    std::fs::create_dir_all(&clips_dir).map_err(|e| format!("mkdir clips: {e}"))?;
    std::fs::create_dir_all(&banners_dir).map_err(|e| format!("mkdir banners: {e}"))?;

    // cut each mapped clip to clips/<event>_NN.wav, build manifest mappings
    let mut mappings: Map<String, Value> = Map::new();
    let mut per_event: std::collections::BTreeMap<String, usize> = Default::default();
    let mut clip_total = 0usize;
    for clip in &clips {
        if clip.event.is_empty() || clip.event == "unused" {
            continue;
        }
        let event_component = sanitize_filename(&clip.event);
        if event_component.is_empty() {
            return Err(format!("invalid event name: {}", clip.event));
        }
        let n = per_event.entry(clip.event.clone()).or_insert(0);
        *n += 1;
        let fname = format!("{}_{:02}.wav", event_component, *n);
        let out_path = clips_dir.join(&fname);
        let dur = clip.end - clip.start;
        // a file-clip is cut from its own library wav (contained under sounds_dir);
        // a segment clip is cut from the shared source wav.
        let input = if clip.file_path.is_empty() {
            source_path.clone()
        } else {
            let canon = sounds_dir()
                .join(&clip.file_path)
                .canonicalize()
                .map_err(|e| format!("หาไฟล์ {}: {e}", clip.file_path))?;
            if !canon.starts_with(sounds_dir()) {
                return Err(format!("ไฟล์อยู่นอกคลัง: {}", clip.file_path));
            }
            canon.to_string_lossy().into_owned()
        };
        validate_media_range(Path::new(&input), clip.start, clip.end)?;
        let mut args: Vec<String> = vec![
            "-nostdin".into(),
            "-n".into(),
            "-i".into(),
            input,
            "-ss".into(),
            format!("{:.3}", clip.start),
            "-t".into(),
            format!("{dur:.3}"),
        ];
        if let Some(af) = clip_audio_filter(clip, dur) {
            args.push("-af".into());
            args.push(af);
        }
        args.push("-acodec".into());
        args.push("pcm_s16le".into());
        args.push(out_path.to_string_lossy().into_owned());
        let output = Command::new(ffmpeg_bin())
            .creation_flags(CREATE_NO_WINDOW)
            .args(&args)
            .output()
            .await
            .map_err(|e| format!("ffmpeg cut failed for {}: {e}", clip.event))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("ffmpeg error for {}: {stderr}", clip.event));
        }
        let entry = mappings.entry(clip.event.clone()).or_insert_with(|| {
            json!({ "text": "", "thai": "", "banner": "", "bannerAsset": "", "clips": [] })
        });
        entry["clips"]
            .as_array_mut()
            .unwrap()
            .push(json!(format!("clips/{fname}")));
        clip_total += 1;
    }

    if mappings.is_empty() {
        return Err("ไม่มี event ที่ map (clip) — map ก่อนส่งออกนะครับ".into());
    }

    // write a banner only for events that actually have clips; set bannerAsset
    let mut banner_total = 0usize;
    let mut cover = String::new();
    for b in &banners {
        if !mappings.contains_key(&b.event) {
            continue;
        }
        let ext = match b.ext.as_str() {
            "png" | "webp" | "webm" | "gif" | "apng" => b.ext.as_str(),
            _ => "png",
        };
        let data = base64::engine::general_purpose::STANDARD
            .decode(b.b64.trim())
            .map_err(|e| format!("banner base64 ({}): {e}", b.event))?;
        let fname = format!("{}.{}", sanitize_filename(&b.event), ext);
        std::fs::write(banners_dir.join(&fname), &data)
            .map_err(|e| format!("write banner {}: {e}", b.event))?;
        let rel = format!("banners/{fname}");
        if let Some(m) = mappings.get_mut(&b.event) {
            m["bannerAsset"] = json!(rel);
        }
        if cover.is_empty() {
            cover = rel.clone();
        }
        banner_total += 1;
    }

    let mut manifest = json!({
        "id": id,
        "name": pack_name,
        "version": "0.1.0",
        "locale": "th",
        "author": author,
        "description": "",
        "coverImage": cover,
        "mappings": Value::Object(mappings.clone()),
    });
    if let Some(gid) = author_gid.as_deref().filter(|g| !g.is_empty()) {
        manifest["authorGid"] = json!(gid);
    }
    std::fs::write(
        staging.path().join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .map_err(|e| format!("write manifest: {e}"))?;
    commit_staged_pack(staging.path(), &pack_dir)?;

    let activation = request_pack_activation(endpoint.as_deref(), &id).await;

    Ok(PackInstallReport {
        pack_id: id,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        events: mappings.len(),
        clips: clip_total,
        banners: banner_total,
        activation,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibPackClip {
    event: String,
    /// path relative to the sounds dir (LibSound.file_path)
    file_path: String,
}

/// Install a G-Maiden manifest pack assembled from LIBRARY sounds (the test-
/// screen pack builder). Unlike [`install_gmaiden_pack`] (which cuts each clip
/// from one source wav), every clip here is an already-cut library wav that is
/// COPIED into the pack. Banners + manifest are identical.
#[tauri::command]
async fn install_library_pack(
    pack_id: String,
    pack_name: String,
    author: String,
    author_gid: Option<String>,
    clips: Vec<LibPackClip>,
    banners: Vec<BannerAsset>,
    gmaiden_dir: Option<String>,
    endpoint: Option<String>,
) -> Result<PackInstallReport, String> {
    use base64::Engine;
    use serde_json::{json, Map, Value};

    let base = resolve_gmaiden_dir(&gmaiden_dir)
        .ok_or("หา G-Maiden ไม่เจอ — ตั้ง path ใน Settings หรือ env GMAIDEN_DIR")?;
    let id = sanitize_filename(&pack_id);
    if id.is_empty() {
        return Err("pack id is empty after sanitizing".into());
    }
    let packs_root = voice_cache_root(&base).join("packs");
    let pack_dir = packs_root.join(&id);
    if pack_dir.exists() {
        return Err(format!("refusing to replace existing pack: {}", pack_dir.display()));
    }
    let staging = StagingDir::create(&packs_root, "library-pack")?;
    let clips_dir = staging.path().join("clips");
    let banners_dir = staging.path().join("banners");
    std::fs::create_dir_all(&clips_dir).map_err(|e| format!("mkdir clips: {e}"))?;
    std::fs::create_dir_all(&banners_dir).map_err(|e| format!("mkdir banners: {e}"))?;

    let snd_root = sounds_dir()
        .canonicalize()
        .map_err(|e| format!("resolve sound library: {e}"))?;
    let mut mappings: Map<String, Value> = Map::new();
    let mut per_event: std::collections::BTreeMap<String, usize> = Default::default();
    let mut clip_total = 0usize;
    for clip in &clips {
        if clip.event.is_empty() || clip.event == "unused" {
            continue;
        }
        // resolve + contain the library source under sounds_dir (defensive)
        let canon = snd_root
            .join(&clip.file_path)
            .canonicalize()
            .map_err(|e| format!("หาไฟล์ {}: {e}", clip.file_path))?;
        if !canon.starts_with(&snd_root) {
            return Err(format!("ไฟล์อยู่นอกคลัง: {}", clip.file_path));
        }
        let event_component = sanitize_filename(&clip.event);
        if event_component.is_empty() {
            return Err(format!("invalid event name: {}", clip.event));
        }
        let n = per_event.entry(clip.event.clone()).or_insert(0);
        *n += 1;
        let fname = format!("{}_{:02}.wav", event_component, *n);
        std::fs::copy(&canon, clips_dir.join(&fname))
            .map_err(|e| format!("copy {}: {e}", clip.file_path))?;
        let entry = mappings.entry(clip.event.clone()).or_insert_with(|| {
            json!({ "text": "", "thai": "", "banner": "", "bannerAsset": "", "clips": [] })
        });
        entry["clips"].as_array_mut().unwrap().push(json!(format!("clips/{fname}")));
        clip_total += 1;
    }

    if mappings.is_empty() {
        return Err("ไม่มี event ที่ map — เพิ่มเสียงก่อนนะครับ".into());
    }

    let mut banner_total = 0usize;
    let mut cover = String::new();
    for b in &banners {
        if !mappings.contains_key(&b.event) {
            continue;
        }
        let ext = match b.ext.as_str() {
            "png" | "webp" | "webm" | "gif" | "apng" => b.ext.as_str(),
            _ => "png",
        };
        let data = base64::engine::general_purpose::STANDARD
            .decode(b.b64.trim())
            .map_err(|e| format!("banner base64 ({}): {e}", b.event))?;
        let fname = format!("{}.{}", sanitize_filename(&b.event), ext);
        std::fs::write(banners_dir.join(&fname), &data)
            .map_err(|e| format!("write banner {}: {e}", b.event))?;
        let rel = format!("banners/{fname}");
        if let Some(m) = mappings.get_mut(&b.event) {
            m["bannerAsset"] = json!(rel);
        }
        if cover.is_empty() {
            cover = rel.clone();
        }
        banner_total += 1;
    }

    let mut manifest = json!({
        "id": id, "name": pack_name, "version": "0.1.0", "locale": "th",
        "author": author, "description": "", "coverImage": cover,
        "mappings": Value::Object(mappings.clone()),
    });
    if let Some(gid) = author_gid.as_deref().filter(|g| !g.is_empty()) {
        manifest["authorGid"] = json!(gid);
    }
    std::fs::write(
        staging.path().join("manifest.json"),
        serde_json::to_string_pretty(&manifest).unwrap(),
    )
    .map_err(|e| format!("write manifest: {e}"))?;

    commit_staged_pack(staging.path(), &pack_dir)?;
    let activation = request_pack_activation(endpoint.as_deref(), &id).await;

    Ok(PackInstallReport {
        pack_id: id,
        pack_dir: pack_dir.to_string_lossy().into_owned(),
        events: mappings.len(),
        clips: clip_total,
        banners: banner_total,
        activation,
    })
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
    let uid = format!("{}_{}", std::process::id(), SEQ.fetch_add(1, Ordering::Relaxed));
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
    let result = Command::new(ffmpeg_bin())
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
        .map_err(|e| format!("เชื่อม SD ไม่ได้ ({e}) — เปิด Stable Diffusion WebUI แบบ --api ที่ {ep} หรือยัง?"))?;

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
    let response = reqwest::Client::new()
        .post("http://127.0.0.1:3000/overlay/layout")
        .json(&serde_json::json!({ "schemaVersion": 1, "layout": layout }))
        .send()
        .await
        .map_err(|_| "เชื่อมต่อ G-Maiden ไม่ได้ — เปิด G-Maiden ก่อนแล้วลอง Sync ใหม่".to_string())?;
    let payload: serde_json::Value = response
        .json()
        .await
        .map_err(|_| "G-Maiden ตอบกลับ layout sync ไม่ถูกต้อง".to_string())?;
    if payload["ok"].as_bool() != Some(true) {
        return Err(payload["error"]
            .as_str()
            .unwrap_or("G-Maiden ปฏิเสธ layout นี้")
            .to_string());
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

/// Walk `G-Maiden/assets/voice-cache/` and return a list of (event → files[])
/// so the frontend can show which events have audio installed.
#[tauri::command]
fn scan_voice_cache(gmaiden_dir: Option<String>) -> Result<VoiceCacheScan, String> {
    let base = resolve_gmaiden_dir(&gmaiden_dir)
        .ok_or("หา G-Maiden ไม่เจอ — ตั้ง path ใน Settings หรือ env GMAIDEN_DIR")?;
    let vc = voice_cache_root(&base);
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
            let _ = conn.execute("UPDATE sounds SET events=?1 WHERE id=?2", rusqlite::params![arr, id]);
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
            "low" => vec!["-ar".into(), "22050".into(), "-acodec".into(), "pcm_s16le".into()],
            "high" => vec!["-ar".into(), "48000".into(), "-acodec".into(), "pcm_s16le".into()],
            _ => vec!["-ar".into(), "44100".into(), "-acodec".into(), "pcm_s16le".into()],
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
            (canon.to_string_lossy().into_owned(), vec![], round2(clip.end - clip.start))
        } else {
            let padded_start = (clip.start - opts.padding).max(0.0);
            let padded_end = (clip.end + opts.padding).min(total_duration);
            let d = padded_end - padded_start;
            if d <= 0.0 {
                continue;
            }
            (
                source_path.clone(),
                vec!["-ss".into(), format!("{padded_start:.3}"), "-t".into(), format!("{d:.3}")],
                round2(d),
            )
        };

        // filename = <idx>_<eng-name>.ext (ASCII); fall back to the first event
        let base = {
            let s = slug_ascii(&clip.name_en);
            if s.is_empty() {
                clip.events.first().cloned().unwrap_or_else(|| "clip".into())
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

        let output = Command::new(ffmpeg_bin())
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
        let source = if clip.source.is_empty() { opts.origin.clone() } else { clip.source.clone() };
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
            .query_row("SELECT id FROM sounds WHERE file_path = ?1", [&m.sound_path], |r| r.get(0))
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
            Ok(SoundUsage { pack_id: r.get(0)?, pack_name: r.get(1)?, event: r.get(2)? })
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

    let snd_root = sounds_dir()
        .canonicalize()
        .map_err(|e| format!("resolve sound library: {e}"))?;
    let output_root = Path::new(&target_dir);
    std::fs::create_dir_all(output_root).map_err(|e| format!("mkdir output: {e}"))?;
    let folder_name = sanitize_filename(&manifest.name);
    if folder_name.is_empty() {
        return Err("pack name is empty after sanitizing".into());
    }
    let out = output_root.join(&folder_name);
    if out.exists() {
        return Err(format!("refusing to replace existing export: {}", out.display()));
    }
    let staging = StagingDir::create(output_root, "pack-export")?;
    let staged_out = staging.path().join(&folder_name);
    std::fs::create_dir(&staged_out).map_err(|e| format!("create staged export: {e}"))?;

    let mut files = Vec::new();
    let mut destinations = std::collections::HashSet::new();

    for (event, mapping) in &manifest.mappings {
        let src = match snd_root.join(&mapping.sound_path).canonicalize() {
            Ok(path) if path.starts_with(&snd_root) && path.is_file() => path,
            Ok(_) => return Err(format!("sound path escapes library: {}", mapping.sound_path)),
            Err(_) => continue,
        };
        let event_dir_name = sanitize_filename(event);
        if event_dir_name.is_empty() {
            return Err(format!("event name is empty after sanitizing: {event}"));
        }
        let fname = src
            .file_name()
            .ok_or_else(|| format!("invalid sound filename: {}", src.display()))?
            .to_string_lossy()
            .into_owned();
        let relative = PathBuf::from(&event_dir_name).join(&fname);
        if !destinations.insert(relative.clone()) {
            return Err(format!("export paths collide after sanitizing: {}", relative.display()));
        }
        let staged_event_dir = staged_out.join(&event_dir_name);
        std::fs::create_dir_all(&staged_event_dir)
            .map_err(|e| format!("create staged event directory {event}: {e}"))?;
        let staged_dest = staged_out.join(&relative);

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
                    "-nostdin",
                    "-n",
                    "-i",
                    src.to_str().unwrap(),
                    "-af",
                    &filter_str,
                    "-acodec",
                    "pcm_s16le",
                    staged_dest.to_str().unwrap(),
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
            copy_file_new(&src, &staged_dest)
                .map_err(|e| format!("copy {fname}: {e}"))?;
        }
        files.push(relative.to_string_lossy().replace('\\', "/"));
    }

    let out_manifest = serde_json::json!({
        "version": "1.0",
        "pack_name": manifest.name,
        "pack_type": manifest.pack_type,
        "events": manifest.events,
        "mappings": manifest.mappings,
    });
    let staged_manifest = staged_out.join("manifest.json");
    std::fs::write(
        &staged_manifest,
        serde_json::to_string_pretty(&out_manifest).unwrap(),
    )
    .map_err(|e| format!("write staged manifest: {e}"))?;

    std::fs::create_dir(&out).map_err(|error| {
        if error.kind() == io::ErrorKind::AlreadyExists {
            format!("refusing to replace existing export: {}", out.display())
        } else {
            format!("create export {}: {error}", out.display())
        }
    })?;
    let mut created_files = Vec::new();
    let mut created_dirs = Vec::new();
    let publication = (|| -> Result<(), String> {
        for relative in &files {
            let relative = Path::new(relative);
            let file_name = relative
                .file_name()
                .ok_or_else(|| format!("invalid staged path: {}", relative.display()))?;
            let event_dir = relative
                .parent()
                .ok_or_else(|| format!("invalid staged path: {}", relative.display()))?;
            let destination_dir = out.join(event_dir);
            if !destination_dir.exists() {
                std::fs::create_dir(&destination_dir)
                    .map_err(|e| format!("create export event directory: {e}"))?;
                created_dirs.push(destination_dir.clone());
            }
            let destination = destination_dir.join(file_name);
            copy_file_new(&staged_out.join(relative), &destination)
                .map_err(|e| format!("publish export {}: {e}", destination.display()))?;
            created_files.push(destination);
        }
        let manifest_path = out.join("manifest.json");
        copy_file_new(&staged_manifest, &manifest_path)
            .map_err(|e| format!("publish export manifest: {e}"))?;
        created_files.push(manifest_path);
        Ok(())
    })();
    if let Err(error) = publication {
        rollback_created_files(&created_files);
        for directory in created_dirs.iter().rev() {
            let _ = std::fs::remove_dir(directory);
        }
        let _ = std::fs::remove_dir(&out);
        return Err(error);
    }

    let total = files.len();
    Ok(ExportPackResult {
        output_dir: out.to_string_lossy().into_owned(),
        files,
        total,
    })
}

// ---- Quick install library → G-Maiden voice-cache ----------------------

#[derive(Serialize)]
struct QuickInstallResult {
    installed: usize,
    voice_cache: String,
    per_event: std::collections::BTreeMap<String, usize>,
    activation: ActivationReport,
}

#[tauri::command]
fn install_lib_to_gmaiden(
    pkg_id: String,
    mappings: std::collections::HashMap<String, String>,
    gmaiden_dir: Option<String>,
) -> Result<QuickInstallResult, String> {
    let base = resolve_gmaiden_dir(&gmaiden_dir)
        .ok_or("หา G-Maiden ไม่เจอ — ตั้ง env GMAIDEN_DIR หรือวาง repo ข้าง G-Suite")?;
    let vc = voice_cache_root(&base);
    let snd_root = sounds_dir()
        .canonicalize()
        .map_err(|e| format!("resolve sound library: {e}"))?;

    let conn = open_db()?;
    let mut stmt = conn
        .prepare("SELECT idx, file_path, name FROM sounds WHERE pkg_id = ?1 ORDER BY idx")
        .map_err(|e| format!("query: {e}"))?;
    let sounds: Vec<(i64, String, String)> = stmt
        .query_map([&pkg_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| format!("map: {e}"))?
        .filter_map(|r| r.ok())
        .collect();

    let mut per_event: std::collections::BTreeMap<String, usize> = Default::default();
    let mut installed = 0usize;
    let mut created = Vec::new();

    for (idx, file_path, _name) in &sounds {
        let key = format!("{:03}", idx);
        let event = match mappings.get(&key) {
            Some(ev) if !ev.is_empty() && ev != "unused" => ev.clone(),
            _ => continue,
        };
        let event_component = sanitize_filename(&event);
        if event_component.is_empty() {
            rollback_created_files(&created);
            return Err(format!("invalid event name: {event}"));
        }
        let src = match snd_root.join(file_path).canonicalize() {
            Ok(path) if path.starts_with(&snd_root) && path.is_file() => path,
            Ok(_) => {
                rollback_created_files(&created);
                return Err(format!("sound path escapes library: {file_path}"));
            }
            Err(_) => continue,
        };
        let dir = vc.join(&event_component);
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;
        let n = per_event.entry(event.clone()).or_insert(0);
        *n += 1;
        let fname = format!("kom_{:02}.wav", *n);
        let dest = dir.join(&fname);
        if let Err(error) = copy_file_new(&src, &dest) {
            rollback_created_files(&created);
            return Err(if error.kind() == io::ErrorKind::AlreadyExists {
                format!("refusing to replace existing voice-cache file: {}", dest.display())
            } else {
                format!("copy {}: {error}", dest.display())
            });
        }
        created.push(dest);
        installed += 1;
    }

    let activation = activation_unavailable(
        None,
        "Legacy flat voice-cache files were written; no manifest-pack activation was requested.",
    );
    Ok(QuickInstallResult {
        installed,
        voice_cache: vc.to_string_lossy().into_owned(),
        per_event,
        activation,
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
        .setup(|app| {
            load_runtime_tools_dir(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            extract_audio,
            cut_clip,
            export_all,
            runtime_diagnostics,
            set_runtime_tools_dir,
            transcribe_audio,
            analyze_video,
            read_audio_bytes,
            install_pack,
            install_gmaiden_pack,
            install_library_pack,
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
            export_pack,
            list_ollama_models,
            llm_complete,
            get_system_stats,
            install_lib_to_gmaiden,
            save_text_file,
            read_text_file,
            gid_oauth_listen,
        ])
        .manage(SysInfoState(std::sync::Mutex::new(sysinfo::System::new_all())))
        .run(tauri::generate_context!())
        .expect("error running G-AnnStudio");
}

#[cfg(test)]
mod runtime_safety_tests {
    use super::*;

    #[test]
    fn video_prerequisites_require_opencv_script_dependency() {
        let mut modules = std::collections::BTreeMap::from([
            ("av".to_string(), true),
            ("rapidocr_onnxruntime".to_string(), true),
        ]);
        let scripts = std::collections::BTreeMap::from([
            ("detect_boundaries.py".to_string(), true),
            ("detect_buttons.py".to_string(), true),
        ]);
        assert!(!video_prerequisites_present(&modules, &scripts));
        modules.insert("cv2".to_string(), true);
        assert!(video_prerequisites_present(&modules, &scripts));
    }
    use std::io::{Read, Write};
    use std::net::TcpListener;

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new(label: &str) -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "gann-test-{label}-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn fixture_endpoint(status: u16, body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request);
                let reason = if (200..300).contains(&status) { "OK" } else { "Service Unavailable" };
                let response = format!(
                    "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}/announcer/install")
    }

    fn request_fixture(endpoint: &str) -> ActivationReport {
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(request_pack_activation(Some(endpoint), "pack_fixture"))
    }

    #[test]
    fn tools_root_finds_versioned_ffmpeg_and_python_binaries() {
        let root = TestDirectory::new("tools");
        let ffmpeg = root.0.join("ffmpeg/ffmpeg-fixture/bin/ffmpeg.exe");
        let python = root.0.join("python/cpython-fixture/python.exe");
        std::fs::create_dir_all(ffmpeg.parent().unwrap()).unwrap();
        std::fs::create_dir_all(python.parent().unwrap()).unwrap();
        std::fs::write(&ffmpeg, b"fixture").unwrap();
        std::fs::write(&python, b"fixture").unwrap();

        assert_eq!(find_tool_in_root(&root.0, "ffmpeg"), Some(ffmpeg));
        assert_eq!(find_tool_in_root(&root.0, "python"), Some(python));
    }

    #[test]
    fn new_file_publication_preserves_existing_destination_bytes() {
        let root = TestDirectory::new("collision");
        let source = root.0.join("source.wav");
        let destination = root.0.join("existing.wav");
        std::fs::write(&source, b"new bytes").unwrap();
        std::fs::write(&destination, b"existing bytes").unwrap();

        let error = copy_file_new(&source, &destination).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(std::fs::read(destination).unwrap(), b"existing bytes");
    }

    #[test]
    fn directory_rollback_removes_only_empty_directories_created_by_operation() {
        let root = TestDirectory::new("directory-rollback");
        let existing = root.0.join("existing");
        let created_parent = existing.join("new");
        let created_child = created_parent.join("nested");
        std::fs::create_dir(&existing).unwrap();

        let mut created = Vec::new();
        create_dir_all_tracking(&created_child, &mut created).unwrap();
        rollback_created_dirs(&created);

        assert!(existing.is_dir());
        assert!(!created_parent.exists());
        assert!(!created_child.exists());
    }

    #[test]
    fn gmaiden_activation_requires_http_success_and_positive_acknowledgment() {
        let accepted = fixture_endpoint(200, r#"{"ok":true,"packId":"pack_fixture","activated":true}"#);
        assert_eq!(request_fixture(&accepted).state, "accepted");

        let app_error = fixture_endpoint(200, r#"{"ok":false,"error":"pack not found"}"#);
        assert_eq!(request_fixture(&app_error).state, "rejected");

        let not_activated = fixture_endpoint(200, r#"{"ok":true,"activated":false}"#);
        assert_eq!(request_fixture(&not_activated).state, "rejected");

        let http_error = fixture_endpoint(503, r#"{"ok":false,"error":"offline"}"#);
        assert_eq!(request_fixture(&http_error).state, "rejected");
    }

    #[test]
    fn missing_gmaiden_endpoint_is_reported_as_unavailable() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let report = request_fixture(&format!("http://{address}/announcer/install"));
        assert_eq!(report.state, "unavailable");
    }
}
