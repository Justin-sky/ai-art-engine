import type { GraphRunOptions } from '@shared/graph/execute/types'
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
  rebuildSemanticVideo: (input) => window.studio.semanticRebuild(input),
  listSemanticPacks: () => window.studio.semanticListPacks(),
  // 实体替换：关键帧 / 掩码 / 中间帧要进 canvas 合成，必须是 data URL（否则画布被污染）
  readProjectImageDataUrl: async (relativePath) => {
    const url = await window.studio.getAssetMediaDataUrl(relativePath)
    return typeof url === 'string' && url.startsWith('data:') ? url : undefined
  },
  composeEntityMask
}
