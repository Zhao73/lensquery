use std::{
    collections::BTreeSet,
    fs::File,
    io::{BufReader, Cursor, Read, Seek, SeekFrom, Write},
    path::Path,
    sync::OnceLock,
};

use c2pa::{Context, Ingredient, Manifest, Reader, Relationship, Settings, ValidationState};
use exif::{In, Tag};
use flate2::read::ZlibDecoder;
use image::{imageops, GrayImage, ImageFormat, ImageReader, Limits, Luma};
use uuid::Uuid;

use crate::models::{
    C2paEvidence, ForensicVariant, ImageProvenance, MetadataEvidence, PromptEvidence,
    RegulatoryMarkEvidence, SoftBindingEvidence, UndisclosedWatermarkScan, WatermarkCoverage,
};

const C2PA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TRUST-LIST.pem");
const C2PA_TSA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TSA-TRUST-LIST.pem");
const SOFT_BINDING_ALGORITHM_LIST: &str =
    include_str!("../resources/c2pa/softbinding-algorithm-list.json");
const SOFT_BINDING_REGISTRY_SOURCE: &str = "https://github.com/c2pa-org/softbinding-algorithm-list";
const SOFT_BINDING_REGISTRY_COMMIT: &str = "e69956c68556788f0c3f52fef9c2ba42d9904964";
const IMAGE_DETECTOR_COVERAGE: &str = "已在本机验证文件内嵌 C2PA Content Credentials 的文件绑定、签名和发行方信任，并自动读取 C2PA 标准提示词原料、PNG prompt/parameters/workflow 元数据，以及带 TC260 命名空间的 GB 45438-2025 AIGC 文件元数据；不联网获取远程 manifest。TC260 AIGC 字段是可移除、可伪造的来源声明，未单独验证 ReservedCode 完整性保护，不能替代签名凭证或厂商水印检测。同时读取常见 EXIF，并生成亮度拉伸、局部差分和 Alpha 通道取证图。这些变换可显示低对比度或透明度中仍存在的像素信号；已经完全压平且与背景像素完全相同的内容没有可恢复信息。厂商 SynthID 等不可见水印只在对应官方验证器可用时才能独立确认。未发现信号不证明内容由人类创作。";
const VIDEO_DETECTOR_COVERAGE: &str = "已在本机验证视频容器中内嵌 C2PA Content Credentials 的文件绑定、签名和发行方信任，不联网获取远程 manifest；同时读取 FFprobe 容器、编码器、时间信息和 GB 45438-2025/TC260 AIGC 文件元数据。TC260 AIGC 字段是可移除、可伪造的来源声明，未单独验证 ReservedCode 完整性保护，不能替代签名凭证或厂商水印检测。画面推断仅覆盖已抽取的带时间点关键帧；厂商 SynthID、TikTok/字节跳动私有水印和 AI MediaKit 暗水印，只在对应官方验证器与正确水印配置可用时才能独立确认。未发现信号不证明视频不是 AI 生成。";
const MAX_PROMPT_CHARS: usize = 32_000;
const MAX_PROMPT_BYTES: usize = MAX_PROMPT_CHARS * 4;
const MAX_PROMPT_RECORDS: usize = 12;
const MAX_PNG_METADATA_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const MAX_TC260_XMP_SCAN_BYTES: usize = 32 * 1024 * 1024;
const MAX_WATERMARK_STRING_SCAN_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SoftBindingRegistryEntry {
    identifier: u16,
    alg: String,
    #[serde(rename = "type")]
    binding_type: String,
    #[serde(default)]
    decoded_media_types: Vec<String>,
    #[serde(default)]
    encoded_media_types: Vec<String>,
    entry_metadata: SoftBindingRegistryMetadata,
    #[serde(default)]
    soft_binding_resolution_apis: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct SoftBindingRegistryMetadata {
    description: String,
    informational_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Tc260AigcEvidence {
    label: String,
    content_producer: Option<String>,
    produce_id: Option<String>,
    reserved_code_1: Option<String>,
    content_propagator: Option<String>,
    propagate_id: Option<String>,
    reserved_code_2: Option<String>,
}

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
    inspect_media(path, true, None)
}

pub fn inspect_video(path: &str, aigc_metadata: Option<&str>) -> Option<ImageProvenance> {
    inspect_media(path, false, aigc_metadata)
}

fn inspect_media(
    path: &str,
    include_image_forensics: bool,
    aigc_metadata: Option<&str>,
) -> Option<ImageProvenance> {
    let mut metadata = if include_image_forensics {
        read_exif(path)
    } else {
        Vec::new()
    };
    let tc260_aigc = aigc_metadata
        .and_then(parse_tc260_aigc_metadata)
        .or_else(|| read_tc260_aigc_xmp(path));
    if let Some(evidence) = tc260_aigc.as_ref() {
        metadata.extend(tc260_metadata_evidence(evidence));
    }
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
    if let Some(evidence) = tc260_aigc.as_ref() {
        push_unique(
            &mut ai_signals,
            format!(
                "GB 45438-2025/TC260 文件元数据声明：{}",
                tc260_label_description(&evidence.label)
            ),
        );
        push_unique(
            &mut ai_signals,
            "TC260 AIGC 元数据未经过 LensQuery 的独立数字签名验证，仅作不受信任的来源声明".into(),
        );
    }

    let camera_metadata_present = metadata
        .iter()
        .any(|item| matches!(item.label.as_str(), "相机厂商" | "相机型号"));
    let ai_origin_status = Some(origin_status(c2pa.as_ref(), tc260_aigc.as_ref()).into());
    let forensic_variants = if include_image_forensics {
        generate_forensic_variants(path)
    } else {
        Vec::new()
    };
    let watermark_coverage = Some(build_watermark_coverage(
        if include_image_forensics {
            "image"
        } else {
            "video"
        },
        c2pa.as_ref(),
        tc260_aigc.as_ref(),
    ));
    let undisclosed_watermark_scan = Some(scan_undisclosed_watermarks(
        path,
        include_image_forensics,
        c2pa.as_ref(),
    ));
    Some(ImageProvenance {
        c2pa,
        metadata,
        ai_signals,
        camera_metadata_present,
        ai_origin_status,
        forensic_variants,
        prompt_recovery_status: Some(prompt_recovery_status(&prompt_evidence).into()),
        prompt_evidence,
        watermark_coverage,
        undisclosed_watermark_scan,
        detector_coverage: if include_image_forensics {
            IMAGE_DETECTOR_COVERAGE
        } else {
            VIDEO_DETECTOR_COVERAGE
        }
        .into(),
    })
}

fn origin_status(
    c2pa: Option<&C2paEvidence>,
    tc260_aigc: Option<&Tc260AigcEvidence>,
) -> &'static str {
    if let Some(c2pa) = c2pa {
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
            return "verified-camera";
        }
    }
    if tc260_aigc.is_some_and(|evidence| evidence.label == "1") {
        "declared-ai"
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

fn read_tc260_aigc_xmp(path: &str) -> Option<Tc260AigcEvidence> {
    let mut file = File::open(path).ok()?;
    let mut bytes = Vec::new();
    Read::by_ref(&mut file)
        .take(MAX_TC260_XMP_SCAN_BYTES as u64)
        .read_to_end(&mut bytes)
        .ok()?;
    let text = String::from_utf8_lossy(&bytes);
    if !text.contains("http://www.tc260.org.cn/ns/AIGC/1.0/") && !text.contains("TC260:AIGC") {
        return None;
    }
    let value = extract_between(&text, "<TC260:AIGC>", "</TC260:AIGC>")
        .or_else(|| extract_between(&text, "<AIGC>", "</AIGC>"))?;
    parse_tc260_aigc_metadata(&xml_unescape(value))
}

fn parse_tc260_aigc_metadata(value: &str) -> Option<Tc260AigcEvidence> {
    let decoded = xml_unescape(value.trim());
    let candidate = extract_json_object(&decoded)?;
    let parsed: serde_json::Value = serde_json::from_str(candidate).ok()?;
    let object = parsed.get("AIGC").unwrap_or(&parsed).as_object()?;
    let label = object.get("Label")?.as_str()?.trim();
    if !matches!(label, "1" | "2" | "3") {
        return None;
    }
    Some(Tc260AigcEvidence {
        label: label.into(),
        content_producer: tc260_value(object, "ContentProducer"),
        produce_id: tc260_value(object, "ProduceID"),
        reserved_code_1: tc260_value(object, "ReservedCode1"),
        content_propagator: tc260_value(object, "ContentPropagator"),
        propagate_id: tc260_value(object, "PropagateID"),
        reserved_code_2: tc260_value(object, "ReservedCode2"),
    })
}

fn tc260_value(object: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<String> {
    object
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.chars().take(2_048).collect())
}

fn extract_json_object(value: &str) -> Option<&str> {
    let start = value.find('{')?;
    let bytes = value.as_bytes();
    let mut depth = 0_u32;
    let mut quoted = false;
    let mut escaped = false;
    for (index, byte) in bytes.iter().copied().enumerate().skip(start) {
        if quoted {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                quoted = false;
            }
            continue;
        }
        match byte {
            b'"' => quoted = true,
            b'{' => depth = depth.saturating_add(1),
            b'}' => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return value.get(start..=index);
                }
            }
            _ => {}
        }
    }
    None
}

