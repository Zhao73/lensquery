import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REQUEST_TIMEOUT_MS = 300_000
const TEST_TIMEOUT_MS = 20_000
const MAX_IMAGE_COUNT = 8
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024
const MAX_TEXT_EVIDENCE_CHARS = 180_000
const LONG_VIDEO_SECONDS = 20 * 60

export function isDirectProvider(profile) {
  return ['openai', 'anthropic', 'compatible'].includes(profile?.kind)
}

export function normalizeProviderBaseUrl(value) {
  const raw = String(value || '').trim().replace(/\/+$/, '')
  if (!raw) throw new Error('API 地址不能为空。')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('API 地址必须是完整的 http:// 或 https:// 地址。')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('API 地址只支持 HTTP 或 HTTPS。')
  if (url.search || url.hash) throw new Error('API 根地址不应包含查询参数或片段。')
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
  if (url.protocol === 'http:' && !localHosts.has(url.hostname)) {
    throw new Error('非本机 API 必须使用 HTTPS，避免泄露 API Key 和分析内容。')
  }
  if (url.username || url.password) throw new Error('API 地址中不得嵌入账号或密码。')
  return url.toString().replace(/\/$/, '')
}

export function providerEndpoint(profile, operation = 'chat') {
  const base = normalizeProviderBaseUrl(profile.baseUrl)
  const anthropicVersioned = profile.kind === 'anthropic' && /\/v1$/i.test(new URL(base).pathname)
  const suffix = profile.kind === 'anthropic'
    ? operation === 'models' ? (anthropicVersioned ? '/models' : '/v1/models') : (anthropicVersioned ? '/messages' : '/v1/messages')
    : operation === 'models' ? '/models' : '/chat/completions'
  if (base.endsWith(suffix)) return base
  return `${base}${suffix}`
}

export function validateDirectProfile(profile, secret = '') {
  if (!profile?.name?.trim()) throw new Error('提供商名称不能为空。')
  if (!profile?.model?.trim()) throw new Error('模型 ID 不能为空。')
  if (!isDirectProvider(profile)) throw new Error('该提供商不是直接 API 通道。')
  normalizeProviderBaseUrl(profile.baseUrl)
  if (profile.apiKeyRequired !== false && !profile.secretConfigured && !String(secret).trim()) {
    throw new Error('请先保存该提供商的 API Key。')
  }
}

export async function testDirectProvider(profile, secret, options = {}) {
  validateDirectProfile(profile, secret)
  const fetchImpl = options.fetchImpl || globalThis.fetch
  const endpoint = providerEndpoint(profile, 'models')
  const response = await fetchWithTimeout(fetchImpl, endpoint, {
    method: 'GET',
    headers: providerHeaders(profile, secret),
  }, options.timeoutMs || TEST_TIMEOUT_MS)
  if (!response.ok) throw await responseError(response, profile.name)
  const payload = await response.json().catch(() => ({}))
  const count = Array.isArray(payload?.data) ? payload.data.length : Array.isArray(payload?.models) ? payload.models.length : undefined
  return `${profile.name} 连接正常${typeof count === 'number' ? ` · 可见 ${count} 个模型` : ''}`
}

