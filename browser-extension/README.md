# LensQuery Web Connector

Chrome / Edge Manifest V3 companion extension. It adds exact page context that desktop pixels and Windows UI Automation cannot reliably expose:

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
4. Install the LensQuery Native Messaging Host. On Windows development builds:

   ```powershell
   .\native-host\install-windows.ps1 -ExtensionId EXTENSION_ID -LensQueryExe "C:\path\to\lensquery.exe"
   ```
5. Start LensQuery, focus a normal web page, and press `Ctrl+Shift+Space`. The first click locks and highlights the real DOM target; click it again to send immediately. Hold Option/Alt on the confirming click only when you want the advanced text-range, intent, and annotation composer.

The extension requests `activeTab`, so page access starts only after the explicit action/shortcut. `nativeMessaging` is used only to pass the selected bounded context to the resident desktop process. The browser blocks content-script injection on internal pages such as `chrome://`.

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

The desktop binary implements `--native-messaging-host`: it validates the framed request, writes a bounded context into a user-local temporary queue, and the resident process consumes it. The production installer still needs to run the manifest/registry step automatically after the final extension ID is fixed.
