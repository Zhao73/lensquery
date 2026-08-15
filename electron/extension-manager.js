import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const MAX_PACKAGE_FILES = 800
const MAX_PACKAGE_BYTES = 32 * 1024 * 1024
const MAX_INSTRUCTION_CHARS = 40_000
const MAX_ONE_INSTRUCTION_CHARS = 12_000

export function createExtensionManager(userDataPath, options = {}) {
  const pluginRoot = options.pluginRoot || path.join(userDataPath, 'plugins')
  const codexSkillRoot = options.codexSkillRoot || path.join(os.homedir(), '.codex', 'skills')
  const agentSkillRoot = options.agentSkillRoot || path.join(os.homedir(), '.agents', 'skills')
  const statePath = path.join(userDataPath, 'extensions-state.json')

  async function ensureRoots() {
    await Promise.all([
      fs.mkdir(pluginRoot, { recursive: true }),
      fs.mkdir(codexSkillRoot, { recursive: true }),
      fs.mkdir(path.dirname(statePath), { recursive: true }),
    ])
  }

  async function list() {
    await ensureRoots()
    const state = await readJson(statePath, { enabled: {} })
    const packages = [
      ...(await listDirectoryPackages(pluginRoot, 'plugin', 'lensquery', true)),
      ...(await listDirectoryPackages(codexSkillRoot, 'skill', 'codex', true)),
      ...(await listDirectoryPackages(agentSkillRoot, 'skill', 'agents', false)),
    ]
    return packages
      .map((item) => ({
        ...item,
        enabled: state.enabled[item.key] ?? false,
      }))
      .sort((left, right) => left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name))
  }

  async function install({ kind, source }) {
    if (kind !== 'plugin' && kind !== 'skill') throw new Error('只支持安装 plugin 或 skill。')
    if (!source || typeof source !== 'string') throw new Error('安装来源为空。')
    await ensureRoots()
    const temporaryRoot = path.join(userDataPath, 'install-staging', randomUUID())
    await fs.mkdir(temporaryRoot, { recursive: true })
    try {
      const unpackedSource = isGitSource(source)
        ? await cloneRepository(source, path.join(temporaryRoot, 'repository'))
        : path.resolve(source)
      const packageRoot = await findPackageRoot(unpackedSource, kind)
      const metadata = await inspectPackage(packageRoot, kind, 'installed', true)
      if (!metadata) throw new Error(kind === 'skill' ? '所选目录中没有 SKILL.md。' : '所选目录中没有 lensquery.plugin.json。')
      const destinationRoot = kind === 'plugin' ? pluginRoot : codexSkillRoot
      const destination = path.join(destinationRoot, metadata.id)
      const staged = path.join(temporaryRoot, 'package')
      await secureCopyDirectory(packageRoot, staged)
      const backup = `${destination}.backup-${randomUUID()}`
      const destinationExists = await exists(destination)
      if (destinationExists) await fs.rename(destination, backup)
      try {
        await fs.rename(staged, destination)
      } catch (error) {
        if (destinationExists && await exists(backup)) await fs.rename(backup, destination)
        throw error
      }
      if (destinationExists) await fs.rm(backup, { recursive: true, force: true })
      const installed = await inspectPackage(destination, kind, kind === 'plugin' ? 'lensquery' : 'codex', true)
      if (!installed) throw new Error('安装后的扩展包校验失败。')
      await updateEnabled(installed.key, true)
      return { ...installed, enabled: true }
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true })
    }
  }

  async function setEnabled(key, enabled) {
    const packages = await list()
    const target = packages.find((item) => item.key === key)
    if (!target) throw new Error('没有找到该扩展。')
    await updateEnabled(key, Boolean(enabled))
    return { ...target, enabled: Boolean(enabled) }
  }

  async function remove(key) {
    const packages = await list()
    const target = packages.find((item) => item.key === key)
    if (!target) throw new Error('没有找到该扩展。')
    if (!target.managed) throw new Error('该 Skill 来自外部目录，请在它的来源中管理。')
    await updateEnabled(key, false)
    return target
  }

  async function collectInstructions() {
    const enabled = (await list()).filter((item) => item.enabled && item.instructionPath)
    const blocks = []
    let total = 0
    for (const item of enabled) {
      if (total >= MAX_INSTRUCTION_CHARS) break
      const raw = await fs.readFile(item.instructionPath, 'utf8').catch(() => '')
      if (!raw) continue
      const remaining = MAX_INSTRUCTION_CHARS - total
      const body = raw.slice(0, Math.min(MAX_ONE_INSTRUCTION_CHARS, remaining))
      blocks.push(`## ${item.kind === 'skill' ? 'Skill' : 'Plugin'}: ${item.name}\n${body}`)
      total += body.length
    }
    return blocks.join('\n\n') || undefined
  }

  async function updateEnabled(key, enabled) {
    const state = await readJson(statePath, { enabled: {} })
    state.enabled[key] = enabled
    await writeJsonAtomic(statePath, state)
  }

  return { list, install, setEnabled, remove, collectInstructions }
}

async function listDirectoryPackages(root, kind, origin, managed) {
  if (!await exists(root)) return []
  const entries = await fs.readdir(root, { withFileTypes: true })
  const packages = []
  for (const entry of entries.slice(0, 1_000)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const item = await inspectPackage(path.join(root, entry.name), kind, origin, managed).catch(() => null)
    if (item) packages.push(item)
  }
  return packages
}

