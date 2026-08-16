import type { ProviderProfile, ReasoningEffort } from '../types/domain'

export const reasoningOptions: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高（模型需支持）' },
]

export function providerSupportsReasoningEffort(provider?: ProviderProfile): boolean {
  return provider?.kind === 'codex-cli' || provider?.kind === 'openai'
}

export function providerDefaultReasoningEffort(provider?: ProviderProfile): ReasoningEffort {
  return providerSupportsReasoningEffort(provider) ? (provider?.reasoningEffort ?? 'auto') : 'auto'
}
