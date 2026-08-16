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

The packaged client is installed at `/Applications/LensQuery.app`; the previous Tauri bundle and former `/Applications/LensQuery Electron Preview.app` path have been removed. The final acceptance used the installed file picker, Rust sidecar, detected Codex CLI, persisted Electron conversation, rendered evidence card, and client-visible answer rather than only invoking the sidecar from a terminal.

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

## Strict provenance and hidden-content rerun — 2026-08-16

This rerun tests the fixed media-forensics output contract: a visual model is not allowed to promote style into a provenance verdict. Only a trusted, asset-bound C2PA AI source type or an issuer's independently verified watermark can produce a verified-AI result.

| Fixture | SHA-256 | Local result |
| --- | --- | --- |
| Original OpenAI-generated PNG | `632055eeb9c95e0889a374e7da294e8853a0fa4dfcdf2e33403275ebc65da586` | `verified-ai`; trusted OpenAI signer; `trainedAlgorithmicMedia`; `gpt-image 2.0`; no validation warnings |
| Same PNG with its C2PA chunk preserved but one pixel sample changed | `bdb4a567d27cbefd2f5e12fdf8334611c4521e8c3976d606daca8bda4a6628bb` | `invalid-credential`; asset binding fails with `assertion.dataHash.mismatch` and is not accepted as verified |
| Same AI image decoded and re-encoded without Content Credentials | `ea9ca17224280b707de990ddb1a47043553000172aaebe013934004a34414e84` | `inconclusive`; the application does not infer a verified source from the unchanged-looking artwork |
| Ordinary reference JPEG without a provenance credential | `6017d8c75b7a5e110101f308309b15d78e41f4761970f302c8228c953d9b6b46` | `inconclusive`; no false “human” or “AI” result |
| Near-white hidden-instruction PNG | `d1e0c384f1739b7c4c5dbfc1f7cc02ade9867204114332b9fbb5de492a5d738e` | `inconclusive` for origin; global stretch and local difference expose the real low-contrast characters |

The real OpenAI fixture produced the following verified fields through the same Rust sidecar used by Electron:

- issuer `OpenAI OpCo, LLC`;
- signer `OpenAI Media Service`;
- validation state `trusted` with asset binding and no warnings;
- `digitalSourceType=trainedAlgorithmicMedia`;
- `softwareAgent=gpt-image 2.0`;
- action `c2pa.watermarked.unbound`, reported only as a workflow declaration rather than an independent pixel-watermark result.

The final Codex CLI run returned `verified AI-generated` from those fields in 56.574 seconds and explicitly excluded the artwork's style from the verdict. The hidden-content run returned `insufficient evidence` for AI origin, exposed the near-background instruction using both generated forensic views, labeled it suspected prompt injection instead of obeying it, and completed in 47.869 seconds.

Disposable request/result envelopes are kept outside the repository:

- `/tmp/lensquery-forensics-acceptance.json`
- `/tmp/lensquery-ai-analyze-request.json`
- `/tmp/lensquery-ai-analyze-result.json`
- `/tmp/lensquery-ai-tampered-inspection.json`
- `/tmp/lensquery-hidden-analyze-request.json`
- `/tmp/lensquery-hidden-analyze-result.json`

This rerun also confirms the negative boundary: re-encoding can strip provenance, proprietary watermarks need their issuer's verifier, and exact same-value flattened pixels have no remaining signal to recover. In all three cases LensQuery must report the gap rather than guess.

## Automatic provenance and prompt recovery rerun — 2026-08-16

The installed Electron client now begins media analysis immediately after a Finder/browser import or the existing target-selection confirmation. It does not open a second client-side preview or require a separate “AI source” action. The evidence row is passive and reports the provenance state before the provider answer completes.

| Fixture | SHA-256 | Installed-client result |
| --- | --- | --- |
| Trusted OpenAI PNG | `632055eeb9c95e0889a374e7da294e8853a0fa4dfcdf2e33403275ebc65da586` | Automatic `verified-ai`; trusted `OpenAI OpCo, LLC` / `OpenAI Media Service`; `gpt-image 2.0`; the manifest has no prompt ingredient, so prompt recovery is `absent` |
| PNG with exact `parameters` text | `ab69bb08b07d2f05d6588829f3897939d431629130764323805e93b804903c9a` | Automatic `inconclusive`; the exact embedded bytes are exposed as `embedded-unverified`, not promoted to a verified generator prompt |
| Plain text fixture | `f58493ed7f337c8ddda9d75bf81b3f0fafe39be0e3eac6cc4f9ea0452fe4da2d` | Automatic `inconclusive`; no matching keyed text-watermark verifier result, and no style classifier is used as authorship proof |
| Ordinary two-second MP4 | `fc89de5282c73e7a8df77214da4c0d2dee34b1da1edcc9ab58e214a9035aebf7` | Automatic video preparation, playback, keyframes and analysis; C2PA absent, so origin remains `inconclusive` and prompt recovery is `absent` |

Prompt recovery has three explicit states:

1. `verified-exact`: the exact prompt bytes are bound into a trusted C2PA prompt ingredient;
2. `embedded-unverified`: exact bytes were stored in unsigned or otherwise untrusted metadata, so LensQuery displays them verbatim without claiming who wrote them;
3. `absent`: no original prompt was retained, so LensQuery can only provide a clearly labelled reconstruction rather than claim an exact inverse.

Installed-runtime checks used `/Applications/LensQuery.app/Contents/Resources/sidecar/lensquery-core` and the same deep-link path used by Finder integration. The packaged app passed deep code-signature verification, remained running in background mode, and rendered both the passive automatic status and media preview/player. Disposable local evidence:

