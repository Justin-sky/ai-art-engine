<template>
  <StudioFloatingWindow
    :open="dialogOpen"
    :close-title="t('common.cancel')"
    :z-index="3110"
    :default-width="960"
    :default-height="640"
    :min-width="640"
    :min-height="420"
    @close="close"
  >
    <template #title>
      <div>
        <span class="eyebrow">{{ t('graph.logs.mark') }}</span>
        <h2>{{ t('graph.logs.title') }}</h2>
      </div>
    </template>

    <template #title-actions>
      <button
        type="button"
        class="tool-btn"
        :disabled="!selectedSession"
        :title="t('graph.logs.copy')"
        @click="copySelected"
      >
        {{ copiedFlash ? t('graph.logs.copied') : t('graph.logs.copy') }}
      </button>
      <button
        type="button"
        class="tool-btn danger"
        :disabled="!sessions.length"
        :title="t('graph.logs.clearAll')"
        @click="clearAll"
      >
        {{ t('graph.logs.clearAll') }}
      </button>
    </template>

    <div class="log-layout">
      <aside class="session-pane">
        <p v-if="!sessions.length" class="empty">{{ t('graph.logs.emptySessions') }}</p>
        <ul v-else class="session-list">
          <li
            v-for="session in sessions"
            :key="session.runId"
            class="session-row"
            :class="{ active: session.runId === selectedSession?.runId }"
            @click="selectSession(session.runId)"
          >
            <div class="session-title-row">
              <span class="session-title">{{ session.title }}</span>
              <span class="session-status" :data-status="session.status">
                {{ sessionStatusLabel(session.status) }}
              </span>
            </div>
            <div class="session-meta">
              <span>{{ formatTime(session.startedAt) }}</span>
              <span>{{ modeLabel(session.mode) }}</span>
            </div>
          </li>
        </ul>
      </aside>

      <section class="event-pane">
        <div class="event-toolbar">
          <input
            v-model="search"
            type="search"
            class="search"
            :placeholder="t('graph.logs.searchPlaceholder')"
          />
          <div class="level-filters" role="group" :aria-label="t('graph.logs.filterLevel')">
            <button
              v-for="level in levelOptions"
              :key="level"
              type="button"
              class="level-chip"
              :class="{ active: levelFilter === level }"
              @click="levelFilter = level"
            >
              {{ levelFilterLabel(level) }}
            </button>
          </div>
        </div>

        <p v-if="!selectedSession" class="empty">{{ t('graph.logs.emptyEvents') }}</p>
        <p v-else-if="!filteredEvents.length" class="empty">{{ t('graph.logs.emptyFiltered') }}</p>
        <template v-else>
          <div ref="splitHostEl" class="split-host">
            <ul
              ref="eventListEl"
              class="event-list"
              :style="{ flexBasis: `${listPanePercent}%`, flexGrow: 0, flexShrink: 0 }"
            >
              <li
                v-for="event in filteredEvents"
                :key="event.id"
                class="event-row"
                :class="{ active: event.id === selectedEventId }"
                :data-level="event.level"
                :data-status="eventDisplayStatus(event)"
                @click="selectedEventId = event.id"
              >
                <span class="event-time">{{ formatEventTime(event.ts) }}</span>
                <span class="event-kind">{{ kindLabel(event.kind) }}</span>
                <span class="event-node" :title="event.nodeTitle || event.nodeId || ''">
                  {{ event.nodeTitle || event.nodeId || '—' }}
                </span>
                <span class="event-status" :data-status="eventDisplayStatus(event)">
                  {{ eventStatusLabel(event) }}
                </span>
                <span class="event-duration">
                  {{ event.durationMs != null ? formatDuration(event.durationMs) : '—' }}
                </span>
                <span class="event-message" :title="event.message || ''">
                  {{ event.message || '' }}
                </span>
              </li>
            </ul>

            <div
              class="split-handle"
              role="separator"
              aria-orientation="horizontal"
              :aria-valuenow="Math.round(listPanePercent)"
              :title="t('graph.logs.resizeSplit')"
              @pointerdown="onSplitPointerDown"
            />

            <div class="detail-pane">
            <div class="detail-head">
              <span class="detail-title">{{ t('graph.logs.detailTitle') }}</span>
              <span v-if="selectedEvent" class="detail-sub">
                {{ selectedEvent.nodeTitle || selectedEvent.nodeId || kindLabel(selectedEvent.kind) }}
                ·
                {{ eventStatusLabel(selectedEvent) }}
              </span>
            </div>

            <p v-if="!selectedEvent" class="empty detail-empty">{{ t('graph.logs.detailHint') }}</p>
            <template v-else>
              <div class="detail-meta">
                <div>
                  <span class="meta-label">{{ t('graph.logs.detailTime') }}</span>
                  <span>{{ formatTime(selectedEvent.ts) }}</span>
                </div>
                <div v-if="selectedEvent.durationMs != null">
                  <span class="meta-label">{{ t('graph.logs.detailDuration') }}</span>
                  <span>{{ formatDuration(selectedEvent.durationMs) }}</span>
                </div>
                <div v-if="selectedEvent.typeId">
                  <span class="meta-label">{{ t('graph.logs.detailType') }}</span>
                  <span>{{ selectedEvent.typeId }}</span>
                </div>
                <div v-if="selectedEvent.errorCode">
                  <span class="meta-label">{{ t('graph.logs.detailError') }}</span>
                  <span class="error-text">{{ selectedEvent.errorCode }}</span>
                </div>
              </div>

              <p v-if="selectedEvent.message" class="detail-message">{{ selectedEvent.message }}</p>

              <!-- 完成/失败优先展示输出；运行中展示输入（含空端口） -->
              <template v-if="selectedEvent.outputs && Object.keys(selectedEvent.outputs).length">
                <label class="code-label">{{ t('graph.logs.portOutputs') }}</label>
                <pre class="code-block">{{ formatJson(selectedEvent.outputs) }}</pre>
              </template>
              <template v-if="selectedEvent.inputs">
                <label class="code-label">{{ t('graph.logs.portInputs') }}</label>
                <pre class="code-block">{{ formatJson(selectedEvent.inputs) }}</pre>
              </template>

              <template v-if="selectedApiCalls.length">
                <div
                  v-for="(call, index) in selectedApiCalls"
                  :key="call.id"
                  class="api-block"
                >
                  <div class="api-head">
                    <span>{{ t('graph.logs.apiCall', { n: index + 1, kind: call.kind }) }}</span>
                    <span v-if="call.durationMs != null" class="muted">
                      {{ formatDuration(call.durationMs) }}
                    </span>
                  </div>
                  <p v-if="call.error" class="error-text">{{ call.error }}</p>
                  <label class="code-label">{{ t('graph.logs.apiRequest') }}</label>
                  <pre class="code-block">{{ formatJson(call.request) }}</pre>
                  <label class="code-label">{{ t('graph.logs.apiResponse') }}</label>
                  <pre v-if="call.response" class="code-block">{{ formatJson(call.response) }}</pre>
                  <p v-else class="muted">{{ t('graph.logs.apiResponseEmpty') }}</p>
                </div>
              </template>
              <p v-else-if="!selectedEventHasPorts" class="muted detail-empty">
                {{ selectedApiEmptyText }}
              </p>
            </template>
            </div>
          </div>
        </template>
      </section>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import type {
  GraphNodeRunStatus,
  GraphRunLogEvent,
  GraphRunLogEventKind,
  GraphRunLogLevel,
  GraphRunLogMode,
  GraphRunLogSessionStatus
} from '@shared/graph'
import { useGraphRunLogsStore } from '../stores/graphRunLogs'
import { useStudioI18n } from '../composables/useStudioI18n'
import { promptConfirm } from '../composables/useStudioPrompt'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

