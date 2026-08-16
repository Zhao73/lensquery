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
    pub default_analysis_mode: String,
    pub default_output_format: String,
    pub launch_at_startup: bool,
    pub notifications_enabled: bool,
    pub notification_preview: bool,
    pub result_presentation: String,
    pub voice_mode: String,
    pub auto_play_voice: bool,
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
            show_preview: false,
            default_provider_id: "openai".into(),
            default_analysis_mode: "explain".into(),
            default_output_format: "adaptive".into(),
            launch_at_startup: true,
            notifications_enabled: true,
            notification_preview: true,
            result_presentation: "notification".into(),
            voice_mode: "system".into(),
            auto_play_voice: false,
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
    #[serde(default)]
    pub models: Vec<ProviderModel>,
    #[serde(default)]
    pub model_discovery: Option<ProviderModelDiscovery>,
    pub capabilities: Option<ProviderCapabilities>,
    #[serde(default)]
    pub cli: Option<CliInstallation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModel {
    pub id: String,
    pub name: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderModelDiscovery {
    pub status: String,
    pub source: Option<String>,
    pub message: Option<String>,
    pub checked_at: Option<String>,
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
                models: Vec::new(),
                model_discovery: None,
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
                models: Vec::new(),
                model_discovery: None,
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
                models: Vec::new(),
                model_discovery: None,
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
                models: Vec::new(),
                model_discovery: None,
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
                models: Vec::new(),
                model_discovery: None,
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
                models: Vec::new(),
                model_discovery: None,
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
    #[serde(default)]
    pub source_path: Option<String>,
    #[serde(default)]
    pub text_scope: Option<String>,
    #[serde(default)]
    pub annotation: Option<String>,
    #[serde(default)]
    pub analysis_mode: Option<String>,
    #[serde(default)]
    pub output_format: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureTarget {
    pub bounds: Bounds,
    pub label: String,
    pub kind: String,
    pub source_path: Option<String>,
    pub accessible_text: Option<String>,
    pub fallback: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserContext {
    pub url: String,
    pub title: String,
    pub tag_name: String,
    pub role: Option<String>,
    pub text: Option<String>,
    pub accessible_name: Option<String>,
    pub selector: Option<String>,
    pub outer_html: Option<String>,
    pub nearby_text: Option<String>,
    #[serde(default)]
    pub selection_mode: Option<String>,
    #[serde(default)]
    pub selected_text: Option<String>,
    #[serde(default)]
    pub captions: Option<String>,
    #[serde(default)]
    pub transcript: Option<String>,
    #[serde(default)]
    pub transcript_language: Option<String>,
    #[serde(default)]
    pub transcript_cue_count: Option<u32>,
    #[serde(default)]
    pub transcript_truncated: bool,
    #[serde(default)]
    pub context_menu_kind: Option<String>,
    #[serde(default)]
    pub snapshot_data_url: Option<String>,
    #[serde(default)]
    pub snapshot_path: Option<String>,
    #[serde(default)]
    pub snapshot_preview_url: Option<String>,
    #[serde(default)]
    pub snapshot_bounds: Option<Bounds>,
    #[serde(default)]
    pub annotation: Option<String>,
    #[serde(default)]
    pub analysis_mode: Option<String>,
    #[serde(default)]
    pub output_format: Option<String>,
    #[serde(default)]
    pub hidden_content: Vec<HiddenContentEvidence>,
    #[serde(default)]
    pub hidden_content_scan: Option<HiddenContentScan>,
    pub media: Option<BrowserMediaContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenContentEvidence {
    pub text: String,
    pub reason: String,
    pub selector: Option<String>,
    pub instruction_like: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HiddenContentScan {
    pub scanned_elements: u32,
    pub truncated: bool,
    pub coverage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserMediaContext {
    pub kind: String,
    pub current_time: f64,
    pub duration: Option<f64>,
    pub source: Option<String>,
    pub paused: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    pub created_at: String,
    pub status: String,
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
    #[serde(default)]
    pub extracted_text: Option<String>,
    #[serde(default)]
    pub page_count: Option<u32>,
    #[serde(default)]
    pub extraction_status: Option<String>,
    #[serde(default)]
    pub provenance: Option<ImageProvenance>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageProvenance {
    pub c2pa: Option<C2paEvidence>,
    #[serde(default)]
    pub metadata: Vec<MetadataEvidence>,
    #[serde(default)]
    pub ai_signals: Vec<String>,
    pub camera_metadata_present: bool,
    #[serde(default)]
    pub ai_origin_status: Option<String>,
    #[serde(default)]
    pub forensic_variants: Vec<ForensicVariant>,
    pub detector_coverage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForensicVariant {
    pub kind: String,
    pub label: String,
    pub path: String,
    pub preview_url: Option<String>,
    pub purpose: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct C2paEvidence {
    pub embedded: bool,
    pub validation_state: String,
    pub signer_trusted: bool,
    pub issuer: Option<String>,
    pub common_name: Option<String>,
    pub claim_generator: Option<String>,
    pub signed_at: Option<String>,
    #[serde(default)]
    pub actions: Vec<String>,
    #[serde(default)]
    pub digital_source_types: Vec<String>,
    #[serde(default)]
    pub software_agents: Vec<String>,
    pub ai_generated_declared: bool,
    pub embedded_watermark_declared: bool,
    #[serde(default)]
    pub validation_warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataEvidence {
    pub label: String,
    pub value: String,
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
    pub container_format: Option<String>,
    pub encoder: Option<String>,
    pub creation_time: Option<String>,
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
    #[serde(default)]
    pub transcript: Option<String>,
    #[serde(default)]
    pub transcript_source: Option<String>,
    #[serde(default)]
    pub transcript_language: Option<String>,
    #[serde(default)]
    pub transcript_kind: Option<String>,
    #[serde(default)]
    pub transcription_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRequest {
    pub question: String,
    pub prompt_id: String,
    pub provider_id: String,
    pub captures: Vec<CaptureEvidence>,
    pub files: Vec<FileEvidence>,
    #[serde(default)]
    pub browser_context: Option<BrowserContext>,
    #[serde(default)]
    pub conversation: Vec<ConversationMessage>,
    #[serde(default = "default_analysis_mode")]
    pub analysis_mode: String,
    #[serde(default = "default_output_format")]
    pub output_format: String,
    #[serde(default)]
    pub annotation: Option<String>,
    #[serde(default)]
    pub extension_instructions: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub context_mode: Option<String>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureSelection {
    pub mode: String,
    pub bounds: Bounds,
    #[serde(default)]
    pub text_scope: Option<String>,
    #[serde(default)]
    pub annotation: Option<String>,
    #[serde(default)]
    pub analysis_mode: Option<String>,
    #[serde(default)]
    pub output_format: Option<String>,
}

fn default_analysis_mode() -> String {
    "explain".into()
}

fn default_output_format() -> String {
    "adaptive".into()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEvidenceEvent {
    pub capture: Option<CaptureEvidence>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<FileEvidence>,
    pub browser_context: Option<BrowserContext>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub analysis_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotation: Option<String>,
}
