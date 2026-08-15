# LensQuery Web Connector

Chrome / Edge Manifest V3 companion extension. It adds exact page context that desktop pixels and Windows UI Automation cannot reliably expose:

- native browser right-click actions for selected text, an image, a video, or the current page;
- a bounded target screenshot for visual grounding and display in the LensQuery conversation;
- clicked text, buttons, links, images, form controls, and video/audio state;
- visible player captions plus page-exposed YouTube/generic transcript segments;
- selected text, one word, the surrounding paragraph, the whole page, or the current object;
- bounded nearby text, an element selector, accessible name, and sanitized `outerHTML`;
- an optional short annotation plus identify/explain/how-to/deep/customer/code intent;
- active page URL and title.

## Development install

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked** and select this `browser-extension` directory.
4. Copy the extension ID shown on the extension card, then install the LensQuery Native Messaging Host.

   macOS:

   ```bash
   ./native-host/install-macos.sh EXTENSION_ID /Applications/LensQuery.app
   ```

   Windows:

   ```powershell
   .\native-host\install-windows.ps1 -ExtensionId EXTENSION_ID -LensQueryExe "C:\path\to\lensquery.exe"
   ```
5. Reload the extension once, then start LensQuery. You can now:
   - select text, right-click, and choose **Use LensQuery to analyze selected text**;
   - right-click an image or video and choose the matching LensQuery action;
   - right-click page background to analyze the current page;
   - press `Ctrl+Shift+Space` and use the two-click DOM picker. Hold Option/Alt on the confirming click only for the advanced range/intent/annotation composer.

The extension requests `activeTab` and `contextMenus`; page access starts only after an explicit toolbar, shortcut, or right-click action. It has no persistent all-sites content script. `nativeMessaging` passes the bounded DOM context and an optional compressed target crop to the resident desktop process. The browser blocks injection on internal pages such as `chrome://`.

The system overlay can always capture browser pixels with the same global shortcut. Exact DOM text, video state, selectors, visible captions, and a transcript already exposed in the page require this companion extension. LensQuery labels transcript coverage honestly: it does not claim a full audio transcription when the site has not exposed one. Chrome/Edge may reserve or remap an extension shortcut; verify it in `chrome://extensions/shortcuts` or invoke the toolbar icon when the operating-system shortcut wins the conflict.

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

The desktop binary implements `--native-messaging-host`: it validates the framed request, rejects browser-supplied local paths, materializes only a bounded JPEG/PNG/WebP crop into LensQuery's temporary capture directory, and writes the context into a user-local queue. The macOS and Windows helper scripts install the browser manifest after the unpacked/store extension ID is known; automatic installer wiring remains tied to a fixed published extension ID.
