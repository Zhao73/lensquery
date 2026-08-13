import { create } from 'zustand'
import type {
  AppSettings,
  BootstrapState,
  CaptureEvidence,
  FileEvidence,
  ProviderProfile,
  QuerySession,
} from '../types/domain'

export type View = 'timeline' | 'providers' | 'settings'

const SESSION_STORAGE_KEY = 'lensquery.sessions.v1'

function readSessions(): QuerySession[] {
  try {
    return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) ?? '[]') as QuerySession[]
  } catch {
    return []
  }
}

function persistSessions(sessions: QuerySession[]) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions))
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
  hydrate: (state) =>
    set({ ready: true, providers: state.providers, settings: state.settings }),
  setProviders: (providers) => set({ providers }),
  setSettings: (settings) => set({ settings }),
  upsertProvider: (profile) =>
    set((state) => ({
      providers: state.providers.some(({ id }) => id === profile.id)
        ? state.providers.map((item) => (item.id === profile.id ? profile : item))
        : [...state.providers, profile],
    })),
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
