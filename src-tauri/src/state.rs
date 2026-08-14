use std::{
    collections::HashMap,
    process::Child,
    sync::{atomic::AtomicBool, Mutex},
};

use crate::models::{AppSettings, ProviderProfile};

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub providers: Mutex<HashMap<String, ProviderProfile>>,
    pub speech: Mutex<Option<Child>>,
    #[cfg(target_os = "macos")]
    pub capture_frontmost_pid: Mutex<Option<i32>>,
    #[cfg(target_os = "macos")]
    pub screen_capture_prompted: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        let providers = ProviderProfile::defaults()
            .into_iter()
            .map(|provider| (provider.id.clone(), provider))
            .collect();
        Self {
            settings: Mutex::new(AppSettings::default()),
            providers: Mutex::new(providers),
            speech: Mutex::new(None),
            #[cfg(target_os = "macos")]
            capture_frontmost_pid: Mutex::new(None),
            #[cfg(target_os = "macos")]
            screen_capture_prompted: AtomicBool::new(false),
        }
    }
}
