import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..')
const installer = resolve(repositoryRoot, 'scripts/install-electron-macos.sh')

describe.skipIf(process.platform !== 'darwin')('macOS installer terminal', () => {
  it('renders the complete non-interactive path without ANSI control codes', () => {
    const output = execFileSync('/bin/bash', [installer, '--preview-terminal'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        LENSQUERY_INSTALLER_LANG: 'en',
        LENSQUERY_INSTALLER_NONINTERACTIVE: '1',
        PATH: '/usr/bin:/bin',
        TERM: 'dumb',
      },
    })

    expect(output).toContain('LensQuery  Desktop installer')
    expect(output).toContain('01/06  Preflight')
    expect(output).toContain('06/06  Integrations')
    expect(output).toContain('Chrome extension  one-time activation required')
    expect(output).toContain('Ready')
    expect(output).toContain('Next actions')
    expect(output).toContain("open -a 'Google Chrome' 'chrome://extensions'")
    expect(output).toContain('gh api --method PUT /user/starred/Zhao73/lensquery')
    expect(output).not.toContain('\u001B')
  })

  it('follows the Chinese installer locale without changing the workflow', () => {
    const output = execFileSync('/bin/bash', [installer, '--preview-terminal'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        CI: '1',
        NO_COLOR: '1',
        LENSQUERY_INSTALLER_LANG: 'zh',
        LENSQUERY_INSTALLER_NONINTERACTIVE: '1',
        PATH: '/usr/bin:/bin',
        TERM: 'dumb',
      },
    })

    expect(output).toContain('LensQuery  桌面安装程序')
    expect(output).toContain('01/06  安装检查')
    expect(output).toContain('06/06  系统集成')
    expect(output).toContain('Chrome 扩展：需要一次激活')
    expect(output).toContain('安装完成')
    expect(output).toContain('下一步')
  })
})
