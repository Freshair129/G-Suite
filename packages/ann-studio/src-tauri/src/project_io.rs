//! Portable editable projects. All media references inside archives are managed and relative.
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

pub const MAX_PROJECT: u64 = 2 * 1024 * 1024 * 1024;
const MAX_ASSET: u64 = 512 * 1024 * 1024;
const MAX_DOCUMENT: u64 = 16 * 1024 * 1024;
const MAX_ASSETS: usize = 4096;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenResult {
    pub snapshot: Value,
    pub asset_paths: BTreeMap<String, String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSaveResult {
    pub snapshot: Value,
    pub asset_paths: BTreeMap<String, String>,
    pub path: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCandidate {
    pub project_id: String,
    pub path: String,
    pub generation: u64,
}

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str, String> {
    value[key]
        .as_str()
        .ok_or_else(|| format!("Project missing {key}"))
}
fn project_id(snapshot: &Value) -> Result<&str, String> {
    let id = text(&snapshot["project"], "projectId")?;
    if !g_ann_package::valid_id(id, "") {
        return Err("Invalid project identity".into());
    }
    Ok(id)
}
fn asset_name(name: &str) -> bool {
    name.starts_with("assets/")
        && name.len() <= 160
        && name[7..]
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(&c))
        && !name.contains("..")
        && name.len() > 7
}
fn validate(snapshot: &Value) -> Result<(), String> {
    let project = &snapshot["project"];
    project_id(snapshot)?;
    if project["schemaVersion"] != 2
        || !g_ann_package::valid_id(text(project, "announcerId")?, "ann_")
        || project["currentRevision"].as_u64().is_none()
        || snapshot["generation"].as_u64().is_none()
    {
        return Err("Invalid project schema/revision".into());
    }
    for key in ["name", "author", "locale"] {
        text(project, key)?;
    }
    for key in [
        "variants",
        "eventMappings",
        "inactiveStock",
        "templates",
        "buildHistory",
    ] {
        if !project[key].is_array() {
            return Err(format!("Project missing {key}"));
        }
    }
    if !project["editor"].is_object() {
        return Err("Project missing editor document".into());
    }
    let assets = project["assets"]
        .as_array()
        .ok_or("Project missing assets")?;
    if assets.len() > MAX_ASSETS {
        return Err("Project asset count exceeds 4096".into());
    }
    let mut ids = BTreeSet::new();
    for asset in assets {
        let id = text(asset, "id")?;
        if id.is_empty()
            || id.len() > 128
            || !id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
            || !ids.insert(id)
        {
            return Err("Invalid or duplicate asset identity".into());
        }
        if !asset_name(text(asset, "relativePath")?) {
            return Err(format!("Unsafe asset path {id}"));
        }
        let hash = text(asset, "sha256")?;
        if !hash.is_empty()
            && (hash.len() != 64
                || !hash
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)))
        {
            return Err(format!("Invalid asset hash {id}"));
        }
        text(asset, "mediaType")?;
        let name = text(&asset["sourceMetadata"], "originalName")?;
        if name.contains(['/', '\\']) {
            return Err(format!("Asset {id} retains an external source path"));
        }
    }
    fn refs(value: &Value, ids: &BTreeSet<&str>) -> Result<(), String> {
        match value {
            Value::String(s) if s.starts_with("asset:") => {
                if !ids.contains(&s[6..]) {
                    return Err(format!("Missing asset reference {}", &s[6..]));
                }
            }
            Value::Object(map) => {
                for (key, value) in map {
                    if matches!(
                        key.as_str(),
                        "source" | "filePath" | "file_path" | "source_path"
                    ) {
                        if let Some(path) = value.as_str() {
                            if !path.is_empty() && !path.starts_with("asset:") {
                                return Err(format!("External project media reference {key}"));
                            }
                        }
                    }
                    refs(value, ids)?;
                }
            }
            Value::Array(values) => {
                for value in values {
                    refs(value, ids)?;
                }
            }
            _ => {}
        }
        Ok(())
    }
    refs(project, &ids)?;
    if serde_json::to_vec(snapshot).map_err(err)?.len() as u64 > MAX_DOCUMENT {
        return Err("Project document exceeds 16 MiB".into());
    }
    Ok(())
}