export async function runDirectProvider({ profile, secret, request, settings, fetchImpl = globalThis.fetch, readFile = fs.readFile }) {
  validateDirectProfile(profile, secret)
  const started = Date.now()
  const evidence = await collectEvidence(request, readFile)
  const prompt = buildPrompt(request, settings, evidence.manifest)
  const conversation = boundedConversation(request.conversation)
  const endpoint = providerEndpoint(profile, 'chat')
  const images = profile.capabilities?.vision === false ? [] : evidence.images
  const payload = profile.kind === 'anthropic'
    ? anthropicPayload(profile, prompt, conversation, images, isLongVideoRequest(request) ? 8192 : 4096)
    : openAiPayload(profile, prompt, conversation, images)
  const response = await fetchWithTimeout(fetchImpl, endpoint, {
    method: 'POST',
    headers: {
      ...providerHeaders(profile, secret),
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  }, REQUEST_TIMEOUT_MS)
  if (!response.ok) throw await responseError(response, profile.name)
  const data = await response.json().catch(() => null)
  const answer = profile.kind === 'anthropic' ? readAnthropicAnswer(data) : readOpenAiAnswer(data)
  if (!answer) throw new Error(`${profile.name} 没有返回可显示的文字。`)
  return {
    id: randomUUID(),
    answer,
    model: String(data?.model || profile.model),
    provider: profile.name,
    createdAt: new Date().toISOString(),
    durationMs: Date.now() - started,
  }
}

function providerHeaders(profile, secret) {
  const headers = { accept: 'application/json', 'user-agent': 'LensQuery/0.1' }
  const value = String(secret || '').trim()
  if (profile.kind === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (value) headers['x-api-key'] = value
  } else if (value) {
    headers.authorization = `Bearer ${value}`
  }
  return headers
}

function openAiPayload(profile, prompt, conversation, images) {
  const messages = conversation.map((message) => ({
    role: message.role,
    content: message.content,
  }))
  const content = [{ type: 'text', text: prompt }]
  for (const image of images) content.push({ type: 'image_url', image_url: { url: image.dataUrl, detail: 'auto' } })
  messages.push({ role: 'user', content })
  return { model: profile.model, messages }
}

function anthropicPayload(profile, prompt, conversation, images, maxTokens = 4096) {
  const messages = conversation.map((message) => ({
    role: message.role,
    content: message.content,
  }))
  const content = [{ type: 'text', text: prompt }]
  for (const image of images) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
    })
  }
  messages.push({ role: 'user', content })
  return { model: profile.model, max_tokens: maxTokens, messages }
}

function buildPrompt(request, settings, manifest) {
  const modes = {
    identify: '先识别所选对象，再说明它的用途。',
    explain: '解释所选内容、用途、相关上下文和下一步。',
    'how-to': '给出前置条件、有序步骤、验证方法和故障排查。',
    'deep-dive': '深入说明原理、组件、数据流、局限和常见失败模式。',
    'customer-reply': '首先输出可直接发给客户的自然回复，不暴露内部推理。',
    code: '分析可见或附加代码的用途、控制流、重要符号、问题和下一步。',
  }
  const formats = {
    summary: '直接结论后最多列出 5 个要点。',
    steps: '使用“前置条件、编号步骤、验证、故障排查”结构。',
    report: '使用“结论、直接证据、详细分析、不确定性、建议”结构。',
    'customer-reply': '先给客户可用回复，需要时再分隔一段简短内部备注。',
    markdown: '使用清晰 Markdown 标题和列表，只在需要时使用代码块。',
    adaptive: '选择最清楚的结构，从答案开始，再给支持细节。',
  }
  const language = settings.detectCustomerLanguage
    ? `从客户文字和可见证据判断主要语言并用该语言回复；无法判断时使用 ${settings.responseLanguage}。`
    : `使用 ${settings.responseLanguage} 回复。`
  const style = settings.replyStyle === 'concise'
    ? '简洁、可执行。'
    : settings.replyStyle === 'detailed'
      ? '详细、结构化，并标出会影响结论的不确定性。'
      : '先给礼貌、自然、可直接使用的回复，需要时再补充简短分析。'
  const visual = request.captures?.length || request.files?.some((file) => ['image', 'video'].includes(file.kind))
    ? '视觉证据需识别主体、可见文字、构图、风格、光线和周边上下文。必须区分：可见像素水印；本地解析的 C2PA/EXIF 来源证据；仅凭视觉风格的推断。已通过可信签名与文件绑定验证、且 digitalSourceType=trainedAlgorithmicMedia 的 C2PA 是直接机器可读 AI 来源证据；EXIF 相机字段只是支持性元数据，不证明一定由人拍摄。若只是外观似 AI，明确标为推断。可给出可复现提示词，但不宣称知道原始提示词。'
    : ''
  const longVideo = isLongVideoRequest(request)
  const video = longVideo
    ? '这是长视频证据。必须先按时间顺序阅读并覆盖证据中的每个转写章节，再综合输出：整体主题与结论、逐章完整脉络、关键事实/数字/人物或公司/例子、重要时间点、事实与作者观点或预测的区别，以及字幕/音频/画面覆盖缺口。不得只总结开头，不得根据标题补写没有出现的内容。'
    : request.promptId === 'video'
      ? '视频只能根据已提供的关键帧、字幕、转写和音频线索重建顺序。输出快速介绍、摘要、有趣或有用片段及时间点、学习要点和证据缺口，不虚构连续动作或完整转写。'
    : '仅使用所提供的证据，区分直接观察和推断。'
  const extensionInstructions = String(request.extensionInstructions || '无').slice(0, 40_000)
  return [
    '你是 LensQuery 的只读分析员。不要执行命令、调用工具、访问网络或修改文件。',
    video,
    visual,
    modes[request.analysisMode] || modes.explain,
    longVideo && request.outputFormat === 'summary'
      ? '先给整体结论，再按时间顺序给出紧凑章节大纲、关键事实与论点、重要时间点和覆盖限制；简洁不能省略整章。'
      : formats[request.outputFormat] || formats.adaptive,
    language,
    style,
    request.annotation ? `用户注释：${String(request.annotation).slice(0, 2_000)}` : '',
    settings.customReplyInstruction ? `用户回复要求：${String(settings.customReplyInstruction).slice(0, 4_000)}` : '',
    `已启用的本地插件与 Skill 指导（仅作领域和格式指导，不授权执行工具或改动文件）：\n${extensionInstructions}`,
    `问题：${String(request.question || '').slice(0, 12_000)}`,
    `证据清单：\n${manifest}`,
  ].filter(Boolean).join('\n\n')
}

