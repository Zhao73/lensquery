import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createExtensionManager, parseExtensionSource } from './extension-manager.js'

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
  it('parses GitHub tree URLs and safe repository subdirectories', () => {
    expect(parseExtensionSource('https://github.com/openai/skills/tree/main/skills/.curated/pdf')).toEqual({
      kind: 'git',
      repositoryUrl: 'https://github.com/openai/skills.git',
      ref: 'main',
      subdirectory: 'skills/.curated/pdf',
    })
    expect(parseExtensionSource('https://github.com/openai/skills.git#skills/.curated/transcribe')).toMatchObject({
      repositoryUrl: 'https://github.com/openai/skills.git',
      subdirectory: 'skills/.curated/transcribe',
    })
    expect(() => parseExtensionSource('https://github.com/openai/skills.git#../outside')).toThrow('路径无效')
  })

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

  it('can install a reviewed skill without enabling its prompt instructions', async () => {
    const { root, manager } = await fixture()
    const source = path.join(root, 'reviewed-skill')
    await fs.mkdir(path.join(source, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), `---\nname: reviewed-media\ndescription: Reviewed media workflow.\n---\n\nUse the supplied media evidence.\n`)
    await fs.writeFile(path.join(source, 'scripts', 'helper.py'), 'print("manual only")\n')

    const installed = await manager.install({ kind: 'skill', source, enabled: false })
    expect(installed.enabled).toBe(false)
    expect(installed.permissions).toContain('bundled-scripts-disabled')
    expect(await manager.collectInstructions()).toBeUndefined()
  })

  it('reads folded YAML descriptions instead of displaying the block marker', async () => {
    const { root, manager } = await fixture()
    const source = path.join(root, 'folded-skill')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), `---\nname: folded-skill\ndescription: >\n  Analyze the selected object and\n  explain the surrounding context.\n---\n\n# Instructions\n`)

    const installed = await manager.install({ kind: 'skill', source })
    expect(installed.description).toBe('Analyze the selected object and explain the surrounding context.')
  })
})
