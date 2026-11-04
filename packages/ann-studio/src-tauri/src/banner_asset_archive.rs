use jsonschema::Validator;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::OnceLock,
};
use tempfile::TempDir;
use zip::{read::ZipFile, ZipArchive};

const MAX_MANIFEST_BYTES: u64 = 1024 * 1024;
const MAX_FILES: usize = 64;
const MAX_FILE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_BUNDLE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = MAX_BUNDLE_BYTES + MAX_MANIFEST_BYTES + 1024 * 1024;
const SCHEMA: &str = include_str!("../../../../schemas/banner-asset-v1.schema.json");

static SCHEMA_VALIDATOR: OnceLock<Result<Validator, String>> = OnceLock::new();

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BannerAssetPreview {
    pub manifest: Value,
    pub manifest_sha256: String,
}

#[derive(Debug)]
pub struct VerifiedBannerAssetArchive {
    pub manifest: Value,
    pub manifest_sha256: String,
    /// Verified staged paths keyed by the stable file ID from the manifest.
    pub files: BTreeMap<String, PathBuf>,
    _stage: TempDir,
}

impl VerifiedBannerAssetArchive {
    #[cfg(test)]
    pub fn stage_path(&self) -> &Path {
        self._stage.path()
    }
}

#[derive(Debug)]
struct ArchiveEntry {
    index: usize,
    name: String,
    size: u64,
}

fn schema_validator() -> Result<&'static Validator, String> {
    SCHEMA_VALIDATOR
        .get_or_init(|| {
            let schema: Value = serde_json::from_str(SCHEMA).map_err(|e| e.to_string())?;
            jsonschema::validator_for(&schema).map_err(|e| e.to_string())
        })
        .as_ref()
        .map_err(Clone::clone)
}

fn validate_schema(manifest: &Value) -> Result<(), String> {
    let validator = schema_validator()?;
    let errors = validator
        .iter_errors(manifest)
        .take(8)
        .map(|error| error.to_string())
        .collect::<Vec<_>>();
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Invalid banner asset manifest: {}",
            errors.join("; ")
        ))
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.is_ascii()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
        && value.as_bytes()[0].is_ascii_alphanumeric()
}

fn safe_asset_path(value: &str) -> bool {
    let Some(filename) = value.strip_prefix("assets/") else {
        return false;
    };
    if value.len() > 167
        || filename.is_empty()
        || !filename.is_ascii()
        || filename.contains(['/', '\\', ':'])
        || filename.contains("..")
        || filename.ends_with('.')
        || !filename
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
        || !filename.as_bytes()[0].is_ascii_alphanumeric()
        || !filename
            .as_bytes()
            .last()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_' || *byte == b'-')
    {
        return false;
    }
    let device = filename
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    !matches!(
        device.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) && !(1..=9).any(|n| device == format!("COM{n}") || device == format!("LPT{n}"))
        && !["COM¹", "COM²", "COM³", "LPT¹", "LPT²", "LPT³"].contains(&device.as_str())
}

fn manifest_file_map(manifest: &Value) -> Result<BTreeMap<String, Value>, String> {
    let files = manifest["files"]
        .as_array()
        .ok_or("Banner manifest files must be an array")?;
    if files.len() > MAX_FILES {
        return Err("Banner manifest exceeds 64 files".into());
    }
    let mut map = BTreeMap::new();
    let mut ids = BTreeSet::new();
    let mut paths = BTreeSet::new();
    let mut total = 0u64;
    for file in files {
        let id = file["id"].as_str().ok_or("Banner file ID is missing")?;
        let path = file["path"].as_str().ok_or("Banner file path is missing")?;
        let size = file["sizeBytes"]
            .as_u64()
            .ok_or("Banner file size is invalid")?;
        let sha = file["sha256"]
            .as_str()
            .ok_or("Banner file digest is missing")?;
        if !valid_id(id) || !ids.insert(id.to_ascii_uppercase()) {
            return Err("Banner file IDs must be unique Windows-safe identifiers".into());
        }
        if !safe_asset_path(path) || !paths.insert(path.to_ascii_uppercase()) {
            return Err("Banner file paths must be unique safe assets/<filename> paths".into());
        }
        if size == 0 || size > MAX_FILE_BYTES {
            return Err("Banner file exceeds the 256 MiB per-file limit".into());
        }
        if sha.len() != 64
            || !sha
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err("Banner file digest must be lowercase SHA-256 hex".into());
        }
        total = total
            .checked_add(size)
            .ok_or("Banner byte count overflow")?;
        if total > MAX_BUNDLE_BYTES {
            return Err("Banner files exceed the 512 MiB aggregate limit".into());
        }
        map.insert(path.to_owned(), file.clone());
    }
    Ok(map)
}

