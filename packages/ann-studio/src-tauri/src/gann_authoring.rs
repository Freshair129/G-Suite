//! Authoring produces a verified GANN before any event preview or installation.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::atomic::{AtomicU64, Ordering},
};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildJob {
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub source_path: String,
    pub(crate) clips: Vec<super::InstallClip>,
    pub(crate) banners: Vec<super::BannerAsset>,
    pub output_path: Option<String>,
}
#[derive(Serialize)]
pub struct BuildReport {
    pub path: String,
    pub pack_id: String,
    pub events: usize,
    pub clips: usize,
    pub banners: usize,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallJob {
    pub path: String,
    pub gmaiden_dir: Option<String>,
    #[serde(default = "yes")]
    pub activate: bool,
}
fn yes() -> bool {
    true
}
#[derive(Serialize)]
pub struct InstallReport {
    pub pack_id: String,
    pub pack_dir: String,
    pub container_sha256: String,
    pub activated: bool,
}
fn id(prefix: &str) -> String {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let nonce = format!(
        "{}-{:?}-{}",
        std::process::id(),
        std::time::SystemTime::now(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let digest = g_ann_package::sha256(nonce.as_bytes());
    format!(
        "{prefix}_{}-{}-4{}-8{}-{}",
        &digest[..8],
        &digest[8..12],
        &digest[13..16],
        &digest[17..20],
        &digest[20..32]
    )
}
fn ffmpeg(args: &[String]) -> Result<(), String> {
    let mut command = Command::new(super::ffmpeg_bin());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(super::CREATE_NO_WINDOW);
    }
    let output = command
        .args(["-nostdin", "-v", "error"])
        .args(args)
        .output()
        .map_err(|e| format!("ffmpeg: {e}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "ffmpeg: {}",
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}
fn file_hash(path: &Path) -> Result<String, String> {
    g_ann_package::file_digest(path)
}
fn validate(job: &BuildJob) -> Result<(), String> {
    let encoded = job.banners.iter().fold(0usize, |n, b| {
        b.frames
            .iter()
            .fold(n.saturating_add(b.b64.len()), |total, frame| {
                total.saturating_add(frame.len())
            })
    });
    if job.banners.len() > 24 || encoded > 96 * 1024 * 1024 {
        return Err("ภาพที่ส่งสร้างแพ็กเกินขนาด 96 MiB หรือ 24 events".into());
    }

    if job.author.len() > 256 {
        return Err("ชื่อผู้สร้างยาวเกินขนาด".into());
    }
    if let Some(path) = &job.output_path {
        let path = Path::new(path);
        if path.extension().and_then(|e| e.to_str()) != Some("gann") || path.exists() {
            return Err("เลือกปลายทาง .gann ที่ยังไม่มีไฟล์อยู่".into());
        }
    }
    if job.name.trim().is_empty()
        || job.name.len() > 256
        || job.clips.is_empty()
        || job.clips.len() > 128
    {
        return Err("ชื่อแพ็กและคลิปต้องครบ (สูงสุด 128 คลิป)".into());
    }
    let events: Value =
        serde_json::from_str(include_str!("../../../../schemas/gmaiden-events.json"))
            .map_err(|e| e.to_string())?;
    for c in &job.clips {
        if c.name.len() > 512 {
            return Err("ข้อความคลิปยาวเกิน 512 bytes".into());
        }
        let known = events["x-events"]
            .as_array()
            .is_some_and(|list| list.iter().any(|e| e["id"] == c.event));
        if !known
            || c.event == "unused"
            || !c.start.is_finite()
            || !c.end.is_finite()
            || c.start < 0.0
            || (c.end <= c.start && !(c.end == 0.0 && c.start == 0.0 && !c.file_path.is_empty()))
            || c.end - c.start > 15.0
        {
            return Err(format!("event หรือช่วงคลิปไม่ถูกต้อง: {}", c.event));
        }
        if !job
            .banners
            .iter()
            .any(|b| b.event == c.event && !b.b64.is_empty())
        {
            return Err(format!("ไม่มีภาพที่สร้างไว้สำหรับ {}", c.event));
        }
        if !c.gain.is_finite()
            || !c.speed.is_finite()
            || !c.fade_in.is_finite()
            || !c.fade_out.is_finite()
            || !c.gain_l.is_finite()
            || !c.gain_r.is_finite()
            || c.master.values().any(|n| !n.is_finite())
        {
            return Err("ค่าปรับเสียงไม่ถูกต้อง".into());
        }
    }
    Ok(())
}
pub fn build(job: BuildJob) -> Result<BuildReport, String> {
    static BUILD: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _build = BUILD.try_lock().map_err(|_| "กำลังสร้าง GANN อีกแพ็กอยู่")?;
    validate(&job)?;
    let ann = id("ann");
    let stage = std::env::temp_dir().join(format!("gann-author-{ann}"));
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let staged_output = std::env::temp_dir().join(format!("gann-staged-output-{ann}.gann"));
    let result = (|| {
        fs::create_dir(stage.join("audio")).map_err(|e| e.to_string())?;
        fs::create_dir(stage.join("video")).map_err(|e| e.to_string())?;
        let mut sounds = Vec::new();
        let mut banners = Vec::new();
        let mut events: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        for (n, c) in job.clips.iter().enumerate() {
            let source = if c.file_path.is_empty() {
                PathBuf::from(&job.source_path)
            } else {
                let root = super::sounds_dir()
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                let source = root
                    .join(&c.file_path)
                    .canonicalize()
                    .map_err(|e| e.to_string())?;
                if !source.starts_with(&root) {
                    return Err("ไฟล์เสียงอยู่นอกคลัง".into());
                }
                source
            };
            if !source.is_file() {
                return Err(format!("ไม่พบไฟล์เสียง: {}", source.display()));
            }
            let end = if c.end == 0.0 {
                if fs::metadata(&source).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
                    return Err("คลิปเต็มไฟล์มีขนาดเกิน 16 MiB".into());
                }
                super::wav_duration(source.to_str().ok_or("Source path")?)?
            } else {
                c.end
            };
            if end - c.start > 15.0 {
                return Err("คลิปเสียงยาวเกิน 15 วินาที".into());
            }
            let original = id("snd");
            let mixed = id("snd");
            let banner = id("bnr");
            let original_rel = format!("audio/{original}.wav");
            let mixed_rel = format!("audio/{mixed}.wav");
            let mut args = vec![
                "-n".into(),
                "-i".into(),
                source.to_string_lossy().into_owned(),
                "-ss".into(),
                format!("{:.6}", c.start),
                "-t".into(),
                format!("{:.6}", end - c.start),
                "-vn".into(),
            ];
            if let Some(filter) = super::clip_audio_filter(c, end - c.start) {
                args.extend(["-af".into(), filter]);
            }
            args.extend([
                "-acodec".into(),
                "pcm_s16le".into(),
                "-ar".into(),
                "48000".into(),
                "-ac".into(),
                "1".into(),
                stage.join(&original_rel).to_string_lossy().into_owned(),
            ]);
            ffmpeg(&args)?;
            fs::copy(stage.join(&original_rel), stage.join(&mixed_rel))
                .map_err(|e| e.to_string())?;
            let duration = super::wav_duration(stage.join(&mixed_rel).to_str().ok_or("WAV path")?)?;
            if !(0.0..=15.0).contains(&duration) || duration == 0.0 {
                return Err("ความยาวเสียงต้องไม่เกิน 15 วินาที".into());
            }
            sounds.push(json!({"sound_id":original,"role":"original_voice","label":c.name,"path":original_rel,"sha256":file_hash(&stage.join(&original_rel))?}));
            sounds.push(json!({"sound_id":mixed,"role":"mixed_voice_sfx","label":c.name,"path":mixed_rel,"sha256":file_hash(&stage.join(&mixed_rel))?}));
            let asset = job
                .banners
                .iter()
                .find(|b| b.event == c.event)
                .ok_or("Missing authored banner")?;
            if !matches!(asset.ext.as_str(), "png" | "webp" | "gif" | "webm") {
                return Err("ภาพต้องเป็น PNG/WebP/GIF/WebM".into());
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(asset.b64.trim())
                .map_err(|e| e.to_string())?;
            if bytes.len() > 32 * 1024 * 1024 {
                return Err("ภาพเกินขนาด 32 MiB".into());
            }
            let asset_path = stage.join(format!("author-{n}.{}", asset.ext));
            fs::write(&asset_path, bytes).map_err(|e| e.to_string())?;
            let video_rel = format!("video/{banner}.webm");
            let mut args = vec!["-n".into()];
            let mut filter = "scale=trunc(iw/2)*2:trunc(ih/2)*2".to_string();
            if !asset.frames.is_empty() {
                if asset.frames.len() > 128 {
                    return Err("เฟรมภาพเกิน 128".into());
                }
                let fps = asset.fps.unwrap_or(24.0);
                if !fps.is_finite() || !(1.0..=60.0).contains(&fps) {
                    return Err("FPS ไม่ถูกต้อง".into());
                }
                for (i, frame) in asset.frames.iter().enumerate() {
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(frame)
                        .map_err(|e| e.to_string())?;
                    if bytes.len() > 4 * 1024 * 1024 {
                        return Err("เฟรม PNG ใหญ่เกินขนาด".into());
                    }
                    fs::write(stage.join(format!("frame-{i:04}.png")), bytes)
                        .map_err(|e| e.to_string())?;
                }
                args.extend([
                    "-framerate".into(),
                    format!("{fps:.6}"),
                    "-i".into(),
                    stage.join("frame-%04d.png").to_string_lossy().into_owned(),
                ]);
                filter.push_str(&format!(
                    ",tpad=stop_mode=clone:stop_duration={duration:.6}"
                ));
            } else {
                if matches!(asset.ext.as_str(), "png") {
                    args.extend(["-loop".into(), "1".into()]);
                } else {
                    args.extend(["-stream_loop".into(), "-1".into()]);
                }
                args.extend(["-i".into(), asset_path.to_string_lossy().into_owned()]);
            }
            args.extend([
                "-t".into(),
                format!("{duration:.6}"),
                "-an".into(),
                "-vf".into(),
                filter,
                "-c:v".into(),
                "libvpx".into(),
                "-pix_fmt".into(),
                "yuva420p".into(),
                "-auto-alt-ref".into(),
                "0".into(),
                "-deadline".into(),
                "good".into(),
                "-cpu-used".into(),
                "4".into(),
                "-r".into(),
                "30".into(),
                stage.join(&video_rel).to_string_lossy().into_owned(),
            ]);
            ffmpeg(&args)?;
            for i in 0..asset.frames.len() {
                fs::remove_file(stage.join(format!("frame-{i:04}.png")))
                    .map_err(|e| e.to_string())?;
            }
            fs::remove_file(asset_path).map_err(|e| e.to_string())?;
            banners.push(json!({"banner_id":banner,"event_key":c.event,"original_sound_id":original,"playback_sound_id":mixed,"visual_source":{"root":".","video":video_rel,"sha256":file_hash(&stage.join(&video_rel))?,"silent":true},"components":[],"cues":[],"config":{"duration_seconds":duration}}));
            events
                .entry(c.event.clone())
                .or_default()
                .push(json!({"sound_id":original,"banner_id":banner}));
        }
        let manifest = format!("{ann}.json");
        let registry = json!({"schema_version":1,"announcer_id":ann,"name":job.name,"revision":1,"locale":"th","author":job.author,"sounds":sounds,"events":events,"banners":banners,"components":[],"unmapped_sound_ids":[]});
        fs::write(
            stage.join(&manifest),
            serde_json::to_vec_pretty(&registry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let output = job
            .output_path
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join(format!("{ann}.gann")));
        if output.extension().and_then(|e| e.to_str()) != Some("gann") {
            return Err("ปลายทางต้องเป็น .gann".into());
        }
        let package = g_ann_package::create(&stage, &manifest, &staged_output)?;
        package.validate_playback()?;
        package.save_copy(&output)?;
        Ok(BuildReport {
            path: output.to_string_lossy().into_owned(),
            pack_id: ann,
            events: events.len(),
            clips: job.clips.len(),
            banners: banners.len(),
        })
    })();
    if staged_output.is_file() {
        let _ = fs::remove_file(&staged_output);
    }
    // Generated staging copies only; never remove a source or output package.
    if let (Ok(temp), Ok(path)) = (std::env::temp_dir().canonicalize(), stage.canonicalize()) {
        if path.parent() == Some(temp.as_path())
            && path.file_name() == stage.file_name()
            && fs::symlink_metadata(&stage).is_ok_and(|metadata| !metadata.file_type().is_symlink())
        {
            let _ = fs::remove_dir_all(path);
        }
    }
    result
}
fn validate_health(health: &Value, port: u16, expected_root: &str) -> Result<(), String> {
    if health["service"] != "g-maiden"
        || health["port"].as_u64() != Some(u64::from(port))
        || health["voiceRootId"] != expected_root
    {
        return Err("runtime G-Maiden ไม่ตรงกับตำแหน่งติดตั้งที่เลือก".into());
    }
    Ok(())
}
fn validate_activation(body: &Value, pack_id: &str, digest: &str) -> Result<(), String> {
    if body["ok"] != true
        || body["activated"] != true
        || body["packId"] != pack_id
        || body["containerSha256"] != digest
    {
        return Err(format!(
            "แพ็กติดตั้งแล้ว แต่ runtime ปฏิเสธหรือเปิดใช้แพ็กคนละเนื้อหา: {body}"
        ));
    }
    Ok(())
}
fn local_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| e.to_string())
}
async fn active_endpoint(expected_root: &str) -> Result<String, String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA unavailable")?;
    let raw = fs::read_to_string(PathBuf::from(local).join("G-Maiden/gsi-port.txt"))
        .map_err(|_| "ยังไม่พบ runtime G-Maiden ที่เปิดอยู่")?;
    let port: u16 = raw
        .trim()
        .parse()
        .map_err(|_| "G-Maiden port file is invalid")?;
    if !(3000..=3010).contains(&port) {
        return Err("G-Maiden port outside supported range".into());
    }
    let base = format!("http://127.0.0.1:{port}");
    let response = local_client()?
        .get(format!("{base}/health"))
        .timeout(std::time::Duration::from_secs(3))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err("G-Maiden health failed".into());
    }
    let health: Value = response.json().await.map_err(|e| e.to_string())?;
    validate_health(&health, port, expected_root)?;
    Ok(format!("{base}/announcer/install"))
}
fn install_target(selected: &Option<String>) -> Result<PathBuf, String> {
    selected
        .as_ref()
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .filter(|path| path.is_dir())
        .ok_or_else(|| "G-Maiden target ไม่ถูกต้อง — ตั้ง path ใน Settings".into())
}
pub async fn install(job: InstallJob) -> Result<InstallReport, String> {
    let base = install_target(&job.gmaiden_dir)?;
    let voice_root = super::voice_cache_root(&base);
    let installed = g_ann_package::install(Path::new(&job.path), &voice_root)?;
    if job.activate {
        let root_id = g_ann_package::root_identity(&voice_root)?;
        let endpoint = active_endpoint(&root_id).await?;
        let response = local_client()?
            .post(endpoint)
            .timeout(std::time::Duration::from_secs(5))
            .json(&json!({"packId":installed.pack_id,"containerSha256":installed.container_sha256}))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("แพ็กติดตั้งแล้ว แต่เปิดใช้ไม่สำเร็จ: {}", response.status()));
        }
        let body: Value = response.json().await.map_err(|e| e.to_string())?;
        validate_activation(&body, &installed.pack_id, &installed.container_sha256)?;
    }
    Ok(InstallReport {
        pack_id: installed.pack_id,
        pack_dir: installed.pack_dir.to_string_lossy().into_owned(),
        container_sha256: installed.container_sha256,
        activated: job.activate,
    })
}
#[tauri::command]
pub async fn create_gann_package(
    window: tauri::WebviewWindow,
    job: BuildJob,
) -> Result<BuildReport, String> {
    super::gann::trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || build(job))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn install_gann_package(
    window: tauri::WebviewWindow,
    job: InstallJob,
) -> Result<InstallReport, String> {
    super::gann::trusted(&window)?;
    install(job).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_missing_install_target_does_not_fall_back() {
        let missing = std::env::temp_dir().join(format!("gann-target-{}", std::process::id()));
        assert!(!missing.exists());
        assert!(install_target(&Some(missing.to_string_lossy().into_owned())).is_err());
        assert!(install_target(&Some(String::new())).is_err());
        assert!(install_target(&None).is_err());
        assert!(install_target(&Some(std::env::temp_dir().to_string_lossy().into_owned())).is_ok());
    }
    #[test]
    fn activation_refuses_wrong_runtime_or_different_container() {
        let mut health = json!({"service":"g-maiden","port":3001,"voiceRootId":"root-a"});
        assert!(validate_health(&health, 3001, "root-a").is_ok());
        assert!(validate_health(&health, 3001, "root-b").is_err());
        health["port"] = 3000.into();
        assert!(validate_health(&health, 3001, "root-a").is_err());
        let mut admitted =
            json!({"ok":true,"activated":true,"packId":"ann-a","containerSha256":"digest-a"});
        assert!(validate_activation(&admitted, "ann-a", "digest-a").is_ok());
        assert!(validate_activation(&admitted, "ann-b", "digest-a").is_err());
        admitted["containerSha256"] = "digest-b".into();
        assert!(validate_activation(&admitted, "ann-a", "digest-a").is_err());
    }
    #[test]
    fn invalid_event_or_unpaired_authored_media_never_builds_a_package() {
        let mut job:BuildJob=serde_json::from_value(json!({"name":"test","sourcePath":"missing.wav","clips":[{"name":"line","event":"rampage","start":0,"end":1}],"banners":[]})).unwrap();
        assert!(validate(&job).unwrap_err().contains("ภาพ"));
        job.banners.push(super::super::BannerAsset {
            event: "rampage".into(),
            ext: "png".into(),
            b64: "x".into(),
            frames: vec![],
            fps: None,
        });
        assert!(validate(&job).is_ok());
        job.clips[0].name = "x".repeat(513);
        assert!(validate(&job).is_err());
        job.clips[0].name = "line".into();
        job.clips[0].event = "made_up".into();
        assert!(validate(&job).is_err());
    }
}