fn extract_between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let after_start = value.find(start)? + start.len();
    let before_end = value.get(after_start..)?.find(end)? + after_start;
    value.get(after_start..before_end)
}

fn xml_unescape(value: &str) -> String {
    value
        .replace("&quot;", "\"")
        .replace("&#34;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn tc260_label_description(label: &str) -> &'static str {
    match label {
        "1" => "属于人工智能生成合成内容（Label=1）",
        "2" => "可能为人工智能生成合成内容（Label=2）",
        "3" => "疑似为人工智能生成合成内容（Label=3）",
        _ => "未知 AIGC 标签",
    }
}

fn tc260_metadata_evidence(evidence: &Tc260AigcEvidence) -> Vec<MetadataEvidence> {
    let mut metadata = vec![MetadataEvidence {
        label: "TC260 AIGC 标签".into(),
        value: tc260_label_description(&evidence.label).into(),
    }];
    for (label, value) in [
        (
            "TC260 生成合成服务提供者",
            evidence.content_producer.as_deref(),
        ),
        ("TC260 内容制作编号", evidence.produce_id.as_deref()),
        (
            "TC260 内容传播服务提供者",
            evidence.content_propagator.as_deref(),
        ),
        ("TC260 内容传播编号", evidence.propagate_id.as_deref()),
        (
            "TC260 生成方完整性保护字段（未验证）",
            evidence.reserved_code_1.as_deref(),
        ),
        (
            "TC260 传播方完整性保护字段（未验证）",
            evidence.reserved_code_2.as_deref(),
        ),
    ] {
        if let Some(value) = value {
            metadata.push(MetadataEvidence {
                label: label.into(),
                value: value.into(),
            });
        }
    }
    metadata
}

fn soft_binding_registry() -> &'static [SoftBindingRegistryEntry] {
    static REGISTRY: OnceLock<Vec<SoftBindingRegistryEntry>> = OnceLock::new();
    REGISTRY
        .get_or_init(|| serde_json::from_str(SOFT_BINDING_ALGORITHM_LIST).unwrap_or_default())
        .as_slice()
}

