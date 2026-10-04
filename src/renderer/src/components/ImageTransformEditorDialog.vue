<template>
  <StudioFloatingWindow
    :open="open"
    :title="t('graph.transform.appMark')"
    :z-index="1200"
    :default-width="820"
    :default-height="640"
    :min-width="560"
    :min-height="440"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="topbar">
        <label class="ctl">
          <span class="ctl-label">{{ t('graph.transform.aspect') }}</span>
          <select v-model="draft.aspectId" class="ctl-select">
            <option value="original">{{ t('graph.transform.original') }}</option>
            <option v-for="id in RATIO_IDS" :key="id" :value="id">
              {{ id }}
            </option>
          </select>
        </label>
        <label class="ctl">
          <span class="ctl-label">{{ t('graph.transform.size') }}</span>
          <select v-model="draft.sizeId" class="ctl-select">
            <option value="original">{{ t('graph.transform.original') }}</option>
            <option v-for="id in SIZE_IDS" :key="id" :value="id">
              {{ id }}
            </option>
          </select>
        </label>
        <label class="ctl">
          <span class="ctl-label">{{ t('graph.transform.fill') }}</span>
          <select v-model="draft.fill" class="ctl-select">
            <option v-for="id in FILL_IDS" :key="id" :value="id">
              {{ t(`graph.transform.fills.${id}`) }}
            </option>
          </select>
        </label>
        <button type="button" class="ghost-btn" @click="reset">
          {{ t('graph.transform.reset') }}
        </button>
      </div>

      <div ref="stageEl" class="stage" @pointerdown="onStagePointerDown" @wheel.prevent="onWheel">
        <div v-if="sourceLoading" class="stage-empty">{{ t('graph.editor.loadingSource') }}</div>
        <div v-else-if="!sourceUrl" class="stage-empty">{{ t('graph.transform.noSource') }}</div>
        <canvas v-else ref="canvasEl" class="preview-canvas" :style="canvasStyle" />
      </div>

      <div class="bottom">
        <div class="row">
          <span class="row-label">{{ t('graph.transform.scale') }}</span>
          <input
            v-model.number="draft.scale"
            class="range"
            type="range"
            :min="IMAGE_TRANSFORM_LIMITS.scaleMin"
            :max="IMAGE_TRANSFORM_LIMITS.scaleMax"
            step="0.01"
          />
          <span class="val">{{ draft.scale.toFixed(2) }}×</span>
        </div>
        <div class="row">
          <span class="row-label">{{ t('graph.transform.rotate') }}</span>
          <input
            v-model.number="draft.rotate"
            class="range"
            type="range"
            :min="-IMAGE_TRANSFORM_LIMITS.rotateLimit"
            :max="IMAGE_TRANSFORM_LIMITS.rotateLimit"
            step="1"
          />
          <span class="val">{{ Math.round(draft.rotate) }}°</span>
        </div>
        <div class="row buttons">
          <button type="button" class="ghost-btn" @click="rotateBy(-90)">
            ⟲ {{ t('graph.transform.rotateLeft') }}
          </button>
          <button type="button" class="ghost-btn" @click="rotateBy(90)">
            ⟳ {{ t('graph.transform.rotateRight') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :class="{ active: draft.flipH }"
            @click="draft.flipH = !draft.flipH"
          >
            ↔ {{ t('graph.transform.flipH') }}
          </button>
          <button
            type="button"
            class="ghost-btn"
            :class="{ active: draft.flipV }"
            @click="draft.flipV = !draft.flipV"
          >
            ↕ {{ t('graph.transform.flipV') }}
          </button>
        </div>
        <p class="hint">
          {{ identity ? t('graph.transform.identity') : t('graph.transform.dirtyHint') }}
          <span class="hint-sub">{{ t('graph.transform.canvasHint') }}</span>
        </p>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  DEFAULT_IMAGE_TRANSFORM,
  IMAGE_TRANSFORM_ASPECTS,
  IMAGE_TRANSFORM_FILLS,
  IMAGE_TRANSFORM_LIMITS,
  IMAGE_TRANSFORM_SIZES,
  imageTransformToNodePatch,
  isIdentityImageTransform,
  normalizeImageTransform,
  planImageTransform,
  type ImageTransformState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { drawImageTransformPlan } from '../features/graph/model/composeImageTransformCanvas'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export type ImageTransformSavePayload = ReturnType<typeof imageTransformToNodePatch>

/** 预览画布的长边上限：几何与出图完全一致，只是整体缩到这个尺寸内 */
const PREVIEW_MAX_EDGE = 720

const RATIO_IDS = IMAGE_TRANSFORM_ASPECTS.filter((id) => id !== 'original')
const SIZE_IDS = IMAGE_TRANSFORM_SIZES.filter((id) => id !== 'original')
const FILL_IDS = IMAGE_TRANSFORM_FILLS

const props = defineProps<{
  open: boolean
  setup?: Partial<ImageTransformState> | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  update: [payload: ImageTransformSavePayload]
  save: [payload: ImageTransformSavePayload]
}>()

const { t } = useStudioI18n()

const draft = reactive<ImageTransformState>(normalizeImageTransform())
const stageEl = ref<HTMLElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const previewSize = reactive({ w: 0, h: 0 })
const hydrating = ref(false)
const sourceImage = ref<HTMLImageElement | null>(null)
let previewTimer: ReturnType<typeof setTimeout> | null = null

const identity = computed(() => isIdentityImageTransform(draft))
const dirty = computed(
  () =>
    JSON.stringify(normalizeImageTransform(props.setup)) !==
    JSON.stringify(normalizeImageTransform(draft))
)
const canvasStyle = computed(() => ({ width: `${previewSize.w}px`, height: `${previewSize.h}px` }))

/** 源图 + 当前参数 → 计划（与执行器同一函数，预览因此与出图严格一致） */
const plan = computed(() => {
  const img = sourceImage.value
  if (!img) return null
  return planImageTransform(
    img.naturalWidth || 1,
    img.naturalHeight || 1,
    normalizeImageTransform(draft)
  )
})

function render(): void {
  const canvas = canvasEl.value
  const img = sourceImage.value
  const current = plan.value
  if (!canvas || !img || !current) return
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(current.width, current.height))
  const width = Math.max(1, Math.round(current.width * scale))
  const height = Math.max(1, Math.round(current.height * scale))
  canvas.width = width
  canvas.height = height
  previewSize.w = width
  previewSize.h = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)
  drawImageTransformPlan(ctx, img, current, scale)
}

