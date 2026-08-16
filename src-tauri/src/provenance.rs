use std::{
    fs::File,
    io::{BufReader, Cursor, Read, Seek, SeekFrom, Write},
    path::Path,
};

use c2pa::{Context, Ingredient, Manifest, Reader, Relationship, Settings, ValidationState};
use exif::{In, Tag};
use flate2::read::ZlibDecoder;
use image::{imageops, GrayImage, ImageFormat, ImageReader, Limits, Luma};
use uuid::Uuid;

use crate::models::{
    C2paEvidence, ForensicVariant, ImageProvenance, MetadataEvidence, PromptEvidence,
};

const C2PA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TRUST-LIST.pem");
const C2PA_TSA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TSA-TRUST-LIST.pem");
const IMAGE_DETECTOR_COVERAGE: &str = "已在本机验证文件内嵌 C2PA Content Credentials 的文件绑定、签名和发行方信任，并自动读取 C2PA 标准提示词原料与 PNG prompt/parameters/workflow 元数据；不联网获取远程 manifest。同时读取常见 EXIF，并生成亮度拉伸、局部差分和 Alpha 通道取证图。这些变换可显示低对比度或透明度中仍存在的像素信号；已经完全压平且与背景像素完全相同的内容没有可恢复信息。厂商 SynthID 等不可见水印只在对应官方验证器可用时才能独立确认。未发现信号不证明内容由人类创作。";
const VIDEO_DETECTOR_COVERAGE: &str = "已在本机验证视频容器中内嵌 C2PA Content Credentials 的文件绑定、签名和发行方信任，不联网获取远程 manifest；同时读取 FFprobe 容器、编码器和时间信息。画面推断仅覆盖已抽取的带时间点关键帧；厂商 SynthID 等不可见水印只在对应官方验证器可用时才能独立确认。未发现信号不证明视频不是 AI 生成。";
const DOCUMENT_DETECTOR_COVERAGE: &str = "已自动检查文档是否包含可验证的 C2PA Content Credentials 及其标准提示词原料。普通复制文字没有跨厂商通用的公开水印；SynthID Text 等检测需要与生成时相同的私有配置或厂商验证器。文风、困惑度或所谓 AI 味只是统计推断，不作来源证明。";
const MAX_PROMPT_CHARS: usize = 32_000;
const MAX_PROMPT_BYTES: usize = MAX_PROMPT_CHARS * 4;
const MAX_PROMPT_RECORDS: usize = 12;
const MAX_PNG_METADATA_CHUNK_BYTES: usize = 4 * 1024 * 1024;

struct BoundedCursor {
    inner: Cursor<Vec<u8>>,
    limit: usize,
}

impl BoundedCursor {
    fn new(limit: usize) -> Self {
        Self {
            inner: Cursor::new(Vec::new()),
            limit,
        }
    }

    fn into_inner(self) -> Vec<u8> {
        self.inner.into_inner()
    }
}

impl Read for BoundedCursor {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        self.inner.read(buffer)
    }
}

impl Write for BoundedCursor {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let position = usize::try_from(self.inner.position()).unwrap_or(usize::MAX);
        if position.saturating_add(buffer.len()) > self.limit {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "embedded prompt exceeds the local evidence limit",
            ));
        }
        self.inner.write(buffer)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

impl Seek for BoundedCursor {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        let next = self.inner.seek(position)?;
        if next > self.limit as u64 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "embedded prompt seek exceeds the local evidence limit",
            ));
        }
        Ok(next)
    }
}

pub fn inspect_image(path: &str) -> Option<ImageProvenance> {
    inspect_media(path, true)
}

pub fn inspect_video(path: &str) -> Option<ImageProvenance> {
    inspect_media(path, false)
}

