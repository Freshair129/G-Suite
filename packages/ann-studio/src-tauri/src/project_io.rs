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
const MAX_RECOVERY_DIRECTORY_ENTRIES: usize = 4096;
const DESTINATION_CONFLICT_PREFIX: &str = "DESTINATION_CONFLICT:";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOpenResult {
    pub snapshot: Value,
    pub asset_paths: BTreeMap<String, String>,
    pub session_token: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSaveResult {
    pub snapshot: Value,
    pub asset_paths: BTreeMap<String, String>,
    pub path: String,
    pub session_token: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCandidate {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub name: String,
    pub generation: u64,
    pub fingerprint: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryWarning {
    pub id: Option<String>,
    pub message: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryListing {
    pub candidates: Vec<RecoveryCandidate>,
    pub warnings: Vec<RecoveryWarning>,
    pub truncated: bool,
}

const MAX_RECOVERY_CANDIDATES: usize = 128;
const MAX_RECOVERY_LIST_BYTES: u64 = 128 * 1024 * 1024;
const MAX_SAFE_GENERATION: u64 = 9_007_199_254_740_991;

fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn new_session_token() -> String {
    static N: AtomicU64 = AtomicU64::new(0);
    let ticks = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    g_ann_package::sha256(
        format!(
            "{}:{ticks}:{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        )
        .as_bytes(),
    )
}
fn valid_session_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
}
fn active_session_token(snapshot: &Value) -> Option<&str> {
    snapshot["sessionToken"]
        .as_str()
        .filter(|token| valid_session_token(token))
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
    let generation = snapshot["generation"]
        .as_u64()
        .ok_or("Invalid project generation")?;
    if generation > MAX_SAFE_GENERATION {
        return Err("Project generation exceeds the JavaScript safe-integer limit".into());
    }
    if project["schemaVersion"] != 2
        || !g_ann_package::valid_id(text(project, "announcerId")?, "ann_")
        || project["currentRevision"].as_u64().is_none()
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

fn destination_lock(path: &Path, workspace: &Path) -> Result<File, String> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or("Project destination requires a folder")?;
    let name = path.file_name().ok_or("Project destination has no name")?;
    fs::create_dir_all(parent).map_err(err)?;
    let parent = fs::canonicalize(parent).map_err(err)?;
    let mut identity = format!(
        "{}{}{}",
        parent.display(),
        std::path::MAIN_SEPARATOR,
        name.to_string_lossy()
    );
    if cfg!(windows) {
        identity = identity.to_lowercase();
    }
    let digest = g_ann_package::sha256(identity.as_bytes());
    let lock_root = workspace.join("destination-locks");
    fs::create_dir_all(&lock_root).map_err(err)?;
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(false)
        .open(lock_root.join(format!("{digest}.lock")))
        .map_err(err)?;
    file.try_lock()
        .map_err(|_| "Project destination is locked by another save".to_string())?;
    Ok(file)
}

enum DestinationInspection {
    Missing,
    Project {
        project_id: String,
        announcer_id: String,
    },
    Unreadable,
}

fn digest_bounded(mut input: impl Read, limit: u64) -> Result<(u64, String), String> {
    use sha2::{Digest, Sha256};

    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let count = input.read(&mut buffer).map_err(err)?;
        if count == 0 {
            break;
        }
        total = total
            .checked_add(count as u64)
            .ok_or("Project size overflow")?;
        if total > limit {
            return Err("Project expanded/asset size limit".into());
        }
        hasher.update(&buffer[..count]);
    }
    Ok((total, format!("{:x}", hasher.finalize())))
}

fn validate_project_archive(archive: &mut zip::ZipArchive<File>) -> Result<Value, String> {
    if archive.len() > MAX_ASSETS + 1 {
        return Err("Project asset count limit".into());
    }

    let mut names = BTreeSet::new();
    let mut declared_total = 0u64;
    for index in 0..archive.len() {
        let entry = archive.by_index(index).map_err(err)?;
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
        declared_total = declared_total
            .checked_add(entry.size())
            .ok_or("Project size overflow")?;
        if declared_total > MAX_PROJECT {
            return Err("Project expanded size limit".into());
        }
    }

    let mut document = Vec::new();
    copy_bounded(
        archive.by_name("project.json").map_err(err)?,
        &mut document,
        MAX_DOCUMENT,
    )?;
    let mut snapshot: Value = serde_json::from_slice(&document).map_err(err)?;
    validate(&snapshot)?;
    if snapshot["fingerprint"].as_str() != Some(project_fingerprint(&snapshot)?.as_str()) {
        return Err("Project fingerprint mismatch".into());
    }

    let mut expected = BTreeSet::from(["project.json".to_owned()]);
    let mut actual_total = document.len() as u64;
    for asset in snapshot["project"]["assets"]
        .as_array()
        .ok_or("Missing assets")?
    {
        let id = text(asset, "id")?;
        let name = text(asset, "relativePath")?;
        let hash = text(asset, "sha256")?;
        if hash.len() != 64 || Path::new(name).file_stem().is_none_or(|stem| stem != hash) {
            return Err(format!("Invalid content-addressed asset {id}"));
        }
        expected.insert(name.to_ascii_lowercase());
        let entry = archive
            .by_name(name)
            .map_err(|_| format!("Missing asset {id}"))?;
        let (size, actual_hash) = digest_bounded(entry, MAX_ASSET)
            .map_err(|_| format!("Corrupt or unreadable asset {id}"))?;
        actual_total = actual_total
            .checked_add(size)
            .ok_or("Project size overflow")?;
        if actual_total > MAX_PROJECT {
            return Err("Project expanded size limit".into());
        }
        if actual_hash != hash {
            return Err(format!(
                "Corrupt asset {id}: repair from the original source"
            ));
        }
    }
    if expected != names {
        return Err("Unindexed project archive payload".into());
    }
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("sessionToken");
    }
    Ok(snapshot)
}

fn inspect_destination(path: &Path) -> Result<DestinationInspection, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DestinationInspection::Missing)
        }
        Err(error) => return Err(err(error)),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("Project destination must be a regular file".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("Project destination cannot be a reparse point".into());
        }
    }

    let identity = (|| -> Result<(String, String), String> {
        let mut archive =
            zip::ZipArchive::new(open_regular_file(path, MAX_PROJECT)?).map_err(err)?;
        let snapshot = validate_project_archive(&mut archive)?;
        Ok((
            project_id(&snapshot)?.to_owned(),
            text(&snapshot["project"], "announcerId")?.to_owned(),
        ))
    })();
    Ok(match identity {
        Ok((project_id, announcer_id)) => DestinationInspection::Project {
            project_id,
            announcer_id,
        },
        Err(_) => DestinationInspection::Unreadable,
    })
}

