const DEFAULT_SETTLE_MS = 70

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

/**
 * macOS Accessibility hit-testing sees the topmost LensQuery capture window
 * unless it is briefly removed from the window stack. Keep the renderer alive,
 * hide only for the native lookup, then restore the picker for confirmation.
 */
export async function inspectBehindCaptureOverlay({
  captureWindow,
  inspect,
  settleMs = DEFAULT_SETTLE_MS,
}) {
  const shouldRestore = Boolean(
    captureWindow
    && !captureWindow.isDestroyed()
    && captureWindow.isVisible(),
  )

  if (!shouldRestore) return inspect()

  captureWindow.hide()
  await delay(settleMs)
  try {
    return await inspect()
  } finally {
    if (!captureWindow.isDestroyed()) {
      captureWindow.show()
      captureWindow.focus()
    }
  }
}