pub fn project_fingerprint(snapshot: &Value) -> Result<String, String> {
    let mut project = snapshot.get("project").cloned().ok_or("Missing project")?;
    project["currentRevision"] = Value::from(0);
    project["buildHistory"] = Value::Array(vec![]);
    project["installBindings"] = serde_json::json!({});
    Ok(g_ann_package::sha256(
        &serde_json::to_vec(&project).map_err(err)?,
    ))
}

fn unique(path: &Path, label: &str) -> PathBuf {
    static N: AtomicU64 = AtomicU64::new(0);
    path.join(format!(
        ".{label}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ))
}
fn lock(root: &Path) -> Result<File, String> {
    fs::create_dir_all(root).map_err(err)?;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(root.join("project.lock"))
        .map_err(err)?;
    file.try_lock()
        .map_err(|_| "Project is locked by another operation".to_string())?;
    Ok(file)
}
fn copy_bounded(mut input: impl Read, output: &mut impl Write, limit: u64) -> Result<u64, String> {
    let mut scratch = [0u8; 65536];
    let mut total = 0;
    loop {
        let n = input.read(&mut scratch).map_err(err)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > limit {
            return Err("Project expanded/asset size limit".into());
        }
        output.write_all(&scratch[..n]).map_err(err)?;
    }
    Ok(total)
}

fn prepare_locked(
    mut snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    root: &Path,
) -> Result<ProjectOpenResult, String> {
    let assets_root = root.join("assets");
    fs::create_dir_all(&assets_root).map_err(err)?;
    let mut paths = BTreeMap::new();
    let mut total = 0u64;
    let assets = snapshot["project"]["assets"]
        .as_array_mut()
        .ok_or("Missing assets")?;
    for asset in assets {
        let id = text(asset, "id")?.to_owned();
        let source = asset_paths.get(&id).ok_or_else(|| {
            format!("Missing asset {id}: select the original media/font to repair")
        })?;
        let temp = unique(&assets_root, "import");
        let result = (|| {
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp)
                .map_err(err)?;
            let count = if source.starts_with("data:") {
                use base64::engine::general_purpose::STANDARD;
                let (header, data) = source
                    .split_once(',')
                    .ok_or_else(|| format!("Invalid embedded asset {id}"))?;
                if !header.ends_with(";base64") || !header.starts_with("data:") {
                    return Err(format!("Unsupported embedded asset {id}"));
                }
                copy_bounded(
                    base64::read::DecoderReader::new(data.as_bytes(), &STANDARD),
                    &mut output,
                    MAX_ASSET,
                )?
            } else {
                if source.contains("://") {
                    return Err(format!("Remote asset {id} is not allowed"));
                }
                let file = File::open(source).map_err(|e| format!("Missing asset {id}: {e}"))?;
                if file.metadata().map_err(err)?.len() > MAX_ASSET {
                    return Err(format!("Asset {id} exceeds 512 MiB"));
                }
                copy_bounded(file, &mut output, MAX_ASSET)?
            };
            output.sync_all().map_err(err)?;
            drop(output);
            total = total.checked_add(count).ok_or("Project size overflow")?;
            if total > MAX_PROJECT {
                return Err("Project expanded size limit".into());
            }
            let hash = g_ann_package::file_digest(&temp)?;
            let expected = text(asset, "sha256")?;
            if !expected.is_empty() && expected != hash {
                return Err(format!(
                    "Asset {id} hash changed; import it again explicitly"
                ));
            }
            let extension = Path::new(text(asset, "relativePath")?)
                .extension()
                .and_then(|x| x.to_str())
                .unwrap_or("bin");
            let relative = format!("assets/{hash}.{extension}");
            let target = root.join(&relative);
            if target.exists() {
                if g_ann_package::file_digest(&target)? != hash {
                    return Err(format!("Managed asset {id} is corrupt"));
                }
                fs::remove_file(&temp).map_err(err)?;
            } else {
                fs::rename(&temp, &target).map_err(err)?;
            }
            asset["relativePath"] = Value::from(relative);
            asset["sha256"] = Value::from(hash);
            paths.insert(id, target.to_string_lossy().into_owned());
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(&temp);
        }
        result?;
    }
    snapshot["fingerprint"] = Value::from(project_fingerprint(&snapshot)?);
    if let Some(latest) = latest_snapshot(
        project_id(&snapshot)?,
        root.parent().ok_or("Project workspace root")?,
    )? {
        merge_build_metadata(&mut snapshot, &latest)?;
    }
    validate(&snapshot)?;
    Ok(ProjectOpenResult {
        snapshot,
        asset_paths: paths,
    })
}

pub fn prepare(
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    validate(&snapshot)?;
    let root = workspace.join(project_id(&snapshot)?);
    let _guard = lock(&root)?;
    let prepared = prepare_locked(snapshot, asset_paths, &root)?;
    persist_if_current(&prepared.snapshot, workspace, &root)?;
    Ok(prepared)
}

fn prepare_if_current(
    mut snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    expected_generation: u64,
    expected_baseline_fingerprint: &str,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    validate(&snapshot)?;
    if snapshot["generation"].as_u64() != Some(expected_generation) {
        return Err("Project generation changed before banner import".into());
    }
    let id = project_id(&snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    if let Some(latest) = latest_snapshot(id, workspace)? {
        let latest_generation = latest["generation"]
            .as_u64()
            .ok_or("Invalid recovery generation")?;
        if latest_generation > expected_generation
            || (latest_generation == expected_generation
                && project_fingerprint(&latest)? != expected_baseline_fingerprint)
        {
            return Err("Project changed while the banner import was pending".into());
        }
    }
    // Import changes the document. Advance its generation under the same lock as
    // the recovery comparison and commit, so earlier pending snapshots cannot
    // overwrite this import or be accepted as the current build.
    let generation = expected_generation
        .checked_add(1)
        .filter(|value| *value <= 9_007_199_254_740_991)
        .ok_or("Project generation limit reached")?;
    snapshot["generation"] = Value::from(generation);
    let prepared = prepare_locked(snapshot, asset_paths, &root)?;
    persist_if_current(&prepared.snapshot, workspace, &root)?;
    Ok(prepared)
}

fn asset_extension(media_type: &str) -> Result<&'static str, String> {
    match media_type {
        "image/png" => Ok("png"),
        "image/webp" => Ok("webp"),
        "image/jpeg" => Ok("jpg"),
        "video/webm" => Ok("webm"),
        _ => Err(format!("Unsupported banner media type {media_type}")),
    }
}

fn import_banner_project(
    manifest: &Value,
    target_event: &str,
    managed_ids: &BTreeMap<String, String>,
    files: &BTreeMap<String, Value>,
    manifest_sha256: &str,
) -> Result<Value, String> {
    if manifest["mediaKind"] == "editable-template" {
        let mut project = manifest["template"]["bannerProject"].clone();
        project["eventId"] = Value::from(target_event);
        for asset in project["assets"]
            .as_array_mut()
            .ok_or("BannerProject assets are missing")?
        {
            let source = asset["source"]
                .as_str()
                .and_then(|source| source.strip_prefix("asset:"))
                .ok_or("Invalid BannerProject asset source")?;
            let managed_id = managed_ids
                .get(source)
                .ok_or("BannerProject source file was not staged")?;
            asset["source"] = Value::from(format!("asset:{managed_id}"));
        }
        return Ok(project);
    }

    let role = if manifest["mediaKind"] == "still-image" {
        "stillImage"
    } else {
        "runtimeVideo"
    };
    let file = files
        .values()
        .find(|file| file["role"] == role)
        .ok_or("Banner runtime media file is missing")?;
    let file_id = file["id"]
        .as_str()
        .ok_or("Banner runtime file ID is missing")?;
    let asset_id = managed_ids
        .get(file_id)
        .ok_or("Banner runtime file was not staged")?;
    let media_type = file["mediaType"]
        .as_str()
        .ok_or("Banner runtime media type is missing")?;
    let image = manifest["mediaKind"] == "still-image";
    let suffix = &manifest_sha256[..24];
    let layer_kind = if image { "image" } else { "video" };
    let project_id = format!("banner-project-{suffix}");
    let asset_editor_id = format!("banner-source-{suffix}");
    let layer_id = format!("banner-layer-{suffix}");
    let name = manifest["name"].as_str().ok_or("Banner name is missing")?;
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "id": project_id,
        "title": name,
        "eventId": target_event,
        "artboard": {"width": 1280, "height": 720, "safeZonePreset": "dota-hud"},
        "revision": manifest["revision"],
        "assets": [{"id": asset_editor_id, "name": name, "kind": if image {"image"} else {"video"}, "mime": media_type, "source": format!("asset:{asset_id}")}],
        "layers": [{
            "id": layer_id,
            "kind": layer_kind,
            "name": name,
            "parentId": null,
            "order": 0,
            "visible": true,
            "locked": false,
            "transform": {"x": 50, "y": 50, "width": 100, "height": 100, "rotation": 0, "opacity": 1},
            "style": {},
            "content": {"assetId": asset_editor_id}
        }]
    }))
}

