import { describe, expect, it } from 'vitest'

import {
  isAnalyzableUrl,
  normalizeAnalysisUrl,
  omniboxSuggestion,
} from './url-analysis.js'

describe('LensQuery direct URL analysis', () => {
  it.each([
    ['https://example.com/watch?v=1', 'https://example.com/watch?v=1'],
    ['example.com/docs', 'https://example.com/docs'],
    ['localhost:4173/test', 'http://localhost:4173/test'],
    ['file:///tmp/fixture.html', 'file:///tmp/fixture.html'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeAnalysisUrl(input)).toBe(expected)
  })

  it('uses the active page when the omnibox entry is empty', () => {
    expect(normalizeAnalysisUrl('', 'https://example.test/current')).toBe('https://example.test/current')
  })

  it('does not turn arbitrary words or browser-internal pages into URLs', () => {
    expect(normalizeAnalysisUrl('总结这个页面')).toBeUndefined()
    expect(normalizeAnalysisUrl('chrome://settings')).toBeUndefined()
    expect(isAnalyzableUrl('javascript:alert(1)')).toBe(false)
  })

  it('shows an explicit omnibox suggestion', () => {
    expect(omniboxSuggestion('example.com')).toContain('https://example.com/')
    expect(omniboxSuggestion('not a url')).toBe('输入完整网址，或留空分析当前页面')
  })
})
