<template>
  <div class="yolo-panel">
    <p class="hint">
      {{ t('settings.yoloModels.intro') }}
    </p>

    <!-- 推理运行时状态 -->
    <div class="status-line">
      <span
        class="pill"
        :class="{ ok: statusReady }"
      >{{ statusReady
        ? t('settings.yoloModels.statusReady')
        : t('settings.yoloModels.statusBusy') }}</span>
      <code
        v-if="statusReady && yoloStatus?.ortVersion"
        class="meta"
      >onnxruntime {{ yoloStatus.ortVersion }}</code>
      <span
        v-if="statusReady && yoloStatus?.backend"
        class="meta"
      >· {{ yoloStatus.backend }}</span>
      <span class="spacer" />
      <button
        type="button"
        class="ghost-btn"
        :disabled="loading"
        @click="refreshAll"
      >
        {{ t('settings.yoloModels.refresh') }}
      </button>
    </div>
    <p
      v-if="yoloStatus?.error && !yoloStatus.ready"
      class="err"
    >
      {{ yoloStatus.error }}
    </p>

    <label class="check">
      <input
        v-model="yolo.enabled"
        type="checkbox"
      >
      {{ t('settings.yoloModels.enabled') }}
    </label>

    <!-- 模型目录 -->
    <h2>{{ t('settings.yoloModels.dirTitle') }}</h2>
    <p class="hint">
      {{ t('settings.yoloModels.dirHint') }}
    </p>
    <label>
      <span>{{ t('settings.yoloModels.dirLabel') }}</span>
      <input
        v-model="dirInput"
        type="text"
        spellcheck="false"
        class="dir-input"
        @change="commitDir"
      >
    </label>
    <div class="btn-row">
      <button
        type="button"
        :disabled="loading || dirInput !== yolo.modelDir"
        @click="commitDir"
      >
        {{ t('settings.yoloModels.applyDir') }}
      </button>
      <button
        type="button"
        @click="browseDir"
      >
        {{ t('settings.yoloModels.chooseDir') }}
      </button>
      <button
        type="button"
        @click="openDir"
      >
        {{ t('settings.yoloModels.openDir') }}
      </button>
      <button
        v-if="hasCustomDir"
        type="button"
        @click="resetDir"
      >
        {{ t('settings.yoloModels.resetDir') }}
      </button>
    </div>

    <div class="row-2">
      <label>
        <span>{{ t('settings.yoloModels.confLabel') }}</span>
        <div class="number-row">
          <input
            v-model.number="yolo.confThreshold"
            type="number"
            min="0.05"
            max="0.95"
            step="0.05"
          >
          <span class="meta">0–1</span>
        </div>
      </label>
      <label>
        <span>{{ t('settings.yoloModels.iouLabel') }}</span>
        <div class="number-row">
          <input
            v-model.number="yolo.iouThreshold"
            type="number"
            min="0.05"
            max="0.95"
            step="0.05"
          >
          <span class="meta">0–1</span>
        </div>
      </label>
    </div>

    <!-- 已安装模型 -->
    <h2>
      {{ t('settings.yoloModels.installedTitle') }}
      <span class="count-badge">{{ installedModels.length }}</span>
    </h2>
    <p class="hint">
      {{ t('settings.yoloModels.defaultPickHint') }}
    </p>
    <p
      v-if="installedModels.length === 0"
      class="meta empty"
    >
      {{ t('settings.yoloModels.installedEmpty') }}
    </p>
    <ul
      v-else
      class="model-list"
    >
      <li
        v-for="m in installedModels"
        :key="m.id"
      >
        <span class="model-id">{{ m.id }}</span>
        <span class="kind-chip">{{ kindLabel(m.kind) }}</span>
        <span class="meta">{{ m.sizeMb }} MB</span>
        <span
          v-if="isAutoPick(m)"
          class="auto-chip"
          :title="t('settings.yoloModels.autoPickTitle')"
        >{{ t('settings.yoloModels.autoPick') }}</span>
        <button
          type="button"
          class="danger-btn"
          :disabled="loading"
          @click="toggleDelete(m.id)"
        >
          {{ confirmingDelete === m.id
            ? t('settings.yoloModels.deleteConfirm')
            : t('settings.yoloModels.delete') }}
        </button>
      </li>
    </ul>

    <!-- 官方可下载目录 -->
    <h2>
      {{ t('settings.yoloModels.catalogTitle') }}
      <span class="count-badge">{{ catalog.length }}</span>
    </h2>
    <p class="hint">
      {{ t('settings.yoloModels.catalogHint') }}
    </p>

    <!-- 全局下载进度 -->
    <div
      v-if="activeProgress"
      class="progress-card"
    >
      <div class="progress-head">
        <code class="model-id">{{ activeProgress.modelId }}</code>
        <span class="meta">{{ progressStageLabel }}</span>
        <span class="meta progress-pct">{{ progressPercentLabel }}</span>
        <span class="spacer" />
        <button
          type="button"
          class="ghost-btn"
          @click="cancelDownload"
        >
          {{ t('settings.yoloModels.cancelDownload') }}
        </button>
      </div>
      <div
        v-if="activeProgress.phase === 'downloading'"
        class="track"
      >
        <div
          class="fill"
          :style="{ width: `${progressPercent}%` }"
        />
      </div>
    </div>

    <div
      v-for="kind in YOLO_KIND_ORDER"
      :key="kind"
      class="cat-group"
    >
      <h3>{{ kindLabel(kind) }}</h3>
      <ul class="model-list catalog-list">
        <li
          v-for="model in catalogByKind(kind)"
          :key="model.id"
        >
          <span class="model-id">{{ model.id }}</span>
          <span class="meta size">≈ {{ model.sizeMb }} MB</span>
          <span
            v-if="isInstalled(model.id)"
            class="ok-chip"
          >{{ t('settings.yoloModels.installedTag') }}</span>
          <span
            v-else-if="downloadingId === model.id"
            class="ok-chip busy"
          >{{ activeProgress?.phase === 'verifying'
            ? t('settings.yoloModels.verifyingTag')
            : t('settings.yoloModels.downloadingTag') }}</span>
          <button
            v-else
            type="button"
            class="download-btn"
            :disabled="!!downloadingId || loading"
            @click="startDownload(model)"
          >
            {{ t('settings.yoloModels.download') }}
          </button>
        </li>
      </ul>
    </div>

    <p
      v-if="feedback"
      class="msg"
      :class="{ error: feedbackError }"
    >
      {{ feedback }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { YoloSettings } from '@shared/domain'
import { YOLO_KIND_ORDER } from '@shared/yoloCatalog'
import type {
  YoloCatalogModel,
  YoloModelDownloadProgress,
  YoloModelInfo,
  YoloStatus,
  YoloTaskKind
} from '@shared/yolo'
import { useStudioI18n } from '../../composables/useStudioI18n'

/**
 * 双向绑定整个 YoloSettings 设置对象（父层传 form.yolo）。
 * 面板只修改对象属性（就地变更），父层对 form 的深 watch 会自动持久化，
 * 因此这里无需 emit 整对象替换。
 */
const yolo = defineModel<YoloSettings>('yolo', { required: true })

const { t } = useStudioI18n()

const yoloStatus = ref<YoloStatus | null>(null)
const catalog = ref<YoloCatalogModel[]>([])
const loading = ref(false)
const dirInput = ref('')
const progress = ref<YoloModelDownloadProgress | null>(null)
const confirmingDelete = ref<string | null>(null)
const feedback = ref('')
const feedbackError = ref(false)
let stopProgressListen: (() => void) | null = null
let confirmTimer: ReturnType<typeof setTimeout> | null = null
let progressClearTimer: ReturnType<typeof setTimeout> | null = null

const statusReady = computed(() => !!yoloStatus.value?.ready)
const hasCustomDir = computed(() => !!yolo.value.modelDir?.trim())
const installedModels = computed<YoloModelInfo[]>(() => yoloStatus.value?.models ?? [])
const downloadingId = computed(() =>
  progress.value && (progress.value.phase === 'downloading' || progress.value.phase === 'verifying')
    ? progress.value.modelId
    : ''
)
const activeProgress = computed(() =>
  progress.value &&
  (progress.value.phase === 'downloading' || progress.value.phase === 'verifying')
    ? progress.value
    : null
)
const progressPercent = computed(() => {
  const p = activeProgress.value
  if (!p) return 0
  if (p.phase === 'verifying') return 100
  const byBytes =
    p.totalBytes && p.totalBytes > 0
      ? Math.round(((p.loadedBytes ?? 0) / p.totalBytes) * 100)
      : 0
  return Math.max(0, Math.min(100, byBytes || p.percent || 0))
})
const progressPercentLabel = computed(() =>
  activeProgress.value?.phase === 'verifying'
    ? t('settings.yoloModels.verifyingTag')
    : `${progressPercent.value}% · ${formatMb(activeProgress.value?.loadedBytes)} / ${
        activeProgress.value?.totalBytes ? formatMb(activeProgress.value.totalBytes) : '…'
      }`
)
const progressStageLabel = computed(() =>
  activeProgress.value?.phase === 'verifying'
    ? t('settings.yoloModels.verifyingTag')
    : t('settings.yoloModels.downloadingTag')
)

function kindLabel(kind: YoloTaskKind): string {
  return t(`settings.yoloModels.kind.${kind}`)
}

function formatMb(bytes?: number): string {
  if (!bytes || bytes <= 0) return '…'
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`
}

function catalogByKind(kind: YoloTaskKind): YoloCatalogModel[] {
  return catalog.value.filter((m) => m.kind === kind)
}

function isInstalled(id: string): boolean {
  return installedModels.value.some((m) => m.id === id)
}

/** 该 kind 当前自动选用（目录中体积最大）的模型 id */
function autoPickedIdFor(kind: YoloTaskKind): string | undefined {
  const same = installedModels.value.filter((m) => m.kind === kind)
  if (same.length === 0) return undefined
  return [...same].sort((a, b) => b.sizeMb - a.sizeMb)[0].id
}

function isAutoPick(m: YoloModelInfo): boolean {
  return autoPickedIdFor(m.kind) === m.id
}

function setFeedback(message: string, isError: boolean): void {
  feedback.value = message
  feedbackError.value = isError
}

async function refreshModels(): Promise<void> {
  try {
    yoloStatus.value = await window.studio.getYoloStatus()
    if (!dirInput.value.trim()) syncDirInput()
  } catch (err) {
    setFeedback(err instanceof Error ? err.message : String(err), true)
  }
}

async function refreshCatalog(): Promise<void> {
  try {
    catalog.value = await window.studio.getYoloModelCatalog()
  } catch {
    catalog.value = []
  }
}

async function refreshAll(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([refreshModels(), refreshCatalog()])
  } finally {
    loading.value = false
  }
}

function syncDirInput(): void {
  dirInput.value = yolo.value.modelDir?.trim() || yoloStatus.value?.modelDir || ''
}

function patchDir(value: string): void {
  yolo.value.modelDir = value
  syncDirInput()
}

async function commitDir(): Promise<void> {
  const value = dirInput.value.trim()
  if (value !== yolo.value.modelDir) {
    patchDir(value)
    setFeedback(value ? t('settings.yoloModels.dirApplied') : t('settings.yoloModels.dirResetDefault'), false)
  }
  // 先落盘到主进程设置，再扫描：目录是单机状态，必须立即生效而不是等 500ms debounce
  await window.studio.setYoloModelDir(yolo.value.modelDir ?? '')
  await refreshModels()
}

async function browseDir(): Promise<void> {
  const dir = await window.studio.chooseYoloModelDir()
  if (!dir) return
  patchDir(dir)
  await window.studio.setYoloModelDir(dir)
  await refreshModels()
}

async function openDir(): Promise<void> {
  await window.studio.openYoloModelDir()
}

async function resetDir(): Promise<void> {
  patchDir('')
  setFeedback(t('settings.yoloModels.dirResetDefault'), false)
  await window.studio.setYoloModelDir('')
  await refreshModels()
}

async function toggleDelete(id: string): Promise<void> {
  if (confirmingDelete.value === id) {
    confirmingDelete.value = null
    if (confirmTimer) {
      clearTimeout(confirmTimer)
      confirmTimer = null
    }
    loading.value = true
    try {
      const result = await window.studio.deleteYoloModel(id)
      setFeedback(result.message ?? '', !result.ok)
      await refreshModels()
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err), true)
    } finally {
      loading.value = false
    }
    return
  }
  confirmingDelete.value = id
  if (confirmTimer) clearTimeout(confirmTimer)
  confirmTimer = setTimeout(() => {
    confirmingDelete.value = null
    confirmTimer = null
  }, 3200)
}

async function startDownload(model: YoloCatalogModel): Promise<void> {
  if (downloadingId.value || isInstalled(model.id)) return
  progress.value = { modelId: model.id, phase: 'downloading', percent: 0 }
  feedback.value = ''
  loading.value = true
  try {
    const result = await window.studio.downloadYoloModel(model.id)
    // 用户主动取消走中性提示（cancelled 由主进程结构化标记，不按文案判断）
    setFeedback(result.message ?? '', !result.ok && !result.cancelled)
    await refreshModels()
  } catch (err) {
    setFeedback(err instanceof Error ? err.message : String(err), true)
  } finally {
    loading.value = false
    if (!activeProgress.value) clearProgressSoon()
  }
}

async function cancelDownload(): Promise<void> {
  await window.studio.cancelYoloModelDownload()
}

function onDownloadProgress(payload: YoloModelDownloadProgress): void {
  if (payload.phase === 'done') {
    progress.value = payload
    clearProgressSoon()
    return
  }
  if (payload.phase === 'error' || payload.phase === 'cancelled') {
    progress.value = payload
    clearProgressSoon()
    return
  }
  progress.value = payload
}

function clearProgressSoon(): void {
  if (progressClearTimer) clearTimeout(progressClearTimer)
  progressClearTimer = setTimeout(() => {
    progress.value = null
    progressClearTimer = null
  }, 400)
}

watch(
  () => yolo.value.modelDir,
  () => {
    // 外部（保存规范化/重置）改写目录时同步输入框，但不打扰正在输入的用户
    if (dirInput.value.trim() === '' || !yolo.value.modelDir) syncDirInput()
  }
)

onMounted(async () => {
  stopProgressListen = window.studio.onYoloModelDownloadProgress(onDownloadProgress)
  await refreshAll()
})

onBeforeUnmount(() => {
  stopProgressListen?.()
  stopProgressListen = null
  if (confirmTimer) clearTimeout(confirmTimer)
  if (progressClearTimer) clearTimeout(progressClearTimer)
})
</script>

<style scoped>
.yolo-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 320px;
}

.hint,
.meta,
.empty {
  color: var(--text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.meta {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.empty {
  margin: 0;
}

.err {
  color: var(--danger-muted);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}

.status-line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.pill {
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-muted);
  border: 1px solid var(--border);
}

.pill.ok {
  color: var(--success);
  border-color: rgba(52, 199, 123, 0.4);
}

.spacer {
  flex: 1;
}

.ghost-btn {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
}

.ghost-btn:hover:not(:disabled) {
  color: var(--text);
}

.ghost-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  color: var(--text);
}

.check input {
  width: auto;
}

h2,
h3 {
  margin: 0;
}

h2 {
  font-size: 14px;
  margin-top: 8px;
}

h3 {
  font-size: 13px;
  color: var(--text);
  padding-bottom: 4px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

.dir-input {
  width: 100%;
}

.btn-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.btn-row button {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.btn-row button:hover:not(:disabled) {
  background: var(--wash-04);
}

.row-2 {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.number-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.number-row input {
  width: 120px;
}

.count-badge {
  display: inline-block;
  min-width: 18px;
  padding: 0 6px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  background: var(--wash-08);
  border: 1px solid var(--border);
  color: var(--text-muted);
  vertical-align: middle;
}

.model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.model-list li {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 7px 10px;
  border-top: 1px solid var(--border);
}

.model-list li:first-child {
  border-top: none;
}

.model-id {
  color: var(--text);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
}

.catalog-list {
  background: var(--bg-input);
}

.size {
  font-size: 11px;
}

.kind-chip,
.ok-chip,
.auto-chip {
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
  border: 1px solid var(--border);
  color: var(--text-muted);
}

.ok-chip {
  color: var(--success);
  border-color: rgba(52, 199, 123, 0.4);
}

.ok-chip.busy {
  color: var(--accent-fg, #5b8dff);
  border-color: rgba(91, 141, 255, 0.4);
}

.auto-chip {
  color: var(--accent-fg, #5b8dff);
  border-color: rgba(91, 141, 255, 0.35);
}

.download-btn {
  padding: 4px 12px;
  border-radius: 6px;
  border: 1px solid rgba(47, 107, 255, 0.45);
  background: rgba(47, 107, 255, 0.16);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}

.download-btn:hover:not(:disabled) {
  background: rgba(47, 107, 255, 0.3);
}

.download-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.danger-btn {
  margin-left: auto;
  padding: 3px 10px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  color: var(--danger-muted);
  cursor: pointer;
  font-size: 12px;
}

.danger-btn:hover:not(:disabled) {
  border-color: rgba(240, 120, 120, 0.4);
}

.danger-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cat-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel-inset);
}

.progress-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.progress-pct {
  min-width: 96px;
}

.track {
  height: 6px;
  border-radius: 999px;
  background: var(--wash-08);
  overflow: hidden;
}

.fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, #2f6bff, #5b8dff);
  transition: width 0.2s ease;
}

.msg {
  color: var(--success);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
}

.msg.error {
  color: var(--danger-muted);
}
</style>
