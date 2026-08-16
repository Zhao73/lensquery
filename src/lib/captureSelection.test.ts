import { describe, expect, it } from 'vitest'

import { isRegionDrag } from './captureSelection'

describe('capture gesture classification', () => {
  it('keeps ordinary click jitter in single-object mode', () => {
    expect(isRegionDrag({ width: 7, height: 7 })).toBe(false)
    expect(isRegionDrag({ width: 120, height: 3 })).toBe(false)
  })

  it('uses region mode only for an intentional rectangular drag', () => {
    expect(isRegionDrag({ width: 8, height: 8 })).toBe(true)
    expect(isRegionDrag({ width: 320, height: 180 })).toBe(true)
  })
})
