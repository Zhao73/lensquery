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
  Key,
  Monitor,
  PaperPlaneTilt,
  Plus,
  Scan,
  ShieldCheck,
  Sparkle,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { formatBytes, normalizeBrowserFiles } from './lib/files'
import {
  analyze,
  bootstrap,
  saveProvider,
  saveSettings,
  setProviderSecret,
  startCapture,
  testProvider,
} from './lib/tauri'
import { useAppStore, type View } from './store/app'
import type { AnalysisResult, AppSettings, CaptureMode, ProviderProfile } from './types/domain'

const prompts = [
  { id: 'identify', label: '这是什么？', hint: '识别并解释所选内容' },
  { id: 'customer', label: '客户回答', hint: '生成可直接使用的答复' },
  { id: 'troubleshoot', label: '排查问题', hint: '定位报错与下一步' },
  { id: 'summarize', label: '总结文件', hint: '提取重点、决定和缺口' },
]

const nav: Array<{ id: View; label: string; icon: typeof Aperture }> = [
  { id: 'home', label: '询问', icon: Aperture },
  { id: 'history', label: '历史', icon: ClockCounterClockwise },
  { id: 'providers', label: '模型', icon: Sparkle },
  { id: 'settings', label: '设置', icon: Gear },
]

function App() {
  const {
    ready,
    view,
    providers,
    settings,
    files,
    history,
    setView,
    hydrate,
    setSettings,
    upsertProvider,
    addFiles,
    removeFile,
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
        captures: [],
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
          本地待命
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
        <div className="rail-privacy" title="发送前始终预览">
          <ShieldCheck size={22} weight="fill" />
          <span>隐私</span>
        </div>
      </aside>

      <main className="workspace">
        {view === 'home' && (
          <HomeView
            files={files}
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
            onClear={clearEvidence}
            onSubmit={handleSubmit}
            onOpenFiles={() => fileInputRef.current?.click()}
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
        accept="image/*,.pdf,.txt,.md,.json,.csv,.log,.xml,.html,.css,.js,.ts,.tsx"
        onChange={(event) => event.target.files && addFiles(normalizeBrowserFiles(event.target.files))}
      />
    </div>
  )
}

function LoadingScreen() {
  return (
    <div className="loading-screen" role="status">
      <div className="loading-grid" />
      <Scan size={36} weight="bold" />
      <strong>LENSQUERY</strong>
      <span>正在初始化本地服务</span>
    </div>
  )
}

interface HomeViewProps {
  files: ReturnType<typeof normalizeBrowserFiles>
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
  onClear: () => void
  onSubmit: () => void
  onOpenFiles: () => void
  onOpenProviders: () => void
}

function HomeView(props: HomeViewProps) {
  const [dragging, setDragging] = useState(false)
  const hasEvidence = props.files.length > 0

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
            {props.files.map((file) => <FileRow key={file.id} file={file} onRemove={() => props.onRemoveFile(file.id)} />)}
            <button type="button" className="add-more" onClick={props.onOpenFiles}><Plus size={17} />继续添加</button>
          </div>
        ) : (
          <button type="button" className="drop-zone" onClick={props.onOpenFiles}>
            <span className="drop-icon"><FilePdf size={28} weight="duotone" /><FileImage size={28} weight="duotone" /></span>
            <strong>拖入图片、PDF 或文件</strong>
            <small>也可以点击选择 · 单文件上限 25 MB</small>
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
          <span>{props.files.length} ATTACHMENTS</span>
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
            <button type="button" className="send-button" disabled={props.busy} onClick={props.onSubmit}>
              {props.busy ? <ArrowClockwise className="spin" size={20} /> : <PaperPlaneTilt size={20} weight="fill" />}
              {props.busy ? '分析中' : '开始分析'}
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
          <p><span>视觉输入</span><b><Check size={14} />支持</b></p>
          <p><span>PDF</span><b><Check size={14} />自动路由</b></p>
          <p><span>密钥</span><b><Key size={14} />系统保险库</b></p>
        </div>
        <button type="button" className="configure-link" onClick={props.onOpenProviders}>配置模型与 API <CaretRight size={15} /></button>
      </aside>

      {props.result && <ResultPanel result={props.result} />}
    </div>
  )
}

function FileRow({ file, onRemove }: { file: ReturnType<typeof normalizeBrowserFiles>[number]; onRemove: () => void }) {
  const Icon = file.kind === 'image' ? FileImage : file.kind === 'pdf' ? FilePdf : File
  return (
    <div className="file-row">
      <Icon size={23} weight="duotone" />
      <div><strong>{file.name}</strong><small>{file.kind.toUpperCase()} · {formatBytes(file.size)}</small></div>
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
}

function ProvidersView({ providers, selectedId, onSelect, onSave }: ProvidersViewProps) {
  const [editing, setEditing] = useState<ProviderProfile | null>(null)
  const [secret, setSecret] = useState('')
  const [message, setMessage] = useState('')

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
    <Page title="模型通道" description="连接直接 API、兼容端点，或本机已安装的 Codex 与 Claude Code。">
      <div className="provider-grid">
        {providers.map((provider) => (
          <article key={provider.id} className={selectedId === provider.id ? 'provider-card selected' : 'provider-card'}>
            <button type="button" className="provider-main" onClick={() => onSelect(provider.id)}>
              <span className={provider.ready ? 'provider-orb ready' : 'provider-orb'}><Sparkle size={22} weight="fill" /></span>
              <span><strong>{provider.name}</strong><small>{provider.model}</small></span>
              {selectedId === provider.id && <span className="default-tag"><Check size={13} />默认</span>}
            </button>
            <div className="provider-card-footer">
              <span>{provider.kind.endsWith('cli') ? '本地 CLI' : provider.secretConfigured ? '密钥已保存' : '需要 API Key'}</span>
              <button type="button" onClick={() => { setEditing(provider); setMessage('') }}>配置</button>
            </div>
          </article>
        ))}
        <button type="button" className="new-provider" onClick={() => setEditing({ id: crypto.randomUUID(), name: '兼容 API', kind: 'compatible', model: '', baseUrl: 'https://api.example.com/v1', ready: false, secretConfigured: false })}>
          <Plus size={24} />添加兼容端点
        </button>
      </div>

      {editing && (
        <div className="editor-panel">
          <div className="window-caption"><span>PROVIDER.CONFIG</span><button type="button" onClick={() => setEditing(null)} aria-label="关闭"><X size={16} /></button></div>
          <div className="form-grid">
            <label>显示名称<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
            <label>模型 ID<input value={editing.model} onChange={(event) => setEditing({ ...editing, model: event.target.value })} /></label>
            {!editing.kind.endsWith('cli') && <label className="full">API 地址<input value={editing.baseUrl ?? ''} placeholder={editing.kind === 'openai' ? 'https://api.openai.com/v1' : editing.kind === 'anthropic' ? 'https://api.anthropic.com' : 'https://HOST/v1'} onChange={(event) => setEditing({ ...editing, baseUrl: event.target.value })} /></label>}
            {!editing.kind.endsWith('cli') && <label className="full">API Key<input type="password" autoComplete="off" value={secret} placeholder={editing.secretConfigured ? '已保存在系统保险库；留空即不修改' : '保存到系统保险库'} onChange={(event) => setSecret(event.target.value)} /></label>}
          </div>
          {message && <p className="test-message">{message}</p>}
          <div className="editor-actions">
            <button type="button" className="secondary-action" onClick={async () => setMessage(await testProvider(editing))}>测试连接</button>
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
  return (
    <Page title="本地设置" description="快捷键、隐私与历史策略都保存在当前电脑。">
      <div className="settings-sheet">
        <section>
          <h2>捕获</h2>
          <label className="field-row"><span><strong>全局快捷键</strong><small>在任何应用中打开框选层</small></span><input value={draft.shortcut} onChange={(event) => setDraft({ ...draft, shortcut: event.target.value })} /></label>
          <Toggle label="提交前预览" detail="显示截图、文件与提取到的上下文" checked={draft.showPreview} onChange={(showPreview) => setDraft({ ...draft, showPreview })} />
        </section>
        <section>
          <h2>本地数据</h2>
          <Toggle label="保存回答历史" detail="只保存在本机应用数据目录" checked={draft.saveHistory} onChange={(saveHistory) => setDraft({ ...draft, saveHistory })} />
          <Toggle label="保留捕获图片" detail="默认关闭；关闭时请求结束即删除临时图片" checked={draft.retainImages} onChange={(retainImages) => setDraft({ ...draft, retainImages })} />
        </section>
        <section>
          <h2>界面</h2>
          <label className="field-row"><span><strong>语言</strong><small>首发支持简体中文与 English</small></span><select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value as AppSettings['language'] })}><option value="zh-CN">简体中文</option><option value="en">English</option></select></label>
        </section>
        <button type="button" className="primary-action compact save-settings" onClick={commit}>{saved ? <Check size={18} /> : <Gear size={18} />}{saved ? '已保存' : '保存设置'}</button>
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
