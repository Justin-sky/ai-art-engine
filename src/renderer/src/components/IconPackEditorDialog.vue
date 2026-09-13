<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="920"
    :default-height="640"
    :min-width="720"
    :min-height="500"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <aside class="side-panel">
        <div class="section-title">
          {{ t('graph.iconPack.gridSection') }}
        </div>
        <div class="grid-presets">
          <button
            v-for="p in presetGrids"
            :key="`${p.rows}x${p.cols}`"
            type="button"
            class="chip"
            :class="{ active: draft.rows === p.rows && draft.cols === p.cols }"
            @click="applyPreset(p.rows, p.cols)"
          >
            {{ p.rows }}×{{ p.cols }}
          </button>
        </div>
        <div class="stepper-row">
          <div class="stepper">
            <span class="stepper-label">{{ t('graph.iconPack.rows') }}</span>
            <button
              type="button"
              class="step-btn"
              :disabled="draft.rows <= ICON_PACK_GRID_MIN"
              @click="draft.rows = draft.rows - 1"
            >
              −
            </button>
            <span class="stepper-value">{{ draft.rows }}</span>
            <button
              type="button"
              class="step-btn"
              :disabled="draft.rows >= ICON_PACK_GRID_MAX"
              @click="draft.rows = draft.rows + 1"
            >
              +
            </button>
          </div>
          <div class="stepper">
            <span class="stepper-label">{{ t('graph.iconPack.cols') }}</span>
            <button
              type="button"
              class="step-btn"
              :disabled="draft.cols <= ICON_PACK_GRID_MIN"
              @click="draft.cols = draft.cols - 1"
            >
              −
            </button>
            <span class="stepper-value">{{ draft.cols }}</span>
            <button
              type="button"
              class="step-btn"
              :disabled="draft.cols >= ICON_PACK_GRID_MAX"
              @click="draft.cols = draft.cols + 1"
            >
              +
            </button>
          </div>
        </div>

        <div class="section-title">
          {{ t('graph.iconPack.keyingSection') }}
        </div>
        <div class="field">
          <div class="label">
            {{ t('graph.iconPack.keyColor') }}
          </div>
          <div class="seg">
            <button
              v-for="mode in keyModes"
              :key="mode"
              type="button"
              class="seg-item"
              :class="{ active: draft.keyColor === mode }"
              @click="draft.keyColor = mode"
            >
              {{ keyModeLabel(mode) }}
            </button>
          </div>
        </div>

        <div class="field">
          <div class="label">
            {{ t('graph.iconPack.distance') }}
          </div>
          <div class="range-row">
            <input v-model.number="draft.distance" type="range" min="0" max="120" step="1" />
            <span class="range-value">{{ draft.distance }}</span>
          </div>
        </div>
        <div class="field">
          <div class="label">
            {{ t('graph.iconPack.feather') }}
          </div>
          <div class="range-row">
            <input v-model.number="draft.feather" type="range" min="0" max="120" step="1" />
            <span class="range-value">{{ draft.feather }}</span>
          </div>
        </div>
        <div class="field">
          <div class="label">
            {{ t('graph.iconPack.edgeInset') }}
          </div>
          <div class="seg">
            <button
              type="button"
              class="seg-item"
              :class="{ active: draft.edgeInset === 'auto' }"
              @click="draft.edgeInset = 'auto'"
            >
              {{ t('graph.iconPack.edgeInsetAuto') }}
            </button>
            <button
              type="button"
              class="seg-item"
              :class="{ active: draft.edgeInset !== 'auto' }"
              @click="draft.edgeInset = edgeInsetPx"
            >
              {{ edgeInsetPx }}px
            </button>
          </div>
          <div v-if="draft.edgeInset !== 'auto'" class="range-row">
            <input
              :value="edgeInsetPx"
              type="range"
              min="0"
              max="32"
              step="1"
              @input="onEdgeInsetInput(Number(($event.target as HTMLInputElement).value))"
            />
            <span class="range-value">{{ edgeInsetPx }}</span>
          </div>
        </div>

        <div class="section-title">
          {{ t('graph.iconPack.canvasSection') }}
        </div>
        <div class="field">
          <div class="label">
            {{ t('graph.iconPack.canvas') }}
          </div>
          <div class="seg">
            <button
              type="button"
              class="seg-item"
              :class="{ active: draft.canvasSize === 0 }"
              @click="draft.canvasSize = 0"
            >
              {{ t('graph.iconPack.canvasAuto') }}
            </button>
            <button
              type="button"
              class="seg-item"
              :class="{ active: draft.canvasSize > 0 }"
              @click="draft.canvasSize = defaultCanvasManual"
            >
              {{ defaultCanvasManual }}px
            </button>
          </div>
          <div v-if="draft.canvasSize > 0" class="range-row">
            <input v-model.number="draft.canvasSize" type="range" min="64" max="1024" step="16" />
            <span class="range-value">{{ draft.canvasSize }}</span>
          </div>
        </div>

        <p class="editor-hint">
          {{ t('graph.iconPack.editorHint') }}
        </p>
      </aside>

      <section class="stage-panel">
        <div ref="stageEl" class="stage">
          <div v-if="sourceLoading" class="stage-empty">
            {{ t('graph.editor.loadingSource') }}
          </div>
          <div v-else-if="!sourceUrl" class="stage-empty">
            {{ t('graph.iconPack.noSource') }}
          </div>
          <div v-else class="canvas-wrap" :style="canvasWrapStyle">
            <img class="source-img" :src="sourceUrl" alt="" draggable="false" decoding="async" />
            <div class="grid-lines" :style="gridLinesStyle" aria-hidden="true" />
          </div>
        </div>
        <div class="cells-hint">
          {{ t('graph.iconPack.cellsHint', { n: draft.rows * draft.cols }) }}
        </div>
      </section>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  ICON_PACK_GRID_MAX,
  ICON_PACK_GRID_MIN,
  DEFAULT_ICON_PACK,
  iconPackToNodePatch,
  normalizeIconPackState,
  type IconPackKeyMode,
  type IconPackState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export type IconPackEditorSavePayload = ReturnType<typeof iconPackToNodePatch>

