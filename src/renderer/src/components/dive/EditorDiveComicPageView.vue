<template>
  <div class="dive-view comic-page-dive">
    <header class="toolbar">
      <button
        type="button"
        :disabled="showGlobal"
        @click="showGlobalProps"
      >
        {{ t('graph.inspector.comicPage.globalSection') }}
      </button>
      <button
        type="button"
        @click="addEmptyPanel"
      >
        {{ t('graph.inspector.comicPage.addPanel') }}
      </button>
      <button
        type="button"
        :disabled="!selectedPanel"
        @click="removeSelectedPanel"
      >
        {{ t('graph.inspector.comicPage.removePanel') }}
      </button>
      <button
        type="button"
        :disabled="!selectedPanel"
        @click="addBubbleToSelected"
      >
        {{ t('graph.inspector.comicPage.addBubble') }}
      </button>
      <button
        type="button"
        :disabled="!selectedBubble"
        @click="removeSelectedBubble"
      >
        {{ t('graph.inspector.comicPage.removeBubble') }}
      </button>
      <span class="spacer" />
      <button
        type="button"
        :disabled="page.panels.length === 0"
        @click="canvasRef?.exportPng()"
      >
        {{ t('graph.inspector.comicPage.exportPng') }}
      </button>
      <button
        type="button"
        class="done"
        @click="onClose"
      >
        {{ t('graph.inspector.comicPage.done') }}
      </button>
    </header>

    <div class="body">
      <ComicPageCanvas
        ref="canvasRef"
        class="canvas"
        :page="page"
        editable
        exportable
        :export-name="exportName"
        :selected-panel-id="selectedPanelId"
        :selected-bubble-id="selectedBubbleId"
        @select="onSelect"
        @move-bubble="onMoveBubble"
        @resize-panel="onResizePanel"
        @resize-bubble="onResizeBubble"
        @edit-end="persist"
        @drop-image="onDropImage"
        @remove-image="onRemoveImage"
      />

      <aside class="side">
        <!-- 未选中分格/气泡（即点击了画布空白处）时显示页面全局属性 -->
        <template v-if="showGlobal">
          <h3>{{ t('graph.inspector.comicPage.globalSection') }}</h3>
          <label>
            {{ t('graph.inspector.comicPage.pageTitle') }}
            <input
              :value="page.title ?? ''"
              @change="onPageTitle(($event.target as HTMLInputElement).value)"
            >
          </label>
          <div class="row">
            <label>
              {{ t('graph.inspector.comicPage.columns') }}
              <input
                type="number"
                min="1"
                max="12"
                :value="page.columns"
                @change="onMetaNumber('columns', $event)"
              >
            </label>
            <label>
              {{ t('graph.inspector.comicPage.rows') }}
              <input
                type="number"
                min="1"
                max="12"
                :value="page.rows"
                @change="onMetaNumber('rows', $event)"
              >
            </label>
          </div>
          <label>
            {{ t('graph.inspector.comicPage.gutter') }}
            <input
              type="number"
              min="0"
              :value="page.gutter"
              @change="onMetaNumber('gutter', $event)"
            >
          </label>
          <div class="row">
            <label>
              {{ t('graph.inspector.comicPage.width') }}
              <input
                type="number"
                min="1"
                :value="page.width"
                @change="onMetaNumber('width', $event)"
              >
            </label>
            <label>
              {{ t('graph.inspector.comicPage.height') }}
              <input
                type="number"
                min="1"
                :value="page.height"
                @change="onMetaNumber('height', $event)"
              >
            </label>
          </div>
          <label>
            {{ t('graph.inspector.comicPage.bgColor') }}
            <input
              type="color"
              class="color-input"
              :title="page.backgroundColor?.trim() || t('graph.inspector.comicPage.bgTransparent')"
              :value="pageBgHex"
              @input="onBackgroundColor(($event.target as HTMLInputElement).value, false)"
              @change="onBackgroundColor(($event.target as HTMLInputElement).value, true)"
            >
          </label>
          <div class="row">
            <button
              type="button"
              :disabled="!page.backgroundColor?.trim()"
              @click="onBackgroundColor('', true)"
            >
              {{ t('graph.inspector.comicPage.bgTransparent') }}
            </button>
          </div>
          <p class="hint">{{ t('graph.inspector.comicPage.gridHint') }}</p>
        </template>

        <template v-if="selectedPanel">
          <h3>{{ t('graph.inspector.comicPage.panelSection') }}</h3>
          <label>
            {{ t('graph.inspector.comicPage.panelTitle') }}
            <input
              :value="selectedPanel.title ?? ''"
              @change="patchSelectedPanel({ title: ($event.target as HTMLInputElement).value })"
            >
          </label>
          <div class="row">
            <label>
              colSpan
              <input
                type="number"
                min="1"
                :value="selectedPanel.colSpan"
                @change="onSpan('colSpan', $event)"
              >
            </label>
            <label>
              rowSpan
              <input
                type="number"
                min="1"
                :value="selectedPanel.rowSpan"
                @change="onSpan('rowSpan', $event)"
              >
            </label>
          </div>
          <label>
            {{ t('graph.inspector.comicPage.panelImage') }}
            <input
              :value="selectedPanel.imageUrl ?? ''"
              @change="patchSelectedPanel({ imageUrl: ($event.target as HTMLInputElement).value })"
            >
          </label>
          <div class="row">
            <button
              type="button"
              @click="pickLocalImage"
            >
              {{ t('graph.inspector.comicPage.pickImage') }}
            </button>
            <button
              type="button"
              @click="patchSelectedPanel({ imageUrl: '' })"
            >
              {{ t('graph.inspector.comicPage.clearImage') }}
            </button>
          </div>
          <label>
            {{ t('graph.inspector.comicPage.bgColor') }}
            <input
              type="color"
              class="color-input"
              :title="
                selectedPanel.backgroundColor?.trim() ||
                t('graph.inspector.comicPage.bgTransparent')
              "
              :value="panelBgHex"
              @input="onPanelBackgroundColor(($event.target as HTMLInputElement).value, false)"
              @change="onPanelBackgroundColor(($event.target as HTMLInputElement).value, true)"
            >
          </label>
          <div class="row">
            <button
              type="button"
              :disabled="!selectedPanel.backgroundColor?.trim()"
              @click="onPanelBackgroundColor('', true)"
            >
              {{ t('graph.inspector.comicPage.bgTransparent') }}
            </button>
          </div>
          <div
            v-if="incomingImages.length"
            class="incoming"
          >
            <span class="field-label">{{ t('graph.inspector.comicPage.pickIncoming') }}</span>
            <button
              v-for="item in incomingImages"
              :key="item.url"
              type="button"
              class="incoming-item"
              @click="patchSelectedPanel({ imageUrl: item.url })"
            >
              {{ item.label }}
            </button>
          </div>
        </template>

        <template v-if="selectedBubble">
          <h3>{{ t('graph.inspector.comicPage.bubbleSection') }}</h3>
          <label>
            {{ t('graph.inspector.comicPage.bubbleText') }}
            <textarea
              rows="3"
              :value="selectedBubble.text"
              @change="patchSelectedBubble({ text: ($event.target as HTMLTextAreaElement).value })"
            />
          </label>
          <label>
            {{ t('graph.inspector.comicPage.speaker') }}
            <input
              :value="selectedBubble.speaker ?? ''"
              @change="patchSelectedBubble({ speaker: ($event.target as HTMLInputElement).value })"
            >
          </label>
          <label>
            {{ t('graph.inspector.comicPage.tail') }}
            <select
              :value="selectedBubble.tail"
              @change="patchSelectedBubble({ tail: ($event.target as HTMLSelectElement).value as ComicBubbleTail })"
            >
              <option value="tl">tl</option>
              <option value="tr">tr</option>
              <option value="bl">bl</option>
              <option value="br">br</option>
            </select>
          </label>
        </template>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue'
