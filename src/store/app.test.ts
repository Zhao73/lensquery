import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../lib/tauri'
import type { QuerySession } from '../types/domain'
import { useAppStore } from './app'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

function videoSession(): QuerySession {
  return {
    id: 'session-1',
    title: 'long-video.mp4',
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
    providerId: 'codex-cli',
    sourceLabel: 'long-video.mp4',
    sourceKind: 'file',
    captures: [],
    files: [{
      id: 'video-1',
      name: 'long-video.mp4',
      path: '/tmp/long-video.mp4',
      mediaType: 'video/mp4',
      size: 100,
      kind: 'video',
      videoPreparation: {
        id: 'preparation-1',
        sourcePath: '/tmp/long-video.mp4',
        outputDirectory: '/tmp/frames',
        frames: [{
          path: '/tmp/frames/frame-001.jpg',
          previewUrl: 'data:image/jpeg;base64,large-preview',
          timestampSeconds: 0,
        }],
        audioPath: '/tmp/audio.m4a',
        sampleIntervalSeconds: 600,
        originalDurationSeconds: 2_400,
        strategy: 'uniform-keyframes-v1',
        transcript: '[00:00] fixture',
      },
    }],
    messages: [{
      id: 'message-1',
      role: 'assistant',
      content: 'complete answer',
      status: 'complete',
      createdAt: '2026-08-15T00:00:00.000Z',
    }],
    analysisMode: 'explain',
    outputFormat: 'report',
  }
}

describe('app store', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
    useAppStore.setState({
      ready: false,
      view: 'timeline',
      providers: [],
      settings: null,
      captures: [],
      files: [],
      sessions: [],
      activeSessionId: null,
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

  it('keeps frame previews live but compacts long-video history', () => {
    useAppStore.getState().hydrate({
      platform: 'darwin',
      version: '0.1.0',
      providers: [],
      settings: { ...defaultSettings, retainImages: false },
    })
    useAppStore.getState().upsertSession(videoSession())

    expect(useAppStore.getState().sessions[0]?.files[0]?.videoPreparation?.frames[0]?.previewUrl)
      .toContain('base64')
    const persisted = JSON.parse(localStorage.getItem('lensquery.sessions.v1') ?? '[]') as QuerySession[]
    expect(persisted[0]?.files[0]?.videoPreparation?.frames[0]?.previewUrl).toBeUndefined()
  })

  it('keeps a completed answer visible when browser storage fails', () => {
    useAppStore.getState().hydrate({
      platform: 'darwin',
      version: '0.1.0',
      providers: [],
      settings: defaultSettings,
    })
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    useAppStore.getState().upsertSession(videoSession())
    setItem.mockRestore()

    expect(useAppStore.getState().sessions[0]?.messages[0]?.content).toBe('complete answer')
  })
})
