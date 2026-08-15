use std::{
    env,
    ffi::OsString,
    fs,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use tokio::{process::Command, time::timeout};
use uuid::Uuid;

use crate::{
    models::{FileEvidence, VideoFrame, VideoMetadata, VideoPreparation},
    subprocess,
};

const DEFAULT_MAX_FRAMES: u32 = 12;
const HARD_MAX_FRAMES: u32 = 24;
const DEFAULT_WHISPER_MODEL: &str = "base";

struct TranscriptEvidence {
    transcript: Option<String>,
    source: Option<String>,
    language: Option<String>,
    kind: Option<String>,
    status: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YouTubeMetadata {
    id: String,
    title: String,
    duration: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ProbeOutput {
    #[serde(default)]
    streams: Vec<ProbeStream>,
    format: Option<ProbeFormat>,
}

#[derive(Debug, Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ProbeStream {
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    avg_frame_rate: Option<String>,
    duration: Option<String>,
    tags: Option<ProbeTags>,
    side_data_list: Option<Vec<SideData>>,
}

#[derive(Debug, Deserialize)]
struct ProbeTags {
    rotate: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SideData {
    rotation: Option<f64>,
}

pub async fn probe(path: &str) -> Result<VideoMetadata, String> {
    validate_source(path)?;
    let executable = resolve_path_executable("ffprobe").ok_or_else(|| {
        "没有发现 FFprobe。请安装 FFmpeg，或设置 LENSQUERY_FFPROBE_BIN 指向其可执行文件。"
            .to_string()
    })?;
    let output = Command::new(&executable)
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,duration:stream_tags=rotate:stream_side_data=rotation",
            "-of",
            "json",
            path,
        ])
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| missing_tool_message("ffprobe", &error))?;

    if !output.status.success() {
        return Err(format!(
            "FFprobe 无法读取此视频: {}",
            bounded_stderr(&output.stderr)
        ));
    }
    let parsed: ProbeOutput = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("FFprobe 返回了无法解析的数据: {error}"))?;
    metadata_from_probe(parsed)
}