fn build_watermark_coverage(
    media_kind: &str,
    c2pa: Option<&C2paEvidence>,
    tc260_aigc: Option<&Tc260AigcEvidence>,
) -> WatermarkCoverage {
    let registry = soft_binding_registry();
    let compatible_algorithms = registry
        .iter()
        .filter(|entry| {
            entry
                .decoded_media_types
                .iter()
                .any(|value| value == media_kind)
                || entry.encoded_media_types.iter().any(|value| {
                    value
                        .split_once('/')
                        .is_some_and(|(top_level, _)| top_level == media_kind)
                })
        })
        .count();
    let resolution_apis = registry
        .iter()
        .flat_map(|entry| entry.soft_binding_resolution_apis.iter().cloned())
        .collect::<BTreeSet<_>>();
    let watermark_declared = c2pa.is_some_and(|evidence| {
        evidence.embedded_watermark_declared
            || evidence
                .soft_bindings
                .iter()
                .any(|binding| binding.binding_type.as_deref() == Some("watermark"))
    });
    let signed_metadata = c2pa.is_some_and(|evidence| evidence.validation_state != "invalid");
    let eu_status = match (signed_metadata, watermark_declared) {
        (true, true) => "two-layer-evidence-observed",
        (true, false) => "signed-metadata-only",
        (false, true) => "watermark-declaration-only",
        (false, false) => "not-observed",
    };
    let eu_evidence = match eu_status {
        "two-layer-evidence-observed" => {
            "观察到有效 C2PA 文件绑定，并在签名流程中观察到水印动作或软绑定算法声明。"
        }
        "signed-metadata-only" => "观察到有效 C2PA 文件绑定，未观察到水印动作或软绑定算法声明。",
        "watermark-declaration-only" => "观察到水印声明，但没有同时建立有效的签名元数据层。",
        _ => "没有观察到可验证的 C2PA 元数据或已声明的软绑定水印算法。",
    };
    let (cn_status, cn_evidence) = match tc260_aigc {
        Some(evidence) => (
            "tc260-metadata-observed",
            format!(
                "观察到 GB 45438-2025/TC260 AIGC Label={}（{}）。",
                evidence.label,
                tc260_label_description(&evidence.label)
            ),
        ),
        None => (
            "not-observed",
            "没有观察到 LensQuery 当前支持的 TC260 AIGC JSON/XMP/容器字段。".into(),
        ),
    };
    WatermarkCoverage {
        registry_source: SOFT_BINDING_REGISTRY_SOURCE.into(),
        registry_commit: SOFT_BINDING_REGISTRY_COMMIT.into(),
        registered_algorithms: registry.len(),
        registered_watermarks: registry
            .iter()
            .filter(|entry| entry.binding_type == "watermark")
            .count(),
        registered_fingerprints: registry
            .iter()
            .filter(|entry| entry.binding_type == "fingerprint")
            .count(),
        compatible_algorithms,
        public_resolution_apis: resolution_apis.len(),
        locally_checked: vec![
            "C2PA 文件绑定、签名与信任链".into(),
            "C2PA 软绑定算法标识".into(),
            "GB 45438-2025/TC260 AIGC 文件元数据".into(),
            "容器私有块、可见字符串与图像透明像素盲检".into(),
        ],
        regulatory_evidence: vec![
            RegulatoryMarkEvidence {
                jurisdiction: "欧盟".into(),
                framework: "AI Act Article 50 / AI-generated content Code of Practice".into(),
                status: eu_status.into(),
                evidence: eu_evidence.into(),
                caveat: "这是技术证据覆盖状态，不是对主体、地域、例外条款或最终合规性的法律判断。".into(),
            },
            RegulatoryMarkEvidence {
                jurisdiction: "中国".into(),
                framework: "GB 45438-2025 / TC260 AIGC 标识".into(),
                status: cn_status.into(),
                evidence: cn_evidence,
                caveat: "TC260 字段可被移除或伪造；ReservedCode 尚未由 LensQuery 独立验签。".into(),
            },
        ],
        caveat: "目录覆盖表示 LensQuery 知道这些算法标识，不等于本机拥有全部私有解码密钥或厂商模型。远程解析器默认不调用，避免把文件静默上传给第三方。".into(),
    }
}

