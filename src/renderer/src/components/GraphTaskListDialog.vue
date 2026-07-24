<template>
  <StudioFloatingWindow
    :open="dialogOpen"
    :close-title="t('common.cancel')"
    :z-index="3100"
    :default-width="720"
    :default-height="520"
    :min-width="480"
    :min-height="320"
    @close="close"
  >
    <template #title>
      <div>
        <span class="eyebrow">{{ t('graph.tasks.mark') }}</span>
        <h2>{{ t('graph.tasks.title') }}</h2>
      </div>
    </template>

    <div class="task-tabs" role="tablist">
      <button
        type="button"
        class="task-tab"
        :class="{ active: activeTab === 'active' }"
        role="tab"
        :aria-selected="activeTab === 'active'"
        @click="activeTab = 'active'"
      >
        {{ t('graph.tasks.tabActive') }}
        <span v-if="activeCount > 0" class="tab-count">{{ activeCount }}</span>
      </button>
      <button
        type="button"
        class="task-tab"
        :class="{ active: activeTab === 'completed' }"
        role="tab"
        :aria-selected="activeTab === 'completed'"
        @click="activeTab = 'completed'"
      >
        {{ t('graph.tasks.tabCompleted') }}
        <span v-if="completedCount > 0" class="tab-count">{{ completedCount }}</span>
      </button>
    </div>

    <div class="task-body">
      <template v-if="activeTab === 'active'">
        <section v-if="activeVideoJobs.length" class="section">
          <h3 class="section-title">{{ t('graph.tasks.videoSection') }}</h3>
          <ul class="task-list">
            <li v-for="job in activeVideoJobs" :key="job.localJobId" class="task-row">
              <div class="task-row-main">
                <div class="task-meta">
                  <span class="task-title">{{ videoJobTitle(job) }}</span>
                  <span class="task-status" :data-status="job.status">
                    {{ videoStatusLabel(job.status) }}
                    <template v-if="job.progress > 0"> · {{ job.progress }}%</template>
                  </span>
                </div>
                <p class="task-sub">{{ job.model }}</p>
              </div>
              <div class="task-actions">
                <button type="button" class="danger-lite" @click="onCancelVideo(job.localJobId)">
                  {{ t('graph.tasks.stop') }}
                </button>
              </div>
            </li>
          </ul>
        </section>

        <section class="section">
          <h3 v-if="activeVideoJobs.length" class="section-title">
            {{ t('graph.tasks.workflowSection') }}
          </h3>
          <p v-if="!tasks.length" class="empty">
            {{
              activeVideoJobs.length
                ? t('graph.tasks.emptyWorkflowActive')
                : t('graph.tasks.emptyActive')
            }}
          </p>
          <ul v-else class="task-list">
            <li v-for="task in tasks" :key="task.id" class="task-row">
              <div class="task-row-main">
                <div class="task-meta">
                  <span class="task-title">{{ task.title }}</span>
                  <span class="task-status" :data-status="task.status">
                    {{ statusLabel(task.status) }}
                  </span>
                </div>
                <div class="flow" :title="flowTitle(task)">
                  <template v-for="(node, index) in task.nodes" :key="node.nodeId">
                    <span
                      class="flow-node"
                      :data-status="node.status"
                      :title="`${node.title} · ${nodeStatusLabel(node.status)}`"
                    >
                      <span class="flow-icon" aria-hidden="true">{{ node.icon }}</span>
                      <span class="flow-dot" aria-hidden="true" />
                    </span>
                    <span
                      v-if="index < task.nodes.length - 1"
                      class="flow-arrow"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </template>
                </div>
              </div>
              <div class="task-actions">
                <button type="button" class="danger-lite" @click="onStop(task.id)">
                  {{ t('graph.tasks.stop') }}
                </button>
              </div>
            </li>
          </ul>
        </section>
      </template>

      <template v-else>
        <section v-if="recentTerminalVideoJobs.length" class="section">
          <h3 class="section-title">{{ t('graph.tasks.videoSection') }}</h3>
          <ul class="task-list">
            <li v-for="job in recentTerminalVideoJobs" :key="job.localJobId" class="task-row">
              <div class="task-row-main">
                <div class="task-meta">
                  <span class="task-title">{{ videoJobTitle(job) }}</span>
                  <span class="task-status" :data-status="job.status">
                    {{ videoStatusLabel(job.status) }}
                  </span>
                </div>
                <p v-if="job.error" class="task-sub error">{{ job.error }}</p>
                <p v-else-if="job.relativePath" class="task-sub">{{ job.relativePath }}</p>
              </div>
            </li>
          </ul>
        </section>

        <section class="section">
          <h3 v-if="recentTerminalVideoJobs.length" class="section-title">
            {{ t('graph.tasks.workflowSection') }}
          </h3>
          <p v-if="!completed.length" class="empty">
            {{
              recentTerminalVideoJobs.length
                ? t('graph.tasks.emptyWorkflowCompleted')
                : t('graph.tasks.emptyCompleted')
            }}
          </p>
          <ul v-else class="task-list">
            <li v-for="task in completed" :key="task.id" class="task-row">
              <div class="task-row-main">
                <div class="task-meta">
                  <span class="task-title">{{ task.title }}</span>
                  <span class="task-status" :data-status="task.status">
                    {{ statusLabel(task.status) }}
                  </span>
                </div>
                <div class="flow" :title="flowTitle(task)">
                  <template v-for="(node, index) in task.nodes" :key="node.nodeId">
                    <span
                      class="flow-node"
                      :data-status="node.status"
                      :title="`${node.title} · ${nodeStatusLabel(node.status)}`"
                    >
                      <span class="flow-icon" aria-hidden="true">{{ node.icon }}</span>
                      <span class="flow-dot" aria-hidden="true" />
                    </span>
                    <span
                      v-if="index < task.nodes.length - 1"
                      class="flow-arrow"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </template>
                </div>
              </div>
              <div class="task-actions">
                <button type="button" @click="onRemove(task.id)">
                  {{ t('graph.tasks.remove') }}
                </button>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useGraphTaskStore, type GraphTask, type GraphTaskStatus } from '../stores/graphTasks'