pub fn inspect_document(path: &str) -> Option<ImageProvenance> {
    let c2pa_result = read_c2pa(path);
    let (c2pa, prompt_evidence) = match c2pa_result {
        Some((evidence, prompts)) => (Some(evidence), prompts),
        None => (None, Vec::new()),
    };
    Some(ImageProvenance {
        ai_origin_status: Some(origin_status(c2pa.as_ref()).into()),
        c2pa,
        metadata: Vec::new(),
        ai_signals: Vec::new(),
        camera_metadata_present: false,
        forensic_variants: Vec::new(),
        prompt_recovery_status: Some(prompt_recovery_status(&prompt_evidence).into()),
        prompt_evidence,
        detector_coverage: DOCUMENT_DETECTOR_COVERAGE.into(),
    })
}

fn inspect_media(path: &str, include_image_forensics: bool) -> Option<ImageProvenance> {
    let metadata = if include_image_forensics {
        read_exif(path)
    } else {
        Vec::new()
    };
    let c2pa_result = read_c2pa(path);
    let (c2pa, mut prompt_evidence) = match c2pa_result {
        Some((evidence, prompts)) => (Some(evidence), prompts),
        None => (None, Vec::new()),
    };
    if include_image_forensics {
        for prompt in read_png_prompt_metadata(path) {
            push_prompt_unique(&mut prompt_evidence, prompt);
        }
    }

    let mut ai_signals = Vec::new();
    if let Some(manifest) = &c2pa {
        if manifest.ai_generated_declared {
            push_unique(
                &mut ai_signals,
                "C2PA 声明此内容来自训练型算法媒体（AI 生成）".into(),
            );
        }
        for source_type in &manifest.digital_source_types {
            push_unique(
                &mut ai_signals,
                format!("C2PA digitalSourceType={source_type}"),
            );
        }
        for agent in &manifest.software_agents {
            push_unique(&mut ai_signals, format!("C2PA softwareAgent={agent}"));
        }
        if manifest.embedded_watermark_declared {
            push_unique(&mut ai_signals, "C2PA 声明创建流程加入了不可见水印".into());
        }
    }

    let camera_metadata_present = metadata
        .iter()
        .any(|item| matches!(item.label.as_str(), "相机厂商" | "相机型号"));
    let ai_origin_status = Some(origin_status(c2pa.as_ref()).into());
    let forensic_variants = if include_image_forensics {
        generate_forensic_variants(path)
    } else {
        Vec::new()
    };
    Some(ImageProvenance {
        c2pa,
        metadata,
        ai_signals,
        camera_metadata_present,
        ai_origin_status,
        forensic_variants,
        prompt_recovery_status: Some(prompt_recovery_status(&prompt_evidence).into()),
        prompt_evidence,
        detector_coverage: if include_image_forensics {
            IMAGE_DETECTOR_COVERAGE
        } else {
            VIDEO_DETECTOR_COVERAGE
        }
        .into(),
    })
}

fn origin_status(c2pa: Option<&C2paEvidence>) -> &'static str {
    let Some(c2pa) = c2pa else {
        return "inconclusive";
    };
    if c2pa.validation_state == "invalid" {
        return "invalid-credential";
    }
    let source_types = c2pa
        .digital_source_types
        .iter()
        .map(|value| value.to_ascii_lowercase())
        .collect::<Vec<_>>();
    if source_types
        .iter()
        .any(|value| value == "trainedalgorithmicmedia")
    {
        return if c2pa.signer_trusted {
            "verified-ai"
        } else {
            "declared-ai"
        };
    }
    if source_types
        .iter()
        .any(|value| value == "compositewithtrainedalgorithmicmedia")
    {
        return if c2pa.signer_trusted {
            "verified-ai-edited"
        } else {
            "declared-ai"
        };
    }
    let camera_declared = source_types
        .iter()
        .any(|value| matches!(value.as_str(), "digitalcapture" | "computationalcapture"));
    if c2pa.signer_trusted && camera_declared {
        "verified-camera"
    } else {
        "inconclusive"
    }
}

fn prompt_recovery_status(prompts: &[PromptEvidence]) -> &'static str {
    if prompts
        .iter()
        .any(|prompt| prompt.trust_state == "trusted-c2pa" && prompt.exact_embedded_text)
    {
        "verified-exact"
    } else if prompts.iter().any(|prompt| prompt.exact_embedded_text) {
        "embedded-unverified"
    } else {
        "absent"
    }
}

