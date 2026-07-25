<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="780"
    :default-height="640"
    :min-width="560"
    :min-height="420"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="topbar">
        <div class="tools">
          <button
            type="button"
            class="tool-btn"
            :class="{ active: tool === 'brush' }"
            :title="t(`${i18nRoot}.tools.brush`)"
            @click="tool = 'brush'"
          >
            <span class="ico" aria-hidden="true">✏️</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            :class="{ active: tool === 'rect' }"
            :title="t(`${i18nRoot}.tools.rect`)"
            @click="tool = 'rect'"
          >
            <span class="ico" aria-hidden="true">▢</span>
          </button>
          <button
            type="button"
            class="tool-btn"
            :class="{ active: tool === 'eraser' }"
            :title="t(`${i18nRoot}.tools.eraser`)"
            @click="tool = 'eraser'"
          >
            <span class="ico" aria-hidden="true">🧹</span>
          </button>
          <div class="brush-size" :title="t(`${i18nRoot}.brushSize`)">
            <span class="brush-ico" aria-hidden="true">〰️</span>
            <input
              v-model.number="draft.brushSize"
              class="brush-range"
              type="range"
              min="4"
              max="120"
              step="1"
            />
          </div>
        </div>
        <div class="history">
          <button
            type="button"
            class="tool-btn"
            :disabled="!canUndo"
            :title="t(`${i18nRoot}.undo`)"
            @click="undo"
          >
            ↶
          </button>
          <button
            type="button"
            class="tool-btn"
            :disabled="!canRedo"
            :title="t(`${i18nRoot}.redo`)"
            @click="redo"
          >
            ↷
          </button>
        </div>
      </div>

      <div class="stage" ref="stageEl">
        <div v-if="sourceLoading" class="stage-empty">{{ t('graph.editor.loadingSource') }}</div>
        <div v-else-if="!sourceUrl" class="stage-empty">{{ t(`${i18nRoot}.noSource`) }}</div>
        <div
          v-else
          class="canvas-wrap"
          :class="{ 'canvas-wrap-matte': mode === 'matte' }"
          :style="canvasWrapStyle"
        >
          <img
            class="source-img"
            :src="sourceUrl"
            alt=""
            draggable="false"
            decoding="async"
          />
          <canvas
            ref="overlayEl"
            class="overlay-canvas"
            :width="canvasSize.w"
            :height="canvasSize.h"
            @pointerdown="onPaintPointerDown"
          />
          <div
            v-if="rectPreview"
            class="rect-preview"
            :style="rectPreviewStyle"
          />
        </div>
      </div>

      <div class="bottom">
        <textarea
          v-model="draft.prompt"
          class="prompt"
          rows="2"
          :placeholder="t(`${i18nRoot}.promptPlaceholder`)"
        />
        <div class="toolbar">
          <label class="tool tool-model">
            <span class="tool-label">{{ t('graph.inspector.generate.imageModel') }}</span>
            <select v-model="selectionKey" class="select" @change="onModelChange">
              <option v-for="opt in modelOptions" :key="opt.key" :value="opt.key">
                {{ opt.label }}
              </option>
              <option v-if="modelOptions.length === 0" value="">
                {{ t('graph.inspector.generate.noModels') }}
              </option>
            </select>
          </label>
          <label class="tool">
            <span class="tool-label">{{ t(`${i18nRoot}.aspect`) }}</span>
            <select v-model="draft.aspectId" class="select">
              <option value="original">{{ t(`${i18nRoot}.aspects.original`) }}</option>
              <option v-for="ratio in aspectOptions" :key="ratio" :value="ratio">
                {{ ratio }}
              </option>
            </select>
          </label>
          <label class="tool">
            <span class="tool-label">{{ t(`${i18nRoot}.resolution`) }}</span>
            <select v-model="draft.resolution" class="select">
              <option v-for="r in resolutionOptions" :key="r" :value="r">{{ r }}</option>
            </select>
          </label>
          <label class="tool">
            <span class="tool-label">{{ t(`${i18nRoot}.count`) }}</span>
            <select v-model.number="draft.count" class="select">
              <option v-for="c in countOptions" :key="c" :value="c">
                {{ t(`${i18nRoot}.countOption`, { n: c }) }}
              </option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  REDRAW_FALLBACK_COUNTS,
  REDRAW_FALLBACK_RESOLUTIONS,
  clampRedrawParamsToCapabilities,
  imageEraseToNodePatch,
  imageMatteToNodePatch,
  imageRedrawToNodePatch,
  normalizeImageRedraw,
  normalizeRedrawBrushSize,
  type ImageRedrawState,
  type RedrawTool
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { loadImageGenerateCapabilities } from '../features/graph/model/imageGenerateCapabilities'
import {
  loadGenerateModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export type MaskEditMode = 'redraw' | 'erase' | 'matte'

export type RedrawEditorSavePayload =
  | (ReturnType<typeof imageRedrawToNodePatch> & {
      generateModel: string
      generateProviderInstanceId: string
    })
  | (ReturnType<typeof imageEraseToNodePatch> & {
      generateModel: string
      generateProviderInstanceId: string
    })
  | (ReturnType<typeof imageMatteToNodePatch> & {
      generateModel: string
      generateProviderInstanceId: string
    })

const props = withDefaults(
  defineProps<{
    open: boolean
    mode?: MaskEditMode
    setup?: Partial<ImageRedrawState> | null
    sourceUrl?: string
    sourceLoading?: boolean
    generateModel?: string
    generateProviderInstanceId?: string
  }>(),
  { mode: 'redraw', sourceLoading: false }
)

const emit = defineEmits<{
  close: []
  save: [payload: RedrawEditorSavePayload]
}>()

const { t } = useStudioI18n()
const i18nRoot = computed(() => {
  if (props.mode === 'erase') return 'graph.erase'
  if (props.mode === 'matte') return 'graph.matte'
  return 'graph.redraw'
})
const windowTitle = computed(() => t(`${i18nRoot.value}.appMark`))

const draft = reactive<ImageRedrawState>(normalizeImageRedraw())
const tool = ref<RedrawTool>('brush')
const stageEl = ref<HTMLElement | null>(null)
const overlayEl = ref<HTMLCanvasElement | null>(null)
const sourceNatural = reactive({ w: 1, h: 1 })
const canvasSize = reactive({ w: 1, h: 1 })
const modelOptions = ref<GenerateModelOption[]>([])
const selectionKey = ref('')
const aspectOptions = ref<string[]>([])
const resolutionOptions = ref<string[]>([...REDRAW_FALLBACK_RESOLUTIONS])
const countOptions = ref<number[]>([...REDRAW_FALLBACK_COUNTS])

/** 黑白蒙版（白=重绘） */
let maskCanvas: HTMLCanvasElement | null = null
let maskCtx: CanvasRenderingContext2D | null = null
const undoStack: ImageData[] = []
const redoStack: ImageData[] = []
const canUndo = ref(false)
const canRedo = ref(false)

const rectPreview = ref<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
let painting = false
let lastPt: { x: number; y: number } | null = null

const dirty = computed(() => {
  const a = normalizeImageRedraw(props.setup)
  const b = snapshotState()
  const setupKey = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  return selectionKey.value !== setupKey || JSON.stringify(a) !== JSON.stringify(b)
})

const canvasWrapStyle = computed(() => ({
  width: `${canvasSize.w}px`,
  height: `${canvasSize.h}px`
}))

const rectPreviewStyle = computed(() => {
  const r = rectPreview.value
  if (!r) return {}
  const left = Math.min(r.x0, r.x1)
  const top = Math.min(r.y0, r.y1)
  const width = Math.abs(r.x1 - r.x0)
  const height = Math.abs(r.y1 - r.y0)
  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${width}px`,
    height: `${height}px`
  }
})

function ensureMask(w: number, h: number): void {
  if (!maskCanvas) {
    maskCanvas = document.createElement('canvas')
    maskCtx = maskCanvas.getContext('2d')
  }
  if (!maskCanvas || !maskCtx) return
  if (maskCanvas.width !== w || maskCanvas.height !== h) {
    maskCanvas.width = w
    maskCanvas.height = h
    maskCtx.fillStyle = '#000'
    maskCtx.fillRect(0, 0, w, h)
    undoStack.length = 0
    redoStack.length = 0
    syncHistoryFlags()
  }
}

function syncHistoryFlags(): void {
  canUndo.value = undoStack.length > 0
  canRedo.value = redoStack.length > 0
}

function pushUndo(): void {
  if (!maskCtx || !maskCanvas) return
  undoStack.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height))
  if (undoStack.length > 40) undoStack.shift()
  redoStack.length = 0
  syncHistoryFlags()
}

function refreshOverlay(): void {
  const overlay = overlayEl.value
  if (!overlay || !maskCanvas) return
  const ctx = overlay.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, overlay.width, overlay.height)
  ctx.drawImage(maskCanvas, 0, 0)
  const img = ctx.getImageData(0, 0, overlay.width, overlay.height)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i]!
    if (v > 20) {
      d[i] = 232
      d[i + 1] = 72
      d[i + 2] = 72
      d[i + 3] = Math.round((v / 255) * 150)
    } else {
      d[i + 3] = 0
    }
  }
  ctx.putImageData(img, 0, 0)
}

function exportMaskDataUrl(): string {
  if (!maskCanvas) return ''
  // 若全黑则视为无蒙版
  const ctx = maskCanvas.getContext('2d')
  if (!ctx) return ''
  const data = ctx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data
  let hasWhite = false
  for (let i = 0; i < data.length; i += 4) {
    if (data[i]! > 20) {
      hasWhite = true
      break
    }
  }
  if (!hasWhite) return ''
  return maskCanvas.toDataURL('image/png')
}

function snapshotState(): ImageRedrawState {
  return normalizeImageRedraw({
    ...draft,
    brushSize: normalizeRedrawBrushSize(draft.brushSize),
    maskDataUrl: exportMaskDataUrl()
  })
}

function fitCanvas(): void {
  const stage = stageEl.value
  const ar = sourceNatural.w / Math.max(1, sourceNatural.h)
  const maxW = Math.max(200, (stage?.clientWidth ?? 640) - 24)
  const maxH = Math.max(180, (stage?.clientHeight ?? 360) - 16)
  let w = maxW
  let h = w / ar
  if (h > maxH) {
    h = maxH
    w = h * ar
  }
  canvasSize.w = Math.max(1, Math.round(w))
  canvasSize.h = Math.max(1, Math.round(h))
  ensureMask(canvasSize.w, canvasSize.h)
  nextTick(() => refreshOverlay())
}

async function loadMaskFromDataUrl(url: string): Promise<void> {
  if (!maskCtx || !maskCanvas || !url.startsWith('data:image')) return
  try {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject()
      img.src = url
    })
    maskCtx.fillStyle = '#000'
    maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height)
    maskCtx.drawImage(img, 0, 0, maskCanvas.width, maskCanvas.height)
    refreshOverlay()
  } catch {
    /* ignore */
  }
}

watch(
  () =>
    [props.open, props.setup, props.sourceUrl, props.generateModel, props.generateProviderInstanceId] as const,
  async ([open]) => {
    if (!open) return
    Object.assign(draft, normalizeImageRedraw(props.setup))
    tool.value = 'brush'
    // 模型列表不挡首屏；无源图时跳过 fit/mask，等 sourceUrl 到位再算
    void reloadModelsAndCaps()
    if (!props.sourceUrl) return
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject()
        img.src = props.sourceUrl!
      })
      sourceNatural.w = img.naturalWidth || 1
      sourceNatural.h = img.naturalHeight || 1
    } catch {
      sourceNatural.w = 1
      sourceNatural.h = 1
    }
    fitCanvas()
    await nextTick()
    if (draft.maskDataUrl) await loadMaskFromDataUrl(draft.maskDataUrl)
  },
  { immediate: true, deep: true }
)

async function reloadModelsAndCaps(): Promise<void> {
  const preferred = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  const { options, selectedKey } = await loadGenerateModelOptions('image', preferred)
  modelOptions.value = options
  selectionKey.value = selectedKey || options[0]?.key || ''
  await refreshCapabilities()
}

async function refreshCapabilities(): Promise<void> {
  const key = selectionKey.value
  if (!key) {
    aspectOptions.value = []
    resolutionOptions.value = [...REDRAW_FALLBACK_RESOLUTIONS]
    countOptions.value = [...REDRAW_FALLBACK_COUNTS]
    Object.assign(
      draft,
      clampRedrawParamsToCapabilities(draft, {
        aspectRatios: [],
        resolutions: resolutionOptions.value,
        counts: countOptions.value
      })
    )
    return
  }
  const caps = await loadImageGenerateCapabilities(key)
  aspectOptions.value = [...caps.aspectRatios]
  resolutionOptions.value =
    caps.resolutions.length > 0 ? [...caps.resolutions] : [...REDRAW_FALLBACK_RESOLUTIONS]
  countOptions.value =
    caps.counts.length > 0 ? [...caps.counts] : [...REDRAW_FALLBACK_COUNTS]
  Object.assign(
    draft,
    clampRedrawParamsToCapabilities(draft, {
      aspectRatios: aspectOptions.value,
      resolutions: resolutionOptions.value,
      counts: countOptions.value
    })
  )
}

async function onModelChange(): Promise<void> {
  await refreshCapabilities()
}

function canvasPoint(ev: PointerEvent): { x: number; y: number } {
  const el = overlayEl.value
  if (!el) return { x: 0, y: 0 }
  const r = el.getBoundingClientRect()
  const x = ((ev.clientX - r.left) / Math.max(1, r.width)) * el.width
  const y = ((ev.clientY - r.top) / Math.max(1, r.height)) * el.height
  return { x, y }
}

function strokeLine(from: { x: number; y: number }, to: { x: number; y: number }): void {
  if (!maskCtx) return
  const size = normalizeRedrawBrushSize(draft.brushSize)
  maskCtx.lineCap = 'round'
  maskCtx.lineJoin = 'round'
  maskCtx.lineWidth = size
  maskCtx.globalCompositeOperation = 'source-over'
  maskCtx.strokeStyle = tool.value === 'eraser' ? '#000' : '#fff'
  maskCtx.beginPath()
  maskCtx.moveTo(from.x, from.y)
  maskCtx.lineTo(to.x, to.y)
  maskCtx.stroke()
}

function fillRectMask(x0: number, y0: number, x1: number, y1: number): void {
  if (!maskCtx) return
  const left = Math.min(x0, x1)
  const top = Math.min(y0, y1)
  const w = Math.abs(x1 - x0)
  const h = Math.abs(y1 - y0)
  if (w < 1 || h < 1) return
  if (tool.value === 'eraser') {
    maskCtx.fillStyle = '#000'
    maskCtx.fillRect(left, top, w, h)
  } else {
    maskCtx.fillStyle = '#fff'
    maskCtx.fillRect(left, top, w, h)
  }
}

function onPaintPointerDown(ev: PointerEvent): void {
  if (!props.sourceUrl || !maskCtx) return
  ev.preventDefault()
  ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  pushUndo()
  const pt = canvasPoint(ev)
  painting = true
  lastPt = pt
  if (tool.value === 'rect') {
    rectPreview.value = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y }
  } else {
    strokeLine(pt, pt)
    refreshOverlay()
  }
  window.addEventListener('pointermove', onPaintPointerMove)
  window.addEventListener('pointerup', onPaintPointerUp)
}

function onPaintPointerMove(ev: PointerEvent): void {
  if (!painting || !lastPt) return
  const pt = canvasPoint(ev)
  if (tool.value === 'rect') {
    rectPreview.value = {
      x0: lastPt.x,
      y0: lastPt.y,
      x1: pt.x,
      y1: pt.y
    }
    return
  }
  strokeLine(lastPt, pt)
  lastPt = pt
  refreshOverlay()
}

function onPaintPointerUp(ev: PointerEvent): void {
  if (!painting) return
  const pt = canvasPoint(ev)
  if (tool.value === 'rect' && lastPt) {
    fillRectMask(lastPt.x, lastPt.y, pt.x, pt.y)
    rectPreview.value = null
    refreshOverlay()
  }
  painting = false
  lastPt = null
  window.removeEventListener('pointermove', onPaintPointerMove)
  window.removeEventListener('pointerup', onPaintPointerUp)
}

function undo(): void {
  if (!maskCtx || !maskCanvas || !undoStack.length) return
  redoStack.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height))
  const prev = undoStack.pop()!
  maskCtx.putImageData(prev, 0, 0)
  syncHistoryFlags()
  refreshOverlay()
}

function redo(): void {
  if (!maskCtx || !maskCanvas || !redoStack.length) return
  undoStack.push(maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height))
  const next = redoStack.pop()!
  maskCtx.putImageData(next, 0, 0)
  syncHistoryFlags()
  refreshOverlay()
}

function buildSavePayload(): RedrawEditorSavePayload {
  const opt = modelOptions.value.find((o) => o.key === selectionKey.value)
  const state = snapshotState()
  Object.assign(draft, state)
  const modelFields = {
    generateModel: opt?.model ?? '',
    generateProviderInstanceId: opt?.providerInstanceId ?? ''
  }
  if (props.mode === 'erase') {
    return { ...imageEraseToNodePatch(state), ...modelFields }
  }
  if (props.mode === 'matte') {
    return { ...imageMatteToNodePatch(state), ...modelFields }
  }
  return { ...imageRedrawToNodePatch(state), ...modelFields }
}

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  if (dirty.value) save()
  emit('close')
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPaintPointerMove)
  window.removeEventListener('pointerup', onPaintPointerUp)
})
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--graph-preview-bg);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.tools,
.history {
  display: flex;
  align-items: center;
  gap: 6px;
}

.tool-btn {
  width: 34px;
  height: 34px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
  font-size: 14px;
}

.tool-btn:hover:not(:disabled) {
  background: var(--bg-hover);
}

.tool-btn.active {
  border-color: rgba(90, 160, 255, 0.55);
  background: color-mix(in srgb, var(--accent) 12%, var(--bg-elevated));
}

.tool-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.brush-size {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 6px;
  min-width: 140px;
}

.brush-ico {
  font-size: 12px;
  opacity: 0.7;
}

.brush-range {
  width: 110px;
}

.stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  overflow: auto;
}

.stage-empty {
  color: var(--text-muted);
  font-size: 13px;
}

.canvas-wrap {
  position: relative;
  flex: 0 0 auto;
  box-shadow: 0 0 0 1px var(--wash-20);
}

.canvas-wrap-matte {
  background-color: #c8c8c8;
  background-image:
    linear-gradient(45deg, #a8a8a8 25%, transparent 25%),
    linear-gradient(-45deg, #a8a8a8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #a8a8a8 75%),
    linear-gradient(-45deg, transparent 75%, #a8a8a8 75%);
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
}

.source-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}

.overlay-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  cursor: crosshair;
  touch-action: none;
}

.rect-preview {
  position: absolute;
  border: 1px dashed var(--on-media-line);
  background: rgba(232, 72, 72, 0.22);
  pointer-events: none;
  z-index: 2;
}

.bottom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
}

.prompt {
  width: 100%;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.45;
  resize: vertical;
  min-height: 56px;
  font-family: inherit;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
}

.tool {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 100px;
}

.tool-model {
  min-width: 120px;
  max-width: 180px;
  flex: 0 1 160px;
}

.tool-label {
  font-size: 11px;
  color: var(--text-muted);
}

.select {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  max-width: 100%;
}
</style>
