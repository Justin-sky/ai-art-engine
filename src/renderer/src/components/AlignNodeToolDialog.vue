<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('align.title')"
    :z-index="1200"
    :default-width="1060"
    :default-height="740"
    :min-width="780"
    :min-height="540"
    body-class="pad-none align-body"
    @close="emit('close')"
  >
    <div v-if="open" class="align">
      <section class="pane">
        <div class="pane-head">
          <div class="section-label">
            {{ t('align.source') }}
          </div>
          <label class="guide-toggle">
            <input v-model="showGuides" type="checkbox" />
            <span>{{ t('align.showGuides') }}</span>
          </label>
        </div>
        <div class="stage" :class="`bg-${backdrop}`">
          <div v-if="ready && sourceUrl" class="img-box">
            <img :src="sourceUrl" alt="" crossorigin="anonymous" draggable="false" />
            <svg
              v-if="showGuides && lastPlan"
              class="hud-svg"
              :viewBox="`0 0 ${lastPlan.srcWidth} ${lastPlan.srcHeight}`"
              preserveAspectRatio="none"
            >
              <rect
                :x="lastPlan.bounds.x"
                :y="lastPlan.bounds.y"
                :width="lastPlan.bounds.width"
                :height="lastPlan.bounds.height"
                class="bounds-rect"
              />
            </svg>
          </div>
          <p v-else-if="sourceLoading || !sourceUrl" class="hint">
            {{ sourceLoading ? t('align.loadingSource') : t('align.noSource') }}
          </p>
        </div>
        <p v-if="lastPlan" class="apply-hint">
          {{ lastPlan.srcWidth }}×{{ lastPlan.srcHeight }} → Bounds ({{ lastPlan.bounds.x }},
          {{ lastPlan.bounds.y }}, {{ lastPlan.bounds.width }}×{{ lastPlan.bounds.height }})
        </p>
        <p class="apply-hint">
          {{ t('align.sourceHint') }}
        </p>

        <div class="pane-head">
          <div class="section-label">
            {{ t('align.result') }}
          </div>
          <div class="backdrop-group">
            <button
              type="button"
              class="mini-btn"
              :class="{ active: tilePreview2x2 }"
              @click="tilePreview2x2 = !tilePreview2x2"
            >
              {{ t('align.tilePreview2x2') }}
            </button>
            <button
              type="button"
              class="mini-btn"
              :class="{ active: backdrop === 'checker' }"
              @click="backdrop = 'checker'"
            >
              {{ t('graph.anim2d.backdropChecker') }}
            </button>
            <button
              type="button"
              class="mini-btn"
              :class="{ active: backdrop === 'dark' }"
              @click="backdrop = 'dark'"
            >
              {{ t('graph.anim2d.backdropDark') }}
            </button>
            <button
              type="button"
              class="mini-btn"
              :class="{ active: backdrop === 'light' }"
              @click="backdrop = 'light'"
            >
              {{ t('graph.anim2d.backdropLight') }}
            </button>
          </div>
        </div>
        <div
          class="stage result-stage"
          :class="`bg-${backdrop}`"
          @pointerdown="onResultPointerDown"
          @pointermove="onResultPointerMove"
          @pointerup="onResultPointerUp"
          @pointercancel="onResultPointerUp"
        >
          <div v-if="resultUrl && tilePreview2x2" class="tile-2x2-box">
            <img v-for="i in 4" :key="i" :src="resultUrl" alt="" draggable="false" />
          </div>
          <div v-else-if="resultUrl" class="img-box">
            <img :src="resultUrl" alt="" draggable="false" />
            <svg
              v-if="showGuides && lastPlan"
              class="hud-svg"
              :viewBox="`0 0 ${lastPlan.canvasWidth} ${lastPlan.canvasHeight}`"
              preserveAspectRatio="none"
            >
              <!-- 中心十字线 -->
              <line
                :x1="lastPlan.canvasWidth / 2"
                y1="0"
                :x2="lastPlan.canvasWidth / 2"
                :y2="lastPlan.canvasHeight"
                class="center-line"
              />
              <line
                v-if="anchor === 'center'"
                x1="0"
                :y1="lastPlan.canvasHeight / 2"
                :x2="lastPlan.canvasWidth"
                :y2="lastPlan.canvasHeight / 2"
                class="center-line"
              />
              <!-- 地面基线 -->
              <line
                v-if="anchor === 'ground' && lastPlan.groundY >= 0"
                x1="0"
                :y1="lastPlan.groundY"
                :x2="lastPlan.canvasWidth"
                :y2="lastPlan.groundY"
                class="ground-line"
              />
              <!-- 9-Slice 九宫格拉伸参考线 -->
              <template v-if="nineSlice > 0">
                <line
                  :x1="nineSlice"
                  y1="0"
                  :x2="nineSlice"
                  :y2="lastPlan.canvasHeight"
                  class="nine-slice-line"
                />
                <line
                  :x1="Math.max(0, lastPlan.canvasWidth - nineSlice)"
                  y1="0"
                  :x2="Math.max(0, lastPlan.canvasWidth - nineSlice)"
                  :y2="lastPlan.canvasHeight"
                  class="nine-slice-line"
                />
                <line
                  x1="0"
                  :y1="nineSlice"
                  :x2="lastPlan.canvasWidth"
                  :y2="nineSlice"
                  class="nine-slice-line"
                />
                <line
                  x1="0"
                  :y1="Math.max(0, lastPlan.canvasHeight - nineSlice)"
                  :x2="lastPlan.canvasWidth"
                  :y2="Math.max(0, lastPlan.canvasHeight - nineSlice)"
                  class="nine-slice-line"
                />
              </template>
              <!-- 目标放置矩形 -->
              <rect
                :x="lastPlan.dstX"
                :y="lastPlan.dstY"
                :width="lastPlan.dstW"
                :height="lastPlan.dstH"
                class="dst-rect"
              />
              <!-- 锚点枢轴圆点 -->
              <circle
                :cx="lastPlan.anchorX"
                :cy="lastPlan.anchorY"
                :r="
                  Math.max(
                    4,
                    Math.round(Math.min(lastPlan.canvasWidth, lastPlan.canvasHeight) * 0.012)
                  )
                "
                class="pivot-dot"
              />
            </svg>
          </div>
          <p v-else class="hint">
            {{ t('align.resultEmpty') }}
          </p>
        </div>
        <!-- 引擎就绪资产体检条（AssetQcReport） -->
        <div v-if="qcReport && resultUrl" class="qc-bar">
          <span v-if="!qcReport.issues.length" class="qc-pill ok">
            ✓ {{ t('align.qcReady') }}
          </span>
          <template v-else>
            <span
              v-for="issue in qcReport.issues"
              :key="issue.code"
              class="qc-pill"
              :class="issue.severity"
            >
              ⚠ {{ t(`align.qcIssue.${issue.code}`) }}
            </span>
            <button
              v-if="hasFixableFringe && !defringe"
              type="button"
              class="mini-btn fix-btn"
              @click="defringe = true"
            >
              ✨ {{ t('align.qcAutoFix') }}
            </button>
          </template>
        </div>
      </section>

      <section class="pane controls-pane">
        <div class="section-label">
          {{ t('align.sizePresets') }}
        </div>
        <div class="chip-grid">
          <button
            v-for="preset in IMAGE_ALIGN_SIZE_PRESETS"
            :key="preset.id"
            type="button"
            class="chip"
            :class="{
              active: canvasWidth === preset.width && canvasHeight === preset.height
            }"
            @click="applySizePreset(preset.width, preset.height)"
          >
            {{ preset.label }}
          </button>
        </div>

        <div class="section-label">
          {{ t('align.params') }}
        </div>
        <div class="grid2">
          <label class="field">
            <span>{{ t('graph.align.canvasWidth') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="canvasWidth"
              @change="patchCanvas('canvasWidth', $event)"
            />
          </label>
          <label class="field">
            <span>{{ t('graph.align.canvasHeight') }}</span>
            <input
              type="number"
              min="16"
              max="8192"
              step="16"
              :value="canvasHeight"
              @change="patchCanvas('canvasHeight', $event)"
            />
          </label>
        </div>

        <label class="field">
          <span>{{ t('graph.align.anchor') }}</span>
          <select :value="anchor" @change="patchAnchor($event)">
            <option value="ground">
              {{ t('graph.align.anchorGround') }}
            </option>
            <option value="center">
              {{ t('graph.align.anchorCenter') }}
            </option>
          </select>
        </label>

        <label class="slider">
          <span>
            {{ t('graph.align.subjectHeight') }}<b>{{ Math.round(contentHeightRatio * 100) }}%</b>
          </span>
          <input v-model.number="contentHeightRatio" type="range" min="0.1" max="1" step="0.02" />
        </label>

        <label v-if="anchor === 'ground'" class="slider">
          <span>
            {{ t('graph.align.groundGap') }}<b>{{ Math.round(groundRatio * 100) }}%</b>
          </span>
          <input v-model.number="groundRatio" type="range" min="0" max="0.5" step="0.01" />
        </label>

        <label class="check">
          <input v-model="fitWithinWidth" type="checkbox" />
          <span>{{ t('graph.align.fitWidth') }}</span>
        </label>

        <label class="field">
          <span>{{ t('align.bgKey') }}</span>
          <select v-model="bgKey">
            <option value="">{{ t('align.bgKeyNone') }}</option>
            <option value="auto">{{ t('align.bgKeyAuto') }}</option>
            <option value="black">{{ t('align.bgKeyBlack') }}</option>
            <option value="white">{{ t('align.bgKeyWhite') }}</option>
          </select>
        </label>

        <label v-if="bgKey" class="slider">
          <span>
            {{ t('align.bgThreshold') }}<b>{{ bgThreshold }}</b>
          </span>
          <input v-model.number="bgThreshold" type="range" min="5" max="160" step="1" />
        </label>

        <label class="check">
          <input v-model="defringe" type="checkbox" />
          <span>{{ t('align.defringe') }}</span>
        </label>

        <label class="check">
          <input v-model="tileSeamless" type="checkbox" @change="onTileToggle" />
          <span>{{ t('align.tileSeamless') }}</span>
        </label>

        <label v-if="tileSeamless" class="slider">
          <span>
            {{ t('align.tileBlendRatio') }}<b>{{ Math.round(tileBlendRatio * 100) }}%</b>
          </span>
          <input v-model.number="tileBlendRatio" type="range" min="0.05" max="0.35" step="0.01" />
        </label>

        <label class="slider">
          <span>
            {{ t('align.nineSlice') }}<b>{{ nineSlice }}px</b>
          </span>
          <input v-model.number="nineSlice" type="range" min="0" max="256" step="4" />
        </label>

        <label class="check">
          <input v-model="flipX" type="checkbox" />
          <span>{{ t('align.flipX') }}</span>
        </label>

        <div class="grid2">
          <label class="field">
            <span>{{ t('align.offsetX') }}</span>
            <input v-model.number="offsetX" type="number" step="1" />
          </label>
          <label class="field">
            <span>{{ t('align.offsetY') }}</span>
            <input v-model.number="offsetY" type="number" step="1" />
          </label>
        </div>

        <button v-if="offsetX !== 0 || offsetY !== 0" type="button" @click="resetOffset">
          {{ t('align.resetOffset') }}
        </button>

        <div class="row footer-row">
          <span v-if="resultUrl && lastPlan" class="hint">
            {{ resultWidth }}×{{ resultHeight }} · Pivot ({{ lastPlan.anchorX }},
            {{ lastPlan.anchorY }})
          </span>
          <button type="button" class="primary" :disabled="!resultUrl || !ready" @click="save">
            {{ t('align.apply') }}
          </button>
        </div>
        <p v-if="error" class="error">
          {{ error }}
        </p>
        <p class="apply-hint">
          {{ t('align.applyHint') }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  IMAGE_ALIGN_SIZE_PRESETS,
  normalizeImageAlign,
  type ImageAlignBgKey,
  type ImageAlignState
} from '@shared/graph'
import type { AssetQcReport, SpriteAlignPlan } from '@shared/gameAssets'
import { useStudioI18n } from '../composables/useStudioI18n'
import { composeImageAlignCanvas } from '../features/graph/model/composeImageAlignCanvas'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const props = defineProps<{
  open: boolean
  setup?: ImageAlignState | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  save: [payload: { imageAlign: ImageAlignState; dataUrl?: string }]
}>()

const { t } = useStudioI18n()

const ready = computed(() => props.open && !!props.sourceUrl && !props.sourceLoading)

const canvasWidth = ref(1024)
const canvasHeight = ref(1024)
const anchor = ref<'center' | 'ground'>('ground')
const contentHeightRatio = ref(0.9)
const groundRatio = ref(0.06)
const fitWithinWidth = ref(true)
const offsetX = ref(0)
const offsetY = ref(0)
const flipX = ref(false)
const bgKey = ref<ImageAlignBgKey>('')
const bgThreshold = ref(42)
const defringe = ref(false)
const tileSeamless = ref(false)
const tileBlendRatio = ref(0.15)
const nineSlice = ref(0)

const showGuides = ref(true)
const tilePreview2x2 = ref(false)
const backdrop = ref<'checker' | 'dark' | 'light'>('checker')

const resultUrl = ref('')
const resultWidth = ref(0)
const resultHeight = ref(0)
const lastPlan = ref<SpriteAlignPlan | null>(null)
const qcReport = ref<AssetQcReport | null>(null)
const error = ref('')
let renderToken = 0
let renderTimer: ReturnType<typeof setTimeout> | null = null

const hasFixableFringe = computed(
  () => qcReport.value?.issues.some((i) => i.code === 'edge-fringe') ?? false
)

function applySetup(): void {
  const s = props.setup
  canvasWidth.value = s?.canvasWidth ?? 1024
  canvasHeight.value = s?.canvasHeight ?? 1024
  anchor.value = s?.anchor ?? 'ground'
  contentHeightRatio.value = s?.contentHeightRatio ?? 0.9
  groundRatio.value = s?.groundRatio ?? 0.06
  fitWithinWidth.value = s?.fitWithinWidth ?? true
  offsetX.value = s?.offsetX ?? 0
  offsetY.value = s?.offsetY ?? 0
  flipX.value = s?.flipX ?? false
  bgKey.value = s?.bgKey ?? ''
  bgThreshold.value = s?.bgThreshold ?? 42
  defringe.value = s?.defringe ?? false
  tileSeamless.value = s?.tileSeamless ?? false
  tileBlendRatio.value = s?.tileBlendRatio ?? 0.15
  nineSlice.value = s?.nineSlice ?? 0
  tilePreview2x2.value = Boolean(s?.tileSeamless)
}

function buildState(): ImageAlignState {
  return normalizeImageAlign({
    canvasWidth: canvasWidth.value,
    canvasHeight: canvasHeight.value,
    anchor: anchor.value,
    contentHeightRatio: contentHeightRatio.value,
    groundRatio: groundRatio.value,
    fitWithinWidth: fitWithinWidth.value,
    offsetX: offsetX.value,
    offsetY: offsetY.value,
    flipX: flipX.value,
    bgKey: bgKey.value,
    bgThreshold: bgThreshold.value,
    defringe: defringe.value,
    tileSeamless: tileSeamless.value,
    tileBlendRatio: tileBlendRatio.value,
    nineSlice: nineSlice.value
  })
}

function onTileToggle(): void {
  if (tileSeamless.value) {
    anchor.value = 'center'
    contentHeightRatio.value = 1
    tilePreview2x2.value = true
  }
}

function applySizePreset(width: number, height: number): void {
  canvasWidth.value = width
  canvasHeight.value = height
}

function patchCanvas(key: 'canvasWidth' | 'canvasHeight', event: Event): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const clamped = Math.min(8192, Math.max(16, Math.round(raw)))
  if (key === 'canvasWidth') canvasWidth.value = clamped
  else canvasHeight.value = clamped
}

function patchAnchor(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  anchor.value = value === 'center' ? 'center' : 'ground'
}

function resetOffset(): void {
  offsetX.value = 0
  offsetY.value = 0
}

let draggingOffset = false
let dragStartX = 0
let dragStartY = 0
let startOffsetX = 0
let startOffsetY = 0

function onResultPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !resultUrl.value) return
  draggingOffset = true
  dragStartX = event.clientX
  dragStartY = event.clientY
  startOffsetX = offsetX.value
  startOffsetY = offsetY.value
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
}

