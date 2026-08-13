use std::{process::Stdio, time::Instant};

use chrono::Utc;
use tokio::{io::AsyncWriteExt, process::Command, time::timeout};
use uuid::Uuid;

use crate::{
    cli,
    models::{AnalysisRequest, AnalysisResult, AppSettings, ProviderProfile},
};

pub async fn analyze(
    request: AnalysisRequest,
    profile: ProviderProfile,
    settings: AppSettings,
) -> Result<AnalysisResult, String> {
    let started = Instant::now();
    let answer = match profile.kind.as_str() {
        "codex-cli" | "claude-cli" | "opencode-cli" | "grok-cli" => {
            run_cli(&profile, &request, &settings).await?
        }
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
    profile: &ProviderProfile,
    request: &AnalysisRequest,
    settings: &AppSettings,
) -> Result<String, String> {
    let executable = cli::resolve_profile_executable(profile)?;
    validate_evidence_for_profile(profile, request)?;
    let image_paths = if profile.kind == "codex-cli" || profile.kind == "claude-cli" {
        collect_image_paths(request)?
    } else {
        Vec::new()
    };
    if profile.kind == "claude-cli" && !image_paths.is_empty() {
        return Err(
            "Claude Code CLI 的本地图片附件通道尚未启用；请选择 Codex、OpenCode 或直接视觉 API。"
                .into(),
        );
    }
    if profile.kind == "grok-cli" && !collect_attachment_paths(request).is_empty() {
        return Err("Grok CLI 的本地附件内容块仍在适配中；当前可分析文字问题，请对图片、PDF 或视频选择 Codex、OpenCode 或直接视觉 API。".into());
    }

    let evidence_manifest = build_evidence_manifest(request);
    let video_instruction = if request.prompt_id == "video" {
        "For video evidence, reconstruct the sequence in timestamp order. Return: concise summary, key moments with timestamps, visible text or objects, audio limitations, and a customer-ready answer when relevant. Never claim continuous motion that the sampled frames do not prove."
    } else {
        "Use only the supplied evidence and distinguish direct observation from inference."
    };
    let language_instruction = language_instruction(settings);
    let style_instruction = style_instruction(settings);
    let custom_instruction = settings.custom_reply_instruction.trim();
    let prompt = format!(
        "You are LensQuery's read-only analyst. Do not execute commands, call tools, access the network, or modify files. {video_instruction} {language_instruction} {style_instruction}\nUser reply instruction: {custom_instruction}\n\nPreset: {}\nQuestion: {}\n\nEvidence manifest:\n{evidence_manifest}",
        request.prompt_id, request.question
    );

    let mut command = Command::new(&executable);
    match profile.kind.as_str() {
        "codex-cli" => {
            command.args([
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--ephemeral",
            ]);
            if profile.model != "default" && !profile.model.trim().is_empty() {
                command.arg("--model").arg(&profile.model);
            }
            for image_path in &image_paths {
                command.arg("--image").arg(image_path);
            }
            command.arg("-");
        }
        "claude-cli" => {
            command.args([
                "-p",
                "--output-format",
                "text",
                "--no-session-persistence",
                "--tools",
                "",
                "--disallowedTools",
                "mcp__*",
            ]);
            if profile.model != "default" && !profile.model.trim().is_empty() {
                command.arg("--model").arg(&profile.model);
            }
            command.arg(&prompt);
        }
        "opencode-cli" => {
            command.args(["run", "--format", "default"]);
            command.env(
                "OPENCODE_CONFIG_CONTENT",
                r#"{"permission":{"*":"deny"},"share":"disabled"}"#,
            );
            if profile.model != "default" && !profile.model.trim().is_empty() {
                command.arg("--model").arg(&profile.model);
            }
            for path in collect_attachment_paths(request) {
                command.arg("--file").arg(path);
            }
            command.arg(&prompt);
        }
        "grok-cli" => {
            command.args([
                "-p",
                &prompt,
                "--output-format",
                "plain",
                "--tools",
                "",
                "--disallowed-tools",
                "Agent,run_terminal_cmd,grep,read_file,search_replace,list_dir,web_search,web_fetch,todo_write,task",
                "--max-turns",
                "1",
                "--no-memory",
            ]);
            if profile.model != "default" && !profile.model.trim().is_empty() {
                command.arg("--model").arg(&profile.model);
            }
        }
        _ => return Err("未知 CLI 通道。".into()),
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 {}: {error}", executable.display()))?;
    if profile.kind == "codex-cli" {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex CLI 输入通道不可用。".to_string())?;
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|error| format!("写入 {} 输入失败: {error}", executable.display()))?;
    }

    let output = timeout(std::time::Duration::from_secs(90), child.wait_with_output())
        .await
        .map_err(|_| format!("{} 分析超时，已终止。", executable.display()))?
        .map_err(|error| format!("{} 运行失败: {error}", executable.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "{} 返回错误: {}",
            executable.display(),
            truncate(&stderr, 600)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err(format!("{} 没有返回可显示的文字。", executable.display()));
    }
    Ok(stdout)
}

fn collect_attachment_paths(request: &AnalysisRequest) -> Vec<String> {
    let mut paths = Vec::new();
    for file in &request.files {
        if let Some(preparation) = &file.video_preparation {
            paths.extend(preparation.frames.iter().map(|frame| frame.path.clone()));
        } else {
            paths.push(file.path.clone());
        }
    }
    paths
}

fn language_instruction(settings: &AppSettings) -> String {
    if settings.detect_customer_language {
        format!(
            "Detect the customer's primary language from their text and visible evidence. Reply in that language. When no customer language can be inferred, use the configured fallback language: {}.",
            settings.response_language
        )
    } else {
        format!(
            "Reply in the configured language: {}.",
            settings.response_language
        )
    }
}

fn style_instruction(settings: &AppSettings) -> &'static str {
    match settings.reply_style.as_str() {
        "concise" => "Keep the answer concise and action-oriented.",
        "detailed" => "Give a structured, detailed analysis and clearly mark uncertainty.",
        _ => "Write a polite, natural, customer-ready answer first, followed by brief analyst notes only when useful.",
    }
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

fn validate_evidence_for_profile(
    profile: &ProviderProfile,
    request: &AnalysisRequest,
) -> Result<(), String> {
    if !request.captures.is_empty() {
        return Err(
            "屏幕捕获到 CLI 的图片落盘通道尚未启用；请先使用本地文件或直接视觉 API。".into(),
        );
    }
    if profile.kind == "codex-cli" || profile.kind == "claude-cli" {
        let _ = collect_image_paths(request)?;
    } else {
        for file in &request.files {
            if file.kind == "video" && file.video_preparation.is_none() {
                return Err(format!("请先对视频 {} 执行“快速准备视频”。", file.name));
            }
        }
    }
    Ok(())
}

fn build_evidence_manifest(request: &AnalysisRequest) -> String {
    let mut lines = Vec::new();
    for file in &request.files {
        if let Some(preparation) = &file.video_preparation {
            lines.push(format!(
                "Video: {} | duration {:.2}s | sampled every {:.2}s | audio derivative: {}",
                file.name,
                preparation.original_duration_seconds,
                preparation.sample_interval_seconds,
                if preparation.audio_path.is_some() {
                    "present but not transcribed by this CLI route"
                } else {
                    "absent"
                }
            ));
            for (index, frame) in preparation.frames.iter().enumerate() {
                lines.push(format!(
                    "  Attached image {} = frame {} at {:.2}s",
                    index + 1,
                    frame.path,
                    frame.timestamp_seconds
                ));
            }
        } else {
            lines.push(format!("File: {} | type {}", file.name, file.media_type));
        }
    }
    if lines.is_empty() {
        "No file evidence; answer from the user's text only.".into()
    } else {
        lines.join("\n")
    }
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
        let manifest = build_evidence_manifest(&request);
        assert!(manifest.contains("at 0.00s"));
        assert!(manifest.contains("audio derivative: absent"));
    }

    #[test]
    fn automatic_language_policy_prefers_customer_language() {
        let settings = AppSettings::default();
        assert!(language_instruction(&settings).contains("customer's primary language"));
    }

    #[test]
    fn fixed_language_policy_uses_configured_language() {
        let settings = AppSettings {
            detect_customer_language: false,
            response_language: "ja-JP".into(),
            ..AppSettings::default()
        };
        assert!(language_instruction(&settings).contains("ja-JP"));
    }
}
