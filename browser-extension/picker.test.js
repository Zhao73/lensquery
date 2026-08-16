import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pickerSource = readFileSync(resolve(process.cwd(), 'browser-extension/picker.js'), 'utf8')

describe('LensQuery automatic browser picker', () => {
  it('submits the confirmed target without a prompt composer or mode picker', () => {
    expect(pickerSource).toContain('再点一次自动分析')
    expect(pickerSource).not.toContain('lensquery-annotation-composer')
    expect(pickerSource).not.toContain('analysisMode')
    expect(pickerSource).not.toContain('outputFormat')
    expect(pickerSource).not.toContain('new FormData')
  })
})
