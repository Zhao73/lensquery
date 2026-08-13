use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AppSettings {
    pub shortcut: String,
    pub language: String,
    pub response_language: String,
    pub detect_customer_language: bool,
    pub reply_style: String,
    pub custom_reply_instruction: String,
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
            response_language: "zh-CN".into(),
            detect_customer_language: true,
            reply_style: "customer-ready".into(),
            custom_reply_instruction: String::new(),
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
    pub capabilities: Option<ProviderCapabilities>,
    #[serde(default)]
    pub cli: Option<CliInstallation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallation {
    pub command: String,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub status: String,
    pub auto_detected: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    pub vision: bool,
    pub pdf: bool,
    pub files: bool,
    pub video: bool,
    pub audio_transcription: bool,
    pub streaming: bool,
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
                capabilities: Some(ProviderCapabilities {
                    vision: true,
                    pdf: true,
                    files: true,
                    video: true,
                    audio_transcription: true,
                    streaming: true,
                }),
                cli: None,
            },
            Self {
                id: "anthropic".into(),
                name: "Anthropic".into(),
                kind: "anthropic".into(),
                model: "claude-sonnet-4-5".into(),
                base_url: Some("https://api.anthropic.com".into()),
                ready: false,
                secret_configured: false,
                capabilities: Some(ProviderCapabilities {
                    vision: true,
                    pdf: true,
                    files: true,
                    video: true,
                    audio_transcription: false,
                    streaming: true,
                }),
                cli: None,
            },
            Self {
                id: "codex-cli".into(),
                name: "Codex CLI".into(),
                kind: "codex-cli".into(),
                model: "default".into(),
                base_url: None,
                ready: false,
                secret_configured: false,
                capabilities: Some(ProviderCapabilities {
                    vision: true,
                    pdf: false,
                    files: false,
                    video: true,
                    audio_transcription: false,
                    streaming: false,
                }),
                cli: Some(CliInstallation::missing("codex")),
            },
            Self {
                id: "claude-cli".into(),
                name: "Claude Code".into(),
                kind: "claude-cli".into(),
                model: "default".into(),
                base_url: None,
                ready: false,
                secret_configured: false,
                capabilities: Some(ProviderCapabilities {
                    vision: false,
                    pdf: false,
                    files: false,
                    video: false,
                    audio_transcription: false,
                    streaming: false,
                }),
                cli: Some(CliInstallation::missing("claude")),
            },
            Self {
                id: "opencode-cli".into(),
                name: "OpenCode".into(),
                kind: "opencode-cli".into(),
                model: "default".into(),
                base_url: None,
                ready: false,
                secret_configured: false,
                capabilities: Some(ProviderCapabilities {
                    vision: true,
                    pdf: true,
                    files: true,
                    video: true,
                    audio_transcription: false,
                    streaming: false,
                }),
                cli: Some(CliInstallation::missing("opencode")),
            },
            Self {
                id: "grok-cli".into(),
                name: "Grok CLI".into(),
                kind: "grok-cli".into(),
                model: "grok-build".into(),
                base_url: None,
                ready: false,
                secret_configured: false,
                capabilities: Some(ProviderCapabilities {
                    vision: false,
                    pdf: false,
                    files: false,
                    video: false,
                    audio_transcription: false,
                    streaming: false,
                }),
                cli: Some(CliInstallation::missing("grok")),
            },
        ]
    }
}

impl CliInstallation {
    pub fn missing(command: &str) -> Self {
        Self {
            command: command.into(),
            executable_path: None,
            version: None,
            status: "missing".into(),
            auto_detected: true,
        }
    }
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
    pub video: Option<VideoMetadata>,
    pub video_preparation: Option<VideoPreparation>,
    pub processing_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub duration_seconds: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub frame_rate: Option<f64>,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub has_audio: bool,
    pub rotation: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoFrame {
    pub path: String,
    pub preview_url: Option<String>,
    pub timestamp_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoPreparation {
    pub id: String,
    pub source_path: String,
    pub output_directory: String,
    pub frames: Vec<VideoFrame>,
    pub audio_path: Option<String>,
    pub sample_interval_seconds: f64,
    pub original_duration_seconds: f64,
    pub strategy: String,
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
