# Media acceptance: ordinary photo, AI provenance, watermark, and YouTube summary

Date: 2026-08-15 (Asia/Tokyo)

This acceptance run separates fixture provenance, local preprocessing, model completion, and client-visible presentation. A model saying “AI-looking” is not enough: the AI fixture must expose a validated machine-readable origin signal, and missing signals must never be treated as proof of human origin.

## Fixtures

| Case | Source and ground truth | Local SHA-256 |
| --- | --- | --- |
| Ordinary photograph | [Wikimedia Commons `Ggb.jpg`](https://commons.wikimedia.org/wiki/File:Ggb.jpg), uploaded as a 2005 Golden Gate Bridge photograph by Daryl Beggs; original EXIF identifies a Nikon E5200 | `0316d13640f1985ee6a8e5b720e866176ed0c9f01e9623fcf0e4251c79975077` |
| AI image + visible disclosure + embedded provenance | Generated in Codex with OpenAI image generation from the prompt recorded below; original PNG contains the visible text `AI GENERATED • LENSQUERY TEST` | `c0c526d6e1523ebf5c09caf1b3926a177e9e1b7aeffd164c9ccf4b8c3c094996` |
| YouTube video | [NASA: 60 Years in 60 Seconds](https://www.youtube.com/watch?v=1UaBgr_sq9A), NASA verified channel, 60.03-second 720p download plus English VTT supplied by YouTube | `e697d8cfdcd6540d1f4957edfc7a9f0ae18f9bfa994c21b6e13a0ef2645d0681` |

AI fixture prompt summary: a photorealistic glass observatory floating over a bioluminescent ocean at blue hour, with an astronaut botanist and the exact bottom-right disclosure `AI GENERATED • LENSQUERY TEST`.

The fixture files were kept under `/tmp/lensquery-media-acceptance-20260815` and were not committed to the repository.

## Acceptance requirements

1. **Ordinary photo:** identify the Golden Gate Bridge; report no visible watermark; surface the Nikon EXIF fields; state that EXIF and natural appearance do not prove human origin; avoid claiming that absence of C2PA means “not AI.”
2. **AI image:** read the visible disclosure; validate embedded C2PA structure, file binding, signature, and signer trust; report `trainedAlgorithmicMedia`, `gpt-image 2.0`, OpenAI issuer, and the watermark action; distinguish that declaration from an independent SynthID detector.
3. **YouTube video:** prepare bounded time-coded frames, audio derivative, and available subtitles; produce a one-paragraph summary, timestamped moments, and learning points; state subtitle/audio/frame coverage.
4. **Latency:** use a bounded low reasoning effort for ordinary identify/summary paths rather than inheriting a user-wide maximum reasoning setting. Deep-dive/report requests retain medium effort.
5. **Presentation:** the conversation evidence disclosure must show the selected image or video frame, provenance/subtitle rows, full answer, and follow-up actions.

## Results

| Case | Local preprocessing | Analysis result | Wall time |
| --- | --- | --- | ---: |
| Ordinary photo | No C2PA; EXIF `NIKON`, `E5200`, `E5200 V 1.2`, `2005-05-14 19:09:47` | PASS: Golden Gate Bridge identified; no visible watermark; EXIF and inference limits separated | 16.70 s |
| AI image | C2PA `trusted`; issuer `OpenAI OpCo, LLC`; signer `OpenAI Media Service`; `trainedAlgorithmicMedia`; `gpt-image 2.0`; `c2pa.watermarked.unbound` | PASS: visible disclosure read and trusted machine-readable AI provenance reported as direct evidence | 17.33 s |
| NASA video | 12 frames at ~5.00-second intervals; mono audio derivative; 23 time-coded English VTT segments | PASS: mission/history summary, timestamped moments, learning points, and evidence boundary | 1.27 s preparation + 23.99 s analysis |

Raw local envelopes from the acceptance run:

- `/tmp/lensquery-media-acceptance-20260815/fixed-inspect.json`
- `/tmp/lensquery-media-acceptance-20260815/fixed-human-low-effort.json`
- `/tmp/lensquery-media-acceptance-20260815/fixed-ai-low-effort.json`
- `/tmp/lensquery-media-acceptance-20260815/fixed-video-low-effort.json`

## Installed Electron runtime

The packaged client was installed at `/Applications/LensQuery Electron Preview.app` (333 MB, Apple Development signature) without replacing `/Applications/LensQuery.app`. The final acceptance used the installed file picker, Rust sidecar, detected Codex CLI, persisted Electron conversation, rendered evidence card, and client-visible answer rather than only invoking the sidecar from a terminal.

An initial packaged run exposed a separate runtime defect: a GUI launched from an existing Codex process inherited the parent's Codex thread/session environment and reused the user's multi-gigabyte Codex history databases. The child CLI repeatedly logged `state db discrepancy ... falling_back` and timed out before model completion. The final implementation:

- removes parent-agent thread/session environment variables;
- prefers the installed native Codex executable over its npm/Node launcher;
- gives LensQuery a private `CODEX_HOME`/`CODEX_SQLITE_HOME` state directory while linking the user's existing `config.toml`, `auth.json`, model catalog, and referenced instruction file;
- explicitly closes CLI stdin, preserves bounded stderr diagnostics, and terminates the complete subprocess group on timeout;
- declares local-network gateway usage in the packaged macOS application metadata.

The isolated state directory does not modify or scan the user's existing conversation history. Authentication and provider configuration remain sourced from the user's existing Codex files.

| Installed-client case | Client-visible evidence | Persisted wall time | Result |
| --- | --- | ---: | --- |
| Ordinary photo | Selected-image thumbnail; Golden Gate identification; Nikon EXIF; no visible watermark; evidence limits | 36.41 s | PASS |
| AI image | Selected-image thumbnail; `AI 来源凭证已验证`; visible disclosure; trusted OpenAI C2PA; watermark boundary; reconstruction prompt | 35.21 s | PASS |
| NASA video follow-up | 12 timestamped frames; audio derivative; 23 subtitle segments; one-paragraph summary and five timestamped moments | 14.26 s | PASS |

The timings above are computed from the installed client's persisted message/session timestamps. Local screenshots were saved only with the other disposable fixtures:

- `/tmp/lensquery-media-acceptance-20260815/client-human-success.png`
- `/tmp/lensquery-media-acceptance-20260815/client-ai-success.png`
- `/tmp/lensquery-media-acceptance-20260815/client-video-success.png`

## Detector boundary

- A trusted C2PA manifest with `digitalSourceType=trainedAlgorithmicMedia` is direct provenance evidence for the file that passed the asset-binding check.
- A C2PA watermark action records that the issuing workflow declared a watermark. It is not the same as independently detecting the invisible signal in pixels.
- Visible disclosure text is direct pixel evidence but can be added or removed by an editor.
- EXIF camera metadata can be changed and is supporting evidence only.
- No signal found never proves that an image is human-made: metadata may be stripped and proprietary watermarks may be absent, degraded, or unsupported.

The C2PA trust-list snapshot and its source commit are recorded in `src-tauri/resources/c2pa/README.md` and should be refreshed as part of each release.
