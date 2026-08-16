mod browser_bridge;
mod capture;
mod cli;
mod commands;
mod electron_sidecar;
mod files;
mod models;
mod provenance;
mod providers;
mod secrets;
mod state;
mod subprocess;
mod video;

use commands::{
    analyze, bootstrap, cancel_capture, complete_capture, discover_cli_providers,
    hide_result_toast, inspect_capture_target, inspect_files, open_permission_settings,
    open_result_from_toast, permission_status, prepare_video, prepare_web_video,
    prepare_youtube_video, probe_video, save_provider, save_settings, set_provider_secret,
    show_main, show_notification, speak_text, start_capture, stop_speaking, test_provider,
};
use state::AppState;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
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
    #[cfg(target_os = "macos")]
    {
        let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
        use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};
        let _ = NSRunningApplication::currentApplication()
            .activateWithOptions(NSApplicationActivationOptions::empty());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ResultToastPayload {
    title: String,
    body: String,
}

fn truncate_text(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect()
}

fn result_toast_position(
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    toast_width: u32,
    scale_factor: f64,
) -> (i32, i32) {
    let edge = (18.0 * scale_factor).round() as i32;
    let menu_clearance = (38.0 * scale_factor).round() as i32;
    let right = monitor_x.saturating_add(monitor_width as i32);
    let x = right
        .saturating_sub(toast_width as i32)
        .saturating_sub(edge)
        .max(monitor_x);
    (x, monitor_y.saturating_add(menu_clearance))
}

pub(crate) fn show_result_toast(app: &AppHandle, title: &str, body: &str) -> Result<(), String> {
    let payload = ResultToastPayload {
        title: truncate_text(title, 120),
        body: truncate_text(body, 1_000),
    };
    if payload.title.is_empty() || payload.body.is_empty() {
        return Err("结果标题和内容不能为空。".into());
    }

    let window = app
        .get_webview_window("result-toast")
        .ok_or_else(|| "右上角结果窗口没有初始化。".to_string())?;
    if let Some(monitor) = app.primary_monitor().map_err(|error| error.to_string())? {
        let toast_size = window
            .outer_size()
            .unwrap_or_else(|_| PhysicalSize::new(392, 156));
        let (x, y) = result_toast_position(
            monitor.position().x,
            monitor.position().y,
            monitor.size().width,
            toast_size.width,
            monitor.scale_factor(),
        );
        window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|error| format!("定位右上角结果失败: {error}"))?;
    }
    window
        .set_always_on_top(true)
        .map_err(|error| format!("设置结果窗口置顶失败: {error}"))?;
    app.emit_to("result-toast", "lensquery://result-toast", payload)
        .map_err(|error| format!("发送右上角结果失败: {error}"))?;
    window
        .show()
        .map_err(|error| format!("显示右上角结果失败: {error}"))
}

