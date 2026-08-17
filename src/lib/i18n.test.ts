import { describe, expect, it } from 'vitest'
import { createTranslator, normalizeUiLanguage } from './i18n'

describe('interface translation', () => {
  it('returns English navigation copy', () => {
    expect(createTranslator('en')('navSettings')).toBe('Settings')
    expect(createTranslator('en')('productName')).toBe('What is it')
  })

  it('returns Simplified Chinese workbench copy', () => {
    expect(createTranslator('zh-CN')('followCustomer')).toBe('自动跟随顾客语言回答')
    expect(createTranslator('zh-CN')('startRecognition')).toBe('开始识别')
  })

  it('returns Japanese screenshot copy', () => {
    expect(createTranslator('ja-JP')('navTimeline')).toBe('会話')
    expect(createTranslator('ja-JP')('residentReady')).toBe('バックグラウンド待機中')
  })

  it('normalizes unknown languages to Chinese', () => {
    expect(normalizeUiLanguage('fr-FR')).toBe('zh-CN')
    expect(normalizeUiLanguage('ja')).toBe('ja-JP')
  })
})
