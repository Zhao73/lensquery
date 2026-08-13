// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|argument| argument == "--native-messaging-host") {
        if let Err(error) = lensquery_lib::run_native_messaging_host() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    lensquery_lib::run();
}
