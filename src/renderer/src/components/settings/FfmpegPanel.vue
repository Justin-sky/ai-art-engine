<template>
  <div class="ffmpeg-panel">
    <p class="hint">
      {{ t('settings.ffmpeg.notBundledHint') }}
    </p>

    <div class="toolbar">
      <span
        class="badge"
        :class="badgeClass"
      >{{ statusText }}</span>
      <span
        v-if="status?.available"
        class="source-tag"
      >{{ sourceText }}</span>
      <button
        v-if="status && !installing"
        type="button"
        class="btn"
        :disabled="busy"
        @click="() => refresh()"
      >
        {{ t('settings.ffmpeg.refresh') }}
      </button>
    </div>

    <template v-if="status?.available">
      <div class="row">
        <span class="row-label">ffmpeg</span>
        <code class="path">{{ status.ffmpegPath }}</code>
      </div>
      <div class="row">
        <span class="row-label">ffprobe</span>
        <code class="path">{{ status.ffprobePath }}</code>
      </div>
      <div
        v-if="status.ffmpegVersion || status.ffprobeVersion"
        class="row"
      >
        <span class="row-label">version</span>
        <code class="versions">{{ versionText }}</code>
      </div>
    </template>

    <div
      v-else-if="installing"
      class="install-progress"
    >
      <div class="progress-track">
        <div
          class="progress-fill"
          :style="{ width: `${installPercent}%` }"
        />
      </div>
      <p class="hint">
        {{ installingLabel
        }}<span
          v-if="progressBytesLabel"
          class="muted"
        > · {{ progressBytesLabel }}</span>
      </p>
    </div>

    <template v-else-if="status">
      <p class="hint">
        {{ t('settings.ffmpeg.needInstallHint') }}
      </p>

      <template v-if="status.autoInstallSupported">
        <p class="hint">
          {{ t('settings.ffmpeg.installHint') }}
        </p>
        <div class="toolbar">
          <button
            type="button"
            class="btn primary"
            :disabled="busy || installing"
            @click="runInstall"
          >
            {{ t('settings.ffmpeg.install') }}
          </button>
        </div>
      </template>

      <template v-else>
        <p class="hint">
          {{ t('settings.ffmpeg.commandHint', { term: status.commandLabel }) }}
        </p>
        <div class="row cmd-row">
          <code class="cmd">{{ status.command }}</code>
          <button
            type="button"
            class="btn"
            :disabled="busy"
            @click="copyCommand"
          >
            {{ t('settings.ffmpeg.copyCommand') }}
          </button>
        </div>
        <div class="toolbar">
          <button
            type="button"
            class="btn"
            @click="openDownloadPage"
          >
            {{ t('settings.ffmpeg.openDownloadPage') }}
          </button>
        </div>
      </template>

      <div class="row">
        <span class="row-label">{{ t('settings.ffmpeg.installDir') }}</span>
        <code class="path">{{ status.installDir }}</code>
      </div>
    </template>

    <p
      v-if="noticeMessage"
      class="notice"
      :class="{ error: noticeError }"
    >
      {{ noticeMessage }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  FfmpegInstallProgress,
  FfmpegRuntimeSource,
  FfmpegRuntimeStatus
} from '@shared/videoBeats'
import { useStudioI18n } from '../../composables/useStudioI18n'

const { t } = useStudioI18n()

const status = ref<FfmpegRuntimeStatus | null>(null)
const installing = ref(false)
const extracting = ref(false)
const progress = ref(0)
const progressBytesLabel = ref('')
const noticeMessage = ref('')
const noticeError = ref(false)
const busy = ref(false)

const statusText = computed(() => {
  if (installing.value) return t('settings.ffmpeg.installingBadge')
  if (!status.value) return t('settings.ffmpeg.detecting')
  return status.value.available ? t('settings.ffmpeg.ready') : t('settings.ffmpeg.missing')
})

const badgeClass = computed(() => {
  if (installing.value) return 'busy'
  if (!status.value) return ''
  return status.value.available ? 'ok' : 'missing'
})

const sourceText = computed(() => sourceLabelOf(status.value?.source ?? 'none'))
const versionText = computed(() => {
  const parts = [status.value?.ffmpegVersion, status.value?.ffprobeVersion].filter(Boolean)
  return parts.join('  /  ') || ''
})
const installingLabel = computed(() =>
  extracting.value ? t('settings.ffmpeg.extractingNow') : t('settings.ffmpeg.installingNow')
)
const installPercent = computed(() => (extracting.value ? 100 : progress.value))

