import { create } from 'zustand'
import type {
  AppSettings,
  BootstrapState,
  CaptureEvidence,
  FileEvidence,
  ProviderProfile,
  QuerySession,
} from '../types/domain'

export type View = 'timeline' | 'providers' | 'extensions' | 'settings'

const SESSION_STORAGE_KEY = 'lensquery.sessions.v1'
let historyEnabled = true
let retainImagesEnabled = false

function readSessions(): QuerySession[] {
  try {
    const sessions = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '[]') as QuerySession[]
    return sessions.map((session) => ({
      ...session,
      messages: session.messages.map((message) => message.status === 'pending'
        ? { ...message, status: 'cancelled' as const, content: '上次分析已中断。' }
        : message),
    }))
  } catch {
    return []
  }
}

function sessionsForStorage(sessions: QuerySession[]): QuerySession[] {
  return sessions.map((session) => ({
    ...session,
    captures: session.captures.map((capture) => ({
      ...capture,
      previewUrl: retainImagesEnabled ? capture.previewUrl : '',
    })),
    files: session.files.map((file) => ({
      ...file,
      videoPreparation: file.videoPreparation
        ? {
            ...file.videoPreparation,
            // Frame paths remain available to the installed client. Even when
            // image retention is enabled, keeping at most four previews avoids
            // serializing 24 large base64 frames for every long video.
            frames: file.videoPreparation.frames.map((frame, index) => ({
              path: frame.path,
              timestampSeconds: frame.timestampSeconds,
              previewUrl: retainImagesEnabled && index < 4 ? frame.previewUrl : undefined,
            })),
          }
        : undefined,
    })),
    browserContext: session.browserContext
      ? {
          ...session.browserContext,
          snapshotPreviewUrl: retainImagesEnabled
            ? session.browserContext.snapshotPreviewUrl
            : undefined,
        }
      : undefined,
  }))
}

function persistSessions(sessions: QuerySession[]) {
  try {
    if (historyEnabled) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionsForStorage(sessions)))
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  } catch {
    // Persistence is secondary to the live conversation. A storage quota or
    // disk error must never suppress a completed model response in memory.
  }
}

interface AppStore {
  ready: boolean
  view: View
  providers: ProviderProfile[]
  settings: AppSettings | null
  captures: CaptureEvidence[]
  files: FileEvidence[]
  sessions: QuerySession[]
  activeSessionId: string | null
  setView: (view: View) => void
  hydrate: (state: BootstrapState) => void
  setProviders: (providers: ProviderProfile[]) => void
  setSettings: (settings: AppSettings) => void
  upsertProvider: (profile: ProviderProfile) => void
  removeProvider: (id: string) => void
  addFiles: (files: FileEvidence[]) => void
  addCapture: (capture: CaptureEvidence) => void
  removeCapture: (id: string) => void
  removeFile: (id: string) => void
  updateFile: (id: string, update: Partial<FileEvidence>) => void
  clearEvidence: () => void
  setActiveSession: (id: string | null) => void
  upsertSession: (session: QuerySession) => void
  removeSession: (id: string) => void
  clearSessions: () => void
}

export const useAppStore = create<AppStore>((set) => ({
  ready: false,
  view: 'timeline',
  providers: [],
  settings: null,
  captures: [],
  files: [],
  sessions: readSessions(),
  activeSessionId: readSessions()[0]?.id ?? null,
  setView: (view) => set({ view }),
  hydrate: (state) => {
    historyEnabled = state.settings.saveHistory
    retainImagesEnabled = state.settings.retainImages
    const sessions = historyEnabled ? sessionsForStorage(readSessions()) : []
    persistSessions(sessions)
    set({ ready: true, providers: state.providers, settings: state.settings, sessions, activeSessionId: sessions[0]?.id ?? null })
  },
  setProviders: (providers) => set({ providers }),
  setSettings: (settings) => {
    historyEnabled = settings.saveHistory
    retainImagesEnabled = settings.retainImages
    set((state) => {
      const sessions = historyEnabled ? state.sessions : []
      persistSessions(sessions)
      return { settings, sessions, activeSessionId: historyEnabled ? state.activeSessionId : null }
    })
  },
  upsertProvider: (profile) =>
    set((state) => ({
      providers: state.providers.some(({ id }) => id === profile.id)
        ? state.providers.map((item) => (item.id === profile.id ? profile : item))
        : [...state.providers, profile],
    })),
  removeProvider: (id) => set((state) => ({ providers: state.providers.filter((profile) => profile.id !== id) })),
  addFiles: (files) => set((state) => ({ files: [...state.files, ...files] })),
  addCapture: (capture) => set((state) => ({ captures: [...state.captures, capture] })),
  removeCapture: (id) => set((state) => ({ captures: state.captures.filter((capture) => capture.id !== id) })),
  removeFile: (id) => set((state) => ({ files: state.files.filter((file) => file.id !== id) })),
  updateFile: (id, update) =>
    set((state) => ({
      files: state.files.map((file) => (file.id === id ? { ...file, ...update } : file)),
    })),
  clearEvidence: () => set({ files: [], captures: [] }),
  setActiveSession: (activeSessionId) => set({ activeSessionId, view: 'timeline' }),
  upsertSession: (session) => set((state) => {
    const sessions = [session, ...state.sessions.filter(({ id }) => id !== session.id)]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    persistSessions(sessions)
    return { sessions, activeSessionId: session.id, view: 'timeline' }
  }),
  removeSession: (id) => set((state) => {
    const sessions = state.sessions.filter((session) => session.id !== id)
    persistSessions(sessions)
    return {
      sessions,
      activeSessionId: state.activeSessionId === id ? sessions[0]?.id ?? null : state.activeSessionId,
    }
  }),
  clearSessions: () => {
    persistSessions([])
    set({ sessions: [], activeSessionId: null })
  },
}))