pub fn import_banner_asset_archive(
    path: &Path,
    manifest_sha256: &str,
    variant_id: &str,
    expected_generation: u64,
    mut snapshot: Value,
    mut asset_paths: BTreeMap<String, String>,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    use super::banner_asset_archive;

    let verified = banner_asset_archive::extract_verified(path, Some(manifest_sha256))?;
    if snapshot["generation"].as_u64() != Some(expected_generation) {
        return Err("Project generation changed before banner import".into());
    }
    // The import intentionally changes the project document below. Compare recovery against
    // the untouched editor snapshot so a same-generation recovery does not look stale merely
    // because this operation is adding the banner asset.
    let baseline_fingerprint = project_fingerprint(&snapshot)?;
    let manifest = &verified.manifest;
    let file_records = manifest["files"]
        .as_array()
        .ok_or("Banner manifest files are missing")?;
    let mut managed_ids = BTreeMap::new();
    let assets = snapshot["project"]["assets"]
        .as_array_mut()
        .ok_or("Project assets are missing")?;
    if assets.len() + file_records.len() > MAX_ASSETS {
        return Err("Project asset count exceeds 4096".into());
    }
    for record in file_records {
        let file_id = record["id"].as_str().ok_or("Banner file ID is missing")?;
        let sha = record["sha256"]
            .as_str()
            .ok_or("Banner file digest is missing")?;
        let media_type = record["mediaType"]
            .as_str()
            .ok_or("Banner file media type is missing")?;
        let extension = asset_extension(media_type)?;
        let name = record["path"]
            .as_str()
            .and_then(|path| Path::new(path).file_name())
            .and_then(|name| name.to_str())
            .ok_or("Banner source filename is invalid")?;
        let asset_id = format!("banner-{sha}");
        if let Some(existing) = assets.iter().find(|asset| asset["id"] == asset_id) {
            if existing["sha256"] != sha || existing["mediaType"] != media_type {
                return Err("Content-identical banner assets have conflicting media types".into());
            }
        } else {
            assets.push(serde_json::json!({
                "id": asset_id,
                "relativePath": format!("assets/{sha}.{extension}"),
                "sha256": sha,
                "mediaType": media_type,
                "sourceMetadata": {"originalName": name}
            }));
        }
        let staged = verified
            .files
            .get(file_id)
            .ok_or("Verified banner file is missing")?;
        asset_paths.insert(asset_id.clone(), staged.to_string_lossy().into_owned());
        managed_ids.insert(file_id.to_owned(), asset_id);
    }

    let project = &mut snapshot["project"];
    let variant = project["variants"]
        .as_array_mut()
        .ok_or("Project variants are missing")?
        .iter_mut()
        .find(|variant| variant["id"] == variant_id)
        .ok_or("Select an existing voice variant before importing a banner")?;
    let event = variant["voiceClip"]["event"]
        .as_str()
        .ok_or("Target variant has no voice event")?;
    if event.is_empty()
        || !event.is_ascii()
        || !event
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
    {
        return Err("Target voice event cannot be represented by BannerProject v1".into());
    }
    let files = manifest["files"]
        .as_array()
        .ok_or("Banner manifest files are missing")?
        .iter()
        .filter_map(|file| Some((file["path"].as_str()?.to_owned(), file.clone())))
        .collect::<BTreeMap<_, _>>();
    let banner_project = import_banner_project(
        manifest,
        event,
        &managed_ids,
        &files,
        &verified.manifest_sha256,
    )?;
    variant["bannerProject"] = banner_project.clone();
    variant["bannerSource"] = serde_json::json!({
        "assetId": manifest["assetId"],
        "revision": manifest["revision"],
        "manifestSha256": verified.manifest_sha256
    });
    project["editor"]["bannerProject"] = banner_project;
    project["editor"]["bannerVariantId"] = Value::from(variant_id);

    prepare_if_current(
        snapshot,
        asset_paths,
        expected_generation,
        &baseline_fingerprint,
        workspace,
    )
}