fn read_c2pa_prompts(
    reader: &Reader,
    manifest: &Manifest,
    validation_state: ValidationState,
) -> Vec<PromptEvidence> {
    let trust_state = match validation_state {
        ValidationState::Trusted => "trusted-c2pa",
        ValidationState::Valid => "bound-untrusted-c2pa",
        ValidationState::Invalid => "invalid-c2pa",
    };
    let mut prompts = Vec::new();
    for ingredient in manifest.ingredients().iter().take(64) {
        if prompts.len() >= MAX_PROMPT_RECORDS {
            break;
        }
        if !is_prompt_ingredient(ingredient) {
            continue;
        }
        let Some(resource) = ingredient.data_ref() else {
            continue;
        };
        if !resource.format.to_ascii_lowercase().starts_with("text/") {
            continue;
        }
        let mut output = BoundedCursor::new(MAX_PROMPT_BYTES);
        if reader
            .resource_to_stream(&resource.identifier, &mut output)
            .is_err()
        {
            continue;
        }
        let bytes = output.into_inner();
        let Ok(value) = String::from_utf8(bytes) else {
            continue;
        };
        let text = bounded_prompt(&value);
        if text.is_empty() {
            continue;
        }
        push_prompt_unique(
            &mut prompts,
            PromptEvidence {
                source: ingredient
                    .title()
                    .filter(|title| !title.trim().is_empty())
                    .map(|title| format!("C2PA {title}"))
                    .unwrap_or_else(|| "C2PA prompt ingredient".into()),
                text,
                format: resource.format.clone(),
                trust_state: trust_state.into(),
                exact_embedded_text: value.chars().count() <= MAX_PROMPT_CHARS,
            },
        );
    }
    prompts
}

fn is_prompt_ingredient(ingredient: &Ingredient) -> bool {
    if ingredient.relationship() != &Relationship::InputTo {
        return false;
    }
    ingredient
        .data_types()
        .into_iter()
        .flatten()
        .chain(
            ingredient
                .data_ref()
                .and_then(|resource| resource.data_types.as_deref())
                .into_iter()
                .flatten(),
        )
        .any(|data_type| {
            data_type
                .asset_type
                .eq_ignore_ascii_case("c2pa.types.generator.prompt")
        })
}

fn read_png_prompt_metadata(path: &str) -> Vec<PromptEvidence> {
    let Ok(mut file) = File::open(path) else {
        return Vec::new();
    };
    let mut signature = [0_u8; 8];
    if file.read_exact(&mut signature).is_err() || signature != *b"\x89PNG\r\n\x1a\n" {
        return Vec::new();
    }
    let mut prompts = Vec::new();
    loop {
        let mut length_bytes = [0_u8; 4];
        if file.read_exact(&mut length_bytes).is_err() {
            break;
        }
        let length = u32::from_be_bytes(length_bytes) as usize;
        let mut kind = [0_u8; 4];
        if file.read_exact(&mut kind).is_err() {
            break;
        }
        let text_chunk = matches!(&kind, b"tEXt" | b"zTXt" | b"iTXt");
        if length > MAX_PNG_METADATA_CHUNK_BYTES || !text_chunk {
            if std::io::copy(
                &mut Read::by_ref(&mut file).take((length.saturating_add(4)) as u64),
                &mut std::io::sink(),
            )
            .is_err()
            {
                break;
            }
            if kind == *b"IEND" {
                break;
            }
            continue;
        }
        let mut data = vec![0_u8; length];
        let mut crc = [0_u8; 4];
        if file.read_exact(&mut data).is_err() || file.read_exact(&mut crc).is_err() {
            break;
        }
        let entry = match &kind {
            b"tEXt" => decode_png_text(&data),
            b"zTXt" => decode_png_compressed_text(&data),
            b"iTXt" => decode_png_international_text(&data),
            _ => None,
        };
        if let Some((keyword, value)) = entry {
            for prompt in prompt_records_from_metadata(&keyword, &value) {
                push_prompt_unique(&mut prompts, prompt);
                if prompts.len() >= MAX_PROMPT_RECORDS {
                    return prompts;
                }
            }
        }
        if kind == *b"IEND" {
            break;
        }
    }
    prompts
}

