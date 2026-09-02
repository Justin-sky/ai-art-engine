<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type {
  AgentRuntimeStatus,
  OrchestratorJob,
  OrchestratorNodeState,
  OrchestratorRunInput
} from '@shared/ipc'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptConfirm } from '../composables/useStudioPrompt'
import { copyTextToClipboard } from '../utils/copyText'
import {
  DAG_CHIP_H,
  DAG_CHIP_W,
  canAddDependency,
  layoutDag,
  sanitizeDagDependencies,
  validateDagNodes,
  type DagLayout,
  type DagNodeError
} from '../utils/orchDagLayout'
import { openFullImagePreview } from '../features/media/openFullImagePreview'

/** 面板可编排节点上限（与主进程校验一致） */
const MAX_NODES = 12

const { t } = useStudioI18n()

const props = defineProps<{
  /** 全部 agent（含运行状态）；面板据此渲染角色下拉 */
  agents: AgentRuntimeStatus[]
}>()

/** 编排节点推进/结束 → 父层刷新 agent 运行状态点 */
const emit = defineEmits<{
  (e: 'status-change'): void
}>()

/* ── 新建编排表单 ── */
const goal = ref('')
const jobTitle = ref('')
const nodes = ref<OrchestratorRunInput['nodes']>([])
const formError = ref('')
const submitting = ref(false)
const planning = ref(false)
const planInfo = ref('')
let nodeSeq = 0

/** 单条编排记录的展示模式（flow 列表 / graph 连线图）；未记录时按节点数给默认值 */
const viewMode = ref<Record<string, 'flow' | 'graph'>>({})
/** 连线图模式下选中的节点（jobId → nodeId），详情展示在图上 */
const graphSel = ref<Record<string, string>>({})
/** job 对象 → DAG 布局缓存（job 对象随事件替换，旧对象自然被 GC） */
const layoutCache = new WeakMap<OrchestratorJob, DagLayout>()

/** 可编排角色：缺省助手不参与（会与用户主会话互相干扰） */
const selectableAgents = computed(() => props.agents.filter((a) => a.agentId !== 'default'))

function defaultAgent(): string {
  const planner = selectableAgents.value.find((a) => a.agentId === 'planner')
  return planner?.agentId ?? selectableAgents.value[0]?.agentId ?? ''
}

function addNode(): void {
  if (nodes.value.length >= MAX_NODES) return
  nodeSeq += 1
  nodes.value.push({
    id: `n${nodeSeq}`,
    agentId: defaultAgent(),
    instruction: '',
    dependsOn: []
  })
}

function removeNode(index: number): void {
  const removedId = nodes.value[index]?.id
  nodes.value.splice(index, 1)
  // 同步清理其他节点对该节点的依赖引用
  if (removedId) {
    for (const node of nodes.value) {
      node.dependsOn = (node.dependsOn ?? []).filter((d) => d !== removedId)
    }
  }
}

/* ── 新建表单：迷你 DAG 画布（拖拽建立依赖 / 点击连线删除） ── */
const draftCanvasEl = ref<HTMLDivElement | null>(null)
const dragState = ref<{ fromId: string; x: number; y: number; overId: string | null } | null>(
  null
)
const canvasMsg = ref('')
const canvasMsgKind = ref<'warn' | 'info'>('info')
let canvasMsgTimer: number | null = null
let dragCleanup: (() => void) | null = null

/** 画布拓扑数据（只取布局所需字段；节点增删/连线/改名都会实时重排） */
const draftDagNodes = computed(() =>
  nodes.value.map((n) => ({ id: n.id, dependsOn: n.dependsOn ?? [] }))
)
const draftLayout = computed(() => layoutDag(draftDagNodes.value))

function agentColor(agentId: string): string | undefined {
  return props.agents.find((a) => a.agentId === agentId)?.color
}