fn soft_binding_evidence(value: &serde_json::Value) -> Option<SoftBindingEvidence> {
    let algorithm = value
        .get("alg")
        .or_else(|| value.get("algorithm"))
        .and_then(serde_json::Value::as_str)?
        .to_string();
    let block_count = value
        .get("blocks")
        .and_then(serde_json::Value::as_array)
        .map_or(0, Vec::len);
    let entry = soft_binding_registry()
        .iter()
        .find(|entry| entry.alg == algorithm);
    Some(match entry {
        Some(entry) => SoftBindingEvidence {
            algorithm,
            registry_identifier: Some(entry.identifier),
            binding_type: Some(entry.binding_type.clone()),
            block_count,
            description: Some(entry.entry_metadata.description.clone()),
            informational_url: Some(entry.entry_metadata.informational_url.clone()),
            resolution_apis: entry.soft_binding_resolution_apis.clone(),
        },
        None => SoftBindingEvidence {
            algorithm,
            registry_identifier: None,
            binding_type: None,
            block_count,
            description: None,
            informational_url: None,
            resolution_apis: Vec::new(),
        },
    })
}

fn scan_undisclosed_watermarks(
    path: &str,
    inspect_pixels: bool,
    c2pa: Option<&C2paEvidence>,
) -> UndisclosedWatermarkScan {
    let mut methods = vec!["容器私有块与厂商标记扫描".into()];
    let mut observations = Vec::new();

    if let Some(tokens) = watermark_marker_tokens(path) {
        for token in tokens {
            if token == "soft-binding" && c2pa.is_some() {
                continue;
            }
            push_unique(
                &mut observations,
                format!("文件字节中观察到水印/来源标记：{token}"),
            );
        }
    }
    for chunk in unknown_png_chunks(path) {
        push_unique(
            &mut observations,
            format!("PNG 中观察到未登记的私有数据块：{chunk}"),
        );
    }
    let uuid_boxes = top_level_mp4_uuid_boxes(path);
    if uuid_boxes > 0 && c2pa.is_none() {
        observations.push(format!(
            "视频容器中观察到 {uuid_boxes} 个顶层 UUID 私有块，当前未归属到 C2PA；需要对应格式解析器确认"
        ));
    }

    if inspect_pixels {
        methods.extend([
            "透明像素隐藏 RGB 扫描".into(),
            "RGB 最低位平面平衡检查".into(),
            "亮度拉伸与局部背景差分".into(),
        ]);
        if let Some(observation) = hidden_rgb_under_transparency(path) {
            observations.push(observation);
        }
    } else {
        methods.push("像素/音频载荷需要对应解码器或批量对照样本".into());
    }

    let status = if observations.is_empty() {
        if inspect_pixels {
            "no-observable-anomaly"
        } else {
            "limited"
        }
    } else {
        "candidate-observed"
    };
    UndisclosedWatermarkScan {
        status: status.into(),
        methods,
        observations,
        caveat: "盲检候选只表示文件中有需进一步归属的结构或像素信号，不证明它是 AI 水印。秘密、加密、已剥离或低于当前检测阈值的信号仍可能存在；确证需要算法标识、密钥、厂商解码器或跨样本统计验证。".into(),
    }
}

