use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    capture, cli, files,
    models::{
        AnalysisRequest, AnalysisResult, AppSettings, BootstrapState, CaptureResponse,
        CaptureSelection, ProviderProfile, QueryEvidenceEvent, VideoMetadata, VideoPreparation,
    },
    providers, secrets,
    state::AppState,
    video,
};

#[tauri::command]
pub async fn bootstrap(state: State<'_, AppState>) -> Result<BootstrapState, String> {
    let settings = state
        .settings
        .lock()
        .map_err(|_| "设置存储被锁定。".to_string())?
        .clone();
    let configured = state
        .providers
        .lock()
        .map_err(|_| "模型存储被锁定。".to_string())?
        .clone();
    let providers = cli::merge_discovered(&configured, cli::discover_profiles().await);
    {
        let mut stored = state
            .providers
            .lock()
            .map_err(|_| "模型存储被锁定。".to_string())?;
        *stored = providers
            .iter()
            .cloned()
            .map(|profile| (profile.id.clone(), profile))
            .collect();
    }
    Ok(BootstrapState {
        platform: std::env::consts::OS.into(),
        version: env!("CARGO_PKG_VERSION").into(),
        providers,
        settings,
    })
}

#[tauri::command]
pub async fn discover_cli_providers(
    state: State<'_, AppState>,
) -> Result<Vec<ProviderProfile>, String> {
    let configured = state
        .providers
        .lock()
        .map_err(|_| "模型存储被锁定。".to_string())?
        .clone();
    let providers = cli::merge_discovered(&configured, cli::discover_profiles().await);
    let mut stored = state
        .providers
        .lock()
        .map_err(|_| "模型存储被锁定。".to_string())?;
    *stored = providers
        .iter()
        .cloned()
        .map(|profile| (profile.id.clone(), profile))
        .collect();
    Ok(providers)
}

#[tauri::command]
pub fn start_capture(mode: String, app: AppHandle) -> Result<CaptureResponse, String> {
    if mode != "region" && mode != "element" {
        return Err("不支持的捕获模式。".into());
    }
    crate::request_capture(&app)?;
    Ok(capture::started())
}

#[tauri::command]
pub async fn complete_capture(
    selection: CaptureSelection,
    app: AppHandle,
) -> Result<CaptureResponse, String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.hide().map_err(|error| error.to_string())?;
    }
    tokio::time::sleep(std::time::Duration::from_millis(110)).await;
    match capture::complete(selection).await {
        Ok(response) => {
            app.emit_to(
                "main",
                "lensquery://evidence-ready",
                QueryEvidenceEvent {
                    capture: response.evidence.clone(),
                    browser_context: None,
                },
            )
            .map_err(|error| format!("发送取景结果失败: {error}"))?;
            Ok(response)
        }
        Err(error) => {
            crate::show_main_window(&app);
            let _ = app.emit_to("main", "lensquery://capture-error", error.clone());
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("capture") {
        window.hide().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn save_settings(
    settings: AppSettings,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AppSettings, String> {
    if settings.shortcut.trim().is_empty() {
        return Err("快捷键不能为空。".into());
    }
    if !matches!(settings.language.as_str(), "zh-CN" | "en") {
        return Err("界面语言不受支持。".into());
    }
    if !matches!(
        settings.response_language.as_str(),
        "zh-CN" | "en" | "ja-JP" | "ko-KR" | "es-ES" | "fr-FR" | "de-DE"
    ) {
        return Err("回复语言不受支持。".into());
    }
    if !matches!(
        settings.reply_style.as_str(),
        "concise" | "customer-ready" | "detailed"
    ) {
        return Err("回答风格不受支持。".into());
    }
    if settings.custom_reply_instruction.chars().count() > 1_000 {
        return Err("自定义回复要求最多 1000 个字符。".into());
    }
    crate::register_capture_shortcut(&app, &settings.shortcut)?;
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
        let executable = cli::resolve_profile_executable(&profile)?;
        let version = profile
            .cli
            .as_ref()
            .and_then(|value| value.version.as_deref())
            .unwrap_or("版本探测超时，但可执行文件存在");
        return Ok(format!("已找到 {} · {version}", executable.display()));
    }
    Err("直接 API 的无内容连接测试将在凭据保险库完成后启用。".into())
}

#[tauri::command]
pub async fn analyze(
    request: AnalysisRequest,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<AnalysisResult, String> {
    let profile = state
        .providers
        .lock()
        .map_err(|_| "模型存储被锁定。".to_string())?
        .get(&request.provider_id)
        .cloned()
        .ok_or_else(|| "没有找到所选模型提供商。".to_string())?;
    let settings = state
        .settings
        .lock()
        .map_err(|_| "设置存储被锁定。".to_string())?
        .clone();
    let result = providers::analyze(request, profile, settings).await;
    crate::show_main_window(&app);
    result
}

#[tauri::command]
pub async fn probe_video(path: String) -> Result<VideoMetadata, String> {
    video::probe(&path).await
}

#[tauri::command]
pub async fn prepare_video(
    path: String,
    max_frames: Option<u32>,
) -> Result<VideoPreparation, String> {
    video::prepare(&path, max_frames).await
}

#[tauri::command]
pub async fn inspect_files(paths: Vec<String>) -> Result<Vec<crate::models::FileEvidence>, String> {
    files::inspect(paths).await
}
