<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('cutout.title')"
    :z-index="1200"
    :default-width="1040"
    :default-height="780"
    :min-width="760"
    :min-height="560"
    body-class="pad-none cutout-body"
    @close="emit('close')"
  >
    <div v-if="open" class="cutout">
      <section class="pane">
        <div class="section-head">
          <div class="section-label">
            {{ t('cutout.source') }}
          </div>
          <span
            v-if="analysis"
            class="engine-badge"
            :class="{ matting: !!analysis.mattingModelId }"
          >
            {{
              analysis.mattingModelId
                ? t('cutout.engineMatting', { id: analysis.mattingModelId })
                : t('cutout.engineGuided')
            }}
          </span>
          <button
            v-if="stageZoom > 1.01 || stagePan.x !== 0 || stagePan.y !== 0"
            type="button"
            class="zoom-pill"
            @click="resetView"
          >
            {{ Math.round(stageZoom * 100) }}% · {{ t('cutout.zoomReset') }}
          </button>
        </div>

        <div
          class="stage"
          :class="{
            paintable: brushMode !== 'off' && ready && !!sourceUrl,
            pannable: brushMode === 'off' && stageZoom > 1.01
          }"
          @wheel.prevent="onStageWheel"
          @pointerdown="onStagePointerDown($event, 'source')"
          @pointermove="onStagePointerMove($event, 'source')"
          @pointerup="onStagePointerUp"
          @pointercancel="onStagePointerUp"
          @pointerleave="onStagePointerLeave('source')"
        >
          <div v-if="ready && sourceUrl" class="stage-canvas-wrap" :style="stageTransformStyle">
            <img ref="sourceImgRef" :src="sourceUrl" alt="" draggable="false" />
            <svg
              v-if="brushStrokes.length || activeStroke || hoverStage === 'source'"
              class="brush-overlay"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
            >
              <path
                v-for="(s, idx) in brushStrokes"
                :key="idx"
                :d="strokeToSvgPath(s.points)"
                :class="['stroke-path', s.mode]"
                :stroke-width="s.radius * 2000"
              />
              <path
                v-if="activeStroke"
                :d="strokeToSvgPath(activeStroke.points)"
                :class="['stroke-path', activeStroke.mode]"
                :stroke-width="activeStroke.radius * 2000"
              />
              <circle
                v-if="hoverStage === 'source' && brushMode !== 'off' && cursorNorm"
                :cx="cursorNorm.x * 1000"
                :cy="cursorNorm.y * 1000"
                :r="normalizedBrushRadius * 1000"
                :class="['brush-cursor', brushMode]"
              />
            </svg>
          </div>
          <p v-else-if="sourceLoading || !sourceUrl" class="hint">
            {{ sourceLoading ? t('cutout.loadingSource') : t('cutout.noSource') }}
          </p>
        </div>

        <div class="row">
          <button type="button" class="primary" :disabled="busy || !sourceUrl" @click="analyze">
            {{ busy ? t('cutout.analyzing') : analysis ? t('cutout.rerun') : t('cutout.analyze') }}
          </button>
          <span v-if="analysis" class="hint">{{
            t('cutout.inferenceMs', { ms: analysis.inferenceMs })
          }}</span>
        </div>

        <!-- 交互式保留 / 擦除修补画笔 -->
        <div class="brush-box">
          <div class="section-label">
            {{ t('cutout.brushTitle') }}
          </div>
          <div class="brush-bar">
            <button
              type="button"
              class="mode-btn"
              :class="{ active: brushMode === 'off' }"
              @click="brushMode = 'off'"
            >
              {{ t('cutout.brushOff') }}
            </button>
            <button
              type="button"
              class="mode-btn keep"
              :class="{ active: brushMode === 'keep' }"
              @click="brushMode = 'keep'"
            >
              {{ t('cutout.brushKeep') }}
            </button>
            <button
              type="button"
              class="mode-btn erase"
              :class="{ active: brushMode === 'erase' }"
              @click="brushMode = 'erase'"
            >
              {{ t('cutout.brushErase') }}
            </button>
            <button
              type="button"
              class="ghost-sm"
              :disabled="brushStrokes.length === 0"
              @click="undoBrushStroke"
            >
              {{ t('cutout.brushUndo') }}
            </button>
            <button
              type="button"
              class="ghost-sm"
              :disabled="brushStrokes.length === 0"
              @click="clearBrushStrokes"
            >
              {{ t('cutout.brushClear', { n: brushStrokes.length }) }}
            </button>
          </div>
          <label v-if="brushMode !== 'off'" class="slider compact">
            <span
              >{{ t('cutout.brushSize') }}<b>{{ brushSizePx }}px</b></span
            >
            <input v-model.number="brushSizePx" type="range" min="4" max="72" step="2" />
          </label>
          <p class="hint">
            {{ t('cutout.brushHint') }}
          </p>
        </div>

        <div class="section-label">
          {{ t('cutout.subjects', { n: instances.length }) }}
        </div>
        <ul v-if="instances.length" class="instances">
          <li v-for="it in instances" :key="it.index">
            <label>
              <input
                type="checkbox"
                :checked="selected.includes(it.index)"
                @change="toggle(it.index)"
              />
              <span>{{ it.labelZh }}</span>
              <span class="conf">{{ Math.round(it.confidence * 100) }}%</span>
            </label>
          </li>
        </ul>
        <p v-else class="hint">
          {{ analysis ? t('cutout.empty') : t('cutout.notAnalyzed') }}
        </p>
      </section>

      <section class="pane">
        <div class="section-label">
          {{ t('cutout.params') }}
        </div>
        <div class="params-grid">
          <label class="slider">
            <span
              >{{ t('cutout.detectConf') }}<b>{{ Math.round(detectConf * 100) }}%</b></span
            >
            <input
              v-model.number="detectConf"
              type="range"
              min="0.1"
              max="0.9"
              step="0.05"
              @change="analyze"
            />
          </label>
          <label class="slider">
            <span
              >{{ t('cutout.threshold') }}<b>{{ Math.round(threshold * 100) }}%</b></span
            >
            <input v-model.number="threshold" type="range" min="0.1" max="0.95" step="0.05" />
          </label>
          <label class="slider">
            <span
              >{{ t('cutout.edgeGuided') }}<b>{{ edgeGuidedRadius }}px</b></span
            >
            <input v-model.number="edgeGuidedRadius" type="range" min="0" max="12" step="1" />
          </label>
          <label class="slider">
            <span
              >{{ t('cutout.edgeChoke')
              }}<b>{{ edgeChoke > 0 ? `+${edgeChoke}` : edgeChoke }}</b></span
            >
            <input v-model.number="edgeChoke" type="range" min="-8" max="8" step="1" />
          </label>
          <label class="slider">
            <span
              >{{ t('cutout.feather') }}<b>{{ feather }}px</b></span
            >
            <input v-model.number="feather" type="range" min="0" max="12" step="1" />
          </label>
        </div>

        <div class="check-row">
          <label class="check">
            <input v-model="holePunch" type="checkbox" />
            <span>{{ t('cutout.holePunch') }}</span>
          </label>
          <label class="check">
            <input v-model="cropToSubject" type="checkbox" />
            <span>{{ t('cutout.crop') }}</span>
          </label>
        </div>

        <div class="section-head">
          <div class="section-label">
            {{ t('cutout.result') }}
          </div>
          <div class="backdrop-swatches">
            <button
              type="button"
              class="swatch checker"
              :class="{ active: previewBackdrop === 'checker' }"
              :title="t('cutout.bgChecker')"
              @click="previewBackdrop = 'checker'"
            />
            <button
              type="button"
              class="swatch dark"
              :class="{ active: previewBackdrop === 'dark' }"
              :title="t('cutout.bgDark')"
              @click="previewBackdrop = 'dark'"
            />
            <button
              type="button"
              class="swatch light"
              :class="{ active: previewBackdrop === 'light' }"
              :title="t('cutout.bgLight')"
              @click="previewBackdrop = 'light'"
            />
            <button
              type="button"
              class="swatch green"
              :class="{ active: previewBackdrop === 'green' }"
              :title="t('cutout.bgGreen')"
              @click="previewBackdrop = 'green'"
            />
          </div>
        </div>
        <div
          class="stage"
          :class="[
            `bg-${previewBackdrop}`,
            {
              paintable: brushMode !== 'off' && !!resultUrl,
              pannable: brushMode === 'off' && stageZoom > 1.01
            }
          ]"
          @wheel.prevent="onStageWheel"
          @pointerdown="onStagePointerDown($event, 'result')"
          @pointermove="onStagePointerMove($event, 'result')"
          @pointerup="onStagePointerUp"
          @pointercancel="onStagePointerUp"
          @pointerleave="onStagePointerLeave('result')"
        >
          <div v-if="resultUrl" class="stage-canvas-wrap" :style="stageTransformStyle">
            <img ref="resultImgRef" :src="resultUrl" alt="" draggable="false" />
            <svg
              v-if="hoverStage === 'result' && brushMode !== 'off' && resultCursorNorm"
              class="brush-overlay"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
            >
              <circle
                :cx="resultCursorNorm.x * 1000"
                :cy="resultCursorNorm.y * 1000"
                :r="normalizedBrushRadius * 1000"
                :class="['brush-cursor', brushMode]"
              />
            </svg>
          </div>
          <p v-else class="hint">
            {{ t('cutout.resultEmpty') }}
          </p>
        </div>
        <div class="row">
          <span v-if="resultUrl" class="hint">{{ resultWidth }}×{{ resultHeight }}</span>
          <button type="button" class="primary" :disabled="!resultUrl" @click="save">
            {{ t('cutout.apply') }}
          </button>
        </div>
        <p v-if="error" class="error">
          {{ error }}
        </p>
        <p class="apply-hint">
          {{ t('cutout.applyHint') }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { normalizeImageCutout, type ImageCutoutState } from '@shared/graph'
import type { CutoutBrushPoint, CutoutBrushStroke, CutoutRegion } from '@shared/yoloCutout'
import { useStudioI18n } from '../composables/useStudioI18n'
import { analyzeCutout, renderCutoutPng, type CutoutAnalysis } from '../features/yolo/cutout'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  setup?: ImageCutoutState | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [payload: { imageCutout: ImageCutoutState; dataUrl?: string }]
}>()

