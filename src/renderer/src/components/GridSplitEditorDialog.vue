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
          <button type="button" class="menu-btn" @click="toggleGridMenu">
            <span class="grid-ico" aria-hidden="true">▦</span>
            <span>{{ gridSizeLabel }}</span>
            <span class="chev">▾</span>
          </button>
          <div v-if="gridMenuOpen" class="grid-menu" @mousedown.stop>
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
              <div class="custom-picker" @pointerleave="hoverRC = null">
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

        <button type="button" class="clear-btn" @click="clearSelection">
          {{ t('graph.gridSplit.clearSelection') }}
        </button>
      </div>

      <div v-if="cells.length && !refineOpen" class="refine-bar">
        <span class="refine-label">{{ t('graph.gridSplit.refineBar') }}</span>
        <div class="refine-cells">
          <button
            v-for="cell in cells"
            :key="`refine-${cell.key}`"
            type="button"
            class="refine-chip"
            :title="cell.key"
            @click="openRefine(cell.key)"
          >
            {{ cell.key }}
          </button>
        </div>
      </div>

      <div ref="stageEl" class="stage" @click="gridMenuOpen = false">
        <div v-if="sourceLoading" class="stage-empty">
          {{ t('graph.editor.loadingSource') }}
        </div>
        <div v-else-if="!sourceUrl" class="stage-empty">
          {{ t('graph.gridSplit.noSource') }}
        </div>
        <div v-else class="canvas-wrap" :style="canvasWrapStyle">
          <img class="source-img" :src="sourceUrl" alt="" draggable="false" decoding="async" />
          <div class="grid-lines" :style="gridLinesStyle" aria-hidden="true" />
          <button
            v-for="cell in cells"
            :key="cell.key"
            type="button"
            class="cell"
            :class="{ selected: isSelected(cell.key) }"
            :style="cell.style"
            @click.stop="toggleCell(cell.key)"
          >
            <span v-if="isSelected(cell.key)" class="cell-tag">{{ cell.key }}</span>
          </button>
        </div>
      </div>

      <div v-if="refineOpen" class="refine-overlay" @click.self="closeRefine">
        <div class="refine-panel">
          <div class="refine-head">
            <div class="refine-title">
              {{ refineTitleText }}
            </div>
            <button
              type="button"
              class="refine-x"
              :title="t('graph.gridSplit.refineClose')"
              @click="closeRefine"
            >
              ×
            </button>
          </div>

          <div class="refine-body">
            <div v-if="originalPreviewUrl || resultUrl" class="refine-previews">
              <figure v-if="originalPreviewUrl" class="refine-fig">
                <img :src="originalPreviewUrl" alt="" draggable="false" />
                <figcaption>{{ t('graph.gridSplit.refineOriginal') }}</figcaption>
              </figure>
              <figure v-if="resultUrl" class="refine-fig">
                <img :src="resultUrl" alt="" draggable="false" />
                <figcaption>{{ t('graph.gridSplit.refineResult') }}</figcaption>
              </figure>
            </div>

            <p v-if="!refineCtx?.pack" class="refine-note danger">
              {{ t('graph.gridSplit.refineNoPack') }}
            </p>
            <p v-else-if="!modelConfigured" class="refine-note warn">
              {{ t('graph.gridSplit.refineNoModelHint') }}
            </p>

            <label class="refine-field">
              <span>{{ t('graph.gridSplit.refineHint') }}</span>
              <textarea
                v-model="hintText"
                rows="2"
                :placeholder="t('graph.gridSplit.refineHintPh')"
              />
            </label>

            <label class="refine-field">
              <span>{{ t('graph.gridSplit.refinePrompt') }}</span>
              <textarea v-model="promptText" rows="7" spellcheck="false" />
            </label>

            <p v-if="refineError" class="refine-note danger">
              {{ refineError }}
            </p>
            <p v-if="refineDone" class="refine-note ok">
              {{ refineDone }}
            </p>
          </div>

          <div class="refine-foot">
            <button type="button" class="btn-ghost" @click="closeRefine">
              {{ t('graph.gridSplit.refineCancel') }}
            </button>
            <button
              type="button"
              class="btn-primary"
              :disabled="busy || !canRunRefine"
              @click="runRefine"
            >
              {{ busy ? t('graph.gridSplit.refineRunning') : t('graph.gridSplit.refineRun') }}
            </button>
          </div>
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
  buildIconRefineInstruction,
  cellKey,
  imageGridSplitToNodePatch,
  normalizeImageGridSplit,
  resolveIconRefineContext,
  type IconRefineContext,
  type ImageGridSplitState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import StudioFloatingWindow from './StudioFloatingWindow.vue'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'
