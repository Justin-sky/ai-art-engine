<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="720"
    :default-height="560"
    :min-width="560"
    :min-height="420"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="stage" ref="stageEl" @pointerdown="onStagePointerDown">
        <div v-if="sourceLoading" class="stage-empty">{{ t('graph.editor.loadingSource') }}</div>
        <div v-else-if="!sourceUrl" class="stage-empty">{{ t('graph.expand.noSource') }}</div>
        <div
          v-else
          class="canvas-frame"
          :style="canvasFrameStyle"
        >
          <div class="grid-overlay" aria-hidden="true" />
          <img
            class="source-img"
            :src="sourceUrl"
            alt=""
            decoding="async"
            :style="sourceImgStyle"
          />
          <button
            v-for="h in handles"
            :key="h.id"
            type="button"
            class="handle"
            :class="h.id"
            :style="h.style"
            @pointerdown.stop="onHandlePointerDown($event, h.id)"
          />
        </div>
      </div>

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
          <span class="tool-label">{{ t('graph.expand.aspect') }}</span>
          <select v-model="draft.aspectId" class="select" @change="markDirty">
            <option value="original">{{ t('graph.expand.aspects.original') }}</option>
            <option v-for="ratio in aspectOptions" :key="ratio" :value="ratio">
              {{ ratio }}
            </option>
          </select>
        </label>
        <label class="tool">
          <span class="tool-label">{{ t('graph.expand.resolution') }}</span>
          <select v-model="draft.resolution" class="select" @change="markDirty">
            <option v-for="r in resolutionOptions" :key="r" :value="r">{{ r }}</option>
          </select>
        </label>
        <label class="tool">
          <span class="tool-label">{{ t('graph.expand.count') }}</span>
          <select v-model.number="draft.count" class="select" @change="markDirty">
            <option v-for="c in countOptions" :key="c" :value="c">
              {{ t('graph.expand.countOption', { n: c }) }}
            </option>
          </select>
        </label>
        <button type="button" class="reset-btn" @click="resetParams">
          {{ t('graph.expand.resetParams') }}
        </button>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  DEFAULT_IMAGE_EXPAND,
  EXPAND_FALLBACK_COUNTS,
  EXPAND_FALLBACK_RESOLUTIONS,
  clampExpandParamsToCapabilities,
  imageExpandToNodePatch,
  normalizeExpandMargins,
  normalizeImageExpand,
  type ImageExpandState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { loadImageGenerateCapabilities } from '../features/graph/model/imageGenerateCapabilities'
import {
  loadGenerateModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

type HandleId = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

export type ExpandEditorSavePayload = ReturnType<typeof imageExpandToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
}

const props = defineProps<{
  open: boolean
  setup?: Partial<ImageExpandState> | null
  sourceUrl?: string
  sourceLoading?: boolean
  generateModel?: string
  generateProviderInstanceId?: string
}>()