pub async fn prepare(path: &str, max_frames: Option<u32>) -> Result<VideoPreparation, String> {
    let metadata = probe(path).await?;
    let frame_count = max_frames
        .unwrap_or(DEFAULT_MAX_FRAMES)
        .clamp(3, HARD_MAX_FRAMES);
    let interval = sampling_interval(metadata.duration_seconds, frame_count);
    let id = Uuid::new_v4().to_string();
    let output_directory = std::env::temp_dir()
        .join("lensquery")
        .join("video")
        .join(&id);
    let frames_directory = output_directory.join("frames");
    fs::create_dir_all(&frames_directory)
        .map_err(|error| format!("无法创建视频临时目录: {error}"))?;

    let frame_pattern = frames_directory.join("frame-%03d.jpg");
    let vf =
        format!("fps=1/{interval:.3},scale='min(1280,iw)':-2:force_original_aspect_ratio=decrease");
    run_ffmpeg(&[
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        path,
        "-vf",
        &vf,
        "-frames:v",
        &frame_count.to_string(),
        "-q:v",
        "3",
        frame_pattern
            .to_str()
            .ok_or_else(|| "视频临时路径不是有效 UTF-8。".to_string())?,
    ])
    .await?;

    let mut frame_paths = fs::read_dir(&frames_directory)
        .map_err(|error| format!("无法读取关键帧目录: {error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("jpg"))
        .collect::<Vec<_>>();
    frame_paths.sort();
    if frame_paths.is_empty() {
        return Err("没有从视频中抽取到可分析画面。".into());
    }

    let frames = frame_paths
        .into_iter()
        .enumerate()
        .map(|(index, frame_path)| {
            let preview_url = fs::read(&frame_path)
                .ok()
                .map(|bytes| format!("data:image/jpeg;base64,{}", STANDARD.encode(bytes)));
            VideoFrame {
                path: frame_path.to_string_lossy().into_owned(),
                preview_url,
                timestamp_seconds: (index as f64 * interval).min(metadata.duration_seconds),
            }
        })
        .collect();

    let audio_path = if metadata.has_audio {
        let destination = output_directory.join("audio.m4a");
        let destination_string = destination.to_string_lossy().into_owned();
        let result = run_ffmpeg(&[
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            &destination_string,
        ])
        .await;
        result.ok().map(|_| destination_string)
    } else {
        None
    };

    let transcript_evidence = if let Some(subtitle_path) = discover_sidecar_subtitle(path) {
        let cached_whisper = is_cached_whisper_subtitle(&subtitle_path);
        match read_subtitle_transcript(&subtitle_path) {
            Some(transcript) => TranscriptEvidence {
                transcript: Some(transcript),
                source: Some(subtitle_path.to_string_lossy().into_owned()),
                language: if cached_whisper {
                    Some("auto".into())
                } else {
                    subtitle_language(path, &subtitle_path)
                },
                kind: Some(if cached_whisper {
                    "local-whisper".into()
                } else {
                    "sidecar-subtitle".into()
                }),
                status: Some(if cached_whisper {
                    "ready:cached-local-whisper".into()
                } else {
                    "ready".into()
                }),
            },
            None => TranscriptEvidence {
                transcript: None,
                source: Some(subtitle_path.to_string_lossy().into_owned()),
                language: subtitle_language(path, &subtitle_path),
                kind: Some(if cached_whisper {
                    "local-whisper".into()
                } else {
                    "sidecar-subtitle".into()
                }),
                status: Some("同名字幕存在，但没有解析到可用的时间轴文字。".into()),
            },
        }
    } else if let Some(audio_path) = audio_path.as_deref() {
        transcribe_with_local_whisper(audio_path, &output_directory, metadata.duration_seconds)
            .await
    } else {
        TranscriptEvidence {
            transcript: None,
            source: None,
            language: None,
            kind: None,
            status: Some("视频没有可提取的音轨，也没有同名字幕。".into()),
        }
    };

    Ok(VideoPreparation {
        id,
        source_path: path.into(),
        output_directory: output_directory.to_string_lossy().into_owned(),
        frames,
        audio_path,
        sample_interval_seconds: interval,
        original_duration_seconds: metadata.duration_seconds,
        strategy: "uniform-keyframes-v1".into(),
        transcript: transcript_evidence.transcript,
        transcript_source: transcript_evidence.source,
        transcript_language: transcript_evidence.language,
        transcript_kind: transcript_evidence.kind,
        transcription_status: transcript_evidence.status,
    })
}

pub async fn prepare_youtube(url: &str, max_frames: Option<u32>) -> Result<FileEvidence, String> {
    validate_youtube_url(url)?;
    let executable = resolve_path_executable("yt-dlp").ok_or_else(|| {
        "没有发现 yt-dlp。请先安装 yt-dlp，或设置 LENSQUERY_YTDLP_BIN 指向其可执行文件。"
            .to_string()
    })?;
    let metadata_output = run_ytdlp(
        &executable,
        &[
            "--no-update",
            "--no-playlist",
            "--skip-download",
            "--dump-single-json",
            url,
        ],
        Duration::from_secs(60),
    )
    .await?;
    let youtube: YouTubeMetadata = serde_json::from_slice(&metadata_output.stdout)
        .map_err(|error| format!("无法解析 YouTube 视频信息: {error}"))?;
    let duration = youtube.duration.unwrap_or_default();
    if duration <= 0.0 {
        return Err("无法确定 YouTube 视频时长。".into());
    }
    if duration > 4.0 * 3_600.0 {
        return Err("当前单个 YouTube 视频最长支持 4 小时；请先裁剪或分集。".into());
    }
    let safe_id = youtube
        .id
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect::<String>();
    if safe_id.is_empty() {
        return Err("YouTube 视频 ID 无效。".into());
    }
    let output_directory = env::temp_dir()
        .join("lensquery")
        .join("youtube")
        .join(&safe_id);
    fs::create_dir_all(&output_directory)
        .map_err(|error| format!("无法创建 YouTube 临时目录: {error}"))?;
    let mut source_path = find_downloaded_video(&output_directory);
    if source_path.is_none() {
        let output_template = output_directory.join("source.%(ext)s");
        let output_template = output_template.to_string_lossy().into_owned();
        let download_timeout =
            Duration::from_secs((duration * 1.5 + 600.0).clamp(900.0, 7_200.0) as u64);
        run_ytdlp(
            &executable,
            &[
                "--no-update",
                "--no-playlist",
                "--max-filesize",
                "1536M",
                "--write-subs",
                "--write-auto-subs",
                "--sub-langs",
                "zh.*,en.*",
                "--sub-format",
                "vtt",
                "-f",
                "136+140/135+140/134+140/133+140/18/bv*[height<=720]+ba/b[height<=720]/b",
                "--merge-output-format",
                "mp4",
                "-o",
                &output_template,
                url,
            ],
            download_timeout,
        )
        .await?;
        source_path = find_downloaded_video(&output_directory);
    }
    let source_path = source_path.ok_or_else(|| {
        "yt-dlp 已结束，但没有生成可分析的视频文件；视频可能受地区、登录或权限限制。".to_string()
    })?;
    let source = source_path.to_string_lossy().into_owned();
    let preparation = prepare(&source, max_frames).await?;
    // Caching only avoids a second local transcription. A cache-write problem
    // must not discard an otherwise complete analysis result.
    let _ = cache_youtube_whisper_transcript(&source_path, &preparation);
    let video_metadata = probe(&source).await?;
    let size = fs::metadata(&source_path)
        .map_err(|error| format!("无法读取 YouTube 临时文件: {error}"))?
        .len();
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("mp4")
        .to_ascii_lowercase();
    Ok(FileEvidence {
        id: Uuid::new_v4().to_string(),
        name: format!("{}.{}", sanitize_title(&youtube.title), extension),
        path: source,
        media_type: video_media_type(&extension).into(),
        size,
        kind: "video".into(),
        video: Some(video_metadata),
        video_preparation: Some(preparation),
        processing_error: None,
        extracted_text: None,
        page_count: None,
        extraction_status: Some("youtube-ready".into()),
        provenance: None,
    })
}

fn cache_youtube_whisper_transcript(
    source_path: &Path,
    preparation: &VideoPreparation,
) -> Result<(), String> {
    if preparation.transcript_kind.as_deref() != Some("local-whisper") {
        return Ok(());
    }
    let Some(transcript_source) = preparation.transcript_source.as_deref() else {
        return Ok(());
    };
    let transcript_source = Path::new(transcript_source);
    if !transcript_source.is_file() {
        return Ok(());
    }
    let model = preparation
        .transcription_status
        .as_deref()
        .and_then(|status| status.strip_prefix("ready:local-whisper:"))
        .unwrap_or(DEFAULT_WHISPER_MODEL)
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .collect::<String>();
    let source_stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("source");
    let destination = source_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(format!("{source_stem}.auto.whisper-{model}.vtt"));
    fs::copy(transcript_source, &destination)
        .map(|_| ())
        .map_err(|error| format!("缓存本地 Whisper 时间轴失败: {error}"))
}

fn is_cached_whisper_subtitle(path: &Path) -> bool {
    path.file_stem()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.contains(".whisper-"))
}

async fn run_ytdlp(
    executable: &Path,
    args: &[&str],
    max_duration: Duration,
) -> Result<std::process::Output, String> {
    let mut command = Command::new(executable);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    subprocess::isolate_process_tree(&mut command);
    let child = command
        .spawn()
        .map_err(|error| format!("无法启动 yt-dlp: {error}"))?;
    let child_pid = child.id();
    let output = match timeout(max_duration, child.wait_with_output()).await {
        Ok(result) => result.map_err(|error| format!("等待 yt-dlp 失败: {error}"))?,
        Err(_) => {
            subprocess::kill_process_tree(child_pid);
            return Err("YouTube 下载或读取超时，已经停止。".into());
        }
    };
    if output.status.success() {
        Ok(output)
    } else {
        Err(format!(
            "yt-dlp 无法读取此 YouTube 视频: {}",
            bounded_stderr(&output.stderr)
        ))
    }
}

fn validate_youtube_url(value: &str) -> Result<(), String> {
    let normalized = value.trim().to_ascii_lowercase();
    let allowed = [
        "https://youtube.com/",
        "https://www.youtube.com/",
        "https://m.youtube.com/",
        "https://youtu.be/",
    ];
    if allowed.iter().any(|prefix| normalized.starts_with(prefix)) {
        Ok(())
    } else {
        Err("只会从用户明确选择的 HTTPS YouTube 视频地址读取媒体。".into())
    }
}

fn find_downloaded_video(directory: &Path) -> Option<PathBuf> {
    const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "webm", "mov", "m4v"];
    let mut candidates = fs::read_dir(directory)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            let file_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            path.is_file()
                && file_name.starts_with("source.")
                && !is_ytdlp_stream_fragment(file_name)
                && !file_name.ends_with(".part")
                && path
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|extension| {
                        VIDEO_EXTENSIONS.contains(&extension.to_ascii_lowercase().as_str())
                    })
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.into_iter().next()
}

