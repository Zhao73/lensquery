import {
  ArrowCounterClockwise,
  CaretDown,
  Check,
  ClockCounterClockwise,
  Copy,
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
import './App.css'
import { evidenceAccept, formatBytes, normalizeBrowserFiles } from './lib/files'
import {
  analyze,
  bootstrap,
  cancelCapture,
  completeCapture,
  discoverCliProviders,
  isDesktopRuntime,
  listenForCaptureRequests,
  listenForCaptureErrors,
  listenForEvidenceDrops,
  listenForQueryEvidence,
  pickEvidenceFiles,
  saveProvider,
  saveSettings,
  setProviderSecret,
  startCapture,
  testProvider,
} from './lib/tauri'
import { useAppStore, type View } from './store/app'
import type {
  AnalysisRequest,
  AppSettings,
  BrowserContext,
  CaptureEvidence,
  ConversationMessage,
  FileEvidence,
  ProviderProfile,
  QuerySession,
} from './types/domain'

const DEFAULT_QUESTION = '这是什么？请结合周围内容分析，并给出可以直接使用的答案。'

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

function App() {
  if (new URLSearchParams(window.location.search).get('window') === 'capture') {
    return <CaptureOverlay />
  }
  return <ConversationApp />
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bootstrap().then(hydrate).catch((cause: unknown) => setError(String(cause)))
  }, [hydrate])

  useEffect(() => {
    if (settings) document.documentElement.lang = settings.language
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
    () => providers.find(({ id }) => id === settings?.defaultProviderId) ?? providers.find(({ ready: isReady }) => isReady) ?? providers[0],
    [providers, settings?.defaultProviderId],
  )

  async function submitNewQuery(input: {
    captures: CaptureEvidence[]
    files: FileEvidence[]
    browserContext?: BrowserContext
    question?: string
  }) {
    const provider = selectedProvider
    if (!provider?.ready) {
      setError('还没有可用的模型通道。请先在“模型”中扫描本机 CLI 或配置 API。')
      setView('providers')
      return
    }
    const question = input.question?.trim() || DEFAULT_QUESTION
    const source = sourceFromEvidence(input.captures, input.files, input.browserContext)
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
      files: input.files,
      browserContext: input.browserContext,
      messages: [newMessage('user', question, 'complete'), pending],
    }
    upsertSession(session)
    setError('')
    try {
      const result = await analyze({
        question,
        promptId: 'identify',
        providerId: provider.id,
        captures: input.captures,
        files: input.files,
        browserContext: input.browserContext,
        conversation: [],
      })
      upsertSession({
        ...session,
        updatedAt: now(),
        messages: session.messages.map((message) => message.id === pending.id
          ? { ...message, content: result.answer, status: 'complete' as const }
          : message),
      })
    } catch (cause) {
      upsertSession({
        ...session,
        updatedAt: now(),
        messages: session.messages.map((message) => message.id === pending.id
          ? { ...message, content: String(cause), status: 'error' as const }
          : message),
      })
      setError(String(cause))
    }
  }

  useEffect(() => {
    let disposeCapture: (() => void) | undefined
    let disposeCaptureError: (() => void) | undefined
    let disposeEvidence: (() => void) | undefined
    let disposeDrop: (() => void) | undefined
    void listenForCaptureRequests(() => setCaptureStatus('按一下选择对象，按住并拖动选择区域；Esc 取消。')).then((dispose) => { disposeCapture = dispose })
    void listenForCaptureErrors((message) => {
      setCaptureStatus('')
      setError(message)
    }).then((dispose) => { disposeCaptureError = dispose })
    void listenForQueryEvidence((payload) => {
      setCaptureStatus('')
      void submitNewQuery({ captures: payload.capture ? [payload.capture] : [], files: [], browserContext: payload.browserContext })
    }).then((dispose) => { disposeEvidence = dispose })
    void listenForEvidenceDrops((files) => {
      if (files.length) void submitNewQuery({ captures: [], files })
    }).then((dispose) => { disposeDrop = dispose })
    return () => {
      disposeCapture?.()
      disposeCaptureError?.()
      disposeEvidence?.()
      disposeDrop?.()
    }
  // selectedProvider intentionally refreshes the handler when the route changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProvider?.id])

  const activeSession = sessions.find(({ id }) => id === activeSessionId) ?? null
  const visibleSessions = sessions.filter((session) =>
    `${session.title} ${session.sourceLabel} ${session.messages.map(({ content }) => content).join(' ')}`.toLowerCase().includes(filter.toLowerCase()),
  )

  async function submitFollowUp() {
    if (!activeSession || !followUp.trim()) return
    const provider = providers.find(({ id }) => id === activeSession.providerId) ?? selectedProvider
    if (!provider?.ready) {
      setError('这个会话使用的模型当前不可用。请先检查模型设置。')
      return
    }
    const question = followUp.trim()
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

  return (
    <div className={sidebarOpen ? 'shell' : 'shell sidebar-collapsed'}>
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
              <kbd>Ctrl ⇧ Space</kbd>
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
            <button type="button" className="icon-button" onClick={() => setSidebarOpen((value) => !value)} aria-label="切换侧栏"><SidebarSimple size={20} /></button>
            <button type="button" className="wordmark" onClick={() => setView('timeline')}>LensQuery</button>
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
              onDelete={() => removeSession(activeSession.id)}
              onRetry={() => {
                const lastQuestion = [...activeSession.messages].reverse().find(({ role }) => role === 'user')?.content
                if (lastQuestion) setFollowUp(lastQuestion)
              }}
            />
          ) : (
            <EmptyTimeline onCapture={beginCapture} onOpenFiles={openFiles} query={query} onQuery={setQuery} onSubmit={() => {
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
  onDelete: () => void
  onRetry: () => void
}) {
  const tailRef = useRef<HTMLDivElement>(null)
  useEffect(() => tailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [props.session.messages.length])
  return (
    <section className="conversation-view">
      <header className="conversation-titlebar">
        <div>
          <h1>{props.session.title}</h1>
          <p><SourceIcon kind={props.session.sourceKind} />{props.session.sourceLabel}<span>·</span>{props.provider?.name ?? '模型'}<span>·</span>{formatFullTime(props.session.createdAt)}</p>
        </div>
        <button type="button" className="icon-button" onClick={props.onDelete} aria-label="删除会话"><Trash size={18} /></button>
      </header>
      <div className="message-stream">
        <EvidenceStrip session={props.session} />
        {props.session.messages.map((message) => (
          <article key={message.id} className={`message ${message.role} ${message.status}`}>
            <div className="message-author">{message.role === 'user' ? '你' : props.provider?.name ?? 'LensQuery'}</div>
            {message.status === 'pending' ? (
              <div className="thinking"><i /><i /><i /><span>正在分析选择内容</span></div>
            ) : (
              <div className="message-content">{message.content}</div>
            )}
            {message.role === 'assistant' && message.status === 'complete' && (
              <div className="message-actions">
                <button type="button" onClick={() => void navigator.clipboard.writeText(message.content)}><Copy size={15} />复制</button>
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
  if (!capture && !file && !browser) return null
  return (
    <details className="evidence-strip">
      <summary><SourceIcon kind={session.sourceKind} /><span>{session.sourceLabel}</span><small>查看本次上下文</small><CaretDown size={15} /></summary>
      <div className="evidence-detail">
        {capture?.previewUrl && <img src={capture.previewUrl} alt="屏幕选择预览" />}
        {capture && <dl><div><dt>范围</dt><dd>{Math.round(capture.bounds.width)} × {Math.round(capture.bounds.height)}</dd></div>{capture.accessibleText && <div><dt>辅助信息</dt><dd>{capture.accessibleText}</dd></div>}</dl>}
        {file && <dl><div><dt>文件</dt><dd>{file.name}</dd></div><div><dt>类型</dt><dd>{file.mediaType || file.kind}</dd></div><div><dt>大小</dt><dd>{formatBytes(file.size)}</dd></div></dl>}
        {browser && <dl><div><dt>网页</dt><dd>{browser.title}</dd></div><div><dt>元素</dt><dd>{browser.tagName.toLowerCase()}{browser.role ? ` · ${browser.role}` : ''}</dd></div><div><dt>地址</dt><dd>{browser.url}</dd></div>{browser.selector && <div><dt>选择器</dt><dd><code>{browser.selector}</code></dd></div>}</dl>}
      </div>
    </details>
  )
}

function EmptyTimeline(props: { onCapture: () => void; onOpenFiles: () => void; query: string; onQuery: (value: string) => void; onSubmit: () => void }) {
  return (
    <section className="empty-timeline">
      <div className="empty-instruction">
        <div className="question-cursor"><Question size={22} weight="bold" /></div>
        <div>
          <h1>按快捷键开始询问</h1>
          <p>点一下识别对象，按住拖动分析区域；网页连接器可读取所点文字、按钮、视频和周围 DOM。</p>
        </div>
      </div>
      <button type="button" className="primary-button empty-primary" onClick={props.onCapture}>
        <CursorClick size={18} />进入 ❓ 选择模式
        <span className="shortcut-line"><kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Space</kbd></span>
      </button>
      <div className="alternate-label"><span>也可以直接询问</span><button type="button" onClick={props.onOpenFiles}><File size={16} />选择图片、PDF 或视频</button></div>
      <form className="text-question" onSubmit={(event) => { event.preventDefault(); props.onSubmit() }}>
        <input value={props.query} onChange={(event) => props.onQuery(event.target.value)} placeholder="输入一个文字问题" aria-label="直接输入问题" />
        <button type="submit" disabled={!props.query.trim()} aria-label="发送文字问题"><PaperPlaneTilt size={17} weight="fill" /></button>
      </form>
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
  return (
    <section className="settings-surface narrow">
      <header className="section-heading"><div><h1>设置</h1><p>快捷键、语言、回复方式和本地记录。</p></div></header>
      <div className="settings-group"><h2>取景</h2><label>全局快捷键<input value={draft.shortcut} onChange={(event) => setDraft({ ...draft, shortcut: event.target.value })} /><small>从任何应用进入 ❓ 询问模式</small></label><Toggle checked={draft.showPreview} label="分析前显示上下文预览" onChange={(showPreview) => setDraft({ ...draft, showPreview })} /></div>
      <div className="settings-group"><h2>语言与回答</h2><label>界面语言<select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as AppSettings['language'] })}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label><Toggle checked={draft.detectCustomerLanguage} label="自动跟随顾客语言回答" onChange={(detectCustomerLanguage) => setDraft({ ...draft, detectCustomerLanguage })} /><label>无法识别时的语言<select value={draft.responseLanguage} onChange={(event) => setDraft({ ...draft, responseLanguage: event.target.value as AppSettings['responseLanguage'] })}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja-JP">日本語</option><option value="ko-KR">한국어</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option></select></label><label>回答风格<select value={draft.replyStyle} onChange={(event) => setDraft({ ...draft, replyStyle: event.target.value as AppSettings['replyStyle'] })}><option value="customer-ready">客户可直接使用</option><option value="concise">简短结论</option><option value="detailed">详细分析</option></select></label><label>自定义要求<textarea value={draft.customReplyInstruction} onChange={(event) => setDraft({ ...draft, customReplyInstruction: event.target.value })} placeholder="例如：先用日语敬语给出回复，再用中文说明依据。" /></label></div>
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
  const [current, setCurrent] = useState<{ x: number; y: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [captureError, setCaptureError] = useState('')
  const selection = start && current ? normalizeSelection(start, current) : null
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void cancelCapture()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  async function finish(event: React.PointerEvent<HTMLDivElement>) {
    if (!start || busy) return
    const end = { x: event.clientX, y: event.clientY }
    const bounds = normalizeSelection(start, end)
    const isClick = bounds.width < 8 && bounds.height < 8
    setBusy(true)
    try {
      await completeCapture({
        mode: isClick ? 'element' : 'region',
        bounds: isClick
          ? { x: event.screenX, y: event.screenY, width: 1, height: 1 }
          : {
              x: event.screenX - (event.clientX - bounds.x),
              y: event.screenY - (event.clientY - bounds.y),
              width: bounds.width,
              height: bounds.height,
            },
      })
    } catch (cause) {
      setBusy(false)
      setStart(null)
      setCurrent(null)
      setCaptureError(String(cause))
    }
  }
  return (
    <div
      className="capture-overlay"
      onPointerDown={(event) => { setCaptureError(''); event.currentTarget.setPointerCapture(event.pointerId); setStart({ x: event.clientX, y: event.clientY }); setCurrent({ x: event.clientX, y: event.clientY }) }}
      onPointerMove={(event) => { if (start) setCurrent({ x: event.clientX, y: event.clientY }) }}
      onPointerUp={finish}
    >
      <div className="overlay-help"><Question size={20} weight="bold" /><span>点一下识别对象 · 按住拖动选择区域 · Esc 取消</span></div>
      {selection && selection.width >= 8 && selection.height >= 8 && <div className="selection-box" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }}><span>{Math.round(selection.width)} × {Math.round(selection.height)}</span></div>}
      {busy && <div className="overlay-busy">正在读取所选内容…</div>}
      {captureError && <div className="overlay-error"><WarningCircle size={18} /><span>读取失败，请重新选择；或按 Esc 退出。<small>{captureError}</small></span></div>}
    </div>
  )
}

function normalizeSelection(start: { x: number; y: number }, end: { x: number; y: number }) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) }
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