function onResultPointerMove(event: PointerEvent): void {
  if (!draggingOffset) return
  const el = event.currentTarget as HTMLElement
  const rect = el.getBoundingClientRect()
  const scale = Math.max(1, canvasWidth.value / Math.max(1, rect.width))
  const dx = Math.round((event.clientX - dragStartX) * scale)
  const dy = Math.round((event.clientY - dragStartY) * scale)
  offsetX.value = startOffsetX + dx
  offsetY.value = startOffsetY + dy
}

function onResultPointerUp(event: PointerEvent): void {
  if (!draggingOffset) return
  draggingOffset = false
  ;(event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId)
}

async function render(): Promise<void> {
  const url = props.sourceUrl?.trim()
  if (!url) {
    resultUrl.value = ''
    resultWidth.value = 0
    resultHeight.value = 0
    lastPlan.value = null
    qcReport.value = null
    error.value = ''
    return
  }
  const token = ++renderToken
  try {
    const out = await composeImageAlignCanvas({ sourceDataUrl: url, state: buildState() })
    if (token !== renderToken) return
    resultUrl.value = out.dataUrl
    resultWidth.value = out.width
    resultHeight.value = out.height
    lastPlan.value = out.plan
    qcReport.value = out.qcReport
    error.value = ''
  } catch (err) {
    if (token !== renderToken) return
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function reset(): void {
  if (renderTimer) {
    clearTimeout(renderTimer)
    renderTimer = null
  }
  resultUrl.value = ''
  resultWidth.value = 0
  resultHeight.value = 0
  lastPlan.value = null
  qcReport.value = null
  error.value = ''
}

function save(): void {
  if (!resultUrl.value) {
    error.value = t('align.resultEmpty')
    return
  }
  emit('save', {
    imageAlign: buildState(),
    dataUrl: resultUrl.value
  })
}

watch(
  ready,
  (ok) => {
    if (!props.open) {
      reset()
      return
    }
    if (!ok) return
    applySetup()
    void render()
  },
  { immediate: true }
)

watch(
  [
    canvasWidth,
    canvasHeight,
    anchor,
    contentHeightRatio,
    groundRatio,
    fitWithinWidth,
    offsetX,
    offsetY,
    flipX,
    bgKey,
    bgThreshold,
    defringe,
    tileSeamless,
    tileBlendRatio,
    nineSlice
  ],
  () => {
    if (!ready.value) return
    if (renderTimer) clearTimeout(renderTimer)
    renderTimer = setTimeout(() => {
      renderTimer = null
      void render()
    }, 90)
  }
)
</script>

<style scoped>
.align {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
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

.controls-pane {
  overflow-y: auto;
  padding-right: 4px;
}

.pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.section-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.guide-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}

.backdrop-group {
  display: flex;
  gap: 4px;
}

.mini-btn {
  padding: 2px 8px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.mini-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}

.stage {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 200px;
  max-height: 280px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  padding: 8px;
}

.result-stage {
  min-height: 250px;
  max-height: 320px;
  cursor: grab;
  touch-action: none;
}

.result-stage:active {
  cursor: grabbing;
}

.img-box {
  position: relative;
  display: inline-flex;
  max-width: 100%;
  max-height: 100%;
}

.img-box img {
  display: block;
  max-width: 100%;
  max-height: 270px;
  object-fit: contain;
  user-select: none;
}

.hud-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.bounds-rect {
  fill: rgba(56, 189, 248, 0.08);
  stroke: #38bdf8;
  stroke-width: 2;
  stroke-dasharray: 6 4;
  vector-effect: non-scaling-stroke;
}

.dst-rect {
  fill: rgba(34, 197, 94, 0.06);
  stroke: #22c55e;
  stroke-width: 1.5;
  stroke-dasharray: 5 3;
  vector-effect: non-scaling-stroke;
}

.center-line {
  stroke: rgba(56, 189, 248, 0.55);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  vector-effect: non-scaling-stroke;
}

.ground-line {
  stroke: #facc15;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.nine-slice-line {
  stroke: #a855f7;
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
}

.pivot-dot {
  fill: #ef4444;
  stroke: #ffffff;
  stroke-width: 2;
  vector-effect: non-scaling-stroke;
}

.tile-2x2-box {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  max-width: 270px;
  max-height: 270px;
  border: 1px solid var(--border);
}

.tile-2x2-box img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  user-select: none;
}

.qc-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.qc-pill {
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
}

.qc-pill.ok {
  background: color-mix(in srgb, #22c55e 16%, transparent);
  color: #22c55e;
}

.qc-pill.warn,
.qc-pill.info {
  background: color-mix(in srgb, #f59e0b 16%, transparent);
  color: #f59e0b;
}

.qc-pill.error {
  background: color-mix(in srgb, var(--danger) 16%, transparent);
  color: var(--danger);
}

.fix-btn {
  border-color: var(--accent);
  color: var(--accent);
  font-weight: 600;
}

.bg-checker {
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

.bg-dark {
  background: #121316;
}

.bg-light {
  background: #f3f4f6;
}

.chip-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 11px;
  cursor: pointer;
}

.chip.active {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--on-accent);
}

.grid2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.field input[type='number'] {
  width: 84px;
}

.field select {
  min-width: 140px;
}

.slider {
  display: grid;
  gap: 4px;
  font-size: 12px;
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
  cursor: pointer;
}

.row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.footer-row {
  margin-top: auto;
  padding-top: 8px;
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
  font-size: 12px;
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