fn is_ytdlp_stream_fragment(file_name: &str) -> bool {
    file_name
        .strip_prefix("source.f")
        .and_then(|suffix| suffix.split('.').next())
        .is_some_and(|format_id| {
            !format_id.is_empty()
                && format_id
                    .chars()
                    .all(|character| character.is_ascii_digit())
        })
}

fn sanitize_title(value: &str) -> String {
    let title = value
        .chars()
        .map(|character| {
            if matches!(
                character,
                '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'
            ) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    let title = title.chars().take(120).collect::<String>();
    if title.is_empty() {
        "YouTube video".into()
    } else {
        title
    }
}

fn video_media_type(extension: &str) -> &'static str {
    match extension {
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        _ => "video/mp4",
    }
}

async fn transcribe_with_local_whisper(
    audio_path: &str,
    output_directory: &Path,
    duration_seconds: f64,
) -> TranscriptEvidence {
    let Some(executable) = resolve_path_executable("whisper") else {
        return TranscriptEvidence {
            transcript: None,
            source: None,
            language: None,
            kind: None,
            status: Some("没有发现本地 Whisper CLI；音频已经提取，但语音内容尚未转写。".into()),
        };
    };
    let model = env::var("LENSQUERY_WHISPER_MODEL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_WHISPER_MODEL.into());
    let device = env::var("LENSQUERY_WHISPER_DEVICE")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "cpu".into());
    let language = env::var("LENSQUERY_WHISPER_LANGUAGE")
        .ok()
        .filter(|value| !value.trim().is_empty() && value != "auto");
    let mut command = Command::new(&executable);
    command.args([
        audio_path,
        "--model",
        &model,
        "--device",
        &device,
        "--output_dir",
        &output_directory.to_string_lossy(),
        "--output_format",
        "vtt",
        "--verbose",
        "False",
        "--task",
        "transcribe",
    ]);
    if device == "cpu" {
        command.args(["--fp16", "False"]);
    }
    if let Some(language) = &language {
        command.args(["--language", language]);
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    subprocess::isolate_process_tree(&mut command);
    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return TranscriptEvidence {
                transcript: None,
                source: None,
                language,
                kind: None,
                status: Some(format!("启动本地 Whisper 失败: {error}")),
            };
        }
    };
    let child_pid = child.id();
    let max_seconds = (duration_seconds * 0.8 + 300.0).clamp(600.0, 7_200.0) as u64;
    let output = match timeout(Duration::from_secs(max_seconds), child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return TranscriptEvidence {
                transcript: None,
                source: None,
                language,
                kind: None,
                status: Some(format!("等待本地 Whisper 失败: {error}")),
            };
        }
        Err(_) => {
            subprocess::kill_process_tree(child_pid);
            return TranscriptEvidence {
                transcript: None,
                source: None,
                language,
                kind: None,
                status: Some(format!(
                    "本地 Whisper 在 {} 分钟后仍未完成，已经停止。",
                    max_seconds / 60
                )),
            };
        }
    };
    if !output.status.success() {
        return TranscriptEvidence {
            transcript: None,
            source: None,
            language,
            kind: None,
            status: Some(format!(
                "本地 Whisper 转写失败: {}",
                bounded_stderr(&output.stderr)
            )),
        };
    }
    let stem = Path::new(audio_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("audio");
    let transcript_path = output_directory.join(format!("{stem}.vtt"));
    let transcript = read_subtitle_transcript(&transcript_path);
    let status = if transcript.is_some() {
        format!("ready:local-whisper:{model}")
    } else {
        format!("本地 Whisper {model} 已完成，但没有生成可读取的时间轴文字。")
    };
    TranscriptEvidence {
        transcript,
        source: Some(transcript_path.to_string_lossy().into_owned()),
        language: language.or_else(|| Some("auto".into())),
        kind: Some("local-whisper".into()),
        status: Some(status),
    }
}

