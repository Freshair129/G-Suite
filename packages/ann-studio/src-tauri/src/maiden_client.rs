//! Maiden owns installation and selection. Studio sends only an authorized
//! source path, digest, and an explicitly selected registered profile.
use g_ann_package::local_ipc::{self, LocalInstall, Registration};
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InstallJob {
    pub path: String,
    pub profile_id: String,
    pub expected_digest: String,
    pub request_id: String,
    pub project_binding: Option<String>,
    pub equip_policy: local_ipc::EquipPolicy,
    #[serde(default)]
    pub confirm_event_taxonomy_v12: bool,
}
pub fn discover() -> Result<Vec<Registration>, String> {
    Ok(local_ipc::discover(&local_ipc::registration_directory()?))
}
pub async fn install(job: InstallJob) -> Result<Value, String> {
    let profiles = discover()?;
    let profile = local_ipc::select_registration(&profiles, &job.profile_id)?;
    let request = LocalInstall {
        protocol_version: local_ipc::PROTOCOL_VERSION,
        request_id: job.request_id,
        profile_id: job.profile_id,
        source_path: job.path.into(),
        expected_digest: job.expected_digest,
        project_binding: job.project_binding,
        equip_policy: job.equip_policy,
    };
    request.validate()?;
    #[cfg(windows)]
    {
        local_ipc::windows::request(
            profile,
            serde_json::to_value(request).map_err(|e| e.to_string())?,
        )
        .await
    }
    #[cfg(not(windows))]
    {
        let _ = (profile, request);
        Err("Maiden installation requires Windows".into())
    }
}
pub fn launch(profile_id: &str) -> Result<(), String> {
    let profiles = discover()?;
    let profile = local_ipc::select_registration(&profiles, profile_id)?;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        if local_ipc::windows::process_identity(profile.process_id)
            .is_ok_and(|(sid, path)| sid == profile.owner_sid && path == profile.executable)
        {
            return Ok(());
        }
        std::process::Command::new(&profile.executable)
            .env("GMAIDEN_PROFILE_ID", &profile.profile_id)
            .env("GMAIDEN_PACKAGE_DATA_ROOT", &profile.app_local_data)
            .env("GMAIDEN_INSTANCE_KIND", &profile.instance_kind)
            .creation_flags(super::CREATE_NO_WINDOW)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = profile;
        Err("Maiden requires Windows".into())
    }
}
#[tauri::command]
pub async fn discover_maiden_profiles(
    window: tauri::WebviewWindow,
) -> Result<Vec<Registration>, String> {
    super::gann::trusted(&window)?;
    tauri::async_runtime::spawn_blocking(discover)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn launch_maiden_profile(
    window: tauri::WebviewWindow,
    profile_id: String,
) -> Result<(), String> {
    super::gann::trusted(&window)?;
    tauri::async_runtime::spawn_blocking(move || launch(&profile_id))
        .await
        .map_err(|e| e.to_string())?
}
