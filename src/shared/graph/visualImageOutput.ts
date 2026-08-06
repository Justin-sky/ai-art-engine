/**
 * 视觉图图片出口通用收集：世界元素 / 场子图批跑共用。
 * 输出节点 = boundary.output / classic output / 图片生成加工节点。
 */
import { flattenImagesValues } from './execute/values'
import type { GraphImageItem } from './execute/types'
import { graphValueHasPayload, softResolveBoundaryOutputValue } from './hostInput'
import { findOutputNode } from './query'
import { isBoundaryOutputNode } from './hostInterface'
import { isGenerateLocked } from './nodeRole'
import { GraphPortType, type GraphDocument, type GraphNode } from './types'

function listImageOutputNodes(doc: GraphDocument): GraphNode[] {
  const boundaryOuts = doc.nodes.filter(
    (node) =>
      isBoundaryOutputNode(node) &&
      (node.params.hostBoundaryPort?.dataType === GraphPortType.image ||
        node.params.hostBoundaryPort?.dataType === GraphPortType.images ||
        !node.params.hostBoundaryPort?.dataType)
  )
  if (boundaryOuts.length) return boundaryOuts
  const outputs = doc.nodes.filter(
    (node) => node.category === 'output' || node.typeId === 'output.image'
  )
  if (outputs.length) return outputs
  // 无 classic output：从图片生成/加工节点收集
  const gens = doc.nodes.filter(
    (node) =>
      node.typeId === 'asset.image' ||
      (node.typeId?.startsWith('image.') ?? false) ||
      (node.category === 'asset' && node.assetType === 'image')
  )
  if (gens.length) return gens
  const single = findOutputNode(doc)
  return single ? [single] : []
}

function dedupeImageItems(items: GraphImageItem[]): GraphImageItem[] {
  const seen = new Set<string>()
  const out: GraphImageItem[] = []
  for (const item of items) {
    const key =
      item.relativePath?.trim() ||
      item.id?.trim() ||
      (item.dataUrl?.trim() ? `data:${item.dataUrl.slice(0, 64)}` : '')
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function collectGeneratedImagesParam(node: GraphNode | null): GraphImageItem[] {
  if (!node) return []
  const generated = node.params.generatedImages
  if (!Array.isArray(generated) || !generated.length) return []
  return dedupeImageItems(
    generated
      .map((shot, index) => ({
        id: shot.id ?? `visual-gen:${node.id}:${index}`,
        dataUrl: shot.dataUrl ?? '',
        createdAt: shot.createdAt,
        relativePath: shot.relativePath
      }))
      .filter((item) => item.relativePath || item.dataUrl)
  )
}

function collectImagesFromOutputNodeLoose(
  doc: GraphDocument,
  output: GraphNode
): GraphImageItem[] {
  const fromRun = doc.runStates?.[output.id]?.outputs?.out
  const fromValue = fromRun ? flattenImagesValues([fromRun]) : []
  if (fromValue.length) {
    return dedupeImageItems(fromValue.filter((item) => item.relativePath || item.dataUrl))
  }

  const previewRel = output.params.previewRelativePath?.trim()
  const previewData = output.params.previewDataUrl?.trim()
  if (previewRel || previewData) {
    return [
      {
        id: `preview:${output.id}`,
        dataUrl: previewData || '',
        relativePath: previewRel
      }
    ]
  }

  if (isBoundaryOutputNode(output)) {
    const soft = softResolveBoundaryOutputValue(doc, output.id)
    if (graphValueHasPayload(soft) && soft) {
      const fromSoft = flattenImagesValues([soft])
      if (fromSoft.length) {
        return dedupeImageItems(
          fromSoft.filter((item) => item.relativePath || item.dataUrl)
        )
      }
    }
  }

  const shots = output.params.cameraShots
  if (Array.isArray(shots) && shots.length) {
    return dedupeImageItems(
      shots
        .map((shot, index) => ({
          id: shot.id ?? `visual:${output.id}:${index}`,
          dataUrl: shot.dataUrl ?? '',
          createdAt: shot.createdAt,
          relativePath: shot.relativePath
        }))
        .filter((item) => item.relativePath || item.dataUrl)
    )
  }

  return collectGeneratedImagesParam(output)
}

/** 输出节点是否已跑完，或边界输出已有可 soft-resolve 的图像载荷 */
export function isVisualOutputNodeComplete(
  doc: GraphDocument,
  outputNodeId: string
): boolean {
  if (doc.runStates?.[outputNodeId]?.status === 'done') return true
  const node = doc.nodes.find((n) => n.id === outputNodeId)
  if (!node || !isBoundaryOutputNode(node)) return false
  // 落盘竞态 / 仅有 preview 时：有有效图像也视为可收集
  return collectImagesFromOutputNodeLoose(doc, node).length > 0
}

/**
 * 从已完成的输出节点取图（runStates / preview / soft-resolve / cameraShots / generatedImages）。
 */
export function collectImagesFromCompletedOutputNode(
  doc: GraphDocument,
  output: GraphNode
): GraphImageItem[] {
  if (!isVisualOutputNodeComplete(doc, output.id)) return []
  return collectImagesFromOutputNodeLoose(doc, output)
}

/** 视觉图中的图片出口节点（优先 boundary.output / 宿主输出端口） */
export function listVisualOutputNodes(doc: GraphDocument): GraphNode[] {
  return listImageOutputNodes(doc)
}

/** 边界出口的直接图片上游（elementWorkflow: asset.image → boundary.output） */
function resolveDirectImageGenUpstream(
  doc: GraphDocument,
  output: GraphNode
): GraphNode | null {
  for (const edge of doc.edges) {
    if (edge.target !== output.id) continue
    const source = doc.nodes.find((node) => node.id === edge.source)
    if (!source) continue
    if (
      source.typeId === 'asset.image' ||
      (source.typeId?.startsWith('image.') ?? false) ||
      (source.category === 'asset' && source.assetType === 'image')
    ) {
      return source
    }
  }
  return null
}

/** 尚未可 soft-collect 的出口节点 id */
export function listIncompleteVisualOutputNodeIds(doc: GraphDocument): string[] {
  return listImageOutputNodes(doc)
    .filter((node) => !isVisualOutputNodeComplete(doc, node.id))
    .map((node) => node.id)
}

/**
 * 世界元素批跑需要 cook 的出口：
 * - 缺图 → 入队生成
 * - 有图且上游生成未锁定 → 入队重新 cook
 * - 有图且上游生成已锁定 → 跳过，collect 时 soft-resolve
 */
export function listVisualOutputNodeIdsNeedingCook(doc: GraphDocument): string[] {
  return listImageOutputNodes(doc)
    .filter((output) => {
      const complete = isVisualOutputNodeComplete(doc, output.id)
      const gen = resolveDirectImageGenUpstream(doc, output)
      if (!complete) return true
      if (!gen) return false
      return !isGenerateLocked(gen)
    })
    .map((node) => node.id)
}

/**
 * 从元素图收集图片：只收全部输出节点中 status===done 且有可用图的结果；
 * 未完成输出跳过，不回退上游生成节点。
 */
export function collectImagesFromVisualGraph(
  doc: GraphDocument | null | undefined
): GraphImageItem[] {
  if (!doc?.nodes?.length) return []
  const outputs = listImageOutputNodes(doc)
  return dedupeImageItems(
    outputs.flatMap((output) => collectImagesFromCompletedOutputNode(doc, output))
  )
}
