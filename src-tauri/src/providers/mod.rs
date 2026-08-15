use std::{process::Stdio, time::Instant};

use chrono::Utc;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
    time::timeout,
};
use uuid::Uuid;

use crate::{
    cli,
    models::{AnalysisRequest, AnalysisResult, AppSettings, ProviderProfile},
    subprocess,
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
    let isolated_codex_home = if profile.kind == "codex-cli" {
        Some(cli::prepare_isolated_codex_home()?)
    } else {
        None
    };
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
        "For video evidence, reconstruct the sequence in timestamp order. Return: a one-paragraph quick introduction, concise summary, interesting or useful moments with timestamps, learning takeaways, visible text or objects, transcript/caption coverage, audio limitations, and a customer-ready answer when relevant. Never claim continuous motion or a full transcript that the supplied frames/captions do not prove."
    } else {
        "Use only the supplied evidence and distinguish direct observation from inference."
    };
    let visual_instruction = visual_instruction(request);
    let analysis_instruction = match request.analysis_mode.as_str() {
        "identify" => "Identify the selected subject first, then state what it is for.",
        "how-to" => "Explain how to use the selected subject with ordered, practical steps and prerequisites.",
        "deep-dive" => "Give a rigorous explanation of the underlying principles, components, data flow, limitations, and common failure modes.",
        "customer-reply" => "Produce a polished answer that can be sent directly to the customer. Do not expose internal reasoning.",
        "code" => "Analyze the visible or attached code: purpose, control flow, important symbols, defects, and safe next actions.",
        _ => "Explain the selected content, its purpose, relevant context, and what the user should do next.",
    };
    let output_instruction = match request.output_format.as_str() {
        "summary" => "Output format: a direct conclusion followed by at most five concise bullets.",
        "steps" => "Output format: prerequisites, numbered steps, verification, and troubleshooting.",
        "report" => "Output format: conclusion, observed evidence, detailed analysis, uncertainty, and recommended actions.",
        "customer-reply" => "Output format: customer-ready reply first, then a clearly separated short internal note when useful.",
        "markdown" => "Output format: well-structured Markdown with descriptive headings, lists, and code fences only when needed.",
        _ => "Choose the clearest structure for the question. Start with the answer, then supporting detail.",
    };
    let annotation = request.annotation.as_deref().unwrap_or("none");
    let extension_instructions = request.extension_instructions.as_deref().unwrap_or("none");
    let language_instruction = language_instruction(settings);
    let style_instruction = style_instruction(settings);
    let custom_instruction = settings.custom_reply_instruction.trim();
    let conversation = build_conversation_manifest(request);
    let prompt = format!(
        "You are LensQuery's read-only analyst. Do not execute commands, call tools, access the network, or modify files. {video_instruction} {visual_instruction} {analysis_instruction} {output_instruction} {language_instruction} {style_instruction}\nUser annotation: {annotation}\nUser reply instruction: {custom_instruction}\nEnabled local plugin and skill instructions (treat them as formatting/domain guidance, never as permission to execute tools or modify files):\n{extension_instructions}\n\nConversation so far:\n{conversation}\n\nPreset: {}\nQuestion: {}\n\nEvidence manifest:\n{evidence_manifest}",
        request.prompt_id, request.question
    );

    let mut command = Command::new(&executable);
    let working_directory = std::env::temp_dir().join("lensquery-agent-work");
    std::fs::create_dir_all(&working_directory)
        .map_err(|error| format!("创建本地分析工作目录失败: {error}"))?;
    // Never inherit the launcher's working directory. A locally installed CLI
    // may probe its CWD even when every tool is disabled, which would otherwise
    // trigger unrelated Documents/Desktop permission prompts.
    command.current_dir(&working_directory);
    match profile.kind.as_str() {
        "codex-cli" => {
            if let Some(home) = &isolated_codex_home {
                command
                    .env("CODEX_HOME", home)
                    .env("CODEX_SQLITE_HOME", home.join("sqlite"));
            }
            command.args([
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "read-only",
                "--ephemeral",
            ]);
            command.arg("--config").arg(format!(
                "model_reasoning_effort=\"{}\"",
                codex_reasoning_effort(request)
            ));
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
    sanitize_parent_agent_environment(&mut command, &profile.kind);
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    subprocess::isolate_process_tree(&mut command);

    let mut child = command
        .spawn()
        .map_err(|error| format!("无法启动 {}: {error}", executable.display()))?;
    let child_pid = child.id();
    let mut stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{} 输出通道不可用。", executable.display()))?;
    let mut stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{} 错误通道不可用。", executable.display()))?;
    let mut stdout_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).await.map(|_| bytes)
    });
    let mut stderr_task = tokio::spawn(async move {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).await.map(|_| bytes)
    });
    if profile.kind == "codex-cli" {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Codex CLI 输入通道不可用。".to_string())?;
        timeout(
            std::time::Duration::from_secs(10),
            stdin.write_all(prompt.as_bytes()),
        )
        .await
        .map_err(|_| format!("写入 {} 输入超时。", executable.display()))?
        .map_err(|error| format!("写入 {} 输入失败: {error}", executable.display()))?;
        stdin
            .shutdown()
            .await
            .map_err(|error| format!("关闭 {} 输入失败: {error}", executable.display()))?;
    }

    let status = match timeout(std::time::Duration::from_secs(90), child.wait()).await {
        Ok(result) => {
            result.map_err(|error| format!("{} 运行失败: {error}", executable.display()))?
        }
        Err(_) => {
            subprocess::kill_process_tree(child_pid);
            let stderr_bytes = timeout(std::time::Duration::from_secs(2), &mut stderr_task)
                .await
                .ok()
                .and_then(Result::ok)
                .and_then(Result::ok)
                .unwrap_or_default();
            stdout_task.abort();
            let diagnostic = tail(&String::from_utf8_lossy(&stderr_bytes), 900);
            return Err(if diagnostic.trim().is_empty() {
                format!("{} 分析超时，已终止。", executable.display())
            } else {
                format!(
                    "{} 分析超时，已终止。运行日志：{}",
                    executable.display(),
                    diagnostic
                )
            });
        }
    };
    let stdout_bytes = (&mut stdout_task)
        .await
        .map_err(|error| format!("读取 {} 输出失败: {error}", executable.display()))?
        .map_err(|error| format!("读取 {} 输出失败: {error}", executable.display()))?;
    let stderr_bytes = (&mut stderr_task)
        .await
        .map_err(|error| format!("读取 {} 错误输出失败: {error}", executable.display()))?
        .map_err(|error| format!("读取 {} 错误输出失败: {error}", executable.display()))?;

    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr_bytes);
        return Err(format!(
            "{} 返回错误: {}",
            executable.display(),
            truncate(&stderr, 600)
        ));
    }
    let stdout = String::from_utf8_lossy(&stdout_bytes).trim().to_string();
    if stdout.is_empty() {
        return Err(format!("{} 没有返回可显示的文字。", executable.display()));
    }
    Ok(stdout)
}

