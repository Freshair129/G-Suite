use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

const MAX_IMAGE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_REVISION: u64 = 9_007_199_254_740_991;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BannerAssetExportResult {
    pub asset_id: String,
    pub revision: u64,
    pub path: String,
    pub file_sha256: String,
    pub size_bytes: u64,
}

struct RasterSource {
    file: File,
    mime: &'static str,
    extension: &'static str,
    size: u64,
    sha256: String,
}

#[cfg(windows)]
fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &fs::Metadata) -> bool {
    false
}

fn valid_id(value: &str) -> bool {
    let mut chars = value.chars();
    chars
        .next()
        .is_some_and(|first| first.is_ascii_alphanumeric())
        && value.len() <= 128
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '-')
}

fn hash_source(path: &Path) -> Result<RasterSource, String> {
    let path_metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if !path_metadata.is_file() || path_metadata.file_type().is_symlink() {
        return Err("Choose a regular PNG, WebP, or JPEG image file".into());
    }
    if is_reparse_point(&path_metadata) {
        return Err("Reparse-point image inputs are not allowed".into());
    }

    let (mime, extension) = match path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png") => ("image/png", "png"),
        Some("webp") => ("image/webp", "webp"),
        Some("jpg" | "jpeg") => ("image/jpeg", "jpg"),
        _ => return Err("Only PNG, WebP, and JPEG images can be exported".into()),
    };
    let mut file = File::open(path).map_err(|error| error.to_string())?;
    let file_metadata = file.metadata().map_err(|error| error.to_string())?;
    if !file_metadata.is_file() || file_metadata.len() == 0 || file_metadata.len() > MAX_IMAGE_BYTES
    {
        return Err("Image size must be between 1 byte and 256 MiB".into());
    }
    let size = file_metadata.len();
    let mut signature = [0_u8; 12];
    let signature_len = file
        .read(&mut signature)
        .map_err(|error| error.to_string())?;
    let signature_matches = match mime {
        "image/png" => signature_len >= 8 && signature[..8] == [137, 80, 78, 71, 13, 10, 26, 10],
        "image/webp" => {
            signature_len >= 12 && &signature[..4] == b"RIFF" && &signature[8..12] == b"WEBP"
        }
        "image/jpeg" => signature_len >= 3 && signature[..3] == [0xff, 0xd8, 0xff],
        _ => false,
    };
    if !signature_matches {
        return Err("Image extension and file signature do not match".into());
    }

    file.rewind().map_err(|error| error.to_string())?;
    banner_image_validation::validate(&mut file, mime)?;
    file.rewind().map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut count = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        count = count
            .checked_add(read as u64)
            .ok_or("Image size overflow")?;
        if count > MAX_IMAGE_BYTES {
            return Err("Image size exceeds 256 MiB".into());
        }
        hasher.update(&buffer[..read]);
    }
    if count != size {
        return Err("Image changed while being inspected".into());
    }
    file.rewind().map_err(|error| error.to_string())?;
    Ok(RasterSource {
        file,
        mime,
        extension,
        size,
        sha256: format!("{:x}", hasher.finalize()),
    })
}

fn ensure_plain_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
        Ok(_) => return Err("Export path contains a non-directory or link".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|error| error.to_string())?;
            let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                return Err("Export path changed while being created".into());
            }
        }
        Err(error) => return Err(error.to_string()),
    }
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if is_reparse_point(&metadata) {
        return Err("Export path may not contain a reparse point".into());
    }
    Ok(())
}