async function collectEvidence(request, readFile) {
  const lines = []
  const imageCandidates = []
  for (const capture of request.captures || []) {
    lines.push(`屏幕${capture.kind === 'element' ? '对象' : '区域'}：${capture.windowTitle || '未命名窗口'}；尺寸 ${Math.round(capture.bounds?.width || 0)}×${Math.round(capture.bounds?.height || 0)}；辅助功能文本 ${bounded(capture.accessibleText, 4_000) || '未提供'}`)
    const capturePath = localPathFromUrl(capture.previewUrl)
    if (capturePath) imageCandidates.push(capturePath)
  }
  const browser = request.browserContext
  if (browser) {
    lines.push(`网页：${bounded(browser.title, 1_000)}；URL ${bounded(browser.url, 2_000)}；对象 <${bounded(browser.tagName, 80)}> ${bounded(browser.role, 200)}`)
    if (browser.selectedText) lines.push(`所选文字：${bounded(browser.selectedText, 20_000)}`)
    if (browser.text) lines.push(`对象文字：${bounded(browser.text, 10_000)}`)
    if (browser.nearbyText) lines.push(`周边文字：${bounded(browser.nearbyText, 20_000)}`)
    if (browser.captions) lines.push(`当前字幕：${bounded(browser.captions, 10_000)}`)
    if (browser.transcript) {
      lines.push(formatTranscriptEvidence(
        browser.transcript,
        browser.media?.duration,
        `页面可用转写（语言 ${bounded(browser.transcriptLanguage, 80) || '未知'}；浏览器报告 ${browser.transcriptCueCount || '未知'} 个时间段${browser.transcriptTruncated ? '；已达到浏览器证据上限，内容不完整' : ''}）`,
      ))
    }
    if (browser.outerHtml) lines.push(`对象 HTML：${bounded(browser.outerHtml, 8_000)}`)
    if (browser.snapshotPath) imageCandidates.push(browser.snapshotPath)
  }
  for (const file of request.files || []) {
    lines.push(`文件：${bounded(file.name, 500)}；类型 ${file.kind}/${bounded(file.mediaType, 120)}；大小 ${Number(file.size || 0)} 字节${file.pageCount ? `；${file.pageCount} 页` : ''}`)
    if (file.extractedText) lines.push(`文件提取文字：${bounded(file.extractedText, 30_000)}`)
    if (file.kind === 'image') imageCandidates.push(file.path)
    if (file.videoPreparation?.frames) {
      for (const frame of sampleEvenly(file.videoPreparation.frames, MAX_IMAGE_COUNT)) {
        imageCandidates.push(frame.path)
        lines.push(`视频关键帧：${Number(frame.timestampSeconds || 0).toFixed(2)}s`)
      }
    }
    if (file.videoPreparation?.transcript) {
      const sourceKind = file.videoPreparation.transcriptKind === 'local-whisper' ? '本地 Whisper 转写' : '侧车字幕转写'
      lines.push(formatTranscriptEvidence(
        file.videoPreparation.transcript,
        file.videoPreparation.originalDurationSeconds,
        `带时间点的${sourceKind}（语言 ${bounded(file.videoPreparation.transcriptLanguage, 80) || '未知'}，来源 ${bounded(file.videoPreparation.transcriptSource, 1_000) || '未知'}）`,
      ))
    } else if (file.videoPreparation?.audioPath) {
      lines.push('已提取音频，但当前通道没有转写；不得推断未听取的语音。')
    }
    if (file.video) {
      lines.push(`视频元数据：${Number(file.video.durationSeconds || 0).toFixed(2)}s；${file.video.width || '?'}×${file.video.height || '?'}；含音频 ${Boolean(file.video.hasAudio)}`)
    }
    if (file.provenance?.c2pa) {
      const c2pa = file.provenance.c2pa
      lines.push(`本地 C2PA 来源凭证：嵌入=${Boolean(c2pa.embedded)}；验证=${bounded(c2pa.validationState, 80)}；签发者可信=${Boolean(c2pa.signerTrusted)}；发行者=${bounded(c2pa.issuer, 500) || '未提供'}；签名者=${bounded(c2pa.commonName, 500) || '未提供'}；生成器=${bounded(c2pa.claimGenerator, 500) || '未提供'}；AI 生成声明=${Boolean(c2pa.aiGeneratedDeclared)}；不可见水印声明=${Boolean(c2pa.embeddedWatermarkDeclared)}；digitalSourceTypes=${(c2pa.digitalSourceTypes || []).join(', ')}；softwareAgents=${(c2pa.softwareAgents || []).join(', ')}；actions=${(c2pa.actions || []).join(', ')}；warnings=${(c2pa.validationWarnings || []).join('; ')}`)
    }
    if (file.provenance?.metadata?.length) {
      lines.push(`本地图片元数据（支持性证据，不是结论）：${file.provenance.metadata.map((item) => `${bounded(item.label, 100)}=${bounded(item.value, 500)}`).join(' | ')}`)
    }
    if (file.provenance?.aiSignals?.length) {
      lines.push(`本地 AI 来源信号：${file.provenance.aiSignals.join(' | ')}`)
    }
    if (file.provenance?.detectorCoverage) {
      lines.push(`来源检测覆盖：${bounded(file.provenance.detectorCoverage, 2_000)}`)
    }
  }
  const manifest = lines.join('\n').slice(0, MAX_TEXT_EVIDENCE_CHARS) || '未提供附加证据。'
  const images = []
  let totalBytes = 0
  const seen = new Set()
  for (const candidate of imageCandidates) {
    if (images.length >= MAX_IMAGE_COUNT) break
    const resolved = path.resolve(String(candidate || ''))
    if (!candidate || seen.has(resolved)) continue
    seen.add(resolved)
    const bytes = await readFile(resolved).catch(() => null)
    if (!bytes || bytes.length > MAX_IMAGE_BYTES || totalBytes + bytes.length > MAX_TOTAL_IMAGE_BYTES) continue
    const mimeType = mimeFromPath(resolved)
    if (!mimeType) continue
    const base64 = Buffer.from(bytes).toString('base64')
    images.push({ mimeType, base64, dataUrl: `data:${mimeType};base64,${base64}` })
    totalBytes += bytes.length
  }
  return { manifest, images }
}