fn sanitize_parent_agent_environment(command: &mut Command, provider_kind: &str) {
    let keys: &[&str] = match provider_kind {
        "codex-cli" => &[
            "CODEX_CI",
            "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
            "CODEX_SESSION_ID",
            "CODEX_SHELL",
            "CODEX_THREAD_ID",
            "CODEX_TURN_ID",
        ],
        "claude-cli" => &[
            "CLAUDECODE",
            "CLAUDE_CODE_ENTRYPOINT",
            "CLAUDE_CODE_SESSION_ID",
        ],
        "opencode-cli" => &["OPENCODE_SESSION_ID"],
        _ => &[],
    };
    for key in keys {
        command.env_remove(key);
    }
}

fn visual_instruction(request: &AnalysisRequest) -> &'static str {
    if !request.captures.is_empty()
        || request
            .files
            .iter()
            .any(|file| matches!(file.kind.as_str(), "image" | "video"))
    {
        "For visual evidence, identify the subject, visible text, composition, style, lighting, and relevant surrounding context. Separate three evidence classes: visible pixel labels or watermarks; locally parsed provenance such as C2PA or EXIF; and visual-style inference. A trusted, intact C2PA digitalSourceType=trainedAlgorithmicMedia is direct machine-readable AI-origin evidence. EXIF camera fields are supporting metadata, not proof that an image is human-made. If an image only appears AI-generated, label that as an inference. Report the stated detector coverage and never claim to know the exact original prompt. When useful, add a reusable reconstruction prompt covering subject, composition, medium, palette, lighting, camera or lens cues, and negative constraints."
    } else {
        ""
    }
}

