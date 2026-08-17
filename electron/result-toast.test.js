import { describe, expect, it } from 'vitest'

import { resultToastPayload, resultToastPosition } from './result-toast.js'

describe('Electron result toast', () => {
  it('sits under the menu bar on the primary display', () => {
    expect(resultToastPosition(0, 0, 1920, 392, 1)).toEqual({ x: 1510, y: 38 })
    expect(resultToastPosition(-1440, -180, 1440, 392, 2)).toEqual({ x: -428, y: -104 })
  })

  it('keeps a readable title and answer excerpt', () => {
    expect(resultToastPayload('  视野环球  ', '四大指数上涨，标普突破压力。'.repeat(40))).toMatchObject({
      title: '视野环球',
    })
    expect(resultToastPayload('', 'empty title')).toBeNull()
    expect(resultToastPayload('LensQuery 结果显示正常', '以后每次分析完成，回答摘要都会直接出现在右上角。')?.body).toContain('右上角')
  })
})
