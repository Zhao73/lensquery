use std::{process::Stdio, time::Instant};

use chrono::Utc;
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};
use uuid::Uuid;

use crate::models::{AnalysisRequest, AnalysisResult, ProviderProfile};

pub async fn analyze(
    request: AnalysisRequest,
    profile: ProviderProfile,
) -> Result<AnalysisResult, String> {
    let started = Instant::now();
    let answer = match profile.kind.as_str() {
        "codex-cli" => run_cli("codex", &request, true).await?,
        "claude-cli" => run_cli("claude", &request, false).await?,
        "openai" | "anthropic" | "compatible" => {
            return Err(format!(
                "{} 适配器已定义，但实时请求会在凭据保险库与出站预览完成后启用。当前不会上传内容。",
                profile.name
            ));
        }
        _ => return Err("未知模型提供商。".into()),
    };

    Ok(AnalysisResult {
        id: Uuid::new_v4().to_string(),
        answer,
        model: profile.model,
        provider: profile.name,
        created_at: Utc::now().to_rfc3339(),
        duration_ms: started.elapsed().as_millis(),
    })
}

async fn run_cli(
    executable: &str,
    request: &AnalysisRequest,
    is_codex: bool,
) -> Result<String, String> {
    let image_paths = collect_image_paths(request)?;
    if !is_codex && !image_paths.is_empty() {
        return Err(
            "Claude Code CLI 的本地图片附件通道尚未启用；请选择 Codex CLI 或直接视觉 API。".into(),
        );
    }

    let prompt = format!(
        "You are LensQuery's read-only analyst. Do not execute commands or modify files. Answer the user's question concisely and distinguish observation from inference.\n\nPreset: {}\nQuestion: {}",
        request.prompt_id, request.question
    );

    let mut command = Command::new(executable);
    if is_codex {
        command.args([
            "exec",
            "--skip-git-repo-check",
            "--sandbox",
            "read-only",
            "--ephemeral",
        ]);
        for image_path in &image_paths {
            command.arg("--image").arg(image_path);
        }
        command.arg("-");
    } else {
        command.args([
            "-p",
            "--output-format",
            "text",
            "--max-turns",
            "1",
            "--disallowedTools",
            "Bash,Edit,Write,NotebookEdit",
        ]);
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 {executable}: {error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|error| format!("写入 {executable} 输入失败: {error}"))?;
    }

    let output = timeout(std::time::Duration::from_secs(90), child.wait_with_output())
        .await
        .map_err(|_| format!("{executable} 分析超时，已终止。"))?
        .map_err(|error| format!("{executable} 运行失败: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("{executable} 返回错误: {}", truncate(&stderr, 600)));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err(format!("{executable} 没有返回可显示的文字。"));
    }
    Ok(stdout)
}

fn collect_image_paths(request: &AnalysisRequest) -> Result<Vec<String>, String> {
    if !request.captures.is_empty() {
        return Err(
            "屏幕捕获到 CLI 的图片落盘通道尚未启用；请先使用本地文件或直接视觉 API。".into(),
        );
    }
    let mut images = Vec::new();
    for file in &request.files {
        match file.kind.as_str() {
            "image" => images.push(file.path.clone()),
            "video" => {
                let preparation = file
                    .video_preparation
                    .as_ref()
                    .ok_or_else(|| format!("请先对视频 {} 执行“快速准备视频”。", file.name))?;
                images.extend(preparation.frames.iter().map(|frame| frame.path.clone()));
            }
            _ => {
                return Err(format!(
                    "CLI 当前只接收图片和已准备的视频关键帧；{} 需要直接 API 或后续文件解析器。",
                    file.name
                ));
            }
        }
    }
    Ok(images)
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{FileEvidence, VideoFrame, VideoPreparation};

    #[test]
    fn expands_prepared_video_into_frame_paths() {
        let request = AnalysisRequest {
            question: "what happens?".into(),
            prompt_id: "video".into(),
            provider_id: "codex-cli".into(),
            captures: vec![],
            files: vec![FileEvidence {
                id: "v".into(),
                name: "sample.mp4".into(),
                path: "/tmp/sample.mp4".into(),
                media_type: "video/mp4".into(),
                size: 1,
                kind: "video".into(),
                video: None,
                video_preparation: Some(VideoPreparation {
                    id: "p".into(),
                    source_path: "/tmp/sample.mp4".into(),
                    output_directory: "/tmp/frames".into(),
                    frames: vec![VideoFrame {
                        path: "/tmp/frames/frame-001.jpg".into(),
                        preview_url: None,
                        timestamp_seconds: 0.0,
                    }],
                    audio_path: None,
                    sample_interval_seconds: 1.0,
                    original_duration_seconds: 1.0,
                    strategy: "uniform-keyframes-v1".into(),
                }),
                processing_error: None,
            }],
        };
        assert_eq!(
            collect_image_paths(&request).expect("prepared video"),
            vec!["/tmp/frames/frame-001.jpg"]
        );
    }
}