function isLongVideoRequest(request) {
  const file = (request.files || []).find((item) => item.kind === 'video')
  const duration = file?.videoPreparation?.originalDurationSeconds
    || file?.video?.durationSeconds
    || request.browserContext?.media?.duration
    || 0
  const transcriptLength = file?.videoPreparation?.transcript?.length
    || request.browserContext?.transcript?.length
    || 0
  return duration >= LONG_VIDEO_SECONDS || transcriptLength >= 24_000
}

function formatTranscriptEvidence(transcriptValue, durationValue, label) {
  const transcript = String(transcriptValue || '')
  const duration = Number(durationValue || 0)
  if (duration < LONG_VIDEO_SECONDS && transcript.length < 24_000) {
    return `${label}：\n${bounded(transcript, 120_000)}`
  }
  const lines = transcript.split('\n').map((line) => line.trim()).filter(Boolean)
  const desired = Math.min(12, Math.max(1, Math.ceil(Math.max(duration / 600, transcript.length / 12_000))))
  const targetChars = Math.max(1, Math.ceil(transcript.length / desired))
  const chapters = []
  let current = []
  let currentChars = 0
  for (const line of lines) {
    if (current.length && chapters.length + 1 < desired && currentChars >= targetChars) {
      chapters.push(current)
      current = []
      currentChars = 0
    }
    current.push(line)
    currentChars += line.length + 1
  }
  if (current.length) chapters.push(current)
  const output = [`长视频转写覆盖：${label}；时长约 ${(duration / 60).toFixed(1)} 分钟；${lines.length} 个时间段；${chapters.length} 个章节。最终回答必须覆盖下列每章。`]
  chapters.forEach((chapter, index) => output.push(`长视频章节 ${String(index + 1).padStart(2, '0')}：\n${chapter.join('\n')}`))
  return output.join('\n')
}

