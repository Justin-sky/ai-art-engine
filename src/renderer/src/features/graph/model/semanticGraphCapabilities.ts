import type { GraphRunOptions } from '@shared/graph/execute/types'

/** 语义时间线节点的主进程能力（画布运行 / 任务队列共用，两处都要展开） */
export const semanticGraphCapabilities: Pick<
  GraphRunOptions,
  | 'analyzeSemanticVideo'
  | 'loadSemanticEvidence'
  | 'saveSemanticTimeline'
  | 'buildSemanticVideo'
  | 'listSemanticPacks'
> = {
  analyzeSemanticVideo: (input) => window.studio.semanticAnalyze(input),
  loadSemanticEvidence: (timelineId) => window.studio.semanticLoadEvidence(timelineId),
  saveSemanticTimeline: (doc) => window.studio.semanticSaveTimeline(doc),
  buildSemanticVideo: (input) => window.studio.semanticBuild(input),
  listSemanticPacks: () => window.studio.semanticListPacks()
}