const emit = defineEmits<{
  close: []
  update: [payload: ExpandEditorSavePayload]
  save: [payload: ExpandEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.expand.appMark'))

const draft = reactive<ImageExpandState>(normalizeImageExpand())
const stageEl = ref<HTMLElement | null>(null)
const sourceNatural = reactive({ w: 1, h: 1 })
/** 原图在舞台上的固定显示尺寸（手柄拖动时不变） */
const sourceDisplay = reactive({ w: 240, h: 240 })
const modelOptions = ref<GenerateModelOption[]>([])
const selectionKey = ref('')
const aspectOptions = ref<string[]>([])
const resolutionOptions = ref<string[]>([...EXPAND_FALLBACK_RESOLUTIONS])
const countOptions = ref<number[]>([...EXPAND_FALLBACK_COUNTS])
const hydrating = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

const dirty = computed(() => {
  const a = normalizeImageExpand(props.setup)
  const b = normalizeImageExpand(draft)
  const setupKey = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  return (
    selectionKey.value !== setupKey ||
    JSON.stringify(a) !== JSON.stringify(b)
  )
})

const totalW = computed(() => 1 + draft.expandLeft + draft.expandRight)
const totalH = computed(() => 1 + draft.expandTop + draft.expandBottom)

const canvasFrameStyle = computed(() => ({
  width: `${sourceDisplay.w * totalW.value}px`,
  height: `${sourceDisplay.h * totalH.value}px`,
  maxWidth: '100%',
  maxHeight: '100%'
}))

const sourceImgStyle = computed(() => ({
  left: `${draft.expandLeft * sourceDisplay.w}px`,
  top: `${draft.expandTop * sourceDisplay.h}px`,
  width: `${sourceDisplay.w}px`,
  height: `${sourceDisplay.h}px`
}))

const handles = computed(() => {
  const pts: Array<{ id: HandleId; x: number; y: number }> = [
    { id: 'nw', x: 0, y: 0 },
    { id: 'n', x: 0.5, y: 0 },
    { id: 'ne', x: 1, y: 0 },
    { id: 'e', x: 1, y: 0.5 },
    { id: 'se', x: 1, y: 1 },
    { id: 's', x: 0.5, y: 1 },
    { id: 'sw', x: 0, y: 1 },
    { id: 'w', x: 0, y: 0.5 }
  ]
  return pts.map((p) => ({
    id: p.id,
    style: {
      left: `${p.x * 100}%`,
      top: `${p.y * 100}%`
    }
  }))
})

function fitSourceDisplay(): void {
  const stage = stageEl.value
  const ar = sourceNatural.w / Math.max(1, sourceNatural.h)
  const maxW = Math.max(160, (stage?.clientWidth ?? 480) * 0.42)
  const maxH = Math.max(160, (stage?.clientHeight ?? 360) * 0.55)
  let w = maxW
  let h = w / ar
  if (h > maxH) {
    h = maxH
    w = h * ar
  }
  sourceDisplay.w = Math.max(80, Math.round(w))
  sourceDisplay.h = Math.max(80, Math.round(h))
}

function buildSavePayload(): ExpandEditorSavePayload {
  const opt = modelOptions.value.find((o) => o.key === selectionKey.value)
  return {
    ...imageExpandToNodePatch(normalizeImageExpand(draft)),
    generateModel: opt?.model ?? '',
    generateProviderInstanceId: opt?.providerInstanceId ?? ''
  }
}

function emitPreview(): void {
  if (!props.open || hydrating.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (!props.open || hydrating.value) return
    emit('update', buildSavePayload())
  }, 48)
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    hydrating.value = true
    Object.assign(draft, normalizeImageExpand(props.setup))
    void reloadModelsAndCaps().finally(() => {
      void nextTick(() => {
        hydrating.value = false
        emitPreview()
      })
    })
  },
  { immediate: true }
)

watch(draft, () => emitPreview(), { deep: true })
watch(selectionKey, () => emitPreview())