fn watermark_marker_tokens(path: &str) -> Option<Vec<String>> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    let half_limit = (MAX_WATERMARK_STRING_SCAN_BYTES / 2) as u64;
    let head_size = length.min(half_limit) as usize;
    let mut bytes = vec![0_u8; head_size];
    file.read_exact(&mut bytes).ok()?;
    if length > half_limit {
        let tail_size = (length - half_limit).min(half_limit) as usize;
        file.seek(SeekFrom::End(-(tail_size as i64))).ok()?;
        let mut tail = vec![0_u8; tail_size];
        file.read_exact(&mut tail).ok()?;
        bytes.extend_from_slice(&tail);
    }
    let searchable = String::from_utf8_lossy(&bytes).to_ascii_lowercase();
    let mut matches = Vec::new();
    for token in [
        "synthid",
        "trustmark",
        "videoseal",
        "pixelseal",
        "audioseal",
        "invismark",
        "invisible_watermark",
        "watermark_payload",
        "soft-binding",
    ] {
        if searchable.contains(token) {
            matches.push(token.to_string());
        }
    }
    Some(matches)
}

fn unknown_png_chunks(path: &str) -> Vec<String> {
    let Ok(mut file) = File::open(path) else {
        return Vec::new();
    };
    let mut signature = [0_u8; 8];
    if file.read_exact(&mut signature).is_err() || signature != *b"\x89PNG\r\n\x1a\n" {
        return Vec::new();
    }
    const KNOWN: &[&str] = &[
        "IHDR", "PLTE", "IDAT", "IEND", "tRNS", "cHRM", "gAMA", "iCCP", "sBIT", "sRGB", "cICP",
        "mDCv", "cLLi", "eXIf", "tEXt", "zTXt", "iTXt", "bKGD", "hIST", "pHYs", "sPLT", "tIME",
        "acTL", "fcTL", "fdAT", "dSIG", "caBX",
    ];
    let mut unknown = Vec::new();
    for _ in 0..4_096 {
        let mut length_bytes = [0_u8; 4];
        let mut kind = [0_u8; 4];
        if file.read_exact(&mut length_bytes).is_err() || file.read_exact(&mut kind).is_err() {
            break;
        }
        let length = u32::from_be_bytes(length_bytes) as u64;
        let name = String::from_utf8_lossy(&kind).into_owned();
        if !KNOWN.contains(&name.as_str()) && kind.iter().all(u8::is_ascii_alphabetic) {
            push_unique(&mut unknown, format!("{name} ({length} bytes)"));
        }
        if file
            .seek(SeekFrom::Current((length.saturating_add(4)) as i64))
            .is_err()
        {
            break;
        }
        if kind == *b"IEND" {
            break;
        }
    }
    unknown
}

