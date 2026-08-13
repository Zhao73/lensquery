use std::{fs, path::Path, process::Stdio};

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;
use tokio::process::Command;
use uuid::Uuid;

use crate::models::{VideoFrame, VideoMetadata, VideoPreparation};

const DEFAULT_MAX_FRAMES: u32 = 12;
const HARD_MAX_FRAMES: u32 = 24;

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
    let output = Command::new("ffprobe")
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

    Ok(VideoPreparation {
        id,
        source_path: path.into(),
        output_directory: output_directory.to_string_lossy().into_owned(),
        frames,
        audio_path,
        sample_interval_seconds: interval,
        original_duration_seconds: metadata.duration_seconds,
        strategy: "uniform-keyframes-v1".into(),
    })
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
    let output = Command::new("ffmpeg")
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
}