- `/tmp/lensquery-auto-provenance-installed-result.json`
- `/tmp/lensquery-auto-video-installed.json`
- `/tmp/lensquery-auto-deeplink-4s.png`
- `/tmp/lensquery-auto-openai-5s.png`
- `/tmp/lensquery-auto-video-5s.png`

This is deliberately not described as a universal detector. A positive result requires a valid, file-bound credential or the corresponding issuer's official watermark verifier. A missing/stripped credential, unsupported proprietary watermark, copied text, or rewritten output remains insufficient evidence.

## Mixed blind provenance run — Google SynthID, OpenAI C2PA, and ordinary controls

Date: 2026-08-16 (Asia/Tokyo)

Eight public/local fixtures were copied into a separate temporary directory under random neutral names. LensQuery received only one neutral path at a time, the media bytes, and its own extracted evidence. The source labels, source URLs, and ground-truth mapping were held in a different file and were not included in any provider request.

| Blind ID | Ground truth revealed after completion | SHA-256 | LensQuery strict result | Prompt result |
| --- | --- | --- | --- | --- |
| `sample-0e4c89.webp` | Google Nano Banana image from the official naming article | `021b329bce63e5c255da7aca30316a670dad781223a6a3349bb0a12f8b831695` | `insufficient-evidence`; visible lower-right sparkle observed, but no C2PA or official SynthID result reached LensQuery | `absent` |
| `sample-0ac45e.webp` | Google Nano Banana Pro collage from the official product article | `310e00382fd4aa1ebe75b31cbce3912671f0a7998b1785383873cb12f9c21ea0` | `insufficient-evidence`; content described correctly, no source credential exposed | `absent` |
| `sample-d5ee69.png` | OpenAI `gpt-image 2.0` image | `632055eeb9c95e0889a374e7da294e8853a0fa4dfcdf2e33403275ebc65da586` | `verified-ai`; trusted, file-bound OpenAI C2PA | `absent` |
| `sample-950147.mp4` | Google Veo 3 off-road video from the official model page | `79a552b9406a079682440c31f14d33a10ba8e1b8b2e96425f5de70f63350299d` | `insufficient-evidence`; six frames and audio extracted, no official watermark result reached LensQuery | `absent` |
| `sample-bfca28.mp4` | Google Veo 3 paper/origami video from the official model page | `d9c0250a2361508968373c57b01ff76cd78a6dec1c5a8724a551d144bd7e9736` | `insufficient-evidence`; six frames extracted, visual traits kept heuristic | `absent` |
| `sample-3d38af.jpg` | 2005 Nikon E5200 human photograph from Wikimedia Commons | `0316d13640f1985ee6a8e5b720e866176ed0c9f01e9623fcf0e4251c79975077` | `insufficient-evidence`; camera EXIF shown as supporting metadata, not proof | `absent` |
| `sample-1b1ab1.png` | Local macOS screenshot | `3594906037a9f46503f23ea16e6eb59dbe5574bc34e9e3f7c468142065f495ab` | `insufficient-evidence`; correctly described as a screenshot, no false AI verdict | `absent` |
| `sample-bbf5fb.mp4` | NASA edited archival video | `e697d8cfdcd6540d1f4957edfc7a9f0ae18f9bfa994c21b6e13a0ef2645d0681` | `insufficient-evidence`; six frames, audio, and transcript analyzed, no false AI verdict | `absent` |

Strict local provenance coverage on this set was therefore **1/5 verified AI positives**, **0/3 false AI positives**, and **7/8 unresolved rather than guessed**. Content understanding worked across all eight files, but visual plausibility never overrode the provenance status. Exact original-prompt recovery was **0/8** because none of these delivered files contained a trusted C2PA prompt ingredient or an unsigned prompt field.

### Official Google verifier control

To determine whether the four Google samples had actually lost SynthID during website delivery, the same neutral files were separately uploaded one at a time to Gemini Apps' official `Verify AI` tool in temporary chats. No source labels were provided:

| Blind ID | Official Gemini Apps result |
| --- | --- |
| `sample-0e4c89.webp` | Generated or edited with Google AI |
| `sample-0ac45e.webp` | All or part of the collage generated or edited with Google AI |
| `sample-950147.mp4` | SynthID detected in both visual and audio portions |
| `sample-bfca28.mp4` | Visuals and audio generated or edited with Google AI |
| `sample-3d38af.jpg` | No reliable Google AI signal detected |
| `sample-bbf5fb.mp4` | No reliable Google AI signal detected |

The official control therefore separated **4/4 Google AI samples** from **2/2 ordinary controls** in this run. The gap is specific: the downloaded Nano Banana and Veo files still carry detectable Google SynthID, while LensQuery has no supported public SynthID image/video detector endpoint to call. Gemini's official documentation currently exposes this verification through the signed-in Gemini Apps experience, one file at a time (up to 100 MB; video under 90 seconds), rather than through the generic Gemini multimodal API.

Disposable raw evidence:

- `/tmp/lensquery-blind-20260816.pxdkju/inspection.isolated.blind.json`
- `/tmp/lensquery-blind-20260816.pxdkju/video-preparations.isolated.blind.json`
- `/tmp/lensquery-blind-20260816.pxdkju/analysis-results.blind.json`
- `/tmp/lensquery-blind-20260816.pxdkju/gemini-official-baseline.json`

Product consequence: LensQuery must continue to report Google media as unresolved until a supported official SynthID verifier is configured. A normal Gemini vision-model answer, logo recognition, or visual anomaly score is not a substitute for the `Verify AI` result.
