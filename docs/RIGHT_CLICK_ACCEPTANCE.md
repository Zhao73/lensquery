# Right-click integration acceptance

Date: 2026-08-17 (Asia/Tokyo)

## Finder: installed runtime PASS

- Installed app: `/Applications/LensQuery.app`
- Finder Sync extension: `Contents/PlugIns/LensQuery Finder.appex`
- Extension identifier: `com.lensquery.desktop.electron-preview.finder`
- Signature: Apple Development; app sandbox entitlement present.
- Finder runtime process was present after installation.
- A harmless Desktop fixture exposed the direct Finder item **使用 LensQuery 识别**.
- Invoking that item created a background LensQuery conversation for the selected text file.
- Codex CLI completed the conversation and correctly described the fixture content.
- Result screenshot: `/private/tmp/lensquery-finder-result.png` on the acceptance machine.
- The temporary Desktop fixture was moved to Trash after the run.

## Browser connector: source/package/bridge/current-URL runtime PASS; user Chrome reload pending

- Manifest V3 extension version: `0.6.0`.
- Fixed extension ID: `filelbpgenppllkeeofajalcgbnifgmi`.
- The single **使用 LensQuery 识别** command declares `contexts: ["all"]` and routes selection, image, video, audio, link, editable, and generic object contexts independently.
- **使用 LensQuery 分析当前网址** is separately registered for webpage-background and extension-action menus. Clicking the toolbar icon sends complete current-page context directly; `lq` is registered as the address-bar keyword for a current or supplied URL.
- Pages that cancel Chrome's native `contextmenu` event receive a compact injected **使用 LensQuery 识别** action next to the site's menu. This covers custom HTML5 players, Bilibili-style menus, canvas content, and web-app controls without replacing the site's own commands.
- The packaged extension is present at `/Applications/LensQuery.app/Contents/Resources/browser-extension`.
- Native Messaging manifest is installed for Chrome, Edge, Brave, and Chromium and points to the packaged Rust sidecar wrapper.
- A framed native-host fixture returned `{ "ok": true }`, entered the installed LensQuery timeline, and produced a completed browser-object answer.
- The installed app now contains extension `0.6.0` with the fixed extension ID, `lq` omnibox keyword, and the direct-page toolbar title.
- Extension service-worker tests exercised both menu registration and current-page submission through the Native Messaging contract.
- A packaged Native Messaging `contextMenuKind: page` runtime fixture entered the installed LensQuery timeline, completed through the configured Codex CLI, and described the supplied page body, structure, URL-entry use cases, and evidence boundary instead of merely repeating the URL.
- The prior installed-package Chromium fixture loaded version `0.5.0`; after a fixture player cancelled `contextmenu`, both its own menu and the injected **使用 LensQuery 识别** action were present. The live user Chrome still needs one extension reload before its already-running service worker exposes `0.6.0` entries.
- The user's existing unpacked Chrome extension still needs one reload after this package update. Confirming the same interaction on the user's live Bilibili page remains a separate runtime gate.

## Reproduction

1. Finder: select any local file or folder, right-click, and choose **使用 LensQuery 识别**.
2. Chrome/Edge: open the extensions page, enable Developer mode, choose **Load unpacked**, and select `/Applications/LensQuery.app/Contents/Resources/browser-extension`.
3. Confirm the extension ID is `filelbpgenppllkeeofajalcgbnifgmi`, reload it once, then right-click selected text, media, a link, an editable area, a control, or page background.
4. On a Bilibili video or a local fixture that calls `event.preventDefault()` for `contextmenu`, confirm LensQuery appears beside the custom menu, keeps the site's menu available, and submits only after the LensQuery action is clicked.
5. Click the LensQuery extension icon and confirm the current page is submitted without opening the picker. Then type `lq`, activate the LensQuery keyword, and submit a complete URL; confirm the loaded target page enters the LensQuery timeline as `contextMenuKind: page`.
