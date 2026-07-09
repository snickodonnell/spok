use serde::Serialize;
use std::process::Command;
use tauri::Emitter;
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    name: String,
    version: String,
    tauri_version: String,
    platform: String,
    arch: String,
    family: String,
    identifier: String,
}

/// Native OS folder picker (desktop). Returns absolute path or null if cancelled.
#[tauri::command]
fn pick_folder(title: Option<String>, default_path: Option<String>) -> Option<String> {
    let mut dialog =
        rfd::FileDialog::new().set_title(title.as_deref().unwrap_or("Open workspace folder"));
    if let Some(p) = default_path {
        if !p.is_empty() {
            dialog = dialog.set_directory(p);
        }
    }
    dialog
        .pick_folder()
        .map(|p| p.to_string_lossy().to_string())
}

/// OS notification via the notification plugin.
#[tauri::command]
fn show_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_app_info() -> AppInfo {
    AppInfo {
        name: "Spok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        tauri_version: tauri::VERSION.into(),
        platform: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        family: std::env::consts::FAMILY.into(),
        identifier: "ai.x.spok".into(),
    }
}

/// Open a path or URL with the system default handler.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    open::that(&path).map_err(|e| e.to_string())
}

/// Reveal a file/folder in the platform file manager.
#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let p = std::path::Path::new(&path);
        let target = if p.is_dir() {
            path.clone()
        } else {
            p.parent()
                .map(|x| x.to_string_lossy().to_string())
                .unwrap_or(path.clone())
        };
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![
            pick_folder,
            show_notification,
            get_app_info,
            open_path,
            reveal_path,
        ])
        .setup(|app| {
            let _ = app.notification().request_permission();
            // Deep-link / protocol: argv may contain spok:// URLs when registered.
            let args: Vec<String> = std::env::args().collect();
            if let Some(url) = args.iter().find(|a| a.starts_with("spok://")) {
                let _ = app.emit("spok-deep-link", url.clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Spok");
}