import { useProjectStore } from '../stores/project'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptConfirm } from '../composables/useStudioPrompt'
import type { GraphNodeRunStatus } from '@shared/graph'
import type { VideoJobRecord, VideoJobStatus } from '@shared/videoJob'
import { isVideoJobActive } from '@shared/videoJob'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

type TaskTab = 'active' | 'completed'

const { t } = useStudioI18n()
const taskStore = useGraphTaskStore()
const project = useProjectStore()
const { tasks, completed, dialogOpen } = storeToRefs(taskStore)
const activeTab = ref<TaskTab>('active')
const videoJobs = ref<VideoJobRecord[]>([])

const activeVideoJobs = computed(() => videoJobs.value.filter((j) => isVideoJobActive(j.status)))
const recentTerminalVideoJobs = computed(() =>
  videoJobs.value.filter((j) => !isVideoJobActive(j.status)).slice(0, 20)
)
const activeCount = computed(() => tasks.value.length + activeVideoJobs.value.length)
const completedCount = computed(() => completed.value.length + recentTerminalVideoJobs.value.length)

let stopVideoJobUpdated: (() => void) | null = null

async function refreshVideoJobs(): Promise<void> {
  if (!project.isOpen || typeof window.studio?.listVideoJobs !== 'function') {
    videoJobs.value = []
    return
  }
  try {
    videoJobs.value = await window.studio.listVideoJobs()
  } catch {
    videoJobs.value = []
  }
}

watch(
  dialogOpen,
  (open) => {
    if (open) void refreshVideoJobs()
  },
  { immediate: true }
)

watch(
  () => project.isOpen,
  (open) => {
    if (open) void refreshVideoJobs()
    else videoJobs.value = []
  }
)

if (typeof window.studio?.onVideoJobUpdated === 'function') {
  stopVideoJobUpdated = window.studio.onVideoJobUpdated((job) => {
    const idx = videoJobs.value.findIndex((j) => j.localJobId === job.localJobId)
    if (idx >= 0) {
      videoJobs.value = [
        ...videoJobs.value.slice(0, idx),
        job,
        ...videoJobs.value.slice(idx + 1)
      ]
    } else {
      videoJobs.value = [job, ...videoJobs.value]
    }
    if (job.status === 'succeeded') {
      void project.scheduleRefreshLibrary()
    }
  })
}

onBeforeUnmount(() => {
  stopVideoJobUpdated?.()
  stopVideoJobUpdated = null
})