const props = defineProps<{
  open: boolean
  setup?: Partial<IconPackState> | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  update: [payload: IconPackEditorSavePayload]
  save: [payload: IconPackEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.iconPack.appMark'))

const draft = reactive<IconPackState>(normalizeIconPackState())
const stageEl = ref<HTMLElement | null>(null)
const sourceNatural = reactive({ w: 1, h: 1 })
const display = reactive({ w: 480, h: 480 })
const hydrating = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null

const presetGrids = [
  { rows: 2, cols: 2 },
  { rows: 3, cols: 3 },
  { rows: 4, cols: 4 },
  { rows: 5, cols: 5 }
]
const keyModes: IconPackKeyMode[] = ['auto', 'black', 'white', 'none']

const edgeInsetPx = computed(() => {
  const v = Number(draft.edgeInset)
  return Number.isFinite(v) && v > 0 ? Math.min(64, Math.floor(v)) : 4
})
function onEdgeInsetInput(value: number): void {
  if (Number.isFinite(value) && value >= 0) {
    draft.edgeInset = Math.min(64, Math.floor(value))
  }
}
const defaultCanvasManual = 512

const dirty = computed(() => {
  const a = normalizeIconPackState(props.setup)
  const b = normalizeIconPackState(draft)
  return JSON.stringify(a) !== JSON.stringify(b)
})

function keyModeLabel(mode: IconPackKeyMode): string {
  return t(`graph.iconPack.keyColorMode.${mode}`)
}

const canvasWrapStyle = computed(() => ({
  width: `${display.w}px`,
  height: `${display.h}px`
}))

const gridLinesStyle = computed(() => ({
  backgroundSize: `${100 / draft.cols}% ${100 / draft.rows}%`
}))

function applyPreset(rows: number, cols: number): void {
  draft.rows = rows
  draft.cols = cols
}

function fitDisplay(): void {
  const stage = stageEl.value
  const ar = sourceNatural.w / Math.max(1, sourceNatural.h)
  const maxW = Math.max(200, (stage?.clientWidth ?? 640) - 24)
  const maxH = Math.max(180, (stage?.clientHeight ?? 420) - 16)
  let w = maxW
  let h = w / ar
  if (h > maxH) {
    h = maxH
    w = h * ar
  }
  display.w = Math.max(80, Math.round(w))
  display.h = Math.max(80, Math.round(h))
}

function buildSavePayload(): IconPackEditorSavePayload {
  return iconPackToNodePatch(normalizeIconPackState(draft))
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
    Object.assign(draft, normalizeIconPackState(props.setup ?? DEFAULT_ICON_PACK))
    void nextTick(() => {
      hydrating.value = false
      emitPreview()
      fitDisplay()
    })
  },
  { immediate: true }
)

watch(draft, () => emitPreview(), { deep: true })

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
    fitDisplay()
  },
  { immediate: true }
)

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  if (dirty.value) save()
  emit('close')
}
</script>

<style scoped>
.editor-root {
  display: flex;
  height: 100%;
  min-height: 0;
  background: var(--graph-preview-bg);
}

.side-panel {
  flex: 0 0 300px;
  min-height: 0;
  overflow: auto;
  padding: 14px;
  border-right: 1px solid var(--border);
  background: var(--bg-elevated);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text);
  margin-top: 6px;
}

.grid-presets {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.chip {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.chip.active {
  background: #4a90e2;
  border-color: #4a90e2;
  color: #fff;
}

.stepper-row {
  display: flex;
  gap: 12px;
}

.stepper {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.stepper-label {
  color: var(--text-muted);
}

.step-btn {
  width: 22px;
  height: 22px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text);
  cursor: pointer;
  line-height: 1;
}

.step-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.stepper-value {
  min-width: 16px;
  text-align: center;
  font-weight: 600;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
}

.seg {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.seg-item {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 5px 8px;
  font-size: 11px;
  cursor: pointer;
}

.seg-item.active {
  background: #4a90e2;
  border-color: #4a90e2;
  color: #fff;
}

.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.range-row input[type='range'] {
  flex: 1 1 auto;
  min-width: 0;
}

.range-value {
  flex: 0 0 34px;
  text-align: right;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text);
}

.editor-hint {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-muted);
}

.stage-panel {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
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
}

.source-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  -webkit-user-drag: none;
}

.grid-lines {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(to right, var(--on-media-line) 1px, transparent 1px),
    linear-gradient(to bottom, var(--on-media-line) 1px, transparent 1px);
}

.cells-hint {
  padding: 8px 16px;
  font-size: 11px;
  color: var(--text-muted);
  border-top: 1px solid var(--border);
  background: var(--bg-elevated);
}
</style>