fn decode_png_text(data: &[u8]) -> Option<(String, String)> {
    let split = data.iter().position(|byte| *byte == 0)?;
    let keyword = String::from_utf8_lossy(&data[..split]).trim().to_string();
    let value = decode_metadata_text(&data[split + 1..]);
    Some((keyword, value))
}

fn decode_png_compressed_text(data: &[u8]) -> Option<(String, String)> {
    let split = data.iter().position(|byte| *byte == 0)?;
    if data.get(split + 1).copied()? != 0 {
        return None;
    }
    let value = inflate_bounded(data.get(split + 2..)?)?;
    Some((
        String::from_utf8_lossy(&data[..split]).trim().to_string(),
        value,
    ))
}

fn decode_png_international_text(data: &[u8]) -> Option<(String, String)> {
    let keyword_end = data.iter().position(|byte| *byte == 0)?;
    let compression_flag = *data.get(keyword_end + 1)?;
    let compression_method = *data.get(keyword_end + 2)?;
    if compression_flag > 1 || compression_method != 0 {
        return None;
    }
    let after_header = data.get(keyword_end + 3..)?;
    let language_end = after_header.iter().position(|byte| *byte == 0)?;
    let after_language = after_header.get(language_end + 1..)?;
    let translated_end = after_language.iter().position(|byte| *byte == 0)?;
    let text_bytes = after_language.get(translated_end + 1..)?;
    let value = if compression_flag == 1 {
        inflate_bounded(text_bytes)?
    } else {
        String::from_utf8(text_bytes.to_vec()).ok()?
    };
    Some((
        String::from_utf8_lossy(&data[..keyword_end])
            .trim()
            .to_string(),
        value,
    ))
}

fn inflate_bounded(bytes: &[u8]) -> Option<String> {
    let mut decoder = ZlibDecoder::new(bytes);
    let mut output = Vec::new();
    decoder
        .by_ref()
        .take((MAX_PROMPT_CHARS * 4 + 1) as u64)
        .read_to_end(&mut output)
        .ok()?;
    if output.len() > MAX_PROMPT_CHARS * 4 {
        return None;
    }
    String::from_utf8(output).ok()
}

fn decode_metadata_text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(value) => value.to_string(),
        Err(_) => bytes.iter().map(|byte| char::from(*byte)).collect(),
    }
}

fn prompt_records_from_metadata(keyword: &str, value: &str) -> Vec<PromptEvidence> {
    let key = keyword.trim().to_ascii_lowercase().replace([' ', '-'], "_");
    if !matches!(
        key.as_str(),
        "prompt"
            | "negative_prompt"
            | "parameters"
            | "generation_parameters"
            | "generation_data"
            | "workflow"
    ) {
        return Vec::new();
    }
    let mut values = Vec::new();
    if matches!(key.as_str(), "prompt" | "workflow") {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(value) {
            collect_comfy_prompt_text(&json, &mut values);
        }
    }
    if values.is_empty() {
        values.push((keyword.trim().to_string(), value.to_string()));
    }
    values
        .into_iter()
        .filter_map(|(label, value)| {
            let text = bounded_prompt(&value);
            (!text.is_empty()).then(|| PromptEvidence {
                source: format!("PNG {label}"),
                text,
                format: "text/plain".into(),
                trust_state: "untrusted-metadata".into(),
                exact_embedded_text: value.chars().count() <= MAX_PROMPT_CHARS,
            })
        })
        .collect()
}

