import { describe, expect, it, vi } from 'vitest'

import { inspectBehindCaptureOverlay } from './capture-overlay.js'

function visibleCaptureWindow() {
  return {
    hide: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => true),
  }
}

describe('capture overlay accessibility handoff', () => {
  it('hides the overlay before native target inspection and restores it after', async () => {
    const captureWindow = visibleCaptureWindow()
    const inspect = vi.fn(() => {
      expect(captureWindow.hide).toHaveBeenCalledOnce()
      expect(captureWindow.show).not.toHaveBeenCalled()
      return { label: 'image.png' }
    })

    await expect(inspectBehindCaptureOverlay({ captureWindow, inspect, settleMs: 0 }))
      .resolves.toEqual({ label: 'image.png' })
    expect(inspect).toHaveBeenCalledOnce()
    expect(captureWindow.show).toHaveBeenCalledOnce()
    expect(captureWindow.focus).toHaveBeenCalledOnce()
  })

  it('restores the overlay when native inspection fails', async () => {
    const captureWindow = visibleCaptureWindow()

    await expect(inspectBehindCaptureOverlay({
      captureWindow,
      inspect: () => Promise.reject(new Error('inspection failed')),
      settleMs: 0,
    })).rejects.toThrow('inspection failed')
    expect(captureWindow.show).toHaveBeenCalledOnce()
    expect(captureWindow.focus).toHaveBeenCalledOnce()
  })

  it('does not change window visibility when the picker is already hidden', async () => {
    const captureWindow = visibleCaptureWindow()
    captureWindow.isVisible.mockReturnValue(false)
    const inspect = vi.fn(() => ({ label: 'image.png' }))

    await inspectBehindCaptureOverlay({ captureWindow, inspect, settleMs: 0 })
    expect(captureWindow.hide).not.toHaveBeenCalled()
    expect(captureWindow.show).not.toHaveBeenCalled()
    expect(captureWindow.focus).not.toHaveBeenCalled()
  })
})
