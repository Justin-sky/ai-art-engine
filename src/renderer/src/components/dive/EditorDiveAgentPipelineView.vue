<template>
  <div class="agent-pipeline-view">
    <div class="pipeline-header">
      <div class="pipeline-title">
        <span class="title-text">{{ assetTitle }}</span>
        <span class="stage-chip">{{ t('divePipeline.agent.title') }}</span>
      </div>
      <div class="header-actions">
        <span
          class="summary-chip pending"
          :title="t('divePipeline.agent.summary.pendingTitle')"
        >{{ t('divePipeline.agent.summary.pending', { n: overview.pendingCount }) }}</span>
        <span
          class="summary-chip fail"
          :title="t('divePipeline.agent.summary.failTitle')"
        >{{ t('divePipeline.agent.summary.fail', { n: overview.failCount }) }}</span>
        <span
          class="summary-chip exhausted"
          :title="t('divePipeline.agent.summary.exhaustedTitle')"
        >{{ t('divePipeline.agent.summary.exhausted', { n: overview.exhaustedCount }) }}</span>
      </div>
    </div>

    <div
      v-if="overview.lastFailReason"
      class="fail-row"
    >
      <span
        class="fail-chip"
        :title="t('divePipeline.agent.fail.latestTitle')"
      >{{ t('divePipeline.agent.fail.latestPrefix') }}{{ overview.lastFailReason }}</span>
    </div>

    <div
      v-if="!overview.hasPipeline"
      class="empty-hint"
    >
      {{ t('divePipeline.agent.empty.noNodes') }}
    </div>

    <div
      v-else
      class="pipeline-body"
    >
      <!-- 质检节点 -->
      <section class="panel">
        <div class="panel-head">
          <h3>
            {{ t('divePipeline.agent.panel.review') }}
            <span class="count-badge">{{ overview.reviewRows.length }}</span>
          </h3>
        </div>
        <ul class="row-list">
          <li
            v-for="row in overview.reviewRows"
            :key="row.nodeId"
            class="row-item"
            :class="row.status"
            :title="t('divePipeline.agent.panel.locateHint')"
            @click="selectNode(row.nodeId)"
          >
            <span class="row-title">{{ row.title }}</span>
            <span
              class="status-badge"
              :class="row.status"
            >{{ reviewStatusLabel(row.status) }}</span>
            <span
              v-if="row.reason"
              class="reason"
            >{{ row.reason }}</span>
          </li>
          <li
            v-if="!overview.reviewRows.length"
            class="empty-row"
          >{{ t('divePipeline.agent.panel.noReview') }}</li>
        </ul>
      </section>

      <!-- 返工节点 -->
      <section class="panel">
        <div class="panel-head">
          <h3>
            {{ t('divePipeline.agent.panel.rework') }}
            <span class="count-badge">{{ overview.reworkRows.length }}</span>
          </h3>
        </div>
        <ul class="row-list">
          <li
            v-for="row in overview.reworkRows"
            :key="row.nodeId"
            class="row-item"
            :class="row.status"
            :title="t('divePipeline.agent.panel.locateHint')"
            @click="selectNode(row.nodeId)"
          >
            <span class="row-title">{{ row.title }}</span>
            <span
              class="status-badge"
              :class="row.status"
            >{{ reworkStatusLabel(row.status) }}</span>
            <span class="attempt">{{ t('divePipeline.agent.row.attempt', { attempt: row.attempt, maxAttempts: row.maxAttempts }) }}</span>
            <span
              v-if="row.lastReason"
              class="reason"
            >{{ row.lastReason }}</span>
          </li>
          <li
            v-if="!overview.reworkRows.length"
            class="empty-row"
          >{{ t('divePipeline.agent.panel.noRework') }}</li>
        </ul>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  buildAgentPipelineOverview,
  type AgentReviewStatus,
  type GraphDocument
} from '@shared/graph'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../../stores/project'
import { useWorkspaceStore } from '../../stores/workspace'
import { useStudioI18n } from '../../composables/useStudioI18n'

const props = defineProps<{
  frameKey: string
  hostAssetId: string
}>()

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { t } = useStudioI18n()

