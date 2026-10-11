import type { GraphRunOptions } from '@shared/graph/execute/types'

/** 语义时间线节点的主进程能力（画布运行 / 任务队列共用，两处都要展开） */
export const semanticGraphCapabilities: Pick<
  GraphRunOptions,
  | 'analyzeSemanticVideo'
  | 'loadSemanticEvidence'
  | 'loadSemanticTimeline'
  | 'saveSemanticTimeline'
  | 'buildSemanticVideo'
  | 'rebuildSemanticVideo'
  | 'listSemanticPacks'
> = {
  analyzeSemanticVideo: (input) => window.studio.semanticAnalyze(input),
  loadSemanticEvidence: (timelineId) => window.studio.semanticLoadEvidence(timelineId),
  loadSemanticTimeline: (timelineId) => window.studio.semanticLoadTimeline(timelineId),
  saveSemanticTimeline: (doc) => window.studio.semanticSaveTimeline(doc),
  buildSemanticVideo: (input) => window.studio.semanticBuild(input),
  rebuildSemanticVideo: (input) => window.studio.semanticRebuild(input),
  listSemanticPacks: () => window.studio.semanticListPacks()
}
