use std::{collections::VecDeque, fs, path::Path};

use uuid::Uuid;

use crate::{models::FileEvidence, provenance, video};

const MAX_ATTACHMENTS: usize = 32;
const MAX_EXTRACTED_TEXT_CHARS: usize = 160_000;
const MAX_DIRECTORY_ENTRIES: usize = 500;
const MAX_DIRECTORY_DEPTH: usize = 2;

pub async fn inspect(paths: Vec<String>) -> Result<Vec<FileEvidence>, String> {
    if paths.len() > MAX_ATTACHMENTS {
        return Err(format!("一次最多选择 {MAX_ATTACHMENTS} 个文件。"));
    }
    let mut evidence = Vec::with_capacity(paths.len());
    for path in paths {
        let source = Path::new(&path);
        let metadata = fs::metadata(source).map_err(|error| format!("无法读取 {path}: {error}"))?;
        if metadata.is_dir() {
            evidence.push(inspect_directory(source, &path)?);
            continue;
        }
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
        let provenance = match kind {
            "image" => provenance::inspect_image(&path),
            "video" => provenance::inspect_video(
                &path,
                video_metadata
                    .as_ref()
                    .and_then(|metadata| metadata.aigc_metadata.as_deref()),
            ),
            _ => None,
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
            provenance,
        });
    }
    Ok(evidence)
}

fn inspect_directory(source: &Path, path: &str) -> Result<FileEvidence, String> {
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("/")
        .to_string();
    let (listing, truncated) = directory_listing(source)?;
    Ok(FileEvidence {
        id: Uuid::new_v4().to_string(),
        name,
        path: path.to_string(),
        media_type: "application/x-directory".into(),
        size: 0,
        kind: "other".into(),
        video: None,
        video_preparation: None,
        processing_error: None,
        extracted_text: Some(listing),
        page_count: None,
        extraction_status: Some(if truncated { "partial" } else { "ready" }.into()),
        provenance: None,
    })
}

fn directory_listing(root: &Path) -> Result<(String, bool), String> {
    let mut lines = vec![format!("Folder: {}", root.display())];
    let mut queue = VecDeque::from([(root.to_path_buf(), 0_usize)]);
    let mut count = 0_usize;
    let mut truncated = false;

    while let Some((directory, depth)) = queue.pop_front() {
        let read_directory = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if directory == root => {
                return Err(format!("无法读取文件夹 {}: {error}", directory.display()));
            }
            Err(error) => {
                let relative = directory.strip_prefix(root).unwrap_or(&directory);
                let relative_display = relative.to_string_lossy().replace('\\', "/");
                lines.push(format!(
                    "- [unreadable folder] {} ({error})",
                    relative_display
                ));
                continue;
            }
        };
        let mut entries = read_directory.filter_map(Result::ok).collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_lowercase());
        for entry in entries {
            if count >= MAX_DIRECTORY_ENTRIES {
                truncated = true;
                break;
            }
            let entry_path = entry.path();
            let relative = entry_path.strip_prefix(root).unwrap_or(&entry_path);
            let relative_display = relative.to_string_lossy().replace('\\', "/");
            let metadata = entry.metadata().ok();
            if metadata.as_ref().is_some_and(fs::Metadata::is_dir) {
                lines.push(format!("- [folder] {relative_display}"));
                if depth < MAX_DIRECTORY_DEPTH
                    && !entry.file_type().is_ok_and(|kind| kind.is_symlink())
                {
                    queue.push_back((entry_path, depth + 1));
                }
            } else {
                let size = metadata.as_ref().map(fs::Metadata::len).unwrap_or_default();
                lines.push(format!("- [file] {relative_display} ({size} bytes)"));
            }
            count += 1;
        }
        if truncated {
            break;
        }
    }

    if truncated {
        lines.push(format!(
            "- [truncated] showing the first {MAX_DIRECTORY_ENTRIES} entries up to depth {MAX_DIRECTORY_DEPTH}"
        ));
    }
    Ok((bounded_text(&lines.join("\n")), truncated))
}

async fn extract_pdf(path: &str) -> Result<(String, u32), String> {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
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

    #[tokio::test]
    async fn text_files_do_not_receive_media_provenance() {
        let path = std::env::temp_dir().join(format!(
            "lensquery-text-no-provenance-{}.txt",
            uuid::Uuid::new_v4()
        ));
        std::fs::write(&path, "plain text fixture").expect("write text fixture");

        let evidence = inspect(vec![path.to_string_lossy().into_owned()])
            .await
            .expect("inspect text fixture");

        assert_eq!(evidence[0].kind, "text");
        assert!(evidence[0].provenance.is_none());
        std::fs::remove_file(path).expect("remove text fixture");
    }

    #[test]
    fn creates_a_bounded_directory_listing() {
        let root =
            std::env::temp_dir().join(format!("lensquery-directory-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("docs")).expect("create fixture directory");
        std::fs::write(root.join("brief.txt"), "brief").expect("write fixture file");
        std::fs::write(root.join("docs/manual.pdf"), "pdf").expect("write nested fixture file");

        let (listing, truncated) = directory_listing(&root).expect("inspect directory");
        assert!(!truncated);
        assert!(listing.contains("[folder] docs"));
        assert!(listing.contains("[file] brief.txt"));
        assert!(listing.contains("[file] docs/manual.pdf"));

        std::fs::remove_dir_all(root).expect("remove fixture directory");
    }
}
