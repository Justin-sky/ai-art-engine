<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import {
  ASSET_TYPE_ICONS,
  isAnimationModelAsset,
  isDirectorDeck,
  isDraftAssetId,
  isPoseModelAsset,
  isStoryboardScript,
  type AssetInfo
} from '@shared/domain'
import { isAudioFilePath, isImageFilePath, isVideoFilePath } from '@shared/import'
import { resolveAssetPreviewMediaPath } from '@shared/graph'
import { useProjectStore } from '../stores/project'
import { useWorkspaceStore } from '../stores/workspace'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  resolveAssetFileUrl,
  resolveAssetPreviewUrl
} from '../features/media/assetUrlCache'
import { resolveAssetText } from '../features/media/resolveAssetText'
import { openFullImagePreview } from '../features/media/openFullImagePreview'

const props = defineProps<{
  asset: AssetInfo
}>()

const project = useProjectStore()
const workspace = useWorkspaceStore()
const { t, assetTypeLabel } = useStudioI18n()

const canRevealAsset = computed(() => {
  const id = props.asset.id?.trim()
  if (!id || isDraftAssetId(id)) return false
  return project.assets.some((item) => item.id === id)
})

function revealInAssets(): void {
  const id = props.asset.id?.trim()
  if (!id || !canRevealAsset.value) return
  workspace.selectAsset(id)
  workspace.revealAssetInBrowser(id)
}

const previewUrl = ref('')
/** 视频解码失败或无可播放文件时的静态海报（首帧 / 缩略图） */
const posterUrl = ref('')
const loading = ref(false)
const mediaError = ref(false)
const mediaPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const seeking = ref(false)
const audioEl = ref<HTMLAudioElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const progressInput = ref<HTMLInputElement | null>(null)
let loadToken = 0
let playRequestId = 0
let progressRaf = 0

const kind = computed((): 'image' | 'video' | 'voice' | 'text' | 'none' => {
  const a = props.asset
  if (!a) return 'none'
  if (a.type === 'model' || isPoseModelAsset(a) || isAnimationModelAsset(a)) return 'none'
  if (isDirectorDeck(a.type)) return 'none'
  if (isStoryboardScript(a.type)) return 'text'
  if (a.type === 'screenplay') return 'text'
  if (a.type === 'video') return 'video'
  if (a.type === 'voice') return 'voice'
  if (a.type === 'image' || a.type === 'canvas') return 'image'
  return 'none'
})

const textPreview = ref('')

const resolvedMediaPath = computed(() =>
  resolveAssetPreviewMediaPath(props.asset, project.assets)
)

const show = computed(() => {
  if (kind.value === 'none') return false
  if (kind.value === 'text') {
    // 导入 txt 或新建剧本（graphJson）都应显示预览区
    return (
      !!textPreview.value ||
      loading.value ||
      props.asset.type === 'screenplay' ||
      props.asset.type === 'script'
    )
  }
  return true
})

async function resolveTextPreviewBody(a: AssetInfo): Promise<string> {
  // 导入引用：旁挂 txt/md；新建剧本：graphJson 正文（勿读 .asset.json）
  return (await resolveAssetText(a.id))?.trim() ?? ''
}

const progressValue = computed(() => {
  if (!duration.value) return 0
  return Math.round((currentTime.value / duration.value) * 1000)
})

const typeIcon = computed(() => ASSET_TYPE_ICONS[props.asset.type] ?? '📄')

const activeMediaEl = computed((): HTMLMediaElement | null => {
  if (kind.value === 'video') return videoEl.value
  if (kind.value === 'voice') return audioEl.value
  return null
})

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function stopProgressTicker(): void {
  if (progressRaf) {
    cancelAnimationFrame(progressRaf)
    progressRaf = 0
  }
}