watch(
  () => [props.open, props.sourceUrl] as const,
  async ([open, sourceUrl]) => {
    if (!open || !sourceUrl) return
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject()
        img.src = sourceUrl
      })
      sourceNatural.w = img.naturalWidth || 1
      sourceNatural.h = img.naturalHeight || 1
    } catch {
      sourceNatural.w = 1
      sourceNatural.h = 1
    }
    fitSourceDisplay()
  },
  { immediate: true }
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
    resolutionOptions.value = [...EXPAND_FALLBACK_RESOLUTIONS]
    countOptions.value = [...EXPAND_FALLBACK_COUNTS]
    Object.assign(
      draft,
      clampExpandParamsToCapabilities(draft, {
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
    caps.resolutions.length > 0 ? [...caps.resolutions] : [...EXPAND_FALLBACK_RESOLUTIONS]
  countOptions.value =
    caps.counts.length > 0 ? [...caps.counts] : [...EXPAND_FALLBACK_COUNTS]
  Object.assign(
    draft,
    clampExpandParamsToCapabilities(draft, {
      aspectRatios: aspectOptions.value,
      resolutions: resolutionOptions.value,
      counts: countOptions.value
    })
  )
}

async function onModelChange(): Promise<void> {
  await refreshCapabilities()
}

function markDirty(): void {
  /* draft already updated */
}

async function resetParams(): Promise<void> {
  Object.assign(draft, normalizeImageExpand(DEFAULT_IMAGE_EXPAND))
  await refreshCapabilities()
}

type DragMode =
  | { kind: 'handle'; handle: HandleId; start: ImageExpandState; sx: number; sy: number }
  | { kind: 'move'; start: ImageExpandState; sx: number; sy: number }

let drag: DragMode | null = null

function onHandlePointerDown(ev: PointerEvent, handle: HandleId): void {
  ev.preventDefault()
  ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  drag = {
    kind: 'handle',
    handle,
    start: { ...normalizeImageExpand(draft) },
    sx: ev.clientX,
    sy: ev.clientY
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onStagePointerDown(ev: PointerEvent): void {
  if (!props.sourceUrl) return
  const target = ev.target as HTMLElement
  if (!target.classList.contains('source-img')) return
  ev.preventDefault()
  drag = {
    kind: 'move',
    start: { ...normalizeImageExpand(draft) },
    sx: ev.clientX,
    sy: ev.clientY
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(ev: PointerEvent): void {
  if (!drag) return
  // 以原图固定显示尺寸为基准换算扩展量，拖动手柄只改变九宫格外框
  const dx = (ev.clientX - drag.sx) / Math.max(1, sourceDisplay.w)
  const dy = (ev.clientY - drag.sy) / Math.max(1, sourceDisplay.h)
  const s = drag.start

  if (drag.kind === 'move') {
    // 平移原图：在左右/上下边距之间挪动，不改变画布总尺寸与原图尺寸
    Object.assign(
      draft,
      normalizeExpandMargins({
        expandLeft: s.expandLeft + dx,
        expandRight: s.expandRight - dx,
        expandTop: s.expandTop + dy,
        expandBottom: s.expandBottom - dy
      })
    )
    return
  }

  let left = s.expandLeft
  let right = s.expandRight
  let top = s.expandTop
  let bottom = s.expandBottom
  const handle = drag.handle

  if (handle.includes('e')) right = s.expandRight + dx
  if (handle.includes('w')) left = s.expandLeft - dx
  if (handle.includes('s')) bottom = s.expandBottom + dy
  if (handle.includes('n')) top = s.expandTop - dy

  Object.assign(
    draft,
    normalizeExpandMargins({
      expandLeft: left,
      expandRight: right,
      expandTop: top,
      expandBottom: bottom
    })
  )
}

function onPointerUp(): void {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  if (dirty.value) save()
  emit('close')
}
</script>

<style scoped>
.editor-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--graph-preview-bg);
}

.stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
  overflow: auto;
}

.stage-empty {
  color: var(--text-muted);
  font-size: 13px;
}

.canvas-frame {
  position: relative;
  flex: 0 0 auto;
  border: 1px solid var(--on-media-line);
  background: var(--bg);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
}

.grid-overlay {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(to right, var(--wash-12) 1px, transparent 1px),
    linear-gradient(to bottom, var(--wash-12) 1px, transparent 1px);
  background-size: calc(100% / 3) calc(100% / 3);
  pointer-events: none;
  z-index: 1;
}

.source-img {
  position: absolute;
  object-fit: fill;
  z-index: 2;
  cursor: grab;
  user-select: none;
  -webkit-user-drag: none;
}

.handle {
  position: absolute;
  z-index: 3;
  width: 12px;
  height: 12px;
  margin: -6px 0 0 -6px;
  border: 1px solid var(--on-media-line);
  box-shadow: 0 0 0 1px var(--on-media-line-shadow);
  border-radius: 3px;
  background: var(--bg-elevated);
  padding: 0;
  cursor: pointer;
}

.handle.n,
.handle.s {
  width: 28px;
  height: 10px;
  margin-left: -14px;
  margin-top: -5px;
  border-radius: 999px;
  cursor: ns-resize;
}

.handle.e,
.handle.w {
  width: 10px;
  height: 28px;
  margin-left: -5px;
  margin-top: -14px;
  border-radius: 999px;
  cursor: ew-resize;
}

.handle.nw,
.handle.se {
  cursor: nwse-resize;
}

.handle.ne,
.handle.sw {
  cursor: nesw-resize;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: flex-end;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
}

.tool {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 120px;
}

.tool-model {
  min-width: 180px;
  flex: 1 1 180px;
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
}

.reset-btn {
  margin-left: auto;
  border: 1px solid var(--border);
  background: var(--bg-hover);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 12px;
  cursor: pointer;
}

.reset-btn:hover {
  background: var(--bg-hover);
}
</style>
