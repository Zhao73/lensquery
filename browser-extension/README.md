# LensQuery Web Connector

Chrome / Edge Manifest V3 companion extension. It adds exact page context that desktop pixels and Windows UI Automation cannot reliably expose:

- one native **使用 LensQuery 识别** right-click action across selected text, images, video, audio, links, editable areas, controls, and page background;
- a bounded target screenshot for visual grounding and display in the LensQuery conversation;
- clicked text, buttons, links, images, form controls, and video/audio state;
- visible player captions, caption tracks already published by the active YouTube page, already-open generic transcript segments, cue counts, and an explicit truncation marker;
- selected text, one word, the surrounding paragraph, the whole page, or the current object;
- bounded nearby text, an element selector, accessible name, and sanitized `outerHTML`;
- an optional short annotation plus identify/explain/how-to/deep/customer/code intent;
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
5. Reload the extension once, then start LensQuery. You can now:
   - right-click selected text, an image, video/audio, link, editable area, control, or page background;
   - choose **使用 LensQuery 识别**; the extension resolves the current target type and starts the matching analysis in the background;
   - press `Ctrl+Shift+Space` and use the two-click DOM picker. Hold Option/Alt on the confirming click only for the advanced range/intent/annotation composer.

The extension requests `activeTab` and `contextMenus`; page access starts only after an explicit toolbar, shortcut, or right-click action. It has no persistent all-sites content script. `nativeMessaging` passes the bounded DOM context and an optional compressed target crop to the resident desktop process. On browser-internal pages where script injection is restricted, the menu can still submit the limited title/URL fallback rather than claiming DOM access.

The system overlay can always capture browser pixels with the same global shortcut. Exact DOM text, video state, selectors, visible captions, and page-published transcript data require this companion extension. For YouTube, LensQuery first chooses a page-published caption track, fetches that caption payload from YouTube, and builds bounded time-coded text. If the explicitly selected video has no page transcript, the desktop runtime can use local `yt-dlp` and local Whisper to prepare the video; non-YouTube URLs, playlists, videos longer than four hours, and files above the configured bound are rejected. Chrome/Edge may reserve or remap an extension shortcut; verify it in `chrome://extensions/shortcuts` or invoke the toolbar icon when the operating-system shortcut wins the conflict.

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
