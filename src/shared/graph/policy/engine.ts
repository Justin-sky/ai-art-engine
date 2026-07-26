import { matchesTypeIdPattern } from './match'
import { getScopePolicy } from './registry'

export function isNodeAddableInScope(scope: string, typeId: string): boolean {
  // 输出节点：画布 / 元素子画布可添加各类输出；分镜视频窗仅视频输出；分镜图窗仅图片输出
  // 叙事 / 世界元素资产图可添加对应专用输出（通常由单例确保，此处允许手动补）
  const allowShotWorkflowVideoOutput = scope === 'shotWorkflow' && typeId === 'output.video'
  const allowVisualImageOutput = scope === 'visual' && typeId === 'output.image'
  const allowNarrativeUnitTextOutput =
    scope === 'narrativeUnit' && typeId === 'output.narrativeUnit'
  const allowNarrativeOutput = scope === 'narrativeAsset' && typeId === 'output.narrative'
  const allowWorldOutput = scope === 'worldAsset' && typeId === 'output.world'
  if (
    typeId.startsWith('output.') &&
    scope !== 'canvasAsset' &&
    scope !== 'elementWorkflow' &&
    !allowShotWorkflowVideoOutput &&
    !allowVisualImageOutput &&
    !allowNarrativeUnitTextOutput &&
    !allowNarrativeOutput &&
    !allowWorldOutput
  ) {
    return false
  }
  const policy = getScopePolicy(scope)
  if (!policy) return false
  return policy.addableNodeTypes.some((pattern) => matchesTypeIdPattern(pattern, typeId))
}
