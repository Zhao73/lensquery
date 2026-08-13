# Architecture

## Process model

- **Tauri webview:** dashboard, settings, evidence preview, result surface, history.
- **Rust core:** window lifecycle, tray, capture orchestration, screen APIs, Windows UI Automation, file reading, credential vault, provider HTTP, and local CLI subprocesses.
- **Capture overlay:** a dedicated transparent, borderless, always-on-top Tauri window with an immutable desktop snapshot underneath the selection UI.
- **Result overlay:** a separate compact always-on-top window. It never steals focus while the user is selecting.

## Rust modules

```text
src-tauri/src/
  lib.rs                 application and plugin setup
  commands.rs            narrow Tauri command surface
  models.rs              serialized contracts
  capture/
    mod.rs               CaptureBackend trait and coordinator
    mock.rs              deterministic development backend
    windows.rs           Windows Graphics Capture/GDI implementation
    uia.rs               UI Automation element lookup and redaction
  providers/
    mod.rs               ProviderAdapter trait
    openai.rs             Responses API
    anthropic.rs          Messages API
    compatible.rs         OpenAI-compatible endpoint
    cli.rs                Codex and Claude Code adapters
  files/
    mod.rs               classification and limits
    pdf.rs               metadata, text, bounded page rendering
  secrets.rs             OS credential vault abstraction
  storage.rs             settings and optional local history
```

## Frontend modules

```text
src/
  app/                    shell and route state
  components/             reusable controls and feedback states
  features/capture/       selection and capture preview
  features/analysis/      composer, progress, answer, follow-up
  features/files/         drop zone and attachment preview
  features/providers/     provider profiles and health checks
  features/settings/      shortcuts, privacy, storage, language
  lib/                    Tauri bridge and browser mock
  store/                  small Zustand app state
  types/                  shared frontend contracts
```

## Windows implementation notes

- Use virtual-screen coordinates, not primary-monitor coordinates.
- Convert between logical and physical pixels at every display boundary.
- Obtain a UI Automation element at the pointer using `ElementFromPoint`; walk only the bounded relevant subtree.
- Prefer Windows Graphics Capture for modern composed surfaces, with a documented fallback for older or protected surfaces.
- Hide LensQuery windows before acquiring the desktop image and restore only after the snapshot is ready.
- Protected video, elevated windows, secure desktops, and some GPU surfaces may return black or unavailable frames; report this as a platform limitation.

## Browser context phases

### First release

- Screen crop.
- Browser process and window title.
- UI Automation text where exposed.
- User-provided question.

### Companion extension

- Active tab URL/title and selected text.
- Bounded DOM/accessibility excerpt around a clicked coordinate.
- Explicit per-site permission and a visible connection indicator.
- Native messaging channel to the desktop app.

The extension is additive. Screen capture continues to work without it.

## Security model

- Tauri capabilities allow only commands required by named windows.
- Provider requests run in Rust so secrets never enter the webview or frontend logs.
- The webview receives masked provider status, never secret material.
- File reads require a picker result, drop event, shell invocation, or user-approved folder scope.
- CLI processes use an argument array rather than shell interpolation, a clean environment allowlist, a temporary evidence directory, and cancellation/timeout.
- The application never enables broad Codex or Claude Code tool permissions merely to analyze evidence.

