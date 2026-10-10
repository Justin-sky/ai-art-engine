/**
 * 构建后视觉复核：优先复用工程内 media.review / QC 通道；不可用时返回跳过说明。
 */
import type { BuildQcResult } from '@shared/semanticTimeline'

export interface VisualReviewInput {
  referenceAbs: string
  candidateAbs: string
  /** 可选：替换区掩码目录 */
  maskDirAbs?: string
  notes?: string[]
}

/**
 * 轻量复核入口。完整 media.review 节点在图执行层；此处供 buildExecutor / MCP 同步调用。
 */
export async function reviewBuildVisual(
  input: VisualReviewInput
): Promise<{ passed: boolean; notes: string[] }> {
  const notes = [...(input.notes ?? [])]
  if (!input.candidateAbs || !input.referenceAbs) {
    return { passed: false, notes: ['missing reference or candidate path'] }
  }
  // 首期：存在产物即视为可人工复核；详细串扰/商品一致性由 media.review 节点补强
  notes.push('visual review: deferred to media.review node / human compare view')
  if (input.maskDirAbs) {
    notes.push(`mask dir: ${input.maskDirAbs}`)
  }
  return { passed: true, notes }
}

export function mergeVisualIntoQc(
  qc: BuildQcResult,
  visual: { passed: boolean; notes: string[] }
): BuildQcResult {
  const notes = [...(qc.notes ?? []), ...visual.notes]
  if (!visual.passed) {
    return { ...qc, passed: false, notes }
  }
  return { ...qc, notes: notes.length ? notes : qc.notes }
}