function syncMediaClock(el?: HTMLMediaElement | null): void {
  const media = el ?? activeMediaEl.value
  if (!media) return
  if (!seeking.value) currentTime.value = media.currentTime || 0
  if (Number.isFinite(media.duration) && media.duration > 0) {
    duration.value = media.duration
  }
  if (progressInput.value && duration.value > 0 && !seeking.value) {
    progressInput.value.value = String(
      Math.round((currentTime.value / duration.value) * 1000)
    )
  }
}

function startProgressTicker(): void {
  stopProgressTicker()
  const tick = (): void => {
    syncMediaClock()
    if (mediaPlaying.value) progressRaf = requestAnimationFrame(tick)
    else progressRaf = 0
  }
  progressRaf = requestAnimationFrame(tick)
}

function resetPlaybackState(): void {
  stopProgressTicker()
  mediaError.value = false
  mediaPlaying.value = false
  currentTime.value = 0
  duration.value = 0
  seeking.value = false
}

function pickPlayableMediaPath(
  mediaKind: 'video' | 'voice',
  ownRelative: string,
  resolved: string
): string {
  const candidates = [ownRelative, resolved].map((p) => p.trim()).filter(Boolean)
  const ok = mediaKind === 'video' ? isVideoFilePath : isAudioFilePath
  return candidates.find((p) => ok(p)) || ''
}

async function loadPreview(): Promise<void> {
  const token = ++loadToken
  const a = props.asset
  previewUrl.value = ''
  posterUrl.value = ''
  resetPlaybackState()
  textPreview.value = ''
  if (!a || kind.value === 'none') {
    loading.value = false
    return
  }
  if (kind.value === 'text') {
    loading.value = true
    try {
      const text = await resolveTextPreviewBody(a)
      if (token !== loadToken) return
      textPreview.value = text
    } catch {
      if (token !== loadToken) return
      textPreview.value = ''
    } finally {
      if (token === loadToken) loading.value = false
    }
    return
  }
  const path = resolvedMediaPath.value
  if (!path && !a.relativePath?.trim()) {
    loading.value = false
    return
  }
  loading.value = true
  try {
    if (kind.value === 'image') {
      const imagePath = a.relativePath?.trim() || path || ''
      if (!imagePath) return
      const url = await resolveAssetPreviewUrl(imagePath)
      if (token !== loadToken) return
      previewUrl.value = url
      return
    }

    if (kind.value === 'video' || kind.value === 'voice') {
      const playPath = pickPlayableMediaPath(
        kind.value,
        a.relativePath?.trim() || '',
        path || ''
      )
      // 海报：优先可播放媒体的预览图；否则若解析结果是图片则直接作海报
      const posterPath =
        playPath ||
        (path && isImageFilePath(path) ? path : '') ||
        (a.thumbnailPath?.trim() && isImageFilePath(a.thumbnailPath) ? a.thumbnailPath : '')
      if (posterPath) {
        try {
          const poster = await resolveAssetPreviewUrl(posterPath)
          if (token !== loadToken) return
          posterUrl.value = poster
        } catch {
          /* 无海报也可 */
        }
      }
      if (!playPath) {
        if (token !== loadToken) return
        previewUrl.value = ''
        return
      }
      const url = await resolveAssetFileUrl(playPath)
      if (token !== loadToken) return
      previewUrl.value = url
      await nextTick()
      if (token !== loadToken) return
      activeMediaEl.value?.load()
      syncMediaClock(activeMediaEl.value)
      return
    }
  } catch {
    if (token !== loadToken) return
    previewUrl.value = ''
  } finally {
    if (token === loadToken) loading.value = false
  }
}

async function togglePlayback(): Promise<void> {
  const el = activeMediaEl.value
  if (!el || !previewUrl.value) return
  const requestId = ++playRequestId
  if (!el.paused) {
    el.pause()
    mediaPlaying.value = false
    stopProgressTicker()
    syncMediaClock(el)
    return
  }
  mediaPlaying.value = true
  startProgressTicker()
  try {
    await el.play()
    if (requestId !== playRequestId) return
    mediaPlaying.value = !el.paused
    if (mediaPlaying.value) startProgressTicker()
    else stopProgressTicker()
    syncMediaClock(el)
  } catch (error) {
    if (requestId !== playRequestId) return
    if (error instanceof DOMException && error.name === 'AbortError') {
      mediaPlaying.value = !el.paused
      if (mediaPlaying.value) startProgressTicker()
      else stopProgressTicker()
      return
    }
    if (!previewUrl.value) return
    mediaError.value = true
    mediaPlaying.value = false
    stopProgressTicker()
  }
}

