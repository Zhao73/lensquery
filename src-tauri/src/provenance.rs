use std::{fs::File, io::BufReader, path::Path};

use c2pa::{Context, Reader, Settings, ValidationState};
use exif::{In, Tag};
use image::{imageops, GrayImage, ImageFormat, ImageReader, Limits, Luma};
use uuid::Uuid;

use crate::models::{C2paEvidence, ForensicVariant, ImageProvenance, MetadataEvidence};

const C2PA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TRUST-LIST.pem");
const C2PA_TSA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TSA-TRUST-LIST.pem");
const IMAGE_DETECTOR_COVERAGE: &str = "已在本机验证文件内嵌 C2PA Content Credentials 的文件绑定、签名和发行方信任，不联网获取远程 manifest；同时读取常见 EXIF，并生成亮度拉伸、局部差分和 Alpha 通道取证图。这些变换可显示低对比度或透明度中仍存在的像素信号；已经完全压平且与背景像素完全相同的内容没有可恢复信息。厂商 SynthID 等不可见水印只在对应官方验证器可用时才能独立确认。未发现信号不证明内容由人类创作。";
const VIDEO_DETECTOR_COVERAGE: &str = "已在本机验证视频容器中内嵌 C2PA Content Credentials 的文件绑定、签名和发行方信任，不联网获取远程 manifest；同时读取 FFprobe 容器、编码器和时间信息。画面推断仅覆盖已抽取的带时间点关键帧；厂商 SynthID 等不可见水印只在对应官方验证器可用时才能独立确认。未发现信号不证明视频不是 AI 生成。";

pub fn inspect_image(path: &str) -> Option<ImageProvenance> {
    inspect_media(path, true)
}

pub fn inspect_video(path: &str) -> Option<ImageProvenance> {
    inspect_media(path, false)
}

fn inspect_media(path: &str, include_image_forensics: bool) -> Option<ImageProvenance> {
    let metadata = if include_image_forensics {
        read_exif(path)
    } else {
        Vec::new()
    };
    let c2pa = read_c2pa(path);

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

fn read_c2pa(path: &str) -> Option<C2paEvidence> {
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

    Some(C2paEvidence {
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
    })
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
}
