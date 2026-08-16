import { describe, expect, it } from 'vitest'

import {
  AUTO_ANALYSIS_MODE,
  AUTO_ANALYSIS_PROMPT_ID,
  AUTO_ANALYSIS_QUESTION,
  AUTO_OUTPUT_FORMAT,
} from './autoAnalysis'

describe('automatic recognition contract', () => {
  it('uses one adaptive task instead of user-selected prompt modes', () => {
    expect(AUTO_ANALYSIS_PROMPT_ID).toBe('auto-analysis')
    expect(AUTO_ANALYSIS_MODE).toBe('explain')
    expect(AUTO_OUTPUT_FORMAT).toBe('adaptive')
    expect(AUTO_ANALYSIS_QUESTION).toContain('自动生成最合适的分析任务')
    expect(AUTO_ANALYSIS_QUESTION).toContain('上下文')
    expect(AUTO_ANALYSIS_QUESTION).toContain('不套用固定模板')
  })
})