fn validate_cross_fields(manifest: &Value, files: &BTreeMap<String, Value>) -> Result<(), String> {
    let kind = manifest["mediaKind"]
        .as_str()
        .ok_or("Banner media kind is missing")?;
    let roles = |role: &str| {
        files
            .values()
            .filter(|file| file["role"] == role)
            .collect::<Vec<_>>()
    };
    let raster = |media: &str| matches!(media, "image/png" | "image/webp" | "image/jpeg");
    match kind {
        "baked-video" => {
            let runtime = roles("runtimeVideo");
            if runtime.len() != 1
                || runtime[0]["mediaType"] != "video/webm"
                || manifest["silent"] != true
                || manifest["editableControls"]["title"] != false
                || manifest["template"].is_object()
                || files.values().any(|file| {
                    file["role"] == "stillImage"
                        || (file["role"] == "supportingAsset"
                            && !raster(file["mediaType"].as_str().unwrap_or_default()))
                })
            {
                return Err("Baked video must be one silent WebM runtime with raster support files and no editable title".into());
            }
        }
        "still-image" => {
            let still = roles("stillImage");
            if still.len() != 1
                || !raster(still[0]["mediaType"].as_str().unwrap_or_default())
                || manifest.get("silent").is_some()
                || manifest.get("durationMs").is_some()
                || manifest.get("template").is_some()
                || manifest["editableControls"]["title"] != false
                || files.values().any(|file| {
                    file["role"] == "runtimeVideo"
                        || (file["role"] == "supportingAsset"
                            && !raster(file["mediaType"].as_str().unwrap_or_default()))
                })
            {
                return Err("Still image must contain one raster still-image runtime and no baked-media fields".into());
            }
        }
        "editable-template" => {
            if manifest.get("silent").is_some()
                || manifest.get("durationMs").is_some()
                || manifest["editableControls"]["title"] != true
                || files.values().any(|file| {
                    file["role"] != "supportingAsset"
                        || !raster(file["mediaType"].as_str().unwrap_or_default())
                })
            {
                return Err(
                    "Editable templates require title editing and raster supporting assets only"
                        .into(),
                );
            }
            let project = manifest["template"]["bannerProject"]
                .as_object()
                .ok_or("Editable template is missing BannerProject v1")?;
            let project_assets = manifest["template"]["bannerProject"]["assets"]
                .as_array()
                .ok_or("Editable template assets are missing")?;
            if project_assets.len() > 4096 {
                return Err("BannerProject exceeds AnnStudio's 4096 asset limit".into());
            }
            let artboard = &manifest["template"]["bannerProject"]["artboard"];
            if artboard["width"].as_u64().is_none_or(|width| width > 1920)
                || artboard["height"]
                    .as_u64()
                    .is_none_or(|height| height > 1080)
            {
                return Err(
                    "BannerProject artboard exceeds the current 1920×1080 renderer limit".into(),
                );
            }
            let file_ids = files
                .values()
                .map(|file| file["id"].as_str().unwrap_or_default())
                .collect::<BTreeSet<_>>();
            let mut asset_ids = BTreeSet::new();
            let mut source_ids = BTreeSet::new();
            let by_file = files
                .values()
                .filter_map(|file| Some((file["id"].as_str()?, file)))
                .collect::<BTreeMap<_, _>>();
            for asset in project_assets {
                let id = asset["id"]
                    .as_str()
                    .ok_or("BannerProject asset ID is missing")?;
                let mime = asset["mime"]
                    .as_str()
                    .ok_or("BannerProject asset MIME is missing")?;
                let source = asset["source"]
                    .as_str()
                    .ok_or("BannerProject asset source is missing")?;
                let source_id = source
                    .strip_prefix("asset:")
                    .ok_or("BannerProject source must use asset:<file-id>")?;
                if !valid_id(id) || !asset_ids.insert(id) {
                    return Err("BannerProject asset IDs must be unique safe identifiers".into());
                }
                if !source_ids.insert(source_id) {
                    return Err("BannerProject assets must map one-to-one to package files".into());
                }
                let file = by_file
                    .get(source_id)
                    .ok_or("BannerProject references an unindexed package file")?;
                if file["mediaType"] != mime {
                    return Err("BannerProject asset MIME must match its indexed file".into());
                }
            }
            if source_ids != file_ids {
                return Err("Every editable-template file must be referenced by exactly one BannerProject asset".into());
            }
            let layers = manifest["template"]["bannerProject"]["layers"]
                .as_array()
                .ok_or("BannerProject layers are missing")?;
            if layers.len() > 4096 {
                return Err("BannerProject exceeds AnnStudio's 4096 layer limit".into());
            }
            let mut layer_ids = BTreeSet::new();
            let mut parents = Vec::new();
            for layer in layers {
                let id = layer["id"].as_str().ok_or("BannerLayer ID is missing")?;
                if !valid_id(id) || !layer_ids.insert(id) {
                    return Err("BannerLayer IDs must be unique safe identifiers".into());
                }
                if let Some(parent) = layer["parentId"].as_str() {
                    parents.push((id, parent));
                }
                if let Some(asset_id) = layer["content"].get("assetId").and_then(Value::as_str) {
                    if !asset_ids.contains(asset_id) {
                        return Err("BannerLayer references an unknown BannerProject asset".into());
                    }
                }
                if layer["style"].get("fontAssetId").is_some() {
                    return Err("Custom font files are not portable in Banner Asset v1; replace the font reference before import".into());
                }
                if let Some(keyframes) = layer["motion"]["keyframes"].as_array() {
                    let mut previous = None;
                    for frame in keyframes {
                        let time = frame["timeMs"]
                            .as_u64()
                            .ok_or("Invalid BannerLayer keyframe time")?;
                        if time > 18_200 || previous.is_some_and(|prior| time <= prior) {
                            return Err(
                                "BannerLayer keyframes must be ordered within 18.2 seconds".into(),
                            );
                        }
                        previous = Some(time);
                    }
                }
            }
            for (_, parent_id) in parents {
                let parent = layers
                    .iter()
                    .find(|layer| layer["id"] == parent_id)
                    .ok_or("BannerLayer parent is missing")?;
                if parent["kind"] != "group" {
                    return Err("BannerLayer parent must be a group".into());
                }
            }
            for layer in layers {
                let mut seen = BTreeSet::new();
                let mut cursor = layer;
                loop {
                    let id = cursor["id"].as_str().ok_or("BannerLayer ID is missing")?;
                    if !seen.insert(id) {
                        return Err("BannerProject group hierarchy contains a cycle".into());
                    }
                    let Some(parent_id) = cursor["parentId"].as_str() else {
                        break;
                    };
                    cursor = layers
                        .iter()
                        .find(|candidate| candidate["id"] == parent_id)
                        .ok_or("BannerLayer parent is missing")?;
                }
            }
            if project["schemaVersion"] != 1 {
                return Err("Unsupported BannerProject schema version".into());
            }
        }
        _ => return Err("Unsupported banner media kind".into()),
    }
    Ok(())
}

