<script setup lang="ts">
/**
 * 原片 / 构建结果并排对比；可选掩码高亮与逐镜头重跑入口。
 */
import { computed, ref, watch } from 'vue'

const props = defineProps<{
  originalUrl: string
  resultUrl: string
  /** 掩码叠加图（可选 data URL / 文件 URL） */
  maskOverlayUrl?: string
  shotIds?: string[]
  qcNotes?: string[]
}>()

const emit = defineEmits<{
  rerunShot: [shotId: string]
  seek: [sec: number]
}>()

const leftEl = ref<HTMLVideoElement | null>(null)
const rightEl = ref<HTMLVideoElement | null>(null)
const syncing = ref(false)
const selectedShot = ref<string | null>(null)

const notes = computed(() => props.qcNotes ?? [])

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

watch(
  () => props.resultUrl,
  () => {
    selectedShot.value = null
  }
)

function playBoth(): void {
  void leftEl.value?.play()
  void rightEl.value?.play()
}

function pauseBoth(): void {
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
      <button type="button" @click="playBoth">Play</button>
      <button type="button" @click="pauseBoth">Pause</button>
      <select v-model="selectedShot">
        <option :value="null">Shot…</option>
        <option v-for="id in shotIds ?? []" :key="id" :value="id">{{ id }}</option>
      </select>
      <button type="button" :disabled="!selectedShot" @click="rerun">Re-run shot</button>
    </div>
    <div class="scv-pair">
      <div class="scv-pane">
        <header>Original</header>
        <video ref="leftEl" :src="originalUrl" controls @timeupdate="onTimeUpdate('left')" />
      </div>
      <div class="scv-pane">
        <header>Result</header>
        <div class="scv-stack">
          <video ref="rightEl" :src="resultUrl" controls @timeupdate="onTimeUpdate('right')" />
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
  min-height: 240px;
}
.scv-toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.scv-pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.scv-pane header {
  font-size: 12px;
  opacity: 0.7;
  margin-bottom: 4px;
}
.scv-pane video {
  width: 100%;
  background: #111;
  border-radius: 6px;
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
  opacity: 0.8;
}
</style>
