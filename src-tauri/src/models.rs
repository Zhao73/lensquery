use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub shortcut: String,
    pub language: String,
    pub save_history: bool,
    pub retain_images: bool,
    pub show_preview: bool,
    pub default_provider_id: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            shortcut: "CommandOrControl+Shift+Space".into(),
            language: "zh-CN".into(),
            save_history: true,
            retain_images: false,
            show_preview: true,
            default_provider_id: "openai".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderProfile {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub model: String,
    pub base_url: Option<String>,
    pub ready: bool,
    pub secret_configured: bool,
}

impl ProviderProfile {
    pub fn defaults() -> Vec<Self> {
        vec![
            Self {
                id: "openai".into(),
                name: "OpenAI".into(),
                kind: "openai".into(),
                model: "gpt-5".into(),
                base_url: Some("https://api.openai.com/v1".into()),
                ready: false,
                secret_configured: false,
            },
            Self {
                id: "anthropic".into(),
                name: "Anthropic".into(),
                kind: "anthropic".into(),
                model: "claude-sonnet-4-5".into(),
                base_url: Some("https://api.anthropic.com".into()),
                ready: false,
                secret_configured: false,
            },
            Self {
                id: "codex-cli".into(),
                name: "Codex CLI".into(),
                kind: "codex-cli".into(),
                model: "configured CLI model".into(),
                base_url: None,
                ready: executable_exists("codex"),
                secret_configured: true,
            },
            Self {
                id: "claude-cli".into(),
                name: "Claude Code".into(),
                kind: "claude-cli".into(),
                model: "configured CLI model".into(),
                base_url: None,
                ready: executable_exists("claude"),
                secret_configured: true,
            },
        ]
    }
}

fn executable_exists(name: &str) -> bool {
    let command = if cfg!(windows) { "where" } else { "which" };
    std::process::Command::new(command)
        .arg(name)
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub platform: String,
    pub version: String,
    pub providers: Vec<ProviderProfile>,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureEvidence {
    pub id: String,
    pub kind: String,
    pub preview_url: String,
    pub bounds: Bounds,
    pub window_title: Option<String>,
    pub process_name: Option<String>,
    pub accessible_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEvidence {
    pub id: String,
    pub name: String,
    pub path: String,
    pub media_type: String,
    pub size: u64,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequest {
    pub question: String,
    pub prompt_id: String,
    pub provider_id: String,
    pub captures: Vec<CaptureEvidence>,
    pub files: Vec<FileEvidence>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    pub id: String,
    pub answer: String,
    pub model: String,
    pub provider: String,
    pub created_at: String,
    pub duration_ms: u128,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureResponse {
    pub status: String,
    pub message: String,
    pub evidence: Option<CaptureEvidence>,
}