const asset = computed(() => project.assets.find((item) => item.id === props.hostAssetId) ?? null)
const assetTitle = computed(() => asset.value?.name?.trim() || String(t('divePipeline.agent.title')))

/** 优先取当前打开画布的实时文档（含未落盘的连线与运行结果） */
const graphDoc = computed<GraphDocument | null>(() => {
  const live = graphEditorHosts.getLiveAssetDocument(props.hostAssetId)
  if (live) return live
  const raw = asset.value?.genParams?.graphJson
  if (!raw || typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as GraphDocument
  } catch {
    return null
  }
})

const overview = computed(() => buildAgentPipelineOverview(graphDoc.value?.nodes ?? []))

function selectNode(nodeId: string): void {
  workspace.selectGraphNode(nodeId, `asset:${props.hostAssetId}`)
}

/** PASS / FAIL 为内检结论原样展示；其余状态 id 在渲染时映射为当前语言文案 */
function reviewStatusLabel(status: AgentReviewStatus): string {
  if (status === 'PASS') return 'PASS'
  if (status === 'FAIL') return 'FAIL'
  return String(t('divePipeline.agent.status.review.pending'))
}

function reworkStatusLabel(status: string): string {
  if (status === 'passed') return String(t('divePipeline.agent.status.rework.passed'))
  if (status === 'exhausted') return String(t('divePipeline.agent.status.rework.exhausted'))
  return String(t('divePipeline.agent.status.rework.running'))
}
</script>

<style scoped>
.agent-pipeline-view {
  flex: 1;
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--fg);
}
.pipeline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.pipeline-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.title-text {
  font-weight: 600;
}
.stage-chip {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--fg-soft);
}
.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.summary-chip {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-input);
  color: var(--fg-soft);
}
.summary-chip.pending {
  background: color-mix(in srgb, var(--accent, #3498db) 16%, transparent);
  color: var(--accent, #3498db);
}
.summary-chip.fail {
  background: color-mix(in srgb, var(--danger, #c0392b) 16%, transparent);
  color: var(--danger, #c0392b);
}
.summary-chip.exhausted {
  background: color-mix(in srgb, var(--warning, #f39c12) 18%, transparent);
  color: var(--warning, #f39c12);
}
.fail-row {
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--danger, #c0392b) 8%, transparent);
}
.fail-chip {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background: var(--danger, #c0392b);
  color: #fff;
  white-space: normal;
  line-height: 1.45;
  display: inline-block;
}
.empty-hint {
  color: var(--fg-soft);
  padding: 16px;
  font-size: 13px;
  line-height: 1.6;
}
.pipeline-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  overflow: auto;
}
.panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.panel-head h3 {
  margin: 0;
  padding: 8px 10px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-input);
  display: flex;
  align-items: center;
  gap: 8px;
}
.count-badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg-soft);
}
.row-list {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 6px;
  list-style: none;
  max-height: 40vh;
}
.row-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 6px;
  cursor: pointer;
  transition:
    background 0.12s ease,
    box-shadow 0.12s ease;
}
.row-item:hover {
  background: var(--bg-hover);
}
.row-item:active {
  box-shadow: inset 3px 0 0 var(--accent, #3498db);
}
.row-title {
  font-size: 13px;
  font-weight: 500;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.status-badge {
  font-size: 11px;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--bg);
  color: var(--fg-soft);
  white-space: nowrap;
}
.status-badge.PASS,
.status-badge.passed {
  color: #fff;
  background: var(--success, #27ae60);
}
.status-badge.FAIL {
  color: #fff;
  background: var(--danger, #c0392b);
}
.status-badge.exhausted {
  color: #fff;
  background: var(--warning, #f39c12);
}
.status-badge.pending {
  color: var(--accent, #3498db);
  background: color-mix(in srgb, var(--accent, #3498db) 16%, transparent);
}
.status-badge.running {
  color: var(--accent, #3498db);
  background: color-mix(in srgb, var(--accent, #3498db) 16%, transparent);
}
.attempt {
  font-size: 12px;
  color: var(--fg-soft);
  white-space: nowrap;
}
.reason {
  font-size: 12px;
  color: var(--danger, #c0392b);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty-row {
  color: var(--fg-soft);
  padding: 12px;
  font-size: 12px;
}
</style>