async function inspectPackage(directory, kind, origin, managed) {
  if (kind === 'skill') {
    const instructionPath = path.join(directory, 'SKILL.md')
    if (!await exists(instructionPath)) return null
    const content = await fs.readFile(instructionPath, 'utf8')
    const frontmatter = parseFrontmatter(content)
    const id = safeId(frontmatter.name || path.basename(directory))
    return {
      key: extensionKey(kind, origin, id, directory),
      id,
      kind,
      name: frontmatter.name || titleFromId(id),
      description: frontmatter.description || firstUsefulLine(content) || '本地 Codex 兼容 Skill',
      version: frontmatter.version || 'local',
      author: frontmatter.author,
      origin,
      managed,
      installPath: directory,
      instructionPath,
      permissions: ['prompt-context'],
      compatibility: ['LensQuery', 'Codex CLI'],
    }
  }

  const manifestPath = path.join(directory, 'lensquery.plugin.json')
  if (!await exists(manifestPath)) return null
  const manifest = await readJson(manifestPath, null)
  if (!manifest || typeof manifest !== 'object') throw new Error('插件清单格式错误。')
  const id = safeId(manifest.id || path.basename(directory))
  const entry = String(manifest.entry || 'PLUGIN.md')
  if (path.isAbsolute(entry) || entry.split(/[\\/]/).includes('..')) throw new Error('插件 entry 必须位于插件目录内。')
  const instructionPath = path.join(directory, entry)
  if (!await exists(instructionPath)) throw new Error(`插件入口不存在: ${entry}`)
  return {
    key: extensionKey(kind, origin, id, directory),
    id,
    kind,
    name: String(manifest.name || titleFromId(id)).slice(0, 120),
    description: String(manifest.description || '本地 LensQuery 插件').slice(0, 500),
    version: String(manifest.version || '0.0.0').slice(0, 40),
    author: manifest.author ? String(manifest.author).slice(0, 120) : undefined,
    origin,
    managed,
    installPath: directory,
    instructionPath,
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions.map(String).slice(0, 24) : ['prompt-context'],
    compatibility: ['LensQuery'],
  }
}

async function findPackageRoot(source, kind) {
  const direct = await inspectPackage(source, kind, 'source', false).catch(() => null)
  if (direct) return source
  const entries = await fs.readdir(source, { withFileTypes: true })
  const candidates = []
  for (const entry of entries.slice(0, 80)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const candidate = path.join(source, entry.name)
    if (await inspectPackage(candidate, kind, 'source', false).catch(() => null)) candidates.push(candidate)
  }
  if (candidates.length === 1) return candidates[0]
  if (candidates.length > 1) throw new Error('来源中包含多个可安装包，请选择具体子目录。')
  throw new Error(kind === 'skill' ? '没有找到 SKILL.md。' : '没有找到 lensquery.plugin.json。')
}

async function secureCopyDirectory(source, destination) {
  let fileCount = 0
  let byteCount = 0
  async function copyDirectory(from, to) {
    await fs.mkdir(to, { recursive: true })
    const entries = await fs.readdir(from, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.DS_Store') continue
      const input = path.join(from, entry.name)
      const output = path.join(to, entry.name)
      if (entry.isSymbolicLink()) throw new Error('扩展包中不允许符号链接。')
      if (entry.isDirectory()) {
        await copyDirectory(input, output)
        continue
      }
      if (!entry.isFile()) continue
      const stat = await fs.stat(input)
      fileCount += 1
      byteCount += stat.size
      if (fileCount > MAX_PACKAGE_FILES || byteCount > MAX_PACKAGE_BYTES) throw new Error('扩展包超出 800 个文件或 32 MB 限制。')
      await fs.copyFile(input, output)
    }
  }
  await copyDirectory(source, destination)
}

async function cloneRepository(url, destination) {
  await new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--depth', '1', '--filter=blob:none', '--', url, destination], {
      stdio: ['ignore', 'ignore', 'pipe'],
      timeout: 60_000,
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += String(chunk).slice(0, 4_000) })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`Git 下载失败: ${stderr.trim() || `exit ${code}`}`)))
  })
  return destination
}

function parseFrontmatter(content) {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return {}
  const result = {}
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '')
    if (['name', 'description', 'version', 'author'].includes(key)) result[key] = value
  }
  return result
}

function firstUsefulLine(content) {
  return content
    .replace(/^---[\s\S]*?---/, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find((line) => line.length > 12)
}

function safeId(value) {
  const id = String(value).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  if (!id || id === '.' || id === '..') throw new Error('扩展 ID 无效。')
  return id
}

function titleFromId(value) {
  return value.split(/[-_.]/).filter(Boolean).map((part) => part[0]?.toUpperCase() + part.slice(1)).join(' ')
}

function extensionKey(kind, origin, id, directory) {
  const hash = createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 10)
  return `${kind}:${origin}:${id}:${hash}`
}

function isGitSource(value) {
  return /^(https?:\/\/|git@|ssh:\/\/)/i.test(value) || value.endsWith('.git')
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, file)
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}