function close(): void {
  taskStore.closeDialog()
}

function statusLabel(status: GraphTaskStatus): string {
  return t(`graph.tasks.status.${status}`)
}

function nodeStatusLabel(status: GraphNodeRunStatus): string {
  return t(`graph.tasks.nodeStatus.${status}`)
}

function videoStatusLabel(status: VideoJobStatus): string {
  return t(`graph.tasks.videoStatus.${status}`)
}

function videoJobTitle(job: VideoJobRecord): string {
  return job.name?.trim() || job.prompt.trim().slice(0, 48) || t('graph.tasks.videoUntitled')
}

function flowTitle(task: GraphTask): string {
  return task.nodes.map((n) => n.title).join(' → ')
}

async function onStop(taskId: string): Promise<void> {
  const ok = await promptConfirm({
    title: t('graph.tasks.stopConfirmTitle'),
    message: t('graph.tasks.stopConfirmMessage')
  })
  if (!ok) return
  await taskStore.stopAndRemove(taskId)
}

async function onCancelVideo(localJobId: string): Promise<void> {
  const ok = await promptConfirm({
    title: t('graph.tasks.stopConfirmTitle'),
    message: t('graph.tasks.videoStopConfirmMessage')
  })
  if (!ok) return
  await window.studio.cancelVideoJob(localJobId)
  await refreshVideoJobs()
}

function onRemove(taskId: string): void {
  taskStore.removeTask(taskId)
}
</script>

<style scoped>
.eyebrow {
  display: block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

h2 {
  margin: 4px 0 0;
  font-size: 15px;
  font-weight: 600;
}

.task-tabs {
  display: flex;
  gap: 4px;
  margin: -4px 0 8px;
  padding-bottom: 0;
  border-bottom: 1px solid var(--border);
}

.task-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  background: transparent;
  color: var(--text-muted);
  font-size: 12px;
}

.task-tab:hover {
  color: var(--text);
}

.task-tab.active {
  color: var(--text);
  border-bottom-color: #5a9dff;
}

.tab-count {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 8px;
  background: var(--bg-hover);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.task-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.section {
  margin-bottom: 12px;
}

.section-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.empty {
  margin: 16px 0;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.task-row-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-title {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-sub {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-sub.error {
  color: var(--danger);
  white-space: normal;
}

.task-status {
  flex: none;
  font-size: 11px;
  color: var(--text-muted);
}

.task-status[data-status='running'],
.task-status[data-status='pending'],
.task-status[data-status='submitted'] {
  color: var(--accent);
}

.task-status[data-status='done'],
.task-status[data-status='succeeded'] {
  color: var(--success);
}

.task-status[data-status='error'],
.task-status[data-status='stopped'],
.task-status[data-status='failed'],
.task-status[data-status='cancelled'] {
  color: var(--danger);
}

.flow {
  display: flex;
  align-items: center;
  gap: 4px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.flow-node {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  flex: none;
}

.flow-icon {
  font-size: 14px;
  line-height: 1;
}

.flow-dot {
  position: absolute;
  right: -2px;
  bottom: -2px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6b7280;
  box-shadow: 0 0 0 1px #12151a;
}

.flow-node[data-status='pending'] .flow-dot {
  background: #8b93a3;
}

.flow-node[data-status='running'] .flow-dot {
  background: #5ecf8a;
  animation: flow-dot-blink 1s ease-in-out infinite;
}

@keyframes flow-dot-blink {
  0%,
  100% {
    opacity: 1;
    box-shadow:
      0 0 0 1px #12151a,
      0 0 4px 1px rgba(94, 207, 138, 0.7);
  }
  50% {
    opacity: 0.3;
    box-shadow: 0 0 0 1px #12151a;
  }
}

@media (prefers-reduced-motion: reduce) {
  .flow-node[data-status='running'] .flow-dot {
    animation: none;
  }
}

.flow-node[data-status='done'] .flow-dot {
  background: #5ecf8a;
}

.flow-node[data-status='error'] .flow-dot {
  background: #e07070;
}

.flow-arrow {
  color: var(--text-muted);
  font-size: 11px;
  flex: none;
}

.task-actions {
  flex: none;
}

.danger-lite {
  border-color: rgba(200, 80, 70, 0.45);
  color: var(--danger);
}
</style>
