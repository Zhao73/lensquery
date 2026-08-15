import anthropicLogo from '@lobehub/icons-static-svg/icons/anthropic.svg'
import claudeCodeLogo from '@lobehub/icons-static-svg/icons/claudecode-color.svg'
import codexLogo from '@lobehub/icons-static-svg/icons/codex-color.svg'
import deepSeekLogo from '@lobehub/icons-static-svg/icons/deepseek-color.svg'
import fireworksLogo from '@lobehub/icons-static-svg/icons/fireworks-color.svg'
import geminiLogo from '@lobehub/icons-static-svg/icons/gemini-color.svg'
import grokLogo from '@lobehub/icons-static-svg/icons/grok.svg'
import groqLogo from '@lobehub/icons-static-svg/icons/groq.svg'
import lmStudioLogo from '@lobehub/icons-static-svg/icons/lmstudio.svg'
import mistralLogo from '@lobehub/icons-static-svg/icons/mistral-color.svg'
import ollamaLogo from '@lobehub/icons-static-svg/icons/ollama.svg'
import openAiLogo from '@lobehub/icons-static-svg/icons/openai.svg'
import openCodeLogo from '@lobehub/icons-static-svg/icons/opencode.svg'
import openRouterLogo from '@lobehub/icons-static-svg/icons/openrouter-color.svg'
import siliconFlowLogo from '@lobehub/icons-static-svg/icons/siliconcloud-color.svg'
import togetherLogo from '@lobehub/icons-static-svg/icons/together-color.svg'
import xAiLogo from '@lobehub/icons-static-svg/icons/xai.svg'
import { PlugsConnected } from '@phosphor-icons/react'

import type { ProviderProfile } from '../types/domain'

const logos: Record<string, { source: string; monochrome?: boolean }> = {
  'codex-cli': { source: codexLogo },
  'claude-cli': { source: claudeCodeLogo },
  'opencode-cli': { source: openCodeLogo, monochrome: true },
  'grok-cli': { source: grokLogo, monochrome: true },
  openai: { source: openAiLogo, monochrome: true },
  anthropic: { source: anthropicLogo, monochrome: true },
  gemini: { source: geminiLogo },
  xai: { source: xAiLogo, monochrome: true },
  deepseek: { source: deepSeekLogo },
  openrouter: { source: openRouterLogo },
  'groq-cloud': { source: groqLogo, monochrome: true },
  mistral: { source: mistralLogo },
  together: { source: togetherLogo },
  fireworks: { source: fireworksLogo },
  siliconflow: { source: siliconFlowLogo },
  ollama: { source: ollamaLogo, monochrome: true },
  'lm-studio': { source: lmStudioLogo, monochrome: true },
}

export function ProviderLogo({ provider, size = 20 }: { provider?: Pick<ProviderProfile, 'id' | 'name'>; size?: number }) {
  const logo = provider ? logos[provider.id] : undefined
  if (!logo) return <PlugsConnected size={size} weight="regular" aria-hidden="true" />
  return (
    <img
      alt=""
      aria-hidden="true"
      className={logo.monochrome ? 'provider-brand-logo monochrome' : 'provider-brand-logo'}
      height={size}
      src={logo.source}
      width={size}
    />
  )
}
