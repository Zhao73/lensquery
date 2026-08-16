import { describe, expect, it } from 'vitest'
import { fitHistoryMenuPosition } from './historyActions'

describe('history action menu placement', () => {
  it('opens below an ordinary anchor and aligns to its right edge', () => {
    expect(fitHistoryMenuPosition(260, 80, 800, 600)).toEqual({ left: 72, top: 80 })
  })

  it('stays inside narrow viewport edges and flips above the bottom edge', () => {
    expect(fitHistoryMenuPosition(18, 590, 320, 600)).toEqual({ left: 8, top: 548 })
  })
})
