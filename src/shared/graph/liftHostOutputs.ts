import { mapHostBoundaryStatesToOutputs, mapHostInnerStatesToOutputs } from './execute/values'
import type { GraphNodeRunState } from './execute/types'
import { resolveNodeHostInterface } from './hostInterface'
import { isAssetHostNode } from './nodeRole'
import { graphValueHasPayload } from './hostInput'
import type { GraphDocument, GraphNodeParams, GraphValue } from './types'

export interface HostOutputLift {
  hostNodeId: string
  outputs: Record<string, GraphValue>
}

function outputsHavePayload(outputs: Record<string, GraphValue>): boolean {
  return Object.values(outputs).some((value) => graphValueHasPayload(value))
}

/**
 * 把抬升后的宿主出口值物化到宿主节点 params 图库：
 * 即使不重新 cook，`resolveLockedOutputs` / 外层预览也能从节点参数直接复用汇总结果。
 */
export function outputsToHostGalleryParams(
  outputs: Record<string, GraphValue>
): Partial<GraphNodeParams> {
  const params: Partial<GraphNodeParams> = {}
  for (const value of Object.values(outputs)) {
    if (value.kind === 'videos') {
      params.generatedVideos = value.items.map((item) => ({
        id: item.id,
        dataUrl: item.dataUrl ?? '',
        createdAt: item.createdAt,
        relativePath: item.relativePath
      }))
      const last = value.items[value.items.length - 1]
      if (last?.id) params.selectedVideoId = last.id
      if (!params.previewRelativePath && value.items[0]?.relativePath) {
        params.previewRelativePath = value.items[0].relativePath
      }
    } else if (value.kind === 'texts') {
      params.generatedTexts = value.items.map((item) => ({
        id: item.id,
        title: item.title,
        text: item.text ?? '',
        createdAt: item.createdAt,
        ...(item.relativePath ? { relativePath: item.relativePath } : {})
      }))
      const last = value.items[value.items.length - 1]
      if (last?.id) params.selectedTextId = last.id
    } else if (value.kind === 'images') {
      params.generatedImages = value.items.map((item) => ({
        id: item.id,
        dataUrl: item.dataUrl ?? '',
        createdAt: item.createdAt,
        relativePath: item.relativePath
      }))
      const last = value.items[value.items.length - 1]
      if (last?.id) params.selectedImageId = last.id
    }
  }
  return params
}

/**
 * 从内图 runStates 映射到父图中引用该资产的宿主实例出口。
 * 与外层 Cook（executeAssetHostInnerGraph）使用同一套 boundary 映射。
 */
export function collectHostOutputLifts(
  assetId: string,
  innerDoc: GraphDocument,
  innerStates: Record<string, GraphNodeRunState>,
  parentDoc: GraphDocument
): HostOutputLift[] {
  const id = assetId.trim()
  if (!id) return []
  const lifts: HostOutputLift[] = []
  for (const node of parentDoc.nodes) {
    if (!isAssetHostNode(node) || node.assetId !== id) continue
    const outputs =
      mapHostBoundaryStatesToOutputs(innerStates, innerDoc, resolveNodeHostInterface(node)) ??
      mapHostInnerStatesToOutputs(innerStates, innerDoc, node.assetType ?? '') ??
      null
    if (!outputs || !outputsHavePayload(outputs)) continue
    lifts.push({ hostNodeId: node.id, outputs })
  }
  return lifts
}

/** 把宿主出口 lift 写入父图 runStates（status=done） */
export function withHostOutputLifts(
  doc: GraphDocument,
  lifts: HostOutputLift[]
): GraphDocument {
  if (!lifts.length) return doc
  const runStates: NonNullable<GraphDocument['runStates']> = { ...(doc.runStates ?? {}) }
  const liftByNodeId = new Map(lifts.map((lift) => [lift.hostNodeId, lift]))
  const nodes = doc.nodes.map((node) => {
    const lift = liftByNodeId.get(node.id)
    if (!lift) return node
    const params = outputsToHostGalleryParams(lift.outputs)
    return Object.keys(params).length
      ? { ...node, params: { ...node.params, ...params } }
      : node
  })
  for (const lift of lifts) {
    const prev = runStates[lift.hostNodeId]
    runStates[lift.hostNodeId] = {
      ...(prev ?? {}),
      status: 'done',
      outputs: lift.outputs,
      error: undefined
    }
  }
  return { ...doc, nodes, runStates }
}
