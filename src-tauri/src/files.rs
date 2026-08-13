use std::{fs, path::Path};

use uuid::Uuid;

use crate::{models::FileEvidence, video};

const MAX_ATTACHMENTS: usize = 32;

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
        let (video_metadata, processing_error) = if kind == "video" {
            match video::probe(&path).await {
                Ok(value) => (Some(value), None),
                Err(error) => (None, Some(error)),
            }
        } else {
            (None, None)
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
        });
    }
    Ok(evidence)
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
}
