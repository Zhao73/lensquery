# Global and undisclosed watermark research

Verified on 2026-08-16. This document separates four questions that must not be collapsed:

1. Is a watermark algorithm publicly registered?
2. Does the file declare that algorithm or carry a recoverable binding?
3. Did a matching decoder actually return a positive result?
4. Can a blind forensic scan see an unattributed signal?

Only item 3, or an intact trusted provenance credential that directly records AI origin, can verify a provider-specific origin. Item 4 is a research candidate, not authorship proof.

## Exact boundary: why arbitrary files cannot have a 100% byte-only origin verdict

Let `x` be a canonical one-pixel black PNG. One history can start with an AI-generated image and deterministically flatten it to `x`; another can start with a human-created black canvas and export the exact same `x`. Both histories produce identical bytes and the same SHA-256. Any detector whose only input is `x` must return the same answer for both histories, so it cannot be correct for both.

This is an indistinguishability counterexample, not a limitation of one model. A universal product can achieve complete *routing coverage* for known detectors, preserve signed provenance, and discover unexplained signals. It cannot reconstruct evidence that was never embedded, was stripped, or is cryptographically indistinguishable without the issuer's key.

The acceptance run instantiated the counterexample with a frame from an official Seedance 2.0 video and a frame from an official NASA video. The source-frame SHA-256 values differed (`e1ddc28c…` versus `44325e0d…`). After the same deterministic one-pixel black canonicalization, both 69-byte PNGs had SHA-256 `c47dd9465c00e9a0c8b85e9ea58d3034a0d23b9cf926113602f3460752a4eb96` and were byte-for-byte identical.

## Standards and regulatory layers

### European Union

