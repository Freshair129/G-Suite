use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantRender {
    pub variant_id: String,
    pub frames: Vec<String>,
    pub fps: f64,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildJob {
    pub snapshot: Value,
    pub asset_paths: BTreeMap<String, String>,
    pub session_token: String,
    pub renders: Vec<VariantRender>,
    pub output_path: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BuildReport {
    pub path: String,
    pub digest: String,
    pub pack_id: String,
    pub revision: u64,
    pub events: usize,
    pub clips: usize,
    pub banners: usize,
    #[serde(rename = "artifactId")]
    pub artifact_id: String,
    #[serde(rename = "projectFingerprint")]
    pub project_fingerprint: String,
    #[serde(rename = "toolchainFingerprint")]
    pub toolchain_fingerprint: String,
    pub generation: u64,
    pub reused: bool,
    pub superseded: bool,
}
#[derive(Clone, Serialize)]
pub struct BuildStatus {
    pub job_id: String,
    pub generation: u64,
    pub stage: String,
    pub completed: usize,
    pub total: usize,
    pub state: String,
    pub report: Option<BuildReport>,
    pub error: Option<String>,
}
struct Running {
    project_id: String,
    cancel: Arc<AtomicBool>,
    status: BuildStatus,
}
static JOBS: OnceLock<Mutex<BTreeMap<String, Running>>> = OnceLock::new();
fn jobs() -> &'static Mutex<BTreeMap<String, Running>> {
    JOBS.get_or_init(|| Mutex::new(BTreeMap::new()))
}
fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str, String> {
    v[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Missing {key}"))
}
fn number(v: &Value, key: &str) -> Result<f64, String> {
    v[key]
        .as_f64()
        .filter(|n| n.is_finite())
        .ok_or_else(|| format!("Invalid {key}"))
}
pub fn next_revision(project: &Value, fingerprint: &str, toolchain: &str) -> (u64, bool) {
    let revision = project["currentRevision"].as_u64().unwrap_or(0);
    let history = project["buildHistory"].as_array();
    if let Some(entry) = history.and_then(|entries| {
        entries.iter().rev().find(|item| {
            item["projectFingerprint"] == fingerprint && item["toolchainFingerprint"] == toolchain
        })
    }) {
        return (entry["revision"].as_u64().unwrap_or(revision), true);
    }
    let maximum = history
        .map(|entries| {
            entries
                .iter()
                .filter_map(|entry| entry["revision"].as_u64())
                .max()
                .unwrap_or(0)
        })
        .unwrap_or(0)
        .max(revision);
    (maximum + 1, false)
}
pub fn validate_timeline(variant: &Value) -> Result<(), String> {
    let audio = number(variant, "audioEndMs")?;
    let video = number(variant, "videoEndMs")?;
    if audio <= 0. || audio > 15000. {
        return Err("Over15Seconds: audioEndMs must be 1..15000".into());
    }
    if video < audio || video - audio > 3200. {
        return Err("Invalid visual tail: maximum 3200 ms".into());
    }
    for cue in variant["sfxCues"].as_array().ok_or("Missing sfxCues")? {
        let start = number(cue, "startMs")?;
        let trim_start = number(cue, "trimStartMs")?;
        let trim_end = number(cue, "trimEndMs")?;
        let fade_in = number(cue, "fadeInMs")?;
        let fade_out = number(cue, "fadeOutMs")?;
        let gain = number(cue, "gainDb")?;
        if start < 0.
            || trim_start < 0.
            || trim_end <= trim_start
            || fade_in < 0.
            || fade_out < 0.
            || fade_in + fade_out > trim_end - trim_start
            || !(-80.0..=24.0).contains(&gain)
        {
            return Err("InvalidSfxCue".into());
        }
        if start + trim_end - trim_start > audio {
            return Err(
                "ExtendRequired: SFX extends beyond audioEndMs; Extend or Trim/Fade explicitly"
                    .into(),
            );
        }
    }
    Ok(())
}
fn cancelled(cancel: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err("Cancelled".into())
    } else {
        Ok(())
    }
}
fn progress(job_id: Option<&str>, stage: &str, completed: usize, total: usize) {
    if let Some(id) = job_id {
        if let Ok(mut jobs) = jobs().lock() {
            if let Some(job) = jobs.get_mut(id) {
                job.status.stage = stage.into();
                job.status.completed = completed;
                job.status.total = total;
            }
        }
    }
}
fn source<'a>(assets: &'a BTreeMap<String, String>, id: &str) -> Result<&'a str, String> {
    assets
        .get(id)
        .map(String::as_str)
        .ok_or_else(|| format!("MissingAsset: {id}"))
}
fn audio_args(path: &str, out: &Path, filter: String) -> Vec<String> {
    vec![
        "-n".into(),
        "-i".into(),
        path.into(),
        "-vn".into(),
        "-af".into(),
        filter,
        "-c:a".into(),
        "pcm_s16le".into(),
        "-ar".into(),
        "48000".into(),
        "-ac".into(),
        "1".into(),
        out.to_string_lossy().into_owned(),
    ]
}
fn render_audio(
    variant: &Value,
    assets: &BTreeMap<String, String>,
    dry: &Path,
    mixed: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let clip = &variant["voiceClip"];
    let start = number(clip, "start")?;
    let end = number(clip, "end")?;
    let audio = number(variant, "audioEndMs")? / 1000.;
    let speed = clip["speed"].as_f64().filter(|n| *n != 0.).unwrap_or(1.);
    if start < 0.
        || end <= start
        || !(0.5..=2.).contains(&speed)
        || (end - start) / speed > audio + 0.001
    {
        return Err("ExtendRequired: voice trim exceeds audioEndMs".into());
    }
    let native_clip: super::InstallClip =
        serde_json::from_value(clip.clone()).map_err(|e| e.to_string())?;
    let effects = super::clip_audio_filter(&native_clip, (end - start) / speed)
        .map(|v| format!(",{v}"))
        .unwrap_or_default();
    let filter=format!("atrim=start={start:.6}:end={end:.6},asetpts=PTS-STARTPTS{effects},apad,atrim=duration={audio:.6},aresample=48000");
    super::media_jobs::run_ffmpeg(
        &audio_args(
            source(assets, string(variant, "voiceAssetId")?)?,
            dry,
            filter,
        ),
        cancel,
    )?;
    let cues = variant["sfxCues"].as_array().ok_or("Missing sfxCues")?;
    if cues.is_empty() {
        fs::copy(dry, mixed).map_err(|e| e.to_string())?;
        return Ok(());
    }
    let mut args = vec!["-n".into(), "-i".into(), dry.to_string_lossy().into_owned()];
    for cue in cues {
        args.extend(["-i".into(), source(assets, string(cue, "assetId")?)?.into()]);
    }
    let mut filters = Vec::new();
    let mut inputs = "[0:a]".to_owned();
    for (i, cue) in cues.iter().enumerate() {
        let index = i + 1;
        let start = number(cue, "trimStartMs")? / 1000.;
        let end = number(cue, "trimEndMs")? / 1000.;
        let gain = number(cue, "gainDb")?;
        let delay = number(cue, "startMs")?.round();
        let fade_in = number(cue, "fadeInMs")? / 1000.;
        let fade_out = number(cue, "fadeOutMs")? / 1000.;
        let dur = end - start;
        filters.push(format!("[{index}:a]atrim=start={start:.6}:end={end:.6},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=mono,volume={gain:.6}dB,afade=t=in:st=0:d={fade_in:.6},afade=t=out:st={:.6}:d={fade_out:.6},adelay={delay:.0}:all=1[s{index}]",dur-fade_out));
        inputs.push_str(&format!("[s{index}]"));
    }
    filters.push(format!("{inputs}amix=inputs={}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.98:level=false:latency=true,apad,atrim=duration={audio:.6}[mix]",cues.len()+1));
    args.extend([
        "-filter_complex".into(),
        filters.join(";"),
        "-map".into(),
        "[mix]".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-ar".into(),
        "48000".into(),
        "-ac".into(),
        "1".into(),
        mixed.to_string_lossy().into_owned(),
    ]);
    super::media_jobs::run_ffmpeg(&args, cancel)
}
fn render_video(
    render: &VariantRender,
    variant: &Value,
    stage: &Path,
    output: &Path,
    cancel: &Arc<AtomicBool>,
) -> Result<(), String> {
    let duration = number(variant, "videoEndMs")? / 1000.;
    if !render.fps.is_finite()
        || !(1.0..=30.0).contains(&render.fps)
        || render.frames.len() != ((duration * render.fps).ceil() as usize).max(1)
    {
        return Err("Invalid rendered frame count/timeline".into());
    }
    let frames = stage.join(format!(
        "frames-{}",
        g_ann_package::sha256(render.variant_id.as_bytes())
    ));
    fs::create_dir(&frames).map_err(|e| e.to_string())?;
    for (i, frame) in render.frames.iter().enumerate() {
        cancelled(cancel)?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(frame)
            .map_err(|e| e.to_string())?;
        if bytes.len() > 4 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            return Err("Invalid or oversized PNG render frame".into());
        }
        fs::write(frames.join(format!("{i:04}.png")), bytes).map_err(|e| e.to_string())?;
    }
    super::media_jobs::run_ffmpeg(
        &[
            "-n".into(),
            "-framerate".into(),
            render.fps.to_string(),
            "-i".into(),
            frames.join("%04d.png").to_string_lossy().into_owned(),
            "-t".into(),
            format!("{duration:.6}"),
            "-an".into(),
            "-vf".into(),
            "scale=trunc(iw/2)*2:trunc(ih/2)*2".into(),
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
            "-map_metadata".into(),
            "-1".into(),
            "-fflags".into(),
            "+bitexact".into(),
            "-flags:v".into(),
            "+bitexact".into(),
            output.to_string_lossy().into_owned(),
        ],
        cancel,
    )
}
pub fn build(
    job: BuildJob,
    workspace: &Path,
    cancel: Arc<AtomicBool>,
    job_id: Option<&str>,
) -> Result<BuildReport, String> {
    static BUILD: Mutex<()> = Mutex::new(());
    let _guard = BUILD.lock().map_err(|e| e.to_string())?;
    cancelled(&cancel)?;
    progress(job_id, "Validate", 0, 1);
    let prepared = super::project_io::prepare_with_session(
        job.snapshot,
        job.asset_paths,
        Some(job.session_token.clone()),
        workspace,
    )?;
    let mut snapshot = prepared.snapshot;
    let assets = prepared.asset_paths;
    let project_id = string(&snapshot["project"], "projectId")?.to_owned();
    let root = workspace.join(&project_id);
    fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let latest = super::project_io::latest_snapshot(&project_id, workspace)?;
    if let Some(prior) = &latest {
        if prior["project"]["announcerId"] == snapshot["project"]["announcerId"] {
            snapshot["project"]["currentRevision"] = prior["project"]["currentRevision"].clone();
            snapshot["project"]["buildHistory"] = prior["project"]["buildHistory"].clone();
        }
    }
    let fingerprint = super::project_io::project_fingerprint(&snapshot)?;
    let mut raster_inputs: Vec<_> = job.renders.iter().collect();
    raster_inputs.sort_by(|a, b| a.variant_id.cmp(&b.variant_id));
    if raster_inputs
        .windows(2)
        .any(|pair| pair[0].variant_id == pair[1].variant_id)
    {
        return Err("Duplicate variant render".into());
    }
    // Browser/font versions can change raster output; bind the encoder cache to the exact frame bytes too.
    let raster_descriptors:Vec<_>=raster_inputs.iter().map(|render|json!({"variantId":render.variant_id,"fps":render.fps,"frames":render.frames.iter().map(|frame|g_ann_package::sha256(frame.as_bytes())).collect::<Vec<_>>()})).collect();
    let raster_hash =
        g_ann_package::sha256(&serde_json::to_vec(&raster_descriptors).map_err(|e| e.to_string())?);
    let toolchain = format!(
        "{}:{raster_hash}",
        super::media_jobs::toolchain_fingerprint()?
    );
    let (revision, reuse) = next_revision(&snapshot["project"], &fingerprint, &toolchain);
    let artifact_dir = root.join("artifacts");
    fs::create_dir_all(&artifact_dir).map_err(|e| e.to_string())?;
    if reuse {
        if let Some(history) = snapshot["project"]["buildHistory"].as_array() {
            for entry in history.iter().rev() {
                if entry["revision"] == revision
                    && entry["projectFingerprint"] == fingerprint
                    && entry["toolchainFingerprint"] == toolchain
                {
                    let mut portable_report = if entry["report"].is_object() {
                        entry["report"].clone()
                    } else {
                        let record = artifact_dir.join(format!(
                            "{}.json",
                            entry["artifactId"].as_str().unwrap_or("")
                        ));
                        match fs::read(record)
                            .ok()
                            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
                        {
                            Some(report) => report,
                            None => continue,
                        }
                    };
                    portable_report["path"] = json!(artifact_dir
                        .join(format!("{}.gann", entry["digest"].as_str().unwrap_or("")))
                        .to_string_lossy());
                    if let Ok(mut report) = serde_json::from_value::<BuildReport>(portable_report) {
                        if !Path::new(&report.path).is_file() {
                            continue;
                        }
                        let package = g_ann_package::Package::open(Path::new(&report.path))?;
                        package.validate_playback()?;
                        if package.digest != report.digest {
                            return Err("ArtifactDigestMismatch".into());
                        }
                        if package.index.announcer_id
                            != snapshot["project"]["announcerId"].as_str().unwrap_or("")
                            || package.registry["revision"] != revision
                            || report.pack_id != package.index.announcer_id
                            || report.revision != revision
                        {
                            return Err("ArtifactIdentityMismatch".into());
                        }
                        report.reused = true;
                        report.generation = snapshot["generation"].as_u64().unwrap_or(0);
                        report.superseded = false;
                        if let Some(dest) = job.output_path {
                            package.save_copy(Path::new(&dest))?;
                            report.path = dest;
                        }
                        return Ok(report);
                    }
                }
            }
        }
    }
    let project = &snapshot["project"];
    let ann = string(project, "announcerId")?.to_owned();
    let variants = project["variants"].as_array().ok_or("Missing variants")?;
    let mappings = project["eventMappings"]
        .as_array()
        .ok_or("Missing eventMappings")?;
    let schema: Value =
        serde_json::from_str(include_str!("../../../../schemas/gmaiden-events.json"))
            .map_err(|e| e.to_string())?;
    let mut mapped = BTreeMap::<String, String>::new();
    for mapping in mappings {
        let event = string(mapping, "eventKey")?;
        if event == "unused"
            || !schema["x-events"]
                .as_array()
                .is_some_and(|events| events.iter().any(|e| e["id"] == event))
        {
            return Err(format!("UnsupportedEvent: {event}"));
        }
        for id in mapping["variantIds"]
            .as_array()
            .ok_or("Missing variantIds")?
        {
            let id = id.as_str().ok_or("Invalid variantId")?;
            if mapped.insert(id.into(), event.into()).is_some() {
                return Err("Variant mapped more than once".into());
            }
        }
    }
    if mapped.is_empty() || mapped.len() > 128 {
        return Err("Map 1..128 variants before building".into());
    }
    if job
        .renders
        .iter()
        .map(|r| r.frames.iter().map(String::len).sum::<usize>())
        .sum::<usize>()
        > 256 * 1024 * 1024
    {
        return Err("Rendered frames exceed 256 MiB; reduce artboard size".into());
    }
    let stage = root.join(format!("build-{}", std::process::id()));
    if stage.exists() {
        return Err(
            "RecoveryRequired: previous build staging remains; reopen project recovery".into(),
        );
    }
    fs::create_dir(&stage).map_err(|e| e.to_string())?;
    let result = (|| {
        fs::create_dir(stage.join("audio")).map_err(|e| e.to_string())?;
        fs::create_dir(stage.join("video")).map_err(|e| e.to_string())?;
        let mut sounds = Vec::new();
        let mut banners = Vec::new();
        let mut events = BTreeMap::<String, Vec<Value>>::new();
        for (i, (variant_id, event)) in mapped.iter().enumerate() {
            cancelled(&cancel)?;
            let variant = variants
                .iter()
                .find(|v| v["id"] == variant_id.as_str())
                .ok_or_else(|| format!("MissingVariant: {variant_id}"))?;
            validate_timeline(variant).map_err(|e| format!("variant {variant_id}: {e}"))?;
            let original = string(variant, "originalSoundId")?;
            let mixed = string(variant, "mixedSoundId")?;
            let banner = string(variant, "bannerId")?;
            if !g_ann_package::valid_id(original, "snd_")
                || !g_ann_package::valid_id(mixed, "snd_")
                || !g_ann_package::valid_id(banner, "bnr_")
            {
                return Err("Invalid stable media IDs".into());
            }
            let dry_rel = format!("audio/{original}.wav");
            let mixed_rel = format!("audio/{mixed}.wav");
            let video_rel = format!("video/{banner}.webm");
            progress(job_id, "Audio", i, mapped.len());
            render_audio(
                variant,
                &assets,
                &stage.join(&dry_rel),
                &stage.join(&mixed_rel),
                &cancel,
            )
            .map_err(|e| format!("variant {variant_id}: {e}"))?;
            progress(job_id, "Visual", i, mapped.len());
            let render = job
                .renders
                .iter()
                .find(|render| render.variant_id == *variant_id)
                .ok_or_else(|| format!("MissingRender: {variant_id}"))?;
            render_video(render, variant, &stage, &stage.join(&video_rel), &cancel)
                .map_err(|e| format!("variant {variant_id}: {e}"))?;
            for (id, role, path) in [
                (original, "original_voice", dry_rel),
                (mixed, "mixed_voice_sfx", mixed_rel),
            ] {
                sounds.push(json!({"sound_id":id,"role":role,"label":variant["voiceClip"]["name"],"path":path,"sha256":g_ann_package::file_digest(&stage.join(&path))?}));
            }
            let audio = number(variant, "audioEndMs")?;
            let video = number(variant, "videoEndMs")?;
            banners.push(json!({"banner_id":banner,"event_key":event,"original_sound_id":original,"playback_sound_id":mixed,"visual_source":{"root":".","video":video_rel,"sha256":g_ann_package::file_digest(&stage.join(&video_rel))?,"silent":true},"components":[],"cues":[],"config":{"duration_seconds":audio/1000.,"visual_tail_ms":(video-audio) as u64}}));
            events
                .entry(event.clone())
                .or_default()
                .push(json!({"sound_id":original,"banner_id":banner}));
        }
        // Remove raster intermediates: only package payload media enter the archive.
        for entry in fs::read_dir(&stage).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name().to_string_lossy().starts_with("frames-") {
                fs::remove_dir_all(entry.path()).map_err(|e| e.to_string())?;
            }
        }
        let manifest = format!("{ann}.json");
        let registry = json!({"schema_version":1,"taxonomy_version":g_ann_package::taxonomy_version(),"announcer_id":ann,"revision":revision,"name":project["name"],"author":project["author"],"locale":project["locale"],"sounds":sounds,"banners":banners,"events":events,"components":[],"unmapped_sound_ids":[]});
        fs::write(
            stage.join(&manifest),
            serde_json::to_vec_pretty(&registry).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        cancelled(&cancel)?;
        progress(job_id, "Package", 0, 1);
        let pending = stage.join("output.gann");
        let package = g_ann_package::create(&stage, &manifest, &pending)?;
        progress(job_id, "Verify", 0, 1);
        package.validate_playback()?;
        cancelled(&cancel)?;
        let destination = artifact_dir.join(format!("{}.gann", package.digest));
        if !destination.exists() {
            package.save_copy(&destination)?;
        }
        let generation = snapshot["generation"].as_u64().unwrap_or(0);
        let newest = super::project_io::latest_snapshot(&project_id, workspace)?;
        let superseded = newest
            .as_ref()
            .is_some_and(|v| v["generation"].as_u64().unwrap_or(0) > generation);
        let artifact_id =
            g_ann_package::sha256(format!("{project_id}:{revision}:{}", package.digest).as_bytes());
        let mut report = BuildReport {
            path: destination.to_string_lossy().into_owned(),
            digest: package.digest.clone(),
            pack_id: ann.clone(),
            revision,
            events: events.len(),
            clips: mapped.len(),
            banners: banners.len(),
            artifact_id: artifact_id.clone(),
            project_fingerprint: fingerprint.clone(),
            toolchain_fingerprint: toolchain.clone(),
            generation,
            reused: false,
            superseded,
        };
        progress(job_id, "Commit", 0, 1);
        let record = artifact_dir.join(format!("{artifact_id}.json"));
        let tmp = record.with_extension("tmp");
        fs::write(
            &tmp,
            serde_json::to_vec(&report).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        fs::rename(&tmp, &record).map_err(|e| e.to_string())?;
        let mut portable_report = serde_json::to_value(&report).map_err(|e| e.to_string())?;
        portable_report
            .as_object_mut()
            .ok_or("Invalid report")?
            .remove("path");
        let entry = json!({"revision":revision,"digest":report.digest,"artifactId":artifact_id,"projectFingerprint":fingerprint,"toolchainFingerprint":toolchain,"report":portable_report});
        report.superseded = !super::project_io::commit_build_snapshot_with_session(
            &snapshot,
            &job.session_token,
            entry,
            workspace,
        )?;
        if let Some(destination) = &job.output_path {
            g_ann_package::Package::open(Path::new(&report.path))?
                .save_copy(Path::new(destination))?;
            report.path = destination.clone();
        }
        Ok(report)
    })();
    // This directory was created by this build below the validated managed project root.
    if stage.parent() == Some(root.as_path())
        && !fs::symlink_metadata(&stage).is_ok_and(|m| m.file_type().is_symlink())
    {
        let _ = fs::remove_dir_all(&stage);
    }
    result
}
pub fn export_verified_artifact(
    workspace: &Path,
    artifact_id: &str,
    destination: &str,
) -> Result<BuildReport, String> {
    if artifact_id.len() != 64 || !artifact_id.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Invalid artifact ID".into());
    }
    let root = workspace;
    for project in fs::read_dir(root).map_err(|e| e.to_string())? {
        let project = project.map_err(|e| e.to_string())?;
        let record = project
            .path()
            .join("artifacts")
            .join(format!("{artifact_id}.json"));
        if record.is_file() {
            let project_id = project.file_name().to_string_lossy().into_owned();
            let committed = super::project_io::latest_snapshot(&project_id, root)?
                .ok_or("ArtifactNotCommitted")?;
            if !committed["project"]["buildHistory"]
                .as_array()
                .is_some_and(|history| {
                    history
                        .iter()
                        .any(|entry| entry["artifactId"] == artifact_id)
                })
            {
                return Err("ArtifactNotCommitted: recover or rebuild project".into());
            }
            let mut report: BuildReport =
                serde_json::from_slice(&fs::read(record).map_err(|e| e.to_string())?)
                    .map_err(|e| e.to_string())?;
            let entry = committed["project"]["buildHistory"]
                .as_array()
                .and_then(|history| {
                    history
                        .iter()
                        .find(|entry| entry["artifactId"] == artifact_id)
                })
                .ok_or("ArtifactNotCommitted")?;
            if report.artifact_id != artifact_id
                || entry["digest"] != report.digest
                || entry["revision"] != report.revision
                || g_ann_package::sha256(
                    format!("{project_id}:{}:{}", report.revision, report.digest).as_bytes(),
                ) != artifact_id
            {
                return Err("ArtifactCommitMismatch".into());
            }
            report.path = project
                .path()
                .join("artifacts")
                .join(format!("{}.gann", report.digest))
                .to_string_lossy()
                .into_owned();
            let package = g_ann_package::Package::open(Path::new(&report.path))?;
            if package.digest != report.digest {
                return Err("ArtifactDigestMismatch".into());
            }
            package.validate_playback()?;
            package.save_copy(Path::new(destination))?;
            report.path = destination.to_owned();
            return Ok(report);
        }
    }
    Err("ArtifactNotCommitted: rebuild or recover project".into())
}

