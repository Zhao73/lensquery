use tauri::State;

use crate::{
    capture,
    models::{
        AnalysisRequest, AnalysisResult, AppSettings, BootstrapState, CaptureResponse,
        ProviderProfile,
    },
    providers, secrets,
    state::AppState,
};

#[tauri::command]
pub fn bootstrap(state: State<'_, AppState>) -> Result<BootstrapState, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "设置存储被锁定。".to_string())?
        .clone();
    let providers = state
        .providers
        .lock()
        .map_err(|_| "模型存储被锁定。".to_string())?
        .values()
        .cloned()
        .collect();
    Ok(BootstrapState {
        platform: std::env::consts::OS.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        providers,
        settings,
    })
}

#[tauri::command]
pub fn start_capture(mode: String) -> Result<CaptureResponse, String> {
    if mode != "region" && mode != "element" {
        return Err("不支持的捕获模式。".into());
    }
    Ok(capture::start(&mode))
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
) -> Result<AppSettings, String> {
    if settings.shortcut.trim().is_empty() {
        return Err("快捷键不能为空。".into());
    }
    *state
        .settings
        .lock()
        .map_err(|_| "设置存储被锁定。".to_string())? = settings.clone();
    Ok(settings)
}

#[tauri::command]
pub fn save_provider(
    profile: ProviderProfile,
    state: State<'_, AppState>,
) -> Result<ProviderProfile, String> {
    if profile.name.trim().is_empty() || profile.model.trim().is_empty() {
        return Err("模型名称和模型 ID 不能为空。".into());
    }
    state
        .providers
        .lock()
        .map_err(|_| "模型存储被锁定。".to_string())?
        .insert(profile.id.clone(), profile.clone());
    Ok(profile)
}

#[tauri::command]
pub fn set_provider_secret(provider_id: String, secret: String) -> Result<bool, String> {
    if provider_id.trim().is_empty() || secret.trim().is_empty() {
        return Err("提供商和密钥不能为空。".into());
    }
    secrets::set(&provider_id, &secret)?;
    Ok(true)
}

#[tauri::command]
pub fn test_provider(profile: ProviderProfile) -> Result<String, String> {
    if profile.kind.ends_with("cli") {
        let executable = if profile.kind == "codex-cli" {
            "codex"
        } else {
            "claude"
        };
        let probe = if cfg!(windows) { "where" } else { "which" };
        let exists = std::process::Command::new(probe)
            .arg(executable)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false);
        return if exists {
            Ok(format!("已找到 {executable} 可执行文件。"))
        } else {
            Err(format!("没有在 PATH 中找到 {executable}。"))
        };
    }
    Err("直接 API 的无内容连接测试将在凭据保险库完成后启用。".into())
}

#[tauri::command]
pub async fn analyze(
    request: AnalysisRequest,
    state: State<'_, AppState>,
) -> Result<AnalysisResult, String> {
    let profile = state
        .providers
        .lock()
        .map_err(|_| "模型存储被锁定。".to_string())?
        .get(&request.provider_id)
        .cloned()
        .ok_or_else(|| "没有找到所选模型提供商。".to_string())?;
    providers::analyze(request, profile).await
}
