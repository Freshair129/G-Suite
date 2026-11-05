mod banner_asset_export;
mod workspace;
use banner_asset_export::{export_still_banner_asset, BannerAssetExportResult};
use serde::Serialize;
use std::{fs, path::PathBuf, process::Command};
use tauri::Manager;
use workspace::StudioPaths;

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
    tauri::async_runtime::spawn_blocking(move || {
        let workspace = &paths.workspace;
        if !workspace.exists() {
            return Ok(Vec::new());
        }
        let mut projects = Vec::new();

        for entry in fs::read_dir(workspace).map_err(studio_error)? {
            let entry = entry.map_err(studio_error)?;
            let metadata = fs::symlink_metadata(entry.path()).map_err(studio_error)?;
            if !metadata.is_dir() || metadata.file_type().is_symlink() {
                continue;
            }
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if metadata.file_attributes() & 0x400 != 0 {
                    continue;
                }
            }
            let id = entry.file_name().to_string_lossy().into_owned();
            if !workspace::valid_project_name(&id) {
                continue;
            }
            let root = entry.path();
            let manifest = fs::read_to_string(root.join("studio-project.json"))
                .ok()
                .and_then(|source| serde_json::from_str::<serde_json::Value>(&source).ok());
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
            let has_blend_source = fs::read_dir(root.join("source"))
                .ok()
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .any(|file| {
                    file.path()
                        .extension()
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("blend"))
                });
            projects.push(ProjectSummary {
                id,
                state,
                provenance,
                has_blend_source,
            });
        }

        projects.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(projects)
    })
    .await
    .map_err(studio_error)?
}

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
