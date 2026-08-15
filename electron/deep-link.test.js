import { describe, expect, it } from 'vitest'

import { isLensQueryDeepLink, pathsFromDeepLink } from './deep-link.js'

describe('LensQuery shell deep links', () => {
  it('accepts only the bounded analyze route', () => {
    expect(isLensQueryDeepLink('lensquery://analyze?path=%2Ftmp%2Fsample.pdf')).toBe(true)
    expect(pathsFromDeepLink('https://example.test/?path=/tmp/sample.pdf')).toEqual([])
    expect(pathsFromDeepLink('lensquery://settings?path=/tmp/sample.pdf')).toEqual([])
  })

  it('decodes and deduplicates Finder paths', () => {
    const url = 'lensquery://analyze?path=%2FUsers%2Fperson%2FDesktop%2Fsample.pdf&path=%2FUsers%2Fperson%2FDesktop%2Fsample.pdf&path=%2Ftmp%2Ffolder'
    expect(pathsFromDeepLink(url)).toEqual([
      '/Users/person/Desktop/sample.pdf',
      '/tmp/folder',
    ])
  })

  it('caps a Finder selection at 32 paths', () => {
    const query = Array.from({ length: 40 }, (_, index) => `path=%2Ftmp%2F${index}`).join('&')
    expect(pathsFromDeepLink(`lensquery://analyze?${query}`)).toHaveLength(32)
  })
})