import {
  addComicBubble,
  addComicPanel,
  comicOccupiedCellKeys,
  createComicPage,
  findEmptyComicCell,
  parseComicPage,
  readComicPageFromGenParams,
  removeComicBubble,
  removeComicPanel,
  serializeComicPage,
  updateComicBubble,
  upsertComicPanel,
  withComicPageLayout,
  type ComicBubbleTail,
  type ComicPage,
  type ComicPanel
} from '@shared/graph'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useProjectStore } from '../../stores/project'
import ComicPageCanvas, { type ComicPageCanvasHit } from '../ComicPageCanvas.vue'

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const { t } = useStudioI18n()
const editorDive = inject(editorDiveKey, null)
const project = useProjectStore()
const canvasRef = ref<{ exportPng: () => Promise<void> } | null>(null)

const page = ref<ComicPage>(createComicPage())
const dirty = ref(false)
const selectedPanelId = ref<string | null>(null)
const selectedBubbleId = ref<string | null>(null)

const node = computed(() => graphEditorHosts.getNode(props.hostId, props.nodeId))
const exportName = computed(() => (node.value?.title || t('graph.types.comic.page')).trim())

const selectedPanel = computed(
  () => page.value.panels.find((item) => item.id === selectedPanelId.value) ?? null
)
const selectedBubble = computed(() => {
  if (!selectedPanel.value || !selectedBubbleId.value) return null
  return selectedPanel.value.bubbles.find((item) => item.id === selectedBubbleId.value) ?? null
})

