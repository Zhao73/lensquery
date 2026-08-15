import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createExtensionManager } from './extension-manager.js'

const temporaryRoots = []

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lensquery-extension-test-'))
  temporaryRoots.push(root)
  const userData = path.join(root, 'user-data')
  const codexSkills = path.join(root, 'codex-skills')
  const agentSkills = path.join(root, 'agent-skills')
  const manager = createExtensionManager(userData, {
    codexSkillRoot: codexSkills,
    agentSkillRoot: agentSkills,
  })
  return { root, userData, codexSkills, agentSkills, manager }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('Electron extension manager', () => {
  it('installs, enables, reads, and disables a Codex-compatible skill', async () => {
    const { root, manager } = await fixture()
    const source = path.join(root, 'source-skill')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), `---\nname: customer-helper\ndescription: Writes clear customer answers.\nversion: 1.2.0\n---\n\nAlways begin with the direct answer.\n`)

    const installed = await manager.install({ kind: 'skill', source })
    expect(installed).toMatchObject({ id: 'customer-helper', enabled: true, kind: 'skill' })
    expect((await manager.list()).find(({ key }) => key === installed.key)?.enabled).toBe(true)
    expect(await manager.collectInstructions()).toContain('Always begin with the direct answer.')

    await manager.setEnabled(installed.key, false)
    expect(await manager.collectInstructions()).toBeUndefined()
  })

  it('installs a bounded prompt plugin from its manifest', async () => {
    const { root, manager } = await fixture()
    const source = path.join(root, 'source-plugin')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'lensquery.plugin.json'), JSON.stringify({
      id: 'image-explainer',
      name: 'Image Explainer',
      version: '0.3.0',
      description: 'Adds an image explanation contract.',
      entry: 'PLUGIN.md',
      permissions: ['prompt-context'],
    }))
    await fs.writeFile(path.join(source, 'PLUGIN.md'), 'Describe direct visual evidence before inference.')

    const installed = await manager.install({ kind: 'plugin', source })
    expect(installed.permissions).toEqual(['prompt-context'])
    expect(await manager.collectInstructions()).toContain('Describe direct visual evidence before inference.')
  })

  it('rejects symbolic links inside install packages', async () => {
    if (process.platform === 'win32') return
    const { root, manager } = await fixture()
    const source = path.join(root, 'unsafe-skill')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), '# Unsafe')
    await fs.symlink('/tmp', path.join(source, 'outside'))

    await expect(manager.install({ kind: 'skill', source })).rejects.toThrow('符号链接')
  })
})
