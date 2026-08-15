use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::models::{Bounds, BrowserContext, CaptureEvidence, QueryEvidenceEvent};

const MAX_NATIVE_MESSAGE_BYTES: usize = 1_048_576;
const MAX_SNAPSHOT_DATA_URL_CHARS: usize = 700_000;
const MAX_SNAPSHOT_BYTES: usize = 520_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeRequest {
    r#type: String,
    context: BrowserContext,
}

#[derive(Debug, Serialize)]
struct NativeResponse<'a> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

pub fn run_native_host() -> Result<(), String> {
    let mut length_bytes = [0_u8; 4];
    std::io::stdin()
        .read_exact(&mut length_bytes)
        .map_err(|error| format!("读取浏览器消息长度失败: {error}"))?;
    let length = u32::from_le_bytes(length_bytes) as usize;
    if length == 0 || length > MAX_NATIVE_MESSAGE_BYTES {
        write_native_response(NativeResponse {
            ok: false,
            error: Some("message length is outside the accepted range"),
        })?;
        return Err("浏览器消息大小超出限制。".into());
    }
    let mut bytes = vec![0_u8; length];
    std::io::stdin()
        .read_exact(&mut bytes)
        .map_err(|error| format!("读取浏览器消息失败: {error}"))?;
    let mut request: NativeRequest =
        serde_json::from_slice(&bytes).map_err(|error| format!("浏览器消息格式错误: {error}"))?;
    if request.r#type != "browser-context" {
        write_native_response(NativeResponse {
            ok: false,
            error: Some("unsupported message type"),
        })?;
        return Err("浏览器消息类型不受支持。".into());
    }
    validate_context(&request.context)?;
    // Never accept a browser-supplied local path. Only a bounded data URL can
    // become a new temporary capture owned by LensQuery.
    request.context.snapshot_path = None;
    request.context.snapshot_preview_url = None;
    materialize_snapshot(&mut request.context)?;
    let directory = queue_directory();
    fs::create_dir_all(&directory).map_err(|error| format!("创建浏览器上下文队列失败: {error}"))?;
    let temporary = directory.join(format!("{}.tmp", uuid::Uuid::new_v4()));
    let destination = temporary.with_extension("json");
    fs::write(
        &temporary,
        serde_json::to_vec(&request.context)
            .map_err(|error| format!("序列化浏览器上下文失败: {error}"))?,
    )
    .map_err(|error| format!("写入浏览器上下文失败: {error}"))?;
    fs::rename(&temporary, &destination)
        .map_err(|error| format!("提交浏览器上下文失败: {error}"))?;
    write_native_response(NativeResponse {
        ok: true,
        error: None,
    })
}

pub fn start_queue_poller(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            poll_once(&app);
            tokio::time::sleep(std::time::Duration::from_millis(350)).await;
        }
    });
}

fn poll_once(app: &AppHandle) {
    let directory = queue_directory();
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    let mut paths = entries
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
        .collect::<Vec<_>>();
    paths.sort();
    for path in paths.into_iter().take(16) {
        let context = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<BrowserContext>(&bytes).ok());
        let _ = fs::remove_file(&path);
        if let Some(browser_context) = context {
            let capture = browser_context
                .snapshot_preview_url
                .as_ref()
                .filter(|_| browser_context.snapshot_path.is_some())
                .map(|preview_url| CaptureEvidence {
                    id: uuid::Uuid::new_v4().to_string(),
                    kind: "element".into(),
                    preview_url: preview_url.clone(),
                    bounds: browser_context.snapshot_bounds.clone().unwrap_or(Bounds {
                        x: 0.0,
                        y: 0.0,
                        width: 1.0,
                        height: 1.0,
                    }),
                    window_title: Some(browser_context.title.clone()),
                    process_name: Some("Browser".into()),
                    accessible_text: Some(format!(
                        "网页右键目标: {}",
                        browser_context
                            .context_menu_kind
                            .as_deref()
                            .unwrap_or("当前对象")
                    )),
                    source_path: None,
                    text_scope: Some(
                        match browser_context.context_menu_kind.as_deref() {
                            Some("selection") => "selection",
                            Some("page") => "page",
                            _ => "object",
                        }
                        .into(),
                    ),
                    annotation: browser_context.annotation.clone(),
                    analysis_mode: browser_context.analysis_mode.clone(),
                    output_format: browser_context.output_format.clone(),
                });
            let _ = app.emit_to(
                "main",
                "lensquery://evidence-ready",
                QueryEvidenceEvent {
                    capture,
                    files: Vec::new(),
                    analysis_mode: browser_context.analysis_mode.clone(),
                    output_format: browser_context.output_format.clone(),
                    annotation: browser_context.annotation.clone(),
                    browser_context: Some(browser_context),
                },
            );
        }
    }
}