const { t } = useStudioI18n()

/** 源图与节点参数就绪后自动开始识别 */
const ready = computed(() => props.open && !!props.sourceUrl && !props.sourceLoading)

const analysis = ref<CutoutAnalysis | null>(null)
const image = ref<HTMLImageElement | null>(null)
const selected = ref<number[]>([])
const detectConf = ref(0.25)
const threshold = ref(0.5)
const feather = ref(2)
const edgeGuidedRadius = ref(4)
const edgeChoke = ref(0)
const holePunch = ref(true)
const cropToSubject = ref(true)

const brushMode = ref<'off' | 'keep' | 'erase'>('off')
const brushSizePx = ref(20)
const brushStrokes = ref<CutoutBrushStroke[]>([])
const activeStroke = ref<CutoutBrushStroke | null>(null)
const hoverStage = ref<'source' | 'result' | null>(null)
const cursorNorm = ref<CutoutBrushPoint | null>(null)
const resultCursorNorm = ref<CutoutBrushPoint | null>(null)
const sourceImgRef = ref<HTMLImageElement | null>(null)
const resultImgRef = ref<HTMLImageElement | null>(null)
const currentRegion = ref<CutoutRegion | null>(null)
const previewBackdrop = ref<'checker' | 'dark' | 'light' | 'green'>('checker')
const stageZoom = ref(1)
const stagePan = ref({ x: 0, y: 0 })
let panStart: { clientX: number; clientY: number; panX: number; panY: number } | null = null

