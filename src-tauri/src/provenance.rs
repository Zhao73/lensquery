use std::{fs::File, io::BufReader, path::Path};

use c2pa::{Context, Reader, Settings, ValidationState};
use exif::{In, Tag};

use crate::models::{C2paEvidence, ImageProvenance, MetadataEvidence};

const C2PA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TRUST-LIST.pem");
const C2PA_TSA_TRUST_ANCHORS: &str = include_str!("../resources/c2pa/C2PA-TSA-TRUST-LIST.pem");
const DETECTOR_COVERAGE: &str = "已在本机检查 C2PA Content Credentials 的结构、文件绑定、签名和内置可信列表，并读取常见 EXIF。可见水印由所选视觉模型读取；SynthID 等不可见水印只有在对应发行方验证器可用时才能独立确认。";

pub fn inspect_image(path: &str) -> Option<ImageProvenance> {
    let metadata = read_exif(path);
    let c2pa = read_c2pa(path);
    if metadata.is_empty() && c2pa.is_none() {
        return None;
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
    Some(ImageProvenance {
        c2pa,
        metadata,
        ai_signals,
        camera_metadata_present,
        detector_coverage: DETECTOR_COVERAGE.into(),
    })
}

fn read_c2pa(path: &str) -> Option<C2paEvidence> {
    let trust = format!("{C2PA_TRUST_ANCHORS}\n{C2PA_TSA_TRUST_ANCHORS}");
    let settings = Settings::new()
        .with_value("trust.trust_anchors", trust)
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
    let ai_generated_declared = digital_source_types.iter().any(|value| {
        matches!(
            value.to_ascii_lowercase().as_str(),
            "trainedalgorithmicmedia" | "compositesynthetic" | "algorithmicallyenhanced"
        )
    });
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
}