/** 点击画布空白处（无选中分格/气泡）→ 显示页面全局属性 */
const showGlobal = computed(() => !selectedPanel.value && !selectedBubble.value)

/** 原生 color 控件只认 #rrggbb；未设置/透明/非六位十六进制时回退占位色 */
function cssHexOrFallback(raw: string | null | undefined): string {
  const value = raw?.trim() ?? ''
  return /^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'
}
const pageBgHex = computed(() => cssHexOrFallback(page.value.backgroundColor))
const panelBgHex = computed(() => cssHexOrFallback(selectedPanel.value?.backgroundColor))

const incomingImages = computed(() => {
  void graphEditorHosts.revision.value
  const edges = [
    ...graphEditorHosts.listIncomingEdges(props.hostId, props.nodeId, 'in-image'),
    ...graphEditorHosts.listIncomingEdges(props.hostId, props.nodeId, 'in')
  ]
  const seen = new Set<string>()
  const items: Array<{ label: string; url: string }> = []
  const push = (label: string, url: string): void => {
    const next = url.trim()
    if (!next || seen.has(next)) return
    seen.add(next)
    items.push({ label, url: next })
  }
  for (const edge of edges) {
    const source = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
    if (!source) continue
    const title = source.title?.trim() || source.typeId
    const preview = source.params.previewRelativePath?.trim()
    if (preview) push(`${title} #${edge.index}`, preview)
    for (const image of source.params.generatedImages ?? []) {
      push(`${title}`, image.relativePath?.trim() || image.dataUrl?.trim() || '')
    }
  }
  return items
})

function load(): void {
  const current = node.value
  page.value = readComicPageFromGenParams(current?.params) ?? createComicPage()
  dirty.value = false
}

watch(
  () => [props.hostId, props.nodeId, graphEditorHosts.revision.value] as const,
  () => {
    if (dirty.value) return
    load()
  },
  { immediate: true }
)

function commit(next: ComicPage, options?: { persist?: boolean }): void {
  page.value = next
  dirty.value = true
  if (selectedPanelId.value && !next.panels.some((item) => item.id === selectedPanelId.value)) {
    selectedPanelId.value = null
    selectedBubbleId.value = null
  }
  if (options?.persist !== false) persist()
}