fn create_temporary_archive(directory: &Path) -> Result<(PathBuf, File), String> {
    for _ in 0..8 {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = directory.join(format!(
            ".banner-export-{}-{sequence}.tmp",
            std::process::id()
        ));
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Could not reserve a temporary export file".into())
}

pub fn export_still_banner_asset(
    workspace_root: &Path,
    project_id: &str,
    asset_id: &str,
    name: &str,
    revision: u64,
    source_path: &Path,
) -> Result<BannerAssetExportResult, String> {
    if !crate::workspace::valid_project_name(project_id) {
        return Err("Select a valid Studio project".into());
    }
    if !valid_id(asset_id) {
        return Err(
            "Asset ID must use 1-128 ASCII letters, digits, hyphens, or underscores".into(),
        );
    }
    if name.trim().is_empty() || name.chars().count() > 120 {
        return Err("Asset name must contain 1-120 nonblank characters".into());
    }
    if revision == 0 || revision > MAX_REVISION {
        return Err("Revision must be a positive safe integer".into());
    }

    let source = hash_source(source_path)?;
    let workspace = fs::canonicalize(workspace_root).map_err(|error| error.to_string())?;
    let project = workspace.join(project_id);
    let project_metadata = fs::symlink_metadata(&project).map_err(|error| error.to_string())?;
    if !project_metadata.is_dir()
        || project_metadata.file_type().is_symlink()
        || is_reparse_point(&project_metadata)
    {
        return Err("Studio project must be a regular directory".into());
    }
    let project = fs::canonicalize(project).map_err(|error| error.to_string())?;
    if !project.starts_with(&workspace) {
        return Err("Studio project escaped the configured workspace".into());
    }
    let manifest_path = project.join("studio-project.json");
    let manifest_meta = fs::symlink_metadata(&manifest_path).map_err(|error| error.to_string())?;
    if !manifest_meta.is_file()
        || manifest_meta.file_type().is_symlink()
        || is_reparse_point(&manifest_meta)
    {
        return Err("Studio project manifest is missing or unsafe".into());
    }
    let project_manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(manifest_path).map_err(|error| error.to_string())?)
            .map_err(|_| "Studio project manifest is invalid")?;
    if project_manifest["project"] != project_id {
        return Err("Studio project identity does not match its folder".into());
    }

    let exports = project.join("exports");
    ensure_plain_directory(&exports)?;
    let asset_directory = exports.join(asset_id);
    ensure_plain_directory(&asset_directory)?;
    let output = asset_directory.join(format!("r{revision}.banner.zip"));
    if output.exists() {
        return Err(format!(
            "Banner revision already exists: {asset_id} r{revision}"
        ));
    }

    let path_in_archive = format!("assets/banner.{}", source.extension);
    let banner_manifest = json!({
        "format": "g-suite-banner-asset",
        "schemaVersion": 1,
        "assetId": asset_id,
        "revision": revision,
        "name": name,
        "mediaKind": "still-image",
        "editableControls": { "title": false, "outerMotion": [] },
        "files": [{
            "id": "banner-image",
            "path": path_in_archive,
            "role": "stillImage",
            "mediaType": source.mime,
            "sizeBytes": source.size,
            "sha256": source.sha256,
        }],
        "provenance": { "application": "G-Maiden 3D Studio", "version": env!("CARGO_PKG_VERSION") }
    });
    let manifest_bytes =
        serde_json::to_vec_pretty(&banner_manifest).map_err(|error| error.to_string())?;
    let (temporary, file) = create_temporary_archive(&asset_directory)?;
    let build_result = (|| -> Result<(), String> {
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        archive
            .start_file("manifest.json", options)
            .map_err(|error| error.to_string())?;
        archive
            .write_all(&manifest_bytes)
            .map_err(|error| error.to_string())?;
        archive
            .start_file(&path_in_archive, options)
            .map_err(|error| error.to_string())?;

        let mut input = source.file;
        let mut hasher = Sha256::new();
        let mut copied = 0_u64;
        let mut buffer = [0_u8; 64 * 1024];
        loop {
            let read = input.read(&mut buffer).map_err(|error| error.to_string())?;
            if read == 0 {
                break;
            }
            copied = copied
                .checked_add(read as u64)
                .ok_or("Image size overflow")?;
            if copied > MAX_IMAGE_BYTES {
                return Err("Image size exceeds 256 MiB".into());
            }
            hasher.update(&buffer[..read]);
            archive
                .write_all(&buffer[..read])
                .map_err(|error| error.to_string())?;
        }
        if copied != source.size || format!("{:x}", hasher.finalize()) != source.sha256 {
            return Err("Image changed while the archive was being written".into());
        }
        let file = archive.finish().map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = build_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    if let Err(error) = fs::hard_link(&temporary, &output) {
        let _ = fs::remove_file(&temporary);
        if error.kind() == std::io::ErrorKind::AlreadyExists {
            return Err(format!(
                "Banner revision already exists: {asset_id} r{revision}"
            ));
        }
        return Err(error.to_string());
    }
    let _ = fs::remove_file(&temporary);
    Ok(BannerAssetExportResult {
        asset_id: asset_id.to_owned(),
        revision,
        path: output.display().to_string(),
        file_sha256: source.sha256,
        size_bytes: source.size,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Read,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    const PNG: &[u8] = include_bytes!("../icons/32x32.png");

    fn root() -> PathBuf {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "g-studio-banner-export-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    fn project(root: &PathBuf) {
        let project = root.join("sample-project");
        fs::create_dir_all(project.join("exports")).unwrap();
        fs::write(
            project.join("studio-project.json"),
            br#"{"project":"sample-project","provenance":"test"}"#,
        )
        .unwrap();
    }

    #[test]
    fn exports_a_verified_still_asset_into_an_immutable_project_revision() {
        let root = root();
        project(&root);
        let source = if let Some(source) = std::env::var_os("G_SUITE_BANNER_E2E_SOURCE") {
            PathBuf::from(source)
        } else {
            let source = root.join("source image.png");
            fs::write(&source, PNG).unwrap();
            source
        };
        let source_bytes = fs::read(&source).unwrap();

        let exported = super::export_still_banner_asset(
            &root,
            "sample-project",
            "banner-001",
            "First Blood",
            1,
            &source,
        )
        .unwrap();

        assert!(PathBuf::from(&exported.path).is_file());
        assert_eq!(exported.asset_id, "banner-001");
        assert_eq!(exported.revision, 1);
        let mut archive = zip::ZipArchive::new(fs::File::open(&exported.path).unwrap()).unwrap();
        assert_eq!(archive.len(), 2);
        let mut manifest_bytes = Vec::new();
        archive
            .by_name("manifest.json")
            .unwrap()
            .read_to_end(&mut manifest_bytes)
            .unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&manifest_bytes).unwrap();
        assert_eq!(manifest["assetId"], "banner-001");
        assert_eq!(manifest["revision"], 1);
        assert_eq!(manifest["mediaKind"], "still-image");
        assert_eq!(manifest["files"][0]["path"], "assets/banner.png");
        assert_eq!(manifest["files"][0]["sha256"], exported.file_sha256);
        assert!(manifest
            .to_string()
            .find(source.to_str().unwrap())
            .is_none());
        let mut image = Vec::new();
        archive
            .by_name("assets/banner.png")
            .unwrap()
            .read_to_end(&mut image)
            .unwrap();
        assert_eq!(image, source_bytes);

        let original_archive = fs::read(&exported.path).unwrap();
        let error = super::export_still_banner_asset(
            &root,
            "sample-project",
            "banner-001",
            "Changed name",
            1,
            &source,
        )
        .unwrap_err();
        assert!(error.contains("already exists"));
        assert_eq!(fs::read(&exported.path).unwrap(), original_archive);
        if let Some(capture_path) = std::env::var_os("G_SUITE_BANNER_E2E_CAPTURE") {
            fs::copy(&exported.path, capture_path).unwrap();
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_truncated_png_with_valid_signature() {
        let root = root();
        project(&root);
        let source = root.join("truncated.png");
        fs::write(&source, b"\x89PNG\r\n\x1a\n").unwrap();
        assert!(super::export_still_banner_asset(
            &root,
            "sample-project",
            "banner-001",
            "Banner",
            1,
            &source,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_invalid_ids_projects_and_non_raster_inputs_before_export() {
        let root = root();
        project(&root);
        let source = root.join("source.exe");
        fs::write(&source, PNG).unwrap();

        assert!(super::export_still_banner_asset(
            &root,
            "../escape",
            "banner-001",
            "Banner",
            1,
            &source,
        )
        .is_err());
        assert!(super::export_still_banner_asset(
            &root,
            "sample-project",
            "../escape",
            "Banner",
            1,
            &source,
        )
        .is_err());
        assert!(super::export_still_banner_asset(
            &root,
            "sample-project",
            "banner-001",
            "Banner",
            1,
            &source,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
