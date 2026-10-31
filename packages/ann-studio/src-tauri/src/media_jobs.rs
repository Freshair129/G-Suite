use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

/// Production always uses the pinned packaged executable. Overrides are test/debug only.
pub fn tool_path() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if let Some(value) = std::env::var_os("FFMPEG_PATH") {
        let path = PathBuf::from(value);
        if path.is_file() {
            return pinned_tool(path);
        }
    }
    #[cfg(test)]
    {
        let path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/media-tools/ffmpeg.exe");
        if path.is_file() {
            return pinned_tool(path);
        }
    }
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    for path in [
        exe.parent()
            .unwrap_or(Path::new("."))
            .join("resources/media-tools/ffmpeg.exe"),
        exe.parent()
            .unwrap_or(Path::new("."))
            .join("media-tools/ffmpeg.exe"),
    ] {
        if path.is_file() {
            return pinned_tool(path);
        }
    }
    Err("MissingBundledTool: reinstall G-AnnStudio to restore the bundled media encoder".into())
}
fn pinned_tool(path: PathBuf) -> Result<PathBuf, String> {
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../resources/media-tools-manifest.json"))
            .map_err(|e| e.to_string())?;
    if g_ann_package::file_digest(&path)?
        != manifest["binarySha256"]
            .as_str()
            .ok_or("Invalid bundled tool manifest")?
    {
        return Err("BundledToolHashMismatch: reinstall G-AnnStudio media tools".into());
    }
    Ok(path)
}
pub fn toolchain_fingerprint() -> Result<String, String> {
    Ok(format!(
        "gann-studio-render-v2:{}",
        g_ann_package::file_digest(&tool_path()?)?
    ))
}

