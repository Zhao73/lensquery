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
    prepare_video, probe_video, save_provider, save_settings, set_provider_secret, show_main,
    show_notification, speak_text, start_capture, stop_speaking, test_provider,
};
use state::AppState;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn shortcut_display(shortcut: &str) -> String {
    shortcut
        .split('+')
        .map(|part| match part {
            "CommandOrControl" => {
                if cfg!(target_os = "macos") {
                    "⌘"
                } else {
                    "Ctrl"
                }
            }
            "Command" => "⌘",
            "Control" if cfg!(target_os = "macos") => "⌃",
            "Control" => "Ctrl",
            "Shift" if cfg!(target_os = "macos") => "⇧",
            "Shift" => "Shift",
            "Alt" if cfg!(target_os = "macos") => "⌥",
            "Alt" => "Alt",
            other => other,
        })
        .collect::<Vec<_>>()
        .join(" ")
}

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

fn request_capture_intent(
    app: &AppHandle,
    analysis_mode: &str,
    text_scope: &str,
) -> Result<(), String> {
    app.emit_to(
        "capture",
        "lensquery://capture-intent",
        serde_json::json!({
            "analysisMode": analysis_mode,
            "outputFormat": "adaptive",
            "textScope": text_scope
        }),
    )
    .map_err(|error| error.to_string())?;
    request_capture(app)
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
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
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
            analyze,
            show_main,
            show_notification,
            speak_text,
            stop_speaking
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.handle()
                .set_activation_policy(tauri::ActivationPolicy::Accessory)?;
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
            let tray_tooltip = format!("LensQuery · {}", shortcut_display(&shortcut));

            {
                use tauri_plugin_autostart::ManagerExt;
                if app
                    .state::<AppState>()
                    .settings
                    .lock()
                    .map(|value| value.launch_at_startup)
                    .unwrap_or(false)
                {
                    let _ = app.autolaunch().enable();
                }
            }

            let capture_item = MenuItem::with_id(app, "capture", "快速询问…", true, None::<&str>)?;
            let explain_item =
                MenuItem::with_id(app, "explain", "解释所选内容", true, None::<&str>)?;
            let howto_item = MenuItem::with_id(app, "howto", "分析使用方法", true, None::<&str>)?;
            let deep_item = MenuItem::with_id(app, "deep", "深入分析原理", true, None::<&str>)?;
            let file_item = MenuItem::with_id(app, "file", "分析文件…", true, None::<&str>)?;
            let open_item = MenuItem::with_id(app, "open", "会话时间线", true, None::<&str>)?;
            let model_item = MenuItem::with_id(app, "models", "模型与智能体", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 LensQuery", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &capture_item,
                    &explain_item,
                    &howto_item,
                    &deep_item,
                    &file_item,
                    &open_item,
                    &model_item,
                    &settings_item,
                    &quit_item,
                ],
            )?;
            let tray_icon = tauri::include_image!("icons/tray-template-44.png");
            let _tray_icon_handle = TrayIconBuilder::new()
                .tooltip(&tray_tooltip)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .icon_as_template(cfg!(target_os = "macos"))
                .icon(tray_icon)
                .on_menu_event(|app, event| match event.id().0.as_str() {
                    "capture" => {
                        let _ = request_capture_intent(app, "identify", "object");
                    }
                    "explain" => {
                        let _ = request_capture_intent(app, "explain", "selection");
                    }
                    "howto" => {
                        let _ = request_capture_intent(app, "how-to", "object");
                    }
                    "deep" => {
                        let _ = request_capture_intent(app, "deep-dive", "page");
                    }
                    "file" => {
                        show_main_window(app);
                        let _ = app.emit_to("main", "lensquery://pick-files", ());
                    }
                    "open" => {
                        show_main_window(app);
                        let _ = app.emit_to("main", "lensquery://navigate", "timeline");
                    }
                    "models" => {
                        show_main_window(app);
                        let _ = app.emit_to("main", "lensquery://navigate", "providers");
                    }
                    "settings" => {
                        show_main_window(app);
                        let _ = app.emit_to("main", "lensquery://navigate", "settings");
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button,
                        button_state,
                        ..
                    } = event
                    {
                        if button == tauri::tray::MouseButton::Left
                            && button_state == tauri::tray::MouseButtonState::Up
                        {
                            let _ = request_capture_intent(tray.app_handle(), "identify", "object");
                        }
                    }
                })
                .build(app)?;
            #[cfg(target_os = "macos")]
            _tray_icon_handle.with_inner_tray_icon(|inner| {
                use objc2_foundation::{NSString, NSUserDefaults};

                // Give macOS a stable identity for Command-drag ordering. Seed a visible
                // right-side slot once so a new install is not placed behind a display notch.
                let autosave_name = NSString::from_str("LensQuery");
                let position_key = NSString::from_str("NSStatusItem Preferred Position LensQuery");
                let defaults = NSUserDefaults::standardUserDefaults();
                if defaults.objectForKey(&position_key).is_none() {
                    defaults.setDouble_forKey(180.0, &position_key);
                }

                if let Some(status_item) = inner.ns_status_item() {
                    status_item.setAutosaveName(Some(&autosave_name));
                }
            })?;
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