/** 指针位置 → 画布内容坐标（随滚动自动换算：内容盒 rect 随滚动位移） */
function canvasPoint(e: PointerEvent): { x: number; y: number } {
  const rect = draftCanvasEl.value?.getBoundingClientRect()
  if (!rect) return { x: e.clientX, y: e.clientY }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function beginDraftDrag(e: PointerEvent, fromId: string): void {
  if (e.button !== 0 || dragState.value) return
  e.preventDefault()
  const pos = canvasPoint(e)
  dragState.value = { fromId, x: pos.x, y: pos.y, overId: null }
  const onMove = (ev: PointerEvent): void => {
    const s = dragState.value
    if (!s) return
    const p = canvasPoint(ev)
    s.x = p.x
    s.y = p.y
    const hit = (ev.target as Element | null)?.closest?.(
      '[data-draft-node-id]'
    ) as HTMLElement | null
    s.overId = hit?.dataset.draftNodeId ?? null
  }
  const onUp = (): void => {
    detachDraftDrag()
    const s = dragState.value
    dragState.value = null
    if (s?.overId && s.overId !== s.fromId) applyDraftDrop(s.fromId, s.overId)
  }
  const onCancel = (): void => {
    detachDraftDrag()
    dragState.value = null
  }
  dragCleanup = () => {
    window.removeEventListener('pointermove', onMove, true)
    window.removeEventListener('pointerup', onUp, true)
    window.removeEventListener('pointercancel', onCancel, true)
    dragCleanup = null
  }
  window.addEventListener('pointermove', onMove, true)
  window.addEventListener('pointerup', onUp, true)
  window.addEventListener('pointercancel', onCancel, true)
}

function detachDraftDrag(): void {
  dragCleanup?.()
}

/** 落点校验通过后建边：来源 A 拖到目标 B 上 → B 的 dependsOn 追加 A（箭头 A→B） */
function applyDraftDrop(fromId: string, toId: string): void {
  const check = canAddDependency(draftDagNodes.value, fromId, toId)
  if (!check.ok) {
    if (check.reason === 'cycle') {
      showCanvasMsg(t('studio.orchestrator.canvasCycle'), 'warn')
    }
    return
  }
  const target = nodes.value.find((n) => n.id === toId)
  if (target) target.dependsOn = [...(target.dependsOn ?? []), fromId]
}

/** 点击连线删除该依赖：从「目标节点」的 dependsOn 里移除来源节点 */
function removeDraftEdge(fromId: string, toId: string): void {
  const node = nodes.value.find((n) => n.id === toId)
  if (!node) return
  node.dependsOn = (node.dependsOn ?? []).filter((d) => d !== fromId)
}

function showCanvasMsg(text: string, kind: 'warn' | 'info'): void {
  canvasMsg.value = text
  canvasMsgKind.value = kind
  if (canvasMsgTimer) window.clearTimeout(canvasMsgTimer)
  canvasMsgTimer = window.setTimeout(() => {
    canvasMsg.value = ''
  }, 2400)
}

/** 拖拽中的临时连线：从来源卡片右侧锚点到当前指针；悬停在非法落点（成环）变红 */
const tempEdge = computed(() => {
  const s = dragState.value
  if (!s) return null
  const from = draftLayout.value.posBy.get(s.fromId)
  if (!from) return null
  const path = edgePath(from.x + DAG_CHIP_W, from.y + DAG_CHIP_H / 2, s.x, s.y)
  const invalid = Boolean(s.overId) && !canAddDependency(draftDagNodes.value, s.fromId, s.overId!).ok
  return { path, invalid }
})

function onResizeTextarea(event: Event): void {
  const el = event.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function clearForm(): void {
  detachDraftDrag()
  dragState.value = null
  canvasMsg.value = ''
  goal.value = ''
  jobTitle.value = ''
  nodes.value = []
  formError.value = ''
  planInfo.value = ''
}

/** 智能拆解：把总目标交给策划 Agent，用返回的节点草案填充下方表单（可继续编辑后运行） */
async function onAutoPlan(): Promise<void> {
  formError.value = ''
  planInfo.value = ''
  if (!goal.value.trim()) {
    formError.value = t('studio.orchestrator.noGoalPlan')
    return
  }
  if (planning.value || submitting.value) return
  if (nodes.value.length) {
    const ok = await promptConfirm({
      title: t('studio.orchestrator.planReplaceTitle'),
      message: t('studio.orchestrator.planReplaceMessage', { n: nodes.value.length }),
      confirmLabel: t('studio.orchestrator.autoPlan')
    })
    if (!ok) return
  }
  planning.value = true
  try {
    const result = await window.studio.planOrchestrator({ goal: goal.value.trim() })
    if (!result.ok) {
      formError.value = result.message ?? t('studio.orchestrator.planFailed')
      return
    }
    const planned = (result.nodes ?? []).map((n) => ({
      id: n.id,
      agentId: n.agentId,
      instruction: n.instruction,
      dependsOn: n.dependsOn?.length ? [...n.dependsOn] : []
    }))
    if (!planned.length) {
      formError.value = t('studio.orchestrator.planFailed')
      return
    }
    // 拆解结果写回前兜底清洗：剔除 self / 悬空 / 成环依赖，保证节点集可直接提交
    const repaired = sanitizeDagDependencies(planned)
    nodes.value = planned
    nodeSeq = Math.max(nodeSeq, planned.length)
    const base = t('studio.orchestrator.planSuccess', { n: planned.length })
    planInfo.value =
      repaired > 0
        ? `${base} ${t('studio.orchestrator.planRepaired', { n: repaired })}`
        : base
  } catch {
    formError.value = t('studio.orchestrator.planFailed')
  } finally {
    planning.value = false
  }
}

// agent 列表异步就绪后，为「早先创建但未选角色」的节点草稿回填默认角色
watch(
  () => props.agents,
  () => {
    if (!nodes.value.length) return
    const fallback = defaultAgent()
    if (!fallback) return
    for (const node of nodes.value) {
      if (!node.agentId) node.agentId = fallback
    }
  }
)

async function submit(): Promise<void> {
  formError.value = ''
  if (!goal.value.trim()) {
    formError.value = t('studio.orchestrator.noGoal')
    return
  }
  if (submitting.value) return
  const payloadNodes = nodes.value.map((n, index) => ({
    // id 留空时自动补位，避免主进程校验报「id 非法」
    id: String(n.id ?? '').trim() || `n${index + 1}`,
    agentId: n.agentId,
    instruction: n.instruction,
    dependsOn: n.dependsOn?.length ? [...n.dependsOn] : []
  }))
  // 提交前整体校验（口径与主进程 runOrchestrator 一致），命中即内联定位首个问题
  const dagCheck = validateDagNodes(payloadNodes)
  if (!dagCheck.ok) {
    formError.value = describeDagError(dagCheck.errors[0]!)
    return
  }
  submitting.value = true
  try {
    const result = await window.studio.runOrchestrator({
      goal: goal.value.trim(),
      ...(jobTitle.value.trim() ? { title: jobTitle.value.trim() } : {}),
      nodes: payloadNodes
    })
    if (!result.ok) {
      formError.value = result.message ?? t('studio.orchestrator.runError')
      return
    }
    // 提交成功：保留表单便于微调重跑，仅清空错误提示并等事件刷新记录
    formError.value = ''
    void refreshJobs()
  } catch {
    formError.value = t('studio.orchestrator.runError')
  } finally {
    submitting.value = false
  }
}

/* ── 编排记录（主进程内存态，随 ORCHESTRATOR_EVENT 增量刷新） ── */
const jobs = ref<OrchestratorJob[]>([])
const openJob = ref<Record<string, boolean>>({})
const openNode = ref<Record<string, boolean>>({})
const copiedKey = ref('')
let stopEvents: (() => void) | null = null

const runningCount = computed(() => jobs.value.filter((j) => j.state === 'running').length)

async function refreshJobs(): Promise<void> {
  try {
    jobs.value = await window.studio.listOrchestratorJobs()
  } catch {
    jobs.value = []
  }
}

function upsertJob(job: OrchestratorJob): void {
  const index = jobs.value.findIndex((j) => j.jobId === job.jobId)
  if (index >= 0) {
    jobs.value[index] = job
  } else {
    jobs.value.unshift(job)
  }
  // 未展开过的新 job 自动展开，便于看到进度
  if (!(job.jobId in openJob.value)) {
    openJob.value[job.jobId] = true
  }
}

onMounted(() => {
  void refreshJobs()
  stopEvents = window.studio.onOrchestratorEvent(({ job }) => {
    upsertJob(job)
    // 节点运行/结束会改变 agent 占用状态，让父层刷新标签运行点
    emit('status-change')
  })
})

onBeforeUnmount(() => {
  detachDraftDrag()
  if (canvasMsgTimer) window.clearTimeout(canvasMsgTimer)
  stopEvents?.()
})

/** 展示用排序：运行中的置顶，其余按创建时间倒序 */
const sortedJobs = computed(() =>
  [...jobs.value].sort((a, b) => {
    const ar = a.state === 'running' ? 1 : 0
    const br = b.state === 'running' ? 1 : 0
    return br - ar || b.createdAt - a.createdAt
  })
)

/** 记录当前展示模式；未设置过时按节点数给默认值（多节点默认看连线图） */
function viewOf(job: OrchestratorJob): 'flow' | 'graph' {
  return viewMode.value[job.jobId] ?? (job.nodes.length > 1 ? 'graph' : 'flow')
}

function setView(jobId: string, mode: 'flow' | 'graph'): void {
  viewMode.value[jobId] = mode
}

/** 取（并缓存）job 的 DAG 布局：同一 job 对象在一次渲染内只算一次 */
function layoutFor(job: OrchestratorJob): DagLayout {
  let layout = layoutCache.get(job)
  if (!layout) {
    layout = layoutDag(job.nodes.map((n) => ({ id: n.id, dependsOn: n.dependsOn })))
    layoutCache.set(job, layout)
  }
  return layout
}

/** 连线图：依赖节点（from）颜色决定连线色调，让失败/跳过快照一眼可见 */
function edgeToneClass(job: OrchestratorJob, fromId: string): string {
  const dep = job.nodes.find((n) => n.id === fromId)
  if (!dep) return ''
  if (dep.state === 'failed') return 'is-failed'
  if (dep.state === 'skipped') return 'is-skipped'
  if (dep.state === 'done') return 'is-done'
  return ''
}

/** 连线图：贝塞尔路径（from 右侧中心 → to 左侧中心，始终向右） */
function edgePath(fromX: number, fromY: number, toX: number, toY: number): string {
  const mx = fromX + (toX - fromX) / 2
  return `M ${fromX} ${fromY} C ${mx} ${fromY}, ${mx} ${toY}, ${toX} ${toY}`
}

interface GraphDetail {
  node: OrchestratorNodeState
  copyKey: string
}

/** 连线图：点击卡片选中/取消，选中后在图下展示该节点详情 */
function onGraphChip(jobId: string, nodeId: string): void {
  graphSel.value[jobId] = graphSel.value[jobId] === nodeId ? '' : nodeId
}

/** 连线图：返回 0/1 个选中节点详情（模板里用 v-for 规避可选访问） */
function selectedNodeDetails(jobId: string, job: OrchestratorJob): GraphDetail[] {
  const id = graphSel.value[jobId]
  const node = id ? job.nodes.find((n) => n.id === id) : undefined
  if (!node) return []
  return [{ node, copyKey: `g:${jobId}:${node.id}` }]
}

function agentName(id: string): string {
  return props.agents.find((a) => a.agentId === id)?.name ?? id
}

function stateLabel(job: OrchestratorJob): string {
  const key = `studio.orchestrator.state${job.state[0].toUpperCase()}${job.state.slice(1)}`
  return t(key)
}

function nodeStateLabel(state: OrchestratorNodeState['state']): string {
  const key = `studio.orchestrator.state${state[0].toUpperCase()}${state.slice(1)}`
  return t(key)
}

function fmtTime(ts?: number): string {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString()
}

function jobDuration(job: OrchestratorJob): string {
  const end = job.finishedAt ?? Date.now()
  const secs = Math.max(0, Math.round((end - job.createdAt) / 1000))
  if (secs < 60) return `${secs}s`
  const m = Math.floor(secs / 60)
  return `${m}m${secs % 60}s`
}

function toggleJob(jobId: string): void {
  openJob.value[jobId] = !openJob.value[jobId]
}

function toggleNode(jobId: string, nodeId: string): void {
  const key = `${jobId}:${nodeId}`
  openNode.value[key] = !openNode.value[key]
}

function nodeKey(jobId: string, nodeId: string): string {
  return `${jobId}:${nodeId}`
}

/** 节点集校验错误 → 内联文案（formError 展示，先让用户看到首个需修正的问题） */
function describeDagError(error: DagNodeError): string {
  const id = error.id.trim() || t('studio.orchestrator.unnamedNode')
  switch (error.kind) {
    case 'bad-id':
      return t('studio.orchestrator.valBadId', { id })
    case 'dup-id':
      return t('studio.orchestrator.valDupId', { id })
    case 'empty-agent':
      return t('studio.orchestrator.valNoAgent', { id })
    case 'self-dep':
      return t('studio.orchestrator.valSelfDep', { id })
    case 'missing-dep':
      return t('studio.orchestrator.valMissingDep', { id, dep: error.dep })
    case 'cycle':
      return t('studio.orchestrator.valCycle', { id })
  }
}

/** 可预览的产出文件扩展名（图/音/视；纯文本类只复制路径、不弹预览） */
const PREVIEWABLE_FILE_RE = /\.(png|jpe?g|webp|gif|avif|bmp|mp4|webm|mov|mkv|mp3|wav|ogg|m4a|aac|flac)(\?|#|$)/i

function canPreviewFile(rel: string): boolean {
  return PREVIEWABLE_FILE_RE.test(rel)
}

/** 预览工程内产出文件（getAssetFileUrl → studio-media，图片/视频/音频自适应） */
async function previewOutputFile(rel: string, title?: string): Promise<void> {
  await openFullImagePreview({ relativePath: rel, title: title ?? rel })
}

/** 产出文件行的复制反馈 key（同一节点详情内唯一） */
function outputFileKey(scope: string, file: string): string {
  return `${scope}:of:${file}`
}

async function onCopy(text: string | undefined, key: string): Promise<void> {
  if (!text) return
  const ok = await copyTextToClipboard(text)
  if (ok) {
    copiedKey.value = key
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = ''
    }, 1600)
  }
}

async function onAbort(job: OrchestratorJob): Promise<void> {
  const ok = await promptConfirm({
    title: t('studio.orchestrator.abortJob'),
    message: t('studio.orchestrator.abortJobConfirm'),
    confirmLabel: t('studio.orchestrator.abortJob')
  })
  if (!ok) return
  try {
    await window.studio.abortOrchestratorJob(job.jobId)
  } catch {
    // 主进程不可用时忽略；job 状态会经事件/列表刷新
  }
}
</script>

<template>
  <div class="orch-panel">
    <!-- 新建编排 -->
    <div class="orch-form">
      <div class="form-title">
        {{ t('studio.orchestrator.newJob') }}
        <span class="form-subtitle">{{ t('studio.orchestrator.subtitle') }}</span>
      </div>
      <input
        v-model="jobTitle"
        class="text-input goal-input"
        :placeholder="t('studio.orchestrator.jobTitlePlaceholder')"
      >
      <textarea
        v-model="goal"
        class="text-input goal-textarea"
        rows="2"
        :placeholder="t('studio.orchestrator.goalPlaceholder')"
        @input="onResizeTextarea"
      />
      <div class="plan-row">
        <button
          type="button"
          class="action-btn ghost plan-btn"
          :disabled="planning || submitting || !goal.trim() || !selectableAgents.length"
          @click="onAutoPlan"
        >
          {{ planning ? t('studio.orchestrator.planning') : t('studio.orchestrator.autoPlan') }}
        </button>
        <span class="plan-hint">{{ t('studio.orchestrator.autoPlanHint') }}</span>
        <span
          v-if="planInfo"
          class="plan-info"
        >{{ planInfo }}</span>
      </div>

      <div
        v-if="nodes.length >= 2"
        class="draft-graph-area"
      >
        <div class="draft-graph-head">
          <span class="draft-graph-title">{{ t('studio.orchestrator.canvasTitle') }}</span>
          <span class="draft-graph-hint">{{ t('studio.orchestrator.canvasHint') }}</span>
          <span
            v-if="canvasMsg"
            class="draft-graph-msg"
            :class="canvasMsgKind"
          >{{ canvasMsg }}</span>
        </div>
        <div class="draft-graph-scroll">
          <div
            ref="draftCanvasEl"
            class="draft-graph"
            :style="{
              width: draftLayout.canvasWidth + 'px',
              height: draftLayout.canvasHeight + 'px'
            }"
          >
            <svg
              class="graph-lines"
              :viewBox="`0 0 ${draftLayout.canvasWidth} ${draftLayout.canvasHeight}`"
            >
              <path
                v-for="edge in draftLayout.edges"
                :key="`e:${edge.from}:${edge.to}`"
                class="graph-edge draft-edge"
                :d="edgePath(edge.fromX, edge.fromY, edge.toX, edge.toY)"
              />
            </svg>
            <svg
              class="graph-hit-layer"
              :viewBox="`0 0 ${draftLayout.canvasWidth} ${draftLayout.canvasHeight}`"
            >
              <path
                v-for="edge in draftLayout.edges"
                :key="`h:${edge.from}:${edge.to}`"
                class="edge-hit"
                :d="edgePath(edge.fromX, edge.fromY, edge.toX, edge.toY)"
                @click="removeDraftEdge(edge.from, edge.to)"
              >
                <title>{{ t('studio.orchestrator.canvasRemoveEdge') }}</title>
              </path>
            </svg>
            <button
              v-for="node in nodes"
              :key="node.id"
              type="button"
              class="graph-chip draft-chip"
              :class="{
                'drag-from': dragState?.fromId === node.id,
                'drag-over': dragState?.overId === node.id && dragState?.fromId !== node.id
              }"
              :data-draft-node-id="node.id"
              :style="{
                left: (draftLayout.posBy.get(node.id)?.x ?? 0) + 'px',
                top: (draftLayout.posBy.get(node.id)?.y ?? 0) + 'px',
                width: DAG_CHIP_W + 'px'
              }"
              :title="node.instruction || node.id"
              @pointerdown="beginDraftDrag($event, node.id)"
            >
              <span
                class="flow-dot"
                :style="
                  agentColor(node.agentId)
                    ? { background: agentColor(node.agentId) }
                    : undefined
                "
              />
              <span class="graph-agent">{{ agentName(node.agentId) }}</span>
              <span class="graph-id">{{ node.id }}</span>
              <span
                v-if="(node.dependsOn?.length ?? 0) > 0"
                class="graph-deps-n"
                :title="t('studio.orchestrator.canvasDeps')"
              >{{ node.dependsOn?.length }}↑</span>
            </button>
            <svg
              v-if="tempEdge"
              class="graph-temp-layer"
              :viewBox="`0 0 ${draftLayout.canvasWidth} ${draftLayout.canvasHeight}`"
            >
              <path
                class="temp-edge"
                :class="{ invalid: tempEdge.invalid }"
                :d="tempEdge.path"
              />
            </svg>
          </div>
        </div>
      </div>

      <div
        v-if="selectableAgents.length"
        class="nodes-block"
      >
        <div class="nodes-hint">
          {{ t('studio.orchestrator.nodesHint') }}
        </div>
        <div
          v-for="(node, index) in nodes"
          :key="node.id"
          class="node-card"
        >
          <div class="node-head">
            <span class="node-index">{{ index + 1 }}</span>
            <input
              v-model="node.id"
              class="text-input node-id-input"
              :title="t('studio.orchestrator.nodeId')"
            >
            <select
              v-model="node.agentId"
              class="node-agent-select"
              :title="t('studio.orchestrator.nodeAgent')"
            >
              <option
                v-for="agent in selectableAgents"
                :key="agent.agentId"
                :value="agent.agentId"
              >
                {{ agent.name }}
              </option>
            </select>
            <button
              type="button"
              class="icon-btn danger"
              :title="t('studio.orchestrator.removeNode')"
              @click="removeNode(index)"
            >
              ×
            </button>
          </div>
          <textarea
            v-model="node.instruction"
            class="text-input node-instruction"
            rows="1"
            :placeholder="t('studio.orchestrator.nodeInstructionPlaceholder')"
            @input="onResizeTextarea"
          />
        </div>
        <button
          type="button"
          class="action-btn ghost"
          :disabled="nodes.length >= MAX_NODES"
          @click="addNode"
        >
          {{ t('studio.orchestrator.addNode') }}
          <span
            v-if="nodes.length >= MAX_NODES"
            class="limit-note"
          >{{
            t('studio.orchestrator.nodeLimit', { max: MAX_NODES })
          }}</span>
        </button>
      </div>
      <div
        v-else
        class="form-warn"
      >
        {{ t('studio.orchestrator.noAgent') }}
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="action-btn primary"
          :disabled="submitting || planning || !selectableAgents.length || !nodes.length"
          @click="submit"
        >
          {{ submitting ? t('studio.orchestrator.submitting') : t('studio.orchestrator.run') }}
        </button>
        <button
          type="button"
          class="action-btn ghost"
          :disabled="submitting"
          @click="clearForm"
        >
          {{ t('studio.orchestrator.clear') }}
        </button>
        <span
          v-if="formError"
          class="form-error"
        >{{ formError }}</span>
      </div>
    </div>

    <!-- 编排记录 -->
    <div class="orch-jobs">
      <div class="jobs-head">
        <span class="jobs-title">
          {{ t('studio.orchestrator.jobs') }}
          <span
            v-if="runningCount"
            class="running-badge"
          >{{
            t('studio.orchestrator.runningBadge', { n: runningCount })
          }}</span>
        </span>
      </div>
      <div
        v-if="!sortedJobs.length"
        class="jobs-empty"
      >
        {{ t('studio.orchestrator.jobsEmpty') }}
      </div>
      <div
        v-for="job in sortedJobs"
        :key="job.jobId"
        class="job-card"
        :class="job.state"
      >
        <div
          class="job-head"
          @click="toggleJob(job.jobId)"
        >
          <span class="job-chevron">{{ openJob[job.jobId] ? '▾' : '▸' }}</span>
          <span
            class="state-chip"
            :class="job.state"
          >{{ stateLabel(job) }}</span>
          <span class="job-title">{{ job.title || t('studio.orchestrator.noTitle') }}</span>
          <span class="job-meta">
            {{ fmtTime(job.createdAt) }}
            <template v-if="job.finishedAt"> · {{ jobDuration(job) }} </template>
          </span>
          <button
            v-if="job.state === 'running'"
            type="button"
            class="icon-btn danger abort-btn"
            :title="t('studio.orchestrator.abortJob')"
            @click.stop="onAbort(job)"
          >
            ■
          </button>
        </div>
        <div
          v-if="openJob[job.jobId]"
          class="job-body"
        >
          <div
            v-if="job.goal"
            class="job-goal"
          >
            {{ job.goal }}
          </div>
          <div
            v-if="job.error"
            class="job-error"
          >
            {{ t('studio.orchestrator.error') }}：{{ job.error }}
          </div>

          <div
            v-if="job.nodes.length > 1"
            class="node-view-switch"
          >
            <button
              type="button"
              class="view-chip"
              :class="{ on: viewOf(job) === 'flow' }"
              @click="setView(job.jobId, 'flow')"
            >
              {{ t('studio.orchestrator.viewFlow') }}
            </button>
            <button
              type="button"
              class="view-chip"
              :class="{ on: viewOf(job) === 'graph' }"
              @click="setView(job.jobId, 'graph')"
            >
              {{ t('studio.orchestrator.viewGraph') }}
            </button>
          </div>

          <div
            v-if="viewOf(job) === 'flow'"
            class="node-flow"
          >
            <div
              v-for="(node, i) in job.nodes"
              :key="node.id"
              class="flow-row"
            >
              <div
                class="flow-node"
                :class="node.state"
                @click="toggleNode(job.jobId, node.id)"
              >
                <span class="flow-dot" />
                <span class="flow-agent">{{ agentName(node.agentId) }}</span>
                <span class="flow-id">{{ node.id }}</span>
                <span class="state-chip node">{{ nodeStateLabel(node.state) }}</span>
                <span
                  v-if="node.state === 'done'"
                  class="flow-at"
                >{{
                  fmtTime(node.finishedAt)
                }}</span>
                <span
                  v-if="node.attempts > 1 && (node.state === 'done' || node.state === 'failed')"
                  class="flow-retry"
                  :title="nodeStateLabel('failed')"
                >↻{{ node.attempts }}</span>
              </div>
              <div
                v-if="i < job.nodes.length - 1"
                class="flow-line"
              />
              <div
                v-if="node.dependsOn.length"
                class="flow-deps"
              >
                {{ t('studio.orchestrator.depOf') }} {{ node.dependsOn.join(', ') }}
              </div>
              <div
                v-if="openNode[nodeKey(job.jobId, node.id)]"
                class="flow-detail"
              >
                <div class="detail-instruction">
                  {{ node.instruction }}
                </div>
                <div
                  v-if="node.error"
                  class="detail-error"
                >
                  {{ t('studio.orchestrator.nodeError') }}：{{ node.error }}
                </div>
                <div
                  v-if="node.finalText"
                  class="detail-output"
                >
                  <div class="detail-head">
                    <span>{{ t('studio.orchestrator.nodeOutput') }}</span>
                    <button
                      type="button"
                      class="copy-btn"
                      @click="onCopy(node.finalText, nodeKey(job.jobId, node.id))"
                    >
                      {{
                        copiedKey === nodeKey(job.jobId, node.id)
                          ? t('studio.orchestrator.copied')
                          : t('studio.orchestrator.copy')
                      }}
                    </button>
                  </div>
                  <pre>{{ node.finalText }}</pre>
                </div>
                <div
                  v-if="node.outputFiles?.length"
                  class="detail-files"
                >
                  <div class="detail-head">
                    <span>{{ t('studio.orchestrator.outputFiles') }}</span>
                    <button
                      type="button"
                      class="copy-btn"
                      @click="
                        onCopy(
                          node.outputFiles.join('\n'),
                          outputFileKey(nodeKey(job.jobId, node.id), '__all__')
                        )
                      "
                    >
                      {{
                        copiedKey === outputFileKey(nodeKey(job.jobId, node.id), '__all__')
                          ? t('studio.orchestrator.copied')
                          : t('studio.orchestrator.copyAll')
                      }}
                    </button>
                  </div>
                  <ul class="output-file-list">
                    <li
                      v-for="file in node.outputFiles"
                      :key="file"
                      class="output-file-item"
                      @click="
                        onCopy(file, outputFileKey(nodeKey(job.jobId, node.id), file))
                      "
                    >
                      <span class="output-file-path">{{ file }}</span>
                      <button
                        v-if="canPreviewFile(file)"
                        type="button"
                        class="output-file-preview"
                        @click.stop="previewOutputFile(file)"
                      >
                        {{ t('studio.orchestrator.previewFile') }}
                      </button>
                      <span
                        v-if="
                          copiedKey === outputFileKey(nodeKey(job.jobId, node.id), file)
                        "
                        class="output-file-copied"
                      >{{ t('studio.orchestrator.copied') }}</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          <div
            v-else
            class="node-graph-area"
          >
            <div
              v-if="job.nodes.length"
              class="node-graph-scroll"
            >
              <div
                class="node-graph"
                :style="{
                  width: layoutFor(job).canvasWidth + 'px',
                  height: layoutFor(job).canvasHeight + 'px'
                }"
              >
                <svg
                  class="graph-lines"
                  :viewBox="`0 0 ${layoutFor(job).canvasWidth} ${layoutFor(job).canvasHeight}`"
                >
                  <path
                    v-for="edge in layoutFor(job).edges"
                    :key="`${edge.from}:${edge.to}`"
                    class="graph-edge"
                    :class="edgeToneClass(job, edge.from)"
                    :d="edgePath(edge.fromX, edge.fromY, edge.toX, edge.toY)"
                  />
                </svg>
                <button
                  v-for="node in job.nodes"
                  :key="node.id"
                  type="button"
                  class="graph-chip"
                  :class="[node.state, { selected: graphSel[job.jobId] === node.id }]"
                  :style="{
                    left: (layoutFor(job).posBy.get(node.id)?.x ?? 0) + 'px',
                    top: (layoutFor(job).posBy.get(node.id)?.y ?? 0) + 'px',
                    width: DAG_CHIP_W + 'px'
                  }"
                  :title="node.instruction"
                  @click="onGraphChip(job.jobId, node.id)"
                >
                  <span class="flow-dot" />
                  <span class="graph-agent">{{ agentName(node.agentId) }}</span>
                  <span class="graph-id">{{ node.id }}</span>
                  <span class="graph-state">{{ nodeStateLabel(node.state) }}</span>
                  <span
                    v-if="node.attempts > 1 && (node.state === 'done' || node.state === 'failed')"
                    class="graph-retry"
                  >↻{{ node.attempts }}</span>
                </button>
              </div>
            </div>
            <div
              v-else
              class="graph-empty"
            >
              {{ t('studio.orchestrator.graphEmpty') }}
            </div>
            <div class="graph-select-hint">
              {{ t('studio.orchestrator.graphSelectHint') }}
            </div>
            <div
              v-for="detail in selectedNodeDetails(job.jobId, job)"
              :key="detail.node.id"
              class="flow-detail graph-detail"
            >
              <div class="detail-instruction">
                {{ detail.node.instruction }}
              </div>
              <div
                v-if="detail.node.error"
                class="detail-error"
              >
                {{ t('studio.orchestrator.nodeError') }}：{{ detail.node.error }}
              </div>
              <div
                v-if="detail.node.finalText"
                class="detail-output"
              >
                <div class="detail-head">
                  <span>{{ t('studio.orchestrator.nodeOutput') }}</span>
                  <button
                    type="button"
                    class="copy-btn"
                    @click="onCopy(detail.node.finalText, detail.copyKey)"
                  >
                    {{
                      copiedKey === detail.copyKey
                        ? t('studio.orchestrator.copied')
                        : t('studio.orchestrator.copy')
                    }}
                  </button>
                </div>
                <pre>{{ detail.node.finalText }}</pre>
              </div>
              <div
                v-if="detail.node.outputFiles?.length"
                class="detail-files"
              >
                <div class="detail-head">
                  <span>{{ t('studio.orchestrator.outputFiles') }}</span>
                  <button
                    type="button"
                    class="copy-btn"
                    @click="
                      onCopy(
                        detail.node.outputFiles.join('\n'),
                        outputFileKey(detail.copyKey, '__all__')
                      )
                    "
                  >
                    {{
                      copiedKey === outputFileKey(detail.copyKey, '__all__')
                        ? t('studio.orchestrator.copied')
                        : t('studio.orchestrator.copyAll')
                    }}
                  </button>
                </div>
                <ul class="output-file-list">
                  <li
                    v-for="file in detail.node.outputFiles"
                    :key="file"
                    class="output-file-item"
                    @click="
                      onCopy(file, outputFileKey(detail.copyKey, file))
                    "
                  >
                    <span class="output-file-path">{{ file }}</span>
                    <button
                      v-if="canPreviewFile(file)"
                      type="button"
                      class="output-file-preview"
                      @click.stop="previewOutputFile(file)"
                    >
                      {{ t('studio.orchestrator.previewFile') }}
                    </button>
                    <span
                      v-if="copiedKey === outputFileKey(detail.copyKey, file)"
                      class="output-file-copied"
                    >{{ t('studio.orchestrator.copied') }}</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>

          <div
            v-if="job.summary"
            class="summary-box"
          >
            <div class="summary-head">
              <span class="summary-label">★ {{ t('studio.orchestrator.summary') }}</span>
              <button
                type="button"
                class="copy-btn"
                @click="onCopy(job.summary, `s:${job.jobId}`)"
              >
                {{
                  copiedKey === `s:${job.jobId}`
                    ? t('studio.orchestrator.copied')
                    : t('studio.orchestrator.copySummary')
                }}
              </button>
            </div>
            <pre>{{ job.summary }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.orch-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  font-size: 12px;
  color: var(--text-primary, #e6e9ef);
}
.orch-form {
  flex: none;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--panel-border, rgba(128, 128, 128, 0.2));
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 45%;
  overflow-y: auto;
}
.form-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.form-subtitle {
  font-size: 11px;
  font-weight: 400;
  color: var(--text-tertiary, #5b6472);
}
.text-input {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary, #e6e9ef);
  font-family: inherit;
  font-size: 12px;
  padding: 5px 8px;
  resize: none;
  outline: none;
}
.text-input:focus {
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 55%, transparent);
}
.goal-input {
  font-size: 12px;
}
.goal-textarea {
  line-height: 1.5;
}
.nodes-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nodes-hint {
  font-size: 11px;
  color: var(--text-tertiary, #5b6472);
}
.node-card {
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.2));
  border-radius: 8px;
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  background: var(--bg-panel-soft, rgba(128, 128, 128, 0.06));
}
.node-head {
  display: flex;
  align-items: center;
  gap: 6px;
}
.node-index {
  flex: none;
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--agent-color, #37b26c) 22%, transparent);
  color: var(--text-primary, #e6e9ef);
  font-size: 11px;
}
.node-id-input {
  width: 72px;
  flex: none;
  font-family: var(--mono, 'Cascadia Code', Consolas, monospace);
  font-size: 11px;
  padding: 3px 6px;
}
.node-agent-select {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text-primary, #e6e9ef);
  font-family: inherit;
  font-size: 12px;
  padding: 3px 6px;
  outline: none;
}
.icon-btn {
  flex: none;
  border: none;
  background: transparent;
  color: var(--text-tertiary, #5b6472);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  border-radius: 4px;
  padding: 2px 6px;
}
.icon-btn:hover {
  background: var(--hover-bg, rgba(128, 128, 128, 0.12));
}
.icon-btn.danger:hover {
  color: #e5484d;
  background: rgba(229, 72, 77, 0.15);
}
.node-instruction {
  line-height: 1.45;
}
.form-warn {
  color: var(--warning, #f0b429);
  font-size: 11px;
  padding: 4px 0;
}
.form-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.action-btn {
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid transparent;
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn.primary {
  background: color-mix(in srgb, var(--agent-color, #37b26c) 24%, transparent);
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 55%, transparent);
  color: var(--text-primary, #e6e9ef);
}
.action-btn.primary:hover:not(:disabled) {
  background: color-mix(in srgb, var(--agent-color, #37b26c) 34%, transparent);
}
.action-btn.ghost {
  background: transparent;
  border-color: var(--panel-border, rgba(128, 128, 128, 0.25));
  color: var(--text-secondary, #9aa4b2);
}
.action-btn.ghost:hover:not(:disabled) {
  color: var(--text-primary, #e6e9ef);
}
.limit-note {
  font-size: 10px;
  color: var(--text-tertiary, #5b6472);
  margin-left: 6px;
}
.form-error {
  color: #e5484d;
  font-size: 11px;
}

/* ── 新建表单：依赖连线画布（迷你 DAG） ── */
.draft-graph-area {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.18));
  border-radius: 8px;
  padding: 6px 8px;
  background: var(--bg-input);
}
.draft-graph-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  font-size: 11px;
}
.draft-graph-title {
  flex: none;
  font-weight: 600;
  color: var(--text-primary, #e6e9ef);
}
.draft-graph-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-tertiary, #5b6472);
}
.draft-graph-msg {
  flex: none;
  font-size: 11px;
}
.draft-graph-msg.warn {
  color: #e5484d;
}
.draft-graph-msg.info {
  color: #3dd68c;
}
.draft-graph-scroll {
  overflow: auto;
  max-height: 168px;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.16));
  border-radius: 6px;
  background: var(--bg-input);
}
.draft-graph {
  position: relative;
  min-width: 100%;
}
.graph-hit-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.graph-temp-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.edge-hit {
  fill: none;
  stroke: transparent;
  stroke-width: 13;
  pointer-events: stroke;
  cursor: pointer;
}
.edge-hit:hover {
  stroke: rgba(240, 180, 41, 0.35);
}
.draft-edge {
  stroke-dasharray: 4 3;
}
.temp-edge {
  fill: none;
  stroke: #3dd68c;
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.temp-edge.invalid {
  stroke: #e5484d;
}
.draft-chip {
  cursor: grab;
}
.draft-chip:active {
  cursor: grabbing;
}
.draft-chip.drag-from {
  border-color: #3dd68c;
  box-shadow: 0 0 0 2px rgba(61, 214, 140, 0.35);
}
.draft-chip.drag-over {
  border-color: #f0b429;
  box-shadow: 0 0 0 2px rgba(240, 180, 41, 0.45);
}
.graph-deps-n {
  flex: none;
  font-size: 9px;
  line-height: 1;
  color: var(--text-tertiary, #5b6472);
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.3));
  border-radius: 999px;
  padding: 1px 5px;
}

/* ── 记录列表 ── */
.orch-jobs {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.jobs-head {
  flex: none;
}
.jobs-title {
  font-size: 12px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.running-badge {
  font-size: 10px;
  font-weight: 400;
  color: var(--agent-color, #37b26c);
  border: 1px solid color-mix(in srgb, var(--agent-color, #37b26c) 50%, transparent);
  border-radius: 999px;
  padding: 0 8px;
}
.jobs-empty {
  color: var(--text-tertiary, #5b6472);
  font-size: 11px;
  padding: 10px 2px;
}
.job-card {
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.2));
  border-radius: 8px;
  background: var(--bg-card, rgba(128, 128, 128, 0.05));
  overflow: hidden;
}
.job-card.running {
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 45%, transparent);
}
.job-card.failed {
  border-color: rgba(229, 72, 77, 0.45);
}
.job-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  user-select: none;
}
.job-chevron {
  color: var(--text-tertiary, #5b6472);
  font-size: 10px;
}
.state-chip {
  flex: none;
  font-size: 10px;
  border-radius: 999px;
  padding: 1px 8px;
  border: 1px solid;
}
.state-chip.running {
  color: #3dd68c;
  border-color: rgba(61, 214, 140, 0.5);
  background: rgba(61, 214, 140, 0.1);
}
.state-chip.done {
  color: #3dd68c;
  border-color: rgba(61, 214, 140, 0.4);
  background: rgba(61, 214, 140, 0.06);
}
.state-chip.failed {
  color: #e5484d;
  border-color: rgba(229, 72, 77, 0.45);
  background: rgba(229, 72, 77, 0.08);
}
.state-chip.aborted,
.state-chip.skipped {
  color: var(--text-tertiary, #5b6472);
  border-color: var(--panel-border, rgba(128, 128, 128, 0.3));
}
.state-chip.pending {
  color: var(--text-secondary, #9aa4b2);
  border-color: var(--panel-border, rgba(128, 128, 128, 0.25));
}
.state-chip.node {
  font-size: 9px;
  padding: 0 6px;
}
.job-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.job-meta {
  flex: none;
  color: var(--text-tertiary, #5b6472);
  font-size: 10px;
}
.abort-btn {
  color: #e5484d;
}
.abort-btn:hover {
  background: rgba(229, 72, 77, 0.15);
}
.job-body {
  border-top: 1px solid var(--panel-border, rgba(128, 128, 128, 0.15));
  padding: 8px 10px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.job-goal {
  font-size: 11px;
  color: var(--text-secondary, #9aa4b2);
  line-height: 1.5;
  white-space: pre-wrap;
}
.job-error {
  font-size: 11px;
  color: #e5484d;
  line-height: 1.5;
  background: rgba(229, 72, 77, 0.08);
  border-radius: 6px;
  padding: 6px 8px;
  white-space: pre-wrap;
}
.node-flow {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.flow-row {
  position: relative;
  padding-left: 2px;
}
.flow-node {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  border-radius: 999px;
  background: var(--bg-elevated);
  padding: 3px 10px 3px 8px;
  cursor: pointer;
  max-width: 100%;
}
.flow-node.running {
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--agent-color, #37b26c) 30%, transparent);
}
.flow-node.failed {
  border-color: rgba(229, 72, 77, 0.5);
}
.flow-node.skipped {
  opacity: 0.55;
}
.flow-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-tertiary, #5b6472);
  flex: none;
}
.flow-node.running .flow-dot {
  background: #3dd68c;
  box-shadow: 0 0 6px #3dd68c;
  animation: pulse 1.2s ease-in-out infinite;
}
.flow-node.done .flow-dot {
  background: #3dd68c;
}
.flow-node.failed .flow-dot {
  background: #e5484d;
}
.flow-node.skipped .flow-dot {
  background: var(--text-tertiary, #5b6472);
}
@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}
.flow-agent {
  font-weight: 600;
  white-space: nowrap;
}
.flow-id {
  color: var(--text-tertiary, #5b6472);
  font-family: var(--mono, 'Cascadia Code', Consolas, monospace);
  font-size: 10px;
  white-space: nowrap;
}
.flow-at {
  color: var(--text-tertiary, #5b6472);
  font-size: 10px;
}
.flow-retry {
  color: var(--warning, #f0b429);
  font-size: 10px;
}
.flow-deps {
  font-size: 10px;
  color: var(--text-tertiary, #5b6472);
  padding: 2px 0 0 24px;
}
.flow-detail {
  margin: 4px 0 8px 6px;
  border-left: 2px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  padding: 2px 10px 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.detail-instruction {
  font-size: 11px;
  color: var(--text-secondary, #9aa4b2);
  line-height: 1.5;
  white-space: pre-wrap;
}
.detail-error {
  font-size: 11px;
  color: #e5484d;
  white-space: pre-wrap;
}
.detail-output {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary, #9aa4b2);
}
.detail-output pre,
.summary-box pre {
  margin: 0;
  font-family: var(--mono, 'Cascadia Code', Consolas, monospace);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-primary, #e6e9ef);
  background: var(--bg-input);
  border-radius: 6px;
  padding: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow-y: auto;
}
.copy-btn {
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  background: transparent;
  color: var(--text-secondary, #9aa4b2);
  font-size: 10px;
  border-radius: 4px;
  padding: 1px 8px;
  cursor: pointer;
  flex: none;
}
.copy-btn:hover {
  color: var(--text-primary, #e6e9ef);
}
/* 节点产出文件列表（flow 详情与 graph 详情共用） */
.detail-files {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}
.output-file-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: 150px;
  overflow-y: auto;
}
.output-file-item {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.18));
  background: var(--bg-input);
  border-radius: 5px;
  padding: 2px 4px 2px 8px;
  cursor: pointer;
  min-width: 0;
}
.output-file-item:hover {
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 55%, transparent);
}
.output-file-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--mono, 'Cascadia Code', Consolas, monospace);
  font-size: 10px;
  color: var(--text-secondary, #9aa4b2);
}
.output-file-preview {
  flex: none;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  background: transparent;
  color: var(--text-tertiary, #5b6472);
  font-size: 10px;
  border-radius: 4px;
  padding: 1px 6px;
  cursor: pointer;
}
.output-file-preview:hover {
  color: var(--text-primary, #e6e9ef);
}
.output-file-copied {
  flex: none;
  font-size: 10px;
  color: #3dd68c;
}
.summary-box {
  border: 1px solid color-mix(in srgb, var(--agent-color, #37b26c) 40%, transparent);
  border-radius: 8px;
  background: color-mix(in srgb, var(--agent-color, #37b26c) 6%, transparent);
  padding: 6px 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.summary-label {
  font-size: 12px;
  font-weight: 600;
  color: color-mix(in srgb, var(--agent-color, #37b26c) 80%, #fff);
}
/* 智能拆解行 */
.plan-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.plan-btn {
  flex: none;
}
.plan-hint {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: var(--text-tertiary, #5b6472);
}
.plan-info {
  font-size: 11px;
  color: #3dd68c;
}
/* 记录区：视图切换（列表 / 连线图） */
.node-view-switch {
  display: inline-flex;
  gap: 4px;
  padding: 2px;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  border-radius: 8px;
  background: var(--bg-input);
  margin-bottom: 6px;
}
.view-chip {
  border: none;
  background: transparent;
  color: var(--text-secondary, #9aa4b2);
  font-size: 11px;
  border-radius: 6px;
  padding: 2px 10px;
  cursor: pointer;
}
.view-chip.on {
  background: color-mix(in srgb, var(--agent-color, #37b26c) 18%, transparent);
  color: var(--text-primary, #e6e9ef);
}
/* 连线图（DAG 可视化） */
.node-graph-area {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 2px 0 4px;
}
.node-graph-scroll {
  overflow: auto;
  max-height: 320px;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.18));
  border-radius: 8px;
  background: var(--bg-input);
}
.node-graph {
  position: relative;
  min-width: 100%;
}
.graph-lines {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}
.graph-edge {
  fill: none;
  stroke: rgba(128, 128, 128, 0.45);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
}
.graph-edge.is-done {
  stroke: rgba(61, 214, 140, 0.7);
  stroke-dasharray: none;
}
.graph-edge.is-failed {
  stroke: rgba(229, 72, 77, 0.85);
  stroke-dasharray: none;
}
.graph-edge.is-skipped {
  stroke: rgba(128, 128, 128, 0.3);
  stroke-dasharray: 2 3;
}
.graph-chip {
  position: absolute;
  display: flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  height: 34px;
  padding: 0 8px;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.3));
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary, #e6e9ef);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
  text-align: left;
}
.graph-chip:hover {
  border-color: rgba(128, 128, 128, 0.6);
}
.graph-chip.selected {
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 70%, transparent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--agent-color, #37b26c) 55%, transparent);
}
.graph-chip.running {
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 55%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--agent-color, #37b26c) 25%, transparent);
}
.graph-chip.running .flow-dot {
  background: #3dd68c;
  box-shadow: 0 0 6px #3dd68c;
  animation: pulse 1.2s ease-in-out infinite;
}
.graph-chip.done .flow-dot {
  background: #3dd68c;
}
.graph-chip.failed {
  border-color: rgba(229, 72, 77, 0.55);
}
.graph-chip.failed .flow-dot {
  background: #e5484d;
}
.graph-chip.skipped {
  opacity: 0.6;
}
.graph-chip.pending .flow-dot {
  background: var(--text-tertiary, #5b6472);
}
.graph-agent {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.graph-id {
  flex: none;
  color: var(--text-tertiary, #5b6472);
  font-family: var(--mono, 'Cascadia Code', Consolas, monospace);
  font-size: 10px;
}
.graph-state {
  flex: none;
  font-size: 9px;
  color: var(--text-tertiary, #5b6472);
}
.graph-retry {
  flex: none;
  font-size: 10px;
  color: #e5484d;
}
.graph-empty {
  font-size: 11px;
  color: var(--text-tertiary, #5b6472);
}
.graph-select-hint {
  font-size: 10px;
  color: var(--text-tertiary, #5b6472);
}
.graph-detail {
  margin: 0;
  margin-top: 2px;
}
</style>
