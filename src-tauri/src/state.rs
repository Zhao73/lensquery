use std::{collections::HashMap, sync::Mutex};

use crate::models::{AppSettings, ProviderProfile};

pub struct AppState {
    pub settings: Mutex<AppSettings>,
    pub providers: Mutex<HashMap<String, ProviderProfile>>,
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
        }
    }
}
