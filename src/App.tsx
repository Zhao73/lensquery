import {
  ArrowRight,
  ArrowCounterClockwise,
  CaretDown,
  Check,
  ClockCounterClockwise,
  Copy,
  FileCode,
  HighlighterCircle,
  ListNumbers,
  NotePencil,
  SpeakerHigh,
  SpeakerSlash,
  TextAlignLeft,
  CursorClick,
  File,
  Gear,
  Globe,
  MagnifyingGlass,
  PaperPlaneTilt,
  Question,
  Scan,
  SidebarSimple,
  Sparkle,
  TerminalWindow,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'
import { evidenceAccept, formatBytes, formatDuration, normalizeBrowserFiles } from './lib/files'
import {
  analyze,
  bootstrap,
  cancelCapture,
  completeCapture,
  discoverCliProviders,
  getPermissionStatus,
  hideResultToast,
  inspectCaptureTarget,
  isDesktopRuntime,
  listenForCaptureRequests,
  listenForCaptureErrors,
  listenForCaptureIntent,
  listenForEvidenceDrops,
  listenForQueryEvidence,
  listenForNavigation,
  listenForFilePickRequest,
  listenForResultToast,
  openResultFromToast,
  openPermissionSettings,
  pickEvidenceFiles,
  saveProvider,
  saveSettings,
  setProviderSecret,
  showMainWindow,
  showSystemNotification,
  speakText,
  stopSpeaking,
  startCapture,
  testProvider,
  prepareVideo,
} from './lib/tauri'
import { useAppStore, type View } from './store/app'
import type {
  AnalysisMode,
  AnalysisRequest,
  AppSettings,
  BrowserContext,
  Bounds,
  CaptureEvidence,
  CaptureTarget,
  ConversationMessage,
  FileEvidence,
  OutputFormat,
  ProviderProfile,
  QuerySession,
  TextScope,
} from './types/domain'

const DEFAULT_QUESTION = '请分析所选内容，并结合周围上下文说明它是什么、有什么作用以及下一步该怎么做。'

const analysisModes: Array<{ id: AnalysisMode; label: string; hint: string }> = [
  { id: 'identify', label: '快速介绍', hint: '是什么、有什么用' },
  { id: 'explain', label: '理解内容', hint: '摘要、重点和上下文' },
  { id: 'how-to', label: '学习使用', hint: '给出可执行步骤' },
  { id: 'deep-dive', label: '深入分析', hint: '原理、流程和限制' },
  { id: 'customer-reply', label: '客户回复', hint: '整理成可直接发送的回复' },
  { id: 'code', label: '代码分析', hint: '结构、流程和问题' },
]

const outputFormats: Array<{ id: OutputFormat; label: string }> = [
  { id: 'adaptive', label: '智能排版' },
  { id: 'summary', label: '结论摘要' },
  { id: 'steps', label: '分步说明' },
  { id: 'report', label: '完整报告' },
  { id: 'customer-reply', label: '客户可用' },
  { id: 'markdown', label: 'Markdown' },
]

function now() {
  return new Date().toISOString()
}

function newMessage(role: ConversationMessage['role'], content: string, status: ConversationMessage['status']): ConversationMessage {
  return { id: crypto.randomUUID(), role, content, status, createdAt: now() }
}

function sourceFromEvidence(captures: CaptureEvidence[], files: FileEvidence[], browserContext?: BrowserContext) {
  if (browserContext) {
    return {
      label: browserContext.text?.slice(0, 54) || browserContext.accessibleName || browserContext.title || '网页元素',
      kind: 'browser' as const,
    }
  }
  if (files[0]) {
    return {
      label: files.length > 1 ? `${files[0].name} 等 ${files.length} 个文件` : files[0].name,
      kind: 'file' as const,
    }
  }
  if (captures[0]) {
    return {
      label: captures[0].accessibleText || captures[0].windowTitle || (captures[0].kind === 'element' ? '桌面元素' : '屏幕区域'),
      kind: captures[0].kind === 'element' ? 'element' as const : 'screen' as const,
    }
  }
  return { label: '文字询问', kind: 'text' as const }
}

function shortcutParts(shortcut: string) {
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  return shortcut.split('+').map((part) => {
    if (part === 'CommandOrControl') return isMac ? '⌘' : 'Ctrl'
    if (part === 'Command') return '⌘'
    if (part === 'Control') return isMac ? '⌃' : 'Ctrl'
    if (part === 'Shift') return isMac ? '⇧' : 'Shift'
    if (part === 'Alt') return isMac ? '⌥' : 'Alt'
    return part
  })
}

function App() {
  const windowName = new URLSearchParams(window.location.search).get('window') ?? 'main'
  document.documentElement.dataset.lensqueryWindow = windowName
  document.body.dataset.lensqueryWindow = windowName
  if (windowName === 'capture') {
    return <CaptureOverlay />
  }
  if (windowName === 'result-toast') {
    return <ResultToast />
  }
  return <ConversationApp />
}

function ResultToast() {
  const [result, setResult] = useState<{ title: string; body: string } | null>(null)

  useEffect(() => {
    let dispose: (() => void) | undefined
    void listenForResultToast(setResult).then((unlisten) => { dispose = unlisten })
    return () => dispose?.()
  }, [])

  useEffect(() => {
    if (!result) return
    const timer = window.setTimeout(() => {
      setResult(null)
      void hideResultToast()
    }, 14_000)
    return () => window.clearTimeout(timer)
  }, [result])

  function openResult() {
    setResult(null)
    void openResultFromToast()
  }

  function closeResult(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation()
    setResult(null)
    void hideResultToast()
  }

  if (!result) return null
  return (
    <main className="result-toast-root" aria-live="polite">
      <article className="result-toast-card">
        <div className="result-toast-icon" aria-hidden="true"><Question size={17} weight="bold" /></div>
        <div className="result-toast-copy">
          <header>
            <strong>{result.title}</strong>
            <button type="button" aria-label="关闭结果提示" onClick={closeResult}><X size={14} /></button>
          </header>
          <p>{result.body}</p>
          <button className="result-toast-open" type="button" onClick={openResult}>查看完整会话 <ArrowRight size={13} /></button>
        </div>
      </article>
    </main>
  )
}

function ConversationApp() {
  const {
    ready,
    view,
    providers,
    settings,
    sessions,
    activeSessionId,
    setView,
    hydrate,
    setProviders,
    setSettings,
    upsertProvider,
    setActiveSession,
    upsertSession,
    removeSession,
    clearSessions,
  } = useAppStore()
  const [isNarrow, setIsNarrow] = useState(() => window.matchMedia('(max-width: 760px)').matches)
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches)
  const [followUp, setFollowUp] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [captureStatus, setCaptureStatus] = useState('')
  const [filter, setFilter] = useState('')
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('explain')
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('adaptive')
  const [annotation, setAnnotation] = useState('')
  const [pendingSubmission, setPendingSubmission] = useState<{ captures: CaptureEvidence[]; files: FileEvidence[]; browserContext?: BrowserContext; question?: string; analysisMode?: AnalysisMode; outputFormat?: OutputFormat; annotation?: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bootstrap().then(hydrate).catch((cause: unknown) => setError(String(cause)))
  }, [hydrate])

  useEffect(() => {
    if (!settings) return
    document.documentElement.lang = settings.language
    setAnalysisMode(settings.defaultAnalysisMode)
    setOutputFormat(settings.defaultOutputFormat)
  }, [settings])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)')
    const update = () => {
      setIsNarrow(media.matches)
      if (media.matches) setSidebarOpen(false)
    }
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (!isNarrow || !sidebarOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSidebarOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [isNarrow, sidebarOpen])

  const selectedProvider = useMemo(
    () => providers.find(({ id, ready: isReady }) => id === settings?.defaultProviderId && isReady)
      ?? providers.find(({ ready: isReady }) => isReady)
      ?? providers.find(({ id }) => id === settings?.defaultProviderId)
      ?? providers[0],
    [providers, settings?.defaultProviderId],
  )

  async function submitNewQuery(input: {
    captures: CaptureEvidence[]
    files: FileEvidence[]
    browserContext?: BrowserContext
    question?: string
    analysisMode?: AnalysisMode
    outputFormat?: OutputFormat
    annotation?: string
    confirmed?: boolean
  }) {
    if (settings?.showPreview && !input.confirmed && (input.captures.length > 0 || input.files.length > 0 || input.browserContext)) {
      setPendingSubmission(input)
      void showMainWindow()
      return
    }
    const provider = selectedProvider
    if (!provider?.ready) {
      setError('还没有可用的模型通道。请先在“模型”中扫描本机 CLI 或配置 API。')
      setView('providers')
      void showSystemNotification('LensQuery 未开始分析', '未找到可用的模型通道，请在 LensQuery 的“模型”页面检查配置。').catch(() => undefined)
      return
    }
    const question = input.question?.trim() || DEFAULT_QUESTION
    let preparedFiles = input.files
    if (isDesktopRuntime() && input.files.some(({ kind, videoPreparation }) => kind === 'video' && !videoPreparation)) {
      setCaptureStatus('正在本地提取视频关键帧和音频线索…')
      try {
        preparedFiles = await Promise.all(input.files.map(async (file) => {
          if (file.kind !== 'video' || file.videoPreparation) return file
          try {
            return { ...file, videoPreparation: await prepareVideo(file.path, 12), processingError: undefined }
          } catch (cause) {
            return { ...file, processingError: String(cause) }
          }
        }))
      } finally {
        setCaptureStatus('')
      }
      const failedVideo = preparedFiles.find(({ kind, videoPreparation }) => kind === 'video' && !videoPreparation)
      if (failedVideo) {
        setError(failedVideo.processingError || `视频 ${failedVideo.name} 的本地关键帧提取失败。`)
        void showSystemNotification('LensQuery 视频准备失败', failedVideo.processingError || `无法读取 ${failedVideo.name}。`).catch(() => undefined)
        return
      }
    }
    const requestedMode = input.analysisMode ?? input.browserContext?.analysisMode ?? input.captures[0]?.analysisMode ?? analysisMode
    const requestedFormat = input.outputFormat ?? input.browserContext?.outputFormat ?? input.captures[0]?.outputFormat ?? outputFormat
    const requestAnnotation = (input.annotation ?? input.browserContext?.annotation ?? input.captures[0]?.annotation ?? annotation.trim()) || undefined
    const source = sourceFromEvidence(input.captures, preparedFiles, input.browserContext)
    const createdAt = now()
    const pending = newMessage('assistant', '', 'pending')
    const session: QuerySession = {
      id: crypto.randomUUID(),
      title: source.label.slice(0, 58),
      createdAt,
      updatedAt: createdAt,
      providerId: provider.id,
      sourceLabel: source.label,
      sourceKind: source.kind,
      captures: input.captures,
      files: preparedFiles,
      browserContext: input.browserContext,
      messages: [newMessage('user', question, 'complete'), pending],
      analysisMode: requestedMode,
      outputFormat: requestedFormat,
      annotation: requestAnnotation,
    }
    upsertSession(session)
    setError('')
    try {
      const result = await analyze({
        question,
        promptId: preparedFiles.some(({ kind }) => kind === 'video') || input.browserContext?.media?.kind === 'video' ? 'video' : requestedMode,
        providerId: provider.id,
        captures: input.captures,
        files: preparedFiles,
        browserContext: input.browserContext,
        conversation: [],
        analysisMode: requestedMode,
        outputFormat: requestedFormat,
        annotation: requestAnnotation,
      })
      upsertSession({
        ...session,
        updatedAt: now(),
        messages: session.messages.map((message) => message.id === pending.id
          ? { ...message, content: result.answer, status: 'complete' as const }
          : message),
      })
      if (settings?.notificationsEnabled && settings.resultPresentation !== 'window') {
        const body = settings.notificationPreview ? result.answer.slice(0, 240) : '分析已完成，点击 LensQuery 查看。'
        void showSystemNotification(session.title, body).catch(() => undefined)
      }
      if (settings?.autoPlayVoice && settings.voiceMode === 'system') {
        void speakText(result.answer).catch(() => undefined)
      }
    } catch (cause) {
      const errorMessage = String(cause)
      upsertSession({
        ...session,
        updatedAt: now(),
        messages: session.messages.map((message) => message.id === pending.id
          ? { ...message, content: errorMessage, status: 'error' as const }
          : message),
      })
      setError(errorMessage)
      if (settings?.notificationsEnabled && settings.resultPresentation !== 'window') {
        void showSystemNotification('LensQuery 分析失败', errorMessage.slice(0, 240)).catch(() => undefined)
      }
    }
  }

  useEffect(() => {
    let disposeCapture: (() => void) | undefined
    let disposeCaptureError: (() => void) | undefined
    let disposeEvidence: (() => void) | undefined
    let disposeDrop: (() => void) | undefined
    let disposeNavigation: (() => void) | undefined
    let disposeFilePick: (() => void) | undefined
    void listenForCaptureRequests(() => setCaptureStatus('第一次点击高亮对象，再点一次确认；拖动可直接选择区域。')).then((dispose) => { disposeCapture = dispose })
    void listenForCaptureErrors((message) => {
      setCaptureStatus('')
      setError(message)
    }).then((dispose) => { disposeCaptureError = dispose })
    void listenForQueryEvidence((payload) => {
      setCaptureStatus('')
      void submitNewQuery({ captures: payload.capture ? [payload.capture] : [], files: payload.files ?? [], browserContext: payload.browserContext, analysisMode: payload.analysisMode, outputFormat: payload.outputFormat, annotation: payload.annotation, confirmed: true })
    }).then((dispose) => { disposeEvidence = dispose })
    void listenForEvidenceDrops((files) => {
      if (files.length) void submitNewQuery({ captures: [], files })
    }).then((dispose) => { disposeDrop = dispose })
    void listenForNavigation((nextView) => setView(nextView)).then((dispose) => { disposeNavigation = dispose })
    void listenForFilePickRequest(() => { void openFiles() }).then((dispose) => { disposeFilePick = dispose })
    return () => {
      disposeCapture?.()
      disposeCaptureError?.()
      disposeEvidence?.()
      disposeDrop?.()
      disposeNavigation?.()
      disposeFilePick?.()
    }
  // selectedProvider intentionally refreshes the handler when the route changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider?.id])

  const activeSession = sessions.find(({ id }) => id === activeSessionId) ?? null
  const visibleSessions = sessions.filter((session) =>
    `${session.title} ${session.sourceLabel} ${session.messages.map(({ content }) => content).join(' ')}`.toLowerCase().includes(filter.toLowerCase()),
  )

  async function submitFollowUp(questionOverride?: string) {
    const requestedQuestion = questionOverride?.trim() || followUp.trim()
    if (!activeSession || !requestedQuestion) return
    const provider = providers.find(({ id }) => id === activeSession.providerId) ?? selectedProvider
    if (!provider?.ready) {
      setError('这个会话使用的模型当前不可用。请先检查模型设置。')
      return
    }
    const question = requestedQuestion
    setFollowUp('')
    const userMessage = newMessage('user', question, 'complete')
    const pending = newMessage('assistant', '', 'pending')
    const next = {
      ...activeSession,
      updatedAt: now(),
      messages: [...activeSession.messages, userMessage, pending],
    }
    upsertSession(next)
    try {
      const request: AnalysisRequest = {
        question,
        promptId: 'follow-up',
        providerId: provider.id,
        captures: activeSession.captures,
        files: activeSession.files,
        browserContext: activeSession.browserContext,
        conversation: activeSession.messages.filter(({ status }) => status === 'complete'),
        analysisMode: activeSession.analysisMode,
        outputFormat: activeSession.outputFormat,
        annotation: activeSession.annotation,
      }
      const result = await analyze(request)
      upsertSession({
        ...next,
        updatedAt: now(),
        messages: next.messages.map((message) => message.id === pending.id
          ? { ...message, content: result.answer, status: 'complete' as const }
          : message),
      })
    } catch (cause) {
      upsertSession({
        ...next,
        updatedAt: now(),
        messages: next.messages.map((message) => message.id === pending.id
          ? { ...message, content: String(cause), status: 'error' as const }
          : message),
      })
    }
  }

  async function openFiles() {
    if (!isDesktopRuntime()) {
      fileInputRef.current?.click()
      return
    }
    try {
      const files = await pickEvidenceFiles()
      if (files?.length) await submitNewQuery({ captures: [], files })
    } catch (cause) {
      setError(String(cause))
    }
  }

  async function beginCapture() {
    setError('')
    try {
      const response = await startCapture('element')
      setCaptureStatus(response.message)
    } catch (cause) {
      setError(String(cause))
    }
  }

  if (!ready || !settings) return <LoadingScreen />

  const navigation: Array<{ id: View; label: string; icon: typeof ClockCounterClockwise }> = [
    { id: 'timeline', label: '会话', icon: ClockCounterClockwise },
    { id: 'providers', label: '模型', icon: TerminalWindow },
    { id: 'settings', label: '设置', icon: Gear },
  ]
  const shellClass = [
    'shell',
    !sidebarOpen && 'sidebar-collapsed',
    view !== 'timeline' && 'single-surface',
  ].filter(Boolean).join(' ')

  return (
    <div className={shellClass}>
      {/*
        THESIS: LensQuery is a resident shortcut instrument, not a homepage; conversation is the only durable surface.
        OWN-WORLD: Windows workbench neutrals, one cobalt action color, thin dividers, native controls, no decorative scenery.
        STORY: invoke, point or drag, receive an answer, continue in the same local timeline.
        FIRST VIEWPORT: compact session rail, quiet conversation canvas, persistent follow-up dock, settings one step away.
        FORM: desktop agent workbench, seed 0ec9ea5f.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
      */}
      {view === 'timeline' && (
        <aside className="conversation-sidebar" aria-label="查询时间线">
          <div className="sidebar-head">
            <button type="button" className="capture-button" onClick={beginCapture}>
              <Question size={18} weight="bold" />
              快速询问
              <kbd>{shortcutParts(settings.shortcut).join(' ')}</kbd>
            </button>
            <div className="search-box">
              <MagnifyingGlass size={16} />
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索会话" aria-label="搜索会话" />
            </div>
          </div>
          <div className="session-list">
            {visibleSessions.length ? visibleSessions.map((session) => (
              <button
                type="button"
                className={session.id === activeSessionId ? 'session-row selected' : 'session-row'}
                key={session.id}
                onClick={() => {
                  setActiveSession(session.id)
                  if (isNarrow) setSidebarOpen(false)
                }}
              >
                <SourceIcon kind={session.sourceKind} />
                <span><strong>{session.title}</strong><small>{relativeTime(session.updatedAt)} · {session.sourceLabel}</small></span>
              </button>
            )) : (
              <div className="sidebar-empty">按快捷键开始第一条查询。</div>
            )}
          </div>
          {sessions.length > 0 && (
            <button type="button" className="clear-history" onClick={clearSessions}><Trash size={15} />清空本地记录</button>
          )}
        </aside>
      )}

      {view === 'timeline' && isNarrow && sidebarOpen && (
        <button type="button" className="sidebar-backdrop" aria-label="关闭会话侧栏" onClick={() => setSidebarOpen(false)} />
      )}

      <main className="main-surface" inert={isNarrow && sidebarOpen ? true : undefined}>
        <header className="app-bar">
          <div className="app-bar-left">
            {view === 'timeline' && (
              <button type="button" className="icon-button" onClick={() => setSidebarOpen((value) => !value)} aria-label="切换侧栏"><SidebarSimple size={20} /></button>
            )}
            <button type="button" className="wordmark" onClick={() => setView('timeline')}><img src="/brand/lensquery-mark.svg" alt="" />LensQuery</button>
            <span className="resident-state"><i />后台待命</span>
          </div>
          <nav aria-label="主导航">
            {navigation.map((item) => {
              const Icon = item.icon
              return (
                <button type="button" key={item.id} className={view === item.id ? 'top-nav active' : 'top-nav'} onClick={() => {
                  setView(item.id)
                  if (isNarrow) setSidebarOpen(false)
                }}>
                  <Icon size={17} />{item.label}
                </button>
              )
            })}
          </nav>
        </header>

        {captureStatus && (
          <div className="capture-status" role="status"><Question size={17} weight="bold" />{captureStatus}<button type="button" onClick={() => { void cancelCapture(); setCaptureStatus('') }}><X size={16} /></button></div>
        )}
        {error && <div className="global-error" role="alert"><WarningCircle size={18} />{error}<button type="button" onClick={() => setError('')}><X size={16} /></button></div>}

        {view === 'timeline' && (
          activeSession ? (
            <ConversationView
              session={activeSession}
              provider={providers.find(({ id }) => id === activeSession.providerId)}
              followUp={followUp}
              onFollowUp={setFollowUp}
              onSubmit={submitFollowUp}
              onQuickAsk={(question) => { void submitFollowUp(question) }}
              onDelete={() => removeSession(activeSession.id)}
              onRetry={() => {
                const lastQuestion = [...activeSession.messages].reverse().find(({ role }) => role === 'user')?.content
                if (lastQuestion) setFollowUp(lastQuestion)
              }}
            />
          ) : (
            <EmptyTimeline shortcut={settings.shortcut} onCapture={beginCapture} onOpenFiles={openFiles} query={query} onQuery={setQuery} analysisMode={analysisMode} onAnalysisMode={setAnalysisMode} outputFormat={outputFormat} onOutputFormat={setOutputFormat} annotation={annotation} onAnnotation={setAnnotation} onSubmit={() => {
              if (query.trim()) {
                void submitNewQuery({ captures: [], files: [], question: query })
                setQuery('')
              }
            }} />
          )
        )}
        {view === 'providers' && (
          <ProvidersPanel
            providers={providers}
            selectedId={settings.defaultProviderId}
            onSelect={(defaultProviderId) => {
              const next = { ...settings, defaultProviderId }
              setSettings(next)
              void saveSettings(next)
            }}
            onSave={(profile) => { upsertProvider(profile); return saveProvider(profile) }}
            onRescan={async () => { const profiles = await discoverCliProviders(); setProviders(profiles); return profiles }}
          />
        )}
        {view === 'settings' && <SettingsPanel settings={settings} onSave={async (next) => { const saved = await saveSettings(next); setSettings(saved) }} />}
      </main>
      {pendingSubmission && (
        <div className="preview-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingSubmission(null) }}>
          <section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-title">
            <header><div><h2 id="preview-title">确认本次上下文</h2><p>只有下列选中内容会交给 {selectedProvider?.name ?? '所选模型'}。</p></div><button type="button" className="icon-button" onClick={() => setPendingSubmission(null)} aria-label="关闭预览"><X size={18} /></button></header>
            <div className="preview-evidence">
              {pendingSubmission.captures.map((capture) => <div key={capture.id}><Scan size={18} /><span><strong>{capture.kind === 'element' ? '桌面对象' : '屏幕区域'}</strong><small>{Math.round(capture.bounds.width)} × {Math.round(capture.bounds.height)} · {capture.textScope ?? '对象'}</small></span></div>)}
              {pendingSubmission.files.map((file) => <div key={file.id}><File size={18} /><span><strong>{file.name}</strong><small>{file.kind} · {formatBytes(file.size)}</small></span></div>)}
              {pendingSubmission.browserContext && <div><Globe size={18} /><span><strong>{pendingSubmission.browserContext.title || '网页内容'}</strong><small>{pendingSubmission.browserContext.selectionMode ?? '当前对象'}</small></span></div>}
              {(pendingSubmission.annotation || pendingSubmission.browserContext?.annotation || pendingSubmission.captures[0]?.annotation) && <div><NotePencil size={18} /><span><strong>你的注释</strong><small>{pendingSubmission.annotation || pendingSubmission.browserContext?.annotation || pendingSubmission.captures[0]?.annotation}</small></span></div>}
            </div>
            <footer><button type="button" className="secondary-button" onClick={() => setPendingSubmission(null)}>取消</button><button type="button" className="primary-button" onClick={() => { const request = pendingSubmission; setPendingSubmission(null); void submitNewQuery({ ...request, confirmed: true }) }}>开始分析</button></footer>
          </section>
        </div>
      )}
      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept={evidenceAccept}
        onChange={(event) => {
          if (event.target.files?.length) void submitNewQuery({ captures: [], files: normalizeBrowserFiles(event.target.files) })
          event.currentTarget.value = ''
        }}
      />
    </div>
  )
}

function ConversationView(props: {
  session: QuerySession
  provider?: ProviderProfile
  followUp: string
  onFollowUp: (value: string) => void
  onSubmit: () => void
  onQuickAsk: (question: string) => void
  onDelete: () => void
  onRetry: () => void
}) {
  const tailRef = useRef<HTMLDivElement>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const hasVideo = props.session.files.some(({ kind }) => kind === 'video') || props.session.browserContext?.media?.kind === 'video'
  useEffect(() => {
    if (props.session.messages.length > 2) {
      tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
    }
  }, [props.session.messages.length])
  return (
    <section className="conversation-view">
      <header className="conversation-titlebar">
        <div>
          <h1>{props.session.title}</h1>
          <p><SourceIcon kind={props.session.sourceKind} />{props.session.sourceLabel}<span>·</span>{analysisModes.find(({ id }) => id === props.session.analysisMode)?.label ?? '解释'}<span>·</span>{outputFormats.find(({ id }) => id === props.session.outputFormat)?.label ?? '智能排版'}<span>·</span>{props.provider?.name ?? '模型'}<span>·</span>{formatFullTime(props.session.createdAt)}</p>
        </div>
        <button type="button" className="icon-button" onClick={props.onDelete} aria-label="删除会话"><Trash size={18} /></button>
      </header>
      <div className="message-stream">
        <EvidenceStrip session={props.session} />
        {hasVideo && <div className="media-quick-actions" aria-label="视频快速分析"><span>继续分析视频</span><button type="button" onClick={() => props.onQuickAsk('用一段话快速介绍这个视频的大概意思。')}>快速介绍</button><button type="button" onClick={() => props.onQuickAsk('列出这个视频中最有趣或最有用的片段，有时间信息时请标注时间。')}>有趣片段</button><button type="button" onClick={() => props.onQuickAsk('把页面已提供的字幕或转写整理成连贯文本；没有完整转写时明确说明覆盖范围。')}>整理字幕</button><button type="button" onClick={() => props.onQuickAsk('把这个视频整理成便于学习和理解的重点、概念和行动清单。')}>学习要点</button></div>}
        {props.session.messages.map((message) => (
          <article key={message.id} className={`message ${message.role} ${message.status}`}>
            <div className="message-author">{message.role === 'user' ? '你' : props.provider?.name ?? 'LensQuery'}</div>
            {message.status === 'pending' ? (
              <div className="thinking"><i /><i /><i /><span>正在分析选择内容</span></div>
            ) : (
              message.role === 'assistant' ? (
                <div className="message-content markdown-answer">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
              ) : (
                <div className="message-content">{message.content}</div>
              )
            )}
            {message.role === 'assistant' && message.status === 'complete' && (
              <div className="message-actions">
                <button type="button" onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={15} />复制</button>
                <button type="button" onClick={async () => {
                  if (speakingId === message.id) {
                    await stopSpeaking()
                    setSpeakingId(null)
                  } else {
                    await speakText(message.content)
                    setSpeakingId(message.id)
                  }
                }}>{speakingId === message.id ? <><SpeakerSlash size={15} />停止</> : <><SpeakerHigh size={15} />朗读</>}</button>
                <button type="button" onClick={props.onRetry}><ArrowCounterClockwise size={15} />重试</button>
              </div>
            )}
          </article>
        ))}
        <div ref={tailRef} />
      </div>
      <div className="follow-up-dock">
        <div className="follow-up-box">
          <textarea
            value={props.followUp}
            onChange={(event) => props.onFollowUp(event.target.value)}
            placeholder="在这个会话里继续追问…"
            aria-label="继续追问"
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                props.onSubmit()
              }
            }}
          />
          <div>
            <span>{props.provider?.name ?? '模型不可用'} · {props.provider?.model ?? 'default'}</span>
            <button type="button" disabled={!props.followUp.trim()} onClick={props.onSubmit} aria-label="发送追问"><PaperPlaneTilt size={18} weight="fill" /></button>
          </div>
        </div>
      </div>
    </section>
  )
}