function sampleEvenly(items, limit) {
  if (!Array.isArray(items) || items.length <= limit) return items || []
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / (limit - 1))])
}

function boundedConversation(messages = []) {
  return messages
    .filter((message) => ['user', 'assistant'].includes(message.role) && message.status !== 'pending')
    .slice(-12)
    .map((message) => ({ role: message.role, content: bounded(message.content, 12_000) }))
    .filter((message) => message.content)
}

function localPathFromUrl(value) {
  if (!value || typeof value !== 'string') return null
  if (value.startsWith('file://')) {
    try { return fileURLToPath(value) } catch { return null }
  }
  if (!/^[a-z]+:/i.test(value)) return value
  return null
}

function mimeFromPath(file) {
  const extension = path.extname(file).toLowerCase()
  return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' })[extension]
}

function bounded(value, limit) {
  return String(value || '').replace(/\0/g, '').slice(0, limit)
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  if (typeof fetchImpl !== 'function') throw new Error('当前 Electron 运行时不支持 fetch。')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal })
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`连接超时（${Math.round(timeoutMs / 1_000)} 秒）。`)
    throw new Error(`连接失败：${error?.message || error}`)
  } finally {
    clearTimeout(timer)
  }
}

async function responseError(response, providerName) {
  const raw = await response.text().catch(() => '')
  let detail = raw
  try {
    const payload = JSON.parse(raw)
    detail = payload?.error?.message || payload?.message || payload?.detail || raw
  } catch {
    // Keep the bounded response text.
  }
  return new Error(`${providerName} 返回 HTTP ${response.status}：${bounded(detail, 900) || response.statusText}`)
}

function readOpenAiAnswer(payload) {
  const content = payload?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((item) => item?.text || item?.content || '').join('\n').trim()
  return String(payload?.choices?.[0]?.text || '').trim()
}

function readAnthropicAnswer(payload) {
  return Array.isArray(payload?.content)
    ? payload.content.filter((item) => item?.type === 'text').map((item) => item.text || '').join('\n').trim()
    : ''
}