fn run_capture(
    args: &[String],
    cancel: &Arc<AtomicBool>,
    verbose: bool,
) -> Result<(bool, String), String> {
    if cancel.load(Ordering::Acquire) {
        return Err("Cancelled".into());
    }
    let nonce = format!("gann-media-{}-{:?}.log", std::process::id(), Instant::now());
    let log = std::env::temp_dir().join(nonce.replace(':', "_"));
    let stderr = fs::File::create(&log).map_err(|e| e.to_string())?;
    let mut command = Command::new(tool_path()?);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(super::CREATE_NO_WINDOW);
    }
    let mut child = command
        .args([
            "-nostdin",
            "-hide_banner",
            "-v",
            if verbose { "info" } else { "error" },
            "-threads",
            "2",
            "-filter_threads",
            "2",
            "-filter_complex_threads",
            "2",
        ])
        .args(args.iter().flat_map(|arg| {
            if arg == "-i" {
                vec![
                    "-protocol_whitelist".to_owned(),
                    "file,pipe".to_owned(),
                    "-format_whitelist".to_owned(),
                    "wav,mp3,flac,ogg,image2,png_pipe,jpeg_pipe,webp_pipe,matroska,webm,mov,lavfi"
                        .to_owned(),
                    arg.clone(),
                ]
            } else {
                vec![arg.clone()]
            }
        }))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr)
        .spawn()
        .map_err(|e| e.to_string())?;
    let started = Instant::now();
    let result = loop {
        if cancel.load(Ordering::Acquire)
            || started.elapsed() > Duration::from_secs(180)
            || fs::metadata(&log).is_ok_and(|m| m.len() > 1024 * 1024)
        {
            let _ = child.kill();
            let _ = child.wait();
            break Err(if cancel.load(Ordering::Acquire) {
                "Cancelled".into()
            } else {
                "MediaTimeout: encoder exceeded bounded time/output".into()
            });
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                break Ok((
                    status.success(),
                    fs::read_to_string(&log).unwrap_or_default(),
                ))
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                break Err(e.to_string());
            }
        }
    };
    let _ = fs::remove_file(log);
    result
}
pub fn run_ffmpeg(args: &[String], cancel: &Arc<AtomicBool>) -> Result<(), String> {
    let (success, detail) = run_capture(args, cancel, false)?;
    if success {
        Ok(())
    } else {
        Err(format!(
            "MediaEncode: {}",
            detail.chars().take(4096).collect::<String>()
        ))
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct MediaInfo {
    pub duration_ms: u64,
    pub codec: String,
    pub channels: Option<u32>,
    pub sample_rate: Option<u32>,
    pub has_audio: bool,
    pub width: Option<u32>,
    pub height: Option<u32>,
}
pub fn parse_probe(text: &str) -> Result<MediaInfo, String> {
    let text = text.split("Output #").next().unwrap_or(text);
    let mut info = MediaInfo {
        duration_ms: 0,
        codec: String::new(),
        channels: None,
        sample_rate: None,
        has_audio: false,
        width: None,
        height: None,
    };
    if let Some(duration) = text
        .split("Duration: ")
        .nth(1)
        .and_then(|v| v.split(',').next())
    {
        let n: Vec<_> = duration
            .split(':')
            .filter_map(|v| v.parse::<f64>().ok())
            .collect();
        if n.len() == 3 {
            info.duration_ms = ((n[0] * 3600. + n[1] * 60. + n[2]) * 1000.).round() as u64;
        }
    }
    for line in text.lines().filter(|line| line.contains("Stream #")) {
        if let Some(audio) = line.split("Audio: ").nth(1) {
            let codec = audio
                .split(',')
                .next()
                .unwrap_or("")
                .split_whitespace()
                .next()
                .unwrap_or("");
            if !matches!(
                codec,
                "pcm_s16le"
                    | "pcm_s24le"
                    | "pcm_s32le"
                    | "pcm_f32le"
                    | "pcm_f64le"
                    | "mp3"
                    | "flac"
                    | "vorbis"
                    | "opus"
                    | "aac"
            ) {
                return Err(format!("UnsupportedCodec: {codec}"));
            }
            info.has_audio = true;
            info.codec = codec.into();
            for part in audio.split(',') {
                let part = part.trim();
                if let Some(rate) = part.strip_suffix(" Hz") {
                    info.sample_rate = rate.parse().ok();
                }
                if part == "mono" {
                    info.channels = Some(1)
                } else if part == "stereo" {
                    info.channels = Some(2)
                }
            }
        }
        if let Some(video) = line.split("Video: ").nth(1) {
            let codec = video
                .split(',')
                .next()
                .unwrap_or("")
                .split_whitespace()
                .next()
                .unwrap_or("");
            if !matches!(
                codec,
                "vp8" | "vp9" | "h264" | "hevc" | "png" | "mjpeg" | "webp"
            ) {
                return Err(format!("UnsupportedCodec: {codec}"));
            }
            if info.codec.is_empty() {
                info.codec = codec.into()
            }
            for part in video.split(',') {
                let dim = part.split_whitespace().next().unwrap_or("");
                if let Some((w, h)) = dim.split_once('x') {
                    if let (Ok(w), Ok(h)) = (w.parse(), h.parse()) {
                        info.width = Some(w);
                        info.height = Some(h);
                    }
                }
            }
        }
    }
    if info.codec.is_empty() {
        return Err("UnsupportedCodec: no supported media stream".into());
    }
    Ok(info)
}
pub fn inspect(path: &Path) -> Result<MediaInfo, String> {
    if !path.is_file() || fs::metadata(path).map_err(|e| e.to_string())?.len() > 512 * 1024 * 1024 {
        return Err("MissingAsset or asset exceeds 512 MiB".into());
    }
    let (_, output) = run_capture(
        &[
            "-i".into(),
            path.to_string_lossy().into_owned(),
            "-t".into(),
            "0".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ],
        &Arc::new(AtomicBool::new(false)),
        true,
    )?;
    parse_probe(&output)
}
pub fn import_source(
    project_id: &str,
    picked_path: &Path,
    workspace: &Path,
) -> Result<serde_json::Value, String> {
    if !g_ann_package::valid_id(project_id, "") {
        return Err("Invalid project ID".into());
    }
    let path = picked_path;
    let ext = path
        .extension()
        .and_then(|v| v.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !matches!(
        ext.as_str(),
        "wav" | "mp3" | "flac" | "ogg" | "png" | "jpg" | "jpeg" | "webp" | "webm" | "mp4"
    ) {
        return Err("UnsupportedCodec: choose WAV/MP3/FLAC/Ogg, PNG/JPEG/WebP or WebM/MP4".into());
    }
    let mut info = inspect(path)?;
    let hash = g_ann_package::file_digest(path)?;
    let id = format!("asset_{hash}");
    let relative = format!("assets/{hash}.{ext}");
    let destination = workspace.join(project_id).join(&relative);
    let assets = destination.parent().ok_or("Invalid asset path")?;
    fs::create_dir_all(assets).map_err(|e| e.to_string())?;
    if !destination.exists() {
        fs::copy(path, &destination).map_err(|e| e.to_string())?;
    }
    if fs::metadata(&destination).map_err(|e| e.to_string())?.len() > 512 * 1024 * 1024
        || g_ann_package::file_digest(&destination)? != hash
    {
        return Err("AssetHashMismatch or source exceeds 512 MiB".into());
    }
    let wav_path = if info.has_audio {
        let voice = assets.join(format!("{hash}.voice.wav"));
        if !voice.exists() {
            static IMPORT_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let pending = assets.join(format!(
                "voice-import-{}-{}.wav",
                std::process::id(),
                IMPORT_SEQ.fetch_add(1, Ordering::Relaxed)
            ));
            let result = (|| {
                run_ffmpeg(
                    &[
                        "-n".into(),
                        "-i".into(),
                        destination.to_string_lossy().into_owned(),
                        "-map".into(),
                        "0:a:0".into(),
                        "-vn".into(),
                        "-c:a".into(),
                        "pcm_s16le".into(),
                        "-ar".into(),
                        "48000".into(),
                        "-ac".into(),
                        "1".into(),
                        "-fs".into(),
                        (512u64 * 1024 * 1024).to_string(),
                        pending.to_string_lossy().into_owned(),
                    ],
                    &Arc::new(AtomicBool::new(false)),
                )?;
                let rendered = inspect(&pending)?;
                if fs::metadata(&pending).map_err(|e| e.to_string())?.len() > 512 * 1024 * 1024
                    || (info.duration_ms > 0
                        && rendered.duration_ms.abs_diff(info.duration_ms) > 150)
                {
                    return Err("SourceTooLong: normalized source exceeds the 512 MiB project asset limit; import a shorter source".into());
                }
                fs::rename(&pending, &voice).map_err(|e| e.to_string())?;
                Ok::<_, String>(rendered)
            })();
            if pending.exists() {
                let _ = fs::remove_file(&pending);
            }
            let rendered = result?;
            if info.duration_ms == 0 {
                info.duration_ms = rendered.duration_ms;
            }
        }
        Some(voice.to_string_lossy().into_owned())
    } else {
        None
    };
    let media_type = match ext.as_str() {
        "wav" => "audio/wav",
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "ogg" => "audio/ogg",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "webm" => "video/webm",
        _ => "video/mp4",
    };
    Ok(
        serde_json::json!({"asset":{"id":id,"relativePath":relative,"sha256":hash,"mediaType":media_type,"sourceMetadata":{"originalName":path.file_name().unwrap_or_default().to_string_lossy()}},"path":destination,"wav_path":wav_path,"info":info}),
    )
}

#[tauri::command]
pub async fn inspect_media(
    window: tauri::WebviewWindow,
    path: String,
) -> Result<MediaInfo, String> {
    super::gann::trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || inspect(Path::new(&path)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn import_media(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    project_id: String,
    picked_path: String,
) -> Result<serde_json::Value, String> {
    use tauri::Manager;
    super::gann::trusted(&window)?;
    let workspace = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects");
    tauri::async_runtime::spawn_blocking(move || {
        import_source(&project_id, Path::new(&picked_path), &workspace)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub fn build_event_capabilities() -> serde_json::Value {
    let schema: serde_json::Value =
        serde_json::from_str(include_str!("../../../../schemas/gmaiden-events.json"))
            .expect("bundled events");
    serde_json::json!({"version":1,"events":schema["x-events"]})
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn probe_parser_reads_actual_stream_information_without_ffprobe() {
        let value=parse_probe("Duration: 00:00:01.25, start: 0.000000, bitrate: 768 kb/s\n Stream #0:0: Audio: pcm_s16le, 48000 Hz, mono, s16, 768 kb/s\n Stream #0:1: Video: vp8, yuv420p, 640x360, 24 fps").unwrap();
        assert_eq!(value.duration_ms, 1250);
        assert_eq!(value.sample_rate, Some(48000));
        assert_eq!(value.channels, Some(1));
        assert_eq!(value.width, Some(640));
        assert_eq!(value.height, Some(360));
    }
    #[test]
    fn unsupported_codecs_and_unknown_probe_fail() {
        assert!(parse_probe("Stream #0:0: Audio: executable_payload, 48000 Hz, mono").is_err());
        assert!(parse_probe("not media").is_err());
    }
    #[test]
    fn owned_encoder_process_is_cancelled_without_touching_other_processes() {
        let cancel = Arc::new(AtomicBool::new(false));
        let worker_cancel = cancel.clone();
        let worker = std::thread::spawn(move || {
            run_ffmpeg(
                &[
                    "-re".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    "sine=frequency=440:duration=30".into(),
                    "-f".into(),
                    "null".into(),
                    "-".into(),
                ],
                &worker_cancel,
            )
        });
        std::thread::sleep(Duration::from_millis(250));
        cancel.store(true, Ordering::Release);
        assert_eq!(worker.join().unwrap().unwrap_err(), "Cancelled");
    }
    #[test]
    fn probes_supported_imports_using_the_pinned_encoder_only() {
        let root = std::env::temp_dir().join(format!("studio-probe-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        for extension in ["wav", "mp3", "flac", "ogg"] {
            let path = root.join(format!("เสียง '; $() {extension}.{extension}"));
            run_ffmpeg(
                &[
                    "-y".into(),
                    "-f".into(),
                    "lavfi".into(),
                    "-i".into(),
                    "sine=frequency=440:duration=0.1:sample_rate=48000".into(),
                    path.to_string_lossy().into_owned(),
                ],
                &cancel,
            )
            .unwrap();
            let info = inspect(&path).unwrap();
            assert!(info.has_audio);
            assert!(info.duration_ms >= 90);
            assert_eq!(info.sample_rate, Some(48000));
        }
        for extension in ["png", "jpg", "webp", "webm", "mp4"] {
            let path = root.join(format!("ภาพ {extension}.{extension}"));
            let mut args = vec![
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=blue:s=32x32:d=0.1".into(),
            ];
            if matches!(extension, "png" | "jpg" | "webp") {
                args.extend(["-frames:v".into(), "1".into()]);
            }
            args.push(path.to_string_lossy().into_owned());
            run_ffmpeg(&args, &cancel).unwrap();
            let info = inspect(&path).unwrap();
            assert!(!info.has_audio);
            assert_eq!(info.width, Some(32));
            assert_eq!(info.height, Some(32));
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn import_preserves_readonly_source_and_existing_extracted_sibling() {
        let root = std::env::temp_dir().join(format!("studio-import-owned-{}", std::process::id()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("เสียงต้นฉบับ.flac");
        run_ffmpeg(
            &[
                "-y".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "sine=frequency=440:duration=0.2:sample_rate=44100".into(),
                source.to_string_lossy().into_owned(),
            ],
            &Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        let original_hash = g_ann_package::file_digest(&source).unwrap();
        let sibling = root.join("เสียงต้นฉบับ_extracted.wav");
        fs::write(&sibling, b"user existing audio must remain").unwrap();
        let original_permissions = fs::metadata(&source).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        fs::set_permissions(&source, permissions).unwrap();
        let workspace = root.join("managed");
        let imported =
            import_source("00000000-0000-4000-8000-000000000001", &source, &workspace).unwrap();
        let wav = Path::new(imported["wav_path"].as_str().unwrap());
        assert!(wav.starts_with(&workspace));
        assert_ne!(wav, source);
        let info = inspect(wav).unwrap();
        assert_eq!(info.codec, "pcm_s16le");
        assert_eq!(info.sample_rate, Some(48000));
        assert_eq!(info.channels, Some(1));
        assert_eq!(g_ann_package::file_digest(&source).unwrap(), original_hash);
        assert_eq!(
            fs::read(&sibling).unwrap(),
            b"user existing audio must remain"
        );
        fs::set_permissions(&source, original_permissions).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
