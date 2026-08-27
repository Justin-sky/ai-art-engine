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
      :style="{ aspectRatio: `${norm.width} / ${norm.height}` }"
      @pointerdown="onPagePointerDown"
      @pointermove="onPagePointerMove"
      @pointerup="onPagePointerUp"
      @pointercancel="onPagePointerUp"
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
          :class="{ 'grid-cell--occupied': cell.occupied }"
          :style="cellStyle(cell)"
          tabindex="-1"
        />
      </template>

      <template v-if="norm.panels.length">
        <div
          v-for="panel in norm.panels"
          :key="panel.id"
          class="panel"
          :class="{ 'panel--selected': selectedPanelId === panel.id && !selectedBubbleId }"
          :style="panelStyle(panel)"
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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
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
  'edit-end': []
}>()

const { t } = useStudioI18n()
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
  return {
    left: `${(rect.x / w) * 100}%`,
    top: `${(rect.y / h) * 100}%`,
    width: `${(rect.width / w) * 100}%`,
    height: `${(rect.height / h) * 100}%`
  }
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
    top: `${(y / h) * 100}%`
  }
}

watch(
  () => props.page,
  () => {
    void refreshThumbs()
  },
  { immediate: true, deep: true }
)

function clientToPage(e: PointerEvent): { x: number; y: number } | null {
  const el = pageEl.value
  if (!el) return null
  const box = el.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return null
  return {
    x: ((e.clientX - box.left) / box.width) * norm.value.width,
    y: ((e.clientY - box.top) / box.height) * norm.value.height
  }
}

const drag = ref<{ panelId: string; bubbleId: string } | null>(null)

function onPagePointerDown(e: PointerEvent): void {
  if (!props.editable || e.button !== 0) return
  const pt = clientToPage(e)
  if (!pt) return
  const bubble = findComicBubbleAtPagePoint(norm.value, pt.x, pt.y)
  if (bubble) {
    emit('select', { kind: 'bubble', panelId: bubble.panelId, bubbleId: bubble.bubbleId })
    drag.value = bubble
    pageEl.value?.setPointerCapture(e.pointerId)
    e.preventDefault()
    return
  }
  const panel = findComicPanelAtPagePoint(norm.value, pt.x, pt.y)
  if (panel) {
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
  if (!drag.value) return
  const pt = clientToPage(e)
  if (!pt) return
  const pos = pagePointToBubbleNorm(norm.value, drag.value.panelId, pt.x, pt.y)
  if (!pos) return
  emit('move-bubble', drag.value.panelId, drag.value.bubbleId, pos)
}

function onPagePointerUp(): void {
  const wasDragging = !!drag.value
  drag.value = null
  if (wasDragging) emit('edit-end')
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
  background: #fdfdfd;
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
