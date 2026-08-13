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
    analyze, bootstrap, discover_cli_providers, inspect_files, prepare_video, probe_video,
    save_provider, save_settings, set_provider_secret, start_capture, test_provider,
};
use state::AppState;

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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