type LevelFilter = 'all' | GraphRunLogLevel

const { t } = useStudioI18n()
const logStore = useGraphRunLogsStore()
const { sessions, dialogOpen, selectedSession, activeRunId } = storeToRefs(logStore)

const search = ref('')
const levelFilter = ref<LevelFilter>('all')
const levelOptions: LevelFilter[] = ['all', 'info', 'warn', 'error']
const eventListEl = ref<HTMLElement | null>(null)
const splitHostEl = ref<HTMLElement | null>(null)
const selectedEventId = ref<string | null>(null)
const listPanePercent = ref(45)
const copiedFlash = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null
let splitDragging = false

const LIST_PANE_MIN = 18
const LIST_PANE_MAX = 82

function onSplitPointerDown(e: PointerEvent): void {
  const host = splitHostEl.value
  if (!host) return
  splitDragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  updateSplitFromClientY(e.clientY)
  window.addEventListener('pointermove', onSplitPointerMove)
  window.addEventListener('pointerup', onSplitPointerUp)
  window.addEventListener('pointercancel', onSplitPointerUp)
}

function onSplitPointerMove(e: PointerEvent): void {
  if (!splitDragging) return
  updateSplitFromClientY(e.clientY)
}

function onSplitPointerUp(): void {
  splitDragging = false
  window.removeEventListener('pointermove', onSplitPointerMove)
  window.removeEventListener('pointerup', onSplitPointerUp)
  window.removeEventListener('pointercancel', onSplitPointerUp)
}

function updateSplitFromClientY(clientY: number): void {
  const host = splitHostEl.value
  if (!host) return
  const rect = host.getBoundingClientRect()
  if (rect.height <= 0) return
  const ratio = ((clientY - rect.top) / rect.height) * 100
  listPanePercent.value = Math.min(LIST_PANE_MAX, Math.max(LIST_PANE_MIN, ratio))
}

