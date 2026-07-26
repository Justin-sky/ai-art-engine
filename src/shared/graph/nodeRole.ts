import type { GraphNode } from './types'

/** 绑定了工程资产的引用节点（拖入资产 / 带 assetId） */
export function isAssetRefNode(
  node: Pick<GraphNode, 'category' | 'params' | 'assetId'>
): boolean {
  return (
    node.category === 'asset' && (node.params.assetRef === true || !!node.assetId)
  )
}

/** 未绑定资产的加工节点（右侧可编辑参数） */
export function isProcessingAssetNode(
  node: Pick<GraphNode, 'category' | 'params' | 'assetId'>
): boolean {
  return node.category === 'asset' && !isAssetRefNode(node)
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

/** @deprecated 使用 {@link isScriptShotVideoGenNode} */
export function isScriptShotEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return isScriptShotVideoGenNode(node) || node.typeId === 'script.shotEditor'
}

export function isScriptShotParamsNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'script.shotParams'
}

export function isWorldExtractNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'world.extract'
}

export function isScreenplayNarrativeSplitNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.split' || node.typeId === 'screenplay.narrativeSplit'
}

export function isNarrativeSplitNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.split'
}

export function isNarrativeTableNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.table'
}

export function isNarrativeEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'narrative.editor'
}

export function isNarrativeOutputNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'output.narrative'
}

export function isWorldOutputNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'output.world'
}

export function isWorldTableNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'world.table'
}

export function isWorldEditorNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'world.editor'
}

export function isSelectImageNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'image.select'
}

export function isSelectVideoNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'video.select'
}

export function isSelectScreenplayNode(node: Pick<GraphNode, 'typeId'>): boolean {
  return node.typeId === 'screenplay.select'
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