fn archive_bytes(
    path: &Path,
    snapshot: &Value,
    asset_paths: &BTreeMap<String, String>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or("Project destination requires a folder")?;
    fs::create_dir_all(parent).map_err(err)?;
    let temp = unique(parent, "ann-save");
    let result = (|| {
        let document = serde_json::to_vec(snapshot).map_err(err)?;
        if document.len() as u64 > MAX_DOCUMENT {
            return Err("Project document exceeds 16 MiB".into());
        }
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(err)?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .compression_level(Some(6))
            .last_modified_time(zip::DateTime::default())
            .unix_permissions(0o644);
        zip.start_file("project.json", options).map_err(err)?;
        zip.write_all(&document).map_err(err)?;
        let mut written = BTreeSet::new();
        let mut total = document.len() as u64;
        for asset in snapshot["project"]["assets"]
            .as_array()
            .ok_or("Missing assets")?
        {
            let name = text(asset, "relativePath")?;
            if !written.insert(name) {
                continue;
            }
            let id = text(asset, "id")?;
            let source = asset_paths
                .get(id)
                .ok_or_else(|| format!("Missing managed asset {id}"))?;
            if g_ann_package::file_digest(Path::new(source))? != text(asset, "sha256")? {
                return Err(format!("Managed asset {id} changed before save"));
            }
            zip.start_file(name, options).map_err(err)?;
            total = total
                .checked_add(copy_bounded(
                    File::open(source).map_err(err)?,
                    &mut zip,
                    MAX_ASSET,
                )?)
                .ok_or("Project size overflow")?;
            if total > MAX_PROJECT {
                return Err("Project expanded size limit".into());
            }
        }
        let file = zip.finish().map_err(err)?;
        if file.metadata().map_err(err)?.len() > MAX_PROJECT {
            return Err("Project archive exceeds 2 GiB".into());
        }
        file.sync_all().map_err(err)?;
        drop(file);
        fs::rename(&temp, path).map_err(err)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

#[cfg(test)]
pub fn persist_snapshot(snapshot: &Value, workspace: &Path) -> Result<(), String> {
    validate(snapshot)?;
    let root = workspace.join(project_id(snapshot)?);
    let _guard = lock(&root)?;
    persist_if_current(snapshot, workspace, &root)
}

fn merge_build_metadata(snapshot: &mut Value, latest: &Value) -> Result<(), String> {
    let revision = snapshot["project"]["currentRevision"]
        .as_u64()
        .ok_or("Missing revision")?
        .max(
            latest["project"]["currentRevision"]
                .as_u64()
                .ok_or("Missing latest revision")?,
        );
    let history = snapshot["project"]["buildHistory"]
        .as_array_mut()
        .ok_or("Missing build history")?;
    for entry in latest["project"]["buildHistory"]
        .as_array()
        .ok_or("Missing latest history")?
    {
        if let Some(existing) = history
            .iter()
            .find(|existing| existing["revision"] == entry["revision"])
        {
            if existing["digest"] != entry["digest"] {
                return Err("Conflicting project build history revision".into());
            }
        } else {
            history.push(entry.clone());
        }
    }
    history.sort_by_key(|entry| entry["revision"].as_u64().unwrap_or(0));
    snapshot["project"]["currentRevision"] = Value::from(revision);
    Ok(())
}

fn persist_if_current(snapshot: &Value, workspace: &Path, root: &Path) -> Result<(), String> {
    let mut document = snapshot.clone();
    if let Some(latest) = latest_snapshot(project_id(snapshot)?, workspace)? {
        if latest["generation"].as_u64() > snapshot["generation"].as_u64() {
            return Ok(());
        }
        merge_build_metadata(&mut document, &latest)?;
    }
    persist_locked(&document, root)
}

fn persist_locked(snapshot: &Value, root: &Path) -> Result<(), String> {
    let bytes = serde_json::to_vec(snapshot).map_err(err)?;
    let temp = unique(root, "recovery");
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(err)?;
        file.write_all(&bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        fs::rename(&temp, root.join("recovery.json")).map_err(err)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

pub fn commit_build_snapshot(
    snapshot: &Value,
    history_entry: Value,
    workspace: &Path,
) -> Result<bool, String> {
    validate(snapshot)?;
    let id = project_id(snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    let latest = latest_snapshot(id, workspace)?;
    let applies = latest.as_ref().is_none_or(|current| {
        current["generation"] == snapshot["generation"]
            && current["fingerprint"] == snapshot["fingerprint"]
    });
    let mut committed = if applies {
        snapshot.clone()
    } else {
        latest.ok_or("Missing newer project snapshot")?
    };
    if applies {
        if let Some(latest) = latest_snapshot(id, workspace)? {
            merge_build_metadata(&mut committed, &latest)?;
        }
    }
    let revision = history_entry["revision"]
        .as_u64()
        .ok_or("Build history missing revision")?;
    let history = committed["project"]["buildHistory"]
        .as_array_mut()
        .ok_or("Missing build history")?;
    if let Some(existing) = history
        .iter()
        .find(|entry| entry["revision"].as_u64() == Some(revision))
    {
        if existing["digest"] != history_entry["digest"] {
            return Err("Build revision already committed with another digest".into());
        }
    } else {
        history.push(history_entry);
    }
    if applies {
        committed["project"]["currentRevision"] = Value::from(revision);
    }
    persist_locked(&committed, &root)?;
    Ok(applies)
}

pub fn latest_snapshot(project_id: &str, workspace: &Path) -> Result<Option<Value>, String> {
    if !g_ann_package::valid_id(project_id, "") {
        return Err("Invalid project identity".into());
    }
    let path = workspace.join(project_id).join("recovery.json");
    if !path.is_file() {
        return Ok(None);
    }
    let file = File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > MAX_DOCUMENT {
        return Err("Recovery document exceeds 16 MiB".into());
    }
    let mut bytes = Vec::new();
    copy_bounded(file, &mut bytes, MAX_DOCUMENT)?;
    let snapshot: Value = serde_json::from_slice(&bytes).map_err(err)?;
    validate(&snapshot)?;
    if self::project_id(&snapshot)? != project_id {
        return Err("Recovery project identity mismatch".into());
    }
    Ok(Some(snapshot))
}

// Keep a durable, content-addressed recovery document before the user opens a
// divergent older archive. Its referenced managed assets remain in the project.
fn retain_recovery(snapshot: &Value, root: &Path) -> Result<(), String> {
    let bytes = serde_json::to_vec(snapshot).map_err(err)?;
    let history = root.join("recovery-history");
    fs::create_dir_all(&history).map_err(err)?;
    let metadata = fs::symlink_metadata(&history).map_err(err)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err("Invalid recovery history directory".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Recovery history cannot be a reparse point".into());
        }
    }
    let final_path = history.join(format!("{}.json", g_ann_package::sha256(&bytes)));
    if final_path.exists() {
        if fs::read(&final_path).map_err(err)? != bytes {
            return Err("Retained recovery document is corrupt".into());
        }
        return Ok(());
    }
    let temporary = unique(&history, "recovery-history");
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(err)?;
        file.write_all(&bytes).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        fs::hard_link(&temporary, &final_path).map_err(err)?;
        Ok(())
    })();
    let _ = fs::remove_file(&temporary);
    result
}

pub fn save(
    path: &Path,
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    workspace: &Path,
) -> Result<ProjectSaveResult, String> {
    if path
        .extension()
        .and_then(|x| x.to_str())
        .is_none_or(|x| !x.eq_ignore_ascii_case("ann"))
    {
        return Err("Choose an .ann project destination".into());
    }
    validate(&snapshot)?;
    let root = workspace.join(project_id(&snapshot)?);
    let _guard = lock(&root)?;
    if let Some(latest) = latest_snapshot(project_id(&snapshot)?, workspace)? {
        if latest["generation"].as_u64() > snapshot["generation"].as_u64() {
            return Err(
                "Project changed while the save was pending; save the current project again".into(),
            );
        }
    }
    let prepared = prepare_locked(snapshot, asset_paths, &root)?;
    // Recovery is committed first, so a failed destination write still retains this snapshot.
    persist_if_current(&prepared.snapshot, workspace, &root)?;
    archive_bytes(path, &prepared.snapshot, &prepared.asset_paths)?;
    Ok(ProjectSaveResult {
        snapshot: prepared.snapshot,
        asset_paths: prepared.asset_paths,
        path: path.to_string_lossy().into_owned(),
    })
}

pub fn open(path: &Path, workspace: &Path) -> Result<ProjectOpenResult, String> {
    let file = File::open(path).map_err(err)?;
    if file.metadata().map_err(err)?.len() > MAX_PROJECT {
        return Err("Project archive exceeds 2 GiB".into());
    }
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|_| "Invalid .ann archive; use Import Old Project for .ann v1 JSON".to_string())?;
    if archive.len() > MAX_ASSETS + 1 {
        return Err("Project asset count limit".into());
    }
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    let mut document = None;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(err)?;
        let name = entry.name().to_owned();
        if !names.insert(name.to_ascii_lowercase())
            || entry.is_dir()
            || entry.is_symlink()
            || (name != "project.json" && !asset_name(&name))
        {
            return Err("Unsafe or duplicate project archive entry".into());
        }
        let limit = if name == "project.json" {
            MAX_DOCUMENT
        } else {
            MAX_ASSET
        };
        if entry.size() > limit {
            return Err("Project entry size limit".into());
        }
        total = total
            .checked_add(entry.size())
            .ok_or("Project size overflow")?;
        if total > MAX_PROJECT {
            return Err("Project expanded size limit".into());
        }
        if name == "project.json" {
            let mut bytes = vec![];
            copy_bounded(&mut entry, &mut bytes, MAX_DOCUMENT)?;
            document = Some(serde_json::from_slice::<Value>(&bytes).map_err(err)?);
        }
    }
    let snapshot = document.ok_or("Missing project.json")?;
    validate(&snapshot)?;
    if snapshot["fingerprint"].as_str() != Some(project_fingerprint(&snapshot)?.as_str()) {
        return Err("Project fingerprint mismatch".into());
    }
    let root = workspace.join(project_id(&snapshot)?);
    let _guard = lock(&root)?;
    let asset_root = root.join("assets");
    fs::create_dir_all(&asset_root).map_err(err)?;
    let mut paths = BTreeMap::new();
    let mut expected = BTreeSet::from(["project.json".to_owned()]);
    for asset in snapshot["project"]["assets"]
        .as_array()
        .ok_or("Missing assets")?
    {
        let id = text(asset, "id")?;
        let name = text(asset, "relativePath")?;
        expected.insert(name.to_ascii_lowercase());
        let hash = text(asset, "sha256")?;
        if hash.len() != 64 || Path::new(name).file_stem().is_none_or(|stem| stem != hash) {
            return Err(format!("Invalid content-addressed asset {id}"));
        }
        let mut entry = archive
            .by_name(name)
            .map_err(|_| format!("Missing asset {id}"))?;
        let temp = unique(&asset_root, "open");
        let result = (|| {
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp)
                .map_err(err)?;
            copy_bounded(&mut entry, &mut output, MAX_ASSET)?;
            output.sync_all().map_err(err)?;
            drop(output);
            if g_ann_package::file_digest(&temp)? != hash {
                return Err(format!(
                    "Corrupt asset {id}: repair from the original source"
                ));
            }
            let target = root.join(name);
            if target.exists() {
                if g_ann_package::file_digest(&target)? != hash {
                    return Err(format!("Managed asset {id} is corrupt"));
                }
                fs::remove_file(&temp).map_err(err)?;
            } else {
                fs::rename(&temp, &target).map_err(err)?;
            }
            paths.insert(id.to_owned(), target.to_string_lossy().into_owned());
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result?;
    }
    if expected != names {
        return Err("Unindexed project archive payload".into());
    }
    if let Some(latest) = latest_snapshot(project_id(&snapshot)?, workspace)? {
        if latest["generation"].as_u64() >= snapshot["generation"].as_u64()
            && project_fingerprint(&latest)? != project_fingerprint(&snapshot)?
        {
            retain_recovery(&latest, &root)?;
        }
    }
    Ok(ProjectOpenResult {
        snapshot,
        asset_paths: paths,
    })
}

pub fn recover(project_id: &str, workspace: &Path) -> Result<Vec<RecoveryCandidate>, String> {
    if !g_ann_package::valid_id(project_id, "") {
        return Err("Invalid project identity".into());
    }
    let Some(snapshot) = latest_snapshot(project_id, workspace)? else {
        return Ok(vec![]);
    };
    let root = workspace.join(project_id);
    let paths = snapshot["project"]["assets"]
        .as_array()
        .ok_or("Missing assets")?
        .iter()
        .map(|asset| {
            Ok((
                text(asset, "id")?.to_owned(),
                root.join(text(asset, "relativePath")?)
                    .to_string_lossy()
                    .into_owned(),
            ))
        })
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    let path = root.join("recovery.ann");
    archive_bytes(&path, &snapshot, &paths)?;
    let recovered = open(&path, workspace)?;
    let mut candidates = vec![RecoveryCandidate {
        project_id: project_id.into(),
        path: path.to_string_lossy().into_owned(),
        generation: recovered.snapshot["generation"]
            .as_u64()
            .ok_or("Missing generation")?,
    }];
    let history = root.join("recovery-history");
    if history.is_dir() {
        let metadata = fs::symlink_metadata(&history).map_err(err)?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return Err("Invalid recovery history directory".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("Recovery history cannot be a reparse point".into());
            }
        }
        for entry in fs::read_dir(&history).map_err(err)? {
            let entry = entry.map_err(err)?;
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("json") {
                continue;
            }
            let metadata = fs::symlink_metadata(&path).map_err(err)?;
            if !metadata.is_file()
                || metadata.file_type().is_symlink()
                || metadata.len() > MAX_DOCUMENT
            {
                return Err("Invalid retained recovery document".into());
            }
            let bytes = fs::read(&path).map_err(err)?;
            if path.file_stem().and_then(|value| value.to_str())
                != Some(g_ann_package::sha256(&bytes).as_str())
            {
                return Err("Retained recovery digest mismatch".into());
            }
            let retained: Value = serde_json::from_slice(&bytes).map_err(err)?;
            validate(&retained)?;
            if self::project_id(&retained)? != project_id {
                return Err("Retained recovery project identity mismatch".into());
            }
            let paths = retained["project"]["assets"]
                .as_array()
                .ok_or("Missing assets")?
                .iter()
                .map(|asset| {
                    Ok((
                        text(asset, "id")?.to_owned(),
                        root.join(text(asset, "relativePath")?)
                            .to_string_lossy()
                            .into_owned(),
                    ))
                })
                .collect::<Result<BTreeMap<_, _>, String>>()?;
            let archive = path.with_extension("ann");
            if !archive.exists() {
                archive_bytes(&archive, &retained, &paths)?;
            }
            candidates.push(RecoveryCandidate {
                project_id: project_id.into(),
                path: archive.to_string_lossy().into_owned(),
                generation: retained["generation"]
                    .as_u64()
                    .ok_or("Missing generation")?,
            });
        }
    }
    Ok(candidates)
}

#[cfg(test)]
#[path = "project_io_tests.rs"]
mod tests;
