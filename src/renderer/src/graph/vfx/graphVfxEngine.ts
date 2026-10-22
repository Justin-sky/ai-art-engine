import { ref } from 'vue'
import {
  getNodePortCenter,
  getNodeSize,
  type GraphDocument,
  type GraphNode,
  type GraphNodeRunStatus,
  type McpGraphEditOp
} from '@shared/graph'
import { editorPreferences } from '../../editor/preferences'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { i18n } from '../../i18n'

/** 画布 SLG 战术特效总开关（读取设置页偏好，默认开启） */
export function isCanvasVfxEnabled(): boolean {
  return editorPreferences.canvasVfxEnabled.value !== false
}

function getNodeWidth(node: GraphNode): number {
  return getNodeSize(node).w
}

function getNodeHeight(node: GraphNode): number {
  return getNodeSize(node).h
}

export type NodeVfxKind = 'spawn' | 'buff' | 'cook-done' | 'cook-error'

export interface NodeVfxEntry {
  nodeId: string
  kind: NodeVfxKind
  startedAt: number
  delayMs: number
  durationMs: number
}

export interface EdgeSpawnEntry {
  edgeId: string
  startedAt: number
  delayMs: number
  durationMs: number
  docked?: boolean
}

export type CanvasBurstKind =
  | 'spawn-shockwave'
  | 'buff-burst'
  | 'port-dock'
  | 'cook-done-burst'
  | 'cook-error-burst'
  | 'edge-sever'
  | 'group-territory'

export interface CanvasVfxBurst {
  id: string
  kind: CanvasBurstKind
  /** 世界坐标 x（矩形左上角或点中心） */
  x: number
  /** 世界坐标 y（矩形左上角或点中心） */
  y: number
  /** 世界坐标宽（矩形冲击波 / 战术准星框） */
  w?: number
  /** 世界坐标高 */
  h?: number
  /** 断线终点世界坐标 */
  toX?: number
  toY?: number
  startedAt: number
  delayMs: number
  durationMs: number
}

export interface GhostNodeVfx {
  id: string
  nodeId: string
  title: string
  x: number
  y: number
  w: number
  h: number
  startedAt: number
  durationMs: number
}

export type TacticalToastTone = 'spawn' | 'buff' | 'cook' | 'done' | 'error'

export interface TacticalToastVfx {
  id: string
  nodeId: string
  text: string
  tone: TacticalToastTone
  x: number
  y: number
  startedAt: number
  delayMs: number
  durationMs: number
}

export interface NodeFlipOffset {
  nodeId: string
  dx: number
  dy: number
  startedAt: number
  durationMs: number
}

export interface TacticalCameraFocusTarget {
  /** 目标战区世界包围盒 */
  bounds: { x: number; y: number; w: number; h: number }
  at: number
}

export interface EmitGraphDiffVfxOptions {
  source?: 'ai' | 'manual'
  reason?: string
  rawOps?: McpGraphEditOp[]
  fitView?: boolean
  nowMs?: number
}

