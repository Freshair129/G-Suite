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
const TAXONOMY_NOTICE: &str =
    "แพ็กนี้ใช้ enemy_missing และต้องใช้ G-Maiden ที่รองรับรายชื่อเหตุการณ์ v1.2 ขึ้นไป รุ่น v1.1 จะปฏิเสธทั้งแพ็ก";

fn check_event_compatibility(
    registry: &serde_json::Value,
    confirm_v12: impl FnOnce() -> bool,
) -> Result<(), String> {
    if registry["events"].get("enemy_missing").is_some() && !confirm_v12() {
        return Err(TAXONOMY_NOTICE.into());
    }
    Ok(())
}

pub async fn install(
    job: InstallJob,
    window: Option<tauri::WebviewWindow>,
) -> Result<InstallReport, String> {
    // local-install-v1 registrations do not advertise the runtime event taxonomy.
    // Inspect the same digest Maiden will receive before contacting that profile.
    let job = tauri::async_runtime::spawn_blocking(move || {
        let package = g_ann_package::Package::open(std::path::Path::new(&job.path))?;
        if package.digest != job.expected_digest {
            return Err("แพ็กเปลี่ยนแล้ว กรุณาเลือกไฟล์อีกครั้ง".to_string());
        }
        check_event_compatibility(&package.registry, || match window {
            None => job.confirm_event_taxonomy_v12,
            Some(window) => {
                use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};
                window
                    .dialog()
                    .message(format!(
                        "{TAXONOMY_NOTICE}\n\nยืนยันว่าโปรไฟล์ {} รองรับ v1.2 และต้องการติดตั้ง?",
                        job.profile_id
                    ))
                    .title("ตรวจรุ่น G-Maiden ก่อนติดตั้ง")
                    .buttons(MessageDialogButtons::OkCancelCustom(
                        "ติดตั้ง".into(),
                        "ยกเลิก".into(),
                    ))
                    .parent(&window)
                    .blocking_show()
            }
        })?;
        Ok(job)
    })
    .await
    .map_err(|e| e.to_string())??;
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
    install(job, Some(window)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn existing_event_pack_needs_no_version_confirmation() {
        check_event_compatibility(&json!({"events":{"kill":[{}]}}), || {
            panic!("unexpected prompt")
        })
        .unwrap();
    }

    #[test]
    fn newer_event_requires_positive_confirmation_for_the_whole_pack() {
        let registry = json!({"events":{"kill":[{}], "enemy_missing":[{}]}});
        assert_eq!(
            check_event_compatibility(&registry, || false),
            Err(TAXONOMY_NOTICE.into())
        );
        assert!(check_event_compatibility(&registry, || true).is_ok());
    }
}