function EvidenceStrip({ session }: { session: QuerySession }) {
  const capture = session.captures[0]
  const file = session.files[0]
  const browser = session.browserContext
  const videoFrames = file?.videoPreparation?.frames.filter(({ previewUrl }) => previewUrl).slice(0, 4) ?? []
  const previewUrl = capture?.previewUrl
    ?? (file?.kind === 'image' ? encodeURI(`file://${file.path}`) : undefined)
    ?? videoFrames[0]?.previewUrl
  if (!capture && !file && !browser) return null
  return (
    <details className="evidence-strip">
      <summary>
        {previewUrl ? <img className="evidence-thumbnail" src={previewUrl} alt="本次选择预览" /> : <span className="evidence-source-icon"><SourceIcon kind={session.sourceKind} /></span>}
        <span className="evidence-summary-copy"><strong>{session.sourceLabel}</strong><small>{file ? `${file.kind.toUpperCase()} · ${formatBytes(file.size)}` : browser?.media ? '网页视频 · 已读取页面上下文' : capture ? `${Math.round(capture.bounds.width)} × ${Math.round(capture.bounds.height)}` : '网页上下文'}</small></span>
        <small className="evidence-expand">查看详情</small><CaretDown size={15} />
      </summary>
      <div className="evidence-detail">
        {previewUrl && <img className="evidence-large-preview" src={previewUrl} alt="屏幕选择预览" />}
        {capture && <dl><div><dt>范围</dt><dd>{Math.round(capture.bounds.width)} × {Math.round(capture.bounds.height)}</dd></div>{capture.accessibleText && <div><dt>辅助信息</dt><dd>{capture.accessibleText}</dd></div>}</dl>}
        {file && <dl><div><dt>文件</dt><dd>{file.name}</dd></div><div><dt>类型</dt><dd>{file.mediaType || file.kind}</dd></div><div><dt>大小</dt><dd>{formatBytes(file.size)}</dd></div>{file.pageCount && <div><dt>页数</dt><dd>{file.pageCount}</dd></div>}{file.extractionStatus && <div><dt>本地解析</dt><dd>{file.extractionStatus === 'ready' ? '文字已提取' : file.extractionStatus}</dd></div>}</dl>}
        {browser && <dl><div><dt>网页</dt><dd>{browser.title}</dd></div><div><dt>文字范围</dt><dd>{browser.selectionMode ?? '当前对象'}</dd></div>{browser.selectedText && <div><dt>所选文字</dt><dd>{browser.selectedText}</dd></div>}{browser.captions && <div><dt>当前字幕</dt><dd>{browser.captions}</dd></div>}{browser.transcript && <div><dt>视频转写</dt><dd>{browser.transcript.slice(0, 1200)}{browser.transcript.length > 1200 ? '…' : ''}</dd></div>}<div><dt>元素</dt><dd>{browser.tagName.toLowerCase()}{browser.role ? ` · ${browser.role}` : ''}</dd></div><div><dt>地址</dt><dd>{browser.url}</dd></div>{browser.selector && <div><dt>选择器</dt><dd><code>{browser.selector}</code></dd></div>}</dl>}
        {videoFrames.length > 1 && <div className="evidence-frame-grid">{videoFrames.map((frame) => <figure key={frame.path}><img src={frame.previewUrl} alt={`视频 ${formatDuration(frame.timestampSeconds)} 画面`} /><figcaption>{formatDuration(frame.timestampSeconds)}</figcaption></figure>)}</div>}
        {session.annotation && <div className="evidence-annotation"><NotePencil size={16} /><span><strong>你的注释</strong>{session.annotation}</span></div>}
      </div>
    </details>
  )
}

