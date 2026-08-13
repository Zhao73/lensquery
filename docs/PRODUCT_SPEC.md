# LensQuery product specification

## Core user journey

### Shortcut capture

1. User presses the configurable global shortcut.
2. LensQuery freezes a visual snapshot of all displays and opens a transparent selection layer.
3. The user either clicks an object or drags a rectangle.
4. LensQuery assembles a context package containing the crop, source bounds, display scale, foreground application, window title, and non-sensitive accessible text when available.
5. A preview appears before any network request. Every attachment and metadata field can be removed.
6. The user asks a question or chooses a prompt preset and submits.
7. A compact answer window appears near the selection; the full window keeps the conversation and evidence.

### Local file analysis

1. User opens LensQuery from the tray, drags files onto the home screen, uses the picker, or invokes an operating-system file action.
2. LensQuery classifies each attachment and previews the local extraction result.
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
| AI-01 | Configure multiple provider profiles | Profiles preserve endpoint/model settings without storing raw secrets in JSON |
| AI-02 | Stream a multimodal answer | Partial output is visible and cancellation stops the request |
| AI-03 | Switch model before retry | Evidence and question stay intact while profile changes |
| CLI-01 | Detect Codex and Claude Code executables | Settings reports resolved path and an explicit health result |
| CLI-02 | Run a read-only non-interactive query | Invocation has bounded turns/time and does not grant command tools by default |
| PRIV-01 | Preview outbound data | No submission occurs before explicit confirmation |
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
    extraction: "direct" | "text" | "pages" | "metadata";
  }>;
};
```

## Provider adapter contract

Every adapter implements:

- capability discovery: vision, PDF, generic files, streaming, web search;
- request normalization from the context package;
- stream events: started, text delta, usage, completed, cancelled, error;
- sanitized error mapping for auth, endpoint, model, rate limit, content limit, timeout, and offline state;
- connection test that sends no captured customer content.

## Prompt presets

- **What is this?** Identify the selected thing, explain relevant surrounding context, and distinguish observation from inference.
- **Customer reply** Return: short finding, recommended answer in the customer’s language, action needed, and uncertainty.
- **Troubleshoot** Read visible error evidence, list the most likely root cause, then the smallest verification steps.
- **Summarize file** Summarize scope, important facts, decisions, dates, and missing information.
- **Custom** Preserve the evidence and let the user type the instruction.

## Non-goals for the first release

- Background surveillance or periodic capture.
- Automatic sending of customer messages.
- Broad autonomous desktop control.
- Claiming full web-page semantics without a browser connector.
- Uploading entire folders by default.