function seekToStart(): void {
  const el = activeMediaEl.value
  if (!el) return
  el.currentTime = 0
  currentTime.value = 0
}

function onSeekInput(e: Event): void {
  seeking.value = true
  const el = activeMediaEl.value
  if (!el || !duration.value) return
  const value = Number((e.target as HTMLInputElement).value)
  currentTime.value = (value / 1000) * duration.value
}

function onSeekChange(e: Event): void {
  const el = activeMediaEl.value
  if (!el || !duration.value) {
    seeking.value = false
    return
  }
  const value = Number((e.target as HTMLInputElement).value)
  el.currentTime = (value / 1000) * duration.value
  currentTime.value = el.currentTime
  seeking.value = false
  syncMediaClock(el)
}

function onMediaPlay(): void {
  mediaPlaying.value = true
  startProgressTicker()
}

function onMediaPause(): void {
  mediaPlaying.value = false
  stopProgressTicker()
  syncMediaClock()
}

function onMediaEnded(): void {
  mediaPlaying.value = false
  stopProgressTicker()
  syncMediaClock()
}

function onMediaLoaded(): void {
  syncMediaClock()
}

function onMediaError(): void {
  // 切换资产清空 src / 卸载时也可能触发 error，勿把空态误标成「编码不受支持」
  if (!previewUrl.value || loading.value) return
  mediaError.value = true
  mediaPlaying.value = false
  stopProgressTicker()
}

async function openFullPreview(): Promise<void> {
  if (kind.value !== 'image') return
  await openFullImagePreview({
    relativePath: props.asset.relativePath || resolvedMediaPath.value
  })
}

const imagePreviewHint = computed(() => t('graph.selectImage.previewHint'))


const emptyHint = computed(() => {
  if (kind.value === 'video' || kind.value === 'voice') {
    const playPath = pickPlayableMediaPath(
      kind.value,
      props.asset.relativePath?.trim() || '',
      resolvedMediaPath.value || ''
    )
    if (!playPath) return t('asset.editor.noMedia')
  }
  return resolvedMediaPath.value || props.asset.relativePath
    ? t('graph.inspector.outputPreviewMissing')
    : t('asset.editor.noMedia')
})

const videoPlaceholderText = computed(() =>
  mediaError.value ? t('graph.preview.videoError') : emptyHint.value
)

watch(
  () =>
    [
      props.asset.id,
      props.asset.relativePath,
      props.asset.thumbnailPath,
      props.asset.type,
      props.asset.updatedAt,
      resolvedMediaPath.value,
      // 剧本 graphJson / 执行结果更新后重载正文
      JSON.stringify(props.asset.genParams?.graphJson ?? null)
    ] as const,
  () => {
    void loadPreview()
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  loadToken += 1
  playRequestId += 1
  stopProgressTicker()
})
</script>