function EmptyTimeline(props: {
  shortcut: string
  onCapture: () => void
  onOpenFiles: () => void
  query: string
  onQuery: (value: string) => void
  analysisMode: AnalysisMode
  onAnalysisMode: (value: AnalysisMode) => void
  outputFormat: OutputFormat
  onOutputFormat: (value: OutputFormat) => void
  annotation: string
  onAnnotation: (value: string) => void
  onSubmit: () => void
}) {
  return (
    <section className="empty-timeline workbench-empty">
      <div className="empty-instruction workbench-intro">
        <div className="question-cursor"><HighlighterCircle size={23} weight="duotone" /></div>
        <div>
          <h1>在任何地方划出问题</h1>
          <p>按一次快捷键，点对象或圈出区域；文字可以按所选内容、单词、段落或全文读取，并附上一句批注。</p>
        </div>
      </div>
      <button type="button" className="primary-button empty-primary" onClick={props.onCapture}>
        <CursorClick size={18} />开启系统批注
        <span className="shortcut-line">{shortcutParts(props.shortcut).map((part, index) => <span className="shortcut-part" key={`${part}-${index}`}>{index > 0 && <span>+</span>}<kbd>{part}</kbd></span>)}</span>
      </button>
      <div className="analysis-console">
        <div className="analysis-modes" role="group" aria-label="分析方式">
          {analysisModes.map((mode) => {
            const Icon = mode.id === 'code' ? FileCode : mode.id === 'how-to' ? ListNumbers : mode.id === 'deep-dive' ? Sparkle : mode.id === 'customer-reply' ? NotePencil : TextAlignLeft
            return <button type="button" key={mode.id} className={props.analysisMode === mode.id ? 'analysis-mode selected' : 'analysis-mode'} onClick={() => props.onAnalysisMode(mode.id)}><Icon size={17} /><span><strong>{mode.label}</strong><small>{mode.hint}</small></span></button>
          })}
        </div>
        <div className="annotation-composer">
          <textarea value={props.annotation} onChange={(event) => props.onAnnotation(event.target.value)} maxLength={1000} placeholder="简单注释（可选），例如：重点解释红色报错，并给出验证步骤" />
          <div className="composer-footer">
            <button type="button" className="file-entry" onClick={props.onOpenFiles}><File size={16} />图片、PDF、视频或代码</button>
            <label>回复格式<select value={props.outputFormat} onChange={(event) => props.onOutputFormat(event.target.value as OutputFormat)}>{outputFormats.map((format) => <option value={format.id} key={format.id}>{format.label}</option>)}</select></label>
          </div>
        </div>
        <form className="text-question" onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>
          <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="或者直接输入问题" aria-label="直接输入问题" />
          <button type="submit" disabled={!props.query.trim()} aria-label="发送文字问题"><PaperPlaneTilt size={17} weight="fill" /></button>
        </form>
      </div>
    </section>
  )
}

