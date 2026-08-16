import {
  Brain,
  CaretDown,
  ChatsCircle,
  TerminalWindow,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'

import type {
  ContextMode,
  ProviderProfile,
  QuerySession,
  ReasoningEffort,
} from '../types/domain'
import { providerDefaultReasoningEffort, providerSupportsReasoningEffort, reasoningOptions } from '../lib/providerRuntime'
import { ProviderLogo } from './ProviderLogo'

export type SessionRuntimeUpdate = Pick<QuerySession, 'providerId' | 'model' | 'reasoningEffort' | 'contextMode'>

const contextOptions: Array<{ value: ContextMode; label: string }> = [
  { value: 'auto', label: '自动（最近 12 条）' },
  { value: 'compact', label: '精简（最近 4 条）' },
  { value: 'full', label: '完整会话' },
  { value: 'evidence-only', label: '仅本次证据' },
]

export function SessionRuntimeControls(props: {
  session: QuerySession
  provider?: ProviderProfile
  providers: ProviderProfile[]
  onChange: (update: SessionRuntimeUpdate) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const provider = props.provider
  const model = props.session.model ?? provider?.model ?? 'default'
  const supportsReasoning = providerSupportsReasoningEffort(provider)
  const reasoning = supportsReasoning
    ? (props.session.reasoningEffort ?? providerDefaultReasoningEffort(provider))
    : 'auto'
  const contextMode = props.session.contextMode ?? 'auto'
  const readyProviders = props.providers.filter((item) => item.ready || item.id === props.session.providerId)
  const contextCharacters = props.session.messages
    .filter(({ status }) => status === 'complete')
    .reduce((total, message) => total + message.content.length, 0)

  useEffect(() => {
    if (!open) return
    const closeOnPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', closeOnPointer)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', closeOnPointer)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function update(update: Partial<SessionRuntimeUpdate>) {
    props.onChange({
      providerId: props.session.providerId,
      model,
      reasoningEffort: reasoning,
      contextMode,
      ...update,
    })
  }

  return (
    <div className="session-runtime-controls" ref={rootRef}>
      <button
        type="button"
        className="session-runtime-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <ProviderLogo provider={provider} size={14} />
        <span>{provider?.name ?? '模型不可用'}</span>
        <small>{model}</small>
        <CaretDown size={12} />
      </button>
      {open && (
        <section className="session-runtime-popover" role="dialog" aria-label="会话模型与上下文">
          <header>
            <div><strong>会话运行参数</strong><small>从下一条追问开始使用</small></div>
            <span>约 {contextCharacters.toLocaleString('zh-CN')} 字</span>
          </header>
          <label>
            <span><TerminalWindow size={15} /><i>提供商</i></span>
            <select
              aria-label="提供商"
              value={props.session.providerId}
              onChange={(event) => {
                const nextProvider = props.providers.find(({ id }) => id === event.target.value)
                update({
                  providerId: event.target.value,
                  model: nextProvider?.model ?? 'default',
                  reasoningEffort: providerDefaultReasoningEffort(nextProvider),
                })
              }}
            >
              {readyProviders.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>
            <span><TerminalWindow size={15} /><i>模型</i></span>
            <input
              aria-label="模型 ID"
              list={`session-models-${provider?.id ?? 'unknown'}`}
              value={model}
              maxLength={160}
              spellCheck={false}
              onChange={(event) => update({ model: event.target.value })}
              onBlur={(event) => {
                if (!event.target.value.trim()) update({ model: provider?.model ?? 'default' })
              }}
            />
            <datalist id={`session-models-${provider?.id ?? 'unknown'}`}>
              {(provider?.models ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </datalist>
          </label>
          <label>
            <span><Brain size={15} /><i>思考强度</i></span>
            <select aria-label="思考强度" disabled={!supportsReasoning} value={reasoning} onChange={(event) => update({ reasoningEffort: event.target.value as ReasoningEffort })}>
              {reasoningOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <label>
            <span><ChatsCircle size={15} /><i>上下文</i></span>
            <select aria-label="上下文" value={contextMode} onChange={(event) => update({ contextMode: event.target.value as ContextMode })}>
              {contextOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </label>
          <footer>{supportsReasoning ? '思考强度从下一条请求开始生效。' : '当前适配器未单独传递思考强度，由模型自身决定。'} 证据文件与选区始终保留；「上下文」只控制历史对话。</footer>
        </section>
      )}
    </div>
  )
}
