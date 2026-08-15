use tauri::{AppHandle, Emitter, State};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPermissionStatus {
    screen_capture: bool,
    accessibility: bool,
}

use crate::{
    capture, cli, files,
    models::{
        AnalysisRequest, AnalysisResult, AppSettings, BootstrapState, Bounds, CaptureResponse,
        CaptureSelection, CaptureTarget, ProviderProfile, QueryEvidenceEvent, VideoMetadata,
        VideoPreparation,
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
    let (analysis_mode, text_scope) = if mode == "region" {
        ("explain", "screen")
    } else {
        ("identify", "object")
    };
    crate::request_capture_intent(&app, analysis_mode, text_scope)?;
    Ok(capture::started())
}

#[tauri::command]
pub async fn complete_capture(
    selection: CaptureSelection,
    app: AppHandle,
) -> Result<CaptureResponse, String> {
    crate::hide_capture_overlay(&app)?;
    tokio::time::sleep(std::time::Duration::from_millis(110)).await;
    match capture::complete(selection).await {
        Ok(response) => {
            let detected_files = match response
                .evidence
                .as_ref()
                .and_then(|evidence| evidence.source_path.clone())
            {
                Some(path) => files::inspect(vec![path]).await.unwrap_or_default(),
                None => Vec::new(),
            };
            app.emit_to(
                "main",
                "lensquery://evidence-ready",
                QueryEvidenceEvent {
                    capture: response.evidence.clone(),
                    files: detected_files,
                    browser_context: None,
                    analysis_mode: response
                        .evidence
                        .as_ref()
                        .and_then(|evidence| evidence.analysis_mode.clone()),
                    output_format: response
                        .evidence
                        .as_ref()
                        .and_then(|evidence| evidence.output_format.clone()),
                    annotation: response
                        .evidence
                        .as_ref()
                        .and_then(|evidence| evidence.annotation.clone()),
                },
            )
            .map_err(|error| format!("发送取景结果失败: {error}"))?;
            Ok(response)
        }
        Err(error) => {
            let _ = app.emit_to("main", "lensquery://capture-error", error.clone());
            let _ = crate::show_result_toast(&app, "LensQuery 读取失败", &error);
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn inspect_capture_target(
    point: Bounds,
    text_scope: Option<String>,
    app: AppHandle,
) -> Result<CaptureTarget, String> {
    crate::hide_capture_overlay(&app)?;
    tokio::time::sleep(std::time::Duration::from_millis(110)).await;
    let inspection = capture::inspect_target(point, text_scope, None).await;
    let restore = crate::show_capture_overlay(&app);
    match (inspection, restore) {
        (Ok(target), Ok(())) => Ok(target),
        (Err(error), Ok(())) => Err(error),
        (_, Err(error)) => Err(format!("恢复取景层失败: {error}")),
    }
}

#[tauri::command]
pub fn cancel_capture(app: AppHandle) -> Result<(), String> {
    crate::hide_capture_overlay(&app)
}

#[tauri::command]
pub fn show_main(app: AppHandle) {
    crate::show_main_window(&app);
}

#[tauri::command]
pub fn permission_status() -> DesktopPermissionStatus {
    #[cfg(target_os = "macos")]
    return DesktopPermissionStatus {
        screen_capture: crate::screen_capture_access_granted(),
        accessibility: crate::accessibility_access_granted(),
    };

    #[cfg(not(target_os = "macos"))]
    DesktopPermissionStatus {
        screen_capture: true,
        accessibility: true,
    }
}

#[tauri::command]
pub fn open_permission_settings(permission: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let destination = match permission.as_str() {
            "screen" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
            }
            "accessibility" => {
                "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
            }
            _ => return Err("不支持的系统权限页面。".into()),
        };
        std::process::Command::new("open")
            .arg(destination)
            .spawn()
            .map_err(|error| format!("打开系统设置失败: {error}"))?;
    }
    #[cfg(not(target_os = "macos"))]
    let _ = permission;
    Ok(())
}

#[tauri::command]
pub fn show_notification(title: String, body: String, app: AppHandle) -> Result<bool, String> {
    crate::show_result_toast(&app, &title, &body)?;
    Ok(true)
}

#[tauri::command]
pub fn hide_result_toast(app: AppHandle) -> Result<(), String> {
    crate::hide_result_toast_window(&app)
}

#[tauri::command]
pub fn open_result_from_toast(app: AppHandle) -> Result<(), String> {
    crate::hide_result_toast_window(&app)?;
    crate::show_main_window(&app);
    app.emit_to("main", "lensquery://navigate", "timeline")
        .map_err(|error| format!("打开会话时间线失败: {error}"))
}

#[tauri::command]
pub fn speak_text(text: String, state: State<'_, AppState>) -> Result<String, String> {
    let text = text.trim();
    if text.is_empty() {
        return Err("朗读内容不能为空。".into());
    }
    if text.chars().count() > 24_000 {
        return Err("一次最多朗读 24000 个字符。".into());
    }
    let mut speech = state
        .speech
        .lock()
        .map_err(|_| "语音进程被锁定。".to_string())?;
    if let Some(child) = speech.as_mut() {
        let _ = child.kill();
    }

    #[cfg(target_os = "macos")]
    let child = std::process::Command::new("/usr/bin/say")
        .arg(text)
        .spawn()
        .map_err(|error| format!("启动 macOS 系统朗读失败: {error}"))?;

    #[cfg(target_os = "windows")]
    let child = std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "$voice = New-Object -ComObject SAPI.SpVoice; [void]$voice.Speak($env:LENSQUERY_SPEECH_TEXT)",
        ])
        .env("LENSQUERY_SPEECH_TEXT", text)
        .spawn()
        .map_err(|error| format!("启动 Windows 系统朗读失败: {error}"))?;

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let child = std::process::Command::new("spd-say")
        .arg(text)
        .spawn()
        .map_err(|error| format!("启动系统朗读失败: {error}"))?;

    *speech = Some(child);
    Ok("system".into())
}