pub(crate) fn hide_result_toast_window(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("result-toast") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
pub(crate) fn screen_capture_access_granted() -> bool {
    unsafe { CGPreflightScreenCaptureAccess() }
}

#[cfg(target_os = "macos")]
fn ensure_screen_capture_access(app: &AppHandle) -> Result<(), String> {
    use std::sync::atomic::Ordering;

    if screen_capture_access_granted() {
        app.state::<AppState>()
            .screen_capture_prompted
            .store(false, Ordering::Relaxed);
        return Ok(());
    }

    if app
        .state::<AppState>()
        .screen_capture_prompted
        .swap(true, Ordering::Relaxed)
    {
        return Err("录屏权限尚未生效。请在系统设置中允许 LensQuery，然后完全退出并重新打开应用；本次不再重复弹出系统请求。".into());
    }

    app.set_activation_policy(tauri::ActivationPolicy::Regular)
        .map_err(|error| error.to_string())?;
    activate_capture_app(app);
    let granted = unsafe { CGRequestScreenCaptureAccess() };
    if granted || screen_capture_access_granted() {
        return Ok(());
    }

    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
    restore_capture_frontmost_app(app);
    Err("需要先在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许 LensQuery，然后完全退出并重新打开。".into())
}

#[cfg(target_os = "macos")]
pub(crate) fn accessibility_access_granted() -> bool {
    unsafe { accessibility_sys::AXIsProcessTrusted() }
}

pub(crate) fn show_capture_overlay(app: &AppHandle) -> Result<(), String> {
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
    #[cfg(target_os = "macos")]
    app.set_activation_policy(tauri::ActivationPolicy::Regular)
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    {
        activate_capture_app(app);
        configure_capture_window_for_keyboard(&window)?;
    }
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn activate_capture_app(app: &AppHandle) {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication, NSWorkspace};

    let current = NSRunningApplication::currentApplication();
    if let Some(previous) = NSWorkspace::sharedWorkspace().frontmostApplication() {
        let previous_pid = previous.processIdentifier();
        if previous_pid > 0 && previous_pid != current.processIdentifier() {
            if let Ok(mut stored) = app.state::<AppState>().capture_frontmost_pid.lock() {
                *stored = Some(previous_pid);
            }
        }
    }
    let _ = current.activateWithOptions(NSApplicationActivationOptions::empty());
}

#[cfg(target_os = "macos")]
fn configure_capture_window_for_keyboard(window: &tauri::WebviewWindow) -> Result<(), String> {
    use objc2_app_kit::{NSView, NSWindow, NSWindowStyleMask, NSWindowTitleVisibility};

    let window_pointer = window.ns_window().map_err(|error| error.to_string())?;
    let view_pointer = window.ns_view().map_err(|error| error.to_string())?;
    let native_window = unsafe { &*window_pointer.cast::<NSWindow>() };
    let native_view = unsafe { &*view_pointer.cast::<NSView>() };
    native_window.setStyleMask(
        native_window.styleMask()
            | NSWindowStyleMask::Titled
            | NSWindowStyleMask::FullSizeContentView,
    );
    native_window.setTitleVisibility(NSWindowTitleVisibility::Hidden);
    native_window.setTitlebarAppearsTransparent(true);
    native_window.makeKeyAndOrderFront(None);
    if !native_window.makeFirstResponder(Some(native_view)) {
        return Err("取景窗口没有取得键盘焦点。".into());
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn install_capture_escape_monitor(app: &AppHandle) -> Result<(), String> {
    use std::ptr::NonNull;

    use block2::RcBlock;
    use objc2_app_kit::{NSEvent, NSEventMask};

    // AppKit's local monitor receives keyboard events before the borderless
    // WebView. This keeps Escape deterministic after global-shortcut activation.
    let app = app.clone();
    let block: RcBlock<dyn Fn(NonNull<NSEvent>) -> *mut NSEvent> =
        RcBlock::new(move |event: NonNull<NSEvent>| {
            let event_ref = unsafe { event.as_ref() };
            let capture_is_visible = app
                .get_webview_window("capture")
                .and_then(|window| window.is_visible().ok())
                .unwrap_or(false);
            if event_ref.keyCode() == 53 && capture_is_visible {
                let _ = hide_capture_overlay(&app);
                std::ptr::null_mut()
            } else {
                event.as_ptr()
            }
        });
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block)
    }
    .ok_or_else(|| "macOS Esc 取景监听器初始化失败。".to_string())?;
    // Retain both the monitor token and block until process exit.
    std::mem::forget(monitor);
    std::mem::forget(block);
    Ok(())
}

#[cfg(target_os = "macos")]
fn restore_capture_frontmost_app(app: &AppHandle) {
    use objc2_app_kit::{NSApplicationActivationOptions, NSRunningApplication};

    let previous_pid = app
        .state::<AppState>()
        .capture_frontmost_pid
        .lock()
        .ok()
        .and_then(|mut value| value.take());
    if let Some(previous) =
        previous_pid.and_then(NSRunningApplication::runningApplicationWithProcessIdentifier)
    {
        let _ = previous.activateWithOptions(NSApplicationActivationOptions::empty());
    }
}

pub(crate) fn hide_capture_overlay(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.hide().map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        app.set_activation_policy(tauri::ActivationPolicy::Accessory)
            .map_err(|error| error.to_string())?;
        restore_capture_frontmost_app(app);
    }
    Ok(())
}

pub(crate) fn request_capture(app: &AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if let Err(error) = ensure_screen_capture_access(app) {
        let _ = show_result_toast(app, "LensQuery 需要屏幕读取权限", &error);
        return Err(error);
    }
    app.emit_to("main", "lensquery://capture-requested", ())
        .map_err(|error| error.to_string())?;
    app.emit_to("capture", "lensquery://capture-requested", ())
        .map_err(|error| error.to_string())?;
    show_capture_overlay(app)
}

