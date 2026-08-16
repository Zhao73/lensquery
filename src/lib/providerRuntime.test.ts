import { describe, expect, it } from 'vitest'

import type { ProviderProfile } from '../types/domain'
import { providerDefaultReasoningEffort, providerSupportsReasoningEffort } from './providerRuntime'

function profile(kind: ProviderProfile['kind'], reasoningEffort?: ProviderProfile['reasoningEffort']): ProviderProfile {
  return { id: kind, name: kind, kind, model: 'fixture', reasoningEffort, ready: true, secretConfigured: true }
}

describe('provider runtime defaults', () => {
  it('uses an explicit reasoning default for runtimes that actually forward it', () => {
    expect(providerSupportsReasoningEffort(profile('codex-cli'))).toBe(true)
    expect(providerDefaultReasoningEffort(profile('codex-cli', 'high'))).toBe('high')
    expect(providerSupportsReasoningEffort(profile('openai'))).toBe(true)
  })

  it('does not claim a separate effort control for unsupported adapters', () => {
    expect(providerSupportsReasoningEffort(profile('anthropic'))).toBe(false)
    expect(providerDefaultReasoningEffort(profile('compatible', 'high'))).toBe('auto')
  })
})