function buildSavePayload(): ImageTransformSavePayload {
  return imageTransformToNodePatch(normalizeImageTransform(draft))
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

function rotateBy(deg: number): void {
  let next = draft.rotate + deg
  // 落在 -180…180：±90° 的连按不该被夹断成同一个角度
  while (next > IMAGE_TRANSFORM_LIMITS.rotateLimit) next -= 360
  while (next < -IMAGE_TRANSFORM_LIMITS.rotateLimit) next += 360
  draft.rotate = next
}

function reset(): void {
  Object.assign(draft, normalizeImageTransform(DEFAULT_IMAGE_TRANSFORM))
}

// ── 拖拽平移 / 滚轮缩放 ──────────────────────────────────────────
let drag: { sx: number; sy: number; ox: number; oy: number } | null = null

function onStagePointerDown(ev: PointerEvent): void {
  if (!sourceImage.value || ev.button !== 0) return
  ev.preventDefault()
  ;(ev.target as HTMLElement).setPointerCapture?.(ev.pointerId)
  drag = { sx: ev.clientX, sy: ev.clientY, ox: draft.offsetX, oy: draft.offsetY }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(ev: PointerEvent): void {
  if (!drag) return
  const w = Math.max(1, previewSize.w)
  const h = Math.max(1, previewSize.h)
  draft.offsetX = clamp(drag.ox + (ev.clientX - drag.sx) / w)
  draft.offsetY = clamp(drag.oy + (ev.clientY - drag.sy) / h)
}

function onPointerUp(): void {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function onWheel(ev: WheelEvent): void {
  if (!sourceImage.value) return
  const factor = ev.deltaY < 0 ? 1.05 : 1 / 1.05
  draft.scale = clampScale(draft.scale * factor)
}

function clamp(value: number): number {
  return Math.max(
    -IMAGE_TRANSFORM_LIMITS.offsetLimit,
    Math.min(IMAGE_TRANSFORM_LIMITS.offsetLimit, value)
  )
}

function clampScale(value: number): number {
  return Math.max(IMAGE_TRANSFORM_LIMITS.scaleMin, Math.min(IMAGE_TRANSFORM_LIMITS.scaleMax, value))
}

watch(
  () => props.open,
  (open) => {
    if (!open) return
    hydrating.value = true
    Object.assign(draft, normalizeImageTransform(props.setup))
    void nextTick(() => {
      hydrating.value = false
      render()
      emitPreview()
    })
  },
  { immediate: true }
)

watch(draft, () => {
  render()
  emitPreview()
})

watch(
  () => [props.open, props.sourceUrl] as const,
  async ([open, sourceUrl]) => {
    if (!open) return
    sourceImage.value = null
    if (!sourceUrl) return
    try {
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('TRANSFORM_SOURCE_LOAD_FAILED'))
        img.src = sourceUrl
      })
      sourceImage.value = img
    } catch {
      sourceImage.value = null
    }
    await nextTick()
    render()
  },
  { immediate: true }
)

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  if (dirty.value) save()
  emit('close')
}