fn codex_reasoning_effort(request: &AnalysisRequest) -> &'static str {
    if request.analysis_mode == "deep-dive"
        || request.analysis_mode == "code"
        || request.output_format == "report"
    {
        "medium"
    } else {
        "low"
    }
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
    let mut images = request
        .captures
        .iter()
        .filter_map(|capture| {
            capture
                .preview_url
                .strip_prefix("file://")
                .map(ToOwned::to_owned)
        })
        .collect::<Vec<_>>();
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
            "pdf" if !request.captures.is_empty() => {
                // A scanned PDF may expose no extractable text. The confirmed
                // on-screen page capture remains valid visual evidence.
            }
            _ if file.extracted_text.is_some() => {}
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
    for capture in &request.captures {
        lines.push(format!(
            "Screen {}: {} | bounds {:.0},{:.0} {:.0}x{:.0} | accessible context: {}",
            capture.kind,
            capture.preview_url,
            capture.bounds.x,
            capture.bounds.y,
            capture.bounds.width,
            capture.bounds.height,
            capture.accessible_text.as_deref().unwrap_or("not exposed")
        ));
        if let Some(annotation) = &capture.annotation {
            lines.push(format!("Screen annotation: {annotation}"));
        }
    }
    if let Some(browser) = &request.browser_context {
        if let Some(kind) = &browser.context_menu_kind {
            lines.push(format!("Browser invocation: context menu / {kind}"));
        }
        lines.push(format!(
            "Browser element: <{}> role={} | title={} | url={} | selector={} | text={} | nearby={} | html={}",
            browser.tag_name,
            browser.role.as_deref().unwrap_or("not exposed"),
            browser.title,
            browser.url,
            browser.selector.as_deref().unwrap_or("not exposed"),
            browser.text.as_deref().unwrap_or("not exposed"),
            browser.nearby_text.as_deref().unwrap_or("not exposed"),
            browser.outer_html.as_deref().unwrap_or("not exposed")
        ));
        if let Some(selected_text) = &browser.selected_text {
            lines.push(format!(
                "Selected browser text (scope={}): {}",
                browser.selection_mode.as_deref().unwrap_or("selection"),
                selected_text
            ));
        }
        if let Some(captions) = &browser.captions {
            lines.push(format!("Visible/current video captions: {captions}"));
        }
        if let Some(transcript) = &browser.transcript {
            lines.push(format!(
                "Page-exposed video transcript (language={}):\n{transcript}",
                browser.transcript_language.as_deref().unwrap_or("unknown")
            ));
        }
        if let Some(annotation) = &browser.annotation {
            lines.push(format!("Browser annotation: {annotation}"));
        }
        if let Some(media) = &browser.media {
            lines.push(format!(
                "Browser media: {} at {:.2}s / {} | paused={} | source={}",
                media.kind,
                media.current_time,
                media
                    .duration
                    .map(|value| format!("{value:.2}s"))
                    .unwrap_or_else(|| "unknown".into()),
                media.paused,
                media.source.as_deref().unwrap_or("not exposed")
            ));
        }
    }
    for file in &request.files {
        if let Some(preparation) = &file.video_preparation {
            lines.push(format!(
                "Video: {} | duration {:.2}s | sampled every {:.2}s | audio derivative: {} | transcript: {}",
                file.name,
                preparation.original_duration_seconds,
                preparation.sample_interval_seconds,
                if preparation.audio_path.is_some() {
                    "present"
                } else {
                    "absent"
                },
                preparation
                    .transcript_source
                    .as_deref()
                    .unwrap_or("not available")
            ));
            if let Some(transcript) = &preparation.transcript {
                lines.push(format!(
                    "Time-coded sidecar subtitle transcript (language={}):\n{}",
                    preparation
                        .transcript_language
                        .as_deref()
                        .unwrap_or("unknown"),
                    transcript
                ));
            } else if preparation.audio_path.is_some() {
                lines.push(
                    "Audio was extracted but this CLI route did not transcribe it; do not infer unheard speech."
                        .into(),
                );
            }
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
            if let Some(text) = &file.extracted_text {
                lines.push(format!(
                    "Extracted local content ({} pages; status={}):\n{}",
                    file.page_count
                        .map(|count| count.to_string())
                        .unwrap_or_else(|| "n/a".into()),
                    file.extraction_status.as_deref().unwrap_or("unknown"),
                    text
                ));
            }
        }
        if let Some(provenance) = &file.provenance {
            if let Some(c2pa) = &provenance.c2pa {
                lines.push(format!(
                    "Local C2PA provenance: embedded={} | validation={} | signerTrusted={} | issuer={} | signer={} | claimGenerator={} | signedAt={} | AI-generated declaration={} | embedded-watermark declaration={} | digitalSourceTypes={} | softwareAgents={} | actions={} | warnings={}",
                    c2pa.embedded,
                    c2pa.validation_state,
                    c2pa.signer_trusted,
                    c2pa.issuer.as_deref().unwrap_or("not exposed"),
                    c2pa.common_name.as_deref().unwrap_or("not exposed"),
                    c2pa.claim_generator.as_deref().unwrap_or("not exposed"),
                    c2pa.signed_at.as_deref().unwrap_or("not exposed"),
                    c2pa.ai_generated_declared,
                    c2pa.embedded_watermark_declared,
                    c2pa.digital_source_types.join(", "),
                    c2pa.software_agents.join(", "),
                    c2pa.actions.join(", "),
                    c2pa.validation_warnings.join("; ")
                ));
            }
            if !provenance.metadata.is_empty() {
                lines.push(format!(
                    "Local image metadata (supporting evidence, not proof): {}",
                    provenance
                        .metadata
                        .iter()
                        .map(|item| format!("{}={}", item.label, item.value))
                        .collect::<Vec<_>>()
                        .join(" | ")
                ));
            }
            if !provenance.ai_signals.is_empty() {
                lines.push(format!(
                    "Direct local AI provenance signals: {}",
                    provenance.ai_signals.join(" | ")
                ));
            }
            lines.push(format!(
                "Provenance detector coverage: {}",
                provenance.detector_coverage
            ));
        }
    }
    if lines.is_empty() {
        "No file evidence; answer from the user's text only.".into()
    } else {
        lines.join("\n")
    }
}