fn resolve_path_executable(name: &str) -> Option<PathBuf> {
    let explicit_key = match name {
        "yt-dlp" => "LENSQUERY_YTDLP_BIN".into(),
        _ => format!("LENSQUERY_{}_BIN", name.to_ascii_uppercase()),
    };
    if let Some(explicit) = env::var_os(explicit_key).map(PathBuf::from) {
        if explicit.is_file() {
            return Some(explicit);
        }
    }
    let candidates = executable_names(name);
    let mut directories = env::var_os("PATH")
        .map(|path| env::split_paths(&path).collect::<Vec<_>>())
        .unwrap_or_default();
    if let Some(home) = env::var_os("HOME").map(PathBuf::from) {
        directories.extend([
            home.join(".local/bin"),
            home.join(".pyenv/shims"),
            home.join(".cargo/bin"),
        ]);
    }
    directories.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
    ]);
    for directory in directories {
        for candidate_name in &candidates {
            let candidate = directory.join(candidate_name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn executable_names(name: &str) -> Vec<OsString> {
    #[cfg(windows)]
    {
        let mut names = vec![OsString::from(name)];
        let extensions = env::var_os("PATHEXT")
            .and_then(|value| value.into_string().ok())
            .unwrap_or_else(|| ".EXE;.CMD;.BAT;.COM".into());
        names.extend(
            extensions
                .split(';')
                .filter(|extension| !extension.is_empty())
                .map(|extension| OsString::from(format!("{name}{extension}"))),
        );
        names
    }
    #[cfg(not(windows))]
    {
        vec![OsString::from(name)]
    }
}

fn discover_sidecar_subtitle(source: &str) -> Option<PathBuf> {
    let source = Path::new(source);
    let parent = source.parent()?;
    let stem = source.file_stem()?.to_str()?;
    let mut candidates = fs::read_dir(parent)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            let extension = path
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            let candidate_stem = path
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or_default();
            matches!(extension.to_ascii_lowercase().as_str(), "vtt" | "srt")
                && (candidate_stem == stem || candidate_stem.starts_with(&format!("{stem}.")))
        })
        .collect::<Vec<_>>();
    candidates.sort_by_key(|path| subtitle_rank(stem, path));
    candidates.into_iter().next()
}

fn subtitle_rank(source_stem: &str, path: &Path) -> (u8, String) {
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let suffix = stem.strip_prefix(source_stem).unwrap_or_default();
    let lower = suffix.to_ascii_lowercase();
    let rank = if suffix.is_empty() {
        0
    } else if matches!(
        lower.as_str(),
        ".en" | ".en-us" | ".en-gb" | ".zh" | ".zh-cn"
    ) {
        1
    } else if lower.contains("orig") {
        3
    } else {
        2
    };
    (rank, path.to_string_lossy().into_owned())
}

fn subtitle_language(source: &str, subtitle: &Path) -> Option<String> {
    let source_stem = Path::new(source).file_stem()?.to_str()?;
    let subtitle_stem = subtitle.file_stem()?.to_str()?;
    subtitle_stem
        .strip_prefix(source_stem)?
        .trim_start_matches('.')
        .split('.')
        .next()
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn read_subtitle_transcript(path: &Path) -> Option<String> {
    const MAX_SUBTITLE_BYTES: u64 = 4 * 1024 * 1024;
    const MAX_TRANSCRIPT_CHARS: usize = 120_000;
    if fs::metadata(path).ok()?.len() > MAX_SUBTITLE_BYTES {
        return None;
    }
    let source = fs::read_to_string(path).ok()?;
    let source = source.replace("\r\n", "\n").replace('\r', "\n");
    let mut cues = Vec::new();
    for block in source.split("\n\n") {
        let mut lines = block.lines().map(str::trim).filter(|line| !line.is_empty());
        let Some(first) = lines.next() else {
            continue;
        };
        if first.starts_with("WEBVTT")
            || first.starts_with("Kind:")
            || first.starts_with("Language:")
            || first.starts_with("NOTE")
            || first.starts_with("STYLE")
            || first.starts_with("REGION")
        {
            continue;
        }
        let (timing, text_lines) = if first.contains("-->") {
            (first, lines.collect::<Vec<_>>())
        } else {
            let Some(second) = lines.next() else {
                continue;
            };
            if !second.contains("-->") {
                continue;
            }
            (second, lines.collect::<Vec<_>>())
        };
        let timestamp = timing
            .split("-->")
            .next()
            .and_then(format_subtitle_timestamp)
            .unwrap_or_else(|| "??:??".into());
        let text = clean_subtitle_text(&text_lines.join(" "));
        if text.is_empty() {
            continue;
        }
        let line = format!("[{timestamp}] {text}");
        if cues.last().is_none_or(|previous| previous != &line) {
            cues.push(line);
        }
    }
    let transcript = cues.join("\n");
    if transcript.is_empty() {
        None
    } else {
        Some(transcript.chars().take(MAX_TRANSCRIPT_CHARS).collect())
    }
}

fn format_subtitle_timestamp(value: &str) -> Option<String> {
    let normalized = value.trim().replace(',', ".");
    let parts = normalized.split(':').collect::<Vec<_>>();
    match parts.as_slice() {
        [minutes, seconds] => Some(format!(
            "{:02}:{:02}",
            minutes.parse::<u64>().ok()?,
            seconds.split('.').next()?.parse::<u64>().ok()?
        )),
        [hours, minutes, seconds] => {
            let hours = hours.parse::<u64>().ok()?;
            let minutes = minutes.parse::<u64>().ok()?;
            let seconds = seconds.split('.').next()?.parse::<u64>().ok()?;
            if hours == 0 {
                Some(format!("{minutes:02}:{seconds:02}"))
            } else {
                Some(format!("{hours:02}:{minutes:02}:{seconds:02}"))
            }
        }
        _ => None,
    }
}

fn clean_subtitle_text(value: &str) -> String {
    let mut text = String::with_capacity(value.len());
    let mut inside_tag = false;
    for character in value.chars() {
        match character {
            '<' => inside_tag = true,
            '>' => inside_tag = false,
            _ if !inside_tag => text.push(character),
            _ => {}
        }
    }
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn validate_source(path: &str) -> Result<(), String> {
    let source = Path::new(path);
    let metadata = fs::metadata(source).map_err(|error| format!("无法读取视频文件: {error}"))?;
    if !metadata.is_file() {
        return Err("所选路径不是普通文件。".into());
    }
    Ok(())
}

async fn run_ffmpeg(args: &[&str]) -> Result<(), String> {
    let executable = resolve_path_executable("ffmpeg").ok_or_else(|| {
        "没有发现 FFmpeg。请安装 FFmpeg，或设置 LENSQUERY_FFMPEG_BIN 指向其可执行文件。".to_string()
    })?;
    let output = Command::new(&executable)
        .args(args)
        .arg("-y")
        .stdin(Stdio::null())
        .output()
        .await
        .map_err(|error| missing_tool_message("ffmpeg", &error))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "FFmpeg 视频处理失败: {}",
            bounded_stderr(&output.stderr)
        ))
    }
}

