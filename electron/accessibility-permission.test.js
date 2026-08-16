import { describe, expect, it } from 'vitest'

import {
  accessibilityPermissionMessage,
  shouldRequestAccessibilityPermission,
} from './accessibility-permission.js'

describe('macOS accessibility permission flow', () => {
  it('requests once and applies a cross-launch cooldown', () => {
    const now = Date.parse('2026-08-16T00:00:00Z')
    expect(shouldRequestAccessibilityPermission({
      platform: 'darwin', trusted: false, requestedThisRun: false, lastRequestedAt: 0, now,
    })).toBe(true)
    expect(shouldRequestAccessibilityPermission({
      platform: 'darwin', trusted: false, requestedThisRun: true, lastRequestedAt: 0, now,
    })).toBe(false)
    expect(shouldRequestAccessibilityPermission({
      platform: 'darwin', trusted: false, requestedThisRun: false, lastRequestedAt: now - 60_000, now,
    })).toBe(false)
    expect(shouldRequestAccessibilityPermission({
      platform: 'darwin', trusted: true, requestedThisRun: false, lastRequestedAt: 0, now,
    })).toBe(false)
  })

  it('does not gate Windows object selection', () => {
    expect(shouldRequestAccessibilityPermission({
      platform: 'win32', trusted: false, requestedThisRun: false, lastRequestedAt: 0,
    })).toBe(false)
  })

  it('explains that an ordinary click is never converted into a region', () => {
    const message = accessibilityPermissionMessage({
      applicationName: 'LensQuery',
      applicationPath: '/Applications/LensQuery.app',
    })
    expect(message).toContain('辅助功能')
    expect(message).toContain('/Applications/LensQuery.app')
    expect(message).toContain('不会把单击误当成区域框选')
  })
})
