<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  originalUrl: string
  resultUrl: string
  /** Optional pre-rendered synchronized side-by-side compare.mp4 URL */
  compareVideoUrl?: string
  /** Optional mask overlay data/file URL */
  maskOverlayUrl?: string
  shotIds?: string[]
  qcNotes?: string[]
}>()

const emit = defineEmits<{
  rerunShot: [shotId: string]
  seek: [sec: number]
}>()

const { t } = useStudioI18n()

const leftEl = ref<HTMLVideoElement | null>(null)
const rightEl = ref<HTMLVideoElement | null>(null)
const compareEl = ref<HTMLVideoElement | null>(null)
const syncing = ref(false)
const selectedShot = ref<string | null>(null)
const viewMode = ref<'dual' | 'rendered'>('dual')

const notes = computed(() => props.qcNotes ?? [])
const hasCompareMp4 = computed(() => Boolean(props.compareVideoUrl?.trim()))

watch(
  hasCompareMp4,
  (ok) => {
    if (!ok && viewMode.value === 'rendered') viewMode.value = 'dual'
  },
  { immediate: true }
)

function onTimeUpdate(side: 'left' | 'right'): void {
  if (syncing.value) return
  const src = side === 'left' ? leftEl.value : rightEl.value
  const dst = side === 'left' ? rightEl.value : leftEl.value
  if (!src || !dst) return
  if (Math.abs(src.currentTime - dst.currentTime) > 0.12) {
    syncing.value = true
    dst.currentTime = src.currentTime
    syncing.value = false
  }
  emit('seek', src.currentTime)
}

function onCompareTimeUpdate(): void {
  if (compareEl.value) emit('seek', compareEl.value.currentTime)
}

watch(
  () => props.resultUrl,
  () => {
    selectedShot.value = null
  }
)

function playBoth(): void {
  if (viewMode.value === 'rendered') {
    void compareEl.value?.play()
    return
  }
  void leftEl.value?.play()
  void rightEl.value?.play()
}

function pauseBoth(): void {
  if (viewMode.value === 'rendered') {
    compareEl.value?.pause()
    return
  }
  leftEl.value?.pause()
  rightEl.value?.pause()
}

function rerun(): void {
  if (selectedShot.value) emit('rerunShot', selectedShot.value)
}
</script>

<template>
  <div class="scv">
    <div class="scv-toolbar">
      <button type="button" class="scv-btn" @click="playBoth">
        {{ t('graph.semanticTimeline.rea.playBoth') }}
      </button>
      <button type="button" class="scv-btn" @click="pauseBoth">
        {{ t('graph.semanticTimeline.rea.pauseBoth') }}
      </button>
      <div v-if="hasCompareMp4" class="scv-mode-switch">
        <button
          type="button"
          class="scv-btn"
          :class="{ active: viewMode === 'dual' }"
          @click="viewMode = 'dual'"
        >
          {{ t('graph.semanticTimeline.rea.compareModeDual') }}
        </button>
        <button
          type="button"
          class="scv-btn"
          :class="{ active: viewMode === 'rendered' }"
          @click="viewMode = 'rendered'"
        >
          {{ t('graph.semanticTimeline.rea.compareModeSideBySide') }}
        </button>
      </div>
      <template v-if="(shotIds?.length ?? 0) > 0">
        <select v-model="selectedShot" class="scv-select">
          <option :value="null">
            {{ t('graph.semanticTimeline.rea.selectShotPlaceholder') }}
          </option>
          <option v-for="id in shotIds ?? []" :key="id" :value="id">{{ id }}</option>
        </select>
        <button type="button" class="scv-btn" :disabled="!selectedShot" @click="rerun">
          {{ t('graph.semanticTimeline.rea.rerunShot') }}
        </button>
      </template>
    </div>

    <div v-if="viewMode === 'rendered' && compareVideoUrl" class="scv-single">
      <video
        ref="compareEl"
        :src="compareVideoUrl"
        controls
        playsinline
        @timeupdate="onCompareTimeUpdate"
      />
    </div>

    <div v-else class="scv-pair">
      <div class="scv-pane">
        <header>{{ t('graph.semanticTimeline.rea.originalLabel') }}</header>
        <video
          ref="leftEl"
          :src="originalUrl"
          controls
          playsinline
          @timeupdate="onTimeUpdate('left')"
        />
      </div>
      <div class="scv-pane">
        <header>{{ t('graph.semanticTimeline.rea.remakeResultLabel') }}</header>
        <div class="scv-stack">
          <video
            ref="rightEl"
            :src="resultUrl"
            controls
            playsinline
            @timeupdate="onTimeUpdate('right')"
          />
          <img v-if="maskOverlayUrl" class="scv-mask" :src="maskOverlayUrl" alt="mask" />
        </div>
      </div>
    </div>

    <ul v-if="notes.length" class="scv-notes">
      <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
    </ul>
  </div>
</template>

<style scoped>
.scv {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 220px;
}
.scv-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.scv-mode-switch {
  display: inline-flex;
  gap: 4px;
}
.scv-btn,
.scv-select {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}
.scv-btn:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}
.scv-btn.active {
  background: color-mix(in srgb, var(--accent) 18%, var(--bg-elevated));
  border-color: var(--accent);
  font-weight: 600;
}
.scv-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.scv-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.scv-single video,
.scv-pane video {
  display: block;
  width: 100%;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 6px;
}
.scv-pane header {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 4px;
}
.scv-stack {
  position: relative;
}
.scv-mask {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  opacity: 0.45;
  pointer-events: none;
  mix-blend-mode: screen;
}
.scv-notes {
  margin: 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
