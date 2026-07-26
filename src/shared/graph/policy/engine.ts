import { matchesTypeIdPattern } from './match'
import { getScopePolicy } from './registry'

export function isNodeAddableInScope(scope: string, typeId: string): boolean {
  // 输出节点：画布 / 世界 / 元素子画布可添加各类输出；分镜视频窗仅视频输出；分镜图窗仅图片输出
  // 叙事资产图可添加叙事单元生成（通常由单例确保，此处允许手动补）
  const allowShotWorkflowVideoOutput = scope === 'shotWorkflow' && typeId === 'output.video'
  const allowVisualImageOutput = scope === 'visual' && typeId === 'output.image'
  const allowNarrativeOutput = scope === 'narrativeAsset' && typeId === 'output.narrative'
  if (
    typeId.startsWith('output.') &&
    scope !== 'canvasAsset' &&
    scope !== 'worldAsset' &&
    scope !== 'elementWorkflow' &&
    !allowShotWorkflowVideoOutput &&
    !allowVisualImageOutput &&
    !allowNarrativeOutput
  ) {
    return false
  }
  const policy = getScopePolicy(scope)
  if (!policy) return false
  return policy.addableNodeTypes.some((pattern) => matchesTypeIdPattern(pattern, typeId))
}