import { IconRefineError, runIconRefine } from '../features/graph/model/runIconRefine'

export type GridSplitEditorSavePayload = ReturnType<typeof imageGridSplitToNodePatch>

const props = defineProps<{
  open: boolean
  setup?: Partial<ImageGridSplitState> | null
  sourceUrl?: string
  sourceLoading?: boolean
  /** 宿主图编辑器注册 id（dive 宿主提供）：单枚回炉读写宿主图 / 触发打包节点重跑 */
  hostId?: string
  /** 当前 image.gridSplit 节点 id（dive 宿主提供） */
  nodeId?: string
}>()

const emit = defineEmits<{
  close: []
  update: [payload: GridSplitEditorSavePayload]
  save: [payload: GridSplitEditorSavePayload]
}>()

const { t, locale } = useStudioI18n()
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

// —— 单枚回炉精修：dive 内 AI 重绘选中格，写回同源 iconPack 节点并重跑打包 ——
const refineOpen = ref(false)
const refineCellKey = ref('')
const refineCtx = ref<IconRefineContext | null>(null)
const originalPreviewUrl = ref('')
const resultUrl = ref('')
const busy = ref(false)
const refineError = ref('')
const refineDone = ref('')
const hintText = ref('')
const promptText = ref('')
const isEnglish = computed(() =>
  String(locale.value ?? '')
    .toLowerCase()
    .startsWith('en')
)

const refineTitleText = computed(() => {
  const name = refineCtx.value?.name?.trim()
  const base = refineCellKey.value
    ? `${t('graph.gridSplit.refineBar')} · ${refineCellKey.value}`
    : t('graph.gridSplit.refineBar')
  return name ? `${base} · ${name}` : base
})

const modelConfigured = computed(() => {
  const ctx = refineCtx.value
  if (!ctx?.sheetNodeId) return true
  const sheet = graphEditorHosts.getNode(props.hostId, ctx.sheetNodeId)
  const params = (sheet?.params ?? {}) as Record<string, unknown>
  return typeof params.generateModel === 'string' && params.generateModel.trim().length > 0
})

const canRunRefine = computed(() =>
  Boolean(
    props.open && props.sourceUrl && refineCtx.value?.pack && promptText.value.trim() && !busy.value
  )
)

function rebuildRefinePrompt(): void {
  const ctx = refineCtx.value
  if (!ctx) return
  promptText.value = buildIconRefineInstruction(ctx, {
    locale: isEnglish.value ? 'en' : 'zh',
    hint: hintText.value.trim() || undefined
  })
}

async function openRefine(cell: string): Promise<void> {
  refineCellKey.value = cell
  refineError.value = ''
  refineDone.value = ''
  resultUrl.value = ''
  originalPreviewUrl.value = ''
  hintText.value = ''
  refineCtx.value = null
  promptText.value = ''
  refineOpen.value = true

  if (!props.hostId || !props.nodeId || !props.sourceUrl) {
    refineError.value = t('graph.gridSplit.refineUnresolved')
    return
  }

  const doc = graphEditorHosts.getDocument(props.hostId)
  const ctx = resolveIconRefineContext(doc, props.nodeId, cell)
  refineCtx.value = ctx
  if (!ctx) {
    refineError.value = t('graph.gridSplit.refineUnresolved')
    return
  }
  rebuildRefinePrompt()
  if (!ctx.pack) return

  try {
    const crop = await composeImageGridCell({
      sourceDataUrl: props.sourceUrl,
      state: normalizeImageGridSplit(draft),
      cellKey: cell,
      edgeInset: 'auto'
    })
    originalPreviewUrl.value = crop.dataUrl
  } catch {
    originalPreviewUrl.value = ''
  }
}

function closeRefine(): void {
  refineOpen.value = false
  refineCellKey.value = ''
  refineCtx.value = null
  originalPreviewUrl.value = ''
  resultUrl.value = ''
  hintText.value = ''
  promptText.value = ''
  refineError.value = ''
  refineDone.value = ''
  busy.value = false
}

