import type { AnalysisMode, OutputFormat } from '../types/domain'

/**
 * Recognition always enters through this single contract. Evidence-specific
 * branches are chosen inside the trusted prompt builder after the target has
 * been collected; users never have to select or write a prompt first.
 */
export const AUTO_ANALYSIS_QUESTION = '识别所选内容的具体类型、真实主题与上下文，自动生成最合适的分析任务并详细完成；根据内容决定结构，不套用固定模板。'
export const AUTO_ANALYSIS_PROMPT_ID = 'auto-analysis'
export const AUTO_ANALYSIS_MODE: AnalysisMode = 'explain'
export const AUTO_OUTPUT_FORMAT: OutputFormat = 'adaptive'
