import { describe, expect, it } from 'vitest'

import {
  normalizeProviderBaseUrl,
  providerEndpoint,
  runDirectProvider,
  testDirectProvider,
} from './direct-provider.js'

const settings = {
  detectCustomerLanguage: true,
  responseLanguage: 'zh-CN',
  replyStyle: 'customer-ready',
  customReplyInstruction: '',
}

const request = {
  question: '这是什么？',
  promptId: 'explain',
  analysisMode: 'explain',
  outputFormat: 'adaptive',
  captures: [],
  files: [],
  conversation: [],
}

describe('Electron direct provider adapter', () => {
  it('normalizes endpoints and rejects remote plaintext API URLs', () => {
    expect(providerEndpoint({ kind: 'compatible', baseUrl: 'https://openrouter.ai/api/v1/' })).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(providerEndpoint({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' })).toBe('https://api.anthropic.com/v1/messages')
    expect(normalizeProviderBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1')
    expect(() => normalizeProviderBaseUrl('http://example.com/v1')).toThrow('HTTPS')
    expect(() => normalizeProviderBaseUrl('https://example.com/v1?token=secret')).toThrow('查询参数')
  })

  it('sends OpenAI-compatible multimodal chat requests and reads the answer', async () => {
    let observed
    const result = await runDirectProvider({
      profile: { id: 'custom', name: 'Custom', kind: 'compatible', model: 'MODEL', baseUrl: 'https://HOST/v1', apiKeyRequired: true, secretConfigured: true },
      secret: 'TOKEN',
      request,
      settings,
      fetchImpl: async (url, options) => {
        observed = { url, options, body: JSON.parse(options.body) }
        return new Response(JSON.stringify({ model: 'MODEL', choices: [{ message: { content: '这是一个测试结果。' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      },
    })
    expect(observed.url).toBe('https://host/v1/chat/completions')
    expect(observed.options.headers.authorization).toBe('Bearer TOKEN')
    expect(observed.body.messages.at(-1).content[0].text).toContain('只读分析员')
    expect(result.answer).toBe('这是一个测试结果。')
  })

  it('uses Anthropic Messages headers and response blocks', async () => {
    let headers
    const result = await runDirectProvider({
      profile: { id: 'anthropic', name: 'Anthropic', kind: 'anthropic', model: 'claude', baseUrl: 'https://api.anthropic.com', apiKeyRequired: true, secretConfigured: true },
      secret: 'TOKEN',
      request,
      settings,
      fetchImpl: async (_url, options) => {
        headers = options.headers
        return new Response(JSON.stringify({ model: 'claude', content: [{ type: 'text', text: '已解析。' }] }), { status: 200 })
      },
    })
    expect(headers['x-api-key']).toBe('TOKEN')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(result.answer).toBe('已解析。')
  })

  it('tests a local provider without requiring an API key', async () => {
    const message = await testDirectProvider(
      { id: 'ollama', name: 'Ollama', kind: 'compatible', model: 'qwen3-vl:8b', baseUrl: 'http://localhost:11434/v1', apiKeyRequired: false, secretConfigured: false },
      '',
      { fetchImpl: async () => new Response(JSON.stringify({ data: [{ id: 'qwen3-vl:8b' }] }), { status: 200 }) },
    )
    expect(message).toContain('可见 1 个模型')
  })
})
