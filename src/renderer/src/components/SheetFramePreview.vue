<template>
  <div class="sfp">
    <div class="sfp-main">
      <div ref="stageEl" class="sfp-stage checker">
        <canvas ref="frameCanvasEl" class="sfp-canvas" />
        <div v-if="imageLoading" class="sfp-overlay">
          {{ t('sheetPreview.loading') }}
        </div>
        <div v-else-if="imageError" class="sfp-overlay error">
          {{ imageError }}
        </div>
        <div v-else-if="totalFrames <= 1" class="sfp-overlay hint">
          {{ t('sheetPreview.singleFrameHint') }}
        </div>
      </div>

      <div class="sfp-side">
        <div class="sfp-grid-inputs">
          <label class="sfp-field">
            <span>{{ t('sheetPreview.rows') }}</span>
            <input
              type="number"
              min="1"
              max="64"
              :value="rows"
              @change="onGridInput('rows', $event)"
            />
          </label>
          <label class="sfp-field">
            <span>{{ t('sheetPreview.cols') }}</span>
            <input
              type="number"
              min="1"
              max="64"
              :value="cols"
              @change="onGridInput('cols', $event)"
            />
          </label>
          <label class="sfp-field">
            <span>{{ t('sheetPreview.fps') }}</span>
            <select :value="fps" @change="fps = Number(($event.target as HTMLSelectElement).value)">
              <option v-for="item in fpsOptions" :key="item" :value="item">
                {{ item }}
              </option>
            </select>
          </label>
        </div>

        <div class="sfp-transport">
          <button type="button" class="sfp-play" :disabled="totalFrames <= 1" @click="togglePlay">
            {{ playing ? t('sheetPreview.pause') : t('sheetPreview.play') }}
          </button>
          <button type="button" :disabled="totalFrames <= 1" title="⏮" @click="stepFrame(-1)">
            ⏮
          </button>
          <button type="button" :disabled="totalFrames <= 1" title="⏭" @click="stepFrame(1)">
            ⏭
          </button>
          <label class="sfp-loop">
            <input v-model="loop" type="checkbox" />
            {{ t('sheetPreview.loop') }}
          </label>
        </div>

        <p class="sfp-frame">
          {{
            t('sheetPreview.frame', {
              current: Math.min(frameIndex + 1, totalFrames),
              total: totalFrames
            })
          }}
        </p>
        <p class="sfp-tip">
          {{ t('sheetPreview.gridTip') }}
        </p>

        <div class="sfp-overview-label">
          {{ t('sheetPreview.overview') }}
        </div>
        <div ref="overviewWrapEl" class="sfp-overview checker">
          <canvas
            ref="overviewCanvasEl"
            class="sfp-overview-canvas"
            @pointerdown="onOverviewPointer"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'

const props = defineProps<{
  url: string
  initialRows?: number | null
  initialCols?: number | null
}>()

const { t } = useStudioI18n()

const fpsOptions = [2, 4, 6, 8, 10, 12, 15, 24, 30]

function clampDim(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(64, Math.max(1, Math.round(value)))
}

const rows = ref(clampDim(props.initialRows ?? 1))
const cols = ref(clampDim(props.initialCols ?? 1))
const fps = ref(12)
const loop = ref(true)
const playing = ref(false)
const frameIndex = ref(0)
const image = ref<HTMLImageElement | null>(null)
const imageLoading = ref(true)
const imageError = ref('')

const stageEl = ref<HTMLDivElement | null>(null)
const frameCanvasEl = ref<HTMLCanvasElement | null>(null)
const overviewWrapEl = ref<HTMLDivElement | null>(null)
const overviewCanvasEl = ref<HTMLCanvasElement | null>(null)

const totalFrames = computed(() => clampDim(rows.value) * clampDim(cols.value))

let raf = 0
let lastMs = 0
let accMs = 0
let resizeObserver: ResizeObserver | null = null

function drawFrame(): void {
  const canvas = frameCanvasEl.value
  const wrap = stageEl.value
  const img = image.value
  if (!canvas || !wrap || !img || !img.naturalWidth) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(wrap.clientWidth * dpr))
  const height = Math.max(1, Math.round(wrap.clientHeight * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const tRows = clampDim(rows.value)
  const tCols = clampDim(cols.value)
  const cellW = img.naturalWidth / tCols
  const cellH = img.naturalHeight / tRows
  const total = tRows * tCols
  const fi = Math.max(0, Math.min(frameIndex.value, total - 1))
  const sx = (fi % tCols) * cellW
  const sy = Math.floor(fi / tCols) * cellH
  const scale = Math.min(canvas.width / cellW, canvas.height / cellH)
  const dw = cellW * scale
  const dh = cellH * scale
  const dx = (canvas.width - dw) / 2
  const dy = (canvas.height - dh) / 2
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, sx, sy, cellW, cellH, dx, dy, dw, dh)
}

