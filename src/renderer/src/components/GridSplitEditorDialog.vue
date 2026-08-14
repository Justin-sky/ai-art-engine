<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="760"
    :default-height="580"
    :min-width="560"
    :min-height="420"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="topbar">
        <div class="grid-menu-wrap">
          <button
            type="button"
            class="menu-btn"
            @click="toggleGridMenu"
          >
            <span
              class="grid-ico"
              aria-hidden="true"
            >▦</span>
            <span>{{ gridSizeLabel }}</span>
            <span class="chev">▾</span>
          </button>
          <div
            v-if="gridMenuOpen"
            class="grid-menu"
            @mousedown.stop
          >
            <button
              v-for="p in presets"
              :key="`${p.rows}x${p.cols}`"
              type="button"
              class="menu-item"
              :class="{ active: draft.rows === p.rows && draft.cols === p.cols }"
              @click="applyPreset(p.rows, p.cols)"
            >
              {{ t(`graph.gridSplit.presets.${p.labelKey}`, { r: p.rows, c: p.cols }) }}
            </button>
            <div class="menu-sep" />
            <div class="custom-block">
              <div class="custom-title">
                {{ t('graph.gridSplit.customTitle') }}
              </div>
              <div
                class="custom-picker"
                @pointerleave="hoverRC = null"
              >
                <button
                  v-for="cell in pickerCells"
                  :key="cell.key"
                  type="button"
                  class="picker-cell"
                  :class="{ hot: isPickerHot(cell.r, cell.c) }"
                  @pointerenter="hoverRC = { r: cell.r, c: cell.c }"
                  @click="applyPreset(cell.r, cell.c)"
                />
              </div>
              <div class="custom-hint">
                {{ hoverRC ? `${hoverRC.r}×${hoverRC.c}` : '—' }}
              </div>
            </div>
          </div>
        </div>

        <div class="sel-count">
          {{ t('graph.gridSplit.selectedCount', { n: draft.selected.length }) }}
        </div>

        <button
          type="button"
          class="clear-btn"
          @click="clearSelection"
        >
          {{ t('graph.gridSplit.clearSelection') }}
        </button>
      </div>

      <div
        ref="stageEl"
        class="stage"
        @click="gridMenuOpen = false"
      >
        <div
          v-if="sourceLoading"
          class="stage-empty"
        >
          {{ t('graph.editor.loadingSource') }}
        </div>
        <div
          v-else-if="!sourceUrl"
          class="stage-empty"
        >
          {{ t('graph.gridSplit.noSource') }}
        </div>
        <div
          v-else
          class="canvas-wrap"
          :style="canvasWrapStyle"
        >
          <img
            class="source-img"
            :src="sourceUrl"
            alt=""
            draggable="false"
            decoding="async"
          >
          <div
            class="grid-lines"
            :style="gridLinesStyle"
            aria-hidden="true"
          />
          <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="cell"
            :class="{ selected: isSelected(cell.key) }"
            :style="cell.style"
            @click.stop="toggleCell(cell.key)"
          >
            <span
              v-if="isSelected(cell.key)"
              class="cell-tag"
            >{{ cell.key }}</span>
          </button>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import {
  DEFAULT_IMAGE_GRID_SPLIT,
  GRID_SPLIT_MAX,
  GRID_SPLIT_PRESETS,
  cellKey,
  imageGridSplitToNodePatch,
  normalizeImageGridSplit,
  type ImageGridSplitState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export type GridSplitEditorSavePayload = ReturnType<typeof imageGridSplitToNodePatch>

const props = defineProps<{
  open: boolean
  setup?: Partial<ImageGridSplitState> | null
  sourceUrl?: string
  sourceLoading?: boolean
}>()

const emit = defineEmits<{
  close: []
  update: [payload: GridSplitEditorSavePayload]
  save: [payload: GridSplitEditorSavePayload]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.gridSplit.appMark'))

const draft = reactive<ImageGridSplitState>(normalizeImageGridSplit())
const stageEl = ref<HTMLElement | null>(null)
const sourceNatural = reactive({ w: 1, h: 1 })
const display = reactive({ w: 360, h: 360 })
const gridMenuOpen = ref(false)
const hoverRC = ref<{ r: number; c: number } | null>(null)
const hydrating = ref(false)
let previewTimer: ReturnType<typeof setTimeout> | null = null
const presets = GRID_SPLIT_PRESETS

const dirty = computed(() => {
  const a = normalizeImageGridSplit(props.setup)
  const b = normalizeImageGridSplit(draft)
  return JSON.stringify(a) !== JSON.stringify(b)
})

const gridSizeLabel = computed(() =>
  t('graph.gridSplit.sizeLabel', { r: draft.rows, c: draft.cols, n: draft.rows * draft.cols })
)

const canvasWrapStyle = computed(() => ({
  width: `${display.w}px`,
  height: `${display.h}px`
}))

const gridLinesStyle = computed(() => ({
  backgroundSize: `${100 / draft.cols}% ${100 / draft.rows}%`
}))

const cells = computed(() => {
  const list: Array<{ key: string; style: Record<string, string> }> = []
  const cw = 100 / draft.cols
  const ch = 100 / draft.rows
  for (let r = 1; r <= draft.rows; r++) {
    for (let c = 1; c <= draft.cols; c++) {
      list.push({
        key: cellKey(r, c),
        style: {
          left: `${(c - 1) * cw}%`,
          top: `${(r - 1) * ch}%`,
          width: `${cw}%`,
          height: `${ch}%`
        }
      })
    }
  }
  return list
})

const pickerCells = computed(() => {
  const list: Array<{ key: string; r: number; c: number }> = []
  for (let r = 1; r <= GRID_SPLIT_MAX; r++) {
    for (let c = 1; c <= GRID_SPLIT_MAX; c++) {
      list.push({ key: `${r}-${c}`, r, c })
    }
  }
  return list
})

function isPickerHot(r: number, c: number): boolean {
  const h = hoverRC.value
  if (!h) return false
  return r <= h.r && c <= h.c
}

function isSelected(key: string): boolean {
  return draft.selected.includes(key)
}

function toggleCell(key: string): void {
  const idx = draft.selected.indexOf(key)
  if (idx >= 0) draft.selected.splice(idx, 1)
  else draft.selected.push(key)
}

function clearSelection(): void {
  draft.selected = []
}

function applyPreset(rows: number, cols: number): void {
  draft.rows = rows
  draft.cols = cols
  draft.selected = normalizeImageGridSplit(draft).selected
  gridMenuOpen.value = false
  hoverRC.value = null
}

function toggleGridMenu(): void {
  gridMenuOpen.value = !gridMenuOpen.value
}

function fitDisplay(): void {
  const stage = stageEl.value
  const ar = sourceNatural.w / Math.max(1, sourceNatural.h)
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

function buildSavePayload(): GridSplitEditorSavePayload {
  return imageGridSplitToNodePatch(normalizeImageGridSplit(draft))
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
    gridMenuOpen.value = false
    Object.assign(draft, normalizeImageGridSplit(props.setup ?? DEFAULT_IMAGE_GRID_SPLIT))
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
  gridMenuOpen.value = false
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

.topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.grid-menu-wrap {
  position: relative;
}

.menu-btn {
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

.chev {
  opacity: 0.6;
  font-size: 11px;
}

.grid-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 8;
  min-width: 200px;
  padding: 8px;
  border-radius: 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}

.menu-item {
  display: block;
  width: 100%;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.menu-item:hover,
.menu-item.active {
  background: var(--bg-hover);
}

.menu-sep {
  height: 1px;
  margin: 6px 0;
  background: var(--border);
}

.custom-block {
  padding: 4px 4px 2px;
}

.custom-title {
  font-size: 12px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.custom-picker {
  display: grid;
  grid-template-columns: repeat(5, 22px);
  gap: 4px;
}

.picker-cell {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: var(--bg-hover);
  padding: 0;
  cursor: pointer;
}

.picker-cell.hot {
  background: #4a90e2;
}

.custom-hint {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.sel-count {
  font-size: 13px;
  color: var(--text);
}

.clear-btn {
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 7px 12px;
  font-size: 12px;
  cursor: pointer;
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
  z-index: 1;
}

.cell {
  position: absolute;
  z-index: 2;
  margin: 0;
  padding: 0;
  border: 2px solid transparent;
  background: transparent;
  box-sizing: border-box;
  cursor: pointer;
}

.cell:hover {
  background: rgba(74, 144, 226, 0.12);
}

.cell.selected {
  border-color: #4a90e2;
  background: rgba(74, 144, 226, 0.1);
}

.cell-tag {
  position: absolute;
  top: 4px;
  left: 4px;
  font-size: 11px;
  font-weight: 600;
  color: #fff;
  background: var(--graph-preview-bg);
  padding: 2px 6px;
  border-radius: 4px;
  line-height: 1.2;
}
</style>