onBeforeUnmount(() => {
  onSplitPointerUp()
})

const filteredEvents = computed(() => {
  const session = selectedSession.value
  if (!session) return []
  const q = search.value.trim().toLowerCase()
  return session.events.filter((event) => {
    if (levelFilter.value !== 'all' && event.level !== levelFilter.value) return false
    if (!q) return true
    const hay = [
      event.nodeTitle,
      event.nodeId,
      event.message,
      event.status,
      event.kind,
      event.typeId,
      event.errorCode
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
})

const selectedEvent = computed((): GraphRunLogEvent | null => {
  const id = selectedEventId.value
  if (!id) return null
  return filteredEvents.value.find((e) => e.id === id) ?? null
})

/** API 详情：优先挂在完成/失败上；会话已结束时中间态也可查看同节点已记录的调用 */
const selectedApiCalls = computed(() => {
  const session = selectedSession.value
  const event = selectedEvent.value
  if (!session || !event?.nodeId) return []
  const status = eventDisplayStatus(event)
  const sessionActive = session.status === 'running'
  if (status !== 'done' && status !== 'error' && sessionActive) return []
  return (session.apiCalls ?? []).filter((call) => call.nodeId === event.nodeId)
})

const selectedEventHasPorts = computed(() => {
  const event = selectedEvent.value
  if (!event) return false
  return (
    event.inputs != null || (!!event.outputs && Object.keys(event.outputs).length > 0)
  )
})

const selectedApiEmptyText = computed(() => {
  const session = selectedSession.value
  const event = selectedEvent.value
  if (!event) return t('graph.logs.apiEmpty')
  if (!event.nodeId) return t('graph.logs.apiEmptyNotNode')
  const status = eventDisplayStatus(event)
  const sessionActive = session?.status === 'running'
  if ((status === 'pending' || status === 'running') && sessionActive) {
    return t('graph.logs.apiEmptyPending')
  }
  if ((status === 'pending' || status === 'running') && !sessionActive) {
    return t('graph.logs.apiEmptyPickDone')
  }
  if (isPassthroughOutputType(event.typeId)) {
    return t('graph.logs.apiEmptyPassthrough')
  }
  return t('graph.logs.apiEmpty')
})

function isPassthroughOutputType(typeId: string | undefined): boolean {
  if (!typeId) return false
  return (
    typeId.startsWith('output.') ||
    typeId === 'world.table' ||
    typeId === 'beat.table'
  )
}

watch(
  () => selectedSession.value?.runId,
  () => {
    selectedEventId.value = null
  }
)

watch(
  filteredEvents,
  (events) => {
    if (!events.length) {
      selectedEventId.value = null
      return
    }
    if (!selectedEventId.value || !events.some((e) => e.id === selectedEventId.value)) {
      // 优先落到会话结束或节点终态，避免默认停在「运行中」中间行
      const preferred =
        [...events].reverse().find((event) => {
          const status = eventDisplayStatus(event)
          return (
            event.kind === 'run_end' ||
            status === 'done' ||
            status === 'error' ||
            status === 'skipped'
          )
        }) ?? events[events.length - 1]
      selectedEventId.value = preferred?.id ?? null
    }
  },
  { immediate: true }
)

watch(
  () => [dialogOpen.value, selectedSession.value?.events.length, activeRunId.value] as const,
  async ([open]) => {
    if (!open) return
    const session = selectedSession.value
    if (!session || session.runId !== activeRunId.value) return
    await nextTick()
    const el = eventListEl.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

function close(): void {
  logStore.closeDialog()
}

function selectSession(runId: string): void {
  logStore.selectSession(runId)
}

function sessionStatusLabel(status: GraphRunLogSessionStatus): string {
  return t(`graph.logs.sessionStatus.${status}`)
}

function modeLabel(mode: GraphRunLogMode): string {
  return t(`graph.logs.mode.${mode}`)
}

function kindLabel(kind: GraphRunLogEventKind): string {
  return t(`graph.logs.kind.${kind}`)
}

function nodeStatusLabel(status: GraphNodeRunStatus): string {
  return t(`graph.tasks.nodeStatus.${status}`)
}

function eventDisplayStatus(event: GraphRunLogEvent): string {
  if (event.status) return event.status
  if (event.kind === 'run_start') return 'running'
  if (event.kind === 'run_end') {
    return event.level === 'error' ? 'error' : event.level === 'warn' ? 'error' : 'done'
  }
  if (event.level === 'error') return 'error'
  if (event.level === 'warn') return 'pending'
  return 'done'
}

function eventStatusLabel(event: GraphRunLogEvent): string {
  const status = eventDisplayStatus(event)
  if (
    status === 'idle' ||
    status === 'pending' ||
    status === 'running' ||
    status === 'done' ||
    status === 'error' ||
    status === 'skipped'
  ) {
    return nodeStatusLabel(status)
  }
  return status
}

function levelFilterLabel(level: LevelFilter): string {
  return t(`graph.logs.level.${level}`)
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleString()
}

function formatEventTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function copySelected(): Promise<void> {
  const session = selectedSession.value
  if (!session) return
  const text = logStore.formatSessionPlainText(session)
  try {
    await navigator.clipboard.writeText(text)
    copiedFlash.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copiedFlash.value = false
      copiedTimer = null
    }, 1600)
  } catch {
    // ignore clipboard failures
  }
}

async function clearAll(): Promise<void> {
  const ok = await promptConfirm({
    title: t('graph.logs.clearConfirmTitle'),
    message: t('graph.logs.clearConfirmMessage')
  })
  if (!ok) return
  logStore.clear()
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

.tool-btn {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.tool-btn.danger {
  color: var(--danger);
  border-color: rgba(240, 160, 160, 0.35);
}

.log-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 0;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.session-pane {
  border-right: 1px solid var(--border);
  background: var(--bg-elevated);
  min-height: 0;
  overflow: auto;
}

.event-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.session-list,
.event-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.session-row {
  padding: 10px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  cursor: pointer;
}

.session-row:hover {
  background: var(--bg-hover);
}

.session-row.active {
  background: rgba(90, 157, 255, 0.12);
}

.session-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.session-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.session-status {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-hover);
  color: var(--text-muted);
}

.session-status[data-status='running'],
.event-status[data-status='running'] {
  color: var(--accent);
}

.session-status[data-status='done'],
.event-status[data-status='done'] {
  color: var(--success);
}

.session-status[data-status='error'],
.event-status[data-status='error'] {
  color: var(--danger);
}

.session-status[data-status='stopped'] {
  color: #e0c070;
}

.session-meta {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.event-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.search {
  flex: 1;
  min-width: 140px;
  font-size: 12px;
}

.level-filters {
  display: flex;
  gap: 4px;
}

.level-chip {
  padding: 3px 8px;
  border: 1px solid transparent;
  border-radius: 999px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.level-chip.active {
  color: var(--text);
  border-color: rgba(90, 157, 255, 0.45);
  background: rgba(90, 157, 255, 0.12);
}

.split-host {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.event-list {
  min-height: 80px;
  overflow: auto;
  padding: 6px 0;
}

.split-handle {
  flex: 0 0 6px;
  margin: 0;
  cursor: row-resize;
  background: color-mix(in srgb, var(--border) 85%, transparent);
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  touch-action: none;
}

.split-handle:hover,
.split-handle:active {
  background: color-mix(in srgb, #5a9dff 45%, var(--border));
}

.event-row {
  display: grid;
  grid-template-columns: 72px 56px minmax(72px, 1.1fr) 52px 52px minmax(0, 2fr);
  gap: 8px;
  align-items: baseline;
  padding: 7px 12px;
  font-size: 11px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  cursor: pointer;
}

.event-row:hover {
  background: var(--bg-hover);
}

.event-row.active {
  background: rgba(90, 157, 255, 0.14);
}

.event-row[data-level='error'] {
  background: rgba(140, 50, 50, 0.12);
}

.event-row[data-level='warn'] {
  background: rgba(140, 110, 40, 0.1);
}

.event-time {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.event-kind {
  color: var(--accent);
}

.event-node {
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.event-status {
  color: var(--text-muted);
}

.event-status[data-status='pending'] {
  color: var(--text-muted);
}

.event-status[data-status='skipped'] {
  color: #e0c070;
}

.event-duration {
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.event-message {
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-pane {
  flex: 1 1 auto;
  min-height: 80px;
  overflow: auto;
  padding: 10px 12px 14px;
  background: rgba(0, 0, 0, 0.12);
  /* 覆盖全局 body { user-select: none }，支持拖选复制详情 */
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.detail-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.detail-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.detail-sub {
  font-size: 11px;
  color: var(--text-muted);
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  margin-bottom: 8px;
  font-size: 11px;
  color: var(--text);
}

.meta-label {
  margin-right: 6px;
  color: var(--text-muted);
}

.detail-message {
  margin: 0 0 10px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
  white-space: pre-wrap;
}

.api-block {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
}

.api-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text);
}

.code-label {
  display: block;
  margin: 8px 0 4px;
  font-size: 10px;
  color: var(--text-muted);
}

.code-block {
  margin: 0;
  max-height: 220px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  background: var(--graph-preview-bg);
  color: var(--text);
  font-size: 11px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
  cursor: text;
}

.error-text {
  color: var(--danger);
}

.muted {
  color: var(--text-muted);
  font-size: 11px;
}

.empty,
.detail-empty {
  margin: 12px 0;
  padding-left: 12px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
