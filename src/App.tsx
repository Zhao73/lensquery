import {
  Aperture,
  ArrowClockwise,
  CaretRight,
  Check,
  ClockCounterClockwise,
  Copy,
  CursorClick,
  Eye,
  File,
  FileImage,
  FilePdf,
  Gear,
  FilmStrip,
  Key,
  Monitor,
  Path,
  PaperPlaneTilt,
  Plus,
  Scan,
  ShieldCheck,
  Sparkle,
  TerminalWindow,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { evidenceAccept, formatBytes, formatDuration, normalizeBrowserFiles } from './lib/files'
import { createTranslator } from './lib/i18n'
import {
  analyze,
  bootstrap,
  discoverCliProviders,
  saveProvider,
  saveSettings,
  setProviderSecret,
  startCapture,
  testProvider,
  prepareVideo,
  isDesktopRuntime,
  listenForEvidenceDrops,
  pickEvidenceFiles,
  probeVideo,
} from './lib/tauri'
import { useAppStore, type View } from './store/app'
import type { AnalysisResult, AppSettings, CaptureMode, ProviderProfile } from './types/domain'

const prompts = [
  { id: 'identify', label: '这是什么？', hint: '识别并解释所选内容' },
  { id: 'customer', label: '客户回答', hint: '生成可直接使用的答复' },
  { id: 'troubleshoot', label: '排查问题', hint: '定位报错与下一步' },
  { id: 'summarize', label: '总结文件', hint: '提取重点、决定和缺口' },
  { id: 'video', label: '分析视频', hint: '关键内容、时间点与客户答复' },
]

function App() {
  const {
    ready,
    view,
    providers,
    settings,
    files,
    captures,
    history,
    setView,
    hydrate,
    setSettings,
    setProviders,
    upsertProvider,
    addFiles,
    addCapture,
    removeCapture,
    removeFile,
    updateFile,
    clearEvidence,
    addResult,
  } = useAppStore()
  const [question, setQuestion] = useState('')
  const [promptId, setPromptId] = useState('identify')
  const [captureMessage, setCaptureMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    bootstrap().then(hydrate).catch((cause: unknown) => setError(String(cause)))
  }, [hydrate])

  useEffect(() => {
    if (!settings) return
    document.documentElement.lang = settings.language
  }, [settings])

  useEffect(() => {
    let dispose: (() => void) | undefined
    void listenForEvidenceDrops(addFiles).then((unlisten) => { dispose = unlisten })
    return () => dispose?.()
  }, [addFiles])

  const selectedProvider = useMemo(
    () => providers.find(({ id }) => id === settings?.defaultProviderId) ?? providers[0],
    [providers, settings?.defaultProviderId],
  )

  const handleCapture = async (mode: CaptureMode) => {
    setError('')
    setCaptureMessage('正在打开桌面选择层…')
    try {
      const response = await startCapture(mode)
      setCaptureMessage(response.message)
      if (response.evidence) addCapture(response.evidence)
    } catch (cause) {
      setError(String(cause))
      setCaptureMessage('')
    }
  }

  const handleSubmit = async () => {
    if (!selectedProvider) {
      setError('请先配置一个模型提供商。')
      setView('providers')
      return
    }
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const next = await analyze({
        question: question.trim() || prompts.find(({ id }) => id === promptId)?.label || '这是什么？',
        promptId,
        providerId: selectedProvider.id,
        captures,
        files,
      })
      setResult(next)
      addResult(next)
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  if (!ready || !settings) return <LoadingScreen />
  const t = createTranslator(settings.language)
  const nav: Array<{ id: View; label: string; icon: typeof Aperture }> = [
    { id: 'home', label: t('home'), icon: Aperture },
    { id: 'history', label: t('history'), icon: ClockCounterClockwise },
    { id: 'providers', label: t('providers'), icon: Sparkle },
    { id: 'settings', label: t('settings'), icon: Gear },
  ]

  return (
    <div className="app-frame">
      {/*
        THESIS: LensQuery behaves like a fixed-field desktop instrument, refusing generic dashboard cards.
        OWN-WORLD: sixteen-color PC-98 palette, ordered dithers, one-pixel seams, cream bitmap-like labels.
        STORY: select visible evidence, verify what leaves the computer, choose a model, receive a useful answer.
        FIRST VIEWPORT: compact rail, dominant capture field, lower command window, provider state fixed at right.
        FORM: assigned fixed-region computer screen, seed f69cb4a1.
        FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
      */}
      <header className="titlebar">
        <button className="brand" type="button" onClick={() => setView('home')} aria-label="LensQuery 首页">
          <span className="brand-mark" aria-hidden="true"><Scan size={20} weight="bold" /></span>
          <span>LENSQUERY</span>
        </button>
        <div className="titlebar-center">
          <span className="status-light" aria-hidden="true" />
          {t('localReady')}
          <kbd>Ctrl</kbd><span>+</span><kbd>Shift</kbd><span>+</span><kbd>Space</kbd>
        </div>
        <div className="window-meta">WIN 10/11 · v0.1</div>
      </header>

      <aside className="side-rail" aria-label="主导航">
        {nav.map((item) => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.id}
              className={view === item.id ? 'rail-item active' : 'rail-item'}
              onClick={() => setView(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <Icon size={22} weight={view === item.id ? 'fill' : 'regular'} />
              <span>{item.label}</span>
            </button>
          )
        })}
        <div className="rail-privacy" title={t('privacyTitle')}>
          <ShieldCheck size={22} weight="fill" />
          <span>{t('privacy')}</span>
        </div>
      </aside>

      <main className="workspace">
        {view === 'home' && (
          <HomeView
            files={files}
            captures={captures}
            question={question}
            promptId={promptId}
            provider={selectedProvider}
            captureMessage={captureMessage}
            busy={busy}
            result={result}
            error={error}
            onQuestion={setQuestion}
            onPrompt={setPromptId}
            onCapture={handleCapture}
            onAddFiles={(next) => addFiles(normalizeBrowserFiles(next))}
            onRemoveFile={removeFile}
            onPrepareVideo={async (id, path) => {
              setError('')
              updateFile(id, { processingStatus: 'preparing', processingError: undefined })
              try {
                const video = await probeVideo(path)
                updateFile(id, { video })
                const videoPreparation = await prepareVideo(path)
                updateFile(id, { video, videoPreparation, processingStatus: 'ready' })
              } catch (cause) {
                const processingError = String(cause)
                updateFile(id, { processingError, processingStatus: 'error' })
                setError(processingError)
              }
            }}
            onRemoveCapture={removeCapture}
            onClear={clearEvidence}
            onSubmit={handleSubmit}
            onOpenFiles={async () => {
              if (isDesktopRuntime()) {
                try {
                  const selected = await pickEvidenceFiles()
                  if (selected?.length) addFiles(selected)
                } catch (cause) {
                  setError(String(cause))
                }
              } else {
                fileInputRef.current?.click()
              }
            }}
            onOpenProviders={() => setView('providers')}
          />
        )}
        {view === 'history' && <HistoryView history={history} />}
        {view === 'providers' && (
          <ProvidersView
            providers={providers}
            selectedId={settings.defaultProviderId}
            onSelect={(defaultProviderId) => {
              const next = { ...settings, defaultProviderId }
              setSettings(next)
              void saveSettings(next)
            }}
            onSave={(profile) => {
              upsertProvider(profile)
              return saveProvider(profile)
            }}
            onRescan={async () => {
              const detected = await discoverCliProviders()
              setProviders(detected)
              return detected
            }}
          />
        )}
        {view === 'settings' && (
          <SettingsView
            settings={settings}
            onSave={async (next) => {
              const saved = await saveSettings(next)
              setSettings(saved)
            }}
          />
        )}
      </main>

      <input
        ref={fileInputRef}
        className="visually-hidden"
        type="file"
        multiple
        accept={evidenceAccept}
        onChange={(event) => event.target.files && addFiles(normalizeBrowserFiles(event.target.files))}
      />
    </div>
  )
}

