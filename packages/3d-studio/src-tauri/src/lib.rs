mod banner_asset_export;
mod workspace;
use banner_asset_export::{export_still_banner_asset, BannerAssetExportResult};
use serde::Serialize;
use std::{
    fs::{self, OpenOptions},
    io::Read,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::Manager;
use workspace::StudioPaths;

const MAX_WORKSPACE_ENTRIES: usize = 512;
const MAX_SOURCE_ENTRIES: usize = 256;
const MAX_PROJECT_MANIFEST_BYTES: u64 = 256 * 1024;

fn paths(app: &tauri::AppHandle) -> Result<StudioPaths, String> {
    StudioPaths::resolve(
        &app.path().app_data_dir().map_err(studio_error)?,
        std::env::var_os("G_STUDIO_BLENDER_PATH").map(PathBuf::from),
        std::env::var_os("G_STUDIO_WORKSPACE_ROOT").map(PathBuf::from),
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StudioStatus {
    blender_path: Option<String>,
    blender_available: bool,
    blender_version: Option<String>,
    workspace_root: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    state: String,
    provenance: String,
    has_blend_source: bool,
    source_scan_limited: bool,
}

fn studio_error(error: impl ToString) -> String {
    error.to_string()
}
#[tauri::command]
async fn get_studio_status(app: tauri::AppHandle) -> Result<StudioStatus, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let blender_available = paths.blender.as_ref().is_some_and(|path| path.is_file());
        let blender_version = paths
            .blender
            .as_ref()
            .filter(|_| blender_available)
            .and_then(|path| {
                let mut command = Command::new(path);
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x08000000);
                }
                command
                    .arg("--version")
                    .output()
                    .ok()
                    .filter(|output| output.status.success())
            })
            .and_then(|output| String::from_utf8(output.stdout).ok())
            .and_then(|text| text.lines().next().map(str::to_owned));
        Ok(StudioStatus {
            blender_path: paths.blender.map(|path| path.display().to_string()),
            blender_available,
            blender_version,
            workspace_root: paths.workspace.display().to_string(),
        })
    })
    .await
    .map_err(studio_error)?
}

#[tauri::command]
async fn create_empty_project(
    app: tauri::AppHandle,
    project_name: String,
) -> Result<String, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !paths.blender.as_ref().is_some_and(|path| path.is_file()) { return Err("Set G_STUDIO_BLENDER_PATH to an existing Blender executable.".into()); }
        let project_root = workspace::create_project(&paths.workspace, &project_name)?;
        let manifest = serde_json::json!({ "project": project_name, "provenance": "pending-human-review", "exportProfile": "landing-hero-v1", "limits": { "glbBytes": 3_000_000, "textureBytes": 2_000_000, "idleAnimations": 1 } });
        fs::write(project_root.join("studio-project.json"), serde_json::to_vec_pretty(&manifest).map_err(studio_error)?).map_err(studio_error)?;
        Ok(project_root.display().to_string())
    }).await.map_err(studio_error)?
}

#[tauri::command]
async fn list_projects(app: tauri::AppHandle) -> Result<Vec<ProjectSummary>, String> {
    let paths = paths(&app)?;
    tauri::async_runtime::spawn_blocking(move || list_projects_in_workspace(&paths.workspace))
        .await
        .map_err(studio_error)?
}