function drawOverview(): void {
  const canvas = overviewCanvasEl.value
  const wrap = overviewWrapEl.value
  const img = image.value
  if (!canvas || !wrap || !img || !img.naturalWidth) return
  const dpr = Math.min(2, window.devicePixelRatio || 1)
  const width = Math.max(1, Math.round(wrap.clientWidth * dpr))
  const height = Math.max(1, Math.round(wrap.clientHeight * dpr))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  const dx = (canvas.width - dw) / 2
  const dy = (canvas.height - dh) / 2
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(img, dx, dy, dw, dh)
  const tRows = clampDim(rows.value)
  const tCols = clampDim(cols.value)
  if (tRows * tCols <= 1) return
  const gridW = dw / tCols
  const gridH = dh / tRows
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)'
  ctx.lineWidth = 1
  for (let r = 1; r < tRows; r += 1) {
    ctx.beginPath()
    ctx.moveTo(dx, dy + gridH * r)
    ctx.lineTo(dx + dw, dy + gridH * r)
    ctx.stroke()
  }
  for (let c = 1; c < tCols; c += 1) {
    ctx.beginPath()
    ctx.moveTo(dx + gridW * c, dy)
    ctx.lineTo(dx + gridW * c, dy + dh)
    ctx.stroke()
  }
  const total = tRows * tCols
  const fi = Math.max(0, Math.min(frameIndex.value, total - 1))
  const col = fi % tCols
  const row = Math.floor(fi / tCols)
  ctx.fillStyle = 'rgba(61, 214, 140, 0.14)'
  ctx.fillRect(dx + gridW * col, dy + gridH * row, gridW, gridH)
  ctx.strokeStyle = 'rgba(61, 214, 140, 0.9)'
  ctx.strokeRect(dx + gridW * col + 0.5, dy + gridH * row + 0.5, gridW - 1, gridH - 1)
}

function redrawAll(): void {
  drawFrame()
  drawOverview()
}

function loadImage(): void {
  const url = props.url?.trim()
  playing.value = false
  lastMs = 0
  accMs = 0
  image.value = null
  imageError.value = ''
  if (!url) {
    imageLoading.value = false
    redrawAll()
    return
  }
  imageLoading.value = true
  const img = new Image()
  img.onload = () => {
    image.value = img
    imageLoading.value = false
    rows.value = clampDim(rows.value)
    cols.value = clampDim(cols.value)
    frameIndex.value = Math.max(0, Math.min(frameIndex.value, Math.max(1, totalFrames.value - 1)))
    redrawAll()
  }
  img.onerror = () => {
    image.value = null
    imageLoading.value = false
    imageError.value = t('sheetPreview.loadFailed')
    redrawAll()
  }
  img.src = url
}

function advanceFrame(): void {
  const total = totalFrames.value
  if (total <= 1) return
  const next = frameIndex.value + 1
  if (next < total) {
    frameIndex.value = next
    return
  }
  if (loop.value) {
    frameIndex.value = 0
    return
  }
  frameIndex.value = total - 1
  playing.value = false
}

function tick(now: number): void {
  raf = requestAnimationFrame(tick)
  if (!playing.value) return
  if (!lastMs) {
    lastMs = now
    return
  }
  let delta = now - lastMs
  lastMs = now
  if (delta > 250) delta = 250
  accMs += delta
  const stepMs = 1000 / Math.max(1, fps.value)
  const steps = Math.floor(accMs / stepMs)
  if (steps <= 0) return
  accMs -= steps * stepMs
  for (let i = 0; i < steps; i += 1) advanceFrame()
}

function startRaf(): void {
  if (!raf) raf = requestAnimationFrame(tick)
}

function stopRaf(): void {
  cancelAnimationFrame(raf)
  raf = 0
}

function togglePlay(): void {
  if (totalFrames.value <= 1) return
  playing.value = !playing.value
  lastMs = 0
  accMs = 0
  if (playing.value) startRaf()
}