function sourceLabelOf(source: FfmpegRuntimeSource): string {
  switch (source) {
    case 'env':
      return t('settings.ffmpeg.sourceEnv')
    case 'bundled':
      return t('settings.ffmpeg.sourceBundled')
    case 'private':
      return t('settings.ffmpeg.sourcePrivate')
    case 'path':
      return t('settings.ffmpeg.sourcePath')
    default:
      return t('settings.ffmpeg.sourceNone')
  }
}

function formatBytes(value?: number): string {
  if (value === undefined || value < 0) return ''
  if (value >= 1048576) return `${(value / 1048576).toFixed(1)} MB`
  return `${Math.max(1, Math.round(value / 1024))} KB`
}

function progressByteLabel(loaded?: number, total?: number): string {
  const loadedLabel = formatBytes(loaded)
  if (!loadedLabel) return ''
  return total ? `${loadedLabel} / ${formatBytes(total)}` : loadedLabel
}

async function refresh(showFailureMessage = true): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    const next = await window.studio.getFfmpegStatus()
    status.value = next
    installing.value = next.installing
  } catch {
    if (showFailureMessage) {
      noticeError.value = true
      noticeMessage.value = t('settings.ffmpeg.refreshFailed')
    }
  } finally {
    busy.value = false
  }
}

async function runInstall(): Promise<void> {
  if (busy.value || installing.value) return
  noticeMessage.value = ''
  noticeError.value = false
  progress.value = 0
  extracting.value = false
  installing.value = true
  try {
    const result = await window.studio.installFfmpeg()
    if (result.ok) {
      noticeMessage.value = t('settings.ffmpeg.installDone')
      noticeError.value = false
    } else {
      noticeMessage.value = result.message || t('settings.ffmpeg.installFailed')
      noticeError.value = true
    }
  } catch {
    noticeError.value = true
    noticeMessage.value = t('settings.ffmpeg.installFailed')
  } finally {
    installing.value = false
    extracting.value = false
    // 静默刷新：刷新失败也不覆盖上面的安装结果提示
    void refresh(false)
  }
}

function onInstallProgress(p: FfmpegInstallProgress): void {
  installing.value = true
  if (p.phase === 'downloading') {
    extracting.value = false
    progress.value = p.percent ?? 0
    progressBytesLabel.value = progressByteLabel(p.loadedBytes, p.totalBytes)
  } else if (p.phase === 'extracting') {
    extracting.value = true
    progress.value = 100
  }
  // phase === 'done' 由 installFfmpeg 的返回值收尾
}

function openDownloadPage(): void {
  const url = status.value?.downloadUrl
  if (url) window.open(url, '_blank')
}

async function copyCommand(): Promise<void> {
  const command = status.value?.command
  if (!command) return
  await window.studio.writeClipboardText(command)
  noticeError.value = false
  noticeMessage.value = t('settings.ffmpeg.copied')
}

const stopProgress = window.studio.onFfmpegInstallProgress(onInstallProgress)

onMounted(() => void refresh())
onBeforeUnmount(() => {
  stopProgress()
})
</script>

<style scoped>
.ffmpeg-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 12px;
  color: var(--muted);
}

.badge.ok {
  color: var(--success);
  border-color: color-mix(in srgb, var(--success) 45%, transparent);
}

.badge.missing {
  color: var(--danger-muted);
  border-color: color-mix(in srgb, var(--danger-muted) 45%, transparent);
}

.badge.busy {
  color: var(--muted);
}

.source-tag {
  font-size: 12px;
  color: var(--muted);
}

.btn {
  padding: 5px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  cursor: pointer;
  font-size: 12px;
}

.btn:hover:not(:disabled) {
  border-color: var(--focus-border);
  background: color-mix(in srgb, var(--focus) 8%, transparent);
}

.btn.primary {
  background: var(--focus);
  border-color: var(--focus);
  color: #fff;
}

.btn.primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 12px;
}

.row-label {
  flex: 0 0 auto;
  min-width: 62px;
  color: var(--muted);
}

.path,
.versions,
.cmd {
  font-family: var(--font-mono);
  font-size: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 8px;
  word-break: break-all;
}

.cmd-row {
  gap: 8px;
}

.cmd {
  flex: 1 1 auto;
}

.hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--muted);
}

.muted {
  color: var(--muted);
}

.install-progress {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.progress-track {
  height: 8px;
  border-radius: 999px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--focus);
  transition: width 0.2s ease;
}

.notice {
  margin: 0;
  font-size: 12px;
  color: var(--success);
}

.notice.error {
  color: var(--danger-muted);
}
</style>
