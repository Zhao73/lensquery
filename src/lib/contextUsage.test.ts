import { describe, expect, it } from 'vitest'

import type { QuerySession } from '../types/domain'
import { contextUsage, estimateTokens, formatTokenCount } from './contextUsage'

const session: QuerySession = {
  id: 'session',
  title: 'fixture',
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
  providerId: 'codex-cli',
  sourceLabel: 'fixture',
  sourceKind: 'text',
  captures: [],
  files: [],
  messages: [
    { id: '1', role: 'user', content: 'hello world '.repeat(250), createdAt: '2026-08-17T00:00:00.000Z', status: 'complete' },
    { id: '2', role: 'assistant', content: 'answer '.repeat(250), createdAt: '2026-08-17T00:00:01.000Z', status: 'complete' },
  ],
  analysisMode: 'explain',
  outputFormat: 'adaptive',
  contextMode: 'full',
}

describe('context usage labels', () => {
  it('formats Claude-style window sizes', () => {
    expect(formatTokenCount(1_000_000)).toBe('1m')
    expect(formatTokenCount(200_000)).toBe('200k')
    expect(formatTokenCount(32_000)).toBe('32k')
    expect(formatTokenCount(850)).toBe('850')
  })

  it('counts CJK more densely than Latin', () => {
    expect(estimateTokens('识别所选内容')).toBeGreaterThan(estimateTokens('abcdefghi'))
  })

  it('shows used / window for the selected context mode', () => {
    const usage = contextUsage(session, 'codex-cli')
    expect(usage.windowLabel).toBe('1m')
    expect(usage.summary).toMatch(/\d+k? \/ 1m/)
    expect(usage.used).toBeGreaterThan(0)
    expect(usage.percent).toBeLessThan(10)
  })

  it('shrinks the window when compact is selected', () => {
    expect(contextUsage({ ...session, contextMode: 'compact' }, 'codex-cli').windowLabel).toBe('32k')
    expect(contextUsage({ ...session, contextMode: 'auto' }, 'claude-cli').windowLabel).toBe('200k')
  })
})
