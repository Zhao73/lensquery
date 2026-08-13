mod browser_bridge;
mod capture;
mod cli;
mod commands;
mod files;
mod models;
mod providers;
mod secrets;
mod state;
mod video;

use commands::{
    analyze, bootstrap, cancel_capture, complete_capture, discover_cli_providers, inspect_files,
    prepare_video, probe_video, save_provider, save_settings, set_provider_secret, start_capture,
    test_provider,
};
use state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub(crate) fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn show_capture_overlay(app: &AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("capture")
        .ok_or_else(|| "取景窗口没有初始化。".to_string())?;
    let monitors = app
        .available_monitors()
        .map_err(|error| error.to_string())?;
    if !monitors.is_empty() {
        let min_x = monitors
            .iter()
            .map(|monitor| monitor.position().x)
            .min()
            .unwrap_or(0);
        let min_y = monitors
            .iter()
            .map(|monitor| monitor.position().y)
            .min()
            .unwrap_or(0);
        let max_x = monitors
            .iter()
            .map(|monitor| monitor.position().x + monitor.size().width as i32)
            .max()
            .unwrap_or(800);
        let max_y = monitors
            .iter()
            .map(|monitor| monitor.position().y + monitor.size().height as i32)
            .max()
            .unwrap_or(600);
        window
            .set_position(PhysicalPosition::new(min_x, min_y))
            .map_err(|error| error.to_string())?;
        window
            .set_size(PhysicalSize::new(
                (max_x - min_x).max(1) as u32,
                (max_y - min_y).max(1) as u32,
            ))
            .map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn request_capture(app: &AppHandle) -> Result<(), String> {
    app.emit_to("main", "lensquery://capture-requested", ())
        .map_err(|error| error.to_string())?;
    show_capture_overlay(app)
}

pub(crate) fn register_capture_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| format!("清理旧快捷键失败: {error}"))?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                let _ = request_capture(app);
            }
        })
        .map_err(|error| format!("注册快捷键 {shortcut} 失败: {error}"))
}

pub fn run_native_messaging_host() -> Result<(), String> {
    browser_bridge::run_native_host()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            bootstrap,
            discover_cli_providers,
            start_capture,
            complete_capture,
            cancel_capture,
            save_settings,
            save_provider,
            set_provider_secret,
            test_provider,
            probe_video,
            prepare_video,
            inspect_files,
            analyze
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let shortcut = app
                .state::<AppState>()
                .settings
                .lock()
                .map_err(|_| "设置存储被锁定。")?
                .shortcut
                .clone();
            register_capture_shortcut(app.handle(), &shortcut)?;

            let capture_item = MenuItem::with_id(app, "capture", "快速询问", true, None::<&str>)?;
            let open_item = MenuItem::with_id(app, "open", "打开会话", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 LensQuery", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&capture_item, &open_item, &quit_item])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("LensQuery · Ctrl+Shift+Space")
                .menu(&menu)
                .show_menu_on_left_click(true)
                .on_menu_event(|app, event| match event.id().0.as_str() {
                    "capture" => {
                        let _ = request_capture(app);
                    }
                    "open" => show_main_window(app),
                    "quit" => app.exit(0),
                    _ => {}
                });
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            tray.build(app)?;
            browser_bridge::start_queue_poller(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