fn parse_manifest(raw: &[u8]) -> Result<Value, String> {
    if raw.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("Banner manifest exceeds 1 MiB".into());
    }
    let text = std::str::from_utf8(raw).map_err(|_| "Banner manifest is not valid UTF-8")?;
    let manifest: Value =
        serde_json::from_str(text).map_err(|e| format!("Invalid banner manifest JSON: {e}"))?;
    validate_schema(&manifest)?;
    let files = manifest_file_map(&manifest)?;
    validate_cross_fields(&manifest, &files)?;
    Ok(manifest)
}

fn read_archive_entries(archive: &mut ZipArchive<File>) -> Result<Vec<ArchiveEntry>, String> {
    if archive.len() == 0 || archive.len() > MAX_FILES + 1 {
        return Err("Banner archive must contain manifest.json and at most 64 files".into());
    }
    let mut names = BTreeSet::new();
    let mut total = 0u64;
    let mut entries = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        let file = archive
            .by_index(index)
            .map_err(|e| format!("Invalid ZIP entry: {e}"))?;
        let raw_name = std::str::from_utf8(file.name_raw())
            .map_err(|_| "Banner archive entry name must be UTF-8")?;
        if !raw_name.is_ascii()
            || raw_name.contains(['\\', ':', '\0'])
            || raw_name.ends_with('/')
            || file.is_dir()
        {
            return Err("Banner archive contains a directory or unsafe entry path".into());
        }
        if !names.insert(raw_name.to_ascii_uppercase()) {
            return Err("Banner archive contains duplicate/case-alias entry names".into());
        }
        if let Some(mode) = file.unix_mode() {
            let file_type = mode & 0o170000;
            if file_type != 0 && file_type != 0o100000 {
                return Err("Banner archive contains a symlink or non-regular file".into());
            }
        }
        if raw_name != "manifest.json" && !raw_name.starts_with("assets/") {
            return Err("Banner archive contains an unexpected root entry".into());
        }
        if raw_name == "manifest.json" && file.size() > MAX_MANIFEST_BYTES {
            return Err("Banner manifest exceeds 1 MiB".into());
        }
        if raw_name != "manifest.json" && file.size() > MAX_FILE_BYTES {
            return Err("Banner archive entry exceeds 256 MiB".into());
        }
        total = total
            .checked_add(file.size())
            .ok_or("Banner archive expanded size overflow")?;
        if total > MAX_BUNDLE_BYTES + MAX_MANIFEST_BYTES {
            return Err("Banner archive exceeds its expanded size limit".into());
        }
        entries.push(ArchiveEntry {
            index,
            name: raw_name.to_owned(),
            size: file.size(),
        });
    }
    if !entries.iter().any(|entry| entry.name == "manifest.json") {
        return Err("Banner archive is missing root manifest.json".into());
    }
    Ok(entries)
}

