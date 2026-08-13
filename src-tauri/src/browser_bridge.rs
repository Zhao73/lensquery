use std::{
    fs,
    io::{Read, Write},
    path::PathBuf,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::models::{BrowserContext, QueryEvidenceEvent};

const MAX_NATIVE_MESSAGE_BYTES: usize = 1_048_576;

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
    let request: NativeRequest =
        serde_json::from_slice(&bytes).map_err(|error| format!("浏览器消息格式错误: {error}"))?;
    if request.r#type != "browser-context" {
        write_native_response(NativeResponse {
            ok: false,
            error: Some("unsupported message type"),
        })?;
        return Err("浏览器消息类型不受支持。".into());
    }
    validate_context(&request.context)?;
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
            let _ = app.emit_to(
                "main",
                "lensquery://evidence-ready",
                QueryEvidenceEvent {
                    capture: None,
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
    {
        return Err("浏览器上下文超出边界。".into());
    }
    Ok(())
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
            media: None,
        };
        assert!(validate_context(&context).is_err());
    }
}