fn collect_comfy_prompt_text(value: &serde_json::Value, prompts: &mut Vec<(String, String)>) {
    if prompts.len() >= MAX_PROMPT_RECORDS {
        return;
    }
    match value {
        serde_json::Value::Object(object) => {
            let class_type = object
                .get("class_type")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();
            if class_type.to_ascii_lowercase().contains("textencode") {
                if let Some(text) = object
                    .get("inputs")
                    .and_then(|inputs| inputs.get("text"))
                    .and_then(serde_json::Value::as_str)
                {
                    prompts.push((class_type.to_string(), text.to_string()));
                }
            }
            for (key, nested) in object {
                if prompts.len() >= MAX_PROMPT_RECORDS {
                    break;
                }
                if matches!(key.as_str(), "positive_prompt" | "negative_prompt") {
                    if let Some(text) = nested.as_str() {
                        prompts.push((key.clone(), text.to_string()));
                        continue;
                    }
                }
                collect_comfy_prompt_text(nested, prompts);
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                collect_comfy_prompt_text(item, prompts);
                if prompts.len() >= MAX_PROMPT_RECORDS {
                    break;
                }
            }
        }
        _ => {}
    }
}

fn bounded_prompt(value: &str) -> String {
    value
        .trim_matches(|character: char| character == '\0' || character.is_whitespace())
        .chars()
        .take(MAX_PROMPT_CHARS)
        .collect()
}

fn push_prompt_unique(prompts: &mut Vec<PromptEvidence>, prompt: PromptEvidence) {
    if prompts.len() < MAX_PROMPT_RECORDS
        && !prompts
            .iter()
            .any(|existing| existing.text == prompt.text && existing.source == prompt.source)
    {
        prompts.push(prompt);
    }
}

fn generate_forensic_variants(path: &str) -> Vec<ForensicVariant> {
    let mut reader = match ImageReader::open(path).and_then(|reader| reader.with_guessed_format()) {
        Ok(reader) => reader,
        Err(_) => return Vec::new(),
    };
    let mut limits = Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let Ok(decoded) = reader.decode() else {
        return Vec::new();
    };
    let source = decoded.thumbnail(2_048, 2_048).to_rgba8();
    if source.width() < 8 || source.height() < 8 {
        return Vec::new();
    }
    let directory = std::env::temp_dir()
        .join("lensquery")
        .join("forensics")
        .join(Uuid::new_v4().to_string());
    if std::fs::create_dir_all(&directory).is_err() {
        return Vec::new();
    }

    let gray = imageops::grayscale(&source);
    let mut variants = Vec::new();
    let (minimum, maximum) = grayscale_range(&gray);
    if maximum > minimum {
        let stretched = map_gray(&gray, |value| {
            (((value.saturating_sub(minimum)) as u16 * 255) / (maximum - minimum) as u16) as u8
        });
        push_variant(
            &mut variants,
            &directory,
            "contrast-stretch",
            "全局亮度拉伸",
            "放大接近背景颜色的微小亮度差，用于发现低对比度文字和图形。",
            &stretched,
        );
    }

    let blurred = imageops::blur(&gray, 5.0);
    let local_difference = GrayImage::from_fn(gray.width(), gray.height(), |x, y| {
        let source_value = gray.get_pixel(x, y)[0] as i16;
        let background = blurred.get_pixel(x, y)[0] as i16;
        let difference = (source_value - background).unsigned_abs().min(255) as u8;
        Luma([255_u8.saturating_sub(difference.saturating_mul(8))])
    });
    if grayscale_range(&local_difference).0 < 252 {
        push_variant(
            &mut variants,
            &directory,
            "local-difference",
            "局部背景差分",
            "消除缓慢变化的背景并放大微弱边缘，用于发现近同色文字、涂改和边界。",
            &local_difference,
        );
    }

    let alpha_min = source.pixels().map(|pixel| pixel[3]).min().unwrap_or(255);
    let alpha_max = source.pixels().map(|pixel| pixel[3]).max().unwrap_or(255);
    if alpha_min < 250 && alpha_max > alpha_min {
        let alpha = GrayImage::from_fn(source.width(), source.height(), |x, y| {
            Luma([source.get_pixel(x, y)[3]])
        });
        push_variant(
            &mut variants,
            &directory,
            "alpha-channel",
            "Alpha 透明度通道",
            "直接展示原文件的透明度信号，用于发现隐藏在透明度中的文字或图形。",
            &alpha,
        );
    }
    variants
}

fn grayscale_range(image: &GrayImage) -> (u8, u8) {
    image
        .pixels()
        .map(|pixel| pixel[0])
        .fold((u8::MAX, u8::MIN), |(minimum, maximum), value| {
            (minimum.min(value), maximum.max(value))
        })
}

