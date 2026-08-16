import type { FileEvidence, QuerySession } from '../types/domain'

const AI_SOFTWARE = /gpt.image|dall.?e|midjourney|stable.?diffusion|comfyui|firefly|imagen|nano.?banana|seedance|sora|veo|runway|pika|kling|可灵|即梦|豆包|万相|混元|海螺/i
const AI_METADATA = /AIGC|trainedAlgorithmic|generative.?AI|AI.?generated|synthetic.?media|人工智能生成|生成式人工智能/i
const AI_ANSWER = /AI\s*来源判断|AI来源判断|verified-ai|verified-ai-edited|declared-ai-untrusted|已验证\s*AI\s*来源/i

export function fileHasMaterialAiEvidence(file: FileEvidence) {
  const provenance = file.provenance
  if (!provenance) return false
  if (['verified-ai', 'verified-ai-edited', 'declared-ai'].includes(provenance.aiOriginStatus ?? '')) return true
  if (provenance.promptEvidence?.length || provenance.aiSignals.length) return true
  if (provenance.undisclosedWatermarkScan?.status === 'candidate-observed') return true
  const c2pa = provenance.c2pa
  if (c2pa?.aiGeneratedDeclared || c2pa?.embeddedWatermarkDeclared) return true
  if (c2pa?.digitalSourceTypes.some((value) => /trainedAlgorithmic|compositeSynthetic|algorithmicMedia/i.test(value))) return true
  if (c2pa?.softwareAgents.some((value) => AI_SOFTWARE.test(value))) return true
  if (provenance.metadata.some((item) => AI_METADATA.test(`${item.label} ${item.value}`))) return true
  return provenance.watermarkCoverage?.regulatoryEvidence.some(({ status }) => status === 'two-layer-evidence-observed') ?? false
}

export function sessionHasAiOriginRelevance(session: QuerySession) {
  if (session.files.some(fileHasMaterialAiEvidence)) return true
  return session.messages.some((message) => message.role === 'assistant' && message.status === 'complete' && AI_ANSWER.test(message.content))
}
