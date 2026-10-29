import type { AssetType } from '../domain'
import type { GraphNode } from './types'

/**
 * 拖入画布后应保留加工输入口的宿主资产类型。
 * 通过节点 params.assetHost=true 生效；导入引用不置该标记。
 */
export const ASSET_REF_INPUT_HOST_TYPES = [
  'screenplay',
  'world',
  'beat',
  'image',
  'video',
  'voice',
  'subgraph'
] as const satisfies readonly AssetType[]

export type AssetRefInputHostType = (typeof ASSET_REF_INPUT_HOST_TYPES)[number]

export function isAssetRefInputHostType(type: unknown): type is AssetRefInputHostType {
  return (
    typeof type === 'string' && (ASSET_REF_INPUT_HOST_TYPES as readonly string[]).includes(type)
  )
}

/** 绑定了工程资产的引用节点（拖入资产 / 带 assetId） */
export function isAssetRefNode(node: Pick<GraphNode, 'category' | 'params' | 'assetId'>): boolean {
  return node.category === 'asset' && (node.params.assetRef === true || !!node.assetId)
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

/** 除输入/输出节点外均可锁定上次输出（有图库或可复用 prior runStates） */
export function supportsGenerateLock(
  node: Pick<GraphNode, 'typeId' | 'category' | 'params' | 'assetId'>
): boolean {
  return !isGraphIoNode(node)
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

export function isUiSplitNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'ui.split'
}

/** 批量子图编排节点：执行时可能入队多份子图。 */
export function isBatchSubgraphCookNode(_node: Pick<GraphNode, 'typeId'>): boolean {
  return false
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

export function isFramePullNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'video.framePull'
}

export function isReshootNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'video.reshoot'
}

const SEMANTIC_TIMELINE_TOOL_TYPE_IDS = new Set([
  'semantic.analyze',
  'semantic.compile',
  'semantic.rebuild'
])

/** Semantic Timeline 工具节点（媒体卡；勿当记事本） */
export function isSemanticTimelineToolNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return typeof node.typeId === 'string' && SEMANTIC_TIMELINE_TOOL_TYPE_IDS.has(node.typeId)
}

export function isSelectVoiceNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'voice.select'
}

export function isSelectTextNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'text.select'
}

export function isMultiAngleEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.multiAngle'
}

export function isAdVariantsNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.adVariants'
}

export function isLightingEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.lighting'
}

export function isPortraitTextureEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.portraitTexture'
}

/** 人像处理（PixCake 式本地精修，双击 dive 进编辑器） */
export function isPortraitEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.portrait'
}

export function isEmotionEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.emotion'
}

export const IMAGE_PROCESS_TOOLS = [
  'crop',
  'transform',
  'compose',
  'gridSplit',
  'cutout',
  'matte',
  'erase',
  'redraw',
  'expand',
  'upscale'
] as const

export type ImageProcessToolId = (typeof IMAGE_PROCESS_TOOLS)[number]

const IMAGE_PROCESS_TOOL_SET = new Set<string>(IMAGE_PROCESS_TOOLS)

const LEGACY_IMAGE_PROCESS_TYPE_TO_TOOL: Readonly<Record<string, ImageProcessToolId>> = {
  'image.crop': 'crop',
  'image.transform': 'transform',
  'image.compose': 'compose',
  'image.gridSplit': 'gridSplit',
  'image.cutout': 'cutout',
  'image.matte': 'matte',
  'image.erase': 'erase',
  'image.redraw': 'redraw',
  'image.expand': 'expand',
  'image.upscale': 'upscale'
}

export function isLegacyImageProcessTypeId(typeId: string | undefined): boolean {
  return typeof typeId === 'string' && typeId in LEGACY_IMAGE_PROCESS_TYPE_TO_TOOL
}

type NodeRoleTarget =
  (Pick<GraphNode, 'typeId'> & { params?: Partial<GraphNode['params']> }) | null | undefined

export function isImageProcessNode(node: NodeRoleTarget): boolean {
  return node?.typeId === 'image.process'
}

export function resolveImageProcessTool(node: NodeRoleTarget): ImageProcessToolId {
  const raw = node?.params?.imageProcessTool
  if (typeof raw === 'string' && IMAGE_PROCESS_TOOL_SET.has(raw)) {
    return raw as ImageProcessToolId
  }
  const typeId = node?.typeId
  const legacy = typeId ? LEGACY_IMAGE_PROCESS_TYPE_TO_TOOL[typeId] : undefined
  if (legacy) return legacy
  return 'crop'
}

export function isUpscaleEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.upscale' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'upscale')
  )
}

export function isLipSyncNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'video.lipSync'
}

export function isExpandEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.expand' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'expand')
  )
}

export function isRedrawEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.redraw' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'redraw')
  )
}

export function isEraseEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.erase' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'erase')
  )
}

export function isMatteEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.matte' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'matte')
  )
}

export function isCropEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.crop' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'crop')
  )
}

/** 图片变换：缩放 / 旋转 / 镜像 / 平移（纯本地像素，双击进 dive 编辑器） */
export function isTransformEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.transform' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'transform')
  )
}

export function isGridSplitEditorNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.gridSplit' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'gridSplit')
  )
}

export function isIconPackEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.iconPack'
}

export function isLayerSplitEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.layerSplit'
}

export function isCutoutNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.cutout' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'cutout')
  )
}

export function isComposeNode(node: NodeRoleTarget): boolean {
  return (
    node?.typeId === 'image.compose' ||
    (node?.typeId === 'image.process' && resolveImageProcessTool(node) === 'compose')
  )
}

export function isComicPageNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'comic.page'
}

const GAME_IMAGE_ASSET_NODE_TYPE_IDS = new Set(['game.pbrTile', 'game.spriteProp', 'game.vfxAlpha'])

const GAME_PRODUCTION_NODE_TYPE_IDS = new Set([
  'game.pbrTile',
  'game.spriteProp',
  'game.vfxAlpha',
  'game.audioDsp',
  'game.levelMap',
  'game.economy'
])

/** 游戏图像资产加工节点（无缝瓦片与PBR / 精灵描边与物件 / 2D特效去黑底） */
export function isGameImageAssetNode(node: Pick<GraphNode, 'typeId'> | null | undefined): boolean {
  return typeof node?.typeId === 'string' && GAME_IMAGE_ASSET_NODE_TYPE_IDS.has(node.typeId)
}

/** 游戏生产工坊节点（无缝瓦片 / UI容器 / 精灵物件 / 特效去黑底 / 音频工坊 / 关卡拓扑） */
export function isGameProductionNode(node: Pick<GraphNode, 'typeId'> | null | undefined): boolean {
  return typeof node?.typeId === 'string' && GAME_PRODUCTION_NODE_TYPE_IDS.has(node.typeId)
}
