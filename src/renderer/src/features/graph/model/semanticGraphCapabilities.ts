import type { GraphRunOptions } from '@shared/graph/execute/types'
import { toPlain } from '../../../utils/toPlain'
import { composeEntityMask } from './semanticEntityMask'
import { semanticTimelineSavePayload } from './semanticTimelineSave'

/** 语义时间线节点的能力（画布运行 / 任务队列共用，两处都要展开） */
export const semanticGraphCapabilities: Pick<
  GraphRunOptions,
  | 'analyzeSemanticVideo'
  | 'loadSemanticEvidence'
  | 'loadSemanticTimeline'
  | 'saveSemanticTimeline'
  | 'rebuildSemanticVideo'
  | 'listSemanticPacks'
  | 'readProjectImageDataUrl'
  | 'composeEntityMask'
> = {
  analyzeSemanticVideo: (input) => window.studio.semanticAnalyze(input),
  loadSemanticEvidence: (timelineId) => window.studio.semanticLoadEvidence(timelineId),
  loadSemanticTimeline: (timelineId) => window.studio.semanticLoadTimeline(timelineId),
  saveSemanticTimeline: (doc) =>
    window.studio.semanticSaveTimeline(semanticTimelineSavePayload(doc)),
  // 拼接请求由执行器组装，里面可能夹带上游运行态的**响应式代理**（计划里的字幕数组等）：
  // 代理过 IPC 会 DataCloneError（`An object could not be cloned.`），落桥前再拍一次纯数据兜底
  rebuildSemanticVideo: (input) => window.studio.semanticRebuild(toPlain(input)),
  listSemanticPacks: () => window.studio.semanticListPacks(),
  // 实体替换：关键帧 / 掩码 / 中间帧要进 canvas 合成，必须是 data URL（否则画布被污染）
  readProjectImageDataUrl: async (relativePath) => {
    const url = await window.studio.getAssetMediaDataUrl(relativePath)
    return typeof url === 'string' && url.startsWith('data:') ? url : undefined
  },
  composeEntityMask
}
