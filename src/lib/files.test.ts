import { describe, expect, it } from 'vitest'
import { formatBytes, normalizeBrowserFiles } from './files'

describe('file helpers', () => {
  it('classifies supported browser files', () => {
    const files = normalizeBrowserFiles([
      new File(['image'], 'capture.png', { type: 'image/png' }),
      new File(['pdf'], 'brief.pdf', { type: 'application/pdf' }),
      new File(['hello'], 'notes.md', { type: '' }),
    ])

    expect(files.map(({ kind }) => kind)).toEqual(['image', 'pdf', 'text'])
  })

  it('formats byte sizes for the interface', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})

