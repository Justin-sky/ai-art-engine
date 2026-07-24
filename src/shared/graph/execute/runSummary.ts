import type { GraphRunResult } from './types'

export interface GraphRunOutputSummary {
  visual: number
  voice: number
  text: number
  images: number
  /** 是否跑到了输出节点（有 GraphOutputValue） */
  hasOutput: boolean
}

export type GraphRunSuccessMessageKey =
  | 'complete'
  | 'completeImages'
  | 'completeText'
  | 'completeOk'
  | 'noRefs'

/** 统计输出节点上的有效内容，供运行完成提示使用 */
export function summarizeGraphRunOutput(
  result: Pick<GraphRunResult, 'output' | 'contribution'>
): GraphRunOutputSummary {
  const visual = result.contribution?.genRefs.length ?? 0
  const audio =
    result.contribution?.audioRefs.filter((item) => item.assetId).length ?? 0
  const text =
    result.output?.notes.filter((item) => item.text.trim()).length ?? 0
  const imageItems =
    result.output?.images ??
    result.output?.params.cameraShots?.map((shot) => ({
      dataUrl: shot.dataUrl
    })) ??
    []
  const images = imageItems.filter((item) => item.dataUrl?.trim()).length
  return {
    visual,
    audio,
    text,
    images,
    hasOutput: result.output != null
  }
}

/**
 * 选择完成提示文案键。
 * 资产参考（生成贡献）优先，其次站位/选取图，再次文本；
 * 跑到输出但内容为空 → noRefs；只跑中间节点成功 → completeOk。
 */
export function pickGraphRunSuccessMessageKey(
  summary: GraphRunOutputSummary
): GraphRunSuccessMessageKey {
  if (summary.visual + summary.audio > 0) return 'complete'
  if (summary.images > 0) return 'completeImages'
  if (summary.text > 0) return 'completeText'
  if (summary.hasOutput) return 'noRefs'
  return 'completeOk'
}