function ProvidersPanel(props: {
  providers: ProviderProfile[]
  selectedId: string
  onSelect: (id: string) => void
  onSave: (profile: ProviderProfile) => Promise<ProviderProfile>
  onRescan: () => Promise<ProviderProfile[]>
}) {
  const [scanning, setScanning] = useState(false)
  const [testingId, setTestingId] = useState('')
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<ProviderProfile | null>(null)
  return (
    <section className="settings-surface">
      <header className="section-heading"><div><h1>模型与本机智能体</h1><p>自动发现本机安装的 Codex、Claude Code、OpenCode 和 Grok，也可配置直接 API。</p></div><button type="button" className="secondary-button" disabled={scanning} onClick={async () => { setScanning(true); await props.onRescan(); setScanning(false); setMessage('扫描完成') }}><ArrowCounterClockwise className={scanning ? 'spin' : ''} size={17} />{scanning ? '正在扫描' : '重新扫描'}</button></header>
      {message && <div className="inline-note"><Check size={16} />{message}</div>}
      <div className="provider-list">
        {props.providers.map((provider) => (
          <div className={provider.id === props.selectedId ? 'provider-row selected' : 'provider-row'} key={provider.id}>
            <button type="button" className="provider-main" onClick={() => props.onSelect(provider.id)}>
              <span className={provider.ready ? 'provider-icon ready' : 'provider-icon'}>{provider.kind.endsWith('cli') ? <TerminalWindow size={20} /> : <Sparkle size={20} />}</span>
              <span><strong>{provider.name}</strong><small>{provider.cli?.executablePath || provider.baseUrl || provider.kind}</small></span>
              <span className="provider-model-name">{provider.model}</span>
              <span className={provider.ready ? 'availability ready' : 'availability'}>{provider.ready ? '可用' : provider.kind.endsWith('cli') ? '未发现' : '未配置'}</span>
            </button>
            <div className="provider-actions">
              {provider.id === props.selectedId && <span className="default-mark"><Check size={13} />默认</span>}
              <button type="button" onClick={async () => { setTestingId(provider.id); try { setMessage(await testProvider(provider)) } catch (cause) { setMessage(String(cause)) } finally { setTestingId('') } }}>{testingId === provider.id ? '测试中' : '测试'}</button>
              <button type="button" onClick={() => setEditing(provider)}>配置</button>
            </div>
          </div>
        ))}
      </div>
      <div className="runtime-note"><strong>推荐底座</strong><p>Codex 使用 App Server 承载线程、回合、流式事件和追问；OpenCode 使用 Server / SDK；其他智能体通过 ACP 或受限 CLI 适配。界面不复制任何一个终端，只复用它们的会话运行时。</p></div>
      {editing && <ProviderEditor profile={editing} onClose={() => setEditing(null)} onSave={async (profile, secret) => { if (secret) await setProviderSecret(profile.id, secret); await props.onSave({ ...profile, ready: profile.kind.endsWith('cli') ? profile.ready : Boolean(secret) || profile.secretConfigured, secretConfigured: Boolean(secret) || profile.secretConfigured }); setEditing(null); setMessage('配置已保存') }} />}
    </section>
  )
}

