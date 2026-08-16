import type { AnalysisMode, OutputFormat } from '../types/domain'

/**
 * Recognition always enters through this single contract. Evidence-specific
 * branches are chosen inside the trusted prompt builder after the target has
 * been collected; users never have to select or write a prompt first.
 */
export const AUTO_ANALYSIS_QUESTION = '自动扫描所选内容，识别它的类型与周围上下文，直接给出最有用的结论、证据和下一步。'
export const AUTO_ANALYSIS_PROMPT_ID = 'auto-analysis'
export const AUTO_ANALYSIS_MODE: AnalysisMode = 'explain'
export const AUTO_OUTPUT_FORMAT: OutputFormat = 'adaptive'