[AI Act Article 50](https://eur-lex.europa.eu/eli/reg/2024/1689/oj?locale=en) requires providers of synthetic audio, image, video, and text systems to mark outputs in a machine-readable and detectable way, while expressly conditioning the requirement on technical feasibility, state of the art, cost, and implementation constraints. The European Commission's [final Code of Practice on marking and labelling AI-generated content](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content) uses a multi-layer design because its technical review found no single current marking technique satisfies every required property. It combines signed metadata, imperceptible watermarking, public detector access, robustness testing, and optional forensic fallback. The final code also says forensic classifiers for stripped marks are not yet mature enough to serve as the required marking layer.

LensQuery therefore reports the observed EU technical layers as `two-layer-evidence-observed`, `signed-metadata-only`, `watermark-declaration-only`, or `not-observed`. This is evidence coverage, not a legal-compliance judgment.

### China

The [CAC labelling measures](https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm), the official [GB 45438-2025 record](https://std.samr.gov.cn//gb/search/gbDetailed?id=301E0388CB75788DE06397BE0A0AE1B4), and the [TC260 practice guide](https://www.tc260.org.cn/portal/article/2/20250828165129) define explicit and implicit labelling layers. LensQuery reads the bounded TC260 `AIGC` JSON/XMP/container representation. `Label=1` remains an unsigned AI declaration unless its integrity field is independently verified; `Label=2/3` remains supporting evidence.

### C2PA soft bindings

LensQuery pins the official [C2PA soft-binding algorithm list](https://github.com/c2pa-org/softbinding-algorithm-list) at commit `e69956c68556788f0c3f52fef9c2ba42d9904964`. The snapshot contains:

- 48 registered algorithms;
- 39 watermark algorithms and 9 fingerprint algorithms;
- 27 algorithms compatible with decoded images;
- 22 algorithms compatible with decoded video;
- 6 algorithm entries publishing a resolution API, across 4 unique base endpoints.

The app parses `c2pa.soft-binding` assertions, resolves their `alg` value against the pinned directory, counts binding blocks, and surfaces any public resolver. Binary binding values are not copied into provider prompts. C2PA's [2.4 guidance](https://spec.c2pa.org/specifications/specifications/2.4/guidance/Guidance.html) is algorithm-agnostic and supports federated resolvers; a directory hit identifies the declared algorithm, not a successful watermark decode.

Remote resolvers remain disabled by default. A later user-approved adapter can send only the required binding or content to the selected resolver.

## Detector hub architecture

| Layer | Current behavior | Result class |
|---|---|---|
| Signed C2PA | Local file binding, signature, trust list, actions, source types | verified / valid / invalid credential |
| TC260 metadata | Local JSON, XMP, and supported video-tag parsing | unsigned declaration |
| C2PA soft binding | Algorithm ID, registry metadata, binding-block count, resolver discovery | declared binding |
| Open detector plug-ins | TrustMark, VideoSeal/PixelSeal/AudioSeal and compatible future packages loaded on demand | decoder result |
| Provider verifier | Google, OpenAI, or other issuer verifier after explicit user opt-in | issuer-scoped result |
| Blind container/pixel scan | private PNG chunks, marker strings, top-level MP4 UUID boxes, hidden RGB below alpha, bit-plane/contrast checks | unattributed candidate |
| Batch discovery lab | cross-sample residual, bit-plane, temporal/audio and re-encode robustness tests | research candidate |

Large model weights are not bundled into the base Electron app. Open decoders and checkpoints should be optional, hash-pinned plug-ins with on-demand caches so the menu-bar client does not grow by gigabytes.

## Undisclosed-watermark blind experiment

### Data

- 5 original examples from the official [Seedance 2.0 page](https://seed.bytedance.com/en/seedance2_0).
- 4 original examples from the official [Seedance 2.5 page](https://seed.bytedance.com/en/seedance2_5).
- 5 ordinary/non-generative NASA control videos retrieved through the official [NASA Image and Video Library API](https://images.nasa.gov/docs/images.nasa.gov_api_docs.pdf).
- Every Seedance original was independently re-encoded to H.264 CRF 28.

### Blind protocol

Five normalized frames per video were sampled at fixed relative timestamps. Each frame produced a grayscale high-pass residual and decoded RGB least-significant-bit plane. Per-video residual maps were normalized, then tested for cross-video fixed spatial coherence. A deterministic 5,000-permutation null distribution used same-sized random subsets across all 14 originals. A candidate required all three gates:

1. permutation `p < 0.01`;
2. coherence above the null 99th percentile;
3. group pattern correlation above 0.5 after H.264 CRF 28 re-encoding.

### Results

| Group | N | High-pass coherence | Permutation p | LSB coherence | Re-encode pattern correlation | Candidate |
|---|---:|---:|---:|---:|---:|---|
| Seedance 2.0 | 5 | 0.00858 | 0.1236 | -0.00020 | 0.9921 | No |
| Seedance 2.5 | 4 | 0.00248 | 0.3791 | 0.00173 | 0.9879 | No |
| NASA controls | 5 | 0.01022 | 0.1040 | -0.00432 | n/a | No |

The re-encoded group averages remained correlated because the source content remained the same, but neither Seedance group exceeded its same-size null threshold. This run did not discover a robust fixed spatial or decoded-LSB signature unique to either Seedance group. It does not exclude a keyed, content-adaptive, semantic, temporal, audio, model-internal, or stripped watermark. It also does not establish that Seedance lacks a non-public verifier.

The reproducible temporary report for this run is `results/blind-watermark-report.json` inside the recorded experiment directory; its protocol and hashes are also summarized in the acceptance log. Product code intentionally keeps the verdict `insufficient-evidence` for these files.

## Unknown-signal status contract

- `candidate-observed`: a private block, marker, hidden-alpha payload, or calibrated batch signal needs attribution.
- `no-observable-anomaly`: the enabled image scans found no candidate; this does not mean no watermark.
- `limited`: only bounded container/string inspection ran, typically for video, audio, text, or documents without a matching decoder.

An unknown candidate never changes `aiOriginStatus`. Attribution requires a registered algorithm, a trusted credential, a successful matching decoder, or repeatable cross-sample validation with independent controls.

## Next detector plug-ins

1. Adobe [TrustMark](https://github.com/adobe/trustmark) decoders for registered TrustMark Q/C/P bindings.
2. Meta [VideoSeal](https://github.com/facebookresearch/videoseal), [AudioSeal](https://github.com/facebookresearch/audioseal), and PixelSeal-compatible resolution via the registered AIWatermark endpoint.
3. Google [SynthID](https://deepmind.google/models/synthid/) and [OpenAI Verify](https://openai.com/research/verify/) as provider-scoped adapters; a negative response is not universal proof of human origin.
4. C2PA resolver federation with per-request consent, response signatures, timeouts, result caching by file hash, and no silent upload.
5. A local batch lab for repeated samples, holdout controls, attack transforms, and detector calibration before any new signal is promoted from candidate to verified.