onBeforeUnmount(() => {
  if (previewTimer) clearTimeout(previewTimer)
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
  gap: 12px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-wrap: wrap;
}

.ctl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
}

.ctl-select {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 6px 8px;
  font-size: 12px;
}

.stage {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: auto;
  touch-action: none;
  cursor: move;
}

.stage-empty {
  color: var(--text-muted);
  font-size: 13px;
}

.preview-canvas {
  display: block;
  flex: 0 0 auto;
  /*
   * 透明底用棋盘格表示，白色 / 黑色填充一眼可辨。
   * 格子线走主题变量 + `color-mix`（**不写死 rgba(255,255,255)**）：写死会被
   * `tests/themeStylesAudit.test.ts` 的「媒体叠层硬编码白」规则拦下，深色主题下也刺眼。
   */
  background-image:
    linear-gradient(
      45deg,
      var(--checker-line, color-mix(in srgb, var(--on-media-line) 12%, transparent)) 25%,
      transparent 25%
    ),
    linear-gradient(
      -45deg,
      var(--checker-line, color-mix(in srgb, var(--on-media-line) 12%, transparent)) 25%,
      transparent 25%
    ),
    linear-gradient(
      45deg,
      transparent 75%,
      var(--checker-line, color-mix(in srgb, var(--on-media-line) 12%, transparent)) 75%
    ),
    linear-gradient(
      -45deg,
      transparent 75%,
      var(--checker-line, color-mix(in srgb, var(--on-media-line) 12%, transparent)) 75%
    );
  background-size: 16px 16px;
  background-position:
    0 0,
    0 8px,
    8px -8px,
    -8px 0;
  box-shadow: 0 0 0 1px var(--border);
}

.bottom {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.row-label {
  width: 52px;
  font-size: 12px;
  color: var(--text-muted);
  flex: 0 0 auto;
}

.range {
  flex: 1 1 auto;
  min-width: 0;
}

.val {
  width: 56px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
  flex: 0 0 auto;
}

.buttons {
  flex-wrap: wrap;
}

.ghost-btn {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.ghost-btn:hover {
  background: var(--bg-hover);
}

.ghost-btn.active {
  border-color: var(--accent);
  color: var(--accent);
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}

.hint-sub {
  margin-left: 8px;
  opacity: 0.75;
}
</style>
