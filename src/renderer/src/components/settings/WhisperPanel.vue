<template>
  <div class="whisper-panel">
    <p class="hint">
      {{ t('settings.whisper.intro') }}
    </p>

    <!-- 顶部状态栏 -->
    <div class="status-line">
      <span class="pill" :class="badgeClass">{{ statusText }}</span>
      <span v-if="status?.available" class="source-tag">{{ sourceText }}</span>
      <span class="spacer" />
      <button
        type="button"
        class="ghost-btn"
        :disabled="loading || installingEngine"
        @click="refreshAll"
      >
        {{ t('settings.whisper.refresh') }}
      </button>
    </div>

    <label class="check">
      <input v-model="whisper.enabled" type="checkbox" />
      {{ t('settings.whisper.enabled') }}
    </label>

    <label class="check">
      <input v-model="whisper.preferLocal" type="checkbox" :disabled="!whisper.enabled" />
      {{ t('settings.whisper.preferLocal') }}
    </label>
    <p class="hint sub-hint">
      {{ t('settings.whisper.preferLocalHint') }}
    </p>

    <div class="row-2">
      <label>
        <span>{{ t('settings.whisper.languageLabel') }}</span>
        <select v-model="whisper.language" :disabled="!whisper.enabled">
          <option value="">{{ t('settings.whisper.langAuto') }}</option>
          <option value="zh">{{ t('settings.whisper.langZh') }}</option>
          <option value="en">{{ t('settings.whisper.langEn') }}</option>
          <option value="ja">{{ t('settings.whisper.langJa') }}</option>
          <option value="ko">{{ t('settings.whisper.langKo') }}</option>
        </select>
      </label>
    </div>

    <!-- 1. whisper.cpp 推理引擎 -->
    <h2>{{ t('settings.whisper.engineTitle') }}</h2>

    <template v-if="status?.available">
      <div class="info-row">
        <span class="row-label">{{ t('settings.whisper.binPathLabel') }}</span>
        <code class="path">{{ status.binPath }}</code>
      </div>
    </template>

    <div v-else-if="installingEngine" class="progress-card">
      <div class="progress-head">
        <span class="meta">{{ installingEngineLabel }}</span>
        <span v-if="engineBytesLabel" class="meta progress-pct">{{ engineBytesLabel }}</span>
      </div>
      <div class="track">
        <div class="fill" :style="{ width: `${engineInstallPercent}%` }" />
      </div>
    </div>

    <template v-else-if="status">
      <p class="hint">
        {{ t('settings.whisper.needEngineHint') }}
      </p>

      <template v-if="status.autoInstallSupported">
        <p class="hint">
          {{ t('settings.whisper.installEngineHint') }}
        </p>
        <div class="btn-row">
          <button
            type="button"
            class="primary-btn"
            :disabled="loading || installingEngine"
            @click="runInstallEngine"
          >
            {{ t('settings.whisper.installEngine') }}
          </button>
          <button type="button" class="ghost-btn" @click="openReleasePage">
            {{ t('settings.whisper.openDownloadPage') }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="hint">
          {{ t('settings.whisper.commandHint', { term: status.commandLabel }) }}
        </p>
        <div class="info-row cmd-row">
          <code class="path">{{ status.command }}</code>
          <button type="button" class="ghost-btn" @click="copyCommand">
            {{ t('settings.whisper.copyCommand') }}
          </button>
        </div>
        <div class="btn-row">
          <button type="button" class="ghost-btn" @click="openReleasePage">
            {{ t('settings.whisper.openDownloadPage') }}
          </button>
        </div>
      </template>

      <div class="info-row">
        <span class="row-label">{{ t('settings.whisper.installDirLabel') }}</span>
        <code class="path">{{ status.installDir }}</code>
      </div>
    </template>

    <!-- 2. 模型目录与已安装模型 -->
    <h2>{{ t('settings.whisper.installedTitle') }}</h2>
    <div v-if="status?.modelDir" class="info-row">
      <span class="row-label">{{ t('settings.whisper.modelDirLabel') }}</span>
      <code class="path">{{ status.modelDir }}</code>
      <button type="button" class="ghost-btn" @click="openModelDir">
        {{ t('settings.whisper.openModelDir') }}
      </button>
    </div>

    <p v-if="installedModels.length === 0" class="meta empty">
      {{ t('settings.whisper.installedEmpty') }}
    </p>
    <ul v-else class="model-list">
      <li v-for="m in installedModels" :key="m.id">
        <span class="model-id">{{ m.id }}</span>
        <span class="meta">{{ m.sizeMb }} MB</span>
        <span v-if="isPreferred(m.id)" class="auto-chip">{{ t('settings.whisper.autoPick') }}</span>
        <button
          v-if="whisper.defaultModelId !== m.id"
          type="button"
          class="ghost-btn"
          :disabled="loading"
          @click="setDefaultModel(m.id)"
        >
          {{ t('settings.whisper.setDefault') }}
        </button>
        <button
          v-else
          type="button"
          class="ghost-btn"
          :disabled="loading"
          @click="setDefaultModel('')"
        >
          {{ t('settings.whisper.clearDefault') }}
        </button>
        <button type="button" class="danger-btn" :disabled="loading" @click="toggleDelete(m.id)">
          {{
            confirmingDelete === m.id
              ? t('settings.whisper.deleteConfirm')
              : t('settings.whisper.delete')
          }}
        </button>
      </li>
    </ul>

    <!-- 3. 官方可下载模型目录 -->
    <h2>{{ t('settings.whisper.catalogTitle') }}</h2>
    <p class="hint">
      {{ t('settings.whisper.catalogHint') }}
    </p>

    <!-- 进行中的模型下载进度条 -->
    <div v-for="item in activeProgressList" :key="item.modelId" class="progress-card">
      <div class="progress-head">
        <code class="model-id">{{ item.modelId }}</code>
        <span class="meta">{{ progressStageLabelOf(item) }}</span>
        <span class="meta progress-pct">{{ progressPercentLabelOf(item) }}</span>
        <span class="spacer" />
        <button type="button" class="ghost-btn" @click="cancelModelDownload(item.modelId)">
          {{ t('settings.whisper.cancelDownload') }}
        </button>
      </div>
      <div v-if="item.phase === 'downloading'" class="track">
        <div class="fill" :style="{ width: `${progressPercentOf(item)}%` }" />
      </div>
    </div>

    <ul class="model-list catalog-list">
      <li v-for="model in catalog" :key="model.id">
        <span class="model-id">{{ model.id }}</span>
        <span class="meta size">≈ {{ model.sizeMb }} MB</span>
        <span class="meta desc">{{ modelDesc(model.id) }}</span>
        <template v-if="isInstalled(model.id)">
          <span class="ok-chip">{{ t('settings.whisper.installedTag') }}</span>
          <button
            type="button"
            class="danger-btn"
            :disabled="loading"
            @click="toggleDelete(model.id)"
          >
            {{
              confirmingDelete === model.id
                ? t('settings.whisper.deleteConfirm')
                : t('settings.whisper.delete')
            }}
          </button>
        </template>
        <span v-else-if="isDownloading(model.id)" class="ok-chip busy">{{
          isVerifying(model.id)
            ? t('settings.whisper.verifyingTag')
            : t('settings.whisper.downloadingTag')
        }}</span>
        <button
          v-else
          type="button"
          class="download-btn"
          :disabled="loading"
          @click="startModelDownload(model)"
        >
          {{ t('settings.whisper.download') }}
        </button>
      </li>
    </ul>

    <p v-if="feedback" class="msg" :class="{ error: feedbackError }">
      {{ feedback }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { WhisperSettings } from '@shared/domain'
import {
  pickPreferredWhisperModel,
  WHISPER_CATALOG,
  type WhisperCatalogModel,
  type WhisperInstallProgress,
  type WhisperModelDownloadProgress,
  type WhisperModelInfo,
  type WhisperRuntimeSource,
  type WhisperRuntimeStatus
} from '@shared/whisperCatalog'
import { useStudioI18n } from '../../composables/useStudioI18n'

const whisper = defineModel<WhisperSettings>('whisper', { required: true })

const { t } = useStudioI18n()

const status = ref<WhisperRuntimeStatus | null>(null)
const catalog = ref<WhisperCatalogModel[]>([...WHISPER_CATALOG])
const loading = ref(false)
const installingEngine = ref(false)
const extractingEngine = ref(false)
const engineProgress = ref(0)
const engineBytesLabel = ref('')
const progressMap = ref<Record<string, WhisperModelDownloadProgress>>({})
const confirmingDelete = ref<string | null>(null)
const feedback = ref('')
const feedbackError = ref(false)

let stopEngineListen: (() => void) | null = null
let stopModelListen: (() => void) | null = null
let confirmTimer: ReturnType<typeof setTimeout> | null = null
const progressClearTimers = new Map<string, ReturnType<typeof setTimeout>>()

const installedModels = computed<WhisperModelInfo[]>(() => status.value?.models ?? [])

const preferredModelId = computed<string | undefined>(() => {
  return pickPreferredWhisperModel(installedModels.value, whisper.value.defaultModelId)?.id
})

const statusText = computed(() => {
  if (installingEngine.value) return t('settings.whisper.installingBadge')
  if (!status.value) return t('settings.whisper.detecting')
  if (status.value.ready) return t('settings.whisper.ready')
  if (status.value.available) return t('settings.whisper.engineOnly')
  return t('settings.whisper.missingEngine')
})

const badgeClass = computed(() => {
  if (installingEngine.value) return 'busy'
  if (!status.value) return ''
  if (status.value.ready) return 'ok'
  if (status.value.available) return 'warn'
  return ''
})

const sourceText = computed(() => sourceLabelOf(status.value?.source ?? 'none'))
const installingEngineLabel = computed(() =>
  extractingEngine.value ? t('settings.whisper.extractingNow') : t('settings.whisper.installingNow')
)
const engineInstallPercent = computed(() => (extractingEngine.value ? 100 : engineProgress.value))

const activeProgressList = computed(() =>
  Object.values(progressMap.value).filter(
    (p) => p.phase === 'downloading' || p.phase === 'verifying'
  )
)

function sourceLabelOf(source: WhisperRuntimeSource): string {
  switch (source) {
    case 'env':
      return t('settings.whisper.sourceEnv')
    case 'private':
      return t('settings.whisper.sourcePrivate')
    case 'path':
      return t('settings.whisper.sourcePath')
    default:
      return t('settings.whisper.sourceNone')
  }
}

function formatMb(bytes?: number): string {
  if (!bytes || bytes <= 0) return '…'
  const mb = bytes / (1024 * 1024)
  return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`
}

function modelDesc(id: string): string {
  return t(`settings.whisper.desc.${id}`)
}

function isInstalled(id: string): boolean {
  return installedModels.value.some((m) => m.id === id)
}

function isPreferred(id: string): boolean {
  return preferredModelId.value === id
}

function isDownloading(modelId: string): boolean {
  const p = progressMap.value[modelId]
  return Boolean(p && (p.phase === 'downloading' || p.phase === 'verifying'))
}

function isVerifying(modelId: string): boolean {
  return progressMap.value[modelId]?.phase === 'verifying'
}

function progressPercentOf(p: WhisperModelDownloadProgress): number {
  if (p.phase === 'verifying') return 100
  const byBytes =
    p.totalBytes && p.totalBytes > 0 ? Math.round(((p.loadedBytes ?? 0) / p.totalBytes) * 100) : 0
  return Math.max(0, Math.min(100, byBytes || p.percent || 0))
}

function progressPercentLabelOf(p: WhisperModelDownloadProgress): string {
  return p.phase === 'verifying'
    ? t('settings.whisper.verifyingTag')
    : `${progressPercentOf(p)}% · ${formatMb(p.loadedBytes)} / ${
        p.totalBytes ? formatMb(p.totalBytes) : '…'
      }`
}

function progressStageLabelOf(p: WhisperModelDownloadProgress): string {
  return p.phase === 'verifying'
    ? t('settings.whisper.verifyingTag')
    : t('settings.whisper.downloadingTag')
}

function setFeedback(message: string, isError = false): void {
  feedback.value = message
  feedbackError.value = isError
}

function setDefaultModel(id: string): void {
  whisper.value.defaultModelId = id
}

function formatBridgeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (
    msg.includes('is not a function') ||
    msg.includes('No handler registered for') ||
    msg.includes('whisper:')
  ) {
    return t('settings.whisper.needRestartHint')
  }
  return msg
}

async function refreshStatus(): Promise<void> {
  if (typeof window.studio.getWhisperStatus !== 'function') {
    setFeedback(t('settings.whisper.needRestartHint'), true)
    return
  }
  try {
    const res = await window.studio.getWhisperStatus()
    status.value = res
    installingEngine.value = res.installing
  } catch (err) {
    setFeedback(formatBridgeError(err), true)
  }
}

async function refreshCatalog(): Promise<void> {
  if (typeof window.studio.getWhisperModelCatalog !== 'function') {
    return
  }
  try {
    const list = await window.studio.getWhisperModelCatalog()
    if (Array.isArray(list) && list.length > 0) {
      catalog.value = list
    }
  } catch {
    /* keep default WHISPER_CATALOG */
  }
}

async function refreshAll(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([refreshStatus(), refreshCatalog()])
  } finally {
    loading.value = false
  }
}

async function runInstallEngine(): Promise<void> {
  if (installingEngine.value) return
  if (typeof window.studio.installWhisper !== 'function') {
    setFeedback(t('settings.whisper.needRestartHint'), true)
    return
  }
  installingEngine.value = true
  extractingEngine.value = false
  engineProgress.value = 0
  engineBytesLabel.value = ''
  setFeedback('')
  try {
    const result = await window.studio.installWhisper()
    await refreshStatus()
    setFeedback(result.message, !result.ok)
  } catch (err) {
    setFeedback(formatBridgeError(err), true)
  } finally {
    installingEngine.value = false
    extractingEngine.value = false
  }
}

function openReleasePage(): void {
  const url = status.value?.downloadUrl || 'https://github.com/ggml-org/whisper.cpp/releases'
  window.open(url, '_blank', 'noopener,noreferrer')
}

async function copyCommand(): Promise<void> {
  const cmd = status.value?.command?.trim()
  if (!cmd) return
  try {
    await window.studio.writeClipboardText(cmd)
    setFeedback(t('settings.whisper.copied'), false)
  } catch {
    /* ignore */
  }
}

async function openModelDir(): Promise<void> {
  try {
    await window.studio.openWhisperModelDir()
  } catch (err) {
    setFeedback(err instanceof Error ? err.message : String(err), true)
  }
}

async function startModelDownload(model: WhisperCatalogModel): Promise<void> {
  if (isDownloading(model.id)) return
  if (typeof window.studio.downloadWhisperModel !== 'function') {
    setFeedback(t('settings.whisper.needRestartHint'), true)
    return
  }
  setFeedback('')
  progressMap.value = {
    ...progressMap.value,
    [model.id]: { modelId: model.id, phase: 'downloading', percent: 0, loadedBytes: 0 }
  }
  try {
    const res = await window.studio.downloadWhisperModel(model.id)
    await refreshStatus()
    if (res.cancelled) {
      setFeedback(res.message || '', false)
    } else {
      setFeedback(res.message || '', !res.ok)
    }
  } catch (err) {
    const next = { ...progressMap.value }
    delete next[model.id]
    progressMap.value = next
    setFeedback(formatBridgeError(err), true)
  }
}

async function cancelModelDownload(modelId: string): Promise<void> {
  try {
    await window.studio.cancelWhisperModelDownload(modelId)
  } catch {
    /* ignore */
  }
}

function clearConfirmDelete(): void {
  confirmingDelete.value = null
  if (confirmTimer) {
    clearTimeout(confirmTimer)
    confirmTimer = null
  }
}

async function toggleDelete(modelId: string): Promise<void> {
  if (confirmingDelete.value !== modelId) {
    clearConfirmDelete()
    confirmingDelete.value = modelId
    confirmTimer = setTimeout(() => {
      if (confirmingDelete.value === modelId) confirmingDelete.value = null
    }, 3500)
    return
  }
  clearConfirmDelete()
  loading.value = true
  try {
    const res = await window.studio.deleteWhisperModel(modelId)
    if (whisper.value.defaultModelId === modelId) {
      whisper.value.defaultModelId = ''
    }
    await refreshStatus()
    setFeedback(res.message || '', !res.ok)
  } catch (err) {
    setFeedback(err instanceof Error ? err.message : String(err), true)
  } finally {
    loading.value = false
  }
}

function handleEngineProgress(payload: WhisperInstallProgress): void {
  if (payload.phase === 'downloading') {
    installingEngine.value = true
    extractingEngine.value = false
    engineProgress.value = Math.max(engineProgress.value, payload.percent ?? 0)
    if (payload.loadedBytes) {
      engineBytesLabel.value = payload.totalBytes
        ? `${formatMb(payload.loadedBytes)} / ${formatMb(payload.totalBytes)}`
        : formatMb(payload.loadedBytes)
    }
  } else if (payload.phase === 'extracting') {
    installingEngine.value = true
    extractingEngine.value = true
  }
}

function handleModelProgress(payload: WhisperModelDownloadProgress): void {
  const prevTimer = progressClearTimers.get(payload.modelId)
  if (prevTimer) {
    clearTimeout(prevTimer)
    progressClearTimers.delete(payload.modelId)
  }
  progressMap.value = {
    ...progressMap.value,
    [payload.modelId]: payload
  }
  if (payload.phase === 'done' || payload.phase === 'cancelled' || payload.phase === 'error') {
    const timer = setTimeout(() => {
      const next = { ...progressMap.value }
      delete next[payload.modelId]
      progressMap.value = next
      progressClearTimers.delete(payload.modelId)
    }, 1200)
    progressClearTimers.set(payload.modelId, timer)
  }
}

onMounted(() => {
  stopEngineListen =
    typeof window.studio.onWhisperInstallProgress === 'function'
      ? window.studio.onWhisperInstallProgress(handleEngineProgress)
      : null
  stopModelListen =
    typeof window.studio.onWhisperModelDownloadProgress === 'function'
      ? window.studio.onWhisperModelDownloadProgress(handleModelProgress)
      : null
  void refreshAll()
})

onBeforeUnmount(() => {
  stopEngineListen?.()
  stopModelListen?.()
  clearConfirmDelete()
  for (const timer of progressClearTimers.values()) clearTimeout(timer)
  progressClearTimers.clear()
})
</script>

<style scoped>
.whisper-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.hint {
  margin: 0;
  color: var(--text-muted, #8a93a6);
  font-size: 12px;
  line-height: 1.5;
}

.sub-hint {
  margin-top: -4px;
}

.status-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.spacer {
  flex: 1;
}

.pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  background: rgba(239, 68, 68, 0.14);
  color: #f87171;
}

.pill.ok {
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.pill.warn {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}

.pill.busy {
  background: rgba(59, 130, 246, 0.16);
  color: #60a5fa;
}

.source-tag {
  font-size: 12px;
  color: var(--text-muted, #8a93a6);
}

.check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
}

.row-2 {
  display: grid;
  grid-template-columns: minmax(180px, 280px);
  gap: 12px;
}

.row-2 label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.row-label {
  font-size: 12px;
  color: var(--text-muted, #8a93a6);
  min-width: 72px;
}

.path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  padding: 3px 8px;
  border-radius: 4px;
  background: var(--bg-elevated);
  word-break: break-all;
}

.btn-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.primary-btn,
.download-btn {
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(59, 130, 246, 0.45);
  background: rgba(59, 130, 246, 0.2);
  color: #93c5fd;
  font-size: 12px;
  cursor: pointer;
}

.primary-btn:hover:not(:disabled),
.download-btn:hover:not(:disabled) {
  background: rgba(59, 130, 246, 0.32);
}

.ghost-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: inherit;
  font-size: 12px;
  cursor: pointer;
}

.danger-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(239, 68, 68, 0.4);
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
  font-size: 12px;
  cursor: pointer;
}

.progress-card {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.progress-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.track {
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text) 10%, transparent);
  overflow: hidden;
}

.fill {
  height: 100%;
  background: linear-gradient(90deg, #3b82f6, #38bdf8);
  transition: width 0.2s ease;
}

.model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-list li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  flex-wrap: wrap;
}

.model-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  font-weight: 600;
}

.meta {
  font-size: 12px;
  color: var(--text-muted, #8a93a6);
}

.meta.desc {
  flex: 1;
  min-width: 180px;
}

.auto-chip,
.ok-chip {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.15);
  color: #4ade80;
}

.ok-chip.busy {
  background: rgba(59, 130, 246, 0.16);
  color: #60a5fa;
}

.msg {
  margin: 4px 0 0;
  font-size: 12px;
  color: #4ade80;
}

.msg.error {
  color: #f87171;
}
</style>