interface HostVfxState {
  nodeEffects: Map<string, NodeVfxEntry>
  edgeSpawns: Map<string, EdgeSpawnEntry>
  canvasBursts: CanvasVfxBurst[]
  ghostNodes: GhostNodeVfx[]
  floatingToasts: TacticalToastVfx[]
  nodeFlipOffsets: Map<string, NodeFlipOffset>
  cameraFocusTarget: TacticalCameraFocusTarget | null
  wakeupListeners: Set<() => void>
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

const hostStates = new Map<string, HostVfxState>()

/** 供 Vue 模板层订阅 DOM 特效（节点 class / 幽灵残影 / 战术飘字）的轻量版本号 */
export const graphDomVfxRevision = ref(0)

let vfxSeq = 0
function nextVfxId(prefix: string): string {
  vfxSeq += 1
  return `${prefix}-${vfxSeq}`
}

function nowTime(explicit?: number): number {
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

function getOrCreateHostState(hostId: string): HostVfxState {
  let state = hostStates.get(hostId)
  if (!state) {
    state = {
      nodeEffects: new Map(),
      edgeSpawns: new Map(),
      canvasBursts: [],
      ghostNodes: [],
      floatingToasts: [],
      nodeFlipOffsets: new Map(),
      cameraFocusTarget: null,
      wakeupListeners: new Set(),
      cleanupTimer: null
    }
    hostStates.set(hostId, state)
  }
  return state
}

function notifyHostWakeup(state: HostVfxState): void {
  graphDomVfxRevision.value += 1
  for (const fn of state.wakeupListeners) {
    try {
      fn()
    } catch {
      /* ignore */
    }
  }
}

function pruneExpiredHostVfx(state: HostVfxState, now: number): boolean {
  let removedDom = false
  for (const [nodeId, entry] of state.nodeEffects) {
    if (now >= entry.startedAt + entry.delayMs + entry.durationMs) {
      state.nodeEffects.delete(nodeId)
      removedDom = true
    }
  }
  for (const [edgeId, entry] of state.edgeSpawns) {
    if (now >= entry.startedAt + entry.delayMs + entry.durationMs) {
      state.edgeSpawns.delete(edgeId)
    }
  }
  for (const [nodeId, flip] of state.nodeFlipOffsets) {
    if (now >= flip.startedAt + flip.durationMs) {
      state.nodeFlipOffsets.delete(nodeId)
    }
  }
  state.canvasBursts = state.canvasBursts.filter(
    (b) => now < b.startedAt + b.delayMs + b.durationMs
  )
  const prevGhosts = state.ghostNodes.length
  state.ghostNodes = state.ghostNodes.filter((g) => now < g.startedAt + g.durationMs)
  if (state.ghostNodes.length !== prevGhosts) removedDom = true

  const prevToasts = state.floatingToasts.length
  state.floatingToasts = state.floatingToasts.filter(
    (t) => now < t.startedAt + t.delayMs + t.durationMs
  )
  if (state.floatingToasts.length !== prevToasts) removedDom = true

  return removedDom
}

function scheduleDomVfxCleanup(hostId: string, state: HostVfxState, delayMs: number): void {
  if (typeof setTimeout === 'undefined') return
  if (state.cleanupTimer) clearTimeout(state.cleanupTimer)
  state.cleanupTimer = setTimeout(
    () => {
      state.cleanupTimer = null
      const now = nowTime()
      const changed = pruneExpiredHostVfx(state, now)
      if (changed) {
        graphDomVfxRevision.value += 1
      }
      // 若仍有未到期的 DOM 特效，继续排下一次清理
      let nextWait = Infinity
      for (const e of state.nodeEffects.values()) {
        nextWait = Math.min(nextWait, e.startedAt + e.delayMs + e.durationMs - now)
      }
      for (const g of state.ghostNodes) {
        nextWait = Math.min(nextWait, g.startedAt + g.durationMs - now)
      }
      for (const t of state.floatingToasts) {
        nextWait = Math.min(nextWait, t.startedAt + t.delayMs + t.durationMs - now)
      }
      if (Number.isFinite(nextWait) && nextWait > 0) {
        scheduleDomVfxCleanup(hostId, state, Math.min(1200, Math.max(60, nextWait + 24)))
      }
    },
    Math.max(40, delayMs)
  )
}

function edgeSignature(edge: {
  source: string
  target: string
  sourcePort?: string
  targetPort?: string
}): string {
  return `${edge.source}:${edge.sourcePort ?? 'out'}->${edge.target}:${edge.targetPort ?? 'in'}`
}

function shortText(val: unknown, maxLen = 14): string {
  const s = String(val ?? '').trim()
  if (!s) return ''
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s
}

/** 忽略纯后台预览图片数组写回，避免每次缓存落盘都重复弹「参数强化」 */
const SILENT_PARAM_KEYS = new Set([
  'previewRelativePath',
  'previewDataUrl',
  'generatedImages',
  'selectedImageId',
  'generatedVideos',
  'selectedVideoId',
  'generatedVoices',
  'selectedVoiceId',
  'generatedModels',
  'selectedModelId',
  'generatedTexts',
  'selectedTextId',
  'previewCollapsed',
  'sizeManuallyResized'
])

/** 同一节点同时只能有一条活动飘字（新飘字覆盖同节点旧飘字），并限制最大并发飘字数防拥挤 */
const MAX_CONCURRENT_TOASTS = 10
const MAX_BATCH_GHOST_NODES = 12
const MAX_BATCH_SHOCKWAVES = 16

function upsertFloatingToast(state: HostVfxState, toast: TacticalToastVfx): void {
  state.floatingToasts = state.floatingToasts.filter((item) => item.nodeId !== toast.nodeId)
  if (state.floatingToasts.length >= MAX_CONCURRENT_TOASTS) {
    state.floatingToasts.shift()
  }
  state.floatingToasts.push(toast)
}

/**
 * 对比同一节点在编辑前后的属性变化，提炼出 SLG 战术强化飘字（Buff Toast）。
 * 若仅内部缓存路径改变则返回 null。
 */
export function summarizeNodeBuffToast(
  before: GraphNode,
  after: GraphNode,
  rawOps?: McpGraphEditOp[]
): string | null {
  if (rawOps?.length) {
    for (const op of rawOps) {
      if (
        (op.op === 'apply_preset' ||
          ((op.op === 'node_update' || op.op === 'update_node' || op.op === 'node_upsert') &&
            typeof op.preset === 'string' &&
            op.preset.trim())) &&
        'nodeId' in op &&
        op.nodeId === after.id
      ) {
        const presetName = shortText(op.preset, 12)
        return presetName
          ? i18n.global.t('graphVfx.presetNamed', { name: presetName })
          : i18n.global.t('graphVfx.presetApplied')
      }
    }
  }

  // O(1) 引用快路：节点引用或参数/标题/锁定完全相同时直接跳过深度对比
  if (
    before === after ||
    (before.params === after.params &&
      (before.locked ?? false) === (after.locked ?? false) &&
      (before.title ?? '') === (after.title ?? ''))
  ) {
    return null
  }

  if ((before.locked ?? false) !== (after.locked ?? false)) {
    return after.locked ? i18n.global.t('graphVfx.locked') : i18n.global.t('graphVfx.unlocked')
  }

  const bp = (before.params ?? {}) as Record<string, unknown>
  const ap = (after.params ?? {}) as Record<string, unknown>

  const beforePrompt = bp.generateInstruction ?? bp.text ?? bp.script
  const afterPrompt = ap.generateInstruction ?? ap.text ?? ap.script
  if (afterPrompt !== undefined && afterPrompt !== beforePrompt && String(afterPrompt).trim()) {
    return i18n.global.t('graphVfx.instructionInjected')
  }

  const beforeRatio = bp.generateAspectRatio ?? bp.imageAspectRatio ?? bp.videoAspectRatio
  const afterRatio = ap.generateAspectRatio ?? ap.imageAspectRatio ?? ap.videoAspectRatio
  if (afterRatio !== undefined && afterRatio !== beforeRatio) {
    return i18n.global.t('graphVfx.aspectRatio', { value: shortText(afterRatio, 10) })
  }

  const beforeRes = bp.generateResolution ?? bp.imageSize ?? bp.videoResolution
  const afterRes = ap.generateResolution ?? ap.imageSize ?? ap.videoResolution
  if (afterRes !== undefined && afterRes !== beforeRes) {
    return i18n.global.t('graphVfx.resolution', { value: shortText(afterRes, 10) })
  }

  if (ap.generateModel !== undefined && ap.generateModel !== bp.generateModel) {
    return i18n.global.t('graphVfx.model', { value: shortText(ap.generateModel, 12) })
  }

  if (ap.styleImages !== bp.styleImages || ap.styleImagesUseGlobal !== bp.styleImagesUseGlobal) {
    return i18n.global.t('graphVfx.styleSynced')
  }

  if (ap.episodeReviewStatus !== bp.episodeReviewStatus && ap.episodeReviewStatus) {
    return ap.episodeReviewStatus === 'PASS'
      ? i18n.global.t('graphVfx.reviewPass')
      : i18n.global.t('graphVfx.reviewFail')
  }

  if ((before.title ?? '') !== (after.title ?? '') && after.title?.trim()) {
    return `🏷 ${shortText(after.title, 12)}`
  }

  if (before.params === after.params) return null

  // 检查是否有其它有意义的参数变更（先判引用相等，避免大数组无谓 JSON.stringify）
  const allKeys = new Set([...Object.keys(bp), ...Object.keys(ap)])
  let meaningfulChanged = false
  for (const key of allKeys) {
    if (SILENT_PARAM_KEYS.has(key)) continue
    if (bp[key] === ap[key]) continue
    if (JSON.stringify(bp[key]) !== JSON.stringify(ap[key])) {
      meaningfulChanged = true
      break
    }
  }
  return meaningfulChanged ? i18n.global.t('graphVfx.paramBuff') : null
}

function computeNodesWorldBounds(
  nodes: GraphNode[]
): { x: number; y: number; w: number; h: number } | null {
  if (!nodes.length) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const w = getNodeWidth(node)
    const h = getNodeHeight(node)
    minX = Math.min(minX, node.position.x)
    minY = Math.min(minY, node.position.y)
    maxX = Math.max(maxX, node.position.x + w)
    maxY = Math.max(maxY, node.position.y + h)
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
}

/**
 * 对比图文档前后快照，编排并派发 SLG 战术特效：
 * - 新建节点：分步时序空投 + 全息扫描线 + 落地冲击波 + 部署飘字
 * - 新建连线：沿路径发射高能光束 (0 -> 1) + 端口接驳爆闪
 * - 删除节点/连线：量子瓦解幽灵残影 + 激光断线火花
 * - 修改参数/预设：战术强化流光 + 头顶升级飘字
 * - 自动布局/位移：FLIP 阵型平滑滑行过渡
 */
export function emitGraphDiffVfx(
  hostId: string | null | undefined,
  before: GraphDocument | null | undefined,
  after: GraphDocument | null | undefined,
  options?: EmitGraphDiffVfxOptions
): void {
  if (!isCanvasVfxEnabled()) return
  const id = hostId?.trim()
  if (!id || !before || !after) return
  const now = nowTime(options?.nowMs)
  const state = getOrCreateHostState(id)
  pruneExpiredHostVfx(state, now)

  const beforeNodes = new Map<string, GraphNode>()
  for (const n of before.nodes ?? []) beforeNodes.set(n.id, n)

  const afterNodes = new Map<string, GraphNode>()
  for (const n of after.nodes ?? []) afterNodes.set(n.id, n)

  const addedNodes: GraphNode[] = []
  const removedNodes: GraphNode[] = []
  const movedNodes: Array<{ before: GraphNode; after: GraphNode }> = []
  const buffedNodes: Array<{ node: GraphNode; toast: string }> = []

  for (const node of after.nodes ?? []) {
    const prev = beforeNodes.get(node.id)
    if (!prev) {
      addedNodes.push(node)
      continue
    }
    const dx = prev.position.x - node.position.x
    const dy = prev.position.y - node.position.y
    if (Math.hypot(dx, dy) >= 16) {
      movedNodes.push({ before: prev, after: node })
    }
    const toast = summarizeNodeBuffToast(prev, node, options?.rawOps)
    if (toast) {
      buffedNodes.push({ node, toast })
    }
  }

  for (const prev of before.nodes ?? []) {
    if (!afterNodes.has(prev.id)) {
      removedNodes.push(prev)
    }
  }

  const beforeEdgeSigs = new Set((before.edges ?? []).map(edgeSignature))
  const afterEdgeSigs = new Set((after.edges ?? []).map(edgeSignature))

  const addedEdges = (after.edges ?? []).filter((e) => !beforeEdgeSigs.has(edgeSignature(e)))
  const removedEdges = (before.edges ?? []).filter((e) => !afterEdgeSigs.has(edgeSignature(e)))

  const beforeGroupIds = new Set((before.groups ?? []).map((g) => g.id))
  const addedGroups = (after.groups ?? []).filter((g) => !beforeGroupIds.has(g.id))

  if (
    !addedNodes.length &&
    !removedNodes.length &&
    !addedEdges.length &&
    !removedEdges.length &&
    !movedNodes.length &&
    !buffedNodes.length &&
    !addedGroups.length
  ) {
    return
  }

  let maxExpiryMs = 1500
  const isSquadronSpawn = addedNodes.length > 6

  // 1) 新建节点：分步时序空投（AI 批量创建或粘贴多节点时依次落位）
  addedNodes.forEach((node, idx) => {
    const delayMs = Math.min(1100, idx * 220)
    const durationMs = 1400
    const w = getNodeWidth(node)
    const h = getNodeHeight(node)
    state.nodeEffects.set(node.id, {
      nodeId: node.id,
      kind: 'spawn',
      startedAt: now,
      delayMs,
      durationMs
    })
    if (idx < MAX_BATCH_SHOCKWAVES) {
      state.canvasBursts.push({
        id: nextVfxId('burst-spawn'),
        kind: 'spawn-shockwave',
        x: node.position.x,
        y: node.position.y,
        w,
        h,
        startedAt: now,
        delayMs,
        durationMs: 1450
      })
    }
    if (!isSquadronSpawn) {
      const label = shortText(node.title || node.typeId || 'Node', 12)
      upsertFloatingToast(state, {
        id: nextVfxId('toast-spawn'),
        nodeId: node.id,
        text: i18n.global.t('graphVfx.deployed', { label }),
        tone: 'spawn',
        x: node.position.x + w / 2,
        y: node.position.y,
        startedAt: now,
        delayMs,
        durationMs: 2400
      })
    }
    maxExpiryMs = Math.max(maxExpiryMs, delayMs + 2450)
  })

  if (isSquadronSpawn) {
    const bounds = computeNodesWorldBounds(addedNodes)
    const anchor = addedNodes[0]!
    upsertFloatingToast(state, {
      id: nextVfxId('toast-squadron'),
      nodeId: `__squadron_${now}`,
      text: i18n.global.t('graphVfx.squadronDeployed', { count: addedNodes.length }),
      tone: 'spawn',
      x: bounds ? bounds.x + bounds.w / 2 : anchor.position.x + getNodeWidth(anchor) / 2,
      y: (bounds ? bounds.y : anchor.position.y) - 26,
      startedAt: now,
      delayMs: 80,
      durationMs: 2600
    })
  }

  // 2) 新建连线：等节点落位后依次发射能量管线（包含脉冲推进 + 接驳后全线高能余晖）
  const baseEdgeDelay = addedNodes.length > 0 ? Math.min(720, addedNodes.length * 160 + 220) : 0
  addedEdges.forEach((edge, idx) => {
    const delayMs = Math.min(1300, baseEdgeDelay + idx * 180)
    const durationMs = 1050
    state.edgeSpawns.set(edge.id, {
      edgeId: edge.id,
      startedAt: now,
      delayMs,
      durationMs,
      docked: false
    })
    maxExpiryMs = Math.max(maxExpiryMs, delayMs + durationMs + 900)
  })

  // 3) 删除节点：生成量子瓦解幽灵残影 + 警示脉冲环（超大批次按 LOD 截断以保 60fps）
  removedNodes.slice(0, MAX_BATCH_GHOST_NODES).forEach((prev, idx) => {
    const w = getNodeWidth(prev)
    const h = getNodeHeight(prev)
    state.ghostNodes.push({
      id: nextVfxId('ghost'),
      nodeId: prev.id,
      title: prev.title || prev.typeId || prev.id,
      x: prev.position.x,
      y: prev.position.y,
      w,
      h,
      startedAt: now,
      durationMs: 1100
    })
    if (idx < MAX_BATCH_SHOCKWAVES) {
      state.canvasBursts.push({
        id: nextVfxId('burst-destroy'),
        kind: 'cook-error-burst',
        x: prev.position.x,
        y: prev.position.y,
        w,
        h,
        startedAt: now,
        delayMs: 0,
        durationMs: 1150
      })
    }
    maxExpiryMs = Math.max(maxExpiryMs, 1200)
  })

  // 4) 删除连线：沿旧连线迸发断线电弧回缩与火花粒子
  removedEdges.slice(0, MAX_BATCH_SHOCKWAVES).forEach((edge, idx) => {
    const srcNode = beforeNodes.get(edge.source)
    const dstNode = beforeNodes.get(edge.target)
    if (!srcNode || !dstNode) return
    const p1 = getNodePortCenter(srcNode, 'right', edge.sourcePort)
    const p2 = getNodePortCenter(dstNode, 'left', edge.targetPort)
    state.canvasBursts.push({
      id: nextVfxId('burst-sever'),
      kind: 'edge-sever',
      x: p1.x,
      y: p1.y,
      toX: p2.x,
      toY: p2.y,
      startedAt: now,
      delayMs: 0,
      durationMs: 1350
    })
    if (idx === 0 && removedNodes.length === 0) {
      upsertFloatingToast(state, {
        id: nextVfxId('toast-sever'),
        nodeId: `__edge_sever_${edge.id}`,
        text: i18n.global.t('graphVfx.edgeSevered'),
        tone: 'error',
        x: (p1.x + p2.x) * 0.5,
        y: (p1.y + p2.y) * 0.5 + 16,
        startedAt: now,
        delayMs: 0,
        durationMs: 1650
      })
    }
    maxExpiryMs = Math.max(maxExpiryMs, 1700)
  })

  // 5) 节点位移（自动布局 / 对齐 / 编排）：记录 FLIP 偏移，驱动卡片与连线平滑变阵
  for (const item of movedNodes) {
    state.nodeFlipOffsets.set(item.after.id, {
      nodeId: item.after.id,
      dx: item.before.position.x - item.after.position.x,
      dy: item.before.position.y - item.after.position.y,
      startedAt: now,
      durationMs: 820
    })
    maxExpiryMs = Math.max(maxExpiryMs, 860)
  }

  // 6) 修改参数 / 预设强化：升级流光 + 战术飘字
  const baseBuffDelay =
    addedNodes.length > 0 || addedEdges.length > 0
      ? Math.min(960, baseEdgeDelay + addedEdges.length * 140)
      : 0
  buffedNodes.forEach(({ node, toast }, idx) => {
    const delayMs = Math.min(1200, baseBuffDelay + idx * 160)
    const w = getNodeWidth(node)
    const h = getNodeHeight(node)
    state.nodeEffects.set(node.id, {
      nodeId: node.id,
      kind: 'buff',
      startedAt: now,
      delayMs,
      durationMs: 1500
    })
    if (idx < MAX_BATCH_SHOCKWAVES) {
      state.canvasBursts.push({
        id: nextVfxId('burst-buff'),
        kind: 'buff-burst',
        x: node.position.x,
        y: node.position.y,
        w,
        h,
        startedAt: now,
        delayMs,
        durationMs: 1550
      })
    }
    upsertFloatingToast(state, {
      id: nextVfxId('toast-buff'),
      nodeId: node.id,
      text: toast,
      tone: 'buff',
      x: node.position.x + w / 2,
      y: node.position.y,
      startedAt: now,
      delayMs,
      durationMs: 2400
    })
    maxExpiryMs = Math.max(maxExpiryMs, delayMs + 2450)
  })

  // 7) 新建编组（领地圈定）
  for (const group of addedGroups) {
    const members = (after.nodes ?? []).filter((n) => n.groupId === group.id)
    const bounds = computeNodesWorldBounds(members)
    if (!bounds) continue
    const pad = 20
    state.canvasBursts.push({
      id: nextVfxId('burst-group'),
      kind: 'group-territory',
      x: bounds.x - pad,
      y: bounds.y - pad - 24,
      w: bounds.w + pad * 2,
      h: bounds.h + pad * 2 + 24,
      startedAt: now,
      delayMs: 0,
      durationMs: 1400
    })
    maxExpiryMs = Math.max(maxExpiryMs, 1450)
  }

  // 8) AI 指挥官镜头引导：若未走整图 fitView，自动记录本次触达的战区包围盒供视口平滑聚焦
  if (options?.source === 'ai' && !options?.fitView) {
    const focusNodes: GraphNode[] = [
      ...addedNodes,
      ...buffedNodes.map((b) => b.node),
      ...movedNodes.map((m) => m.after)
    ]
    const bounds = computeNodesWorldBounds(focusNodes)
    if (bounds) {
      state.cameraFocusTarget = { bounds, at: now }
    }
  }

  notifyHostWakeup(state)
  scheduleDomVfxCleanup(id, state, maxExpiryMs)
}

/**
 * 节点 Cook（运行）状态跃迁特效：
 * - -> running：熔炉启动冲击波 + 飘字「🔥 熔炼启动」
 * - running/pending -> done/degraded：出炉完成双层冲击波 + 星芒粒子 + 卡片斜向高光揭幕 + 飘字「✦ 锻造完成」
 * - -> error：EMP 故障震动 + 红色警示脉冲 + 飘字「⚠ 熔炼异常」
 */
export function emitNodeCookVfx(
  hostId: string | null | undefined,
  nodeId: string,
  prevStatus: GraphNodeRunStatus | undefined,
  nextStatus: GraphNodeRunStatus | undefined,
  nodeSnapshot?: GraphNode | null,
  explicitNowMs?: number
): void {
  if (!isCanvasVfxEnabled()) return
  const id = hostId?.trim()
  if (!id || !nodeId || prevStatus === nextStatus) return
  const node = nodeSnapshot ?? graphEditorHosts.getNode(id, nodeId)
  if (!node) return

  const now = nowTime(explicitNowMs)
  const state = getOrCreateHostState(id)
  pruneExpiredHostVfx(state, now)

  const w = getNodeWidth(node)
  const h = getNodeHeight(node)

  if (nextStatus === 'running' && prevStatus !== 'running') {
    state.canvasBursts.push({
      id: nextVfxId('burst-cook-start'),
      kind: 'spawn-shockwave',
      x: node.position.x,
      y: node.position.y,
      w,
      h,
      startedAt: now,
      delayMs: 0,
      durationMs: 1350
    })
    upsertFloatingToast(state, {
      id: nextVfxId('toast-cook-start'),
      nodeId: node.id,
      text: i18n.global.t('graphVfx.cookStart'),
      tone: 'cook',
      x: node.position.x + w / 2,
      y: node.position.y,
      startedAt: now,
      delayMs: 0,
      durationMs: 2200
    })
    notifyHostWakeup(state)
    scheduleDomVfxCleanup(id, state, 2250)
    return
  }

  if (
    (nextStatus === 'done' || nextStatus === 'degraded') &&
    (prevStatus === 'running' || prevStatus === 'pending')
  ) {
    state.nodeEffects.set(node.id, {
      nodeId: node.id,
      kind: 'cook-done',
      startedAt: now,
      delayMs: 0,
      durationMs: 1650
    })
    state.canvasBursts.push({
      id: nextVfxId('burst-cook-done'),
      kind: 'cook-done-burst',
      x: node.position.x,
      y: node.position.y,
      w,
      h,
      startedAt: now,
      delayMs: 0,
      durationMs: 1700
    })
    upsertFloatingToast(state, {
      id: nextVfxId('toast-cook-done'),
      nodeId: node.id,
      text: i18n.global.t('graphVfx.cookDone'),
      tone: 'done',
      x: node.position.x + w / 2,
      y: node.position.y,
      startedAt: now,
      delayMs: 0,
      durationMs: 2500
    })
    notifyHostWakeup(state)
    scheduleDomVfxCleanup(id, state, 2550)
    return
  }

  if (nextStatus === 'error' && prevStatus !== 'error') {
    state.nodeEffects.set(node.id, {
      nodeId: node.id,
      kind: 'cook-error',
      startedAt: now,
      delayMs: 0,
      durationMs: 1200
    })
    state.canvasBursts.push({
      id: nextVfxId('burst-cook-err'),
      kind: 'cook-error-burst',
      x: node.position.x,
      y: node.position.y,
      w,
      h,
      startedAt: now,
      delayMs: 0,
      durationMs: 1250
    })
    upsertFloatingToast(state, {
      id: nextVfxId('toast-cook-err'),
      nodeId: node.id,
      text: i18n.global.t('graphVfx.cookError'),
      tone: 'error',
      x: node.position.x + w / 2,
      y: node.position.y,
      startedAt: now,
      delayMs: 0,
      durationMs: 2600
    })
    notifyHostWakeup(state)
    scheduleDomVfxCleanup(id, state, 2650)
  }
}

/** 当新连线光束到达目标端口时，在目标端口触发一次接驳爆闪 */
export function triggerPortDockBurst(
  hostId: string | null | undefined,
  worldX: number,
  worldY: number,
  nowMs?: number
): void {
  if (!isCanvasVfxEnabled()) return
  const id = hostId?.trim()
  if (!id) return
  const state = getOrCreateHostState(id)
  state.canvasBursts.push({
    id: nextVfxId('burst-dock'),
    kind: 'port-dock',
    x: worldX,
    y: worldY,
    startedAt: nowTime(nowMs),
    delayMs: 0,
    durationMs: 850
  })
}

/** 是否有需要 Canvas rAF 循环持续重绘的活动特效 */
export function hasActiveCanvasVfx(hostId: string | null | undefined, nowMs?: number): boolean {
  if (!isCanvasVfxEnabled()) return false
  const id = hostId?.trim()
  if (!id) return false
  const state = hostStates.get(id)
  if (!state) return false
  const now = nowTime(nowMs)
  pruneExpiredHostVfx(state, now)
  return (
    state.edgeSpawns.size > 0 || state.canvasBursts.length > 0 || state.nodeFlipOffsets.size > 0
  )
}

/** 获取当前帧 Canvas 需要绘制的连线生长、冲击波与 FLIP 位移状态 */
export function getActiveCanvasVfxSnapshot(
  hostId: string | null | undefined,
  nowMs?: number
): {
  edgeSpawns: Map<string, EdgeSpawnEntry>
  canvasBursts: CanvasVfxBurst[]
  nodeFlipOffsets: Map<string, NodeFlipOffset>
} | null {
  if (!isCanvasVfxEnabled()) return null
  const id = hostId?.trim()
  if (!id) return null
  const state = hostStates.get(id)
  if (!state) return null
  const now = nowTime(nowMs)
  pruneExpiredHostVfx(state, now)
  if (
    state.edgeSpawns.size === 0 &&
    state.canvasBursts.length === 0 &&
    state.nodeFlipOffsets.size === 0
  ) {
    return null
  }
  return {
    edgeSpawns: state.edgeSpawns,
    canvasBursts: state.canvasBursts,
    nodeFlipOffsets: state.nodeFlipOffsets
  }
}

/** 计算节点在当前时刻的 FLIP 视觉插值偏移（cubic-bezier out 近似） */
export function getNodeFlipWorldOffset(
  hostId: string | null | undefined,
  nodeId: string,
  nowMs?: number
): { dx: number; dy: number } | null {
  if (!isCanvasVfxEnabled()) return null
  const id = hostId?.trim()
  if (!id) return null
  const state = hostStates.get(id)
  const flip = state?.nodeFlipOffsets.get(nodeId)
  if (!flip) return null
  const now = nowTime(nowMs)
  const elapsed = now - flip.startedAt
  if (elapsed >= flip.durationMs) {
    state?.nodeFlipOffsets.delete(nodeId)
    return null
  }
  if (elapsed <= 0) return { dx: flip.dx, dy: flip.dy }
  const t = Math.min(1, Math.max(0, elapsed / flip.durationMs))
  // easeOutCubic: (1 - t)^3
  const remain = Math.pow(1 - t, 3)
  return { dx: flip.dx * remain, dy: flip.dy * remain }
}

/** 读取当前宿主画布的 DOM 特效快照（供模板绑定 class、幽灵残影与战术飘字） */
export function getActiveDomVfxSnapshot(hostId: string | null | undefined): {
  nodeEffects: Map<string, NodeVfxEntry>
  ghostNodes: GhostNodeVfx[]
  floatingToasts: TacticalToastVfx[]
} {
  void graphDomVfxRevision.value
  if (!isCanvasVfxEnabled()) {
    return { nodeEffects: new Map(), ghostNodes: [], floatingToasts: [] }
  }
  const id = hostId?.trim()
  if (!id) {
    return { nodeEffects: new Map(), ghostNodes: [], floatingToasts: [] }
  }
  const state = hostStates.get(id)
  if (!state) {
    return { nodeEffects: new Map(), ghostNodes: [], floatingToasts: [] }
  }
  return {
    nodeEffects: state.nodeEffects,
    ghostNodes: state.ghostNodes,
    floatingToasts: state.floatingToasts
  }
}

/** 消费一次 AI 战区镜头聚焦目标 */
export function consumeCameraFocusTarget(
  hostId: string | null | undefined
): TacticalCameraFocusTarget | null {
  const id = hostId?.trim()
  if (!id) return null
  const state = hostStates.get(id)
  if (!state || !state.cameraFocusTarget) return null
  const target = state.cameraFocusTarget
  state.cameraFocusTarget = null
  return target
}

/** 订阅某画布宿主的特效唤醒通知（用于立即启动 rAF 循环与执行 FLIP / 镜头平滑平移） */
export function subscribeHostVfxWakeup(hostId: string, listener: () => void): () => void {
  const state = getOrCreateHostState(hostId)
  state.wakeupListeners.add(listener)
  return () => {
    state.wakeupListeners.delete(listener)
  }
}

/** 清理指定宿主的全部特效状态（测试或组件卸载用） */
export function clearHostVfx(hostId?: string): void {
  if (hostId) {
    const state = hostStates.get(hostId)
    if (state?.cleanupTimer) clearTimeout(state.cleanupTimer)
    hostStates.delete(hostId)
  } else {
    for (const state of hostStates.values()) {
      if (state.cleanupTimer) clearTimeout(state.cleanupTimer)
    }
    hostStates.clear()
  }
  graphDomVfxRevision.value += 1
}
