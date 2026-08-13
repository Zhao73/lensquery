import { describe, expect, it } from 'vitest'
import { createTranslator } from './i18n'

describe('interface translation', () => {
  it('returns English navigation copy', () => {
    expect(createTranslator('en')('settings')).toBe('Settings')
  })

  it('returns Simplified Chinese reply policy copy', () => {
    expect(createTranslator('zh-CN')('followCustomer')).toBe('跟随客户语言')
  })
})
