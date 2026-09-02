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
let nodeSeq = 0

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

function toggleDep(index: number, depId: string): void {
  const node = nodes.value[index]
  if (!node) return
  const deps = node.dependsOn ?? []
  node.dependsOn = deps.includes(depId) ? deps.filter((d) => d !== depId) : [...deps, depId]
}

function onResizeTextarea(event: Event): void {
  const el = event.target as HTMLTextAreaElement
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

function clearForm(): void {
  goal.value = ''
  jobTitle.value = ''
  nodes.value = []
  formError.value = ''
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
  submitting.value = true
  try {
    const result = await window.studio.runOrchestrator({
      goal: goal.value.trim(),
      ...(jobTitle.value.trim() ? { title: jobTitle.value.trim() } : {}),
      nodes: nodes.value.map((n, index) => ({
        // id 留空时自动补位，避免主进程校验报「id 非法」
        id: String(n.id ?? '').trim() || `n${index + 1}`,
        agentId: n.agentId,
        instruction: n.instruction,
        ...(n.dependsOn?.length ? { dependsOn: [...n.dependsOn] } : {})
      }))
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
      />
      <textarea
        v-model="goal"
        class="text-input goal-textarea"
        rows="2"
        :placeholder="t('studio.orchestrator.goalPlaceholder')"
        @input="onResizeTextarea"
      />

      <div v-if="selectableAgents.length" class="nodes-block">
        <div class="nodes-hint">
          {{ t('studio.orchestrator.nodesHint') }}
        </div>
        <div v-for="(node, index) in nodes" :key="node.id" class="node-card">
          <div class="node-head">
            <span class="node-index">{{ index + 1 }}</span>
            <input
              v-model="node.id"
              class="text-input node-id-input"
              :title="t('studio.orchestrator.nodeId')"
            />
            <select
              v-model="node.agentId"
              class="node-agent-select"
              :title="t('studio.orchestrator.nodeAgent')"
            >
              <option v-for="agent in selectableAgents" :key="agent.agentId" :value="agent.agentId">
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
          <div v-if="nodes.length > 1" class="node-deps">
            <span class="deps-title">{{ t('studio.orchestrator.nodeDeps') }}</span>
            <button
              v-for="other in nodes.filter((n) => n.id !== node.id)"
              :key="other.id"
              type="button"
              class="dep-chip"
              :class="{ on: node.dependsOn?.includes(other.id) }"
              @click="toggleDep(index, other.id)"
            >
              {{ other.id }}
            </button>
            <span class="deps-hint">{{ t('studio.orchestrator.nodeDepsHint') }}</span>
          </div>
        </div>
        <button
          type="button"
          class="action-btn ghost"
          :disabled="nodes.length >= MAX_NODES"
          @click="addNode"
        >
          {{ t('studio.orchestrator.addNode') }}
          <span v-if="nodes.length >= MAX_NODES" class="limit-note">{{
            t('studio.orchestrator.nodeLimit', { max: MAX_NODES })
          }}</span>
        </button>
      </div>
      <div v-else class="form-warn">
        {{ t('studio.orchestrator.noAgent') }}
      </div>

      <div class="form-actions">
        <button
          type="button"
          class="action-btn primary"
          :disabled="submitting || !selectableAgents.length || !nodes.length"
          @click="submit"
        >
          {{ submitting ? t('studio.orchestrator.submitting') : t('studio.orchestrator.run') }}
        </button>
        <button type="button" class="action-btn ghost" :disabled="submitting" @click="clearForm">
          {{ t('studio.orchestrator.clear') }}
        </button>
        <span v-if="formError" class="form-error">{{ formError }}</span>
      </div>
    </div>

    <!-- 编排记录 -->
    <div class="orch-jobs">
      <div class="jobs-head">
        <span class="jobs-title">
          {{ t('studio.orchestrator.jobs') }}
          <span v-if="runningCount" class="running-badge">{{
            t('studio.orchestrator.runningBadge', { n: runningCount })
          }}</span>
        </span>
      </div>
      <div v-if="!sortedJobs.length" class="jobs-empty">
        {{ t('studio.orchestrator.jobsEmpty') }}
      </div>
      <div v-for="job in sortedJobs" :key="job.jobId" class="job-card" :class="job.state">
        <div class="job-head" @click="toggleJob(job.jobId)">
          <span class="job-chevron">{{ openJob[job.jobId] ? '▾' : '▸' }}</span>
          <span class="state-chip" :class="job.state">{{ stateLabel(job) }}</span>
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
        <div v-if="openJob[job.jobId]" class="job-body">
          <div v-if="job.goal" class="job-goal">
            {{ job.goal }}
          </div>
          <div v-if="job.error" class="job-error">
            {{ t('studio.orchestrator.error') }}：{{ job.error }}
          </div>

          <div class="node-flow">
            <div v-for="(node, i) in job.nodes" :key="node.id" class="flow-row">
              <div class="flow-node" :class="node.state" @click="toggleNode(job.jobId, node.id)">
                <span class="flow-dot" />
                <span class="flow-agent">{{ agentName(node.agentId) }}</span>
                <span class="flow-id">{{ node.id }}</span>
                <span class="state-chip node">{{ nodeStateLabel(node.state) }}</span>
                <span v-if="node.state === 'done'" class="flow-at">{{
                  fmtTime(node.finishedAt)
                }}</span>
                <span
                  v-if="node.attempts > 1 && (node.state === 'done' || node.state === 'failed')"
                  class="flow-retry"
                  :title="nodeStateLabel('failed')"
                  >↻{{ node.attempts }}</span
                >
              </div>
              <div v-if="i < job.nodes.length - 1" class="flow-line" />
              <div v-if="node.dependsOn.length" class="flow-deps">
                {{ t('studio.orchestrator.depOf') }} {{ node.dependsOn.join(', ') }}
              </div>
              <div v-if="openNode[nodeKey(job.jobId, node.id)]" class="flow-detail">
                <div class="detail-instruction">
                  {{ node.instruction }}
                </div>
                <div v-if="node.error" class="detail-error">
                  {{ t('studio.orchestrator.nodeError') }}：{{ node.error }}
                </div>
                <div v-if="node.finalText" class="detail-output">
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
              </div>
            </div>
          </div>

          <div v-if="job.summary" class="summary-box">
            <div class="summary-head">
              <span class="summary-label">★ {{ t('studio.orchestrator.summary') }}</span>
              <button type="button" class="copy-btn" @click="onCopy(job.summary, `s:${job.jobId}`)">
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
  background: var(--bg-input, #1a1c1f);
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
  background: var(--bg-input, #1a1c1f);
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
.node-deps {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.deps-title {
  font-size: 11px;
  color: var(--text-tertiary, #5b6472);
  flex: none;
}
.dep-chip {
  flex: none;
  border: 1px solid var(--panel-border, rgba(128, 128, 128, 0.25));
  background: transparent;
  color: var(--text-secondary, #9aa4b2);
  font-size: 11px;
  font-family: var(--mono, 'Cascadia Code', Consolas, monospace);
  border-radius: 999px;
  padding: 1px 8px;
  cursor: pointer;
}
.dep-chip.on {
  background: color-mix(in srgb, var(--agent-color, #37b26c) 22%, transparent);
  border-color: color-mix(in srgb, var(--agent-color, #37b26c) 50%, transparent);
  color: var(--text-primary, #e6e9ef);
}
.deps-hint {
  font-size: 10px;
  color: var(--text-tertiary, #5b6472);
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
  background: var(--bg-elevated, #1b2028);
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
  background: var(--bg-input, rgba(0, 0, 0, 0.22));
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
</style>