#[tauri::command]
pub fn stop_speaking(state: State<'_, AppState>) -> Result<(), String> {
    let mut speech = state
        .speech
        .lock()
        .map_err(|_| "语音进程被锁定。".to_string())?;
    if let Some(mut child) = speech.take() {
        let _ = child.kill();
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
        settings.default_analysis_mode.as_str(),
        "identify" | "explain" | "how-to" | "deep-dive" | "customer-reply" | "code"
    ) {
        return Err("默认分析方式不受支持。".into());
    }
    if !matches!(
        settings.default_output_format.as_str(),
        "adaptive" | "summary" | "steps" | "report" | "customer-reply" | "markdown"
    ) {
        return Err("默认回复格式不受支持。".into());
    }
    if !matches!(
        settings.voice_mode.as_str(),
        "off" | "system" | "codex-realtime"
    ) {
        return Err("语音模式不受支持。".into());
    }
    if !matches!(
        settings.result_presentation.as_str(),
        "notification" | "window" | "both"
    ) {
        return Err("结果呈现方式不受支持。".into());
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
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        let enabled = manager
            .is_enabled()
            .map_err(|error| format!("读取开机启动状态失败: {error}"))?;
        if settings.launch_at_startup && !enabled {
            manager
                .enable()
                .map_err(|error| format!("启用开机启动失败: {error}"))?;
        } else if !settings.launch_at_startup && enabled {
            manager
                .disable()
                .map_err(|error| format!("关闭开机启动失败: {error}"))?;
        }
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
    let should_show_window = settings.result_presentation != "notification";
    let cleanup_paths = if settings.retain_images {
        Vec::new()
    } else {
        request
            .captures
            .iter()
            .filter_map(|capture| capture.preview_url.strip_prefix("file://"))
            .map(std::path::PathBuf::from)
            .filter(|path| {
                path.parent()
                    .is_some_and(|parent| parent.ends_with("lensquery-captures"))
            })
            .collect::<Vec<_>>()
    };
    let result = providers::analyze(request, profile, settings).await;
    if !cleanup_paths.is_empty() {
        tauri::async_runtime::spawn(async move {
            // Keep the selected image available long enough for the conversation
            // evidence preview, while retaining the default ephemeral policy.
            tokio::time::sleep(std::time::Duration::from_secs(3_600)).await;
            for path in cleanup_paths {
                let _ = std::fs::remove_file(path);
            }
        });
    }
    if should_show_window {
        crate::show_main_window(&app);
    }
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
pub async fn prepare_youtube_video(
    url: String,
    max_frames: Option<u32>,
) -> Result<crate::models::FileEvidence, String> {
    video::prepare_youtube(&url, max_frames).await
}

#[tauri::command]
pub async fn inspect_files(paths: Vec<String>) -> Result<Vec<crate::models::FileEvidence>, String> {
    files::inspect(paths).await
}