fn read_manifest(archive: &mut ZipArchive<File>, entry: &ArchiveEntry) -> Result<Vec<u8>, String> {
    let file = archive
        .by_index(entry.index)
        .map_err(|e| format!("Cannot read banner manifest: {e}"))?;
    let mut bytes = Vec::with_capacity(entry.size as usize);
    file.take(MAX_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Cannot read banner manifest: {e}"))?;
    if bytes.len() as u64 != entry.size || bytes.len() as u64 > MAX_MANIFEST_BYTES {
        return Err("Banner manifest byte count does not match its ZIP entry".into());
    }
    Ok(bytes)
}

fn copy_entry(file: &mut ZipFile<'_, File>, target: &Path, expected: u64) -> Result<(), String> {
    if file.size() != expected {
        return Err("Banner ZIP entry size differs from its manifest".into());
    }
    let mut output = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)
        .map_err(|e| format!("Cannot stage banner asset: {e}"))?;
    let mut scratch = [0u8; 65_536];
    let mut total = 0u64;
    loop {
        let count = file
            .read(&mut scratch)
            .map_err(|e| format!("Cannot expand banner asset: {e}"))?;
        if count == 0 {
            break;
        }
        total = total
            .checked_add(count as u64)
            .ok_or("Banner expanded size overflow")?;
        if total > expected || total > MAX_FILE_BYTES {
            return Err("Banner asset expanded beyond its verified size".into());
        }
        output
            .write_all(&scratch[..count])
            .map_err(|e| format!("Cannot write staged banner asset: {e}"))?;
    }
    if total != expected {
        return Err("Banner asset expanded size differs from its manifest".into());
    }
    output
        .sync_all()
        .map_err(|e| format!("Cannot flush staged banner asset: {e}"))?;
    drop(output);
    Ok(())
}