<template>
  <section v-if="show" class="asset-media-preview" :aria-label="t('graph.inspector.outputPreview')">
    <div class="section-head">
      <span class="section-title">{{ t('graph.inspector.outputPreview') }}</span>
      <button
        v-if="canRevealAsset"
        type="button"
        class="reveal-btn"
        :title="t('graph.inspector.revealInAssets')"
        :aria-label="t('graph.inspector.revealInAssets')"
        @click="revealInAssets"
      >
        <span class="icon-reveal" aria-hidden="true" />
      </button>
    </div>

    <p v-if="loading" class="hint">{{ t('graph.inspector.outputPreviewLoading') }}</p>

    <div v-else-if="kind === 'text'" class="text-wrap">
      <pre class="text-body">{{ textPreview }}</pre>
    </div>

    <div v-else-if="kind === 'voice'" class="av-wrap audio">
      <div class="audio-stage">
        <span class="audio-icon" aria-hidden="true">{{ typeIcon }}</span>
        <audio
          v-if="previewUrl"
          ref="audioEl"
          :src="previewUrl"
          preload="metadata"
          @play="onMediaPlay"
          @pause="onMediaPause"
          @ended="onMediaEnded"
          @timeupdate="onMediaLoaded"
          @loadedmetadata="onMediaLoaded"
          @durationchange="onMediaLoaded"
          @error="onMediaError"
        />
      </div>

      <div v-if="previewUrl && !mediaError" class="transport">
        <div class="transport-actions">
          <button type="button" class="ctrl-btn" :title="t('graph.media.restart')" @click="seekToStart">
            <span class="icon-restart" />
          </button>
          <button
            type="button"
            class="ctrl-btn primary"
            :title="mediaPlaying ? t('graph.media.pause') : t('graph.media.play')"
            @click="togglePlayback"
          >
            <span :class="{ pause: mediaPlaying, triangle: !mediaPlaying }" />
          </button>
          <div class="time-row inline">
            <span>{{ formatTime(currentTime) }}</span>
            <span>/</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>
        <div class="progress-wrap">
          <input
            ref="progressInput"
            class="progress"
            type="range"
            min="0"
            max="1000"
            step="1"
            :value="progressValue"
            @input="onSeekInput"
            @change="onSeekChange"
          />
        </div>
      </div>

      <p v-else-if="mediaError" class="media-error">{{ t('graph.preview.audioError') }}</p>
      <div v-else class="placeholder">
        <span>{{ assetTypeLabel(asset.type) }}</span>
        <p>{{ emptyHint }}</p>
      </div>
    </div>

    <div v-else-if="kind === 'video'" class="av-wrap video">
      <div class="video-stage">
        <video
          v-if="previewUrl && !mediaError"
          ref="videoEl"
          :src="previewUrl"
          :poster="posterUrl || undefined"
          playsinline
          preload="metadata"
          @play="onMediaPlay"
          @pause="onMediaPause"
          @ended="onMediaEnded"
          @timeupdate="onMediaLoaded"
          @loadedmetadata="onMediaLoaded"
          @durationchange="onMediaLoaded"
          @error="onMediaError"
        />
        <img
          v-else-if="posterUrl"
          :src="posterUrl"
          alt=""
          class="video-poster"
          loading="lazy"
          decoding="async"
        />
        <div v-else class="placeholder">
          <span>{{ assetTypeLabel(asset.type) }}</span>
          <p>{{ videoPlaceholderText }}</p>
        </div>
      </div>

      <p v-if="mediaError && posterUrl" class="media-error soft">{{ t('graph.preview.videoError') }}</p>

      <div v-if="previewUrl && !mediaError" class="transport">
        <div class="transport-actions">
          <button type="button" class="ctrl-btn" :title="t('graph.media.restart')" @click="seekToStart">
            <span class="icon-restart" />
          </button>
          <button
            type="button"
            class="ctrl-btn primary"
            :title="mediaPlaying ? t('graph.media.pause') : t('graph.media.play')"
            @click="togglePlayback"
          >
            <span :class="{ pause: mediaPlaying, triangle: !mediaPlaying }" />
          </button>
          <div class="time-row inline">
            <span>{{ formatTime(currentTime) }}</span>
            <span>/</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>
        <div class="progress-wrap">
          <input
            ref="progressInput"
            class="progress"
            type="range"
            min="0"
            max="1000"
            step="1"
            :value="progressValue"
            @input="onSeekInput"
            @change="onSeekChange"
          />
        </div>
      </div>
    </div>

    <div v-else class="media-wrap">
      <img
        v-if="kind === 'image' && previewUrl"
        :src="previewUrl"
        alt=""
        loading="lazy"
        decoding="async"
        class="preview-image"
        :title="imagePreviewHint"
        @dblclick="openFullPreview"
      />
      <div v-else class="placeholder">
        <span>{{ assetTypeLabel(asset.type) }}</span>
        <p>{{ emptyHint }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.asset-media-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-title {
  font-size: 11px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.reveal-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-elevated);
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
}

