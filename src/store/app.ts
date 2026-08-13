import { create } from 'zustand'
import type {
  AnalysisResult,
  AppSettings,
  BootstrapState,
  CaptureEvidence,
  FileEvidence,
  ProviderProfile,
} from '../types/domain'

export type View = 'home' | 'history' | 'providers' | 'settings'

interface AppStore {
  ready: boolean
  view: View
  providers: ProviderProfile[]
  settings: AppSettings | null
  captures: CaptureEvidence[]
  files: FileEvidence[]
  history: AnalysisResult[]
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
  addResult: (result: AnalysisResult) => void
}

export const useAppStore = create<AppStore>((set) => ({
  ready: false,
  view: 'home',
  providers: [],
  settings: null,
  captures: [],
  files: [],
  history: [],
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
  addResult: (result) => set((state) => ({ history: [result, ...state.history] })),
}))
