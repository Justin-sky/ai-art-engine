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

/** 单次运行最多展示的产物条数（支持多页绘本/多镜分镜中间图 + 成片视频完整出卡） */
export const RUN_MEDIA_PATH_LIMIT = 24

const AUDIO_ONLY_NODE_TYPE_IDS = new Set<string>(['asset.voice', 'voice.process', 'output.voice'])

const NON_VISUAL_NODE_TYPE_IDS = new Set<string>([
  'asset.voice',
  'voice.process',
  'output.voice',
  'asset.text',
  'text.process',
  'output.text',
  'graph.comment'
])

function isVoiceValue(value: GraphValue | undefined): boolean {
  return value?.kind === 'voice' || value?.kind === 'voices'
}

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
    /**
     * 3D 产物（GLB 网格 / PLY·SPZ 高斯泼溅）是 `kind: 'asset'`。
     *
     * 这里早先没有这个分支，于是**3D 产物连一条路径都不回报** —— 对话流里既不显示
     * 预览、也不显示路径文本，产物等于没出现（导演台 / 世界模型 / 3D 加工都受影响）。
     * 它与图片一样有 `relativePath`，理当和位图同等待遇。
     */
    case 'asset':
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
        lastRelativePath(value.voices ?? []) ??
        // 输出节点的 3D 产物在 items 里（images / videos / voices 都没有时才轮到它）
        lastRelativePath(value.items ?? [])
      )
    case 'text': {
      const p = value.relativePath?.trim() || value.text?.trim() || ''
      if (/\.(psd|prefab|tscn|fcpxml|otio|zip)$/i.test(p)) return p
      return undefined
    }
    default:
      return undefined
  }
}

const MULTI_SHOT_SOURCE_TYPE_IDS = new Set<string>(['film.workbench', 'film.render'])

function pushAllItemPaths(value: GraphValue | undefined, push: (path?: string) => void): boolean {
  if (!value || (value.kind !== 'images' && value.kind !== 'videos' && value.kind !== 'voices')) {
    return false
  }
  let added = false
  for (const item of value.items) {
    const p = item?.relativePath?.trim()
    if (p) {
      push(p)
      added = true
    }
  }
  return added
}

/**
 * 收集一次图运行值得展示的媒体相对路径（去重、限量、稳定顺序）。
 *
 * 顺序：作品级端口（GIF / 拼版）→ 输出节点成片 → 无作品级产物时兜底整图媒体产出。
 */
export function collectRunMediaPaths(
  graph: GraphDocument,
  runStates: Record<string, GraphNodeRunState>,
  options: { limit?: number; preferredNodeIds?: string[] } = {}
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

  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const nodeIds = graph.nodes.map((node) => node.id)

  const collectFromNode = (nodeId: string, includeVoice = true): void => {
    const node = byId.get(nodeId)
    if (node?.locked) return
    const outputs = runStates[nodeId]?.outputs
    if (!outputs) return
    for (const portId of FEATURE_OUT_PORT_IDS) {
      push(mediaPathOf(outputs[portId]))
    }
    if (node?.typeId && MULTI_SHOT_SOURCE_TYPE_IDS.has(node.typeId)) {
      if (
        pushAllItemPaths(outputs['out-videos'], push) ||
        pushAllItemPaths(outputs['out-images'], push) ||
        pushAllItemPaths(outputs['out-sheets'], push)
      ) {
        return
      }
    }
    for (const [portId, value] of Object.entries(outputs)) {
      if (FRAME_BATCH_OUT_PORT_IDS.has(portId)) continue
      if (!includeVoice && isVoiceValue(value)) continue
      push(mediaPathOf(value))
    }
  }

  // 0) 显式指定目标节点时，优先收集目标节点的产出（自由画布单跑新节点时不混入旧节点产物）
  if (options.preferredNodeIds?.length) {
    const validPreferred = options.preferredNodeIds.filter((id) => {
      const node = byId.get(id)
      return !!node && !node.locked
    })
    const onlyTimelineTargets =
      validPreferred.length > 0 &&
      validPreferred.every((id) => byId.get(id)?.typeId === 'output.timeline')
    const candidateIds = onlyTimelineTargets
      ? [...nodeIds.filter((id) => byId.get(id)?.typeId !== 'output.timeline'), ...validPreferred]
      : validPreferred
    const hasVisualOrTimelineCandidate = candidateIds.some((id) => {
      const typeId = byId.get(id)?.typeId ?? ''
      return Boolean(typeId) && !NON_VISUAL_NODE_TYPE_IDS.has(typeId)
    })
    const includeVoice =
      !hasVisualOrTimelineCandidate &&
      candidateIds.every((id) => AUDIO_ONLY_NODE_TYPE_IDS.has(byId.get(id)?.typeId ?? ''))
    const nonTimelineIds = candidateIds.filter((id) => byId.get(id)?.typeId !== 'output.timeline')
    const timelineIds = candidateIds.filter((id) => byId.get(id)?.typeId === 'output.timeline')
    for (const nodeId of nonTimelineIds) {
      collectFromNode(nodeId, includeVoice)
    }
    for (const nodeId of timelineIds) {
      collectFromNode(nodeId, includeVoice)
    }
    if (paths.length) return paths
  }

  // 1) 作品级单件产出：2D 帧动画 GIF、2D 舞台拼版
  for (const portId of FEATURE_OUT_PORT_IDS) {
    for (const nodeId of nodeIds) {
      push(mediaPathOf(runStates[nodeId]?.outputs?.[portId]))
    }
  }

  // 2) 输出节点成片（图库末条；若上游为影视工作台等多镜批量节点则按镜头顺序全收；
  //    若为时间线合成 output.timeline，先收集上游生图/加工/视频节点的视觉产物，再追加成片视频）
  const outputNodes = findAllOutputNodes(graph)
  const outputNodeIdSet = new Set(outputNodes.map((n) => n.id))
  for (const node of outputNodes) {
    const outVal = runStates[node.id]?.outputs?.out
    if (node.typeId === 'output.timeline') {
      for (const upstreamId of nodeIds) {
        if (outputNodeIdSet.has(upstreamId)) continue
        collectFromNode(upstreamId, false)
      }
      push(mediaPathOf(outVal))
      continue
    }
    const hasMultiShotUpstream = graph.edges.some((edge) => {
      if (edge.target !== node.id) return false
      const src = byId.get(edge.source)
      return !!src?.typeId && MULTI_SHOT_SOURCE_TYPE_IDS.has(src.typeId)
    })
    if (hasMultiShotUpstream && pushAllItemPaths(outVal, push)) {
      continue
    }
    push(mediaPathOf(outVal))
  }

  // 3) 兜底：整图任一端口确有媒体产出时至少让结果可见（如只跑了单张生成节点或单跑 film.workbench）
  if (!paths.length) {
    const hasVisualNode = nodeIds.some((id) => {
      const node = byId.get(id)
      if (!node || node.locked) return false
      const outputs = runStates[id]?.outputs
      if (!outputs) return false
      return Object.values(outputs).some((v) => !isVoiceValue(v) && !!mediaPathOf(v))
    })
    for (const nodeId of nodeIds) {
      collectFromNode(nodeId, !hasVisualNode)
    }
  }

  return paths
}