fn validate_context(context: &BrowserContext) -> Result<(), String> {
    if context.url.len() > 16_384
        || context.title.len() > 2_000
        || context
            .text
            .as_ref()
            .is_some_and(|value| value.len() > 16_000)
        || context
            .nearby_text
            .as_ref()
            .is_some_and(|value| value.len() > 32_000)
        || context
            .outer_html
            .as_ref()
            .is_some_and(|value| value.len() > 64_000)
        || context
            .captions
            .as_ref()
            .is_some_and(|value| value.len() > 16_000)
        || context
            .transcript
            .as_ref()
            .is_some_and(|value| value.len() > 160_000)
        || context
            .snapshot_data_url
            .as_ref()
            .is_some_and(|value| value.len() > MAX_SNAPSHOT_DATA_URL_CHARS)
    {
        return Err("浏览器上下文超出边界。".into());
    }
    if context.snapshot_bounds.as_ref().is_some_and(|bounds| {
        bounds.x < 0.0
            || bounds.y < 0.0
            || bounds.width <= 0.0
            || bounds.height <= 0.0
            || bounds.width > 20_000.0
            || bounds.height > 20_000.0
    }) {
        return Err("浏览器截图范围超出边界。".into());
    }
    Ok(())
}

fn materialize_snapshot(context: &mut BrowserContext) -> Result<(), String> {
    let Some(data_url) = context.snapshot_data_url.take() else {
        return Ok(());
    };
    let (extension, bytes) = decode_snapshot_data_url(&data_url)?;
    let directory = std::env::temp_dir().join("lensquery-captures");
    fs::create_dir_all(&directory).map_err(|error| format!("创建网页截图目录失败: {error}"))?;
    let id = uuid::Uuid::new_v4();
    let temporary = directory.join(format!("{id}.tmp"));
    let destination = directory.join(format!("{id}.{extension}"));
    fs::write(&temporary, bytes).map_err(|error| format!("写入网页截图失败: {error}"))?;
    fs::rename(&temporary, &destination).map_err(|error| format!("提交网页截图失败: {error}"))?;
    let path = destination.to_string_lossy().replace('\\', "/");
    context.snapshot_path = Some(path.clone());
    context.snapshot_preview_url = Some(format!("file://{path}"));
    Ok(())
}

fn decode_snapshot_data_url(value: &str) -> Result<(&'static str, Vec<u8>), String> {
    let (header, payload) = value
        .split_once(',')
        .ok_or_else(|| "网页截图数据格式错误。".to_string())?;
    let extension = match header {
        "data:image/jpeg;base64" => "jpg",
        "data:image/png;base64" => "png",
        "data:image/webp;base64" => "webp",
        _ => return Err("网页截图类型不受支持。".into()),
    };
    let bytes = STANDARD
        .decode(payload)
        .map_err(|error| format!("解码网页截图失败: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_SNAPSHOT_BYTES {
        return Err("网页截图大小超出边界。".into());
    }
    let valid_signature = match extension {
        "jpg" => bytes.starts_with(&[0xff, 0xd8, 0xff]),
        "png" => bytes.starts_with(&[0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]),
        "webp" => bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP"),
        _ => false,
    };
    if !valid_signature {
        return Err("网页截图内容与声明类型不符。".into());
    }
    Ok((extension, bytes))
}

fn write_native_response(response: NativeResponse<'_>) -> Result<(), String> {
    let bytes = serde_json::to_vec(&response)
        .map_err(|error| format!("序列化 Native Messaging 响应失败: {error}"))?;
    let length = u32::try_from(bytes.len())
        .map_err(|_| "Native Messaging 响应超出长度限制。".to_string())?;
    let mut stdout = std::io::stdout().lock();
    stdout
        .write_all(&length.to_le_bytes())
        .and_then(|_| stdout.write_all(&bytes))
        .and_then(|_| stdout.flush())
        .map_err(|error| format!("写入 Native Messaging 响应失败: {error}"))
}

fn queue_directory() -> PathBuf {
    std::env::temp_dir().join("lensquery-native-messaging")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unbounded_browser_html() {
        let context = BrowserContext {
            url: "https://example.test".into(),
            title: "Example".into(),
            tag_name: "BUTTON".into(),
            role: Some("button".into()),
            text: None,
            accessible_name: None,
            selector: None,
            outer_html: Some("x".repeat(64_001)),
            nearby_text: None,
            selection_mode: None,
            selected_text: None,
            captions: None,
            transcript: None,
            transcript_language: None,
            context_menu_kind: None,
            snapshot_data_url: None,
            snapshot_path: None,
            snapshot_preview_url: None,
            snapshot_bounds: None,
            annotation: None,
            analysis_mode: None,
            output_format: None,
            media: None,
        };
        assert!(validate_context(&context).is_err());
    }

    #[test]
    fn accepts_only_bounded_image_snapshots() {
        let jpeg = format!(
            "data:image/jpeg;base64,{}",
            STANDARD.encode([0xff, 0xd8, 0xff, 0xd9])
        );
        let (extension, bytes) = decode_snapshot_data_url(&jpeg).expect("valid jpeg snapshot");
        assert_eq!(extension, "jpg");
        assert_eq!(bytes, [0xff, 0xd8, 0xff, 0xd9]);
        assert!(decode_snapshot_data_url("data:text/plain;base64,SGVsbG8=").is_err());
    }
}
