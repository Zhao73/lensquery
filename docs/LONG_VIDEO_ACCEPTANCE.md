# Long-video acceptance: captionless YouTube, local Whisper, and whole-ledger summary

Date: 2026-08-15 (Asia/Tokyo)

This acceptance separates five states: public-video discovery, bounded local media preparation, speech transcription, chapter coverage, and client-visible model output. A title or description is not treated as the video's spoken content.

## Fixture

- Channel: **视野环球财经**
- Video: [美股 四大科技三根阳线改变信仰！IGV再起势、PLTR超预期！TSLA、SPCX、AMD、NFLX、ISRG、NVDA！](https://www.youtube.com/watch?v=sPlBtKsmLK0)
- Published duration reported by YouTube metadata: 2,438 seconds (40:38)
- YouTube caption state during the test: no manual subtitles and no automatic caption tracks exposed to `yt-dlp`
- Disposable acceptance directory: `/private/tmp/lensquery-long-video-acceptance-20260815`

The video was selected because it is materially longer than the existing 60-second fixture, uses continuous Mandarin financial commentary, names many companies/tickers, and has no page-published transcript to hide an audio-path failure.

## Implemented long-video contract

1. Prefer a page-published YouTube caption track or same-name VTT/SRT file.
2. If an explicitly selected YouTube video has no transcript, accept only an HTTPS `youtube.com`/`youtu.be` URL, disable playlists, cap duration at four hours and the downloaded file at 1.5 GB, and use local `yt-dlp`.
3. Extract at most 24 ordered frames and a compact mono audio derivative with local FFmpeg.
4. If no subtitle exists and `whisper` is installed, run local Whisper (default multilingual `base`) and label the result `local-whisper`; do not upload audio or claim coverage when transcription fails.
5. For videos at least 20 minutes long, divide time-coded text into at most 12 chronological evidence chapters. The final prompt must cover every chapter, distinguish facts/data from the speaker's opinions or forecasts, and report transcript/audio/frame gaps.
6. Keep the short-video path compact; long-video preparation and analysis receive separate bounded timeouts and UI status copy.

## Acceptance results

Results are filled only from commands or installed-client evidence produced during this run.

| Gate | Evidence | Result |
| --- | --- | --- |
| Local Whisper integration | 120.03-second no-subtitle MP4 through the Rust Electron sidecar | PASS: 6 frames, 27 time-coded cues, `transcriptKind=local-whisper`, `ready:local-whisper:base` |
| Captionless YouTube import | Explicit video URL through `prepareYouTubeVideo` | PASS: downloaded a 79 MiB 1280×720/40:37.9 media file, generated 3 ordered frames and 1,212 local-Whisper cues / 21,590 transcript characters through the actual Electron sidecar; a cached replay completed in 37.34 seconds and reported `transcriptKind=local-whisper`, `ready:cached-local-whisper`, first cue `00:00`, and last cue `40:35` |
| Whole-ledger model analysis | Prepared 40:38 evidence through detected Codex CLI | PASS: 1,181 time-coded cues / 21,358 transcript characters were divided into 5 evidence chapters; Codex returned an 11,547-character report in 192,156 ms and covered the opening macro context, PLTR, IGV, large-cap technology, TSLA/SPCX, AMD/NFLX/ISRG/NVDA, SPY/QQQ, CTA positioning, and the closing remarks |
| Installed client | `/Applications/LensQuery Electron Preview.app` with the 40:38 fixture | PASS: the installed app displayed 24 ordered frames, 1,181 subtitle intervals, an estimate of 5 chapters, the long-video pending state, the `完整内容` action, and a complete five-chapter Codex report; the model phase ran from 20:23:46 to 20:26:15 local time (about 149 seconds), the answer remained in the local timeline, and a relaunch automatically positioned the conversation at its conclusion with follow-up available |

## Evidence and limitations

- Whisper output is evidence of an automated transcription, not a publisher-provided verbatim transcript. Proper nouns, tickers, figures, and homophones can be wrong; the final model must treat uncertain transcription accordingly.
- The model result explicitly flagged likely ASR errors such as `ISM`/`ICM`, `AMD`/`MD`, `ISRG`/`ISG`, and an implausible PLTR percentage instead of silently presenting them as verified facts.
- Frame sampling proves only the supplied timestamps, not continuous motion between frames.
- Long-video frame previews are kept live for the current conversation but are not serialized as dozens of base64 images. The history entry keeps frame paths and the completed answer, preventing local browser-storage growth from hiding a result; the current LevelDB write fell from a 13.5 MB preview-heavy record to about 115 KB after relaunch.
- A missing caption track triggers the local audio path; it does not authorize arbitrary websites, playlists, private videos, membership videos, or access-control bypass.
- The local downloader and Whisper executable remain external runtime dependencies in this preview build. Bundling, updater policy, model-license notices, and physical Windows performance are separate release gates.
