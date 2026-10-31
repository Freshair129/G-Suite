use std::{
    path::Path,
    sync::{Arc, Mutex},
};
use tauri::State;
#[derive(Default)]
pub struct OpenPackage(pub Arc<Mutex<Option<g_ann_package::Package>>>);
#[tauri::command]
pub fn gann_startup_path(window: tauri::WebviewWindow) -> Result<Option<String>, String> {
    trusted(&window)?;
    Ok(std::env::args().skip(1).find(|arg| {
        Path::new(arg)
            .extension()
            .and_then(|s| s.to_str())
            .is_some_and(|s| s.eq_ignore_ascii_case("gann"))
    }))
}
pub(crate) fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|e| e.to_string())?;
    if window.label() == "main"
        && (matches!(url.host_str(), Some("tauri.localhost"))
            || url.scheme() == "tauri"
            || (cfg!(debug_assertions)
                && url.host_str() == Some("localhost")
                && url.port() == Some(5174)))
    {
        Ok(())
    } else {
        Err("Package operations require the local main window".into())
    }
}
#[tauri::command]
pub async fn gann_open(
    window: tauri::WebviewWindow,
    state: State<'_, OpenPackage>,
    path: String,
) -> Result<serde_json::Value, String> {
    trusted(&window)?;
    if Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case("gann"))
    {
        return Err("เลือกไฟล์ .gann".into());
    }
    let p = tauri::async_runtime::spawn_blocking(move || {
        g_ann_package::Package::open(Path::new(&path)).and_then(|p| {
            p.validate_playback()?;
            Ok(p)
        })
    })
    .await
    .map_err(|e| e.to_string())??;
    let result = serde_json::json!({"token":p.digest,"index":p.index,"registry":p.registry});
    *state.0.lock().map_err(|_| "Package lock")? = Some(p);
    Ok(result)
}
#[tauri::command]
pub async fn gann_read(
    window: tauri::WebviewWindow,
    state: State<'_, OpenPackage>,
    token: String,
    path: String,
) -> Result<tauri::ipc::Response, String> {
    trusted(&window)?;
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = shared.lock().map_err(|_| "Package lock")?;
        let p = guard.as_ref().ok_or("เปิดแพ็กก่อน")?;
        if token != p.digest {
            return Err("แพ็กเปลี่ยนแล้ว กรุณาโหลดใหม่".into());
        }
        if !(path.starts_with("audio/") && path.ends_with(".wav")
            || path.starts_with("video/") && path.ends_with(".webm"))
        {
            return Err("อ่านตัวอย่างได้เฉพาะเสียงและวิดีโอในแพ็ก".into());
        }
        Ok(tauri::ipc::Response::new(p.read(&path)?))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn gann_save_copy(
    window: tauri::WebviewWindow,
    state: State<'_, OpenPackage>,
    token: String,
    path: String,
) -> Result<(), String> {
    trusted(&window)?;
    if Path::new(&path)
        .extension()
        .and_then(|s| s.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case("gann"))
    {
        return Err("บันทึกเป็น .gann".into());
    }
    let shared = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let guard = shared.lock().map_err(|_| "Package lock")?;
        let p = guard.as_ref().ok_or("เปิดแพ็กก่อน")?;
        if p.digest != token {
            return Err("แพ็กเปลี่ยนแล้ว".into());
        }
        p.save_copy(Path::new(&path))
    })
    .await
    .map_err(|e| e.to_string())?
}