function ProviderEditor(props: { profile: ProviderProfile; onClose: () => void; onSave: (profile: ProviderProfile, secret: string) => Promise<void> }) {
  const [profile, setProfile] = useState(props.profile)
  const [secret, setSecret] = useState('')
  return (
    <div className="editor-drawer">
      <header><div><h2>{profile.name}</h2><p>配置模型和连接信息</p></div><button type="button" className="icon-button" onClick={props.onClose}><X size={18} /></button></header>
      <label>显示名称<input value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} /></label>
      <label>模型 ID<input value={profile.model} onChange={(event) => setProfile({ ...profile, model: event.target.value })} /></label>
      {!profile.kind.endsWith('cli') && <><label>API 地址<input value={profile.baseUrl ?? ''} onChange={(event) => setProfile({ ...profile, baseUrl: event.target.value })} /></label><label>API Key<input type="password" value={secret} placeholder={profile.secretConfigured ? '已保存在系统凭据库' : '输入 API Key'} onChange={(event) => setSecret(event.target.value)} /></label></>}
      <div className="drawer-actions"><button type="button" className="secondary-button" onClick={props.onClose}>取消</button><button type="button" className="primary-button" onClick={() => void props.onSave(profile, secret)}>保存</button></div>
    </div>
  )
}

function SettingsPanel(props: { settings: AppSettings; onSave: (settings: AppSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(props.settings)
  const [saved, setSaved] = useState(false)
  const [voiceCheck, setVoiceCheck] = useState('')
  const [permissions, setPermissions] = useState<{ screenCapture: boolean; accessibility: boolean } | null>(null)
  useEffect(() => {
    void getPermissionStatus().then(setPermissions).catch(() => setPermissions(null))
  }, [])
  return (
    <section className="settings-surface narrow">
      <header className="section-heading"><div><h1>设置</h1><p>快捷键、语言、回复方式和本地记录。</p></div></header>
      <div className="settings-group"><h2>取景</h2><label>全局快捷键<input value={draft.shortcut} onChange={(event) => setDraft({ ...draft, shortcut: event.target.value })} /><small>第一次点击高亮文本、图片、PDF、文件或程序对象，再点一次确认；拖动直接选择区域。</small></label><Toggle checked={draft.showPreview} label="手动导入文件时显示预览" onChange={(showPreview) => setDraft({ ...draft, showPreview })} /></div>
      <div className="settings-group"><h2>系统权限</h2><div className="permission-row"><span><strong>录屏</strong><small>框选和对象图片预览</small></span><i className={permissions?.screenCapture ? 'permission-ok' : 'permission-needed'}>{permissions?.screenCapture ? '已允许' : '需要开启'}</i><button type="button" className="secondary-button" onClick={() => void openPermissionSettings('screen')}>打开设置</button></div><div className="permission-row"><span><strong>辅助功能</strong><small>识别单个 PDF、文件、文本和控件</small></span><i className={permissions?.accessibility ? 'permission-ok' : 'permission-needed'}>{permissions?.accessibility ? '已允许' : '需要开启'}</i><button type="button" className="secondary-button" onClick={() => void openPermissionSettings('accessibility')}>打开设置</button></div><small>如果系统列表中没有 LensQuery，点“+”并选择 /Applications/LensQuery.app。更改权限后请完全退出并重新打开。</small></div>
      <div className="settings-group"><h2>分析与回复</h2><label>默认分析方式<select value={draft.defaultAnalysisMode} onChange={(event) => setDraft({ ...draft, defaultAnalysisMode: event.target.value as AnalysisMode })}>{analysisModes.map((mode) => <option key={mode.id} value={mode.id}>{mode.label} · {mode.hint}</option>)}</select></label><label>默认回复格式<select value={draft.defaultOutputFormat} onChange={(event) => setDraft({ ...draft, defaultOutputFormat: event.target.value as OutputFormat })}>{outputFormats.map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label><label>回答风格<select value={draft.replyStyle} onChange={(event) => setDraft({ ...draft, replyStyle: event.target.value as AppSettings['replyStyle'] })}><option value="customer-ready">客户可直接使用</option><option value="concise">简短结论</option><option value="detailed">详细分析</option></select></label><label>自定义要求<textarea value={draft.customReplyInstruction} onChange={(event) => setDraft({ ...draft, customReplyInstruction: event.target.value })} placeholder="例如：先给结论，再说明原理、步骤和验证方法。" /></label></div>
      <div className="settings-group"><h2>语言</h2><label>界面语言<select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as AppSettings['language'] })}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><Toggle checked={draft.detectCustomerLanguage} label="自动跟随顾客语言回答" onChange={(detectCustomerLanguage) => setDraft({ ...draft, detectCustomerLanguage })} /><label>无法识别时的语言<select value={draft.responseLanguage} onChange={(event) => setDraft({ ...draft, responseLanguage: event.target.value as AppSettings['responseLanguage'] })}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja-JP">日本語</option><option value="ko-KR">한국어</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option></select></label></div>
      <div className="settings-group"><h2>后台与结果</h2><Toggle checked={draft.launchAtStartup} label="登录系统后自动在后台启动" onChange={(launchAtStartup) => setDraft({ ...draft, launchAtStartup })} /><Toggle checked={draft.notificationsEnabled} label="分析完成后在右上角显示结果卡片" onChange={(notificationsEnabled) => setDraft({ ...draft, notificationsEnabled })} /><Toggle checked={draft.notificationPreview} label="在结果卡片中显示回答摘要" onChange={(notificationPreview) => setDraft({ ...draft, notificationPreview })} /><label>结果呈现<select value={draft.resultPresentation} onChange={(event) => setDraft({ ...draft, resultPresentation: event.target.value as AppSettings['resultPresentation'] })}><option value="notification">只显示右上角结果，继续后台运行</option><option value="window">自动打开会话窗口</option><option value="both">右上角显示并打开窗口</option></select></label><div><button type="button" className="secondary-button" onClick={() => void showSystemNotification('LensQuery 结果显示正常', '以后每次分析完成，回答摘要都会直接出现在右上角。')}>测试右上角结果</button></div></div>
      <div className="settings-group"><h2>语音</h2><label>朗读方式<select value={draft.voiceMode} onChange={(event) => setDraft({ ...draft, voiceMode: event.target.value as AppSettings['voiceMode'] })}><option value="off">关闭</option><option value="system">系统语音（当前可用）</option><option value="codex-realtime" disabled>Codex Realtime Voice（本机暂不可用）</option></select><small>本机 Codex 0.146.1 的 App Server 已公开实验音频方法，但普通本地线程返回“不支持 realtime conversation”；因此本构建明确停用该选项，保留系统语音作为可验证路径。</small></label><div><button type="button" className="secondary-button" onClick={async () => { try { await speakText('LensQuery 语音测试。'); setVoiceCheck('系统语音已启动') } catch (cause) { setVoiceCheck(String(cause)) } }}>测试系统语音</button>{voiceCheck && <small className="voice-check">{voiceCheck}</small>}</div><Toggle checked={draft.autoPlayVoice} label="回答完成后自动朗读" onChange={(autoPlayVoice) => setDraft({ ...draft, autoPlayVoice })} /></div>
      <div className="settings-group"><h2>本地数据</h2><Toggle checked={draft.saveHistory} label="保存会话时间线" onChange={(saveHistory) => setDraft({ ...draft, saveHistory })} /><Toggle checked={draft.retainImages} label="保留捕获图片" onChange={(retainImages) => setDraft({ ...draft, retainImages })} /></div>
      <div className="settings-footer"><span>{saved ? '已保存' : '设置只保存在本机'}</span><button type="button" className="primary-button" onClick={async () => { await props.onSave(draft); setSaved(true); window.setTimeout(() => setSaved(false), 1800) }}>保存设置</button></div>
    </section>
  )
}

