<template>
  <div class="dive-view comic-page-dive">
    <header class="toolbar">
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
        @edit-end="persist"
      />

      <aside class="side">
        <label>
          {{ t('graph.inspector.comicPage.pageTitle') }}
          <input
            :value="page.title ?? ''"
            @change="onMeta('title', ($event.target as HTMLInputElement).value)"
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
        <p class="hint">{{ t('graph.inspector.comicPage.gridHint') }}</p>

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

function onMeta(key: 'title', value: string): void {
  commit(withComicPageLayout(page.value, { [key]: value }))
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

function addPanelAtEmpty(row: number, col: number): void {
  const occupied = comicOccupiedCellKeys(page.value)
  if (occupied.has(`${row},${col}`)) return
  const next = addComicPanel(page.value, { row, col })
  const added = next.panels.find((panel) => !page.value.panels.some((prev) => prev.id === panel.id))
  commit(next)
  selectedPanelId.value = added?.id ?? selectedPanelId.value
  selectedBubbleId.value = null
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

function patchSelectedPanel(patch: Partial<ComicPanel>): void {
  const current = selectedPanel.value
  if (!current) return
  commit(upsertComicPanel(page.value, { ...current, ...patch }))
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
  if (hit.kind === 'cell') {
    const occupied = comicOccupiedCellKeys(page.value)
    if (!occupied.has(`${hit.row},${hit.col}`)) addPanelAtEmpty(hit.row, hit.col)
    return
  }
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