function persist(): void {
  if (!dirty.value) return
  const parsed = parseComicPage(serializeComicPage(page.value))
  if (!parsed) return
  graphEditorHosts.updateNode(props.hostId, props.nodeId, {
    comicPage: serializeComicPage(parsed)
  })
  dirty.value = false
}

useEditorDiveFrameFlush(() => props.frameKey, persist)

function onClose(): void {
  persist()
  if (!editorDive) return
  const idx = editorDive.frames.findIndex((frame) => frame.key === props.frameKey)
  editorDive.popTo(idx < 0 ? -1 : idx - 1)
}

function onPageTitle(value: string): void {
  commit(withComicPageLayout(page.value, { title: value }))
}

/** 取色实时拖动（persistNow=false）只刷预览不落盘，关闭/确认时才持久化 */
function onBackgroundColor(value: string, persistNow: boolean): void {
  commit(withComicPageLayout(page.value, { backgroundColor: value }), { persist: persistNow })
}

function onPanelBackgroundColor(value: string, persistNow: boolean): void {
  patchSelectedPanel({ backgroundColor: value }, { persist: persistNow })
}

function onMetaNumber(
  key: 'columns' | 'rows' | 'gutter' | 'width' | 'height',
  event: Event
): void {
  const n = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  commit(withComicPageLayout(page.value, { [key]: n }))
}

function addEmptyPanel(): void {
  const empty = findEmptyComicCell(page.value)
  if (!empty) return
  addPanelAtEmpty(empty.row, empty.col)
}

/** 回到页面全局属性（清空选中） */
function showGlobalProps(): void {
  selectedPanelId.value = null
  selectedBubbleId.value = null
}

function addPanelAtEmpty(row: number, col: number, imageUrl?: string): void {
  const occupied = comicOccupiedCellKeys(page.value)
  if (occupied.has(`${row},${col}`)) return
  const next = addComicPanel(page.value, { row, col, ...(imageUrl ? { imageUrl } : {}) })
  const added = next.panels.find((panel) => !page.value.panels.some((prev) => prev.id === panel.id))
  commit(next)
  selectedPanelId.value = added?.id ?? selectedPanelId.value
  selectedBubbleId.value = null
}

function onDropImage(hit: ComicPageCanvasHit, imageUrl: string): void {
  if (hit.kind === 'panel') {
    const panel = page.value.panels.find((item) => item.id === hit.panelId)
    if (!panel) return
    selectedPanelId.value = hit.panelId
    selectedBubbleId.value = null
    commit(upsertComicPanel(page.value, { ...panel, imageUrl }))
    return
  }
  if (hit.kind === 'cell') {
    addPanelAtEmpty(hit.row, hit.col, imageUrl)
  }
}

function onRemoveImage(panelId: string): void {
  const panel = page.value.panels.find((item) => item.id === panelId)
  if (!panel) return
  commit(upsertComicPanel(page.value, { ...panel, imageUrl: '' }))
}

function removeSelectedPanel(): void {
  if (!selectedPanelId.value) return
  commit(removeComicPanel(page.value, selectedPanelId.value))
  selectedPanelId.value = null
  selectedBubbleId.value = null
}

function addBubbleToSelected(): void {
  if (!selectedPanelId.value) return
  const next = addComicBubble(page.value, selectedPanelId.value, {
    text: t('graph.inspector.comicPage.bubblePlaceholder'),
    x: 0.5,
    y: 0.25,
    tail: 'tl'
  })
  const panel = next.panels.find((item) => item.id === selectedPanelId.value)
  const last = panel?.bubbles[panel.bubbles.length - 1]
  commit(next)
  selectedBubbleId.value = last?.id ?? null
}

function removeSelectedBubble(): void {
  if (!selectedPanelId.value || !selectedBubbleId.value) return
  commit(removeComicBubble(page.value, selectedPanelId.value, selectedBubbleId.value))
  selectedBubbleId.value = null
}

