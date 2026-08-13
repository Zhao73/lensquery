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
    if !request.files.is_empty() || !request.captures.is_empty() {
        return Err("CLI 图像与文件附件通道尚未启用；请选择直接 API，或先只发送文字问题。".into());
    }

    let prompt = format!(
        "You are LensQuery's read-only analyst. Do not execute commands or modify files. Answer the user's question concisely and distinguish observation from inference.\n\nPreset: {}\nQuestion: {}",
        request.prompt_id, request.question
    );

    let mut command = Command::new(executable);
    if is_codex {
        command.args(["exec", "--skip-git-repo-check", "-"]);
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

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}
