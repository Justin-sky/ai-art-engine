<template>
  <div class="comic-page-wrap">
    <div
      v-if="exportable"
      class="head"
    >
      <button
        type="button"
        class="export-btn"
        :disabled="exporting || norm.panels.length === 0"
        @click="exportPng"
      >
        {{ exporting ? t('graph.inspector.comicPage.exporting') : t('graph.inspector.comicPage.exportPng') }}
      </button>
      <span
        v-if="exportMessage"
        class="export-msg"
        :class="{ 'export-msg--error': exportFailed }"
      >
        {{ exportMessage }}
      </span>
    </div>

    <div
      ref="pageEl"
      class="comic-page"
      :class="{
        'comic-page--empty': !editable && norm.panels.length === 0,
        'comic-page--editable': editable
      }"
      :style="{
        aspectRatio: `${norm.width} / ${norm.height}`,
        ...(norm.backgroundColor ? { background: norm.backgroundColor } : {})
      }"
      @pointerdown="onPagePointerDown"
      @pointermove="onPagePointerMove"
      @pointerup="onPagePointerUp"
      @pointercancel="onPagePointerUp"
      @dragenter="onPageDragEnter"
      @dragover="onPageDragOver"
      @dragleave="onPageDragLeave"
      @drop="onPageDrop"
    >
      <div
        v-if="norm.title"
        class="page-title"
      >
        {{ norm.title }}
      </div>

      <template v-if="editable">
        <button
          v-for="cell in gridCells"
          :key="`cell-${cell.row}-${cell.col}`"
          type="button"
          class="grid-cell"
          :class="{
            'grid-cell--occupied': cell.occupied,
            'grid-cell--drag-over': editable && dragOverKey === `cell:${cell.row},${cell.col}`
          }"
          :style="cellStyle(cell)"
          tabindex="-1"
        />
      </template>

      <template v-if="norm.panels.length">
        <div
          v-for="panel in norm.panels"
          :key="panel.id"
          class="panel"
          :class="{
            'panel--selected': selectedPanelId === panel.id && !selectedBubbleId,
            'panel--drag-over': editable && dragOverKey === `panel:${panel.id}`
          }"
          :style="[panelStyle(panel), panelResizeOverlay(panel)]"
        >
          <img
            v-if="thumbs[panel.imageUrl ?? '']"
            :src="thumbs[panel.imageUrl ?? '']"
            class="panel-img"
            alt=""
            draggable="false"
          >
          <span
            v-else
            class="panel-placeholder"
          >
            {{ panel.title || t('graph.inspector.comicPage.panelFallback') }}
          </span>
          <span
            v-if="panel.title && thumbs[panel.imageUrl ?? '']"
            class="panel-title"
          >
            {{ panel.title }}
          </span>
          <button
            v-if="editable && selectedPanelId === panel.id && !selectedBubbleId && panel.imageUrl"
            type="button"
            class="panel-remove-img"
            :title="t('graph.inspector.comicPage.clearImage')"
            @pointerdown.stop
            @click.stop="emit('remove-image', panel.id)"
          >×</button>
          <!-- 调整大小手柄：右缘改列跨、下缘改行跨、右下角两者联动（跨格数随拖动吸附） -->
          <template v-if="editable && selectedPanelId === panel.id && !selectedBubbleId">
            <span
              class="rs rs-r"
              @pointerdown.stop.prevent="onPanelResizeDown($event, panel, 'x')"
            />
            <span
              class="rs rs-b"
              @pointerdown.stop.prevent="onPanelResizeDown($event, panel, 'y')"
            />
            <span
              class="rs rs-br"
              @pointerdown.stop.prevent="onPanelResizeDown($event, panel, 'xy')"
            />
          </template>
        </div>
      </template>
      <span
        v-else-if="!editable"
        class="empty-hint"
      >
        {{ t('graph.inspector.comicPage.emptyPanels') }}
      </span>

      <div
        v-for="bubbleHit in bubbleHits"
        :key="bubbleHit.bubble.id"
        class="bubble"
        :class="[
          `tail-${bubbleHit.bubble.tail}`,
          { 'bubble--selected': selectedBubbleId === bubbleHit.bubble.id }
        ]"
        :style="bubbleStyle(bubbleHit.panel, bubbleHit.bubble)"
      >
        <span
          v-if="bubbleHit.bubble.speaker"
          class="speaker"
        >
          {{ bubbleHit.bubble.speaker }}
        </span>
        <span class="text">{{ bubbleHit.bubble.text }}</span>
        <!-- 缩放手柄：按住拖动等比缩放气泡 -->
        <button
          v-if="editable && selectedBubbleId === bubbleHit.bubble.id"
          type="button"
          class="bubble-resize"
          tabindex="-1"
          @pointerdown.stop.prevent="onBubbleScaleDown($event, bubbleHit.panel, bubbleHit.bubble)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  COMIC_BUBBLE_MAX_SCALE,
  COMIC_BUBBLE_MIN_SCALE,
  comicBubblePagePoint,
  comicPanelRects,
  findComicBubbleAtPagePoint,
  findComicCellAtPagePoint,
  findComicPanelAtPagePoint,
  normalizeComicPage,
  pagePointToBubbleNorm,
  type ComicPage,
  type ComicPanel,
  type ComicSpeechBubble
} from '@shared/graph'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { composeComicPageImage } from '../features/comic/composeComicPageImage'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME,
  useWorkspaceStore
} from '../stores/workspace'

