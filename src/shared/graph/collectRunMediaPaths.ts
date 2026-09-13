/**
 * 图运行产出 → 会话可见的媒体相对路径。
 *
 * 图运行的产物本身只是 runStates 里的端口值与节点参数，会话侧无从感知；
 * 这里把「作品级」产物挑出来（2D 帧动画 GIF、2D 舞台拼版、SVG 烘焙 GIF、输出节点成片），
 * 逐帧序列这类中间产物只按单件末条收敛，避免一次运行刷出上百张卡片。
 */

import type { GraphDocument } from './types'
import type { GraphNodeRunState, GraphValue } from './execute/types'
import { ANIM2D_GIF_OUT_PORT_ID } from './anim2d'
import { STAGE2D_FRAMES_OUT_PORT_ID, STAGE2D_SHEET_OUT_PORT_ID } from './stage2dAction'
import { SVG_ANIM_GIF_OUT_PORT_ID } from './svgAnim'
import { findAllOutputNodes } from './query'

/** 作品级单件产出端口（按展示优先级排列） */
const FEATURE_OUT_PORT_IDS: readonly string[] = [
  ANIM2D_GIF_OUT_PORT_ID,
  STAGE2D_SHEET_OUT_PORT_ID,
  SVG_ANIM_GIF_OUT_PORT_ID
]

/** 批量中间产物端口：兜底阶段跳过，避免把逐帧序列当成作品 */
const FRAME_BATCH_OUT_PORT_IDS = new Set<string>([STAGE2D_FRAMES_OUT_PORT_ID])

/** 单次运行最多展示的产物条数 */
export const RUN_MEDIA_PATH_LIMIT = 6

/** 数组型媒体取末条（对齐图库「最新 / 当前选中」语义） */
function lastRelativePath(items: ReadonlyArray<{ relativePath?: string }>): string | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const path = items[i]?.relativePath?.trim()
    if (path) return path
  }
  return undefined
}

/**
 * SVG 图库取首条：`commitSvgGallery` 的合并顺序是「新在前」（与 image 图库的
 * append 顺序相反），末条是最旧的一张，取它会把会话卡指向过期产物。
 */
function firstRelativePath(items: ReadonlyArray<{ relativePath?: string }>): string | undefined {
  for (const item of items) {
    const path = item?.relativePath?.trim()
    if (path) return path
  }
  return undefined
}

/** 端口值 → 可展示的相对路径（无物化路径的一律忽略，dataUrl 不进会话） */
function mediaPathOf(value: GraphValue | undefined): string | undefined {
  if (!value) return undefined
  switch (value.kind) {
    case 'image':
    case 'video':
    case 'voice':
    // SVG 生成节点的 out 出 .svg 源码 + 落盘路径，与位图同为「可放给人看」的产物
    case 'svg':
      return value.relativePath?.trim() || undefined
    case 'images':
    case 'videos':
    case 'voices':
      return lastRelativePath(value.items)
    case 'svgs':
      return firstRelativePath(value.items)
    case 'output':
      return (
        lastRelativePath(value.images ?? []) ??
        lastRelativePath(value.videos ?? []) ??
        lastRelativePath(value.voices ?? [])
      )
    default:
      return undefined
  }
}

/**
 * 收集一次图运行值得展示的媒体相对路径（去重、限量、稳定顺序）。
 *
 * 顺序：作品级端口（GIF / 拼版）→ 输出节点成片 → 无作品级产物时兜底整图媒体产出。
 */
export function collectRunMediaPaths(
  graph: GraphDocument,
  runStates: Record<string, GraphNodeRunState>,
  options: { limit?: number } = {}
): string[] {
  const limit = Math.max(1, Math.trunc(options.limit ?? RUN_MEDIA_PATH_LIMIT))
  const paths: string[] = []
  const seen = new Set<string>()
  const push = (path?: string): void => {
    const value = path?.trim()
    if (!value || seen.has(value) || paths.length >= limit) return
    seen.add(value)
    paths.push(value)
  }

  const nodeIds = graph.nodes.map((node) => node.id)

  // 1) 作品级单件产出：2D 帧动画 GIF、2D 舞台拼版
  for (const portId of FEATURE_OUT_PORT_IDS) {
    for (const nodeId of nodeIds) {
      push(mediaPathOf(runStates[nodeId]?.outputs?.[portId]))
    }
  }

  // 2) 输出节点成片（图库末条）
  for (const node of findAllOutputNodes(graph)) {
    push(mediaPathOf(runStates[node.id]?.outputs?.out))
  }

  // 3) 兜底：整图任一端口确有媒体产出时至少让结果可见（如只跑了单张生成节点）
  if (!paths.length) {
    for (const nodeId of nodeIds) {
      const outputs = runStates[nodeId]?.outputs
      if (!outputs) continue
      for (const [portId, value] of Object.entries(outputs)) {
        if (FRAME_BATCH_OUT_PORT_IDS.has(portId)) continue
        push(mediaPathOf(value))
      }
    }
  }

  return paths
}
