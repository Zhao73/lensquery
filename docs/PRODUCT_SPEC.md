# LensQuery product specification

## Core user journey

### Shortcut capture

1. User presses the configurable global shortcut.
2. LensQuery leaves the current desktop visible and opens a transparent selection layer with a small question-mark pointer and no cursor-following box.
3. The user clicks once to resolve/highlight the real object or file and clicks it again to confirm, or drags a rectangle that submits on release.
4. LensQuery assembles a context package containing the crop, source bounds, display scale, foreground application, window title, and non-sensitive accessible text when available.
5. The shortcut plus second confirming click/drag release is the explicit submission gesture, so analysis starts immediately in the background without opening the main window or a confirmation page.
6. The answer arrives through the configured upper-right card/window presentation; the local timeline keeps the conversation and evidence for follow-up.

### Local file analysis

1. User opens LensQuery from the tray, drags files onto the home screen, uses the picker, or invokes an operating-system file action.
2. LensQuery classifies each attachment and previews the local extraction result. Images show local provenance coverage; videos show duration, stream metadata, sampled timestamps, sidecar/Whisper transcript origin, chapter estimate, and any uncovered audio.
3. The request follows the same provider-independent preview and submission flow.

## Functional requirements

| ID | Requirement | Acceptance signal |
| --- | --- | --- |
| CAP-01 | Register and update a global shortcut | New shortcut works after save without restart |
| CAP-02 | Drag a rectangular capture on mixed-DPI displays | Saved pixel bounds match the visible selection at 100-200% scaling |
| CAP-03 | Click a desktop UI element | UIA name, role, and bounding box appear when exposed; pixel fallback is clear |
| CAP-04 | Cancel capture safely | Escape closes the overlay and sends nothing |
| FILE-01 | Attach image, PDF, or text-oriented file | Preview shows filename, media type, size, and extract mode |
| FILE-02 | Reject unsupported or oversized input recoverably | Inline message names the limit and next action |
| VIDEO-01 | Probe a local video without upload | Duration, resolution, codecs, rotation, and audio presence are visible |
| VIDEO-02 | Prepare a bounded video evidence package | At most 24 time-coded frames and one compact mono audio track are created locally |
| VIDEO-03 | Analyze long and short clips consistently | Sampling adapts to duration; videos ≥20 minutes produce at most 12 chronological transcript chapters and every chapter appears in the final synthesis |
| VIDEO-04 | Use available subtitle/audio evidence | A same-name VTT/SRT track is preferred; otherwise an available local Whisper CLI produces a labeled time-coded transcript without uploading audio |
| VIDEO-05 | Analyze an explicitly selected YouTube video | Page captions are preferred; otherwise bounded local yt-dlp + Whisper preparation accepts only HTTPS YouTube, rejects playlists/non-YouTube URLs, and reports dependency/access failures |
| IMAGE-01 | Inspect image provenance locally | C2PA asset binding, signature/trust, exact source type, watermark declarations, EXIF, forensic derivatives, and visual inference remain distinct; missing signals resolve to inconclusive |
| IMAGE-02 | Expose hidden pixel signals without inventing content | Bounded luminance stretch, local background difference, and meaningful Alpha views are shown and attached; exact same-value flattened pixels are declared unrecoverable |
| WEB-01 | Audit explicitly selected page context for hidden text | Accessible hidden/transparent/clipped/off-screen/low-contrast DOM text is bounded, quoted, and instruction-like content is labeled as untrusted prompt injection |
| AI-01 | Configure multiple provider profiles | Profiles preserve endpoint/model settings without storing raw secrets in JSON |
| AI-02 | Stream a multimodal answer | Partial output is visible and cancellation stops the request |
| AI-03 | Switch model before retry | Evidence and question stay intact while profile changes |
| CLI-01 | Detect Codex and Claude Code executables | Settings reports resolved path and an explicit health result |
| CLI-02 | Run a read-only non-interactive query | Invocation has bounded turns/time and does not grant command tools by default |
| PRIV-01 | Bound explicit capture | Only the shortcut plus the following click/drag is submitted; manual imports may use the optional preview |
| PRIV-02 | Redact protected UI fields | Password and secret-like accessible values are absent from request snapshots |
| HIST-01 | Keep optional local history | User can disable screenshot retention and clear all history |

## Context package contract

```ts
type ContextPackage = {
  id: string;
  createdAt: string;
  question: string;
  capture?: {
    kind: "region" | "element" | "window";
    imageDataUrl: string;
    bounds: { x: number; y: number; width: number; height: number };
    displayScale: number;
  };
  application?: {
    processName?: string;
    windowTitle?: string;
    elementRole?: string;
    elementName?: string;
    accessibleText?: string;
  };
  files: Array<{
    name: string;
    path: string;
    mediaType: string;
    size: number;
    extraction: "direct" | "text" | "pages" | "metadata" | "video-derivatives";
    video?: {
      durationSeconds: number;
      hasAudio: boolean;
      strategy: "uniform-keyframes-v1";
      sampledTimestamps: number[];
    };
  }>;
};
```

## Provider adapter contract

Every adapter implements:

- capability discovery: vision, PDF, generic files, video-frame analysis, audio transcription, streaming, web search;
- request normalization from the context package;
- stream events: started, text delta, usage, completed, cancelled, error;
- sanitized error mapping for auth, endpoint, model, rate limit, content limit, timeout, and offline state;
- connection test that sends no captured customer content.

## Prompt presets

- **What is this?** Identify the selected thing, explain relevant surrounding context, and distinguish observation from inference.
- **Customer reply** Return: short finding, recommended answer in the customer’s language, action needed, and uncertainty.
- **Troubleshoot** Read visible error evidence, list the most likely root cause, then the smallest verification steps.
- **Summarize file** Summarize scope, important facts, decisions, dates, and missing information.
- **Analyze video** Reconstruct the sequence from timestamped frames and transcript, summarize the content, identify important moments, and produce a customer-ready answer when requested. For long videos, cover the whole supplied chapter ledger, key facts/data/entities/examples, and facts-versus-opinion boundaries.
- **Check media origin** Call content AI-generated only when a trusted, asset-bound C2PA `trainedAlgorithmicMedia` claim or an issuer's official watermark verifier supports it. Keep AI editing/compositing distinct, treat metadata/style as supporting evidence only, and return insufficient evidence when no direct signal exists.
- **Custom** Preserve the evidence and let the user type the instruction.

## Non-goals for the first release

- Background surveillance or periodic capture.
- Automatic sending of customer messages.
- Broad autonomous desktop control.
- Claiming full web-page semantics without a browser connector.
- Uploading entire folders by default.
