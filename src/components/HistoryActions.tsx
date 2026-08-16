import { DotsThree, Trash } from '@phosphor-icons/react'
import { useEffect, useRef } from 'react'
import type { HistoryDeleteTarget, HistoryMenuState } from '../lib/historyActions'

export function HistoryMenuTrigger(props: {
  label: string
  expanded: boolean
  className?: string
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className={props.className ?? 'history-menu-trigger'}
      aria-label={props.label}
      aria-haspopup="menu"
      aria-expanded={props.expanded}
      data-history-menu-trigger="true"
      onClick={props.onClick}
    >
      <DotsThree size={18} weight="bold" />
    </button>
  )
}

export function HistoryActionMenu(props: {
  state: HistoryMenuState
  onRequestDelete: (target: HistoryDeleteTarget) => void
}) {
  const label = props.state.target.kind === 'all' ? '清空所有会话' : '删除会话'
  return (
    <div
      className="history-action-menu"
      role="menu"
      aria-label={props.state.target.kind === 'all' ? '最近会话操作' : '会话操作'}
      style={{ left: props.state.left, top: props.state.top }}
    >
      <button type="button" role="menuitem" className="danger" autoFocus onClick={() => props.onRequestDelete(props.state.target)}>
        <Trash size={16} />
        <span>{label}</span>
      </button>
    </div>
  )
}

export function DeleteHistoryDialog(props: {
  target: HistoryDeleteTarget
  onCancel: () => void
  onConfirm: (target: HistoryDeleteTarget) => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const isAll = props.target.kind === 'all'
  const title = isAll ? '清空所有本地会话？' : '删除这个会话？'
  const detail = props.target.kind === 'all'
    ? `将删除此设备上的 ${props.target.count} 个会话及分析记录。`
    : `“${props.target.title}”将从此设备的最近会话中移除。`

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [])

  return (
    <dialog
      ref={dialogRef}
      className="delete-history-dialog"
      aria-labelledby="delete-history-title"
      aria-describedby="delete-history-description"
      onCancel={(event) => { event.preventDefault(); props.onCancel() }}
      onClick={(event) => { if (event.target === event.currentTarget) props.onCancel() }}
    >
      <div className="delete-history-copy">
        <h2 id="delete-history-title">{title}</h2>
        <p id="delete-history-description">{detail}<br />此操作不能撤销。</p>
      </div>
      <div className="delete-history-actions">
        <button type="button" className="secondary-button" autoFocus onClick={props.onCancel}>取消</button>
        <button type="button" className="delete-confirm-button" onClick={() => props.onConfirm(props.target)}>
          {isAll ? '全部删除' : '删除'}
        </button>
      </div>
    </dialog>
  )
}
