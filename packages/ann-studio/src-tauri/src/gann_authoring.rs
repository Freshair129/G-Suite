//! Authoring freezes and commits one portable project before any package operation.
pub use super::build_jobs::{BuildJob, BuildReport};
pub use super::maiden_client::InstallJob;
type InstallReport = serde_json::Value;
pub fn build(job: BuildJob) -> Result<BuildReport, String> {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    super::build_jobs::build(
        job,
        &base.join("com.gmaiden.ann-studio/projects"),
        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        None,
    )
}
pub async fn install(job: InstallJob) -> Result<InstallReport, String> {
    super::maiden_client::install(job).await
}
#[tauri::command]
pub async fn create_gann_package(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    job: BuildJob,
) -> Result<BuildReport, String> {
    super::gann::trusted(&window)?;
    {
        use tauri::Manager;
        let workspace = app
            .path()
            .app_local_data_dir()
            .map_err(|e| e.to_string())?
            .join("projects");
        tauri::async_runtime::spawn_blocking(move || {
            super::build_jobs::build(
                job,
                &workspace,
                std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
                None,
            )
        })
        .await
        .map_err(|e| e.to_string())?
    }
}
#[tauri::command]
pub async fn install_gann_package(
    window: tauri::WebviewWindow,
    job: InstallJob,
) -> Result<InstallReport, String> {
    super::gann::trusted(&window)?;
    install(job).await
}
