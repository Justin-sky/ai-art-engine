<template>
  <div
    class="media-preview-player"
    :class="kind"
  >
    <video
      v-if="kind === 'video'"
      ref="mediaEl"
      class="media-el"
      :src="src"
      playsinline
      preload="metadata"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoaded"
      @durationchange="onLoaded"
      @error="onError"
    />
    <div
      v-else
      class="audio-stage"
    >
      <span
        class="audio-glyph"
        aria-hidden="true"
      >♪</span>
      <audio
        ref="mediaEl"
        class="media-el"
        :src="src"
        preload="metadata"
        @play="onPlay"
        @pause="onPause"
        @ended="onEnded"
        @timeupdate="onTimeUpdate"
        @loadedmetadata="onLoaded"
        @durationchange="onLoaded"
        @error="onError"
      />
    </div>

    <div
      v-if="!mediaError"
      class="transport"
      @pointerdown.stop
      @wheel.stop
    >
      <div class="transport-actions">
        <button
          type="button"
          class="ctrl-btn"
          :title="t('graph.media.restart')"
          @click="seekToStart"
        >
          <span class="icon-restart" />
        </button>
        <button
          type="button"
          class="ctrl-btn primary"
          :title="playing ? t('graph.media.pause') : t('graph.media.play')"
          @click="togglePlayback"
        >
          <span :class="{ pause: playing, triangle: !playing }" />
        </button>
        <div class="time-row inline">
          <span>{{ formatTime(currentTime) }}</span>
          <span>/</span>
          <span>{{ formatTime(duration) }}</span>
        </div>
      </div>
      <div class="progress-wrap">
        <input
          class="progress"
          type="range"
          min="0"
          max="1000"
          step="1"
          :value="progressValue"
          @input="onSeekInput"
          @change="onSeekChange"
        >
      </div>
    </div>

    <p
      v-else
      class="media-error"
    >
      {{ kind === 'voice' ? t('graph.preview.audioError') : t('graph.preview.videoError') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  src: string
  kind: 'video' | 'voice'
}>()

const { t } = useStudioI18n()
const mediaEl = ref<HTMLMediaElement | null>(null)
const playing = ref(false)
const mediaError = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const seeking = ref(false)
let playRequestId = 0

const progressValue = computed(() => {
  if (!duration.value) return 0
  return Math.round((currentTime.value / duration.value) * 1000)
})

watch(
  () => props.src,
  () => {
    playing.value = false
    mediaError.value = false
    currentTime.value = 0
    duration.value = 0
  }
)

onBeforeUnmount(() => {
  playRequestId += 1
  mediaEl.value?.pause()
})

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function syncClock(el: HTMLMediaElement): void {
  if (!seeking.value) currentTime.value = el.currentTime || 0
  duration.value = Number.isFinite(el.duration) ? el.duration : 0
}

function onPlay(): void {
  playing.value = true
}

function onPause(): void {
  playing.value = false
}

function onEnded(): void {
  playing.value = false
  const el = mediaEl.value
  if (el) currentTime.value = el.currentTime || 0
}

function onTimeUpdate(): void {
  const el = mediaEl.value
  if (el) syncClock(el)
}

function onLoaded(): void {
  const el = mediaEl.value
  if (el) syncClock(el)
}

function onError(): void {
  // 清空 / 切换 src 时的伪 error 忽略，避免空资产误显示「编码不受支持」
  if (!props.src) return
  mediaError.value = true
  playing.value = false
}

async function togglePlayback(): Promise<void> {
  const el = mediaEl.value
  if (!el) return
  const requestId = ++playRequestId
  if (!el.paused) {
    el.pause()
    playing.value = false
    return
  }
  playing.value = true
  try {
    await el.play()
    if (requestId !== playRequestId) return
    playing.value = !el.paused
  } catch (error) {
    if (requestId !== playRequestId) return
    if (error instanceof DOMException && error.name === 'AbortError') return
    if (!props.src) return
    playing.value = false
    mediaError.value = true
  }
}

function seekToStart(): void {
  const el = mediaEl.value
  if (!el) return
  el.currentTime = 0
  currentTime.value = 0
}

function onSeekInput(event: Event): void {
  seeking.value = true
  const el = mediaEl.value
  if (!el || !duration.value) return
  const value = Number((event.target as HTMLInputElement).value)
  currentTime.value = (value / 1000) * duration.value
}

function onSeekChange(event: Event): void {
  const el = mediaEl.value
  seeking.value = false
  if (!el || !duration.value) return
  const value = Number((event.target as HTMLInputElement).value)
  el.currentTime = (value / 1000) * duration.value
  syncClock(el)
}
</script>

<style scoped>
.media-preview-player {
  position: relative;
  width: 100%;
  min-width: 0;
  background: var(--media-letterbox);
  box-sizing: border-box;
}

.media-preview-player.video {
  display: flex;
  align-items: center;
  justify-content: center;
  max-height: 240px;
}

.media-preview-player.video .media-el {
  display: block;
  width: 100%;
  max-height: 240px;
  object-fit: contain;
  background: var(--media-letterbox);
}

.media-preview-player.audio {
  min-height: 96px;
  padding-bottom: 56px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.audio-stage {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 16px 12px 8px;
}

.audio-glyph {
  font-size: 28px;
  color: var(--text-muted);
  line-height: 1;
}

.media-preview-player.audio .media-el {
  display: none;
}

.transport {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 4px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 7px 7px;
  border-radius: 8px;
  background: transparent;
  backdrop-filter: none;
  z-index: 5;
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
  border: 1px solid var(--wash-16);
  background: var(--panel-glass);
  color: var(--accent-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.ctrl-btn.primary {
  width: 28px;
  height: 28px;
  color: var(--on-accent);
  background: var(--accent-90);
  border-color: transparent;
}

.ctrl-btn .triangle {
  width: 0;
  height: 0;
  margin-left: 2px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid currentColor;
}

.ctrl-btn .pause {
  width: 8px;
  height: 12px;
  border-left: 2px solid currentColor;
  border-right: 2px solid currentColor;
}

.ctrl-btn .icon-restart {
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-radius: 50%;
  border-left-color: transparent;
  position: relative;
}

.ctrl-btn .icon-restart::after {
  content: '';
  position: absolute;
  top: -3px;
  left: 4px;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  transform: rotate(-35deg);
}

.progress-wrap {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0 1px;
}

.progress {
  width: 100%;
  height: 4px;
  margin: 0;
  padding: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.time-row {
  display: flex;
  font-size: 9px;
  color: var(--on-media-line);
  font-family: var(--mono);
  line-height: 1;
  text-shadow: 0 1px 2px var(--on-media-line-shadow);
}

.time-row.inline {
  margin-left: auto;
  justify-content: flex-end;
  gap: 3px;
  white-space: nowrap;
}

.media-error {
  margin: 0;
  padding: 12px;
  font-size: 12px;
  color: var(--danger-muted);
  text-align: center;
}
</style>
