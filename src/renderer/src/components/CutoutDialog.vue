<template>
  <StudioFloatingWindow
    :open="state.open"
    :title="t('cutout.title')"
    :z-index="2200"
    :default-width="1040"
    :default-height="780"
    :min-width="760"
    :min-height="560"
    body-class="pad-none cutout-body"
    @close="closeCutoutDialog"
  >
    <div v-if="state.open" class="cutout">
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
            paintable: brushMode !== 'off' && !!state.url,
            pannable: brushMode === 'off' && stageZoom > 1.01
          }"
          @wheel.prevent="onStageWheel"
          @pointerdown="onStagePointerDown($event, 'source')"
          @pointermove="onStagePointerMove($event, 'source')"
          @pointerup="onStagePointerUp"
          @pointercancel="onStagePointerUp"
          @pointerleave="onStagePointerLeave('source')"
        >
          <div v-if="state.url" class="stage-canvas-wrap" :style="stageTransformStyle">
            <img ref="sourceImgRef" :src="state.url" alt="" draggable="false" />
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
          <p v-else class="hint">
            {{ t('cutout.noSource') }}
          </p>
        </div>

        <div class="row">
          <button type="button" class="primary" :disabled="busy || !state.url" @click="analyze">
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
          <div class="result-head-actions">
            <button
              type="button"
              class="tool-chip erase"
              :class="{ active: brushMode === 'erase' }"
              @click="brushMode = brushMode === 'erase' ? 'off' : 'erase'"
            >
              {{ t('cutout.resultEraser') }}
            </button>
            <button
              type="button"
              class="tool-chip keep"
              :class="{ active: brushMode === 'keep' }"
              @click="brushMode = brushMode === 'keep' ? 'off' : 'keep'"
            >
              {{ t('cutout.resultKeep') }}
            </button>
            <button
              v-if="brushStrokes.length > 0"
              type="button"
              class="tool-chip"
              @click="undoBrushStroke"
            >
              {{ t('cutout.brushUndo') }}
            </button>
            <button
              v-if="brushStrokes.length > 0"
              type="button"
              class="tool-chip"
              @click="clearBrushStrokes"
            >
              {{ t('cutout.brushClear', { n: brushStrokes.length }) }}
            </button>
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
        </div>
        <div v-if="brushMode !== 'off'" class="result-brush-size">
          <span
            >{{ t('cutout.brushSize') }} <b>{{ brushSizePx }}px</b></span
          >
          <input v-model.number="brushSizePx" type="range" min="4" max="72" step="2" />
        </div>
        <div
          class="stage"
          :class="[
            `bg-${previewBackdrop}`,
            {
              paintable: brushMode !== 'off' && hasResult,
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
          <div v-show="hasResult" class="stage-canvas-wrap" :style="stageTransformStyle">
            <canvas ref="resultCanvasEl" class="result-canvas" />
            <svg
              v-if="hoverStage === 'result' && brushMode !== 'off' && resultCursorNorm"
              class="brush-overlay"
              viewBox="0 0 1000 1000"
              preserveAspectRatio="none"
            >
              <circle
                :cx="resultCursorNorm.x * 1000"
                :cy="resultCursorNorm.y * 1000"
                :r="resultStrokeWidth(normalizedBrushRadius) / 2"
                :class="['brush-cursor', brushMode]"
              />
            </svg>
          </div>
          <p v-if="!hasResult" class="hint">
            {{ t('cutout.resultEmpty') }}
          </p>
        </div>
        <div class="row">
          <span v-if="hasResult" class="hint">{{ resultWidth }}×{{ resultHeight }}</span>
          <button type="button" class="primary" :disabled="!hasResult || saving" @click="save">
            {{ saving ? t('cutout.saving') : t('cutout.save') }}
          </button>
        </div>
        <p v-if="error" class="error">
          {{ error }}
        </p>
      </section>
    </div>
  </StudioFloatingWindow>

  <SaveAssetDialog
    ref="saveAssetRef"
    :open="saveAssetOpen"
    :default-name="saveAssetDefaultName"
    :title="t('cutout.saveToTitle')"
    :subtitle="t('cutout.saveToSubtitle')"
    :z-index="2400"
    @confirm="onSaveToLibraryConfirm"
    @cancel="saveAssetOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue'
import { resolveCacheOutputRoot } from '@shared/domain'
import type { CutoutBrushPoint, CutoutBrushStroke, CutoutRegion } from '@shared/yoloCutout'
import { useStudioI18n } from '../composables/useStudioI18n'
import { closeCutoutDialog, cutoutDialogState } from '../features/yolo/cutoutDialog'
import {
  analyzeCutout,
  buildCutoutInteractiveSession,
  replayStrokesOnSession,
  stampSegmentOnSession,
  type CutoutAnalysis,
  type CutoutInteractiveSession
} from '../features/yolo/cutout'
import { useProjectStore } from '../stores/project'
import SaveAssetDialog from './SaveAssetDialog.vue'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

const { t } = useStudioI18n()
const state = cutoutDialogState
const project = useProjectStore()

const analysis = ref<CutoutAnalysis | null>(null)
const image = ref<HTMLImageElement | null>(null)
const selected = ref<number[]>([])
const detectConf = ref(0.25)
const threshold = ref(0.5)
const feather = ref(0)
const edgeGuidedRadius = ref(4)
const edgeChoke = ref(0)
const holePunch = ref(true)
const cropToSubject = ref(true)

const brushMode = ref<'off' | 'keep' | 'erase'>('off')
const brushSizePx = ref(20)
const brushStrokes = ref<CutoutBrushStroke[]>([])
const activeStroke = shallowRef<CutoutBrushStroke | null>(null)
let activePoints: CutoutBrushPoint[] = []
const hoverStage = ref<'source' | 'result' | null>(null)
const cursorNorm = shallowRef<CutoutBrushPoint | null>(null)
const resultCursorNorm = shallowRef<CutoutBrushPoint | null>(null)
const sourceImgRef = ref<HTMLImageElement | null>(null)
const resultCanvasEl = ref<HTMLCanvasElement | null>(null)
const currentRegion = ref<CutoutRegion | null>(null)
const previewBackdrop = ref<'checker' | 'dark' | 'light' | 'green'>('checker')
const stageZoom = ref(1)
const stagePan = ref({ x: 0, y: 0 })
let panStart: { clientX: number; clientY: number; panX: number; panY: number } | null = null
let interactiveSession: CutoutInteractiveSession | null = null

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
const saving = ref(false)
const error = ref('')
const saveAssetOpen = ref(false)
const saveAssetDefaultName = ref('')
const saveAssetRef = ref<InstanceType<typeof SaveAssetDialog> | null>(null)
const hasResult = ref(false)
const resultWidth = ref(0)
const resultHeight = ref(0)

const instances = computed(() => analysis.value?.instances ?? [])
const normalizedBrushRadius = computed(() =>
  Math.max(0.004, Math.min(0.18, brushSizePx.value / 640))
)

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

function resultStrokeWidth(radiusNorm: number): number {
  const a = analysis.value
  const reg = currentRegion.value
  if (!a || !reg || reg.width <= 0 || reg.height <= 0) return radiusNorm * 2000
  const shortSide = Math.min(a.srcWidth, a.srcHeight)
  const avgRegSide = (reg.width + reg.height) * 0.5
  return ((radiusNorm * shortSide) / Math.max(1, avgRegSide)) * 2000
}

function mapEventToSourceNorm(
  e: PointerEvent,
  stage: 'source' | 'result'
): { srcNorm: CutoutBrushPoint; resNorm?: CutoutBrushPoint } | null {
  const el = stage === 'source' ? sourceImgRef.value : resultCanvasEl.value
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
  activePoints = [mapped.srcNorm]
  if (stage === 'source') {
    activeStroke.value = {
      mode: brushMode.value,
      radius: normalizedBrushRadius.value,
      points: activePoints
    }
  }
  if (interactiveSession && resultCanvasEl.value) {
    stampSegmentOnSession(
      interactiveSession,
      brushMode.value,
      normalizedBrushRadius.value,
      mapped.srcNorm,
      mapped.srcNorm,
      resultCanvasEl.value
    )
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
  if (activePoints.length === 0) return
  const last = activePoints[activePoints.length - 1]!
  if (Math.hypot(mapped.srcNorm.x - last.x, mapped.srcNorm.y - last.y) >= 0.0015) {
    activePoints.push(mapped.srcNorm)
    if (interactiveSession && resultCanvasEl.value) {
      stampSegmentOnSession(
        interactiveSession,
        brushMode.value,
        normalizedBrushRadius.value,
        last,
        mapped.srcNorm,
        resultCanvasEl.value
      )
    }
    if (stage === 'source') {
      activeStroke.value = {
        mode: brushMode.value,
        radius: normalizedBrushRadius.value,
        points: [...activePoints]
      }
    }
  }
}

function onStagePointerUp(): void {
  if (panStart) {
    panStart = null
    return
  }
  if (activePoints.length === 0 || brushMode.value === 'off') return
  const finished: CutoutBrushStroke = {
    mode: brushMode.value,
    radius: normalizedBrushRadius.value,
    points: activePoints
  }
  activePoints = []
  activeStroke.value = null
  brushStrokes.value = [...brushStrokes.value, finished]
  // 若还未建立基础会话，或用户在裁剪模式下用「+保留」涂抹到了当前裁剪框外部，则重算基础框
  if (!interactiveSession) {
    renderBase()
    return
  }
  if (finished.mode === 'keep' && cropToSubject.value && analysis.value && currentRegion.value) {
    const a = analysis.value
    const reg = currentRegion.value
    const rPx = finished.radius * Math.min(a.srcWidth, a.srcHeight)
    const expanded = finished.points.some((pt) => {
      const px = pt.x * a.srcWidth
      const py = pt.y * a.srcHeight
      return (
        px - rPx < reg.x ||
        py - rPx < reg.y ||
        px + rPx > reg.x + reg.width ||
        py + rPx > reg.y + reg.height
      )
    })
    if (expanded) {
      renderBase()
    }
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
  if (interactiveSession) {
    replayStrokesOnSession(interactiveSession, brushStrokes.value, resultCanvasEl.value)
  } else {
    renderBase()
  }
}

function clearBrushStrokes(): void {
  brushStrokes.value = []
  if (interactiveSession) {
    replayStrokesOnSession(interactiveSession, [], resultCanvasEl.value)
  } else {
    renderBase()
  }
}

function renderBase(): void {
  const a = analysis.value
  const img = image.value
  const hasKeepBrush = brushStrokes.value.some((s) => s.mode === 'keep' && s.points.length > 0)
  if (!a || !img || (selected.value.length === 0 && !hasKeepBrush)) {
    interactiveSession = null
    hasResult.value = false
    return
  }
  try {
    const session = buildCutoutInteractiveSession({
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
    interactiveSession = session
    resultWidth.value = session.width
    resultHeight.value = session.height
    currentRegion.value = session.region
    hasResult.value = true
    const cvs = resultCanvasEl.value
    if (cvs) {
      if (cvs.width !== session.width) cvs.width = session.width
      if (cvs.height !== session.height) cvs.height = session.height
      cvs.getContext('2d')?.putImageData(session.workingImageData, 0, 0)
    }
    error.value = ''
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

async function analyze(): Promise<void> {
  if (!state.url || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const res = await analyzeCutout(
      { url: state.url, relativePath: state.relativePath, name: state.name },
      detectConf.value
    )
    analysis.value = res.analysis
    image.value = res.image
    const mattingInst = res.analysis.instances.find((i) => i.label === 'matting-subject')
    selected.value = mattingInst ? [mattingInst.index] : res.analysis.instances.map((i) => i.index)
    renderBase()
  } catch (err) {
    analysis.value = null
    interactiveSession = null
    hasResult.value = false
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    busy.value = false
  }
}

/** 点「保存到资产库」：先弹出选择目标文件夹与命名对话框 */
function save(): void {
  if (saving.value) return
  if (!hasResult.value || !resultCanvasEl.value) {
    error.value = t('cutout.resultEmpty')
    return
  }
  error.value = ''
  saveAssetDefaultName.value = `${state.name || 'cutout'}-cutout`
  saveAssetOpen.value = true
}

/**
 * 保存对话框确认：先把结果 data URL 落到 Cache 临时文件（不进资产库），
 * 再交由 saveProjectAsset 复制到用户所选文件夹并登记为资产。
 */
async function onSaveToLibraryConfirm(payload: {
  name: string
  folderId: string | null
}): Promise<void> {
  if (saving.value || !resultCanvasEl.value) return
  saving.value = true
  error.value = ''
  saveAssetRef.value?.setSaving(true)
  try {
    const dataUrl = resultCanvasEl.value.toDataURL('image/png')
    const cacheRoot = resolveCacheOutputRoot(project.config?.cacheOutputDir)
    const tmpRel = await window.studio.saveGraphRunMedia({
      dataUrl,
      key: `cutout-${Date.now()}`,
      outputDir: `${cacheRoot}/Cutouts`
    })
    console.log('[cutout] staged to', tmpRel)
    if (!(await window.studio.projectFileExists(tmpRel))) {
      const name = tmpRel.split('/').pop() || tmpRel
      saveAssetRef.value?.setSourceMissing(tmpRel)
      saveAssetRef.value?.setError(t('dialog.saveAsset.sourceMissing', { name }))
      return
    }
    await window.studio.saveProjectAsset({
      relativePath: tmpRel,
      name: payload.name,
      folderId: payload.folderId
    })
    await project.scheduleRefreshLibrary()
    saveAssetOpen.value = false
    closeCutoutDialog()
  } catch (err) {
    saveAssetRef.value?.setError(err instanceof Error ? err.message : String(err))
    console.error('[cutout] save failed', err)
  } finally {
    saving.value = false
  }
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
  activePoints = []
  activeStroke.value = null
  brushMode.value = 'off'
  currentRegion.value = null
  interactiveSession = null
  resetView()
  hasResult.value = false
  resultWidth.value = 0
  resultHeight.value = 0
  saveAssetOpen.value = false
  error.value = ''
}

watch(
  () => state.open,
  (open) => {
    if (!open) {
      reset()
      return
    }
    void analyze()
  }
)

let renderTimer: ReturnType<typeof setTimeout> | null = null
watch([threshold, feather, edgeGuidedRadius, edgeChoke, holePunch, cropToSubject, selected], () => {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
    renderBase()
  }, 60)
})
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

.stage img,
.stage .result-canvas {
  display: block;
  max-width: 100%;
  max-height: 308px;
  width: auto;
  height: auto;
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

.result-head-actions {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-chip {
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 6px;
}

.tool-chip.erase.active {
  border-color: #ff5b6b;
  background: rgba(255, 91, 107, 0.2);
  color: #ff5b6b;
  font-weight: 600;
}

.tool-chip.keep.active {
  border-color: #34c77b;
  background: rgba(52, 199, 123, 0.2);
  color: #34c77b;
  font-weight: 600;
}

.result-brush-size {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.result-brush-size input[type='range'] {
  flex: 1;
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