const stageTransformStyle = computed(() => ({
  transform: `translate(${stagePan.value.x}px, ${stagePan.value.y}px) scale(${stageZoom.value})`,
  transformOrigin: 'center center'
}))

function onStageWheel(e: WheelEvent): void {
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15
  const next = Math.max(1, Math.min(5, stageZoom.value * factor))
  stageZoom.value = next
  if (next <= 1.01) {
    stagePan.value = { x: 0, y: 0 }
  }
}

function resetView(): void {
  stageZoom.value = 1
  stagePan.value = { x: 0, y: 0 }
  panStart = null
}

const busy = ref(false)
const error = ref('')
const resultUrl = ref('')
const resultWidth = ref(0)
const resultHeight = ref(0)
const resultCanvas = ref<HTMLCanvasElement | null>(null)
/** 渲染请求递增号：快速连续切换时丢弃过期结果并释放其 blob */
let renderToken = 0

const instances = computed(() => analysis.value?.instances ?? [])
const normalizedBrushRadius = computed(() =>
  Math.max(0.004, Math.min(0.18, brushSizePx.value / 640))
)

/** 每次会话开始前把滑杆参数对准当前节点 imageCutout 参数 */
function applySetup(): void {
  const s = props.setup
  detectConf.value = s?.confThreshold ?? 0.25
  threshold.value = s?.threshold ?? 0.5
  feather.value = s?.feather ?? 2
  edgeGuidedRadius.value = s?.edgeGuidedRadius ?? 4
  edgeChoke.value = s?.edgeChoke ?? 0
  holePunch.value = s?.holePunch ?? true
  cropToSubject.value = s?.cropToSubject ?? true
  brushStrokes.value = s?.brushStrokes
    ? s.brushStrokes.map((st) => ({ ...st, points: [...st.points] }))
    : []
}