fn map_gray(image: &GrayImage, mapper: impl Fn(u8) -> u8) -> GrayImage {
    GrayImage::from_fn(image.width(), image.height(), |x, y| {
        Luma([mapper(image.get_pixel(x, y)[0])])
    })
}

fn push_variant(
    variants: &mut Vec<ForensicVariant>,
    directory: &Path,
    kind: &str,
    label: &str,
    purpose: &str,
    image: &GrayImage,
) {
    let path = directory.join(format!("{kind}.png"));
    if image.save_with_format(&path, ImageFormat::Png).is_ok() {
        variants.push(ForensicVariant {
            kind: kind.into(),
            label: label.into(),
            path: path.to_string_lossy().into_owned(),
            preview_url: None,
            purpose: purpose.into(),
        });
    }
}

fn read_c2pa(path: &str) -> Option<(C2paEvidence, Vec<PromptEvidence>)> {
    let trust = format!("{C2PA_TRUST_ANCHORS}\n{C2PA_TSA_TRUST_ANCHORS}");
    let settings = Settings::new()
        .with_value("trust.trust_anchors", trust)
        .and_then(|settings| settings.with_value("verify.remote_manifest_fetch", false))
        .ok()?;
    let context = Context::new().with_settings(settings).ok()?;
    let reader = Reader::from_context(context).with_file(path).ok()?;
    let manifest = reader.active_manifest()?;

    let mut actions = Vec::new();
    let mut digital_source_types = Vec::new();
    let mut software_agents = Vec::new();
    for assertion in manifest.assertions() {
        if !assertion.label().starts_with("c2pa.actions") {
            continue;
        }
        let Ok(value) = assertion.value() else {
            continue;
        };
        let Some(items) = value.get("actions").and_then(|value| value.as_array()) else {
            continue;
        };
        for item in items {
            if let Some(action) = item.get("action").and_then(|value| value.as_str()) {
                push_unique(&mut actions, action.to_string());
            }
            if let Some(source_type) = item
                .get("digitalSourceType")
                .and_then(|value| value.as_str())
            {
                push_unique(&mut digital_source_types, short_identifier(source_type));
            }
            if let Some(agent) = item.get("softwareAgent") {
                if let Some(value) = software_agent_name(agent) {
                    push_unique(&mut software_agents, value);
                }
            }
        }
    }

    let claim_generator = manifest
        .claim_generator()
        .map(ToOwned::to_owned)
        .or_else(|| {
            manifest
                .claim_generator_info
                .as_ref()
                .and_then(|items| items.first())
                .map(|item| match &item.version {
                    Some(version) => format!("{} {version}", item.name),
                    None => item.name.clone(),
                })
        });
    let validation_state = reader.validation_state();
    let prompt_evidence = read_c2pa_prompts(&reader, manifest, validation_state);
    let validation_warnings = reader
        .validation_status()
        .unwrap_or_default()
        .iter()
        .filter(|status| !status.passed())
        .map(|status| match status.explanation() {
            Some(explanation) => format!("{}: {explanation}", status.code()),
            None => status.code().to_string(),
        })
        .collect::<Vec<_>>();
    let ai_generated_declared = digital_source_types
        .iter()
        .any(|value| value.eq_ignore_ascii_case("trainedAlgorithmicMedia"));
    let embedded_watermark_declared = actions
        .iter()
        .any(|value| value.to_ascii_lowercase().contains("watermarked"));

    Some((
        C2paEvidence {
            embedded: reader.is_embedded(),
            validation_state: match validation_state {
                ValidationState::Trusted => "trusted",
                ValidationState::Valid => "valid",
                ValidationState::Invalid => "invalid",
            }
            .into(),
            signer_trusted: validation_state == ValidationState::Trusted,
            issuer: manifest.issuer(),
            common_name: manifest.common_name(),
            claim_generator,
            signed_at: manifest.time(),
            actions,
            digital_source_types,
            software_agents,
            ai_generated_declared,
            embedded_watermark_declared,
            validation_warnings,
        },
        prompt_evidence,
    ))
}

