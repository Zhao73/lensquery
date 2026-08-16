use std::{collections::HashMap, io::Read};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{
    capture, cli, files,
    models::{AnalysisRequest, AppSettings, Bounds, CaptureSelection, ProviderProfile},
    providers, video,
};

const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarRequest {
    method: String,
    #[serde(default)]
    payload: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SidecarResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiscoverPayload {
    #[serde(default)]
    providers: Vec<ProviderProfile>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AnalyzePayload {
    request: AnalysisRequest,
    profile: ProviderProfile,
    settings: AppSettings,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathsPayload {
    paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PathPayload {
    path: String,
    #[serde(default)]
    max_frames: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UrlPayload {
    url: String,
    #[serde(default)]
    source_url: Option<String>,
    #[serde(default)]
    max_frames: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InspectTargetPayload {
    point: Bounds,
    #[serde(default)]
    text_scope: Option<String>,
    #[serde(default)]
    monitor_bounds: Option<Bounds>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompleteCapturePayload {
    selection: CaptureSelection,
}

pub fn run() -> Result<(), String> {
    let mut bytes = Vec::new();
    std::io::stdin()
        .take((MAX_REQUEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("读取 Electron sidecar 请求失败: {error}"))?;
    if bytes.is_empty() || bytes.len() > MAX_REQUEST_BYTES {
        return write_response(SidecarResponse {
            ok: false,
            result: None,
            error: Some("Electron sidecar 请求大小超出限制。".into()),
        });
    }
    let request: SidecarRequest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("Electron sidecar 请求格式错误: {error}"))?;
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| format!("创建 Electron sidecar 运行时失败: {error}"))?;
    let response = match runtime.block_on(dispatch(request)) {
        Ok(result) => SidecarResponse {
            ok: true,
            result: Some(result),
            error: None,
        },
        Err(error) => SidecarResponse {
            ok: false,
            result: None,
            error: Some(error),
        },
    };
    write_response(response)
}

async fn dispatch(request: SidecarRequest) -> Result<Value, String> {
    match request.method.as_str() {
        "discoverCliProviders" => {
            let payload: DiscoverPayload = decode(request.payload)?;
            let configured = payload
                .providers
                .into_iter()
                .map(|profile| (profile.id.clone(), profile))
                .collect::<HashMap<_, _>>();
            encode(cli::merge_discovered(
                &configured,
                cli::discover_profiles().await,
            ))
        }
        "analyze" => {
            let payload: AnalyzePayload = decode(request.payload)?;
            encode(
                providers::analyze(payload.request, payload.profile, payload.settings, None)
                    .await?,
            )
        }
        "inspectFiles" => {
            let payload: PathsPayload = decode(request.payload)?;
            encode(files::inspect(payload.paths).await?)
        }
        "probeVideo" => {
            let payload: PathPayload = decode(request.payload)?;
            encode(video::probe(&payload.path).await?)
        }
        "prepareVideo" => {
            let payload: PathPayload = decode(request.payload)?;
            encode(video::prepare(&payload.path, payload.max_frames).await?)
        }
        "prepareYouTubeVideo" => {
            let payload: UrlPayload = decode(request.payload)?;
            encode(video::prepare_youtube(&payload.url, payload.max_frames).await?)
        }
        "prepareWebVideo" => {
            let payload: UrlPayload = decode(request.payload)?;
            encode(
                video::prepare_web(
                    &payload.url,
                    payload.source_url.as_deref(),
                    payload.max_frames,
                )
                .await?,
            )
        }
        "inspectCaptureTarget" => {
            let payload: InspectTargetPayload = decode(request.payload)?;
            encode(
                capture::inspect_target(payload.point, payload.text_scope, payload.monitor_bounds)
                    .await?,
            )
        }
        "completeCapture" => {
            let payload: CompleteCapturePayload = decode(request.payload)?;
            encode(capture::complete(payload.selection).await?)
        }
        _ => Err(format!("未知 Electron sidecar 方法: {}", request.method)),
    }
}

fn decode<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, String> {
    serde_json::from_value(value).map_err(|error| format!("Electron sidecar 参数错误: {error}"))
}

fn encode<T: Serialize>(value: T) -> Result<Value, String> {
    serde_json::to_value(value).map_err(|error| format!("Electron sidecar 结果序列化失败: {error}"))
}

fn write_response(response: SidecarResponse) -> Result<(), String> {
    serde_json::to_writer(std::io::stdout().lock(), &response)
        .map_err(|error| format!("写入 Electron sidecar 结果失败: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_methods() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("runtime");
        let error = runtime
            .block_on(dispatch(SidecarRequest {
                method: "missing".into(),
                payload: Value::Null,
            }))
            .expect_err("unknown method must fail");
        assert!(error.contains("未知 Electron sidecar"));
    }
}