fn top_level_mp4_uuid_boxes(path: &str) -> usize {
    let Ok(mut file) = File::open(path) else {
        return 0;
    };
    let Ok(file_length) = file.metadata().map(|metadata| metadata.len()) else {
        return 0;
    };
    let mut position = 0_u64;
    let mut count = 0;
    for _ in 0..4_096 {
        if position.saturating_add(8) > file_length || file.seek(SeekFrom::Start(position)).is_err()
        {
            break;
        }
        let mut header = [0_u8; 8];
        if file.read_exact(&mut header).is_err() {
            break;
        }
        let size32 = u32::from_be_bytes(header[..4].try_into().unwrap_or([0; 4]));
        let mut header_size = 8_u64;
        let size = if size32 == 1 {
            let mut extended = [0_u8; 8];
            if file.read_exact(&mut extended).is_err() {
                break;
            }
            header_size = 16;
            u64::from_be_bytes(extended)
        } else if size32 == 0 {
            file_length.saturating_sub(position)
        } else {
            size32 as u64
        };
        if &header[4..8] == b"uuid" {
            count += 1;
        }
        if size < header_size || position.saturating_add(size) > file_length {
            break;
        }
        position = position.saturating_add(size);
    }
    count
}

fn hidden_rgb_under_transparency(path: &str) -> Option<String> {
    let mut reader = ImageReader::open(path)
        .and_then(|reader| reader.with_guessed_format())
        .ok()?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(16_384);
    limits.max_image_height = Some(16_384);
    limits.max_alloc = Some(512 * 1024 * 1024);
    reader.limits(limits);
    let source = reader.decode().ok()?.thumbnail(2_048, 2_048).to_rgba8();
    let mut transparent = 0_u64;
    let mut hidden_rgb = 0_u64;
    for pixel in source.pixels() {
        if pixel[3] == 0 {
            transparent += 1;
            if pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0 {
                hidden_rgb += 1;
            }
        }
    }
    (hidden_rgb >= 64 && hidden_rgb.saturating_mul(100) >= transparent.saturating_mul(10)).then(
        || {
            format!(
                "透明像素中有 {hidden_rgb}/{transparent} 个位置保留非零 RGB；可能是抗锯齿残留、编辑痕迹或隐藏载荷，需查看 Alpha 取证图确认"
            )
        },
    )
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
    let mut soft_bindings = Vec::new();
    for assertion in manifest.assertions() {
        let Ok(value) = assertion.value() else {
            continue;
        };
        if assertion.label().starts_with("c2pa.soft-binding") {
            if let Some(evidence) = soft_binding_evidence(value) {
                if !soft_bindings
                    .iter()
                    .any(|existing: &SoftBindingEvidence| existing.algorithm == evidence.algorithm)
                {
                    soft_bindings.push(evidence);
                }
            }
            continue;
        }
        if !assertion.label().starts_with("c2pa.actions") {
            continue;
        }
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
        .any(|value| value.to_ascii_lowercase().contains("watermarked"))
        || soft_bindings
            .iter()
            .any(|binding| binding.binding_type.as_deref() == Some("watermark"));

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
            soft_bindings,
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
            soft_bindings: vec![],
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
    fn loads_pinned_c2pa_soft_binding_registry_snapshot() {
        let registry = soft_binding_registry();
        assert_eq!(registry.len(), 48);
        assert_eq!(
            registry
                .iter()
                .filter(|entry| entry.binding_type == "watermark")
                .count(),
            39
        );
        assert_eq!(
            registry
                .iter()
                .filter(|entry| entry.binding_type == "fingerprint")
                .count(),
            9
        );
        assert_eq!(
            registry
                .iter()
                .filter(|entry| !entry.soft_binding_resolution_apis.is_empty())
                .count(),
            6
        );
        assert_eq!(
            build_watermark_coverage("image", None, None).compatible_algorithms,
            27
        );
        let mut identifiers = registry
            .iter()
            .map(|entry| entry.identifier)
            .collect::<Vec<_>>();
        identifiers.sort_unstable();
        identifiers.dedup();
        assert_eq!(identifiers.len(), registry.len());
    }

    #[test]
    fn resolves_declared_soft_binding_without_exposing_payload_bytes() {
        let evidence = soft_binding_evidence(&serde_json::json!({
            "alg": "com.aiwatermark.videoseal.1",
            "blocks": [
                {"scope": {"start": 0, "length": 10}, "value": "hidden-binding-one"},
                {"scope": {"start": 10, "length": 10}, "value": "hidden-binding-two"}
            ]
        }))
        .expect("soft binding evidence");
        assert_eq!(evidence.registry_identifier, Some(30));
        assert_eq!(evidence.binding_type.as_deref(), Some("watermark"));
        assert_eq!(evidence.block_count, 2);
        assert_eq!(evidence.resolution_apis.len(), 1);
        assert!(!format!("{evidence:?}").contains("hidden-binding"));
    }

    #[test]
    fn treats_unregistered_soft_binding_as_a_declaration_not_a_decoder_result() {
        let evidence = soft_binding_evidence(&serde_json::json!({
            "alg": "example.invalid.secret-watermark",
            "blocks": []
        }))
        .expect("unregistered soft binding evidence");
        assert_eq!(evidence.registry_identifier, None);
        assert_eq!(evidence.binding_type, None);
        assert!(evidence.resolution_apis.is_empty());
    }

    #[test]
    fn normalizes_metadata_whitespace() {
        assert_eq!(clean_metadata_value("  NIKON\0   E5200  "), "NIKON E5200");
    }

    #[test]
    fn only_trusted_bound_credentials_produce_verified_origin_verdicts() {
        assert_eq!(origin_status(None, None), "inconclusive");
        assert_eq!(
            origin_status(
                Some(&c2pa_evidence(
                    "trusted",
                    true,
                    &["trainedAlgorithmicMedia"]
                )),
                None
            ),
            "verified-ai"
        );
        assert_eq!(
            origin_status(
                Some(&c2pa_evidence("valid", false, &["trainedAlgorithmicMedia"])),
                None
            ),
            "declared-ai"
        );
        assert_eq!(
            origin_status(
                Some(&c2pa_evidence("trusted", true, &["digitalCapture"])),
                None
            ),
            "verified-camera"
        );
        assert_eq!(
            origin_status(
                Some(&c2pa_evidence(
                    "trusted",
                    true,
                    &["compositeWithTrainedAlgorithmicMedia"]
                )),
                None
            ),
            "verified-ai-edited"
        );
        assert_eq!(
            origin_status(
                Some(&c2pa_evidence(
                    "trusted",
                    true,
                    &["algorithmicallyEnhanced"]
                )),
                None
            ),
            "inconclusive"
        );
        assert_eq!(
            origin_status(
                Some(&c2pa_evidence(
                    "invalid",
                    false,
                    &["trainedAlgorithmicMedia"]
                )),
                None
            ),
            "invalid-credential"
        );
    }

    #[test]
    fn parses_tc260_aigc_metadata_as_an_untrusted_declaration() {
        let evidence = parse_tc260_aigc_metadata(
            r#"{"AIGC":{"Label":"1","ContentProducer":"provider-100","ProduceID":"asset-200","ReservedCode1":"signature-slot","ContentPropagator":"platform-300","PropagateID":"post-400","ReservedCode2":""}}"#,
        )
        .expect("TC260 metadata");
        assert_eq!(evidence.label, "1");
        assert_eq!(evidence.content_producer.as_deref(), Some("provider-100"));
        assert_eq!(evidence.produce_id.as_deref(), Some("asset-200"));
        assert_eq!(origin_status(None, Some(&evidence)), "declared-ai");
        let metadata = tc260_metadata_evidence(&evidence);
        assert!(metadata.iter().any(|item| item.label == "TC260 AIGC 标签"));
        assert!(metadata
            .iter()
            .any(|item| item.label.contains("完整性保护字段") && item.value == "signature-slot"));
    }

    #[test]
    fn keeps_possible_or_suspected_tc260_labels_inconclusive() {
        for label in ["2", "3"] {
            let evidence = parse_tc260_aigc_metadata(&format!(
                r#"{{"Label":"{label}","ContentProducer":"provider"}}"#
            ))
            .expect("TC260 metadata");
            assert_eq!(origin_status(None, Some(&evidence)), "inconclusive");
        }
    }

    #[test]
    fn reads_tc260_xmp_namespace_and_xml_escaped_json() {
        let path =
            std::env::temp_dir().join(format!("lensquery-tc260-metadata-{}.jpg", Uuid::new_v4()));
        std::fs::write(
            &path,
            br#"<rdf:RDF xmlns:TC260="http://www.tc260.org.cn/ns/AIGC/1.0/"><TC260:AIGC>{&quot;Label&quot;:&quot;1&quot;,&quot;ContentProducer&quot;:&quot;fixture-provider&quot;}</TC260:AIGC></rdf:RDF>"#,
        )
        .expect("write TC260 XMP fixture");

        let evidence = read_tc260_aigc_xmp(&path.to_string_lossy()).expect("read TC260 XMP");
        assert_eq!(evidence.label, "1");
        assert_eq!(
            evidence.content_producer.as_deref(),
            Some("fixture-provider")
        );

        std::fs::remove_file(path).expect("remove TC260 XMP fixture");
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
    fn blind_scan_surfaces_private_png_chunks_without_claiming_ai_origin() {
        let path =
            std::env::temp_dir().join(format!("lensquery-private-chunk-{}.png", Uuid::new_v4()));
        let data = b"opaque fixture payload";
        let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
        png.extend_from_slice(&(data.len() as u32).to_be_bytes());
        png.extend_from_slice(b"wMkr");
        png.extend_from_slice(data);
        png.extend_from_slice(&[0; 4]);
        png.extend_from_slice(&0_u32.to_be_bytes());
        png.extend_from_slice(b"IEND");
        png.extend_from_slice(&[0; 4]);
        std::fs::write(&path, png).expect("write private chunk fixture");

        let scan = scan_undisclosed_watermarks(&path.to_string_lossy(), false, None);
        assert_eq!(scan.status, "candidate-observed");
        assert!(scan.observations.iter().any(|item| item.contains("wMkr")));
        assert!(scan.caveat.contains("不证明它是 AI 水印"));

        std::fs::remove_file(path).expect("remove private chunk fixture");
    }

    #[test]
    fn blind_scan_finds_rgb_payload_below_full_transparency() {
        let path = std::env::temp_dir().join(format!(
            "lensquery-hidden-transparent-rgb-{}.png",
            Uuid::new_v4()
        ));
        let mut fixture = image::RgbaImage::from_pixel(64, 64, image::Rgba([0, 0, 0, 0]));
        for x in 8..56 {
            for y in 8..56 {
                fixture.put_pixel(x, y, image::Rgba([25, 180, 90, 0]));
            }
        }
        fixture.save(&path).expect("save hidden RGB fixture");

        let scan = scan_undisclosed_watermarks(&path.to_string_lossy(), true, None);
        assert_eq!(scan.status, "candidate-observed");
        assert!(scan
            .observations
            .iter()
            .any(|item| item.contains("透明像素")));

        std::fs::remove_file(path).expect("remove hidden RGB fixture");
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