fn destination_digest(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let mut file = open_regular_file(path, MAX_PROJECT)?;
    let mut hasher = Sha256::new();
    let mut total = 0u64;
    let mut buffer = [0u8; 65536];
    loop {
        let count = file.read(&mut buffer).map_err(err)?;
        if count == 0 {
            break;
        }
        total = total
            .checked_add(count as u64)
            .ok_or("Project destination size overflow")?;
        if total > MAX_PROJECT {
            return Err("Project destination exceeds the 2 GiB limit".into());
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn check_destination_conflict(
    path: &Path,
    snapshot: &Value,
    confirmed_digest: Option<&str>,
) -> Result<(), String> {
    if confirmed_digest.is_some_and(|digest| {
        digest.len() != 64 || !digest.bytes().all(|byte| byte.is_ascii_hexdigit())
    }) {
        return Err("Invalid destination overwrite confirmation".into());
    }
    let same_project = match inspect_destination(path)? {
        DestinationInspection::Missing => return Ok(()),
        DestinationInspection::Project {
            project_id: existing_project_id,
            announcer_id: existing_announcer_id,
        } => {
            existing_project_id == project_id(snapshot)?
                && existing_announcer_id == text(&snapshot["project"], "announcerId")?
        }
        DestinationInspection::Unreadable => false,
    };
    if same_project && confirmed_digest.is_none() {
        return Ok(());
    }
    let current_digest = destination_digest(path)?;
    if confirmed_digest == Some(current_digest.as_str()) {
        return Ok(());
    }
    Err(format!("{DESTINATION_CONFLICT_PREFIX}{current_digest}"))
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
    merge_latest: bool,
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
    if merge_latest {
        if let Some(latest) = latest_snapshot(
            project_id(&snapshot)?,
            root.parent().ok_or("Project workspace root")?,
        )? {
            merge_build_metadata(&mut snapshot, &latest)?;
        }
    }
    validate(&snapshot)?;
    Ok(ProjectOpenResult {
        snapshot,
        asset_paths: paths,
        session_token: None,
    })
}

pub fn prepare_with_session(
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    session_token: Option<String>,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    validate(&snapshot)?;
    let id = project_id(&snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    let latest = latest_snapshot(id, workspace)?.ok_or("Project session is no longer active")?;
    let current = active_session_token(&latest).ok_or("Project session is not active")?;
    if session_token.as_deref() != Some(current) {
        return Err("Project session was replaced; reopen the current project".into());
    }
    let current_generation = latest["generation"]
        .as_u64()
        .ok_or("Invalid recovery generation")?;
    let incoming_generation = snapshot["generation"]
        .as_u64()
        .ok_or("Invalid project generation")?;
    if incoming_generation < current_generation {
        return Err(
            "Project changed while the save was pending; save the current project again".into(),
        );
    }
    let session_token = current.to_owned();
    let prepared = prepare_locked(snapshot, asset_paths, &root, true)?;
    persist_session_locked(&prepared.snapshot, &session_token, &root)?;
    Ok(ProjectOpenResult {
        snapshot: prepared.snapshot,
        asset_paths: prepared.asset_paths,
        session_token: Some(session_token),
    })
}

#[cfg(test)]
pub fn prepare(
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    let id = project_id(&snapshot)?;
    let token = latest_snapshot(id, workspace)?
        .and_then(|latest| active_session_token(&latest).map(str::to_owned));
    if token.is_none() {
        let root = workspace.join(id);
        let _guard = lock(&root)?;
        let session_token = new_session_token();
        let prepared = prepare_locked(snapshot, asset_paths, &root, true)?;
        persist_session_locked(&prepared.snapshot, &session_token, &root)?;
        return Ok(ProjectOpenResult {
            snapshot: prepared.snapshot,
            asset_paths: prepared.asset_paths,
            session_token: Some(session_token),
        });
    }
    prepare_with_session(snapshot, asset_paths, token, workspace)
}

fn prepare_if_current(
    mut snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    expected_generation: u64,
    expected_baseline_fingerprint: &str,
    session_token: &str,
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
        if active_session_token(&latest) != Some(session_token) {
            return Err("Project session was replaced; reopen the current project".into());
        }
        let latest_generation = latest["generation"]
            .as_u64()
            .ok_or("Invalid recovery generation")?;
        if latest_generation > expected_generation
            || (latest_generation == expected_generation
                && project_fingerprint(&latest)? != expected_baseline_fingerprint)
        {
            return Err("Project changed while the banner import was pending".into());
        }
    } else {
        return Err("Project session is no longer active".into());
    }
    // Import changes the document. Advance its generation under the same lock as
    // the recovery comparison and commit, so earlier pending snapshots cannot
    // overwrite this import or be accepted as the current build.
    let generation = expected_generation
        .checked_add(1)
        .filter(|value| *value <= MAX_SAFE_GENERATION)
        .ok_or("Project generation limit reached")?;
    snapshot["generation"] = Value::from(generation);
    let prepared = prepare_locked(snapshot, asset_paths, &root, true)?;
    persist_session_locked(&prepared.snapshot, session_token, &root)?;
    Ok(ProjectOpenResult {
        snapshot: prepared.snapshot,
        asset_paths: prepared.asset_paths,
        session_token: Some(session_token.to_owned()),
    })
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

fn open_regular_file(path: &Path, limit: u64) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x0020_0000); // FILE_FLAG_OPEN_REPARSE_POINT
    }
    #[cfg(not(windows))]
    if fs::symlink_metadata(path)
        .map_err(err)?
        .file_type()
        .is_symlink()
    {
        return Err("File cannot be a symbolic link".into());
    }
    let file = options.open(path).map_err(err)?;
    let metadata = file.metadata().map_err(err)?;
    if !metadata.is_file() || metadata.len() > limit {
        return Err("Invalid file or size".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err("File cannot be a reparse point".into());
        }
    }
    Ok(file)
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

pub fn import_banner_asset_archive_with_session(
    path: &Path,
    manifest_sha256: &str,
    variant_id: &str,
    expected_generation: u64,
    session_token: &str,
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
        session_token,
        workspace,
    )
}

#[cfg(test)]
pub fn import_banner_asset_archive(
    path: &Path,
    manifest_sha256: &str,
    variant_id: &str,
    expected_generation: u64,
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    let token = latest_snapshot(project_id(&snapshot)?, workspace)?
        .and_then(|latest| active_session_token(&latest).map(str::to_owned))
        .ok_or("Project session is not active")?;
    import_banner_asset_archive_with_session(
        path,
        manifest_sha256,
        variant_id,
        expected_generation,
        &token,
        snapshot,
        asset_paths,
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
        let mut portable = snapshot.clone();
        if let Some(object) = portable.as_object_mut() {
            object.remove("sessionToken");
        }
        let document = serde_json::to_vec(&portable).map_err(err)?;
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
    let id = project_id(snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    let token = latest_snapshot(id, workspace)?
        .and_then(|latest| active_session_token(&latest).map(str::to_owned))
        .ok_or("Project session is not active")?;
    persist_session_locked(snapshot, &token, &root)
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

fn persist_session_locked(
    snapshot: &Value,
    session_token: &str,
    root: &Path,
) -> Result<(), String> {
    if !valid_session_token(session_token) {
        return Err("Invalid project session token".into());
    }
    let mut document = snapshot.clone();
    document["sessionToken"] = Value::from(session_token);
    persist_locked(&document, root)
}

fn retain_active_recovery(root: &Path, next: &[u8]) -> Result<(), String> {
    let active = root.join("recovery.json");
    match fs::symlink_metadata(&active) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err("Active recovery cannot be a symbolic link".into());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(err(error)),
    }
    let mut prior = Vec::new();
    copy_bounded(
        open_regular_file(&active, MAX_DOCUMENT)?,
        &mut prior,
        MAX_DOCUMENT,
    )?;
    if prior == next {
        return Ok(());
    }
    if let (Ok(previous), Ok(next_snapshot)) = (
        serde_json::from_slice::<Value>(&prior),
        serde_json::from_slice::<Value>(next),
    ) {
        if previous["generation"] == next_snapshot["generation"]
            && previous.get("fingerprint") == next_snapshot.get("fingerprint")
        {
            return Ok(());
        }
    }
    let history = root.join("recovery-history");
    if !history.exists() {
        fs::create_dir(&history).map_err(err)?;
    }
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
    let digest = g_ann_package::sha256(&prior);
    let destination = history.join(format!("{digest}.json"));
    if destination.exists() {
        let mut existing = Vec::new();
        copy_bounded(
            open_regular_file(&destination, MAX_DOCUMENT)?,
            &mut existing,
            MAX_DOCUMENT,
        )?;
        if existing != prior {
            return Err("Recovery history digest collision".into());
        }
        return Ok(());
    }
    let temp = unique(&history, "history");
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temp)
            .map_err(err)?;
        file.write_all(&prior).map_err(err)?;
        file.sync_all().map_err(err)?;
        drop(file);
        fs::rename(&temp, &destination).map_err(err)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn persist_locked(snapshot: &Value, root: &Path) -> Result<(), String> {
    let bytes = serde_json::to_vec(snapshot).map_err(err)?;
    if bytes.len() as u64 > MAX_DOCUMENT {
        return Err("Project document exceeds 16 MiB".into());
    }
    retain_active_recovery(root, &bytes)?;
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

pub fn commit_build_snapshot_with_session(
    snapshot: &Value,
    session_token: &str,
    history_entry: Value,
    workspace: &Path,
) -> Result<bool, String> {
    validate(snapshot)?;
    if !valid_session_token(session_token) {
        return Err("Invalid project session token".into());
    }
    let id = project_id(snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    let latest = latest_snapshot(id, workspace)?;
    if latest.as_ref().and_then(active_session_token) != Some(session_token) {
        return Ok(false);
    }
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
    persist_session_locked(&committed, session_token, &root)?;
    Ok(applies)
}

#[cfg(test)]
pub fn commit_build_snapshot(
    snapshot: &Value,
    history_entry: Value,
    workspace: &Path,
) -> Result<bool, String> {
    let token = latest_snapshot(project_id(snapshot)?, workspace)?
        .and_then(|latest| active_session_token(&latest).map(str::to_owned))
        .ok_or("Project session is not active")?;
    commit_build_snapshot_with_session(snapshot, &token, history_entry, workspace)
}

pub fn latest_snapshot(project_id: &str, workspace: &Path) -> Result<Option<Value>, String> {
    if !g_ann_package::valid_id(project_id, "") {
        return Err("Invalid project identity".into());
    }
    let path = workspace.join(project_id).join("recovery.json");
    let file = match open_regular_file(&path, MAX_DOCUMENT) {
        Ok(file) => file,
        Err(error) => match fs::symlink_metadata(&path) {
            Err(metadata_error) if metadata_error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(None)
            }
            _ => return Err(error),
        },
    };
    let mut bytes = Vec::new();
    copy_bounded(file, &mut bytes, MAX_DOCUMENT)?;
    let snapshot: Value = serde_json::from_slice(&bytes).map_err(err)?;
    validate(&snapshot)?;
    if snapshot.get("sessionToken").is_some() && active_session_token(&snapshot).is_none() {
        return Err("Recovery session token is invalid".into());
    }
    if self::project_id(&snapshot)? != project_id {
        return Err("Recovery project identity mismatch".into());
    }
    Ok(Some(snapshot))
}

pub fn session_is_active(
    snapshot: &Value,
    session_token: &str,
    workspace: &Path,
) -> Result<bool, String> {
    if !valid_session_token(session_token) {
        return Ok(false);
    }
    let id = project_id(snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    Ok(latest_snapshot(id, workspace)?
        .as_ref()
        .and_then(active_session_token)
        == Some(session_token))
}

fn history_directory(root: &Path) -> Result<Option<PathBuf>, String> {
    let history = root.join("recovery-history");
    let metadata = match fs::symlink_metadata(&history) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(err(error)),
    };
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
    Ok(Some(history))
}

fn recovery_candidate_from_bytes(
    project_id: &str,
    kind: &str,
    bytes: &[u8],
    expected_digest: Option<&str>,
) -> Result<RecoveryCandidate, String> {
    let digest = g_ann_package::sha256(bytes);
    if expected_digest.is_some_and(|expected| expected != digest) {
        return Err("Recovery candidate digest mismatch".into());
    }
    let snapshot: Value = serde_json::from_slice(bytes).map_err(err)?;
    validate(&snapshot)?;
    let fingerprint = project_fingerprint(&snapshot)?;
    if self::project_id(&snapshot)? != project_id
        || snapshot["fingerprint"].as_str() != Some(fingerprint.as_str())
    {
        return Err("Recovery identity or fingerprint mismatch".into());
    }
    Ok(RecoveryCandidate {
        id: digest,
        project_id: project_id.to_owned(),
        kind: kind.to_owned(),
        name: text(&snapshot["project"], "name")?.to_owned(),
        generation: snapshot["generation"]
            .as_u64()
            .ok_or("Missing generation")?,
        fingerprint,
    })
}

fn add_recovery_file(
    project_id: &str,
    path: &Path,
    kind: &str,
    expected: Option<&str>,
    listing: &mut RecoveryListing,
    scanned: &mut usize,
    bytes_read: &mut u64,
) {
    if *scanned >= MAX_RECOVERY_CANDIDATES || *bytes_read >= MAX_RECOVERY_LIST_BYTES {
        listing.truncated = true;
        return;
    }
    *scanned += 1;
    let mut document = Vec::new();
    let read_result = open_regular_file(path, MAX_DOCUMENT).and_then(|file| {
        let size = file.metadata().map_err(err)?.len();
        let remaining = MAX_RECOVERY_LIST_BYTES.saturating_sub(*bytes_read);
        if size > remaining {
            return Err("Recovery listing reached its metadata byte limit".into());
        }
        copy_bounded(file.take(size), &mut document, size).and_then(|count| {
            (count == size)
                .then_some(count)
                .ok_or_else(|| "Recovery candidate changed while listing".to_owned())
        })
    });
    match read_result {
        Ok(count) => {
            *bytes_read += count;
            match recovery_candidate_from_bytes(project_id, kind, &document, expected) {
                Ok(candidate) => listing.candidates.push(candidate),
                Err(error) => listing.warnings.push(RecoveryWarning {
                    id: expected
                        .map(str::to_owned)
                        .or_else(|| Some(g_ann_package::sha256(&document))),
                    message: error,
                }),
            }
        }
        Err(error) => {
            if error == "Recovery listing reached its metadata byte limit" {
                listing.truncated = true;
            }
            listing.warnings.push(RecoveryWarning {
                id: expected.map(str::to_owned),
                message: error,
            });
        }
    }
}

fn recovery_listing_locked(project_id: &str, workspace: &Path) -> Result<RecoveryListing, String> {
    let root = workspace.join(project_id);
    let mut listing = RecoveryListing {
        candidates: Vec::new(),
        warnings: Vec::new(),
        truncated: false,
    };
    let mut scanned = 0usize;
    let mut bytes_read = 0u64;

    let active = root.join("recovery.json");
    match fs::symlink_metadata(&active) {
        Ok(_) => add_recovery_file(
            project_id,
            &active,
            "active",
            None,
            &mut listing,
            &mut scanned,
            &mut bytes_read,
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => listing.warnings.push(RecoveryWarning {
            id: None,
            message: err(error),
        }),
    }
    match history_directory(&root) {
        Ok(Some(history)) => {
            let mut entries = Vec::new();
            let mut directory_truncated = false;
            match fs::read_dir(&history) {
                Ok(read_dir) => {
                    for entry in read_dir {
                        if entries.len() >= MAX_RECOVERY_DIRECTORY_ENTRIES {
                            directory_truncated = true;
                            break;
                        }
                        match entry {
                            Ok(entry) => entries.push(entry.path()),
                            Err(error) => listing.warnings.push(RecoveryWarning {
                                id: None,
                                message: err(error),
                            }),
                        }
                    }
                }
                Err(error) => listing.warnings.push(RecoveryWarning {
                    id: None,
                    message: err(error),
                }),
            }
            if directory_truncated {
                listing.truncated = true;
                entries.clear();
                listing.warnings.push(RecoveryWarning {
                    id: None,
                    message: "Recovery history has too many entries for a deterministic listing; active recovery remains available".into(),
                });
            }
            entries.sort_by(|left: &PathBuf, right: &PathBuf| {
                left.file_name().cmp(&right.file_name())
            });
            for path in entries {
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                if scanned >= MAX_RECOVERY_CANDIDATES {
                    listing.truncated = true;
                    break;
                }
                let digest = path
                    .file_stem()
                    .and_then(|value| value.to_str())
                    .unwrap_or("");
                if !valid_session_token(digest) {
                    listing.warnings.push(RecoveryWarning {
                        id: None,
                        message: "Ignoring recovery history entry with an invalid identity".into(),
                    });
                    continue;
                }
                add_recovery_file(
                    project_id,
                    &path,
                    "history",
                    Some(digest),
                    &mut listing,
                    &mut scanned,
                    &mut bytes_read,
                );
                if listing.truncated && bytes_read >= MAX_RECOVERY_LIST_BYTES {
                    break;
                }
            }
        }
        Ok(None) => {}
        Err(error) => listing.warnings.push(RecoveryWarning {
            id: None,
            message: error,
        }),
    }
    listing.candidates.sort_by(|left, right| {
        right
            .generation
            .cmp(&left.generation)
            .then_with(|| left.id.cmp(&right.id))
            .then_with(|| left.kind.cmp(&right.kind))
    });
    if listing.truncated {
        listing.warnings.push(RecoveryWarning {
            id: None,
            message: "Recovery listing is partial; some retained candidates were not scanned"
                .into(),
        });
    }
    Ok(listing)
}

pub fn list_recovery_candidates(
    project_id: &str,
    workspace: &Path,
) -> Result<RecoveryListing, String> {
    if !g_ann_package::valid_id(project_id, "") {
        return Err("Invalid project identity".into());
    }
    let root = workspace.join(project_id);
    let _guard = lock(&root)?;
    recovery_listing_locked(project_id, workspace)
}

fn open_recovery_document(
    project_id: &str,
    document: &[u8],
    root: &Path,
) -> Result<ProjectOpenResult, String> {
    use sha2::{Digest, Sha256};
    let mut snapshot: Value = serde_json::from_slice(document).map_err(err)?;
    validate(&snapshot)?;
    let fingerprint = project_fingerprint(&snapshot)?;
    if self::project_id(&snapshot)? != project_id
        || snapshot["fingerprint"].as_str() != Some(fingerprint.as_str())
    {
        return Err("Recovery identity or fingerprint mismatch".into());
    }
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("sessionToken");
    }
    let mut paths = BTreeMap::new();
    let mut seen = BTreeMap::<String, (String, String)>::new();
    let mut total_assets = 0u64;
    for asset in snapshot["project"]["assets"]
        .as_array()
        .ok_or("Missing assets")?
    {
        let name = text(asset, "relativePath")?;
        let expected_hash = text(asset, "sha256")?;
        let path = root.join(name);
        let key = name.to_ascii_lowercase();
        if let Some((previous_name, previous_hash)) = seen.get(&key) {
            if previous_name != name || previous_hash != expected_hash {
                return Err("Conflicting recovery asset aliases".into());
            }
            paths.insert(
                text(asset, "id")?.to_owned(),
                path.to_string_lossy().into_owned(),
            );
            continue;
        }
        let mut file = open_regular_file(&path, MAX_ASSET)?;
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        let mut buffer = [0u8; 65536];
        loop {
            let count = file.read(&mut buffer).map_err(err)?;
            if count == 0 {
                break;
            }
            total = total
                .checked_add(count as u64)
                .ok_or("Asset size overflow")?;
            if total > MAX_ASSET {
                return Err("Recovery asset exceeds size limit".into());
            }
            total_assets = total_assets
                .checked_add(count as u64)
                .ok_or("Recovery size overflow")?;
            if total_assets > MAX_PROJECT {
                return Err("Recovery assets exceed total size limit".into());
            }
            hasher.update(&buffer[..count]);
        }
        if format!("{:x}", hasher.finalize()) != expected_hash {
            return Err("Recovery asset digest mismatch".into());
        }
        seen.insert(key, (name.to_owned(), expected_hash.to_owned()));
        paths.insert(
            text(asset, "id")?.to_owned(),
            path.to_string_lossy().into_owned(),
        );
    }
    Ok(ProjectOpenResult {
        snapshot,
        asset_paths: paths,
        session_token: None,
    })
}

// Listing reads bounded metadata only. Materialize managed assets only after a
// user selects one stable digest ID.
//
// SECURITY BOUNDARY: Tauri commands pass `<app_local_data_dir>/projects`; the
// renderer cannot choose this workspace. Leaf files and the history directory
// reject reparse points, but same-user tampering that swaps an intermediate
// directory is outside the app-owned-data threat model. If this workspace ever
// becomes user-selected or shared, replace these paths with handle-relative IO.
pub fn open_recovery_candidate(
    project_id: &str,
    digest: &str,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    if !g_ann_package::valid_id(project_id, "") || !valid_session_token(digest) {
        return Err("Invalid recovery candidate identity".into());
    }
    let root = workspace.join(project_id);
    let _guard = lock(&root)?;
    let candidates = recovery_listing_locked(project_id, workspace)?;
    if candidates.truncated
        && !candidates
            .candidates
            .iter()
            .any(|candidate| candidate.id == digest)
    {
        return Err("Recovery listing is partial; refresh and select a listed candidate".into());
    }
    if !candidates
        .candidates
        .iter()
        .any(|candidate| candidate.id == digest)
    {
        return Err("Recovery candidate is no longer available".into());
    }
    let active = root.join("recovery.json");
    let history = history_directory(&root).ok().flatten();
    let mut document = Vec::new();
    let active_bytes = match open_regular_file(&active, MAX_DOCUMENT) {
        Ok(file) => {
            let mut bytes = Vec::new();
            if copy_bounded(file, &mut bytes, MAX_DOCUMENT).is_ok()
                && g_ann_package::sha256(&bytes) == digest
            {
                Some(bytes)
            } else {
                None
            }
        }
        Err(_) => None,
    };
    if let Some(bytes) = active_bytes {
        document = bytes;
    } else {
        let path = history
            .ok_or("Recovery candidate is no longer available")?
            .join(format!("{digest}.json"));
        copy_bounded(
            open_regular_file(&path, MAX_DOCUMENT)?,
            &mut document,
            MAX_DOCUMENT,
        )?;
        if g_ann_package::sha256(&document) != digest {
            return Err("Recovery candidate changed after listing".into());
        }
    }
    open_recovery_document(project_id, &document, &root)
}

pub fn activate_project_session(
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    expected_session_token: Option<String>,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    validate(&snapshot)?;
    let id = project_id(&snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    let listing = recovery_listing_locked(id, workspace)?;
    if listing.truncated {
        return Err("Recovery history is too large to safely allocate a session generation".into());
    }
    let latest = match latest_snapshot(id, workspace) {
        Ok(latest) => latest,
        Err(_) => None,
    };
    if let Some(expected) = expected_session_token.as_deref() {
        if latest.as_ref().and_then(active_session_token) != Some(expected) {
            return Err("Project session changed while the archive was opening".into());
        }
    }
    if latest.as_ref().is_some_and(|current| {
        current["project"]["announcerId"] != snapshot["project"]["announcerId"]
    }) {
        return Err("Project announcer identity changed within the same project lineage".into());
    }
    let highest = listing
        .candidates
        .iter()
        .map(|candidate| candidate.generation)
        .chain(std::iter::once(
            snapshot["generation"]
                .as_u64()
                .ok_or("Invalid project generation")?,
        ))
        .max()
        .ok_or("Missing project generation")?;
    let generation = highest
        .checked_add(1)
        .filter(|value| *value <= MAX_SAFE_GENERATION)
        .ok_or("Project generation limit reached")?;
    let mut accepted = snapshot;
    accepted["generation"] = Value::from(generation);
    if let Some(latest) = latest.as_ref() {
        merge_build_metadata(&mut accepted, latest)?;
    }
    let session_token = new_session_token();
    let prepared = prepare_locked(accepted, asset_paths, &root, false)?;
    persist_session_locked(&prepared.snapshot, &session_token, &root)?;
    Ok(ProjectOpenResult {
        snapshot: prepared.snapshot,
        asset_paths: prepared.asset_paths,
        session_token: Some(session_token),
    })
}

#[cfg(test)]
pub fn open_retained_candidate(
    project_id: &str,
    digest: &str,
    workspace: &Path,
) -> Result<ProjectOpenResult, String> {
    let root = workspace.join(project_id);
    let _guard = lock(&root)?;
    let history = history_directory(&root)?.ok_or("Recovery history is missing")?;
    let path = history.join(format!("{digest}.json"));
    let mut document = Vec::new();
    copy_bounded(
        open_regular_file(&path, MAX_DOCUMENT)?,
        &mut document,
        MAX_DOCUMENT,
    )?;
    if g_ann_package::sha256(&document) != digest {
        return Err("Recovery candidate changed after listing".into());
    }
    open_recovery_document(project_id, &document, &root)
}

pub fn save_with_session_confirmed_destination(
    path: &Path,
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    session_token: &str,
    confirmed_destination_digest: Option<&str>,
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
    if !valid_session_token(session_token) {
        return Err("Invalid project session token".into());
    }
    let id = project_id(&snapshot)?;
    let root = workspace.join(id);
    let _guard = lock(&root)?;
    if let Some(latest) = latest_snapshot(project_id(&snapshot)?, workspace)? {
        if active_session_token(&latest) != Some(session_token) {
            return Err("Project session was replaced; reopen the current project".into());
        }
        if latest["generation"].as_u64() > snapshot["generation"].as_u64() {
            return Err(
                "Project changed while the save was pending; save the current project again".into(),
            );
        }
    } else {
        return Err("Project session is no longer active".into());
    }
    let prepared = prepare_locked(snapshot, asset_paths, &root, true)?;
    let _destination_guard = destination_lock(path, workspace)?;
    check_destination_conflict(path, &prepared.snapshot, confirmed_destination_digest)?;
    // Recovery is committed first, so a failed destination write still retains this snapshot.
    persist_session_locked(&prepared.snapshot, session_token, &root)?;
    archive_bytes(path, &prepared.snapshot, &prepared.asset_paths)?;
    Ok(ProjectSaveResult {
        snapshot: prepared.snapshot,
        asset_paths: prepared.asset_paths,
        path: path.to_string_lossy().into_owned(),
        session_token: session_token.to_owned(),
    })
}

pub fn save_with_session(
    path: &Path,
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    session_token: &str,
    workspace: &Path,
) -> Result<ProjectSaveResult, String> {
    save_with_session_confirmed_destination(
        path,
        snapshot,
        asset_paths,
        session_token,
        None,
        workspace,
    )
}

#[cfg(test)]
pub fn save(
    path: &Path,
    snapshot: Value,
    asset_paths: BTreeMap<String, String>,
    workspace: &Path,
) -> Result<ProjectSaveResult, String> {
    let id = project_id(&snapshot)?;
    let (snapshot, asset_paths, token) = match latest_snapshot(id, workspace)? {
        Some(latest) => {
            let token = active_session_token(&latest)
                .ok_or("Project session is not active")?
                .to_owned();
            (snapshot, asset_paths, token)
        }
        None => {
            let activated = activate_project_session(snapshot, asset_paths, None, workspace)?;
            (
                activated.snapshot,
                activated.asset_paths,
                activated
                    .session_token
                    .ok_or("Project activation returned no session")?,
            )
        }
    };
    save_with_session(path, snapshot, asset_paths, &token, workspace)
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
    let mut snapshot = document.ok_or("Missing project.json")?;
    validate(&snapshot)?;
    if snapshot["fingerprint"].as_str() != Some(project_fingerprint(&snapshot)?.as_str()) {
        return Err("Project fingerprint mismatch".into());
    }
    if let Some(object) = snapshot.as_object_mut() {
        object.remove("sessionToken");
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
    Ok(ProjectOpenResult {
        snapshot,
        asset_paths: paths,
        session_token: None,
    })
}

pub fn recover(project_id: &str, workspace: &Path) -> Result<RecoveryListing, String> {
    list_recovery_candidates(project_id, workspace)
}

#[cfg(test)]
#[path = "project_io_tests.rs"]
mod tests;