function patchSelectedPanel(patch: Partial<ComicPanel>, options?: { persist?: boolean }): void {
  const current = selectedPanel.value
  if (!current) return
  commit(upsertComicPanel(page.value, { ...current, ...patch }), options)
}

function onSpan(key: 'colSpan' | 'rowSpan', event: Event): void {
  const n = Number((event.target as HTMLInputElement).value)
  if (!Number.isFinite(n)) return
  patchSelectedPanel({ [key]: n })
}

function patchSelectedBubble(patch: Partial<{ text: string; speaker: string; tail: ComicBubbleTail }>): void {
  if (!selectedPanelId.value || !selectedBubbleId.value) return
  commit(updateComicBubble(page.value, selectedPanelId.value, selectedBubbleId.value, patch))
}

function onMoveBubble(panelId: string, bubbleId: string, pos: { x: number; y: number }): void {
  selectedPanelId.value = panelId
  selectedBubbleId.value = bubbleId
  commit(updateComicBubble(page.value, panelId, bubbleId, pos), { persist: false })
}

/** 分镜格跨格调整（拖动手柄过程中只刷预览，edit-end 统一持久化） */
function onResizePanel(panelId: string, span: { colSpan: number; rowSpan: number }): void {
  const panel = page.value.panels.find((item) => item.id === panelId)
  if (!panel) return
  if (panel.colSpan === span.colSpan && panel.rowSpan === span.rowSpan) return
  commit(upsertComicPanel(page.value, { ...panel, ...span }), { persist: false })
}

/** 气泡缩放（拖动手柄过程中只刷预览，edit-end 统一持久化） */
function onResizeBubble(panelId: string, bubbleId: string, scale: number): void {
  const panel = page.value.panels.find((item) => item.id === panelId)
  const bubble = panel?.bubbles.find((item) => item.id === bubbleId)
  if (!bubble || (bubble.scale ?? 1) === scale) return
  commit(updateComicBubble(page.value, panelId, bubbleId, { scale }), { persist: false })
}

function onSelect(hit: ComicPageCanvasHit): void {
  if (hit.kind === 'bubble') {
    selectedPanelId.value = hit.panelId
    selectedBubbleId.value = hit.bubbleId
    return
  }
  if (hit.kind === 'panel') {
    selectedPanelId.value = hit.panelId
    selectedBubbleId.value = null
    return
  }
  // 点空白处/空格：不再自动建格，统一清选并显示全局属性（建格走工具栏或拖图入空格）
  selectedPanelId.value = null
  selectedBubbleId.value = null
}

async function pickLocalImage(): Promise<void> {
  if (!selectedPanel.value) return
  const filePaths = await window.studio.selectFiles([
    { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
  ])
  if (!filePaths?.length) return
  const result = await window.studio.importAssets({
    filePaths: filePaths.slice(0, 1),
    folderId: null
  })
  project.patchAssets(result.imported)
  const asset = result.imported[0]
  const url = asset?.relativePath?.trim()
  if (url) patchSelectedPanel({ imageUrl: url })
}
</script>

<style scoped>
.comic-page-dive {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
}
.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.toolbar button {
  padding: 4px 10px;
  font-size: 12px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.toolbar button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.toolbar button.done {
  color: var(--accent);
  border-color: var(--accent);
}
.spacer {
  flex: 1;
}
.body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 12px;
  padding: 12px;
}
.canvas {
  min-width: 0;
  min-height: 0;
}
.side {
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px 16px;
}
.side h3 {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}
.side label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
.side input,
.side textarea,
.side select {
  box-sizing: border-box;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
}
.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.side input.color-input {
  box-sizing: border-box;
  height: 30px;
  padding: 2px;
  cursor: pointer;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}
.field-label {
  font-size: 11px;
  color: var(--text-muted);
}
.incoming {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.incoming-item {
  text-align: left;
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
.side .row > button {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  cursor: pointer;
}
</style>