fn extract(
    path: &Path,
    expected_manifest_sha256: Option<&str>,
) -> Result<VerifiedBannerAssetArchive, String> {
    let file = File::open(path).map_err(|e| format!("Cannot open banner archive: {e}"))?;
    let length = file
        .metadata()
        .map_err(|e| format!("Cannot inspect banner archive: {e}"))?
        .len();
    if length > MAX_ARCHIVE_BYTES {
        return Err("Banner ZIP exceeds the 514 MiB transfer limit".into());
    }
    let mut archive = ZipArchive::new(file).map_err(|e| format!("Invalid banner ZIP: {e}"))?;
    let entries = read_archive_entries(&mut archive)?;
    let manifest_entry = entries
        .iter()
        .find(|entry| entry.name == "manifest.json")
        .ok_or("Banner archive is missing root manifest.json")?;
    let raw_manifest = read_manifest(&mut archive, manifest_entry)?;
    let manifest_sha256 = g_ann_package::sha256(&raw_manifest);
    if expected_manifest_sha256.is_some_and(|expected| expected != manifest_sha256) {
        return Err(
            "Banner archive changed after preview; inspect it again before applying".into(),
        );
    }
    let manifest = parse_manifest(&raw_manifest)?;
    let expected_files = manifest_file_map(&manifest)?;
    let expected_paths = expected_files.keys().cloned().collect::<BTreeSet<_>>();
    let archive_paths = entries
        .iter()
        .filter(|entry| entry.name != "manifest.json")
        .map(|entry| entry.name.clone())
        .collect::<BTreeSet<_>>();
    if archive_paths != expected_paths {
        return Err("Banner ZIP must contain exactly the files indexed by manifest.json".into());
    }
    let stage = tempfile::Builder::new()
        .prefix("ann-studio-banner-import-")
        .tempdir()
        .map_err(|e| format!("Cannot create temporary banner staging area: {e}"))?;
    let assets = stage.path().join("assets");
    fs::create_dir(&assets).map_err(|e| format!("Cannot prepare banner staging area: {e}"))?;
    let mut staged = BTreeMap::new();
    for entry in entries.iter().filter(|entry| entry.name != "manifest.json") {
        let file_record = expected_files
            .get(&entry.name)
            .ok_or("Unexpected banner archive path")?;
        let id = file_record["id"]
            .as_str()
            .ok_or("Banner file ID is missing")?;
        let size = file_record["sizeBytes"]
            .as_u64()
            .ok_or("Banner file size is invalid")?;
        let expected_sha = file_record["sha256"]
            .as_str()
            .ok_or("Banner file digest is missing")?;
        let filename = entry
            .name
            .strip_prefix("assets/")
            .ok_or("Unsafe banner asset path")?;
        let target = assets.join(filename);
        let mut file = archive
            .by_index(entry.index)
            .map_err(|e| format!("Cannot open banner asset: {e}"))?;
        copy_entry(&mut file, &target, size)?;
        let actual_sha = g_ann_package::file_digest(&target)?;
        if actual_sha != expected_sha {
            return Err(format!(
                "Banner asset {id} SHA-256 does not match its manifest"
            ));
        }
        staged.insert(id.to_owned(), target);
    }
    Ok(VerifiedBannerAssetArchive {
        manifest,
        manifest_sha256,
        files: staged,
        _stage: stage,
    })
}

pub fn inspect(path: &Path) -> Result<BannerAssetPreview, String> {
    let verified = extract(path, None)?;
    Ok(BannerAssetPreview {
        manifest: verified.manifest.clone(),
        manifest_sha256: verified.manifest_sha256.clone(),
    })
}

