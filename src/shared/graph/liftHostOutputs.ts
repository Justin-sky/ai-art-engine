import { mapHostBoundaryStatesToOutputs, mapHostInnerStatesToOutputs } from './execute/values'
import type { GraphNodeRunState } from './execute/types'
import { resolveNodeHostInterface } from './hostInterface'
import { isAssetHostNode } from './nodeRole'
import { graphValueHasPayload } from './hostInput'
import type { GraphDocument, GraphValue } from './types'

export interface HostOutputLift {
  hostNodeId: string
  outputs: Record<string, GraphValue>
}

function outputsHavePayload(outputs: Record<string, GraphValue>): boolean {
  return Object.values(outputs).some((value) => graphValueHasPayload(value))
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
  for (const lift of lifts) {
    const prev = runStates[lift.hostNodeId]
    runStates[lift.hostNodeId] = {
      ...(prev ?? {}),
      status: 'done',
      outputs: lift.outputs,
      error: undefined
    }
  }
  return { ...doc, runStates }
}