function stepFrame(dir: -1 | 1): void {
  const total = totalFrames.value
  if (total <= 1) return
  lastMs = 0
  accMs = 0
  let next = frameIndex.value + dir
  if (next < 0) next = loop.value ? total - 1 : 0
  if (next >= total) next = loop.value ? 0 : total - 1
  frameIndex.value = next
}

function onGridInput(kind: 'rows' | 'cols', event: Event): void {
  const value = clampDim(Number((event.target as HTMLInputElement).value))
  if (kind === 'rows') rows.value = value
  else cols.value = value
  const total = totalFrames.value
  frameIndex.value = Math.max(0, Math.min(frameIndex.value, Math.max(0, total - 1)))
  if (total <= 1) {
    playing.value = false
    lastMs = 0
    accMs = 0
  }
  redrawAll()
}

function onOverviewPointer(event: PointerEvent): void {
  const canvas = overviewCanvasEl.value
  const img = image.value
  if (!canvas || !img || !img.naturalWidth) return
  const tRows = clampDim(rows.value)
  const tCols = clampDim(cols.value)
  if (tRows * tCols <= 1) return
  const rect = canvas.getBoundingClientRect()
  const px = ((event.clientX - rect.left) / Math.max(1, rect.width)) * canvas.width
  const py = ((event.clientY - rect.top) / Math.max(1, rect.height)) * canvas.height
  const scale = Math.min(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight)
  const dw = img.naturalWidth * scale
  const dh = img.naturalHeight * scale
  const dx = (canvas.width - dw) / 2
  const dy = (canvas.height - dh) / 2
  if (px < dx || px >= dx + dw || py < dy || py >= dy + dh) return
  const col = Math.min(tCols - 1, Math.max(0, Math.floor(((px - dx) / dw) * tCols)))
  const row = Math.min(tRows - 1, Math.max(0, Math.floor(((py - dy) / dh) * tRows)))
  frameIndex.value = row * tCols + col
}

function setupResizeObserver(): void {
  resizeObserver?.disconnect()
  resizeObserver = new ResizeObserver(() => redrawAll())
  if (stageEl.value) resizeObserver.observe(stageEl.value)
  if (overviewWrapEl.value) resizeObserver.observe(overviewWrapEl.value)
}

watch(
  () => props.url,
  () => loadImage(),
  { immediate: true }
)

watch([rows, cols, frameIndex], () => redrawAll())

watch(fps, () => {
  lastMs = 0
  accMs = 0
})

watch(totalFrames, (total) => {
  if (total <= 1) {
    playing.value = false
    lastMs = 0
    accMs = 0
  }
  frameIndex.value = Math.max(0, Math.min(frameIndex.value, Math.max(0, total - 1)))
})

onMounted(() => {
  startRaf()
  setupResizeObserver()
})

onBeforeUnmount(() => {
  stopRaf()
  resizeObserver?.disconnect()
  resizeObserver = null
})
</script>

<style scoped>
.sfp {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.sfp-main {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 10px;
  padding: 10px;
}

.sfp-stage {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.checker {
  background-color: var(--bg-input);
  background-image:
    linear-gradient(
      45deg,
      var(--wash-16) 25%,
      transparent 25%,
      transparent 75%,
      var(--wash-16) 75%
    ),
    linear-gradient(45deg, var(--wash-16) 25%, transparent 25%, transparent 75%, var(--wash-16) 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    8px 8px;
}

.sfp-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.sfp-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: var(--text-muted);
  pointer-events: none;
}

.sfp-overlay.error {
  color: var(--danger);
}

.sfp-side {
  display: flex;
  flex-direction: column;
  width: 268px;
  flex-shrink: 0;
  gap: 10px;
  overflow-y: auto;
  padding-right: 2px;
}

.sfp-grid-inputs {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sfp-field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sfp-field span {
  flex: 1;
  font-size: 12px;
  color: var(--text-muted);
}

.sfp-field input,
.sfp-field select {
  width: 84px;
}

.sfp-transport {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.sfp-transport .sfp-play {
  min-width: 84px;
}

.sfp-loop {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  margin-left: auto;
}

.sfp-frame {
  margin: 0;
  font-size: 13px;
  color: var(--text-strong);
}

.sfp-tip {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-faint);
}

.sfp-overview-label {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-muted);
}

.sfp-overview {
  position: relative;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  flex: 1;
  min-height: 120px;
}

.sfp-overview-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
}
</style>
