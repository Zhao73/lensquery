import { beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../lib/tauri'
import { useAppStore } from './app'

describe('app store', () => {
  beforeEach(() => {
    useAppStore.setState({
      ready: false,
      view: 'home',
      providers: [],
      settings: null,
      captures: [],
      files: [],
      history: [],
    })
  })

  it('hydrates provider and settings state', () => {
    useAppStore.getState().hydrate({
      platform: 'windows',
      version: '0.1.0',
      providers: [],
      settings: defaultSettings,
    })

    expect(useAppStore.getState().ready).toBe(true)
    expect(useAppStore.getState().settings?.shortcut).toContain('Shift')
  })

  it('adds and removes file evidence', () => {
    const evidence = {
      id: 'file-1',
      name: 'brief.pdf',
      path: 'brief.pdf',
      mediaType: 'application/pdf',
      size: 100,
      kind: 'pdf' as const,
    }
    useAppStore.getState().addFiles([evidence])
    expect(useAppStore.getState().files).toHaveLength(1)
    useAppStore.getState().removeFile('file-1')
    expect(useAppStore.getState().files).toHaveLength(0)
  })
})