fn read_exif(path: &str) -> Vec<MetadataEvidence> {
    let Ok(file) = File::open(Path::new(path)) else {
        return Vec::new();
    };
    let mut input = BufReader::new(file);
    let Ok(exif) = exif::Reader::new().read_from_container(&mut input) else {
        return Vec::new();
    };
    [
        (Tag::Make, "相机厂商"),
        (Tag::Model, "相机型号"),
        (Tag::Software, "处理软件"),
        (Tag::DateTimeOriginal, "拍摄时间"),
        (Tag::Artist, "作者"),
        (Tag::Copyright, "版权"),
    ]
    .into_iter()
    .filter_map(|(tag, label)| {
        let field = exif.get_field(tag, In::PRIMARY)?;
        let value = clean_metadata_value(&field.display_value().with_unit(&exif).to_string());
        (!value.is_empty()).then(|| MetadataEvidence {
            label: label.into(),
            value,
        })
    })
    .collect()
}

fn software_agent_name(value: &serde_json::Value) -> Option<String> {
    if let Some(name) = value.as_str() {
        return Some(name.to_string());
    }
    let name = value.get("name")?.as_str()?;
    Some(
        match value.get("version").and_then(|value| value.as_str()) {
            Some(version) => format!("{name} {version}"),
            None => name.to_string(),
        },
    )
}

fn short_identifier(value: &str) -> String {
    value
        .rsplit(['/', '#'])
        .find(|part| !part.is_empty())
        .unwrap_or(value)
        .to_string()
}

fn clean_metadata_value(value: &str) -> String {
    let normalized = value
        .replace('\0', " ")
        .trim_matches(|character: char| character.is_whitespace() || character == '\0')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    normalized
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(&normalized)
        .to_string()
}

