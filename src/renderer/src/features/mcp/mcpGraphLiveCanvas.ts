import type { GraphNode, GraphNodeParams, GraphNodeRunState } from '@shared/graph'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { graphRunHosts } from '../graph/model/graphRunHosts'
import { useWorkspaceStore } from '../../stores/workspace'

/** MCP 旁路跑图：打开宿主资产编辑器（节点图 / 剧本图等按资产类型路由） */
export function openMcpWorkflowAssetEditor(assetId: string): void {
  useWorkspaceStore().openEditorForAssetId(assetId)
}

const LIVE_CANVAS_HOST_WAIT_MS = 4_000
const LIVE_CANVAS_HOST_POLL_MS = 50

export async function waitForLiveCanvasHost(hostId: string): Promise<boolean> {
  for (let elapsed = 0; elapsed < LIVE_CANVAS_HOST_WAIT_MS; elapsed += LIVE_CANVAS_HOST_POLL_MS) {
    if (graphRunHosts.get(hostId)) return true
    await new Promise<void>((resolve) => window.setTimeout(resolve, LIVE_CANVAS_HOST_POLL_MS))
  }
  return !!graphRunHosts.get(hostId)
}

/** 与 useGraphRunSession.applyNodeUpdate 一致：不把 inputs 灌进 UI runStates */
function uiRunStateFromEngine(state: GraphNodeRunState): GraphNodeRunState {
  const { inputs: _inputs, ...rest } = state
  return { ...rest }
}

/** 后台任务节点态 → 已打开画布上的 runStates（前台 runGraph 进行中时不覆盖） */
export function syncLiveCanvasRunState(
  hostId: string,
  nodeId: string,
  state: GraphNodeRunState
): void {
  const host = graphRunHosts.get(hostId)
  if (!host || host.isRunning.value) return
  if (state.status === 'skipped') {
    const prev = host.runStates[nodeId]
    if (prev?.status !== 'pending' && prev?.status !== 'running') return
    host.runStates[nodeId] = { status: 'skipped' }
    return
  }
  // pending/running 只刷状态角标，保留已有 outputs，避免中间态整对象替换拖慢缩放帧
  if (state.status === 'pending' || state.status === 'running') {
    const prev = host.runStates[nodeId]
    host.runStates[nodeId] = {
      ...(prev?.outputs ? { outputs: prev.outputs } : {}),
      status: state.status,
      ...(state.error ? { error: state.error } : {})
    }
    return
  }
  host.runStates[nodeId] = uiRunStateFromEngine(state)
}

export function seedLiveCanvasRunStates(
  hostId: string,
  states: Record<string, GraphNodeRunState | undefined>
): void {
  for (const [nodeId, state] of Object.entries(states)) {
    if (state) syncLiveCanvasRunState(hostId, nodeId, state)
  }
}

/** 实时同步到画布的轻量字段：禁止灌入大段 text，否则 Vue 重渲染会堵死滚轮缩放 rAF */
const LIVE_CANVAS_PARAM_KEYS = new Set([
  'episodeReviewStatus',
  'episodeReviewReason',
  'episodeReviewPending'
])

function slimLiveCanvasParams(params: Partial<GraphNodeParams>): Partial<GraphNodeParams> | null {
  const slim: Partial<GraphNodeParams> = {}
  let hit = false
  for (const key of LIVE_CANVAS_PARAM_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(params, key)) continue
    ;(slim as Record<string, unknown>)[key] = (params as Record<string, unknown>)[key]
    hit = true
  }
  return hit ? slim : null
}

/** 后台任务 params 补丁 → 已打开画布节点（仅审核角标等轻量字段） */
export function syncLiveCanvasNodeParams(
  hostId: string,
  nodeId: string,
  params: Partial<GraphNodeParams>
): void {
  const slim = slimLiveCanvasParams(params)
  if (!slim) return
  graphEditorHosts.patchNodeParamsLive(hostId, nodeId, slim)
}

function episodeReviewMarksFromNode(node: GraphNode): Partial<GraphNodeParams> | null {
  const status = node.params?.episodeReviewStatus
  if (status !== 'PASS' && status !== 'FAIL') return null
  return {
    episodeReviewStatus: status,
    episodeReviewReason:
      typeof node.params?.episodeReviewReason === 'string' ? node.params.episodeReviewReason : '',
    episodeReviewPending: false
  }
}

/** 单个导演审核节点完成时，把 PASS/FAIL 同步到审核节点与对应 episodeStep 生成节点 */
export function syncLiveCanvasEpisodeReviewFromNode(
  hostId: string,
  nodes: GraphNode[],
  reviewNodeId: string
): void {
  const node = nodes.find((item) => item.id === reviewNodeId)
  if (!node?.params?.episodeReviewTarget) return
  const marks = episodeReviewMarksFromNode(node)
  if (!marks) return
  syncLiveCanvasNodeParams(hostId, reviewNodeId, marks)
  const target = node.params.episodeReviewTarget
  const upstream = nodes.find(
    (candidate) =>
      candidate.typeId === 'prompt.optimize' &&
      candidate.params?.episodeStep === target &&
      candidate.id !== reviewNodeId
  )
  if (upstream) syncLiveCanvasNodeParams(hostId, upstream.id, marks)
}
