import { describe, expect, it } from 'vitest'

import {
  evaluateScreenPermission,
  normalizeScreenPermissionStatus,
  screenPermissionMessage,
  shouldRequestScreenPermission,
} from './screen-permission.js'

describe('macOS screen capture permission flow', () => {
  it('accepts a permission that was already granted when the app launched', () => {
    expect(evaluateScreenPermission({
      platform: 'darwin',
      status: 'granted',
      launchStatus: 'granted',
    })).toEqual({ status: 'granted', granted: true, restartRequired: false })
  })

  it('requires a clean relaunch when permission changed during this process', () => {
    expect(evaluateScreenPermission({
      platform: 'darwin',
      status: 'granted',
      launchStatus: 'not-determined',
    })).toEqual({ status: 'granted', granted: false, restartRequired: true })
  })

  it('never blocks screen capture on platforms without the macOS TCC gate', () => {
    expect(normalizeScreenPermissionStatus('denied', 'win32')).toBe('granted')
    expect(evaluateScreenPermission({
      platform: 'win32',
      status: 'denied',
      launchStatus: 'denied',
    }).granted).toBe(true)
  })

  it('requests the native prompt once and applies a cross-launch cooldown', () => {
    const now = Date.parse('2026-08-16T00:00:00Z')
    expect(shouldRequestScreenPermission({
      platform: 'darwin',
      status: 'not-determined',
      requestedThisRun: false,
      lastRequestedAt: 0,
      now,
    })).toBe(true)
    expect(shouldRequestScreenPermission({
      platform: 'darwin',
      status: 'not-determined',
      requestedThisRun: true,
      lastRequestedAt: 0,
      now,
    })).toBe(false)
    expect(shouldRequestScreenPermission({
      platform: 'darwin',
      status: 'not-determined',
      requestedThisRun: false,
      lastRequestedAt: now - 60_000,
      now,
    })).toBe(false)
    expect(shouldRequestScreenPermission({
      platform: 'darwin',
      status: 'denied',
      requestedThisRun: false,
      lastRequestedAt: 0,
      now,
    })).toBe(false)
  })

  it('names the exact preview bundle instead of the old LensQuery app', () => {
    const message = screenPermissionMessage({
      decision: { status: 'not-determined', granted: false, restartRequired: false },
      applicationName: 'LensQuery Electron Preview',
      applicationPath: '/Applications/LensQuery Electron Preview.app',
    })
    expect(message).toContain('LensQuery Electron Preview')
    expect(message).toContain('/Applications/LensQuery Electron Preview.app')
    expect(message).toContain('不要选旧版')
  })
})