pub fn extract_verified(
    path: &Path,
    expected_manifest_sha256: Option<&str>,
) -> Result<VerifiedBannerAssetArchive, String> {
    extract(path, expected_manifest_sha256)
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use std::{
        fs::{self, File},
        io::Write,
        path::PathBuf,
        sync::atomic::{AtomicUsize, Ordering},
    };
    use zip::{write::SimpleFileOptions, ZipWriter};

    const IMAGE: &[u8] = b"png!";

    fn root() -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "ann-banner-archive-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn manifest(bytes: &[u8]) -> Value {
        json!({
            "format": "g-suite-banner-asset",
            "schemaVersion": 1,
            "assetId": "banner-13",
            "revision": 2,
            "name": "Banner",
            "mediaKind": "still-image",
            "editableControls": {"title": false, "outerMotion": ["outerOpacity"]},
            "files": [{
                "id": "image-source",
                "path": "assets/banner.png",
                "role": "stillImage",
                "mediaType": "image/png",
                "sizeBytes": bytes.len(),
                "sha256": g_ann_package::sha256(bytes),
            }]
        })
    }

    fn template_manifest(bytes: &[u8]) -> Value {
        json!({
            "format": "g-suite-banner-asset",
            "schemaVersion": 1,
            "assetId": "editable-banner",
            "revision": 1,
            "name": "Editable banner",
            "mediaKind": "editable-template",
            "editableControls": {"title": true, "outerMotion": []},
            "template": {"schemaVersion": 1, "bannerProject": {
                "schemaVersion": 1,
                "id": "design-project",
                "title": "Design project",
                "eventId": "kill",
                "artboard": {"width": 1280, "height": 720, "safeZonePreset": "dota-hud"},
                "revision": 1,
                "assets": [{"id": "editor-image", "name": "Image", "kind": "image", "mime": "image/png", "source": "asset:file-image"}],
                "layers": [{"id": "image-layer", "kind": "image", "name": "Image", "parentId": null, "order": 0, "visible": true, "locked": false,
                    "transform": {"x": 50, "y": 50, "width": 80, "height": 60, "rotation": 0, "opacity": 1}, "style": {}, "content": {"assetId": "editor-image"}}]
            }},
            "files": [{"id": "file-image", "path": "assets/image.png", "role": "supportingAsset", "mediaType": "image/png", "sizeBytes": bytes.len(), "sha256": g_ann_package::sha256(bytes)}]
        })
    }

    fn baked_video_manifest(bytes: &[u8]) -> Value {
        json!({
            "format": "g-suite-banner-asset",
            "schemaVersion": 1,
            "assetId": "baked-banner",
            "revision": 1,
            "name": "Silent video",
            "mediaKind": "baked-video",
            "silent": true,
            "durationMs": 2500,
            "editableControls": {"title": false, "outerMotion": ["outerOpacity"]},
            "files": [{"id": "runtime", "path": "assets/banner.webm", "role": "runtimeVideo", "mediaType": "video/webm", "sizeBytes": bytes.len(), "sha256": g_ann_package::sha256(bytes)}]
        })
    }

    fn archive(path: &PathBuf, manifest: &Value, extra: &[(&str, &[u8], Option<u32>)]) {
        let mut zip = ZipWriter::new(File::create(path).unwrap());
        zip.start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&serde_json::to_vec(manifest).unwrap())
            .unwrap();
        for (name, bytes, mode) in extra {
            let options = mode.map_or(SimpleFileOptions::default(), |value| {
                SimpleFileOptions::default().unix_permissions(value)
            });
            zip.start_file(name, options).unwrap();
            zip.write_all(bytes).unwrap();
        }
        zip.finish().unwrap();
    }

    #[test]
    fn inspects_and_extracts_a_valid_banner_archive_with_exact_manifest_digest() {
        let root = root();
        let path = root.join("banner.zip");
        archive(
            &path,
            &manifest(IMAGE),
            &[("assets/banner.png", IMAGE, None)],
        );

        let preview = super::inspect(&path).unwrap();
        assert_eq!(preview.manifest["assetId"], "banner-13");
        assert_eq!(
            preview.manifest_sha256,
            g_ann_package::sha256(&serde_json::to_vec(&manifest(IMAGE)).unwrap())
        );
        let verified = super::extract_verified(&path, Some(&preview.manifest_sha256)).unwrap();
        let extracted = verified.files.get("image-source").unwrap();
        assert_eq!(fs::read(extracted).unwrap(), IMAGE);
        let stage = verified.stage_path().to_path_buf();
        drop(verified);
        assert!(
            !stage.exists(),
            "temporary verified bytes must be removed on drop"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_unindexed_and_case_alias_archive_paths() {
        let root = root();
        let path = root.join("alias.zip");
        archive(
            &path,
            &manifest(IMAGE),
            &[
                ("assets/banner.png", IMAGE, None),
                ("assets/BANNER.PNG", IMAGE, None),
            ],
        );
        assert!(super::inspect(&path).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_traversal_and_reserved_windows_device_paths() {
        let root = root();
        let traversal = root.join("traversal.zip");
        archive(&traversal, &manifest(IMAGE), &[("../outside", IMAGE, None)]);
        assert!(super::inspect(&traversal).is_err());

        let device = root.join("device.zip");
        let mut invalid = manifest(IMAGE);
        invalid["files"][0]["path"] = json!("assets/CON.png");
        archive(&device, &invalid, &[("assets/CON.png", IMAGE, None)]);
        assert!(super::inspect(&device).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_missing_and_extra_files() {
        let root = root();
        let missing = root.join("missing.zip");
        archive(&missing, &manifest(IMAGE), &[]);
        assert!(super::inspect(&missing).is_err());

        let extra = root.join("extra.zip");
        archive(
            &extra,
            &manifest(IMAGE),
            &[
                ("assets/banner.png", IMAGE, None),
                ("assets/extra.png", IMAGE, None),
            ],
        );
        assert!(super::inspect(&extra).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_manifest_size_or_digest_mismatch_with_streamed_bytes() {
        let root = root();
        let wrong_size = root.join("size.zip");
        let mut size_manifest = manifest(IMAGE);
        size_manifest["files"][0]["sizeBytes"] = json!(IMAGE.len() + 1);
        archive(
            &wrong_size,
            &size_manifest,
            &[("assets/banner.png", IMAGE, None)],
        );
        assert!(super::inspect(&wrong_size).is_err());

        let wrong_digest = root.join("digest.zip");
        let mut digest_manifest = manifest(IMAGE);
        digest_manifest["files"][0]["sha256"] = json!("0".repeat(64));
        archive(
            &wrong_digest,
            &digest_manifest,
            &[("assets/banner.png", IMAGE, None)],
        );
        assert!(super::inspect(&wrong_digest).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_oversized_declared_file_before_extraction() {
        let root = root();
        let path = root.join("oversized.zip");
        let mut invalid = manifest(IMAGE);
        invalid["files"][0]["sizeBytes"] = json!(256 * 1024 * 1024usize + 1);
        archive(&path, &invalid, &[("assets/banner.png", IMAGE, None)]);
        assert!(super::inspect(&path).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_raw_manifest_over_one_mibibyte_before_parsing() {
        let root = root();
        let path = root.join("oversized-manifest.zip");
        let mut raw = serde_json::to_vec(&manifest(IMAGE)).unwrap();
        raw.resize(super::MAX_MANIFEST_BYTES as usize + 1, b' ');
        let mut zip = ZipWriter::new(File::create(&path).unwrap());
        zip.start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&raw).unwrap();
        zip.start_file("assets/banner.png", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(IMAGE).unwrap();
        zip.finish().unwrap();
        assert!(super::inspect(&path)
            .unwrap_err()
            .contains("manifest exceeds"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_directory_and_symlink_entries() {
        let root = root();
        let directory = root.join("directory.zip");
        archive(
            &directory,
            &manifest(IMAGE),
            &[("assets/banner.png", IMAGE, None), ("assets/", b"", None)],
        );
        assert!(super::inspect(&directory).is_err());

        let symlink = root.join("symlink.zip");
        let mut zip = ZipWriter::new(File::create(&symlink).unwrap());
        zip.start_file("manifest.json", SimpleFileOptions::default())
            .unwrap();
        zip.write_all(&serde_json::to_vec(&manifest(IMAGE)).unwrap())
            .unwrap();
        zip.add_symlink(
            "assets/banner.png",
            "external-target",
            SimpleFileOptions::default(),
        )
        .unwrap();
        zip.finish().unwrap();
        assert!(super::inspect(&symlink).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_archive_when_manifest_changed_after_preview() {
        let root = root();
        let path = root.join("changed.zip");
        archive(
            &path,
            &manifest(IMAGE),
            &[("assets/banner.png", IMAGE, None)],
        );
        assert!(super::extract_verified(&path, Some(&"0".repeat(64))).is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn validates_template_cross_references_and_accepts_silent_baked_video() {
        let root = root();
        let template = root.join("template.zip");
        archive(
            &template,
            &template_manifest(IMAGE),
            &[("assets/image.png", IMAGE, None)],
        );
        assert!(super::inspect(&template).is_ok());

        let mismatched = root.join("mime.zip");
        let mut manifest = template_manifest(IMAGE);
        manifest["files"][0]["mediaType"] = json!("image/webp");
        archive(&mismatched, &manifest, &[("assets/image.png", IMAGE, None)]);
        assert!(super::inspect(&mismatched).is_err());

        let custom_font = root.join("font.zip");
        let mut manifest = template_manifest(IMAGE);
        manifest["template"]["bannerProject"]["layers"][0]["style"]["fontAssetId"] =
            json!("editor-image");
        archive(
            &custom_font,
            &manifest,
            &[("assets/image.png", IMAGE, None)],
        );
        assert!(super::inspect(&custom_font)
            .unwrap_err()
            .contains("Custom font files are not portable"));

        let video = root.join("video.zip");
        let bytes = b"webm";
        archive(
            &video,
            &baked_video_manifest(bytes),
            &[("assets/banner.webm", bytes, None)],
        );
        assert_eq!(
            super::inspect(&video).unwrap().manifest["mediaKind"],
            "baked-video"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
