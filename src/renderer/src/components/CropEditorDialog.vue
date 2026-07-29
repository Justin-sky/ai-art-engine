<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="720"
    :default-height="580"
    :min-width="520"
    :min-height="400"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="topbar">
        <div class="aspect-wrap">
          <button type="button" class="aspect-btn" @click="aspectMenuOpen = !aspectMenuOpen">
            <span class="aspect-ico" :class="aspectIconClass(draft.aspectId)" aria-hidden="true" />
            <span>{{ aspectLabel(draft.aspectId) }}</span>
            <span class="chev" aria-hidden="true">▾</span>
          </button>
          <div v-if="aspectMenuOpen" class="aspect-menu" @mousedown.stop>
            <button
              v-for="opt in aspectMenuOptions"
              :key="opt.id"
              type="button"
              class="aspect-item"
              :class="{ active: draft.aspectId === opt.id }"
              @click="selectAspect(opt.id)"
            >
              <span class="aspect-ico" :class="opt.iconClass" aria-hidden="true" />
              <span>{{ opt.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="stage" ref="stageEl" @pointerdown="onStagePointerDown">
        <div v-if="sourceLoading" class="stage-empty">{{ t('graph.editor.loadingSource') }}</div>
        <div v-else-if="!sourceUrl" class="stage-empty">{{ t('graph.crop.noSource') }}</div>
        <div v-else class="canvas-wrap" :style="canvasWrapStyle">
          <img
            class="source-img"
            :src="sourceUrl"
            alt=""
            draggable="false"
            decoding="async"
          />
          <div class="dim dim-t" :style="dimStyles.t" />
          <div class="dim dim-b" :style="dimStyles.b" />
          <div class="dim dim-l" :style="dimStyles.l" />
          <div class="dim dim-r" :style="dimStyles.r" />
          <div class="crop-box" :style="cropBoxStyle">
            <div class="grid" aria-hidden="true" />
            <button
              v-for="h in handles"
              :key="h.id"
              type="button"
              class="handle"
              :class="h.id"
              @pointerdown.stop="onHandlePointerDown($event, h.id)"
            />
          </div>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  CROP_ASPECT_PRESETS,
  cropTargetAspect,
  fitCropRectToAspect,
  imageCropToNodePatch,
  normalizeCropRect,
  normalizeImageCrop,
  type ImageCropState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

type HandleId = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

export type CropEditorSavePayload = ReturnType<typeof imageCropToNodePatch>

const props = defineProps<{
  open: boolean
  setup?: Partial<ImageCropState> | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  update: [payload: CropEditorSavePayload]
  save: [payload: CropEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.crop.appMark'))

const draft = reactive<ImageCropState>(normalizeImageCrop())
const stageEl = ref<HTMLElement | null>(null)
const sourceNatural = reactive({ w: 1, h: 1 })
const display = reactive({ w: 320, h: 320 })
const aspectMenuOpen = ref(false)
const hydrating = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

const sourceAspect = computed(() => sourceNatural.w / Math.max(1, sourceNatural.h))

const dirty = computed(() => {
  return JSON.stringify(normalizeImageCrop(props.setup)) !== JSON.stringify(normalizeImageCrop(draft))
})

const aspectMenuOptions = computed(() => {
  const opts = [
    { id: 'original', label: t('graph.crop.aspects.original'), iconClass: 'ico-original' },
    { id: '1:1', label: '1:1', iconClass: 'ico-1-1' },
    { id: '4:3', label: '4:3', iconClass: 'ico-4-3' },
    { id: '3:4', label: '3:4', iconClass: 'ico-3-4' },
    { id: '16:9', label: '16:9', iconClass: 'ico-16-9' },
    { id: '9:16', label: '9:16', iconClass: 'ico-9-16' }
  ]
  if (draft.aspectId === 'custom') {
    opts.push({
      id: 'custom',
      label: t('graph.crop.aspects.custom'),
      iconClass: 'ico-custom'
    })
  }
  return opts
})

const canvasWrapStyle = computed(() => ({
  width: `${display.w}px`,
  height: `${display.h}px`
}))

const cropBoxStyle = computed(() => ({
  left: `${draft.cropX * 100}%`,
  top: `${draft.cropY * 100}%`,
  width: `${draft.cropW * 100}%`,
  height: `${draft.cropH * 100}%`
}))

const dimStyles = computed(() => {
  const x = draft.cropX
  const y = draft.cropY
  const w = draft.cropW
  const h = draft.cropH
  return {
    t: { left: '0', top: '0', width: '100%', height: `${y * 100}%` },
    b: { left: '0', top: `${(y + h) * 100}%`, width: '100%', bottom: '0' },
    l: { left: '0', top: `${y * 100}%`, width: `${x * 100}%`, height: `${h * 100}%` },
    r: {
      left: `${(x + w) * 100}%`,
      top: `${y * 100}%`,
      right: '0',
      height: `${h * 100}%`
    }
  }
})

const handles = computed(() =>
  (['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as HandleId[]).map((id) => ({ id }))
)

function aspectLabel(id: string): string {
  if (id === 'original') return t('graph.crop.aspects.original')
  if (id === 'custom') return t('graph.crop.aspects.custom')
  return id
}

function aspectIconClass(id: string): string {
  if (id === 'original') return 'ico-original'
  if (id === 'custom') return 'ico-custom'
  if (id === '1:1') return 'ico-1-1'
  if (id === '4:3') return 'ico-4-3'
  if (id === '3:4') return 'ico-3-4'
  if (id === '16:9') return 'ico-16-9'
  if (id === '9:16') return 'ico-9-16'
  return 'ico-custom'
}

function fitDisplay(): void {
  const stage = stageEl.value
  const ar = sourceAspect.value
  const maxW = Math.max(200, (stage?.clientWidth ?? 640) - 24)
  const maxH = Math.max(180, (stage?.clientHeight ?? 400) - 16)
  let w = maxW
  let h = w / ar
  if (h > maxH) {
    h = maxH
    w = h * ar
  }
  display.w = Math.max(80, Math.round(w))
  display.h = Math.max(80, Math.round(h))
}

function applyAspectToDraft(aspectId: string): void {
  draft.aspectId = aspectId
  if (aspectId === 'custom') return
  const ta = cropTargetAspect(aspectId, sourceAspect.value)
  if (ta == null) return
  Object.assign(draft, fitCropRectToAspect(draft, ta, sourceAspect.value), { aspectId })
}

function selectAspect(id: string): void {
  applyAspectToDraft(id)
  aspectMenuOpen.value = false
}

function buildSavePayload(): CropEditorSavePayload {
  return imageCropToNodePatch(normalizeImageCrop(draft))
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
    aspectMenuOpen.value = false
    Object.assign(draft, normalizeImageCrop(props.setup))
    if (draft.aspectId !== 'custom' && CROP_ASPECT_PRESETS.includes(draft.aspectId as never)) {
      applyAspectToDraft(draft.aspectId)
    }
    void nextTick(() => {
      hydrating.value = false
      emitPreview()
    })
  },
  { immediate: true }
)

watch(draft, () => emitPreview(), { deep: true })

watch(
  () => [props.open, props.sourceUrl] as const,
  async ([open, sourceUrl]) => {
    if (!open) return
    if (sourceUrl) {
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
    }
    fitDisplay()
    if (draft.aspectId !== 'custom' && CROP_ASPECT_PRESETS.includes(draft.aspectId as never)) {
      applyAspectToDraft(draft.aspectId)
    }
  },
  { immediate: true }
)

type DragMode =
  | { kind: 'move'; start: ImageCropState; sx: number; sy: number }
  | { kind: 'handle'; handle: HandleId; start: ImageCropState; sx: number; sy: number }

let drag: DragMode | null = null

function onHandlePointerDown(ev: PointerEvent, handle: HandleId): void {
  ev.preventDefault()
  ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  aspectMenuOpen.value = false
  drag = {
    kind: 'handle',
    handle,
    start: { ...normalizeImageCrop(draft) },
    sx: ev.clientX,
    sy: ev.clientY
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onStagePointerDown(ev: PointerEvent): void {
  if (!props.sourceUrl) return
  const target = ev.target as HTMLElement
  if (!target.closest('.crop-box') || target.classList.contains('handle')) return
  if (target.classList.contains('handle')) return
  // 点在 crop-box 内部（非手柄）→ 平移
  if (!(target.classList.contains('crop-box') || target.classList.contains('grid'))) return
  ev.preventDefault()
  aspectMenuOpen.value = false
  drag = {
    kind: 'move',
    start: { ...normalizeImageCrop(draft) },
    sx: ev.clientX,
    sy: ev.clientY
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(ev: PointerEvent): void {
  if (!drag) return
  const dx = (ev.clientX - drag.sx) / Math.max(1, display.w)
  const dy = (ev.clientY - drag.sy) / Math.max(1, display.h)
  const s = drag.start

  if (drag.kind === 'move') {
    Object.assign(
      draft,
      normalizeCropRect({
        cropX: s.cropX + dx,
        cropY: s.cropY + dy,
        cropW: s.cropW,
        cropH: s.cropH
      }),
      { aspectId: draft.aspectId }
    )
    return
  }

  // 拉伸手柄 → 比例变为自定义
  let { cropX: x, cropY: y, cropW: w, cropH: h } = s
  const handle = drag.handle
  if (handle.includes('e')) {
    w = s.cropW + dx
  }
  if (handle.includes('w')) {
    const nextW = s.cropW - dx
    x = s.cropX + s.cropW - nextW
    w = nextW
  }
  if (handle.includes('s')) {
    h = s.cropH + dy
  }
  if (handle.includes('n')) {
    const nextH = s.cropH - dy
    y = s.cropY + s.cropH - nextH
    h = nextH
  }
  Object.assign(draft, normalizeCropRect({ cropX: x, cropY: y, cropW: w, cropH: h }), {
    aspectId: 'custom'
  })
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
  aspectMenuOpen.value = false
  if (dirty.value) save()
  emit('close')
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
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
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.aspect-wrap {
  position: relative;
}

.aspect-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
}

.aspect-btn:hover {
  background: var(--bg-hover);
}

.chev {
  opacity: 0.6;
  font-size: 11px;
}

.aspect-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 5;
  min-width: 148px;
  padding: 6px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.aspect-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.aspect-item:hover,
.aspect-item.active {
  background: var(--bg-hover);
}

.aspect-ico {
  display: inline-block;
  width: 18px;
  height: 14px;
  border: 1.5px solid var(--border);
  border-radius: 2px;
  flex: 0 0 auto;
}

.ico-original {
  border-style: dashed;
  width: 16px;
  height: 16px;
}

.ico-1-1 {
  width: 14px;
  height: 14px;
}

.ico-4-3 {
  width: 18px;
  height: 14px;
}

.ico-3-4 {
  width: 14px;
  height: 18px;
}

.ico-16-9 {
  width: 20px;
  height: 12px;
}

.ico-9-16 {
  width: 12px;
  height: 20px;
}

.ico-custom {
  width: 16px;
  height: 14px;
  border-radius: 3px;
}

.stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: auto;
}

.stage-empty {
  color: var(--text-muted);
  font-size: 13px;
}

.canvas-wrap {
  position: relative;
  flex: 0 0 auto;
  user-select: none;
}

.source-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  -webkit-user-drag: none;
}

.dim {
  position: absolute;
  background: rgba(0, 0, 0, 0.55);
  pointer-events: none;
  z-index: 1;
}

.crop-box {
  position: absolute;
  z-index: 2;
  box-sizing: border-box;
  border: 1.5px solid var(--on-media-line);
  box-shadow: 0 0 0 1px var(--on-media-line-shadow);
  cursor: move;
  touch-action: none;
}

.grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--on-media-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--on-media-line) 1px, transparent 1px);
  background-size: calc(100% / 3) calc(100% / 3);
}

.handle {
  position: absolute;
  padding: 0;
  border: none;
  background: transparent;
  z-index: 3;
}

/* 边中点粗线手柄 */
.handle.n,
.handle.s {
  left: 50%;
  width: 28px;
  height: 4px;
  margin-left: -14px;
  background: var(--on-media-line);
  border-radius: 2px;
  cursor: ns-resize;
}

.handle.n {
  top: -2px;
}

.handle.s {
  bottom: -2px;
}

.handle.e,
.handle.w {
  top: 50%;
  width: 4px;
  height: 28px;
  margin-top: -14px;
  background: var(--on-media-line);
  border-radius: 2px;
  cursor: ew-resize;
}

.handle.e {
  right: -2px;
}

.handle.w {
  left: -2px;
}

/* 四角 L 形手柄 */
.handle.nw,
.handle.ne,
.handle.sw,
.handle.se {
  width: 14px;
  height: 14px;
}

.handle.nw {
  left: -2px;
  top: -2px;
  cursor: nwse-resize;
  box-shadow:
    inset 3px 0 0 var(--on-media-line),
    inset 0 3px 0 var(--on-media-line);
}

.handle.ne {
  right: -2px;
  top: -2px;
  cursor: nesw-resize;
  box-shadow:
    inset -3px 0 0 var(--on-media-line),
    inset 0 3px 0 var(--on-media-line);
}

.handle.sw {
  left: -2px;
  bottom: -2px;
  cursor: nesw-resize;
  box-shadow:
    inset 3px 0 0 var(--on-media-line),
    inset 0 -3px 0 var(--on-media-line);
}

.handle.se {
  right: -2px;
  bottom: -2px;
  cursor: nwse-resize;
  box-shadow:
    inset -3px 0 0 var(--on-media-line),
    inset 0 -3px 0 var(--on-media-line);
}
</style>