fn push_unique(values: &mut Vec<String>, value: String) {
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c2pa_evidence(
        validation_state: &str,
        signer_trusted: bool,
        digital_source_types: &[&str],
    ) -> C2paEvidence {
        C2paEvidence {
            embedded: true,
            validation_state: validation_state.into(),
            signer_trusted,
            issuer: None,
            common_name: None,
            claim_generator: None,
            signed_at: None,
            actions: vec![],
            digital_source_types: digital_source_types
                .iter()
                .map(|value| (*value).into())
                .collect(),
            software_agents: vec![],
            ai_generated_declared: digital_source_types.contains(&"trainedAlgorithmicMedia"),
            embedded_watermark_declared: false,
            validation_warnings: vec![],
        }
    }

    #[test]
    fn shortens_digital_source_type_urls() {
        assert_eq!(
            short_identifier(
                "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia"
            ),
            "trainedAlgorithmicMedia"
        );
    }

    #[test]
    fn reads_software_agent_objects() {
        let value = serde_json::json!({"name": "gpt-image", "version": "2.0"});
        assert_eq!(
            software_agent_name(&value).as_deref(),
            Some("gpt-image 2.0")
        );
    }

    #[test]
    fn normalizes_metadata_whitespace() {
        assert_eq!(clean_metadata_value("  NIKON\0   E5200  "), "NIKON E5200");
    }

    #[test]
    fn only_trusted_bound_credentials_produce_verified_origin_verdicts() {
        assert_eq!(origin_status(None), "inconclusive");
        assert_eq!(
            origin_status(Some(&c2pa_evidence(
                "trusted",
                true,
                &["trainedAlgorithmicMedia"]
            ))),
            "verified-ai"
        );
        assert_eq!(
            origin_status(Some(&c2pa_evidence(
                "valid",
                false,
                &["trainedAlgorithmicMedia"]
            ))),
            "declared-ai"
        );
        assert_eq!(
            origin_status(Some(&c2pa_evidence("trusted", true, &["digitalCapture"]))),
            "verified-camera"
        );
        assert_eq!(
            origin_status(Some(&c2pa_evidence(
                "trusted",
                true,
                &["compositeWithTrainedAlgorithmicMedia"]
            ))),
            "verified-ai-edited"
        );
        assert_eq!(
            origin_status(Some(&c2pa_evidence(
                "trusted",
                true,
                &["algorithmicallyEnhanced"]
            ))),
            "inconclusive"
        );
        assert_eq!(
            origin_status(Some(&c2pa_evidence(
                "invalid",
                false,
                &["trainedAlgorithmicMedia"]
            ))),
            "invalid-credential"
        );
    }

    #[test]
    fn forensic_derivatives_amplify_real_low_contrast_pixels() {
        let fixture_directory =
            std::env::temp_dir().join(format!("lensquery-provenance-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&fixture_directory).expect("fixture directory");
        let fixture_path = fixture_directory.join("low-contrast.png");
        let mut fixture = GrayImage::from_pixel(160, 80, Luma([250]));
        for x in 20..140 {
            for y in 28..52 {
                if x % 14 < 3 || y % 12 < 2 {
                    fixture.put_pixel(x, y, Luma([247]));
                }
            }
        }
        fixture.save(&fixture_path).expect("save fixture");

        let variants = generate_forensic_variants(&fixture_path.to_string_lossy());
        let contrast = variants
            .iter()
            .find(|variant| variant.kind == "contrast-stretch")
            .expect("contrast variant");
        let enhanced = image::open(&contrast.path)
            .expect("read contrast derivative")
            .to_luma8();
        assert_eq!(grayscale_range(&enhanced), (0, 255));
        assert!(variants
            .iter()
            .any(|variant| variant.kind == "local-difference"));

        if let Some(parent) = Path::new(&contrast.path).parent() {
            let _ = std::fs::remove_dir_all(parent);
        }
        let _ = std::fs::remove_dir_all(fixture_directory);
    }

    #[test]
    fn extracts_exact_png_prompt_metadata_without_treating_it_as_trusted() {
        let records = prompt_records_from_metadata(
            "parameters",
            "a cobalt reading lens on a quiet desktop\nNegative prompt: glossy plastic",
        );
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].source, "PNG parameters");
        assert_eq!(records[0].trust_state, "untrusted-metadata");
        assert!(records[0].exact_embedded_text);
        assert_eq!(prompt_recovery_status(&records), "embedded-unverified");
    }

    #[test]
    fn reads_prompt_text_from_a_png_chunk() {
        let path =
            std::env::temp_dir().join(format!("lensquery-prompt-metadata-{}.png", Uuid::new_v4()));
        let data = b"parameters\0a ceramic fox in soft window light";
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"tEXt");
        png.extend_from_slice(data);
        png.extend_from_slice(&[0; 4]);
        png.extend_from_slice(&0_u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0; 4]);
        std::fs::write(&path, png).expect("write PNG metadata fixture");

        let records = read_png_prompt_metadata(&path.to_string_lossy());
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].text, "a ceramic fox in soft window light");
        assert_eq!(records[0].trust_state, "untrusted-metadata");

        std::fs::remove_file(path).expect("remove PNG metadata fixture");
    }

    #[test]
    fn extracts_comfyui_text_nodes_instead_of_dumping_the_workflow() {
        let records = prompt_records_from_metadata(
            "prompt",
            r#"{
              "1": {"class_type": "CLIPTextEncode", "inputs": {"text": "soft daylight product photo"}},
              "2": {"class_type": "KSampler", "inputs": {"seed": 42}}
            }"#,
        );
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].source, "PNG CLIPTextEncode");
        assert_eq!(records[0].text, "soft daylight product photo");
    }

    #[test]
    fn ignores_generic_png_comments_as_prompt_evidence() {
        assert!(prompt_records_from_metadata("Comment", "made for a customer").is_empty());
    }

    #[test]
    fn trusted_c2pa_prompt_is_the_only_verified_exact_recovery() {
        let prompt = PromptEvidence {
            source: "C2PA prompt".into(),
            text: "pirate with bird on shoulder".into(),
            format: "text/plain".into(),
            trust_state: "trusted-c2pa".into(),
            exact_embedded_text: true,
        };
        assert_eq!(prompt_recovery_status(&[prompt]), "verified-exact");
        assert_eq!(prompt_recovery_status(&[]), "absent");
    }
}
