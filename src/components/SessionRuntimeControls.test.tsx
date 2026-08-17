// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { ProviderProfile, QuerySession } from '../types/domain'
import { SessionRuntimeControls } from './SessionRuntimeControls'

const providers: ProviderProfile[] = [
  { id: 'codex-cli', name: 'Codex CLI', kind: 'codex-cli', model: 'default', ready: true, secretConfigured: false, models: [{ id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol', source: 'cache' }] },
  { id: 'openai', name: 'OpenAI', kind: 'openai', model: 'gpt-5', ready: true, secretConfigured: true },
]

const session: QuerySession = {
  id: 'session',
  title: 'fixture',
  createdAt: '2026-08-15T00:00:00.000Z',
  updatedAt: '2026-08-15T00:00:00.000Z',
  providerId: 'codex-cli',
  model: 'default',
  sourceLabel: 'fixture',
  sourceKind: 'text',
  captures: [],
  files: [],
  messages: [],
  analysisMode: 'explain',
  outputFormat: 'adaptive',
}

describe('SessionRuntimeControls', () => {
  it('edits provider, model, reasoning effort, and context for the next turn', () => {
    const onChange = vi.fn()
    render(<SessionRuntimeControls session={session} provider={providers[0]} providers={providers} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /Codex CLI/ }))
    expect(screen.getByRole('dialog', { name: '会话模型与上下文' })).toBeVisible()
    expect(document.querySelector('datalist option[value="gpt-5.6-sol"]')).toHaveTextContent('GPT-5.6-Sol')
    expect(screen.getAllByText(/0 \/ 200k/).length).toBeGreaterThan(0)

    fireEvent.change(screen.getByLabelText('提供商'), { target: { value: 'openai' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ providerId: 'openai', model: 'gpt-5' }))

    fireEvent.change(screen.getByLabelText('思考强度'), { target: { value: 'high' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ reasoningEffort: 'high' }))

    fireEvent.change(screen.getByLabelText('上下文'), { target: { value: 'full' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ contextMode: 'full' }))
  })

  it('shows a 1m window after the session selects full context', () => {
    render(<SessionRuntimeControls session={{ ...session, contextMode: 'full' }} provider={providers[0]} providers={providers} onChange={vi.fn()} />)
    expect(screen.getByText('0 / 1m')).toBeVisible()
  })
})
