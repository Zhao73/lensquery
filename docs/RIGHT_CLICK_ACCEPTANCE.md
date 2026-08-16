# Right-click integration acceptance

Date: 2026-08-15 (Asia/Tokyo)

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

## Browser connector: source/package/bridge PASS; Chrome UI load pending

- Manifest V3 extension version: `0.3.0`.
- Fixed extension ID: `filelbpgenppllkeeofajalcgbnifgmi`.
- The single **使用 LensQuery 识别** command declares `contexts: ["all"]` and routes selection, image, video, audio, link, editable, and generic object contexts independently.
- The packaged extension is present at `/Applications/LensQuery.app/Contents/Resources/browser-extension`.
- Native Messaging manifest is installed for Chrome, Edge, Brave, and Chromium and points to the packaged Rust sidecar wrapper.
- A framed native-host fixture returned `{ "ok": true }`, entered the installed LensQuery timeline, and produced a completed browser-object answer.
- The current automation session did not expose the user's Chrome instance through the required Chrome control connector, so loading the unpacked extension into that live profile and visually confirming its Chrome context-menu item remain separate pending runtime gates.

## Reproduction

1. Finder: select any local file or folder, right-click, and choose **使用 LensQuery 识别**.
2. Chrome/Edge: open the extensions page, enable Developer mode, choose **Load unpacked**, and select `/Applications/LensQuery.app/Contents/Resources/browser-extension`.
3. Confirm the extension ID is `filelbpgenppllkeeofajalcgbnifgmi`, reload it once, then right-click selected text, media, a link, an editable area, a control, or page background.