fn metadata_from_probe(probe: ProbeOutput) -> Result<VideoMetadata, String> {
    let video = probe
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("video"))
        .ok_or_else(|| "文件中没有可识别的视频轨道。".to_string())?;
    let audio = probe
        .streams
        .iter()
        .find(|stream| stream.codec_type.as_deref() == Some("audio"));
    let duration_seconds = parse_number(video.duration.as_deref())
        .or_else(|| {
            parse_number(
                probe
                    .format
                    .as_ref()
                    .and_then(|format| format.duration.as_deref()),
            )
        })
        .ok_or_else(|| "无法确定视频时长。".to_string())?;
    Ok(VideoMetadata {
        duration_seconds,
        width: video.width,
        height: video.height,
        frame_rate: parse_rate(video.avg_frame_rate.as_deref()),
        video_codec: video.codec_name.clone(),
        audio_codec: audio.and_then(|stream| stream.codec_name.clone()),
        has_audio: audio.is_some(),
        rotation: video
            .side_data_list
            .as_ref()
            .and_then(|items| items.iter().find_map(|item| item.rotation))
            .or_else(|| {
                video
                    .tags
                    .as_ref()
                    .and_then(|tags| parse_number(tags.rotate.as_deref()))
            }),
    })
}

fn parse_number(value: Option<&str>) -> Option<f64> {
    value?
        .parse::<f64>()
        .ok()
        .filter(|number| number.is_finite())
}