fn list_projects_in_workspace(workspace: &Path) -> Result<Vec<ProjectSummary>, String> {
    if !workspace.exists() {
        return Ok(Vec::new());
    }
    let workspace_root = fs::canonicalize(workspace).map_err(studio_error)?;
    let mut projects = Vec::new();

    for (index, entry) in fs::read_dir(workspace).map_err(studio_error)?.enumerate() {
        if index >= MAX_WORKSPACE_ENTRIES {
            return Err(format!(
                "Studio workspace entry limit exceeded (maximum {MAX_WORKSPACE_ENTRIES})"
            ));
        }
        let entry = entry.map_err(studio_error)?;
        let metadata = fs::symlink_metadata(entry.path()).map_err(studio_error)?;
        if !metadata.is_dir() || is_reparse_point(&metadata) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if !workspace::valid_project_name(&id) {
            continue;
        }
        let root = entry.path();
        let project_root = match fs::canonicalize(&root) {
            Ok(path) if path.starts_with(&workspace_root) => path,
            _ => continue,
        };
        let manifest = read_project_manifest(&root);
        let state = manifest
            .as_ref()
            .and_then(|value| value.get("state"))
            .and_then(|value| value.as_str())
            .unwrap_or("review-pending")
            .to_owned();
        let provenance = manifest
            .as_ref()
            .and_then(|value| value.get("provenance"))
            .and_then(|value| value.as_str())
            .unwrap_or("missing-manifest")
            .to_owned();
        let (has_blend_source, source_scan_limited) = has_blend_source(&root, &project_root);
        projects.push(ProjectSummary {
            id,
            state,
            provenance,
            has_blend_source,
            source_scan_limited,
        });
    }

    projects.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(projects)
}

fn is_reparse_point(metadata: &fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        return metadata.file_attributes() & 0x400 != 0;
    }
    #[cfg(not(windows))]
    false
}

fn read_project_manifest(root: &Path) -> Option<serde_json::Value> {
    let path = root.join("studio-project.json");
    let metadata = fs::symlink_metadata(&path).ok()?;
    if !metadata.is_file()
        || is_reparse_point(&metadata)
        || metadata.len() > MAX_PROJECT_MANIFEST_BYTES
    {
        return None;
    }

    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        const FILE_FLAG_OPEN_REPARSE_POINT: u32 = 0x0020_0000;
        options.custom_flags(FILE_FLAG_OPEN_REPARSE_POINT);
    }
    let file = options.open(path).ok()?;
    let opened_metadata = file.metadata().ok()?;
    if !opened_metadata.is_file()
        || is_reparse_point(&opened_metadata)
        || opened_metadata.len() > MAX_PROJECT_MANIFEST_BYTES
    {
        return None;
    }
    let mut bytes = Vec::new();
    file.take(MAX_PROJECT_MANIFEST_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_PROJECT_MANIFEST_BYTES {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

fn has_blend_source(root: &Path, project_root: &Path) -> (bool, bool) {
    let source = root.join("source");
    if !matches!(
        fs::symlink_metadata(&source),
        Ok(metadata) if metadata.is_dir() && !is_reparse_point(&metadata)
    ) {
        return (false, false);
    }
    let source_root = match fs::canonicalize(&source) {
        Ok(path) if path.starts_with(project_root) => path,
        _ => return (false, false),
    };
    let read_dir = match fs::read_dir(source_root) {
        Ok(read_dir) => read_dir,
        Err(_) => return (false, false),
    };
    let mut entries = read_dir;
    for _ in 0..MAX_SOURCE_ENTRIES {
        let entry = match entries.next() {
            Some(Ok(entry)) => entry,
            Some(Err(_)) => continue,
            None => return (false, false),
        };
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.is_file()
            && !is_reparse_point(&metadata)
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("blend"))
        {
            return (true, false);
        }
    }
    (false, entries.next().is_some())
}

#[cfg(test)]
#[path = "project_listing_tests.rs"]
mod project_listing_tests;

#[tauri::command]
async fn export_banner_asset(
    app: tauri::AppHandle,
    project_id: String,
    asset_id: String,
    name: String,
    revision: u64,
    source_path: PathBuf,
) -> Result<BannerAssetExportResult, String> {
    let workspace = paths(&app)?.workspace;
    tauri::async_runtime::spawn_blocking(move || {
        export_still_banner_asset(
            &workspace,
            &project_id,
            &asset_id,
            &name,
            revision,
            &source_path,
        )
    })
    .await
    .map_err(studio_error)?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_studio_status,
            create_empty_project,
            list_projects,
            export_banner_asset
        ])
        .run(tauri::generate_context!())
        .expect("error while running G-Maiden 3D Studio");
}