function LoadingScreen() {
  const storedLanguage = (() => {
    try {
      return JSON.parse(localStorage.getItem('lensquery.settings') ?? '{}').language
    } catch {
      return 'zh-CN'
    }
  })()
  const t = createTranslator(storedLanguage === 'en' ? 'en' : 'zh-CN')
  return (
    <div className="loading-screen" role="status">
      <div className="loading-grid" />
      <Scan size={36} weight="bold" />
      <strong>LENSQUERY</strong>
      <span>{t('initializing')}</span>
    </div>
  )
}

interface HomeViewProps {
  files: ReturnType<typeof normalizeBrowserFiles>
  captures: import('./types/domain').CaptureEvidence[]
  question: string
  promptId: string
  provider?: ProviderProfile
  captureMessage: string
  busy: boolean
  result: AnalysisResult | null
  error: string
  onQuestion: (value: string) => void
  onPrompt: (value: string) => void
  onCapture: (mode: CaptureMode) => void
  onAddFiles: (files: FileList | File[]) => void
  onRemoveFile: (id: string) => void
  onPrepareVideo: (id: string, path: string) => Promise<void>
  onRemoveCapture: (id: string) => void
  onClear: () => void
  onSubmit: () => void
  onOpenFiles: () => void
  onOpenProviders: () => void
}