watch(hintText, () => {
  if (refineOpen.value && refineCtx.value) rebuildRefinePrompt()
})

watch(
  () => props.open,
  (open) => {
    if (!open) closeRefine()
  }
)

/** 精修失败原因码 → 弹窗文案（可定位性问题用专门文案，其余带原始报错） */
function refineErrorText(err: unknown): string {
  if (err instanceof IconRefineError) {
    if (err.code === 'unresolved') return t('graph.gridSplit.refineUnresolved')
    if (err.code === 'no-pack') return t('graph.gridSplit.refineNoPack')
    if (err.code === 'no-source') return t('graph.gridSplit.refineNoSource')
    if (err.code === 'no-result') return t('graph.gridSplit.refineNoResult')
  }
  return `${t('graph.gridSplit.refineFailedPrefix')}：${
    err instanceof Error ? err.message : String(err)
  }`
}

async function runRefine(): Promise<void> {
  const ctx = refineCtx.value
  if (!ctx?.pack || !props.sourceUrl || busy.value) return
  const doc = graphEditorHosts.getDocument(props.hostId)
  if (!doc || !props.nodeId) return
  busy.value = true
  refineError.value = ''
  refineDone.value = ''

  try {
    // 与 MCP graph_icon_refine 同一执行口径（上下文 / 指令 / 裁切 / 模型克隆 / 写回）
    const result = await runIconRefine({
      document: doc,
      splitNodeId: props.nodeId,
      cellKey: ctx.cellKey,
      locale: isEnglish.value ? 'en' : 'zh',
      prompt: promptText.value,
      referenceDataUrl: originalPreviewUrl.value
    })

    // 写回同源 iconPack：仅替换本格覆盖，其余格不受影响
    graphEditorHosts.updateNode(props.hostId, result.packNodeId, {
      iconPackCellRefines: result.cellRefines
    } as never)

    resultUrl.value = result.dataUrl
    graphRunHosts.get(props.hostId)?.toggleNodeRun(result.packNodeId)
    refineDone.value = t('graph.gridSplit.refineSuccess', {
      cell: result.cellKey,
      name: result.name?.trim() || result.cellKey
    })
  } catch (err) {
    refineError.value = refineErrorText(err)
  } finally {
    busy.value = false
  }
}

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  gridMenuOpen.value = false
  if (dirty.value) save()
  if (refineOpen.value) closeRefine()
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

/* —— 单枚回炉精修 —— */
.refine-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.refine-label {
  flex: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.refine-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 72px;
  overflow-y: auto;
}

.refine-chip {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  font-size: 12px;
  padding: 4px 10px;
  cursor: pointer;
}

.refine-chip:hover {
  border-color: #4a90e2;
  background: var(--bg-hover);
}

.refine-overlay {
  position: absolute;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.refine-panel {
  display: flex;
  flex-direction: column;
  width: 580px;
  max-width: calc(100% - 48px);
  max-height: calc(100% - 32px);
  border-radius: 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.refine-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
}

.refine-title {
  flex: 1;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refine-x {
  flex: none;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.refine-x:hover {
  background: var(--bg-hover);
  color: var(--text);
}

.refine-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.refine-previews {
  display: flex;
  gap: 12px;
}

.refine-fig {
  flex: 1;
  margin: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.refine-fig img {
  width: 120px;
  height: 120px;
  object-fit: contain;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--graph-preview-bg);
}

.refine-fig figcaption {
  font-size: 11px;
  color: var(--text-muted);
}

.refine-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.refine-field > span {
  font-size: 12px;
  color: var(--text-muted);
}

.refine-field textarea {
  width: 100%;
  resize: vertical;
  min-height: 54px;
  box-sizing: border-box;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
  font-family: inherit;
  line-height: 1.5;
}

.refine-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.refine-note.danger {
  color: #e74c3c;
}

.refine-note.warn {
  color: #d9a441;
}

.refine-note.ok {
  color: #27ae60;
}

.refine-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid var(--border);
}

.btn-ghost {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 8px 14px;
  font-size: 13px;
  cursor: pointer;
}

.btn-primary {
  border: none;
  border-radius: 8px;
  background: #4a90e2;
  color: #fff;
  padding: 8px 16px;
  font-size: 13px;
  cursor: pointer;
}

.btn-primary:hover {
  background: #3a7bd5;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