fn workspace(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("projects"))
}
#[tauri::command]
pub fn start_build(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    job: BuildJob,
) -> Result<String, String> {
    super::gann::trusted(&window)?;
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let id = format!(
        "{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, Ordering::Relaxed)
    );
    let cancel = Arc::new(AtomicBool::new(false));
    let root = workspace(&app)?;
    let project_id = string(&job.snapshot["project"], "projectId")?.to_owned();
    if !super::project_io::session_is_active(&job.snapshot, &job.session_token, &root)? {
        return Err(
            "Project session was replaced; restart the build from the current project".into(),
        );
    }
    let mut registry = jobs().lock().map_err(|e| e.to_string())?;
    if registry
        .values()
        .any(|running| running.project_id == project_id && running.status.state == "running")
    {
        return Err("BuildAlreadyRunning: cancel or wait for this project".into());
    }
    if registry.len() >= 128 {
        let completed: Vec<_> = registry
            .iter()
            .filter(|(_, job)| job.status.state != "running")
            .map(|(id, _)| id.clone())
            .collect();
        for id in completed {
            registry.remove(&id);
        }
    }
    registry.insert(
        id.clone(),
        Running {
            project_id,
            cancel: cancel.clone(),
            status: BuildStatus {
                job_id: id.clone(),
                generation: job.snapshot["generation"].as_u64().unwrap_or(0),
                stage: "Validate".into(),
                completed: 0,
                total: 1,
                state: "running".into(),
                report: None,
                error: None,
            },
        },
    );
    drop(registry);
    let key = id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let result = build(job, &root, cancel, Some(&key));
        if let Ok(mut jobs) = jobs().lock() {
            if let Some(job) = jobs.get_mut(&key) {
                match result {
                    Ok(report) => {
                        job.status.state = "ready".into();
                        job.status.report = Some(report);
                        job.status.completed = 1;
                        job.status.total = 1;
                    }
                    Err(error) => {
                        job.status.state = if error == "Cancelled" {
                            "cancelled"
                        } else {
                            "failed"
                        }
                        .into();
                        job.status.error = Some(error);
                    }
                }
            }
        }
    });
    Ok(id)
}
#[tauri::command]
pub fn build_status(window: tauri::WebviewWindow, job_id: String) -> Result<BuildStatus, String> {
    super::gann::trusted(&window)?;
    jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&job_id)
        .map(|v| v.status.clone())
        .ok_or("Unknown build job".into())
}
#[tauri::command]
pub fn cancel_build(window: tauri::WebviewWindow, job_id: String) -> Result<(), String> {
    super::gann::trusted(&window)?;
    jobs()
        .lock()
        .map_err(|e| e.to_string())?
        .get(&job_id)
        .ok_or("Unknown build job")?
        .cancel
        .store(true, Ordering::Release);
    Ok(())
}
#[tauri::command]
pub fn export_artifact(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    artifact_id: String,
    destination: String,
) -> Result<BuildReport, String> {
    super::gann::trusted(&window)?;
    export_verified_artifact(&workspace(&app)?, &artifact_id, &destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn vendored_taxonomy_matches_shared_crate() {
        assert_eq!(
            include_str!("../../../../schemas/gmaiden-events.json"),
            g_ann_package::events_json(),
            "Refresh schemas/gmaiden-events.json with the exact bytes of \
             src-tauri/gann-package/events.json from the G-Maiden revision pinned \
             in packages/ann-studio/src-tauri/Cargo.toml (git show <rev>:<path>); \
             preserve UTF-8 and LF line endings. Review the pin and JSON together."
        );
    }
    #[test]
    fn changed_revision_and_reuse_are_content_based() {
        let mut p = json!({"currentRevision":2,"buildHistory":[{"revision":2,"projectFingerprint":"a","toolchainFingerprint":"tool"}]});
        assert_eq!(next_revision(&p, "a", "tool"), (2, true));
        assert_eq!(next_revision(&p, "b", "tool"), (3, false));
        p["currentRevision"] = json!(0);
        p["buildHistory"] = json!([]);
        assert_eq!(next_revision(&p, "a", "tool"), (1, false));
    }
    #[test]
    fn sfx_overflow_requires_explicit_extension() {
        let mut v = json!({"id":"two","audioEndMs":1000,"videoEndMs":1000,"sfxCues":[{"assetId":"sfx","startMs":800,"trimStartMs":0,"trimEndMs":500,"gainDb":0,"fadeInMs":0,"fadeOutMs":0}]});
        assert!(validate_timeline(&v)
            .unwrap_err()
            .contains("ExtendRequired"));
        v["audioEndMs"] = json!(1300);
        v["videoEndMs"] = json!(4501);
        assert!(validate_timeline(&v).unwrap_err().contains("tail"));
        v["videoEndMs"] = json!(4500);
        assert!(validate_timeline(&v).is_ok());
    }
    fn test_root() -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let root = std::env::temp_dir().join(format!(
            "studio-build-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }
    fn wav(path: &Path, hz: f64) {
        let samples = 48000u32;
        let mut bytes = Vec::new();
        bytes.extend(b"RIFF");
        bytes.extend((36 + samples * 2).to_le_bytes());
        bytes.extend(b"WAVEfmt ");
        bytes.extend(16u32.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(1u16.to_le_bytes());
        bytes.extend(48000u32.to_le_bytes());
        bytes.extend(96000u32.to_le_bytes());
        bytes.extend(2u16.to_le_bytes());
        bytes.extend(16u16.to_le_bytes());
        bytes.extend(b"data");
        bytes.extend((samples * 2).to_le_bytes());
        for n in 0..samples {
            let value = ((f64::from(n) * hz * std::f64::consts::TAU / 48000.).sin() * 3000.) as i16;
            bytes.extend(value.to_le_bytes());
        }
        fs::write(path, bytes).unwrap();
    }
    fn fixture(root: &Path) -> BuildJob {
        let voice = root.join("voice.wav");
        let sfx = root.join("sfx.wav");
        wav(&voice, 440.);
        wav(&sfx, 880.);
        let image = root.join("frame.png");
        super::super::media_jobs::run_ffmpeg(
            &[
                "-n".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=red:s=32x32:d=0.04".into(),
                "-frames:v".into(),
                "1".into(),
                image.to_string_lossy().into_owned(),
            ],
            &Arc::new(AtomicBool::new(false)),
        )
        .unwrap();
        let frame = base64::engine::general_purpose::STANDARD.encode(fs::read(image).unwrap());
        let snapshot = json!({"project":{"schemaVersion":2,"projectId":"00000000-0000-4000-8000-000000000001","announcerId":"ann_00000000-0000-4000-8000-000000000002","name":"Builder fixture","author":"Test","locale":"th","currentRevision":0,"installBindings":{},
   "assets":[{"id":"voice","relativePath":"assets/voice.wav","sha256":"","mediaType":"audio/wav","sourceMetadata":{"originalName":"voice.wav"}},{"id":"sfx","relativePath":"assets/sfx.wav","sha256":"","mediaType":"audio/wav","sourceMetadata":{"originalName":"sfx.wav"}}],
   "variants":[{"id":"one","originalSoundId":"snd_00000000-0000-4000-8000-000000000003","mixedSoundId":"snd_00000000-0000-4000-8000-000000000004","bannerId":"bnr_00000000-0000-4000-8000-000000000005","voiceAssetId":"voice","voiceClip":{"id":"one","name":"คำที่หนึ่ง","start":0,"end":1,"event":"kill","color":""},"bannerProject":{"layers":[],"assets":[]},"sfxCues":[{"assetId":"sfx","startMs":200,"trimStartMs":0,"trimEndMs":500,"fadeInMs":20,"fadeOutMs":20,"gainDb":-6}],"audioEndMs":1000,"videoEndMs":1000}],"eventMappings":[{"eventKey":"kill","variantIds":["one"]}],"inactiveStock":[],"templates":[],"buildHistory":[],"editor":{"sourceAssetId":"voice","wavAssetId":"voice","duration":1,"clips":[],"bannerProject":{"layers":[],"assets":[]},"bannerOverrides":{},"packBuilder":{},"trackItems":[],"trackCount":1,"masterVolume":1,"overlayLayout":{}}},"generation":1,"fingerprint":""});
        let asset_paths = BTreeMap::from([
            ("voice".into(), voice.to_string_lossy().into_owned()),
            ("sfx".into(), sfx.to_string_lossy().into_owned()),
        ]);
        let active = super::super::project_io::activate_project_session(
            snapshot,
            asset_paths,
            None,
            &root.join("projects"),
        )
        .unwrap();
        BuildJob {
            snapshot: active.snapshot,
            asset_paths: active.asset_paths,
            session_token: active.session_token.unwrap(),
            renders: vec![VariantRender {
                variant_id: "one".into(),
                frames: vec![frame; 24],
                fps: 24.,
            }],
            output_path: None,
        }
    }
    #[test]
    fn actual_sfx_changes_mixed_only_equal_timeline_and_unchanged_reuses_digest() {
        let root = test_root();
        let mut job = fixture(&root);
        let workspace = root.join("projects");
        let cancel = Arc::new(AtomicBool::new(false));
        let first = build(job.clone(), &workspace, cancel.clone(), None).unwrap();
        assert_eq!(first.revision, 1);
        let first_package = g_ann_package::Package::open(Path::new(&first.path)).unwrap();
        let sounds = first_package.registry["sounds"].as_array().unwrap();
        assert_ne!(sounds[0]["sha256"], sounds[1]["sha256"]);
        let dry = first_package
            .read(sounds[0]["path"].as_str().unwrap())
            .unwrap();
        let mixed = first_package
            .read(sounds[1]["path"].as_str().unwrap())
            .unwrap();
        assert_eq!(dry.len(), mixed.len());
        let mut compact = super::super::project_io::latest_snapshot(
            "00000000-0000-4000-8000-000000000001",
            &workspace,
        )
        .unwrap()
        .unwrap();
        assert!(!serde_json::to_string(&compact)
            .unwrap()
            .contains(root.to_str().unwrap()));
        compact["project"]["buildHistory"][0]
            .as_object_mut()
            .unwrap()
            .remove("report");
        super::super::project_io::persist_snapshot(&compact, &workspace).unwrap();
        let unchanged = build(job.clone(), &workspace, cancel.clone(), None).unwrap();
        assert_eq!(unchanged.revision, 1);
        assert_eq!(first.digest, unchanged.digest);
        assert!(unchanged.reused);
        job.snapshot["project"]["variants"][0]["sfxCues"] = json!([]);
        job.snapshot["generation"] = json!(2);
        let second = build(job.clone(), &workspace, cancel.clone(), None).unwrap();
        assert_eq!(second.revision, 2);
        assert_ne!(first.digest, second.digest);
        let package = g_ann_package::Package::open(Path::new(&second.path)).unwrap();
        let second_sounds = package.registry["sounds"].as_array().unwrap();
        assert_eq!(second_sounds[0]["sha256"], sounds[0]["sha256"]);
        assert_eq!(second_sounds[0]["sha256"], second_sounds[1]["sha256"]);
        job.snapshot["project"]["variants"][0]["audioEndMs"] = json!(16000);
        job.snapshot["generation"] = json!(3);
        assert!(build(job, &workspace, cancel.clone(), None).is_err());
        let latest = super::super::project_io::latest_snapshot(
            "00000000-0000-4000-8000-000000000001",
            &workspace,
        )
        .unwrap()
        .unwrap();
        assert_eq!(latest["project"]["currentRevision"], 2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancelled_build_never_advances_revision() {
        let root = test_root();
        let job = fixture(&root);
        let workspace = root.join("projects");
        let recovery = workspace.join("00000000-0000-4000-8000-000000000001/recovery.json");
        let before = fs::read(&recovery).unwrap();
        assert_eq!(
            build(job, &workspace, Arc::new(AtomicBool::new(true)), None).unwrap_err(),
            "Cancelled"
        );
        assert_eq!(fs::read(&recovery).unwrap(), before);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn edited_second_variant_renders_its_own_visual_and_preserves_the_first() {
        let root = test_root();
        let mut job = fixture(&root);
        let mut second = job.snapshot["project"]["variants"][0].clone();
        second["id"] = json!("two");
        second["originalSoundId"] = json!("snd_00000000-0000-4000-8000-000000000006");
        second["mixedSoundId"] = json!("snd_00000000-0000-4000-8000-000000000007");
        second["bannerId"] = json!("bnr_00000000-0000-4000-8000-000000000008");
        second["voiceClip"]["id"] = json!("two");
        second["voiceClip"]["name"] = json!("ตัวแปรที่สอง");
        job.snapshot["project"]["variants"]
            .as_array_mut()
            .unwrap()
            .push(second);
        job.snapshot["project"]["eventMappings"][0]["variantIds"] = json!(["one", "two"]);
        let mut render = job.renders[0].clone();
        render.variant_id = "two".into();
        job.renders.push(render);
        let workspace = root.join("projects");
        let cancel = Arc::new(AtomicBool::new(false));
        let first = build(job.clone(), &workspace, cancel.clone(), None).unwrap();
        let prior = g_ann_package::Package::open(Path::new(&first.path)).unwrap();
        let blue = root.join("blue.png");
        super::super::media_jobs::run_ffmpeg(
            &[
                "-n".into(),
                "-f".into(),
                "lavfi".into(),
                "-i".into(),
                "color=c=blue:s=32x32:d=0.04".into(),
                "-frames:v".into(),
                "1".into(),
                blue.to_string_lossy().into_owned(),
            ],
            &cancel,
        )
        .unwrap();
        let frame = base64::engine::general_purpose::STANDARD.encode(fs::read(blue).unwrap());
        job.renders[1].frames = vec![frame; 24];
        job.snapshot["project"]["variants"][1]["bannerProject"]["title"] =
            json!("Blue second variant");
        job.snapshot["generation"] = json!(2);
        let changed = build(job, &workspace, cancel, None).unwrap();
        assert_eq!(changed.revision, 2);
        let current = g_ann_package::Package::open(Path::new(&changed.path)).unwrap();
        assert_eq!(
            prior.registry["banners"][0]["visual_source"]["sha256"],
            current.registry["banners"][0]["visual_source"]["sha256"]
        );
        assert_ne!(
            prior.registry["banners"][1]["visual_source"]["sha256"],
            current.registry["banners"][1]["visual_source"]["sha256"]
        );
        assert_eq!(
            current.registry["events"]["kill"].as_array().unwrap().len(),
            2
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn staged_cache_record_without_committed_history_cannot_be_exported() {
        let root = test_root();
        let job = fixture(&root);
        let workspace = root.join("projects");
        let report = build(job, &workspace, Arc::new(AtomicBool::new(false)), None).unwrap();
        let exported = root.join("verified-export.gann");
        let copy =
            export_verified_artifact(&workspace, &report.artifact_id, exported.to_str().unwrap())
                .unwrap();
        assert_eq!(copy.digest, report.digest);
        assert_eq!(
            g_ann_package::file_digest(&exported).unwrap(),
            report.digest
        );
        let package = g_ann_package::Package::open(&exported).unwrap();
        let taxonomy_version = g_ann_package::taxonomy_version();
        assert_eq!(package.registry["taxonomy_version"], taxonomy_version);
        package.validate_playback().unwrap();
        let admission = g_ann_package::validate_playback_registry(&package.registry).unwrap();
        assert_eq!(admission.pack_taxonomy_version, taxonomy_version);
        assert_eq!(admission.runtime_taxonomy_version, taxonomy_version);
        assert!(admission.inert_events.is_empty());
        let recovery = workspace.join("00000000-0000-4000-8000-000000000001/recovery.json");
        let mut snapshot: Value = serde_json::from_slice(&fs::read(&recovery).unwrap()).unwrap();
        snapshot["project"]["buildHistory"] = json!([]);
        snapshot["project"]["currentRevision"] = json!(0);
        fs::write(&recovery, serde_json::to_vec(&snapshot).unwrap()).unwrap();
        let destination = root.join("never-exported.gann");
        assert!(export_verified_artifact(
            &workspace,
            &report.artifact_id,
            destination.to_str().unwrap()
        )
        .unwrap_err()
        .contains("ArtifactNotCommitted"));
        assert!(!destination.exists());
        assert!(Path::new(&report.path).is_file());
        fs::remove_dir_all(root).unwrap();
    }
}
