import type { ContextMode, ProviderKind, QuerySession } from '../types/domain'

export const CONTEXT_MODE_WINDOWS: Record<ContextMode, { label: string; shortLabel: string; tokens: number }> = {
  auto: { label: 'Auto · 200k', shortLabel: '200k', tokens: 200_000 },
  compact: { label: 'Compact · 32k', shortLabel: '32k', tokens: 32_000 },
  full: { label: '1m', shortLabel: '1m', tokens: 1_000_000 },
  'evidence-only': { label: 'Evidence', shortLabel: 'Evidence', tokens: 8_000 },
}

const PROVIDER_WINDOWS: Partial<Record<ProviderKind, Partial<Record<ContextMode, number>>>> = {
  'codex-cli': { auto: 200_000, compact: 32_000, full: 1_000_000, 'evidence-only': 8_000 },
  openai: { auto: 200_000, compact: 32_000, full: 1_000_000, 'evidence-only': 8_000 },
  anthropic: { auto: 200_000, compact: 32_000, full: 200_000, 'evidence-only': 8_000 },
  'claude-cli': { auto: 200_000, compact: 32_000, full: 200_000, 'evidence-only': 8_000 },
  'opencode-cli': { auto: 200_000, compact: 32_000, full: 200_000, 'evidence-only': 8_000 },
  'grok-cli': { auto: 128_000, compact: 32_000, full: 128_000, 'evidence-only': 8_000 },
}

export function estimateTokens(text: string): number {
  const value = String(text || '')
  if (!value) return 0
  const cjk = value.match(/[㐀-鿿぀-ヿ가-힯]/g)?.length ?? 0
  const other = Math.max(0, value.length - cjk)
  return Math.max(1, Math.ceil(cjk / 1.6 + other / 4))
}

export function sessionContextTokens(session: Pick<QuerySession, 'messages' | 'files' | 'browserContext' | 'captures'>): number {
  const parts: string[] = []
  for (const message of session.messages) {
    if (message.status !== 'complete') continue
    parts.push(message.content)
  }
  if (session.browserContext?.selectedText) parts.push(session.browserContext.selectedText)
  if (session.browserContext?.nearbyText) parts.push(session.browserContext.nearbyText)
  if (session.browserContext?.transcript) parts.push(session.browserContext.transcript)
  for (const file of session.files) {
    if (file.extractedText) parts.push(file.extractedText)
    if (file.videoPreparation?.transcript) parts.push(file.videoPreparation.transcript)
  }
  for (const capture of session.captures) {
    if (capture.accessibleText) parts.push(capture.accessibleText)
  }
  return parts.reduce((total, part) => total + estimateTokens(part), 0)
}

export function contextWindowTokens(kind: ProviderKind | undefined, mode: ContextMode): number {
  return PROVIDER_WINDOWS[kind ?? 'openai']?.[mode] ?? CONTEXT_MODE_WINDOWS[mode].tokens
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000
    return Number.isInteger(millions) ? `${millions}m` : `${millions.toFixed(1)}m`
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000
    return Number.isInteger(thousands) ? `${thousands}k` : `${thousands.toFixed(1)}k`
  }
  return String(Math.max(0, Math.round(tokens)))
}

export function contextUsage(session: QuerySession, kind?: ProviderKind) {
  const mode = session.contextMode ?? 'auto'
  const used = sessionContextTokens(session)
  const window = contextWindowTokens(kind, mode)
  const percent = window > 0 ? Math.min(100, Math.round((used / window) * 100)) : 0
  return {
    mode,
    used,
    window,
    percent,
    usedLabel: formatTokenCount(used),
    windowLabel: formatTokenCount(window),
    summary: `${formatTokenCount(used)} / ${formatTokenCount(window)}`,
    tone: percent >= 90 ? 'critical' : percent >= 70 ? 'warning' : 'ok',
  }
}