function toggle(index: number): void {
  selected.value = selected.value.includes(index)
    ? selected.value.filter((i) => i !== index)
    : [...selected.value, index]
}

function strokeToSvgPath(points: readonly CutoutBrushPoint[]): string {
  if (!points.length) return ''
  if (points.length === 1) {
    const p = points[0]!
    const x = (p.x * 1000).toFixed(1)
    const y = (p.y * 1000).toFixed(1)
    return `M ${x} ${y} L ${x} ${y}`
  }
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * 1000).toFixed(1)} ${(p.y * 1000).toFixed(1)}`)
    .join(' ')
}

function mapEventToSourceNorm(
  e: PointerEvent,
  stage: 'source' | 'result'
): { srcNorm: CutoutBrushPoint; resNorm?: CutoutBrushPoint } | null {
  const el = stage === 'source' ? sourceImgRef.value : resultImgRef.value
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 1 || rect.height <= 1) return null
  const rx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  const ry = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
  if (stage === 'source') {
    return { srcNorm: { x: rx, y: ry } }
  }
  const a = analysis.value
  const reg = currentRegion.value
  if (!a || !reg || a.srcWidth <= 0 || a.srcHeight <= 0) {
    return { srcNorm: { x: rx, y: ry }, resNorm: { x: rx, y: ry } }
  }
  return {
    srcNorm: {
      x: Math.max(0, Math.min(1, (reg.x + rx * reg.width) / a.srcWidth)),
      y: Math.max(0, Math.min(1, (reg.y + ry * reg.height) / a.srcHeight))
    },
    resNorm: { x: rx, y: ry }
  }
}

function onStagePointerDown(e: PointerEvent, stage: 'source' | 'result'): void {
  if (
    e.button === 1 ||
    e.altKey ||
    (brushMode.value === 'off' && e.button === 0 && stageZoom.value > 1.01)
  ) {
    ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
    panStart = {
      clientX: e.clientX,
      clientY: e.clientY,
      panX: stagePan.value.x,
      panY: stagePan.value.y
    }
    return
  }
  if (brushMode.value === 'off' || e.button !== 0) return
  const mapped = mapEventToSourceNorm(e, stage)
  if (!mapped) return
  ;(e.currentTarget as HTMLElement | null)?.setPointerCapture?.(e.pointerId)
  hoverStage.value = stage
  cursorNorm.value = mapped.srcNorm
  resultCursorNorm.value = mapped.resNorm ?? null
  activeStroke.value = {
    mode: brushMode.value,
    radius: normalizedBrushRadius.value,
    points: [mapped.srcNorm]
  }
}

function onStagePointerMove(e: PointerEvent, stage: 'source' | 'result'): void {
  if (panStart) {
    stagePan.value = {
      x: panStart.panX + (e.clientX - panStart.clientX),
      y: panStart.panY + (e.clientY - panStart.clientY)
    }
    return
  }
  if (brushMode.value === 'off') return
  const mapped = mapEventToSourceNorm(e, stage)
  if (!mapped) return
  hoverStage.value = stage
  cursorNorm.value = mapped.srcNorm
  resultCursorNorm.value = mapped.resNorm ?? null
  if (!activeStroke.value) return
  const pts = activeStroke.value.points
  const last = pts[pts.length - 1]
  if (!last || Math.hypot(mapped.srcNorm.x - last.x, mapped.srcNorm.y - last.y) >= 0.002) {
    pts.push(mapped.srcNorm)
  }
}

function onStagePointerUp(): void {
  if (panStart) {
    panStart = null
    return
  }
  if (!activeStroke.value) return
  const finished = activeStroke.value
  activeStroke.value = null
  if (finished.points.length > 0) {
    brushStrokes.value = [...brushStrokes.value, finished]
  }
}

function onStagePointerLeave(stage: 'source' | 'result'): void {
  if (hoverStage.value === stage) {
    hoverStage.value = null
  }
}

function undoBrushStroke(): void {
  if (!brushStrokes.value.length) return
  brushStrokes.value = brushStrokes.value.slice(0, -1)
}

function clearBrushStrokes(): void {
  brushStrokes.value = []
}

async function render(): Promise<void> {
  const a = analysis.value
  const img = image.value
  const hasKeepBrush = brushStrokes.value.some((s) => s.mode === 'keep' && s.points.length > 0)
  if (!a || !img || (selected.value.length === 0 && !hasKeepBrush)) {
    resultUrl.value = ''
    resultCanvas.value = null
    return
  }
  const token = ++renderToken
  try {
    const out = await renderCutoutPng({
      image: img,
      analysis: a,
      selected: selected.value,
      threshold: threshold.value,
      feather: feather.value,
      cropToSubject: cropToSubject.value,
      edgeGuidedRadius: edgeGuidedRadius.value,
      edgeChoke: edgeChoke.value,
      holePunch: holePunch.value,
      brushStrokes: brushStrokes.value
    })
    if (token !== renderToken) {
      URL.revokeObjectURL(out.url)
      return
    }
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
    resultUrl.value = out.url
    resultWidth.value = out.width
    resultHeight.value = out.height
    resultCanvas.value = out.canvas
    currentRegion.value = out.region
    error.value = ''
  } catch (err) {
    if (token !== renderToken) return
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function analyze(): Promise<void> {
  if (!props.sourceUrl || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await analyzeCutout({ url: props.sourceUrl }, detectConf.value)
    analysis.value = res.analysis
    image.value = res.image
    const picked = props.setup?.selected ?? []
    const next = res.analysis.instances
    const mattingInst = next.find((it) => it.label === 'matting-subject')
    const personInsts = next.filter((it) => it.label === 'person').map((it) => it.index)
    if (picked.length) {
      const matched = next.filter((it) => picked.includes(it.index)).map((it) => it.index)
      selected.value = matched.length ? matched : next.map((it) => it.index)
    } else if (props.setup?.personOnly && personInsts.length > 0) {
      selected.value = personInsts
    } else if (mattingInst) {
      selected.value = [mattingInst.index]
    } else {
      selected.value = next.map((it) => it.index)
    }
    void render()
  } catch (err) {
    analysis.value = null
    resultUrl.value = ''
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

function save(): void {
  if (!resultCanvas.value || !resultUrl.value) {
    error.value = t('cutout.resultEmpty')
    return
  }
  const dataUrl = resultCanvas.value.toDataURL('image/png')
  emit('save', {
    imageCutout: normalizeImageCutout({
      confThreshold: detectConf.value,
      threshold: threshold.value,
      feather: feather.value,
      cropToSubject: cropToSubject.value,
      personOnly: false,
      selected: selected.value,
      edgeGuidedRadius: edgeGuidedRadius.value,
      edgeChoke: edgeChoke.value,
      holePunch: holePunch.value,
      brushStrokes: brushStrokes.value
    }),
    dataUrl
  })
}

function reset(): void {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  analysis.value = null
  image.value = null
  selected.value = []
  brushStrokes.value = []
  activeStroke.value = null
  brushMode.value = 'off'
  currentRegion.value = null
  resetView()
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value)
  resultUrl.value = ''
  resultCanvas.value = null
  resultWidth.value = 0
  resultHeight.value = 0
  error.value = ''
}

watch(ready, (ok) => {
  if (!props.open) {
    reset()
    return
  }
  if (!ok) return
  applySetup()
  void analyze()
})

let renderTimer: ReturnType<typeof setTimeout> | null = null
watch(
  [
    threshold,
    feather,
    edgeGuidedRadius,
    edgeChoke,
    holePunch,
    cropToSubject,
    selected,
    brushStrokes
  ],
  () => {
    if (renderTimer) clearTimeout(renderTimer)
    renderTimer = setTimeout(() => {
      renderTimer = null
      void render()
    }, 90)
  }
)
</script>

<style scoped>
.cutout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  height: 100%;
  min-height: 0;
  padding: 16px;
  overflow: auto;
}

.pane {
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
  flex-wrap: wrap;
}

.section-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.engine-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border);
  color: var(--text-muted);
  background: var(--bg-elevated);
}

.engine-badge.matting {
  color: var(--success, #34c77b);
  border-color: rgba(52, 199, 123, 0.45);
}

.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  max-height: 310px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--image-checker-bg);
  user-select: none;
}

.stage.paintable {
  cursor: crosshair;
  border-color: var(--accent);
}

.stage-canvas-wrap {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  max-height: 308px;
}

.stage img {
  display: block;
  max-width: 100%;
  max-height: 308px;
  object-fit: contain;
  pointer-events: none;
}

.brush-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.stroke-path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.stroke-path.keep {
  stroke: rgba(52, 199, 123, 0.52);
}

.stroke-path.erase {
  stroke: rgba(255, 91, 107, 0.52);
}

.brush-cursor {
  fill: none;
  stroke-width: 3;
}

.brush-cursor.keep {
  stroke: #34c77b;
  fill: rgba(52, 199, 123, 0.18);
}

.brush-cursor.erase {
  stroke: #ff5b6b;
  fill: rgba(255, 91, 107, 0.18);
}

/* 透明 PNG 多背景质检底色切换：棋盘格 / 纯黑底（查白边）/ 纯白底（查暗边）/ 绿幕底 */
.checker,
.bg-checker {
  background: var(--image-checker-bg);
}

.bg-dark {
  background: #0d0e12;
}

.bg-light {
  background: #ffffff;
}

.bg-green {
  background: #00d66c;
}

.stage.pannable {
  cursor: grab;
}

.stage.pannable:active {
  cursor: grabbing;
}

.zoom-pill {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
}

.backdrop-swatches {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 50%;
  border: 1.5px solid var(--border);
}

.swatch.checker {
  background: var(--image-checker-bg);
}

.swatch.dark {
  background: #0d0e12;
}

.swatch.light {
  background: #ffffff;
}

.swatch.green {
  background: #00d66c;
}

.swatch.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(91, 141, 255, 0.35);
}

.brush-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
}

.brush-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mode-btn,
.ghost-sm {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
}

.mode-btn.active {
  border-color: var(--accent);
  background: var(--wash-08, rgba(91, 141, 255, 0.15));
  color: var(--text);
  font-weight: 600;
}

.mode-btn.keep.active {
  border-color: #34c77b;
  background: rgba(52, 199, 123, 0.18);
  color: #34c77b;
}

.mode-btn.erase.active {
  border-color: #ff5b6b;
  background: rgba(255, 91, 107, 0.18);
  color: #ff5b6b;
}

.params-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 12px;
}

.check-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.instances {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.instances label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px;
  border-radius: 6px;
  cursor: pointer;
}

.instances label:hover {
  background: var(--bg-hover);
}

.conf {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.slider {
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.slider.compact {
  gap: 2px;
}

.slider span {
  display: flex;
  justify-content: space-between;
}

.slider b {
  font-weight: 600;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.row .hint {
  margin-right: auto;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.apply-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

button {
  padding: 6px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 13px;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: var(--bg-hover);
}

button.primary {
  border-color: transparent;
  background: var(--accent);
  color: var(--on-accent);
}

button.primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