function Toggle(props: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return <label className="toggle-row"><span>{props.label}</span><input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} /><i /></label>
}

function CaptureOverlay() {
  const [start, setStart] = useState<{ x: number; y: number } | null>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const [lockedTarget, setLockedTarget] = useState<(CaptureTarget & { localBounds: Bounds }) | null>(null)
  const [intent, setIntent] = useState<{
    analysisMode: AnalysisMode
    outputFormat: OutputFormat
    textScope: TextScope
    selectionMode: 'auto' | 'region' | 'element'
  }>({ analysisMode: 'explain', outputFormat: 'adaptive', textScope: 'object', selectionMode: 'auto' })
  const [keyboardSelection, setKeyboardSelection] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const selection = keyboardSelection ?? (start && current ? normalizeSelection(start, current) : null)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        void cancelCapture()
        return
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(event.key)) return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement) return
      if (event.key === 'Enter') {
        if (!keyboardSelection || busy) return
        event.preventDefault()
        const keyboardStart = { x: keyboardSelection.x, y: keyboardSelection.y }
        startRef.current = keyboardStart
        setStart(keyboardStart)
        setCurrent({ x: keyboardSelection.x + keyboardSelection.width, y: keyboardSelection.y + keyboardSelection.height })
        const centerX = keyboardSelection.x + keyboardSelection.width / 2
        const centerY = keyboardSelection.y + keyboardSelection.height / 2
        const PointerEventConstructor = window.PointerEvent ?? MouseEvent
        const synthetic = new PointerEventConstructor('pointerup', { clientX: centerX, clientY: centerY, screenX: window.screenX + centerX, screenY: window.screenY + centerY })
        window.setTimeout(() => document.querySelector<HTMLDivElement>('.capture-overlay')?.dispatchEvent(synthetic), 0)
        return
      }
      event.preventDefault()
      const delta = event.shiftKey ? 10 : 2
      setKeyboardSelection((current) => {
        const value = current ?? { x: Math.max(12, window.innerWidth / 2 - 160), y: Math.max(138, window.innerHeight / 2 - 100), width: 320, height: 200 }
        if (event.altKey) {
          return {
            ...value,
            width: Math.max(24, Math.min(window.innerWidth - value.x, value.width + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0))),
            height: Math.max(24, Math.min(window.innerHeight - value.y, value.height + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0))),
          }
        }
        return {
          ...value,
          x: Math.max(0, Math.min(window.innerWidth - value.width, value.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0))),
          y: Math.max(0, Math.min(window.innerHeight - value.height, value.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0))),
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, keyboardSelection])
  useEffect(() => {
    let dispose: (() => void) | undefined
    void listenForCaptureRequests(() => {
      setStart(null)
      startRef.current = null
      setCurrent(null)
      setBusy(false)
      setCaptureError('')
      setKeyboardSelection(null)
      setLockedTarget(null)
    }).then((unlisten) => { dispose = unlisten })
    return () => dispose?.()
  }, [])
  useEffect(() => {
    let dispose: (() => void) | undefined
    void listenForCaptureIntent((payload) => {
      setIntent((current) => ({
        analysisMode: payload.analysisMode ?? current.analysisMode,
        outputFormat: payload.outputFormat ?? current.outputFormat,
        textScope: (payload.textScope as TextScope | undefined) ?? current.textScope,
        selectionMode: payload.selectionMode ?? current.selectionMode,
      }))
    }).then((unlisten) => { dispose = unlisten })
    return () => dispose?.()
  }, [])
  async function finish(event: React.PointerEvent<HTMLDivElement>) {
    const origin = startRef.current ?? start
    if (!origin || busy) return
    const end = { x: event.clientX, y: event.clientY }
    const screenPoint = { x: event.screenX, y: event.screenY }
    const bounds = normalizeSelection(origin, end)
    const isClick = bounds.width < 8 && bounds.height < 8
    startRef.current = null
    setStart(null)
    setCurrent(null)
    if (intent.selectionMode === 'region' && isClick) {
      setCaptureError('当前是“框选区域”模式，请按住鼠标拖出一个区域。')
      return
    }
    const mode = intent.selectionMode === 'auto'
      ? (isClick ? 'element' : 'region')
      : intent.selectionMode

    if (mode === 'element' && isClick && (!lockedTarget || !pointInsideBounds(end, lockedTarget.localBounds))) {
      setBusy(true)
      setCaptureError('')
      try {
        const target = await inspectCaptureTarget(
          { x: screenPoint.x, y: screenPoint.y, width: 1, height: 1 },
          intent.textScope,
        )
        const originX = screenPoint.x - end.x
        const originY = screenPoint.y - end.y
        setLockedTarget({
          ...target,
          localBounds: {
            x: target.bounds.x - originX,
            y: target.bounds.y - originY,
            width: target.bounds.width,
            height: target.bounds.height,
          },
        })
      } catch (cause) {
        setCaptureError(String(cause))
      } finally {
        setBusy(false)
      }
      return
    }

    setBusy(true)
    try {
      await completeCapture({
        mode,
        bounds: mode === 'element'
          ? { x: screenPoint.x, y: screenPoint.y, width: 1, height: 1 }
          : {
              x: screenPoint.x - (end.x - bounds.x),
              y: screenPoint.y - (end.y - bounds.y),
              width: bounds.width,
              height: bounds.height,
            },
        textScope: intent.textScope,
        analysisMode: intent.analysisMode,
        outputFormat: intent.outputFormat,
      })
    } catch (cause) {
      setBusy(false)
      setCaptureError(String(cause))
    }
  }
  return (
    <div
      className="capture-overlay"
      data-busy={busy ? 'true' : undefined}
      onPointerDown={(event) => { const point = { x: event.clientX, y: event.clientY }; startRef.current = point; setCaptureError(''); setKeyboardSelection(null); event.currentTarget.setPointerCapture(event.pointerId); setStart(point); setCurrent(point) }}
      onPointerMove={(event) => {
        if (!startRef.current) return
        const point = { x: event.clientX, y: event.clientY }
        setCurrent(point)
        if (Math.abs(point.x - startRef.current.x) >= 8 || Math.abs(point.y - startRef.current.y) >= 8) setLockedTarget(null)
      }}
      onPointerUp={finish}
      onPointerCancel={() => { startRef.current = null; setStart(null); setCurrent(null) }}
    >
      {lockedTarget && <div className={`target-highlight ${lockedTarget.fallback ? 'fallback' : ''}`} style={{ left: lockedTarget.localBounds.x, top: lockedTarget.localBounds.y, width: lockedTarget.localBounds.width, height: lockedTarget.localBounds.height }}><span><strong>{lockedTarget.label}</strong><small>再点一次识别</small></span></div>}
      {intent.selectionMode !== 'element' && selection && selection.width >= 8 && selection.height >= 8 && <div className="selection-box" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}><span>{Math.round(selection.width)} × {Math.round(selection.height)}</span></div>}
      {captureError && <div className="overlay-error"><WarningCircle size={18} /><span>读取失败，请重新选择；或按 Esc 退出。<small>{captureError}</small></span></div>}
    </div>
  )
}

function normalizeSelection(start: { x: number; y: number }, end: { x: number; y: number }) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
}

function pointInsideBounds(point: { x: number; y: number }, bounds: Bounds) {
  return point.x >= bounds.x && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y && point.y <= bounds.y + bounds.height
}

function SourceIcon({ kind }: { kind: QuerySession['sourceKind'] }) {
  if (kind === 'browser') return <Globe size={17} />
  if (kind === 'file') return <File size={17} />
  if (kind === 'screen') return <Scan size={17} />
  if (kind === 'element') return <CursorClick size={17} />
  return <Question size={17} />
}

function LoadingScreen() {
  return <div className="loading-screen" role="status"><Question size={25} weight="bold" /><span>LensQuery 正在后台就绪</span></div>
}

function relativeTime(value: string) {
  const delta = Math.max(0, Date.now() - new Date(value).getTime())
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function formatFullTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export default App