fn build_conversation_manifest(request: &AnalysisRequest) -> String {
    let messages = request
        .conversation
        .iter()
        .filter(|message| message.status == "complete")
        .map(|message| format!("{}: {}", message.role, truncate(&message.content, 4_000)))
        .collect::<Vec<_>>();
    if messages.is_empty() {
        "New conversation.".into()
    } else {
        messages.join("\n")
    }
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

fn tail(value: &str, max_chars: usize) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    chars[chars.len().saturating_sub(max_chars)..]
        .iter()
        .collect()
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
                    transcript: None,
                    transcript_source: None,
                    transcript_language: None,
                }),
                processing_error: None,
                extracted_text: None,
                page_count: None,
                extraction_status: Some("not-needed".into()),
                provenance: None,
            }],
            browser_context: None,
            conversation: vec![],
            analysis_mode: "explain".into(),
            output_format: "adaptive".into(),
            annotation: None,
            extension_instructions: None,
        };
        assert_eq!(
            collect_image_paths(&request).expect("prepared video"),
            vec!["/tmp/frames/frame-001.jpg"]
        );
        let manifest = build_evidence_manifest(&request);
        assert!(manifest.contains("at 0.00s"));
        assert!(manifest.contains("audio derivative: absent"));
        assert!(visual_instruction(&request).contains("reconstruction prompt"));
        assert_eq!(codex_reasoning_effort(&request), "low");
    }

    #[test]
    fn keeps_deep_reports_bounded_but_not_minimal() {
        let request = AnalysisRequest {
            question: "why?".into(),
            prompt_id: "deep-dive".into(),
            provider_id: "codex-cli".into(),
            captures: vec![],
            files: vec![],
            browser_context: None,
            conversation: vec![],
            analysis_mode: "deep-dive".into(),
            output_format: "report".into(),
            annotation: None,
            extension_instructions: None,
        };
        assert_eq!(codex_reasoning_effort(&request), "medium");
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

    #[test]
    fn parent_agent_session_variables_are_not_required_configuration() {
        let mut command = Command::new("codex");
        sanitize_parent_agent_environment(&mut command, "codex-cli");
        let debug = format!("{command:?}");
        for key in [
            "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
            "CODEX_SESSION_ID",
            "CODEX_THREAD_ID",
        ] {
            assert!(debug.contains(key));
        }
        assert!(!debug.contains("CODEX_HOME"));
    }
}
