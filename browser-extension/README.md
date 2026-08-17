# What is it Web Connector

Chrome / Edge Manifest V3 companion extension. It adds exact page context that desktop pixels and Windows UI Automation cannot reliably expose:

- one native **使用 What is it 识别** right-click action across selected text, images, video, audio, links, editable areas, controls, and page background;
- one explicit **使用 What is it 分析当前网址** action on the webpage background and the extension-icon menu;
- one-click current-page analysis from the What is it toolbar icon, plus the `lq` address-bar keyword for a pasted or typed URL;
- a matching injected action for players and web apps that replace Chrome's menu with their own, including Bilibili-style video menus and canvas-heavy interfaces;
- a bounded target screenshot for visual grounding and display in the What is it conversation;
- clicked text, buttons, links, images, form controls, and video/audio state;
- bounded frontend-construction evidence: query-free script/stylesheet URLs, evidence-backed framework/platform hints with confidence, page structure and accessibility counts, responsive CSS, resource counts, and selected-element computed styles;
- visible player captions, caption tracks already published by the active YouTube page, already-open generic transcript segments, cue counts, and an explicit truncation marker;
- the selected text when present, otherwise the current object and its bounded surrounding context;
- bounded nearby text, an element selector, accessible name, and sanitized `outerHTML`;
- one automatic analysis task that classifies the selected evidence and chooses the useful depth and structure in the background;
- active page URL and title.

## Development install

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select either this `browser-extension` directory or the packaged directory at `/Applications/LensQuery.app/Contents/Resources/browser-extension`.
4. Confirm that the extension ID is `filelbpgenppllkeeofajalcgbnifgmi`, then install the LensQuery Native Messaging Host. `npm run install:electron:macos` already performs this host step for the packaged preview.

   macOS:

   ```bash
   ./native-host/install-macos.sh filelbpgenppllkeeofajalcgbnifgmi "/Applications/LensQuery.app"
   ```

   Windows:

   ```powershell
   .\native-host\install-windows.ps1 -ExtensionId EXTENSION_ID -LensQueryExe "C:\path\to\lensquery.exe"
   ```
5. Reload the extension once, then start What is it. You can now:
   - right-click selected text, an image, video/audio, link, editable area, control, or page background;
   - choose **使用 What is it 识别**; the extension resolves the current target type and starts the matching analysis in the background;
   - when a site suppresses Chrome's native menu, choose the compact **使用 What is it 识别** action shown next to the site's own menu;
   - press `Ctrl+Shift+Space` and use the two-click DOM picker; the second click submits immediately without a prompt composer.
   - click the What is it toolbar icon to analyze the complete current page directly;
   - type `lq`, press `Tab` or `Space`, then press `Enter` to analyze the current page, or enter another complete URL to open and analyze it.

The extension requests page access so a lightweight content script can detect sites that suppress Chrome's menu. It listens for a right-click but does not collect or send page content until the user explicitly chooses a What is it action. `nativeMessaging` then passes the bounded DOM context and an optional compressed target crop to the resident desktop process. File URLs additionally require Chrome's **Allow access to file URLs** toggle. On browser-internal pages where script injection is restricted, the native menu can still submit the limited title/URL fallback rather than claiming DOM access.

Chrome's address bar is browser UI rather than webpage DOM. Chrome does not expose an API for an extension to insert its own command into the address bar's native Cut/Copy/Paste menu. The supported direct address-bar route is therefore the registered `lq` omnibox keyword; webpage right-click, the toolbar icon, and the global picker remain separate entry points.

The system overlay can always capture browser pixels with the same global shortcut. Exact DOM text, video state, selectors, frontend-construction evidence, visible captions, and page-published transcript data require this companion extension. For YouTube, What is it first chooses a page-published caption track, fetches that caption payload from YouTube, and builds bounded time-coded text. If an explicitly selected public HTTPS video has no page transcript, the desktop runtime can use local `yt-dlp` and local Whisper to prepare it. Extractor-supported sites and direct HTTPS media are accepted; playlists, videos longer than four hours, private/local-network targets, login-only or DRM media, live/indefinite streams, and unsupported blob-only sources are rejected with an explicit error. Chrome/Edge may reserve or remap an extension shortcut; verify it in `chrome://extensions/shortcuts` or invoke the toolbar icon when the operating-system shortcut wins the conflict.

## Native host contract

Host name: `com.lensquery.desktop`

Request:

```json
{ "type": "browser-context", "context": { "url": "https://example.test", "tagName": "BUTTON" } }
```

Response:

```json
{ "ok": true }
```

The packaged Rust sidecar implements `--native-messaging-host`: it validates the framed request, rejects browser-supplied local paths, materializes only a bounded JPEG/PNG/WebP crop into LensQuery's temporary capture directory, and writes the context into a user-local queue. The extension key fixes the unpacked ID, so the macOS installer can wire the host without a copy-and-paste step.