.reveal-btn:hover {
  color: var(--text);
  border-color: var(--accent);
  background: var(--bg-hover);
}

.icon-reveal {
  position: relative;
  width: 11px;
  height: 9px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 1px 1px 2px 2px;
}

.icon-reveal::before {
  content: '';
  position: absolute;
  left: -1.5px;
  top: -3px;
  width: 5px;
  height: 2.5px;
  border: 1.5px solid currentColor;
  border-bottom: none;
  border-radius: 1px 1px 0 0;
  background: transparent;
}

.icon-reveal::after {
  content: '';
  position: absolute;
  right: -1px;
  bottom: -1px;
  width: 5px;
  height: 5px;
  border-right: 1.5px solid currentColor;
  border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg);
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.media-wrap,
.av-wrap {
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--graph-preview-bg);
}

.media-wrap img {
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  background: var(--graph-preview-bg);
  cursor: zoom-in;
}

.av-wrap {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-width: 0;
  box-sizing: border-box;
}

.av-wrap.audio {
  padding: 8px 6px 6px;
  gap: 6px;
  background: transparent;
}

.av-wrap.video {
  padding: 0;
  /* 仅画面区用深色底；工具条区域透出 Inspector 背景，避免一整条黑底 */
  background: transparent;
}

.audio-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 72px;
  color: var(--text-muted);
}

.audio-icon {
  font-size: 28px;
  line-height: 1;
}

.av-wrap audio {
  display: none;
}

.video-stage {
  background: var(--graph-preview-bg);
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-stage video,
.video-stage .video-poster {
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  background: var(--graph-preview-bg);
}

.media-error.soft {
  padding: 0 8px 6px;
  text-align: center;
}

.av-wrap.audio .transport,
.av-wrap.video .transport {
  margin: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  backdrop-filter: none;
  box-shadow: none;
}

.transport {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 7px 7px;
  border-radius: 8px;
  background: var(--panel-glass);
  border: 1px solid var(--border);
  backdrop-filter: blur(4px);
}

.transport-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ctrl-btn {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.ctrl-btn.primary {
  width: 28px;
  height: 28px;
  color: #fff;
  background: var(--accent);
  border-color: transparent;
}

.ctrl-btn .triangle {
  width: 0;
  height: 0;
  border-style: solid;
  border-width: 5px 0 5px 8px;
  border-color: transparent transparent transparent currentColor;
  margin-left: 2px;
}

.ctrl-btn .pause {
  width: 8px;
  height: 10px;
  box-sizing: border-box;
  border-left: 2.5px solid currentColor;
  border-right: 2.5px solid currentColor;
}

.ctrl-btn .icon-restart {
  width: 10px;
  height: 10px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  border-top-color: transparent;
  position: relative;
  transform: rotate(-45deg);
}

.ctrl-btn .icon-restart::after {
  content: '';
  position: absolute;
  top: -3px;
  right: -1px;
  border-style: solid;
  border-width: 0 4px 4px 0;
  border-color: transparent currentColor transparent transparent;
}

.time-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
  min-width: 0;
}

.time-row.inline {
  margin-left: auto;
  padding-right: 2px;
}

.progress-wrap {
  display: flex;
  align-items: center;
  min-width: 0;
}

.progress {
  width: 100%;
  height: 4px;
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 24px 12px;
  color: var(--text-muted);
  font-size: 12px;
  text-align: center;
}

.placeholder p {
  margin: 0;
  opacity: 0.85;
}

.media-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.text-wrap {
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 8px;
  background: var(--graph-text-preview-bg);
  padding: 10px;
  max-height: 240px;
  overflow: auto;
}

.text-body {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  line-height: 1.45;
  color: var(--graph-text-preview);
  font-family: inherit;
}
</style>
