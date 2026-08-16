// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DeleteHistoryDialog, HistoryActionMenu, HistoryMenuTrigger } from './HistoryActions'

describe('Codex-style history actions', () => {
  it('exposes a three-dot menu trigger with the correct menu state', () => {
    render(<HistoryMenuTrigger label="管理会话：测试" expanded={false} onClick={() => undefined} />)
    const trigger = screen.getByRole('button', { name: '管理会话：测试' })
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('routes the menu delete action to the selected session', async () => {
    const user = userEvent.setup()
    const onRequestDelete = vi.fn()
    const target = { kind: 'session' as const, id: 'session-1', title: '客户回复' }
    render(<HistoryActionMenu state={{ target, origin: 'row:session-1', left: 12, top: 18 }} onRequestDelete={onRequestDelete} />)

    await user.click(screen.getByRole('menuitem', { name: '删除会话' }))
    expect(onRequestDelete).toHaveBeenCalledWith(target)
  })

  it('requires explicit confirmation before deleting local history', async () => {
    const user = userEvent.setup()
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const target = { kind: 'session' as const, id: 'session-1', title: '长视频分析' }
    render(<DeleteHistoryDialog target={target} onCancel={onCancel} onConfirm={onConfirm} />)

    expect(screen.getByRole('dialog', { name: '删除这个会话？' }).textContent).toContain('此操作不能撤销')
    await user.click(screen.getByRole('button', { name: '删除' }))
    expect(onConfirm).toHaveBeenCalledWith(target)
  })
})