fn parse_rate(value: Option<&str>) -> Option<f64> {
    let value = value?;
    let (numerator, denominator) = value.split_once('/')?;
    let numerator = numerator.parse::<f64>().ok()?;
    let denominator = denominator.parse::<f64>().ok()?;
    (denominator != 0.0).then_some(numerator / denominator)
}

fn sampling_interval(duration_seconds: f64, max_frames: u32) -> f64 {
    (duration_seconds / f64::from(max_frames)).max(1.0)
}

fn missing_tool_message(tool: &str, error: &std::io::Error) -> String {
    format!("无法启动 {tool}: {error}。请安装 FFmpeg，并确保 ffmpeg 与 ffprobe 位于 PATH。")
}

fn bounded_stderr(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr).chars().take(600).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn interval_is_bounded_and_uniform() {
        assert_eq!(sampling_interval(6.0, 12), 1.0);
        assert_eq!(sampling_interval(120.0, 12), 10.0);
    }

    #[test]
    fn parses_fractional_frame_rate() {
        let value = parse_rate(Some("30000/1001")).expect("valid rate");
        assert!((value - 29.970).abs() < 0.001);
    }

    #[test]
    fn turns_sidecar_vtt_into_time_coded_transcript() {
        let path = std::env::temp_dir().join(format!("lensquery-{}.vtt", Uuid::new_v4()));
        fs::write(
            &path,
            "WEBVTT\n\n00:00:00.029 --> 00:00:02.000\n<c Speaker>We have a mission.</c>\n\n00:00:27.463 --> 00:00:32.253\nOne small step for man.\n",
        )
        .expect("write fixture");
        let transcript = read_subtitle_transcript(&path).expect("transcript");
        let _ = fs::remove_file(path);
        assert_eq!(
            transcript,
            "[00:00] We have a mission.\n[00:27] One small step for man."
        );
    }

    #[test]
    fn ranks_exact_and_language_subtitles_before_original_autocaptions() {
        let source = "lesson";
        assert!(
            subtitle_rank(source, Path::new("lesson.en.vtt"))
                < subtitle_rank(source, Path::new("lesson.en-orig.vtt"))
        );
        assert!(
            subtitle_rank(source, Path::new("lesson.vtt"))
                < subtitle_rank(source, Path::new("lesson.en.vtt"))
        );
    }

    #[test]
    fn accepts_only_https_youtube_video_urls() {
        assert!(validate_youtube_url("https://www.youtube.com/watch?v=fixture").is_ok());
        assert!(validate_youtube_url("https://youtu.be/fixture").is_ok());
        assert!(validate_youtube_url("http://www.youtube.com/watch?v=fixture").is_err());
        assert!(validate_youtube_url("https://example.com/video").is_err());
    }

    #[test]
    fn sanitizes_downloaded_video_titles_for_cross_platform_files() {
        assert_eq!(
            sanitize_title("Market / AI: outlook? | 2026"),
            "Market AI outlook 2026"
        );
    }

    #[test]
    fn ignores_unmerged_ytdlp_stream_fragments() {
        let directory = std::env::temp_dir().join(format!("lensquery-ytdlp-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create fixture directory");
        fs::write(directory.join("source.f136.mp4"), b"video-only").expect("write fragment");
        fs::write(directory.join("source.f251.webm"), b"audio-only").expect("write fragment");
        fs::write(directory.join("source.mp4"), b"merged").expect("write merged file");
        assert_eq!(
            find_downloaded_video(&directory),
            Some(directory.join("source.mp4"))
        );
        fs::remove_dir_all(directory).expect("remove fixture directory");
    }

    #[test]
    fn caches_youtube_whisper_transcripts_beside_temporary_media() {
        let directory = std::env::temp_dir().join(format!("lensquery-whisper-{}", Uuid::new_v4()));
        fs::create_dir_all(&directory).expect("create fixture directory");
        let source = directory.join("source.mp4");
        let transcript = directory.join("generated.vtt");
        fs::write(&source, b"video").expect("write video fixture");
        fs::write(&transcript, b"WEBVTT\n\n00:00.000 --> 00:01.000\nhello\n")
            .expect("write transcript fixture");
        let preparation = VideoPreparation {
            id: "fixture".into(),
            source_path: source.to_string_lossy().into_owned(),
            output_directory: directory.to_string_lossy().into_owned(),
            frames: vec![],
            audio_path: None,
            sample_interval_seconds: 1.0,
            original_duration_seconds: 1.0,
            strategy: "uniform-keyframes-v1".into(),
            transcript: Some("[00:00] hello".into()),
            transcript_source: Some(transcript.to_string_lossy().into_owned()),
            transcript_language: Some("auto".into()),
            transcript_kind: Some("local-whisper".into()),
            transcription_status: Some("ready:local-whisper:base".into()),
        };
        cache_youtube_whisper_transcript(&source, &preparation).expect("cache transcript");
        let cached = directory.join("source.auto.whisper-base.vtt");
        assert!(cached.is_file());
        assert!(is_cached_whisper_subtitle(&cached));
        fs::remove_dir_all(directory).expect("remove fixture directory");
    }
}