function HomeView(props: HomeViewProps) {
  const [dragging, setDragging] = useState(false)
  const hasEvidence = props.files.length > 0 || props.captures.length > 0
  const isCli = props.provider?.kind.endsWith('cli') ?? false

  return (
    <div className="home-layout">
      <section className="capture-stage" aria-labelledby="capture-title">
        <div className="stage-sky" aria-hidden="true">
          <div className="dither-cloud cloud-one" />
          <div className="dither-cloud cloud-two" />
          <div className="scan-reticle"><span /><span /><span /><span /></div>
          <div className="desktop-shapes"><i /><i /><i /></div>
        </div>
        <div className="stage-copy">
          <h1 id="capture-title">指向任何内容，<br />马上问清楚。</h1>
          <p>框选屏幕、点一个界面元素，或拖入本地文件。提交前你会看到全部待发送内容。</p>
          <div className="capture-actions">
            <button type="button" className="primary-action" onClick={() => props.onCapture('region')}>
              <Scan size={22} weight="bold" />
              框选区域
              <kbd>Ctrl⇧Space</kbd>
            </button>
            <button type="button" className="secondary-action" onClick={() => props.onCapture('element')}>
              <CursorClick size={21} weight="bold" />
              点选元素
            </button>
          </div>
          {props.captureMessage && <p className="stage-message" role="status">{props.captureMessage}</p>}
        </div>
        <div className="privacy-seal"><Eye size={17} weight="bold" /> 发送前预览</div>
      </section>

      <aside
        className={dragging ? 'evidence-panel dragging' : 'evidence-panel'}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          props.onAddFiles(event.dataTransfer.files)
        }}
      >
        <div className="panel-title">
          <span>待分析内容</span>
          {hasEvidence && <button type="button" onClick={props.onClear} aria-label="清空待分析内容"><Trash size={16} /></button>}
        </div>
        {hasEvidence ? (
          <div className="file-list">
            {props.captures.map((capture) => <CaptureRow key={capture.id} capture={capture} onRemove={() => props.onRemoveCapture(capture.id)} />)}
            {props.files.map((file) => <FileRow key={file.id} file={file} onRemove={() => props.onRemoveFile(file.id)} onPrepare={() => props.onPrepareVideo(file.id, file.path)} />)}
            <button type="button" className="add-more" onClick={props.onOpenFiles}><Plus size={17} />继续添加</button>
          </div>
        ) : (
          <button type="button" className="drop-zone" onClick={props.onOpenFiles}>
            <span className="drop-icon"><FilePdf size={28} weight="duotone" /><FileImage size={28} weight="duotone" /></span>
            <strong>拖入图片、视频、PDF 或文件</strong>
            <small>视频先在本地抽帧与提取音轨 · 发送前可预览</small>
          </button>
        )}
        <div className="context-lines">
          <div><Monitor size={17} /><span>窗口信息</span><b>提交时读取</b></div>
          <div><CursorClick size={17} /><span>辅助功能文字</span><b>敏感字段过滤</b></div>
          <div><ShieldCheck size={17} /><span>自动上传</span><b>关闭</b></div>
        </div>
      </aside>

      <section className="command-window" aria-label="提问面板">
        <div className="window-caption">
          <span>MESSAGE.LOG</span>
          <span>{props.files.length + props.captures.length} ATTACHMENTS</span>
        </div>
        <div className="prompt-tabs" role="tablist" aria-label="提问模板">
          {prompts.map((prompt) => (
            <button
              type="button"
              key={prompt.id}
              role="tab"
              aria-selected={props.promptId === prompt.id}
              className={props.promptId === prompt.id ? 'selected' : ''}
              onClick={() => props.onPrompt(prompt.id)}
            >
              {props.promptId === prompt.id && <CaretRight size={13} weight="fill" />}
              <span className="prompt-copy"><strong>{prompt.label}</strong><small>{prompt.hint}</small></span>
            </button>
          ))}
        </div>
        <div className="composer">
          <label htmlFor="question">你想知道什么？</label>
          <textarea
            id="question"
            value={props.question}
            onChange={(event) => props.onQuestion(event.target.value)}
            placeholder="例如：这是什么？请结合周围内容解释，并给我一段可以快速回复客户的话。"
          />
          <div className="composer-footer">
            <button type="button" className="provider-chip" onClick={props.onOpenProviders}>
              <span className={props.provider?.ready ? 'provider-dot ready' : 'provider-dot'} />
              {props.provider?.name ?? '选择模型'}
              <span className="provider-model">{props.provider?.model ?? '未配置'}</span>
            </button>
            <button type="button" className="send-button" disabled={props.busy} onClick={props.provider?.ready ? props.onSubmit : props.onOpenProviders}>
              {props.busy ? <ArrowClockwise className="spin" size={20} /> : <PaperPlaneTilt size={20} weight="fill" />}
              {props.busy ? '分析中' : props.provider?.ready ? '开始分析' : '先配置模型'}
            </button>
          </div>
        </div>
        {props.error && <div className="inline-error" role="alert"><WarningCircle size={18} />{props.error}</div>}
      </section>

      <aside className="provider-status">
        <div className="panel-title"><span>模型通道</span><button type="button" onClick={props.onOpenProviders} aria-label="打开模型配置"><Gear size={16} /></button></div>
        <div className="active-provider">
          <span className={props.provider?.ready ? 'provider-orb ready' : 'provider-orb'}><Sparkle size={25} weight="fill" /></span>
          <div><strong>{props.provider?.name ?? '尚未选择'}</strong><small>{props.provider?.model ?? '打开设置完成配置'}</small></div>
        </div>
        <div className="provider-facts">
          <p><span>视觉输入</span><b className={props.provider?.capabilities?.vision ? '' : 'muted'}>{props.provider?.capabilities?.vision ? <Check size={14} /> : <X size={14} />}{props.provider?.ready ? props.provider.capabilities?.vision ? '支持' : '不可用' : '未配置'}</b></p>
          <p><span>视频快析</span><b className={props.provider?.capabilities?.video ? '' : 'muted'}>{props.provider?.capabilities?.video ? <Check size={14} /> : <X size={14} />}{props.provider?.ready ? props.provider.capabilities?.video ? '关键帧' : '不可用' : '未配置'}</b></p>
          <p><span>PDF</span><b className={props.provider?.capabilities?.pdf ? '' : 'muted'}>{props.provider?.capabilities?.pdf ? <Check size={14} /> : <X size={14} />}{props.provider?.ready ? props.provider.capabilities?.pdf ? '支持' : '不可用' : '未配置'}</b></p>
          <p><span>{isCli ? '运行方式' : '密钥'}</span><b className={props.provider?.ready || props.provider?.secretConfigured ? '' : 'muted'}>{isCli ? <TerminalWindow size={14} /> : <Key size={14} />}{isCli ? props.provider?.ready ? '本机 CLI' : '未发现' : props.provider?.secretConfigured ? '系统保险库' : '未配置'}</b></p>
        </div>
        <button type="button" className="configure-link" onClick={props.onOpenProviders}>配置模型与 API <CaretRight size={15} /></button>
      </aside>

      {props.result && <ResultPanel result={props.result} />}
    </div>
  )
}

