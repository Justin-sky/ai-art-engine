/**
 * 从图片资产的生成内图（genParams.graphJson）软解析「多帧序列 sheet 网格」。
 * frame.animGen / anim.2d 链路会把 rows×cols 写入生成图节点 params.animRows/animCols，
 * 素材库据此识别一张 sheet PNG 可按多少行多少列切帧试播；无内图或非网格产出时返回 null。
 */

import type { AssetInfo } from '@shared/domain'

function readAssetGraphNodes(raw: unknown): Array<{ params?: Record<string, unknown> }> | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as { nodes?: unknown }
  if (!Array.isArray(doc.nodes)) return null
  return doc.nodes as Array<{ params?: Record<string, unknown> }>
}

export interface AssetFrameSheetGrid {
  rows: number
  cols: number
}

export function resolveAssetFrameSheetGrid(asset: AssetInfo): AssetFrameSheetGrid | null {
  const nodes = readAssetGraphNodes(asset.genParams?.graphJson)
  if (!nodes) return null
  for (const node of nodes) {
    const rows = Math.floor(Number(node.params?.animRows))
    const cols = Math.floor(Number(node.params?.animCols))
    if (rows >= 1 && cols >= 1 && rows * cols > 1) {
      return { rows, cols }
    }
  }
  return null
}
