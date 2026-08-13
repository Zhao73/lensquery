use std::{fs, path::Path};

use uuid::Uuid;

use crate::{models::FileEvidence, video};

const MAX_ATTACHMENTS: usize = 32;
const MAX_EXTRACTED_TEXT_CHARS: usize = 160_000;

pub async fn inspect(paths: Vec<String>) -> Result<Vec<FileEvidence>, String> {
    if paths.len() > MAX_ATTACHMENTS {
        return Err(format!("一次最多选择 {MAX_ATTACHMENTS} 个文件。"));
    }
    let mut evidence = Vec::with_capacity(paths.len());
    for path in paths {
        let source = Path::new(&path);
        let metadata = fs::metadata(source).map_err(|error| format!("无法读取 {path}: {error}"))?;
        if !metadata.is_file() {
            return Err(format!("所选路径不是普通文件: {path}"));
        }
        let name = source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("unnamed")
            .to_string();
        let extension = source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        let (kind, media_type) = classify(&extension);
        let (video_metadata, mut processing_error) = if kind == "video" {
            match video::probe(&path).await {
                Ok(value) => (Some(value), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
        };
        let (extracted_text, page_count, extraction_status) = match kind {
            "pdf" => match extract_pdf(&path).await {
                Ok((text, pages)) if text.trim().is_empty() => {
                    (None, Some(pages), Some("unsupported".into()))
                }
                Ok((text, pages)) => (Some(text), Some(pages), Some("ready".into())),
                Err(error) => {
                    processing_error = Some(error);
                    (None, None, Some("error".into()))
                }
            },
            "text" => match fs::read_to_string(&path) {
                Ok(text) => (
                    Some(bounded_text(&text)),
                    None,
                    Some(if text.chars().count() > MAX_EXTRACTED_TEXT_CHARS {
                        "partial".into()
                    } else {
                        "ready".into()
                    }),
                ),
                Err(error) => {
                    processing_error = Some(format!("无法读取文本文件: {error}"));
                    (None, None, Some("error".into()))
                }
            },
            _ => (None, None, Some("not-needed".into())),
        };
        evidence.push(FileEvidence {
            id: Uuid::new_v4().to_string(),
            name,
            path,
            media_type: media_type.into(),
            size: metadata.len(),
            kind: kind.into(),
            video: video_metadata,
            video_preparation: None,
            processing_error,
            extracted_text,
            page_count,
            extraction_status,
        });
    }
    Ok(evidence)
}

async fn extract_pdf(path: &str) -> Result<(String, u32), String> {
    let path = path.to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let pages = pdf_extract::extract_text_by_pages(&path)
            .map_err(|error| format!("PDF 文本提取失败: {error}"))?;
        let count = u32::try_from(pages.len()).unwrap_or(u32::MAX);
        Ok((bounded_text(&pages.join("\n\n--- page ---\n\n")), count))
    })
    .await
    .map_err(|error| format!("PDF 提取任务异常结束: {error}"))?
}

fn bounded_text(value: &str) -> String {
    value.chars().take(MAX_EXTRACTED_TEXT_CHARS).collect()
}

fn classify(extension: &str) -> (&'static str, &'static str) {
    match extension {
        "png" => ("image", "image/png"),
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "webp" => ("image", "image/webp"),
        "gif" => ("image", "image/gif"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "mov" => ("video", "video/quicktime"),
        "webm" => ("video", "video/webm"),
        "mkv" => ("video", "video/x-matroska"),
        "avi" => ("video", "video/x-msvideo"),
        "wmv" => ("video", "video/x-ms-wmv"),
        "mpeg" | "mpg" => ("video", "video/mpeg"),
        "pdf" => ("pdf", "application/pdf"),
        "txt" | "md" | "csv" | "log" => ("text", "text/plain"),
        "json" => ("text", "application/json"),
        "xml" => ("text", "application/xml"),
        "html" => ("text", "text/html"),
        "css" => ("text", "text/css"),
        "js" | "ts" | "tsx" => ("text", "text/javascript"),
        _ => ("other", "application/octet-stream"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_common_video_extensions() {
        assert_eq!(classify("mp4"), ("video", "video/mp4"));
        assert_eq!(classify("mkv"), ("video", "video/x-matroska"));
    }

    #[test]
    fn bounds_extracted_text_without_splitting_unicode() {
        let source = "界".repeat(MAX_EXTRACTED_TEXT_CHARS + 4);
        let bounded = bounded_text(&source);
        assert_eq!(bounded.chars().count(), MAX_EXTRACTED_TEXT_CHARS);
        assert!(bounded.chars().all(|value| value == '界'));
    }
}
