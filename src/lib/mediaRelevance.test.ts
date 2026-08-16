import { describe, expect, it } from 'vitest'

import type { FileEvidence, QuerySession } from '../types/domain'
import { fileHasMaterialAiEvidence, sessionHasAiOriginRelevance } from './mediaRelevance'

function imageFile(provenance?: FileEvidence['provenance']): FileEvidence {
  return { id: 'image', name: 'photo.jpg', path: '/tmp/photo.jpg', mediaType: 'image/jpeg', size: 1, kind: 'image', provenance }
}

function session(files: FileEvidence[], answer = ''): QuerySession {
  return {
    id: 'session', title: 'Photo', createdAt: '', updatedAt: '', providerId: 'codex-cli', sourceLabel: 'photo.jpg', sourceKind: 'file',
    captures: [], files, analysisMode: 'explain', outputFormat: 'adaptive',
    messages: answer ? [{ id: 'answer', role: 'assistant', content: answer, createdAt: '', status: 'complete' }] : [],
  }
}

describe('AI-origin relevance', () => {
  it('keeps ordinary media free of AI-origin controls', () => {
    const file = imageFile({
      metadata: [{ label: 'Camera', value: 'Apple iPhone' }], aiSignals: [], cameraMetadataPresent: true,
      aiOriginStatus: 'inconclusive', detectorCoverage: 'C2PA checked; no credential found',
    })
    expect(fileHasMaterialAiEvidence(file)).toBe(false)
    expect(sessionHasAiOriginRelevance(session([file]))).toBe(false)
  })

  it('shows the controls for verified, declared, or model-flagged AI media', () => {
    const file = imageFile({
      metadata: [], aiSignals: ['trainedAlgorithmicMedia'], cameraMetadataPresent: false,
      aiOriginStatus: 'verified-ai', detectorCoverage: 'trusted C2PA',
    })
    expect(fileHasMaterialAiEvidence(file)).toBe(true)
    expect(sessionHasAiOriginRelevance(session([file]))).toBe(true)
    expect(sessionHasAiOriginRelevance(session([], '## AI 来源判断\n\n存在具体的时序异常。'))).toBe(true)
  })
})