pub(crate) fn request_capture_intent(app: &AppHandle, text_scope: &str) -> Result<(), String> {
    request_capture_selection_intent(app, text_scope, "auto")
}

fn request_capture_selection_intent(
    app: &AppHandle,
    text_scope: &str,
    selection_mode: &str,
) -> Result<(), String> {
    app.emit_to(
        "capture",
        "lensquery://capture-intent",
        serde_json::json!({
            "textScope": text_scope,
            "selectionMode": selection_mode
        }),
    )
    .map_err(|error| error.to_string())?;
    request_capture(app)
}

pub(crate) fn request_default_capture(app: &AppHandle) -> Result<(), String> {
    request_capture_selection_intent(app, "object", "auto")
}

pub(crate) fn register_capture_shortcut(app: &AppHandle, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .unregister_all()
        .map_err(|error| format!("清理旧快捷键失败: {error}"))?;
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _, event| {
            if event.state == ShortcutState::Pressed {
                let _ = request_default_capture(app);
            }
        })
        .map_err(|error| format!("注册快捷键 {shortcut} 失败: {error}"))
}

pub fn run_native_messaging_host() -> Result<(), String> {
    browser_bridge::run_native_host()
}

pub fn run_electron_sidecar() -> Result<(), String> {
    electron_sidecar::run()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
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
            inspect_capture_target,
            permission_status,
            open_permission_settings,
            cancel_capture,
            save_settings,
            save_provider,
            set_provider_secret,
            test_provider,
            probe_video,
            prepare_video,
            prepare_web_video,
            prepare_youtube_video,
            inspect_files,
            analyze,
            show_main,
            show_notification,
            hide_result_toast,
            open_result_from_toast,
            speak_text,
            stop_speaking
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                app.handle()
                    .set_activation_policy(tauri::ActivationPolicy::Accessory)?;
                restore_capture_frontmost_app(app.handle());
                install_capture_escape_monitor(app.handle())?;
            }
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
            let tray_tooltip = format!(
                "LensQuery · 左键开始识别 · 右键打开菜单 · {}",
                shortcut_display(&shortcut)
            );

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

            let capture_item = MenuItem::with_id(app, "capture", "开始识别", true, None::<&str>)?;
            let file_item =
                MenuItem::with_id(app, "pick-files", "选择文件分析…", true, None::<&str>)?;
            let open_item = MenuItem::with_id(app, "open", "会话时间线", true, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "设置…", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 LensQuery", true, None::<&str>)?;
            let app_separator = PredefinedMenuItem::separator(app)?;
            let quit_separator = PredefinedMenuItem::separator(app)?;
            let menu = Menu::with_items(
                app,
                &[
                    &capture_item,
                    &file_item,
                    &app_separator,
                    &open_item,
                    &settings_item,
                    &quit_separator,
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
                        let _ = request_default_capture(app);
                    }
                    "pick-files" => {
                        let _ = app.emit_to("main", "lensquery://pick-files", ());
                    }
                    "open" => {
                        show_main_window(app);
                        let _ = app.emit_to("main", "lensquery://navigate", "timeline");
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
                            let _ = request_default_capture(tray.app_handle());
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
                    #[cfg(target_os = "macos")]
                    let _ = window
                        .app_handle()
                        .set_activation_policy(tauri::ActivationPolicy::Accessory);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::{result_toast_position, truncate_text};

    #[test]
    fn result_toast_stays_inside_primary_monitor() {
        assert_eq!(result_toast_position(0, 0, 1_920, 392, 1.0), (1_510, 38));
        assert_eq!(
            result_toast_position(-1_440, -180, 1_440, 784, 2.0),
            (-820, -104)
        );
    }

    #[test]
    fn result_toast_handles_a_monitor_narrower_than_the_window() {
        assert_eq!(result_toast_position(80, 20, 300, 392, 1.0), (80, 58));
    }

    #[test]
    fn result_toast_text_is_trimmed_and_bounded() {
        assert_eq!(truncate_text("  分析完成  ", 4), "分析完成");
        assert_eq!(truncate_text("abcdef", 3), "abc");
    }
}