function CaptureRow({ capture, onRemove }: { capture: import('./types/domain').CaptureEvidence; onRemove: () => void }) {
  return (
    <div className="capture-row">
      <img src={capture.previewUrl} alt="捕获区域预览" />
      <div>
        <strong>{capture.windowTitle || (capture.kind === 'region' ? '屏幕区域' : '界面元素')}</strong>
        <small>{Math.round(capture.bounds.width)} × {Math.round(capture.bounds.height)} · {capture.processName || '桌面'}</small>
        {capture.accessibleText && <small className="capture-text">{capture.accessibleText}</small>}
      </div>
      <button type="button" onClick={onRemove} aria-label="移除捕获内容"><X size={16} /></button>
    </div>
  )
}

function FileRow({ file, onRemove, onPrepare }: { file: import('./types/domain').FileEvidence; onRemove: () => void; onPrepare: () => void }) {
  const Icon = file.kind === 'image' ? FileImage : file.kind === 'video' ? FilmStrip : file.kind === 'pdf' ? FilePdf : File
  return (
    <div className="file-row">
      <Icon size={23} weight="duotone" />
      <div>
        <strong>{file.name}</strong>
        <small>{file.kind.toUpperCase()} · {formatBytes(file.size)}{file.kind === 'video' ? ` · ${formatDuration(file.video?.durationSeconds)}` : ''}</small>
        {file.kind === 'video' && (
          <button type="button" className="prepare-video" disabled={file.processingStatus === 'preparing'} onClick={onPrepare}>
            {file.processingStatus === 'preparing' ? '正在本地抽帧…' : file.videoPreparation ? `${file.videoPreparation.frames.length} 帧已就绪` : file.processingStatus === 'error' ? '重试准备' : '快速准备视频'}
          </button>
        )}
        {file.videoPreparation && (
          <div className="video-preparation">
            <span>{file.videoPreparation.audioPath ? '画面 + 音轨' : '仅画面'} · 每 {file.videoPreparation.sampleIntervalSeconds.toFixed(1)} 秒取样</span>
            <div className="video-frame-strip">
              {file.videoPreparation.frames.map((frame) => (
                <figure key={frame.path}>
                  {frame.previewUrl ? <img src={frame.previewUrl} alt={`${formatDuration(frame.timestampSeconds)} 视频帧`} /> : <FilmStrip size={22} />}
                  <figcaption>{formatDuration(frame.timestampSeconds)}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}
        {file.processingError && <small className="file-error">{file.processingError}</small>}
      </div>
      <button type="button" onClick={onRemove} aria-label={`移除 ${file.name}`}><X size={16} /></button>
    </div>
  )
}

function ResultPanel({ result }: { result: AnalysisResult }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(result.answer)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }
  return (
    <section className="result-panel" aria-live="polite">
      <div className="window-caption"><span>ANSWER.LOG</span><span>{result.durationMs} MS</span></div>
      <div className="result-content">
        <div className="result-heading"><span className="answer-cursor" /><strong>分析完成</strong><small>{result.provider} · {result.model}</small></div>
        <p>{result.answer}</p>
        <button type="button" className="copy-answer" onClick={copy}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? '已复制' : '复制回答'}</button>
      </div>
    </section>
  )
}

function HistoryView({ history }: { history: AnalysisResult[] }) {
  return (
    <Page title="本地历史" description="回答保存在此设备；截图留存默认关闭。">
      {history.length === 0 ? (
        <EmptyState icon={ClockCounterClockwise} title="还没有分析记录" text="完成第一次询问后，回答会显示在这里。" />
      ) : (
        <div className="history-list">
          {history.map((item) => (
            <article key={item.id}>
              <div><strong>{item.answer.split('\n')[0]}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.provider}</small></div>
              <CaretRight size={18} />
            </article>
          ))}
        </div>
      )}
    </Page>
  )
}

interface ProvidersViewProps {
  providers: ProviderProfile[]
  selectedId: string
  onSelect: (id: string) => void
  onSave: (profile: ProviderProfile) => Promise<ProviderProfile>
  onRescan: () => Promise<ProviderProfile[]>
}

function ProvidersView({ providers, selectedId, onSelect, onSave, onRescan }: ProvidersViewProps) {
  const [editing, setEditing] = useState<ProviderProfile | null>(null)
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState('')
  const [scanning, setScanning] = useState(false)

  const save = async () => {
    if (!editing) return
    let profile = editing
    if (secret.trim()) {
      const configured = await setProviderSecret(editing.id, secret)
      profile = { ...profile, secretConfigured: configured }
    }
    await onSave(profile)
    setEditing(null)
    setSecret('')
  }

  return (
    <Page title="模型通道" description="自动发现 Codex、Claude Code、OpenCode 与 Grok，也可连接直接 API。">
      <div className="provider-toolbar">
        <div><strong>CLI AUTO DISCOVERY</strong><small>并行扫描 PATH 与常见用户安装目录；版本探测最多等待 2 秒，登录状态在首次请求时校验。</small></div>
        <button type="button" className="secondary-action compact" disabled={scanning} onClick={async () => {
          setScanning(true)
          setMessage('')
          try {
            const detected = await onRescan()
            setMessage(`扫描完成：发现 ${detected.filter((item) => item.kind.endsWith('cli') && item.ready).length} 个可用 CLI。`)
          } catch (cause) {
            setMessage(String(cause))
          } finally {
            setScanning(false)
          }
        }}><ArrowClockwise className={scanning ? 'spin' : ''} size={17} />{scanning ? '正在扫描' : '重新扫描 CLI'}</button>
      </div>
      {message && !editing && <p className="discovery-message" role="status">{message}</p>}
      <div className="provider-grid">
        {providers.map((provider) => (
          <article key={provider.id} className={selectedId === provider.id ? 'provider-card selected' : 'provider-card'}>
            <button type="button" className="provider-main" onClick={() => onSelect(provider.id)}>
              <span className={provider.ready ? 'provider-orb ready' : 'provider-orb'}><Sparkle size={22} weight="fill" /></span>
              <span><strong>{provider.name}</strong><small>{provider.model}</small></span>
              {selectedId === provider.id && <span className="default-tag"><Check size={13} />默认</span>}
            </button>
            <div className="provider-card-footer">
              <span>{provider.kind.endsWith('cli') ? provider.ready ? `已发现${provider.cli?.version ? ` · ${provider.cli.version}` : ''}` : '未安装' : provider.secretConfigured ? '密钥已保存' : '需要 API Key'}</span>
              <button type="button" onClick={() => { setEditing(provider); setMessage('') }}>配置</button>
            </div>
          </article>
        ))}
        <button type="button" className="new-provider" onClick={() => setEditing({ id: crypto.randomUUID(), name: '兼容 API', kind: 'compatible', model: '', baseUrl: 'https://api.example.com/v1', ready: false, secretConfigured: false, capabilities: { vision: true, pdf: false, files: false, video: true, audioTranscription: false, streaming: true } })}>
          <Plus size={24} />添加兼容端点
        </button>
      </div>

      {editing && (
        <div className="editor-panel">
          <div className="window-caption"><span>PROVIDER.CONFIG</span><button type="button" onClick={() => setEditing(null)} aria-label="关闭"><X size={16} /></button></div>
          <div className="form-grid">
            <label>显示名称<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
            <label>模型 ID<input value={editing.model} onChange={(event) => setEditing({ ...editing, model: event.target.value })} /></label>
            {editing.kind.endsWith('cli') && <label className="full cli-path-field">自动发现路径<span><Path size={16} />{editing.cli?.executablePath ?? `${editing.cli?.command ?? 'CLI'} 尚未发现`}</span><small>命令由内置适配器固定生成，不通过 Shell 拼接。</small></label>}
            {!editing.kind.endsWith('cli') && <label className="full">API 地址<input value={editing.baseUrl ?? ''} placeholder={editing.kind === 'openai' ? 'https://api.openai.com/v1' : editing.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://HOST/v1'} onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })} /></label>}
            {!editing.kind.endsWith('cli') && <label className="full">API Key<input type="password" autoComplete="off" value={secret} placeholder={editing.secretConfigured ? '已保存在系统保险库；留空即不修改' : '保存到系统保险库'} onChange={(event) => setSecret(event.target.value)} /></label>}
          </div>
          {message && <p className="test-message" role="status">{message}</p>}
          <div className="editor-actions">
            <button type="button" className="secondary-action" onClick={async () => setMessage(await testProvider(editing))}>{editing.kind.endsWith('cli') ? '检查路径' : '测试连接'}</button>
            <button type="button" className="primary-action compact" onClick={save}><Check size={18} />保存配置</button>
          </div>
        </div>
      )}
    </Page>
  )
}

function SettingsView({ settings, onSave }: { settings: AppSettings; onSave: (settings: AppSettings) => Promise<void> }) {
  const [draft, setDraft] = useState(settings)
  const [saved, setSaved] = useState(false)
  const commit = async () => {
    await onSave(draft)
    setSaved(true)
    window.setTimeout(() => setSaved(false), 1500)
  }
  const t = createTranslator(draft.language)
  return (
    <Page title={t('settingsTitle')} description={t('settingsDescription')}>
      <div className="settings-sheet">
        <section>
          <h2>{t('capture')}</h2>
          <label className="field-row"><span><strong>{t('shortcut')}</strong><small>{t('shortcutHelp')}</small></span><input value={draft.shortcut} onChange={(event) => setDraft({ ...draft, shortcut: event.target.value })} /></label>
          <Toggle label={t('preview')} detail={t('previewHelp')} checked={draft.showPreview} onChange={(showPreview) => setDraft({ ...draft, showPreview })} />
        </section>
        <section>
          <h2>{t('localData')}</h2>
          <Toggle label={t('historySave')} detail={t('historySaveHelp')} checked={draft.saveHistory} onChange={(saveHistory) => setDraft({ ...draft, saveHistory })} />
          <Toggle label={t('retain')} detail={t('retainHelp')} checked={draft.retainImages} onChange={(retainImages) => setDraft({ ...draft, retainImages })} />
        </section>
        <section>
          <h2>{t('interface')}</h2>
          <label className="field-row"><span><strong>{t('interfaceLanguage')}</strong><small>{t('interfaceLanguageHelp')}</small></span><select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as AppSettings['language'] })}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
        </section>
        <section>
          <h2>{t('customerReply')}</h2>
          <Toggle label={t('followCustomer')} detail={t('followCustomerHelp')} checked={draft.detectCustomerLanguage} onChange={(detectCustomerLanguage) => setDraft({ ...draft, detectCustomerLanguage })} />
          <label className="field-row"><span><strong>{t('fallbackLanguage')}</strong><small>{t('fallbackLanguageHelp')}</small></span><select value={draft.responseLanguage} onChange={(event) => setDraft({ ...draft, responseLanguage: event.target.value as AppSettings['responseLanguage'] })}><option value="zh-CN">简体中文</option><option value="en">English</option><option value="ja-JP">日本語</option><option value="ko-KR">한국어</option><option value="es-ES">Español</option><option value="fr-FR">Français</option><option value="de-DE">Deutsch</option></select></label>
          <label className="field-row"><span><strong>{t('replyStyle')}</strong><small>{t('replyStyleHelp')}</small></span><select value={draft.replyStyle} onChange={(event) => setDraft({ ...draft, replyStyle: event.target.value as AppSettings['replyStyle'] })}><option value="customer-ready">{t('customerReady')}</option><option value="concise">{t('concise')}</option><option value="detailed">{t('detailed')}</option></select></label>
          <label className="text-field-row"><span><strong>{t('customInstruction')}</strong><small>{t('customInstructionHelp')}</small></span><textarea maxLength={1000} value={draft.customReplyInstruction} placeholder={t('optional')} onChange={(event) => setDraft({ ...draft, customReplyInstruction: event.target.value })} /><b>{draft.customReplyInstruction.length}/1000</b></label>
          <div className="language-preview"><span>AUTO LANGUAGE</span><strong>{draft.detectCustomerLanguage ? t('autoLanguage') : `${t('fixedLanguage')} ${draft.responseLanguage}`}</strong><small>{t('languagePriority')}</small></div>
        </section>
        <button type="button" className="primary-action compact save-settings" onClick={commit}>{saved ? <Check size={18} /> : <Gear size={18} />}{saved ? t('saved') : t('save')}</button>
      </div>
    </Page>
  )
}

function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="toggle-row">
      <span><strong>{label}</strong><small>{detail}</small></span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="toggle-track"><span /></span>
    </label>
  )
}

function Page({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="page-view">
      <header><h1>{title}</h1><p>{description}</p></header>
      {children}
    </div>
  )
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Aperture; title: string; text: string }) {
  return (
    <div className="empty-state">
      <Icon size={42} weight="duotone" />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  )
}

export default App
