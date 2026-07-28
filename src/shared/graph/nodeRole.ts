import type { AssetType } from '../domain'
import type { GraphNode } from './types'

/**
 * 拖入画布后应保留加工输入口的宿主资产类型。
 * 通过节点 params.assetHost=true 生效；导入引用不置该标记。
 */
export const ASSET_REF_INPUT_HOST_TYPES = [
  'screenplay',
  'world',
  'narrative',
  'script',
  'image',
  'video',
  'voice',
  'subgraph'
] as const satisfies readonly AssetType[]

export type AssetRefInputHostType = (typeof ASSET_REF_INPUT_HOST_TYPES)[number]

export function isAssetRefInputHostType(type: unknown): type is AssetRefInputHostType {
  return (
    typeof type === 'string' &&
    (ASSET_REF_INPUT_HOST_TYPES as readonly string[]).includes(type)
  )
}

/** 绑定了工程资产的引用节点（拖入资产 / 带 assetId） */
export function isAssetRefNode(
  node: Pick<GraphNode, 'category' | 'params' | 'assetId'>
): boolean {
  return (
    node.category === 'asset' && (node.params.assetRef === true || !!node.assetId)
  )
}

/**
 * 宿主实例节点（HDA）。
 * params.assetHost 是显式标记，但存量数据 / 重建节点可能缺失；
 * 带 hostInterfaceSnapshot 说明端口已按宿主接口生成，同样按宿主处理。
 */
export function isAssetHostNode(
  node: Pick<GraphNode, 'category' | 'params' | 'assetId' | 'assetType'>
): boolean {
  if (!isAssetRefNode(node)) return false
  if (!isAssetRefInputHostType(node.assetType)) return false
  return node.params.assetHost === true || !!node.params.hostInterfaceSnapshot
}

/** 未绑定资产的加工节点（右侧可编辑参数） */
export function isProcessingAssetNode(
  node: Pick<GraphNode, 'category' | 'params' | 'assetId'>
): boolean {
  return node.category === 'asset' && !isAssetRefNode(node)
}

/**
 * 图输入/输出节点：不提供锁定（boundary / slot / category=output）。
 * 其余节点（含宿主资产）均可锁定并复用上次输出。
 */
export function isGraphIoNode(node: Pick<GraphNode, 'typeId' | 'category'>): boolean {
  if (node.category === 'output') return true
  switch (node.typeId) {
    case 'graph.input.slot':
    case 'graph.boundary.input':
    case 'graph.boundary.output':
      return true
    default:
      return false
  }
}

/**
 * 目录表格节点：只把上游目录透传并存进 params.text，不调用生成，
 * 也没有 generated* 图库可复用；锁定它只会让整条链取不到缓存而失败。
 */
export function isCatalogTableNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return isWorldTableNode(node) || isNarrativeTableNode(node) || isScriptShotTableNode(node)
}

/** 除输入/输出与目录表格外均可锁定上次输出（有图库或可复用 prior runStates） */
export function supportsGenerateLock(
  node: Pick<GraphNode, 'typeId' | 'category' | 'params' | 'assetId'>
): boolean {
  return !isGraphIoNode(node) && !isCatalogTableNode(node)
}

export function isGenerateLocked(
  node: Pick<GraphNode, 'typeId' | 'category' | 'params' | 'assetId'>
): boolean {
  return supportsGenerateLock(node) && node.params.locked === true
}

export function isDirectorProcessingNode(
  node: Pick<GraphNode, 'typeId' | 'category' | 'params' | 'assetId'>
): boolean {
  return node.typeId === 'asset.motion' && isProcessingAssetNode(node)
}

export function isScriptShotSplitNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'script.shotSplit'
}

export function isScriptShotTableNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'script.shotTable'
}

export function isScriptShotImageGenNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'script.shotImageGen'
}

export function isScriptShotVideoGenNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'script.shotVideoGen'
}

export function isScriptShotParamsNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'script.shotParams'
}

export function isWorldExtractNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'world.extract'
}

export function isNarrativeSplitNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.split'
}

export function isNarrativeTableNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.table'
}

export function isNarrativeGenNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.gen'
}

export function isNarrativeUnitGenNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.unitGen'
}

export function isNarrativeUnitRefNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.unitRef'
}

export function isNarrativeOutputNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'output.narrative'
}

export function isNarrativeUnitOutputNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'output.narrativeUnit'
}

export function isWorldOutputNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'output.world'
}

export function isWorldTableNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'world.table'
}

export function isWorldGenNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'world.gen'
}

export function isTimelineOutputNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'output.timeline'
}

export function isSelectImageNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.select'
}

export function isSelectVideoNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'video.select'
}

export function isSelectVoiceNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'voice.select'
}

export function isSelectTextNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'text.select'
}

export function isSelectNarrativeNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.select'
}

export function isMultiAngleEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.multiAngle'
}

export function isLightingEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.lighting'
}

export function isPortraitTextureEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.portraitTexture'
}

export function isEmotionEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.emotion'
}

export function isUpscaleEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.upscale'
}

export function isLipSyncNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'video.lipSync'
}

export function isExpandEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.expand'
}

export function isRedrawEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.redraw'
}

export function isEraseEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.erase'
}

export function isMatteEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.matte'
}

export function isCropEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.crop'
}

export function isGridSplitEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.gridSplit'
}