export type ComicPageCanvasHit =
  | { kind: 'none' }
  | { kind: 'cell'; row: number; col: number }
  | { kind: 'panel'; panelId: string }
  | { kind: 'bubble'; panelId: string; bubbleId: string }

const props = defineProps<{
  page: ComicPage
  exportable?: boolean
  exportName?: string
  editable?: boolean
  selectedPanelId?: string | null
  selectedBubbleId?: string | null
}>()

const emit = defineEmits<{
  select: [hit: ComicPageCanvasHit]
  'move-bubble': [panelId: string, bubbleId: string, pos: { x: number; y: number }]
  'resize-panel': [panelId: string, span: { colSpan: number; rowSpan: number }]
  'resize-bubble': [panelId: string, bubbleId: string, scale: number]
  'edit-end': []
  'drop-image': [hit: ComicPageCanvasHit, imageUrl: string]
  'remove-image': [panelId: string]
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const pageEl = ref<HTMLElement | null>(null)
const norm = computed<ComicPage>(() => normalizeComicPage(props.page))
const rects = computed(() => comicPanelRects(norm.value))
const thumbs = ref<Record<string, string>>({})

const bubbleHits = computed(() => {
  const items: Array<{ panel: ComicPanel; bubble: ComicSpeechBubble }> = []
  for (const panel of norm.value.panels) {
    for (const bubble of panel.bubbles) items.push({ panel, bubble })
  }
  return items
})

const occupied = computed(() => {
  const keys = new Set<string>()
  for (const panel of norm.value.panels) {
    for (let r = panel.row; r < panel.row + panel.rowSpan; r++) {
      for (let c = panel.col; c < panel.col + panel.colSpan; c++) {
        keys.add(`${r},${c}`)
      }
    }
  }
  return keys
})

const gridCells = computed(() => {
  const cells: Array<{ row: number; col: number; occupied: boolean }> = []
  for (let row = 0; row < norm.value.rows; row++) {
    for (let col = 0; col < norm.value.columns; col++) {
      cells.push({ row, col, occupied: occupied.value.has(`${row},${col}`) })
    }
  }
  return cells
})

async function resolveThumb(url: string): Promise<string> {
  if (!url) return ''
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  return resolveAssetPreviewUrl(url)
}

async function refreshThumbs(): Promise<void> {
  const urls = new Set<string>()
  for (const panel of norm.value.panels) if (panel.imageUrl) urls.add(panel.imageUrl)
  const next: Record<string, string> = {}
  await Promise.all(
    [...urls].map(async (url) => {
      const resolved = await resolveThumb(url)
      if (resolved) next[url] = resolved
    })
  )
  thumbs.value = next
}

function panelStyle(panel: ComicPanel): Record<string, string> {
  const rect = rects.value.get(panel.id)
  if (!rect) return {}
  const w = norm.value.width || 1
  const h = norm.value.height || 1
  const style: Record<string, string> = {
    left: `${(rect.x / w) * 100}%`,
    top: `${(rect.y / h) * 100}%`,
    width: `${(rect.width / w) * 100}%`,
    height: `${(rect.height / h) * 100}%`
  }
  const bg = panel.backgroundColor?.trim()
  if (bg) style.background = bg
  return style
}

function cellStyle(cell: { row: number; col: number }): Record<string, string> {
  const { columns, rows, gutter, width, height } = norm.value
  const colW = Math.max(1, (width - (columns - 1) * gutter) / columns)
  const rowH = Math.max(1, (height - (rows - 1) * gutter) / rows)
  const x = cell.col * (colW + gutter)
  const y = cell.row * (rowH + gutter)
  return {
    left: `${(x / width) * 100}%`,
    top: `${(y / height) * 100}%`,
    width: `${(colW / width) * 100}%`,
    height: `${(rowH / height) * 100}%`
  }
}

function bubbleStyle(panel: ComicPanel, bubble: ComicSpeechBubble): Record<string, string> {
  const rect = rects.value.get(panel.id)
  if (!rect) return {}
  const w = norm.value.width || 1
  const h = norm.value.height || 1
  const x = rect.x + bubble.x * rect.width
  const y = rect.y + bubble.y * rect.height
  return {
    left: `${(x / w) * 100}%`,
    top: `${(y / h) * 100}%`,
    transform: `translate(-50%, -50%) scale(${bubble.scale ?? 1})`
  }
}

watch(
  () => props.page,
  () => {
    void refreshThumbs()
  },
  { immediate: true, deep: true }
)

function clientToPage(e: { clientX: number; clientY: number }): { x: number; y: number } | null {
  const el = pageEl.value
  if (!el) return null
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  return {
    x: ((e.clientX - box.left) / box.width) * norm.value.width,
    y: ((e.clientY - box.top) / box.height) * norm.value.height
  }
}

/** 拖拽会话：拖动气泡 / 分镜格跨格调整 / 气泡缩放 */
type CanvasDrag =
  | { kind: 'bubble'; panelId: string; bubbleId: string }
  | {
      kind: 'panel-resize'
      panelId: string
      axis: 'x' | 'y' | 'xy'
      startX: number
      startY: number
      /** 按下时的原始矩形快照（跨度换算基准） */
      rect: { x: number; y: number; width: number; height: number }
      col0: number
      row0: number
      lastColSpan: number
      lastRowSpan: number
    }
  | {
      kind: 'bubble-scale'
      panelId: string
      bubbleId: string
      anchorX: number
      anchorY: number
      startDist: number
      startScale: number
      lastScale: number
    }

const drag = ref<CanvasDrag | null>(null)

/** 拖动中分镜格的连续跟随尺寸（页面像素）；松手后清除并回到吸附跨度 */
const panelResize = ref<{ panelId: string; width: number; height: number } | null>(null)

function panelResizeOverlay(panel: ComicPanel): Record<string, string> {
  const st = panelResize.value
  if (!st || st.panelId !== panel.id) return {}
  return {
    width: `${(st.width / (norm.value.width || 1)) * 100}%`,
    height: `${(st.height / (norm.value.height || 1)) * 100}%`
  }
}

function onPagePointerDown(e: PointerEvent): void {
  if (!props.editable || e.button !== 0) return
  const pt = clientToPage(e)
  if (!pt) return
  const panel = findComicPanelAtPagePoint(norm.value, pt.x, pt.y)
  if (panel) {
    // 气泡热区（锚点半径 48px）只有落在所属分镜格内部才优先，避免吞掉格间空白的点击
    const bubble = findComicBubbleAtPagePoint(norm.value, pt.x, pt.y)
    if (bubble && bubble.panelId === panel.id) {
      emit('select', { kind: 'bubble', panelId: bubble.panelId, bubbleId: bubble.bubbleId })
      drag.value = { kind: 'bubble', panelId: bubble.panelId, bubbleId: bubble.bubbleId }
      pageEl.value?.setPointerCapture(e.pointerId)
      e.preventDefault()
      return
    }
    emit('select', { kind: 'panel', panelId: panel.id })
    return
  }
  const cell = findComicCellAtPagePoint(norm.value, pt.x, pt.y)
  if (cell) {
    emit('select', { kind: 'cell', row: cell.row, col: cell.col })
    return
  }
  emit('select', { kind: 'none' })
}

function onPagePointerMove(e: PointerEvent): void {
  const st = drag.value
  if (!st) return
  const pt = clientToPage(e)
  if (!pt) return

  if (st.kind === 'bubble') {
    const pos = pagePointToBubbleNorm(norm.value, st.panelId, pt.x, pt.y)
    if (pos) emit('move-bubble', st.panelId, st.bubbleId, pos)
    return
  }

  if (st.kind === 'panel-resize') {
    const n = norm.value
    const cellW = Math.max(1, (n.width - (n.columns - 1) * n.gutter) / n.columns)
    const cellH = Math.max(1, (n.height - (n.rows - 1) * n.gutter) / n.rows)
    // 先更新连续跟手预览（不吸附，随时可见变化）
    const colsLeft = n.columns - st.col0
    const rowsLeft = n.rows - st.row0
    const maxW = colsLeft * cellW + (colsLeft - 1) * n.gutter
    const maxH = rowsLeft * cellH + (rowsLeft - 1) * n.gutter
    const dragW =
      st.axis === 'y'
        ? st.rect.width
        : Math.min(maxW, Math.max(cellW * 0.5, st.rect.width + (pt.x - st.startX)))
    const dragH =
      st.axis === 'x'
        ? st.rect.height
        : Math.min(maxH, Math.max(cellH * 0.5, st.rect.height + (pt.y - st.startY)))
    panelResize.value = { panelId: st.panelId, width: dragW, height: dragH }

    // 跨度按单格节距吸附（含格间距）：span = round((原宽 + 拖动量 + gutter) / 节距)
    const pitchW = cellW + n.gutter
    const pitchH = cellH + n.gutter
    let colSpan = st.lastColSpan
    let rowSpan = st.lastRowSpan
    if (st.axis !== 'y') {
      colSpan = Math.min(
        n.columns - st.col0,
        Math.max(
          1,
          Math.round((st.rect.width + (pt.x - st.startX) + n.gutter) / pitchW)
        )
      )
    }
    if (st.axis !== 'x') {
      rowSpan = Math.min(
        n.rows - st.row0,
        Math.max(
          1,
          Math.round((st.rect.height + (pt.y - st.startY) + n.gutter) / pitchH)
        )
      )
    }
    if (colSpan !== st.lastColSpan || rowSpan !== st.lastRowSpan) {
      st.lastColSpan = colSpan
      st.lastRowSpan = rowSpan
      emit('resize-panel', st.panelId, { colSpan, rowSpan })
    }
    return
  }

  // bubble-scale：按距锚点距离的比例等比缩放
  const dist = Math.max(8, Math.hypot(pt.x - st.anchorX, pt.y - st.anchorY))
  const scale = Math.min(
    COMIC_BUBBLE_MAX_SCALE,
    Math.max(COMIC_BUBBLE_MIN_SCALE, (st.startScale * dist) / st.startDist)
  )
  const snapped = Math.round(scale * 100) / 100
  if (snapped !== st.lastScale) {
    st.lastScale = snapped
    emit('resize-bubble', st.panelId, st.bubbleId, snapped)
  }
}

function onPagePointerUp(): void {
  const wasDragging = !!drag.value
  drag.value = null
  panelResize.value = null
  if (wasDragging) emit('edit-end')
}

/** 分镜格跨格调整：按住边缘/角落手柄拖动 */
function onPanelResizeDown(e: PointerEvent, panel: ComicPanel, axis: 'x' | 'y' | 'xy'): void {
  const rect = rects.value.get(panel.id)
  const pt = clientToPage(e)
  if (!rect || !pt) return
  emit('select', { kind: 'panel', panelId: panel.id })
  drag.value = {
    kind: 'panel-resize',
    panelId: panel.id,
    axis,
    startX: pt.x,
    startY: pt.y,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    col0: panel.col,
    row0: panel.row,
    lastColSpan: panel.colSpan,
    lastRowSpan: panel.rowSpan
  }
  pageEl.value?.setPointerCapture(e.pointerId)
}

/** 气泡缩放：按距锚点距离等比缩放 */
function onBubbleScaleDown(
  e: PointerEvent,
  panel: ComicPanel,
  bubble: ComicSpeechBubble
): void {
  const anchor = comicBubblePagePoint(norm.value, panel.id, bubble.id)
  const pt = clientToPage(e)
  if (!anchor || !pt) return
  emit('select', { kind: 'bubble', panelId: panel.id, bubbleId: bubble.id })
  drag.value = {
    kind: 'bubble-scale',
    panelId: panel.id,
    bubbleId: bubble.id,
    anchorX: anchor.x,
    anchorY: anchor.y,
    startDist: Math.max(8, Math.hypot(pt.x - anchor.x, pt.y - anchor.y)),
    startScale: bubble.scale ?? 1,
    lastScale: bubble.scale ?? 1
  }
  pageEl.value?.setPointerCapture(e.pointerId)
}

/** 资产库拖入高亮目标：panel:<id> / cell:<row>,<col> */
const dragOverKey = ref<string | null>(null)

function isStudioAssetDrag(event: DragEvent): boolean {
  if (workspace.draggingAsset) return true
  const types = event.dataTransfer ? Array.from(event.dataTransfer.types) : []
  return (
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

function dropTargetAt(pt: { x: number; y: number }): ComicPageCanvasHit {
  const panel = findComicPanelAtPagePoint(norm.value, pt.x, pt.y)
  if (panel) return { kind: 'panel', panelId: panel.id }
  const cell = findComicCellAtPagePoint(norm.value, pt.x, pt.y)
  if (cell) return { kind: 'cell', row: cell.row, col: cell.col }
  return { kind: 'none' }
}

function dropTargetKey(hit: ComicPageCanvasHit): string | null {
  if (hit.kind === 'panel') return `panel:${hit.panelId}`
  if (hit.kind === 'cell') return `cell:${hit.row},${hit.col}`
  return null
}

function onPageDragEnter(event: DragEvent): void {
  if (!props.editable || !isStudioAssetDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onPageDragOver(event: DragEvent): void {
  if (!props.editable || !isStudioAssetDrag(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const pt = clientToPage(event)
  dragOverKey.value = pt ? dropTargetKey(dropTargetAt(pt)) : null
}

function onPageDragLeave(event: DragEvent): void {
  const next = event.relatedTarget as Node | null
  const zone = event.currentTarget as HTMLElement | null
  if (next && zone?.contains(next)) return
  dragOverKey.value = null
}

function onPageDrop(event: DragEvent): void {
  dragOverKey.value = null
  if (!props.editable || !isStudioAssetDrag(event)) return
  const asset = workspace.resolveDraggedAsset(event)
  if (!asset || asset.type !== 'image') return
  const url = asset.relativePath?.trim()
  if (!url) return
  const pt = clientToPage(event)
  if (!pt) return
  const target = dropTargetAt(pt)
  if (target.kind === 'none') return
  event.preventDefault()
  emit('drop-image', target, url)
}

const exporting = ref(false)
const exportMessage = ref('')
const exportFailed = ref(false)

async function resolveExportImage(url: string): Promise<string> {
  if (!url) return ''
  if (url.startsWith('data:') || /^https?:\/\//i.test(url)) return url
  try {
    const dataUrl = await window.studio.getAssetMediaDataUrl(url)
    if (dataUrl) return dataUrl
  } catch {
    /* 回退到预览 URL */
  }
  return resolveAssetPreviewUrl(url)
}

function dataUrlToBytes(url: string): Uint8Array {
  const match = url.match(/^data:[^;,]+(;base64)?,([\s\S]*)$/i)
  if (!match) throw new Error('invalid data URL')
  const isBase64 = !!match[1]
  const binary = isBase64 ? atob(match[2]!) : decodeURIComponent(match[2]!)
  const data = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i)
  return data
}

function safeFileBase(name: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, '-').replace(/\.+$/, '').trim()
  return base || 'comic-page'
}

async function exportPng(): Promise<void> {
  if (exporting.value || norm.value.panels.length === 0) return
  exporting.value = true
  exportMessage.value = ''
  exportFailed.value = false
  try {
    const result = await composeComicPageImage({
      page: norm.value,
      resolveImage: resolveExportImage
    })
    const data = dataUrlToBytes(result.dataUrl)
    const base = safeFileBase(props.exportName?.trim() || 'comic-page')
    const saved = await window.studio.saveBinaryFilesToDirectory({
      files: [{ fileName: `${base}.png`, data }]
    })
    if (!saved) {
      exportFailed.value = true
      exportMessage.value = t('graph.inspector.comicPage.exportCancel')
    } else {
      exportMessage.value = t('graph.inspector.comicPage.exportDone', { count: saved.written })
    }
  } catch (err) {
    exportFailed.value = true
    exportMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    exporting.value = false
  }
}

defineExpose({ exportPng })
</script>

<style scoped>
.comic-page-wrap {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  flex: 1;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.export-btn {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 6px;
  cursor: pointer;
}
.export-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.export-msg {
  font-size: 11px;
  color: var(--text-muted);
}
.export-msg--error {
  color: var(--danger);
}
.comic-page {
  position: relative;
  width: 100%;
  overflow: hidden;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  touch-action: none;
}
.comic-page--editable {
  cursor: crosshair;
  user-select: none;
}
.grid-cell {
  position: absolute;
  margin: 0;
  padding: 0;
  border: 1px dashed rgb(0 0 0 / 0.18);
  background: transparent;
  pointer-events: none;
  border-radius: 3px;
}
.grid-cell--occupied {
  border-color: transparent;
}
.grid-cell--drag-over {
  border-color: var(--success, #16a34a);
  background: color-mix(in srgb, var(--success, #16a34a) 14%, transparent);
}
.panel {
  position: absolute;
  overflow: hidden;
  background: #f2f2f2;
  border: 1px solid #d8d8d8;
  border-radius: 4px;
  z-index: 1;
}
.panel--selected {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  z-index: 2;
}
.panel--drag-over {
  outline: 2px solid var(--success, #16a34a);
  outline-offset: -2px;
  z-index: 2;
}
.panel-remove-img {
  position: absolute;
  top: 4px;
  right: 4px;
  z-index: 5;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  font-size: 14px;
  line-height: 1;
  color: #fff;
  background: rgb(0 0 0 / 0.55);
  border: none;
  border-radius: 50%;
  cursor: pointer;
}
.panel-remove-img:hover {
  background: var(--danger, #e05a5a);
}
/* 分镜格大小调整手柄：右缘(列跨)/下缘(行跨)/右下角(联动) */
.rs {
  position: absolute;
  z-index: 6;
  background: var(--accent);
  border: 1px solid rgb(255 255 255 / 0.9);
  touch-action: none;
}
.rs-r {
  right: 0;
  top: 50%;
  width: 7px;
  height: 26px;
  transform: translateY(-50%);
  border-radius: 3px 0 0 3px;
  cursor: ew-resize;
}
.rs-b {
  bottom: 0;
  left: 50%;
  width: 26px;
  height: 7px;
  transform: translateX(-50%);
  border-radius: 0 0 3px 3px;
  cursor: ns-resize;
}
.rs-br {
  right: 0;
  bottom: 0;
  width: 14px;
  height: 14px;
  border-radius: 3px 0 3px 0;
  cursor: nwse-resize;
}
/* 气泡缩放手柄 */
.bubble-resize {
  position: absolute;
  right: -8px;
  bottom: -8px;
  z-index: 2;
  width: 16px;
  height: 16px;
  padding: 0;
  font-size: 0;
  color: transparent;
  background: #fff;
  border: 2px solid var(--accent);
  border-radius: 50%;
  cursor: nwse-resize;
  pointer-events: auto;
}
.panel-img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  pointer-events: none;
}
.panel-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  text-align: center;
  font-size: 11px;
  color: var(--text-muted);
  pointer-events: none;
}
.panel-title {
  position: absolute;
  left: 4px;
  bottom: 4px;
  padding: 1px 6px;
  font-size: 10px;
  line-height: 1.5;
  color: #fff;
  background: rgb(0 0 0 / 0.55);
  border-radius: 3px;
  pointer-events: none;
}
.bubble {
  position: absolute;
  z-index: 3;
  transform: translate(-50%, -50%);
  max-width: 30%;
  padding: 6px 10px;
  font-size: 12px;
  line-height: 1.4;
  color: #1a1a1a;
  background: #fff;
  border: 1px solid #d0d0d0;
  border-radius: 10px;
  box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
  pointer-events: none;
}
.bubble--selected {
  outline: 2px solid var(--accent);
  z-index: 4;
}
.bubble .speaker {
  display: block;
  margin-bottom: 2px;
  font-size: 10px;
  font-weight: 600;
  color: var(--accent);
}
.bubble .text {
  display: block;
  word-break: break-word;
}
.bubble::after {
  content: '';
  position: absolute;
  width: 0;
  height: 0;
}
.bubble.tail-tl::after {
  top: -8px;
  left: 16px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 8px solid #fff;
}
.bubble.tail-tr::after {
  top: -8px;
  right: 16px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-bottom: 8px solid #fff;
}
.bubble.tail-bl::after {
  bottom: -8px;
  left: 16px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 8px solid #fff;
}
.bubble.tail-br::after {
  bottom: -8px;
  right: 16px;
  border-left: 7px solid transparent;
  border-right: 7px solid transparent;
  border-top: 8px solid #fff;
}
.page-title {
  position: absolute;
  top: 6px;
  left: 8px;
  z-index: 1;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 600;
  color: #1a1a1a;
  background: rgb(255 255 255 / 0.85);
  border-radius: 4px;
  pointer-events: none;
}
.empty-hint {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
