<template>
  <StudioFloatingWindow
    :open="open"
    :title="windowTitle"
    :z-index="1200"
    :default-width="980"
    :default-height="680"
    :min-width="720"
    :min-height="480"
    body-class="pad-none"
    @close="onClose"
  >
    <div class="editor-root">
      <div class="topbar">
        <div class="sel-meta">
          <strong>{{ selectedLayer?.name || t('graph.layerSplit.noSelection') }}</strong>
          <span v-if="selectedLayer" class="z-tag">z {{ selectedLayer.zIndex }}</span>
        </div>
        <button
          type="button"
          class="tool-btn"
          :disabled="!canReorder"
          @click="reorder('down')"
        >
          {{ t('graph.layerSplit.sendBack') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!canReorder"
          @click="reorder('up')"
        >
          {{ t('graph.layerSplit.bringForward') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!baseLayer"
          @click="toggleBaseVisible"
        >
          {{ baseLayer && !baseLayer.visible ? t('graph.layerSplit.showBase') : t('graph.layerSplit.hideBase') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!selectedLayer || isBase(selectedLayer)"
          @click="resetSelected"
        >
          {{ t('graph.layerSplit.resetPos') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!draft.layers.length"
          @click="resetAll"
        >
          {{ t('graph.layerSplit.resetAll') }}
        </button>
        <button
          type="button"
          class="tool-btn"
          :disabled="!canSplitSelected"
          :title="splitDisabledReason"
          @click="onSplitSelected"
        >
          {{ splitting ? t('graph.layerSplit.splitting') : t('graph.layerSplit.splitSelected') }}
        </button>
        <span class="layer-count">
          {{ t('graph.layerSplit.layerCount', { n: draft.layers.length }) }}
        </span>
      </div>

      <div class="workspace">
        <div
          ref="stageEl"
          class="stage"
          tabindex="0"
          :class="{ 'space-pan': spaceHeld && hasCanvas, panning: pan.active }"
          @keydown="onKeydown"
          @dblclick.self="resetView"
          @wheel.prevent="onStageWheel"
          @pointerdown="onStagePanStart"
        >
          <div
            v-if="sourceLoading"
            class="stage-empty"
          >
            {{ t('graph.editor.loadingSource') }}
          </div>
          <div
            v-else-if="!hasCanvas"
            class="stage-empty"
          >
            {{ t('graph.layerSplit.needRun') }}
          </div>
          <div
            v-else
            class="canvas-wrap"
            :style="canvasWrapStyle"
            @pointerdown.self="draft.selectedId = ''"
            @dblclick.self="resetView"
          >
            <div
              v-if="splitting"
              class="stage-mask"
            >
              {{ t('graph.layerSplit.splitting') }}
            </div>
            <div
              v-for="layer in stackedLayers"
              v-show="layerOnCanvas(layer)"
              :key="layer.id"
              class="layer"
              :class="{
                selected: layer.id === draft.selectedId,
                base: isBase(layer)
              }"
              :style="layerStyle(layer)"
              @pointerdown.stop="onLayerPointerDown($event, layer)"
            >
              <img
                v-if="layer.visible && layerUrl(layer)"
                :src="layerUrl(layer)"
                alt=""
                draggable="false"
                decoding="async"
              >
              <template v-if="layer.id === draft.selectedId && !isBase(layer)">
                <span
                  v-for="handle in handles"
                  :key="handle"
                  class="handle"
                  :class="handle"
                  @pointerdown.stop="onHandlePointerDown($event, layer, handle)"
                />
              </template>
            </div>
          </div>
        </div>

        <aside class="sidebar">
          <div class="side-head">
            <div class="side-title">{{ t('graph.layerSplit.layers') }}</div>
            <div class="side-actions">
              <button
                type="button"
                class="icon-btn"
                :disabled="!canExportSelected"
                :title="t('graph.layerSplit.exportSelected')"
                :aria-label="t('graph.layerSplit.exportSelected')"
                @click="exportSelectedLayer"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <rect
                    x="3.2"
                    y="1.8"
                    width="9.6"
                    height="7"
                    rx="1.1"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                  />
                  <path
                    d="M8 9.2v4.5M5.8 12.2 8 14.4 10.2 12.2"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                :disabled="!canExportGroup"
                :title="t('graph.layerSplit.exportGroup')"
                :aria-label="t('graph.layerSplit.exportGroup')"
                @click="exportSelectedGroup"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <path
                    d="M2.6 4.2h3.1l1 1.2h6.7v6.8H2.6z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.25"
                    stroke-linejoin="round"
                  />
                  <path
                    d="M8 7.4v5.2M6.1 10.6 8 12.6 9.9 10.6"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn"
                :disabled="!canExportAll"
                :title="t('graph.layerSplit.exportAll')"
                :aria-label="t('graph.layerSplit.exportAll')"
                @click="exportAllLayers"
              >
                <svg
                  viewBox="0 0 16 16"
                  width="14"
                  height="14"
                  aria-hidden="true"
                >
                  <rect
                    x="4.4"
                    y="1.4"
                    width="8.4"
                    height="4.8"
                    rx="1"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <rect
                    x="2.8"
                    y="3.8"
                    width="8.4"
                    height="4.8"
                    rx="1"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.2"
                  />
                  <path
                    d="M8 9.4v4.4M6 12.3 8 14.4 10 12.3"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                class="icon-btn psd-btn"
                :disabled="!canExportAll"
                :title="t('graph.layerSplit.exportPsd')"
                :aria-label="t('graph.layerSplit.exportPsd')"
                @click="exportPsd"
              >
                PSD
              </button>
            </div>
          </div>
          <p
            v-if="exportMessage"
            class="side-export"
            :class="{ error: exportFailed }"
          >
            {{ exportMessage }}
          </p>
          <div class="side-list">
          <p
            v-if="!draft.layers.length"
            class="side-empty"
          >
            {{ t('graph.layerSplit.emptyLayers') }}
          </p>
          <p
            v-else-if="splitError"
            class="side-error"
          >
            {{ splitError }}
          </p>
          <template
            v-for="row in listRows"
            :key="row.id"
          >
            <button
              v-if="row.kind === 'group'"
              type="button"
              class="layer-row group-row"
              :class="{ active: row.group.id === selectedGroupId, dim: row.group.visible === false }"
              :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
              @click="selectGroup(row.group.id)"
            >
              <span
                class="chevron"
                :title="
                  row.group.collapsed
                    ? t('graph.layerSplit.expandGroup')
                    : t('graph.layerSplit.collapseGroup')
                "
                @click.stop="toggleGroupCollapsed(row.group.id)"
              >{{ row.group.collapsed ? '▸' : '▾' }}</span>
              <span
                class="eye"
                :class="{ off: row.group.visible === false }"
                :title="
                  row.group.visible === false
                    ? t('graph.layerSplit.showGroup')
                    : t('graph.layerSplit.hideGroup')
                "
                @click.stop="toggleGroupVisible(row.group.id)"
              >{{ row.group.visible === false ? '🚫' : '👁' }}</span>
              <span class="row-meta">
                <span class="row-name">{{ row.group.name }}</span>
                <span class="row-z">{{ t('graph.layerSplit.group') }}</span>
              </span>
            </button>
            <button
              v-else
              type="button"
              class="layer-row"
              :class="{ active: row.layer.id === draft.selectedId, dim: !row.layer.visible }"
              :style="{ paddingLeft: `${6 + row.depth * 14}px` }"
              @click="draft.selectedId = row.layer.id"
            >
              <span
                class="eye"
                :class="{ off: !row.layer.visible }"
                :title="row.layer.visible ? t('graph.layerSplit.hideLayer') : t('graph.layerSplit.showLayer')"
                @click.stop="toggleVisible(row.layer.id)"
              >{{ row.layer.visible ? '👁' : '🚫' }}</span>
              <img
                v-if="layerUrl(row.layer)"
                class="thumb"
                :src="layerUrl(row.layer)"
                alt=""
              >
              <span
                v-else
                class="thumb placeholder"
              />
              <span class="row-meta">
                <span class="row-name">{{ layerLabel(row.layer) }}</span>
                <span class="row-z">z {{ row.layer.zIndex }}</span>
              </span>
            </button>
          </template>
          </div>
        </aside>
      </div>

      <div class="bottom">
        <textarea
          v-model="draft.prompt"
          class="prompt"
          rows="2"
          :placeholder="t('graph.layerSplit.promptPlaceholder')"
        />
        <div class="toolbar">
          <label class="tool tool-model">
            <span class="tool-label">{{ t('graph.inspector.generate.imageModel') }}</span>
            <select
              v-model="selectionKey"
              class="select"
              @change="onModelChange"
            >
              <option
                v-for="opt in modelOptions"
                :key="opt.key"
                :value="opt.key"
              >
                {{ opt.label }}
              </option>
              <option
                v-if="modelOptions.length === 0"
                value=""
              >
                {{ t('graph.inspector.generate.noModels') }}
              </option>
            </select>
          </label>
          <label class="tool">
            <span class="tool-label">{{ t('graph.layerSplit.resolution') }}</span>
            <select
              v-model="draft.resolution"
              class="select"
            >
              <option
                v-for="r in resolutions"
                :key="r"
                :value="r"
              >{{ r }}</option>
            </select>
          </label>
        </div>
      </div>
    </div>
  </StudioFloatingWindow>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import {
  DEFAULT_IMAGE_LAYER_SPLIT,
  LAYER_SPLIT_RESOLUTIONS,
  buildLayerSplitList,
  collectLayerSplitGroupLayers,
  layerSplitExportFolderSegments,
  imageLayerSplitToNodePatch,
  isLayerSplitBase,
  isLayerSplitLayerDrawable,
  layerSplitGroupForSource,
  nudgeLayerSplit,
  normalizeImageLayerSplit,
  reorderLayerSplit,
  resetLayerSplitRect,
  sortLayersForCompose,
  toggleLayerSplitGroupCollapsed,
  toggleLayerSplitGroupVisible,
  type ImageLayerSplitLayer,
  type ImageLayerSplitNestedRequest,
  type ImageLayerSplitState
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import {
  loadGenerateModelOptions,
  preferredModelKey,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { layerSplitToPsdUint8Array } from '../features/graph/model/layerSplitPsd'
import { diveEditorHistory } from '../features/graph/ui/diveEditorHistory'
import StudioFloatingWindow from './StudioFloatingWindow.vue'

export type LayerSplitEditorSavePayload = ReturnType<typeof imageLayerSplitToNodePatch> & {
  generateModel: string
  generateProviderInstanceId: string
}

type ResizeHandle = 'nw' | 'ne' | 'sw' | 'se'

const props = withDefaults(
  defineProps<{
    open: boolean
    setup?: Partial<ImageLayerSplitState> | null
    sourceUrl?: string
    sourceLoading?: boolean
    layerUrls?: Record<string, string>
    generateModel?: string
    generateProviderInstanceId?: string
    splitting?: boolean
    splitError?: string
  }>(),
  {
    setup: null,
    sourceUrl: '',
    sourceLoading: false,
    layerUrls: () => ({}),
    generateModel: '',
    generateProviderInstanceId: '',
    splitting: false,
    splitError: ''
  }
)

const emit = defineEmits<{
  close: []
  update: [payload: LayerSplitEditorSavePayload]
  save: [payload: LayerSplitEditorSavePayload]
  'split-selected': [payload: ImageLayerSplitNestedRequest]
}>()

const { t } = useStudioI18n()
const windowTitle = computed(() => t('graph.layerSplit.appMark'))
const draft = reactive<ImageLayerSplitState>(normalizeImageLayerSplit())
const stageEl = ref<HTMLElement | null>(null)
const display = reactive({ w: 480, h: 480 })
const ZOOM_MIN = 0.2
const ZOOM_MAX = 8
const ZOOM_STEP = 1.1
const STAGE_PAD = 16
const zoom = ref(1)
const spaceHeld = ref(false)
const panOffset = reactive({ x: 0, y: 0 })
const pan = reactive({
  active: false,
  startX: 0,
  startY: 0,
  originX: 0,
  originY: 0
})
const hydrating = ref(false)
const exporting = ref(false)
const exportMessage = ref('')
const exportFailed = ref(false)
const modelOptions = ref<GenerateModelOption[]>([])
const selectionKey = ref('')
const generateModel = ref('')
const generateProviderInstanceId = ref('')
const handles: ResizeHandle[] = ['nw', 'ne', 'sw', 'se']
const resolutions = LAYER_SPLIT_RESOLUTIONS
let previewTimer: ReturnType<typeof setTimeout> | null = null
let exportMsgTimer: ReturnType<typeof setTimeout> | null = null
const localHistory = reactive({
  undo: [] as ImageLayerSplitState[],
  redo: [] as ImageLayerSplitState[],
  applying: false
})

const canUndo = computed(() => localHistory.undo.length > 0)
const canRedo = computed(() => localHistory.redo.length > 0)

type DragKind = 'move' | 'resize'
const drag = reactive<{
  kind: DragKind | null
  id: string
  handle: ResizeHandle | null
  startX: number
  startY: number
  origin: ImageLayerSplitLayer | null
}>({
  kind: null,
  id: '',
  handle: null,
  startX: 0,
  startY: 0,
  origin: null
})

const dirty = computed(() => {
  const a = normalizeImageLayerSplit(props.setup)
  const b = normalizeImageLayerSplit(draft)
  return (
    JSON.stringify(a) !== JSON.stringify(b) ||
    generateModel.value !== (props.generateModel ?? '') ||
    generateProviderInstanceId.value !== (props.generateProviderInstanceId ?? '')
  )
})

const hasCanvas = computed(
  () => draft.layers.length > 0 && draft.canvasWidth > 0 && draft.canvasHeight > 0
)
const stackedLayers = computed(() => sortLayersForCompose(draft.layers))
const listRows = computed(() => buildLayerSplitList(draft))
const selectedLayer = computed(
  () => draft.layers.find((layer) => layer.id === draft.selectedId) ?? null
)
const selectedGroupId = computed(() => {
  const layer = selectedLayer.value
  if (!layer) return ''
  return layer.groupId || layerSplitGroupForSource(draft, layer.id)?.id || ''
})
const baseLayer = computed(
  () => draft.layers.find((layer) => isLayerSplitBase(layer)) ?? null
)
const canReorder = computed(() => {
  const layer = selectedLayer.value
  return !!layer && !isLayerSplitBase(layer)
})
const splitting = computed(() => props.splitting === true)
const splitError = computed(() => props.splitError?.trim() || '')
const alreadySplitSource = computed(() => {
  const layer = selectedLayer.value
  return !!layer && !!layerSplitGroupForSource(draft, layer.id)
})
const canSplitSelected = computed(() => {
  const layer = selectedLayer.value
  return (
    !!layer &&
    !splitting.value &&
    !alreadySplitSource.value &&
    hasCanvas.value &&
    !props.sourceLoading
  )
})
const splitDisabledReason = computed(() => {
  if (splitting.value) return t('graph.layerSplit.splitting')
  if (!selectedLayer.value) return t('graph.layerSplit.splitNeedLayer')
  if (alreadySplitSource.value) return t('graph.layerSplit.splitAlready')
  return ''
})
const canExportSelected = computed(() => {
  const layer = selectedLayer.value
  return !exporting.value && !!layer && !!layerUrl(layer)
})
const selectedGroupLayers = computed(() =>
  selectedGroupId.value ? collectLayerSplitGroupLayers(draft, selectedGroupId.value) : []
)
const canExportGroup = computed(
  () =>
    !exporting.value &&
    !!selectedGroupId.value &&
    selectedGroupLayers.value.some((layer) => !!layerUrl(layer))
)
const canExportAll = computed(
  () => !exporting.value && draft.layers.some((layer) => !!layerUrl(layer))
)

const canvasWrapStyle = computed(() => ({
  width: `${Math.round(display.w * zoom.value)}px`,
  height: `${Math.round(display.h * zoom.value)}px`,
  transform: `translate(${Math.round(panOffset.x)}px, ${Math.round(panOffset.y)}px)`
}))

function isBase(layer: ImageLayerSplitLayer): boolean {
  return isLayerSplitBase(layer)
}

function layerLabel(layer: ImageLayerSplitLayer): string {
  if (isBase(layer)) return t('graph.layerSplit.baseLayer')
  return layer.name || layer.id
}

function layerOnCanvas(layer: ImageLayerSplitLayer): boolean {
  return isLayerSplitLayerDrawable(draft, layer)
}

function layerUrl(layer: ImageLayerSplitLayer): string {
  return props.layerUrls[layer.imageId] || props.layerUrls[layer.id] || ''
}

function sanitizeFileBase(name: string): string {
  const cleaned = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ')
  return cleaned || 'layer'
}

function layerFileBase(layer: ImageLayerSplitLayer): string {
  const name = isBase(layer) ? t('graph.layerSplit.baseLayer') : layer.name || layer.id
  return sanitizeFileBase(name)
}

function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase()
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg'
  if (m.includes('webp')) return 'webp'
  if (m.includes('gif')) return 'gif'
  return 'png'
}

function flashExportMessage(message: string, failed = false): void {
  exportMessage.value = message
  exportFailed.value = failed
  if (exportMsgTimer) clearTimeout(exportMsgTimer)
  exportMsgTimer = setTimeout(() => {
    exportMessage.value = ''
    exportFailed.value = false
    exportMsgTimer = null
  }, 3200)
}

async function resolveLayerBytes(src: string): Promise<{ data: Uint8Array; ext: string }> {
  const url = src.trim()
  if (!url) throw new Error(t('graph.layerSplit.exportNeedImage'))
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+)?(;base64)?,([\s\S]*)$/i)
    if (!match) throw new Error('invalid data URL')
    const mime = match[1] || 'image/png'
    const isBase64 = !!match[2]
    const payload = match[3] || ''
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload)
    const data = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) data[i] = binary.charCodeAt(i)
    return { data, ext: extensionFromMime(mime) }
  }
  const response = await fetch(url)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const data = new Uint8Array(await response.arrayBuffer())
  const mime = response.headers.get('content-type') || ''
  return {
    data,
    ext: mime.startsWith('image/') ? extensionFromMime(mime) : 'png'
  }
}

async function exportLayerFiles(
  layers: ImageLayerSplitLayer[],
  options?: { nestGroups?: boolean; rootGroupId?: string }
): Promise<number | null> {
  const counts = new Map<string, number>()
  const files: Array<{ fileName: string; data: Uint8Array }> = []
  for (const layer of layers) {
    const src = layerUrl(layer)
    if (!src) continue
    const { data, ext } = await resolveLayerBytes(src)
    let dirPrefix = ''
    let dirKey = ''
    if (options?.nestGroups) {
      const segs = layerSplitExportFolderSegments(draft, layer.groupId, options.rootGroupId).map(
        (name) => sanitizeFileBase(name)
      )
      dirKey = segs.join('/')
      dirPrefix = segs.length ? `${segs.join('/')}/` : ''
    }
    const n = (counts.get(dirKey) ?? 0) + 1
    counts.set(dirKey, n)
    files.push({
      fileName: `${dirPrefix}${String(n).padStart(2, '0')}-${layerFileBase(layer)}.${ext}`,
      data
    })
  }
  if (!files.length) {
    flashExportMessage(t('graph.layerSplit.exportNeedImage'), true)
    return null
  }
  const result = await window.studio.saveBinaryFilesToDirectory({ files })
  return result?.written ?? null
}

async function exportSelectedLayer(): Promise<void> {
  const layer = selectedLayer.value
  const src = layer ? layerUrl(layer) : ''
  if (!layer || !src || exporting.value) return
  exporting.value = true
  try {
    const { data, ext } = await resolveLayerBytes(src)
    const saved = await window.studio.saveBinaryFile({
      data,
      defaultPath: `${layerFileBase(layer)}.${ext}`,
      filters: [
        { name: t('graph.layerSplit.exportFilterImage'), extensions: [ext, 'png', 'jpg', 'webp'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!saved) return
    flashExportMessage(t('graph.layerSplit.exportSelectedDone'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportSelectedGroup(): Promise<void> {
  if (!canExportGroup.value) return
  exporting.value = true
  try {
    const written = await exportLayerFiles(selectedGroupLayers.value, {
      nestGroups: true,
      rootGroupId: selectedGroupId.value
    })
    if (written == null) return
    flashExportMessage(t('graph.layerSplit.exportGroupDone', { n: written }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportAllLayers(): Promise<void> {
  if (exporting.value) return
  const layers = sortLayersForCompose(draft.layers).filter((layer) => layerUrl(layer))
  if (!layers.length) {
    flashExportMessage(t('graph.layerSplit.exportNeedImage'), true)
    return
  }
  exporting.value = true
  try {
    const written = await exportLayerFiles(layers, { nestGroups: true })
    if (written == null) return
    flashExportMessage(t('graph.layerSplit.exportAllDone', { n: written }))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

async function exportPsd(): Promise<void> {
  if (exporting.value) return
  const layers = sortLayersForCompose(draft.layers).filter((layer) => layerUrl(layer))
  if (!layers.length) {
    flashExportMessage(t('graph.layerSplit.exportNeedImage'), true)
    return
  }
  exporting.value = true
  try {
    const data = await layerSplitToPsdUint8Array({
      state: draft,
      layerUrls: props.layerUrls
    })
    const saved = await window.studio.saveBinaryFile({
      data,
      defaultPath: 'layer-split.psd',
      filters: [
        { name: t('graph.layerSplit.exportPsdFilter'), extensions: ['psd'] },
        { name: t('graph.output.exportFilterAll'), extensions: ['*'] }
      ]
    })
    if (!saved) return
    flashExportMessage(t('graph.layerSplit.exportPsdDone'))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    flashExportMessage(t('graph.layerSplit.exportFailed', { error: message }), true)
  } finally {
    exporting.value = false
  }
}

function layerStyle(layer: ImageLayerSplitLayer): Record<string, string> {
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  if (isBase(layer)) {
    return {
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      zIndex: String(layer.zIndex)
    }
  }
  return {
    left: `${(layer.left / cw) * 100}%`,
    top: `${(layer.top / ch) * 100}%`,
    width: `${(layer.width / cw) * 100}%`,
    height: `${(layer.height / ch) * 100}%`,
    zIndex: String(layer.zIndex + 1)
  }
}

function findLayer(id: string): ImageLayerSplitLayer | undefined {
  return draft.layers.find((layer) => layer.id === id)
}

function cloneDraft(state: ImageLayerSplitState = draft): ImageLayerSplitState {
  return normalizeImageLayerSplit(JSON.parse(JSON.stringify(state)) as ImageLayerSplitState)
}

function resetLocalHistory(): void {
  localHistory.undo.length = 0
  localHistory.redo.length = 0
}

function pushDraftHistory(): void {
  if (hydrating.value || localHistory.applying || splitting.value) return
  const snap = cloneDraft()
  const last = localHistory.undo.at(-1)
  if (last && JSON.stringify(last) === JSON.stringify(snap)) return
  localHistory.undo.push(snap)
  if (localHistory.undo.length > 80) localHistory.undo.shift()
  localHistory.redo.length = 0
}

function applyDraftState(next: ImageLayerSplitState): void {
  localHistory.applying = true
  hydrating.value = true
  Object.assign(draft, next)
  void nextTick(() => {
    hydrating.value = false
    localHistory.applying = false
    emitPreview()
  })
}

function undoDraft(): void {
  const prev = localHistory.undo.pop()
  if (!prev) return
  localHistory.redo.push(cloneDraft())
  applyDraftState(prev)
}

function redoDraft(): void {
  const next = localHistory.redo.pop()
  if (!next) return
  localHistory.undo.push(cloneDraft())
  applyDraftState(next)
}

// 打开时把本地草稿历史注册到 dive 历史桥，主窗口工具栏 ↶↷ 便代理到此编辑器。详见 diveEditorHistory。
let releaseDiveHistory: (() => void) | null = null

function bindDiveHistory(): void {
  releaseDiveHistory?.()
  releaseDiveHistory = diveEditorHistory.register({
    canUndo: () => canUndo.value,
    canRedo: () => canRedo.value,
    undo: undoDraft,
    redo: redoDraft
  })
}

function releaseDiveHistoryBridge(): void {
  releaseDiveHistory?.()
  releaseDiveHistory = null
}

function onWindowUndoKeydown(event: KeyboardEvent): void {
  if (!props.open) return
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return
  if (isEditableTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault()
    event.stopImmediatePropagation()
    undoDraft()
    return
  }
  if (key === 'y' || (key === 'z' && event.shiftKey)) {
    event.preventDefault()
    event.stopImmediatePropagation()
    redoDraft()
  }
}

function replaceLayer(next: ImageLayerSplitLayer): void {
  const index = draft.layers.findIndex((layer) => layer.id === next.id)
  if (index < 0) return
  draft.layers.splice(index, 1, next)
}

function scaleFromDisplay(dx: number, dy: number): { dx: number; dy: number } {
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const zw = Math.max(1, display.w * zoom.value)
  const zh = Math.max(1, display.h * zoom.value)
  return {
    dx: Math.round((dx / zw) * cw),
    dy: Math.round((dy / zh) * ch)
  }
}

function onLayerPointerDown(event: PointerEvent, layer: ImageLayerSplitLayer): void {
  if (spaceHeld.value) {
    onStagePanStart(event)
    return
  }
  draft.selectedId = layer.id
  stageEl.value?.focus()
  if (isBase(layer) || !layer.visible) return
  pushDraftHistory()
  event.preventDefault()
  drag.kind = 'move'
  drag.id = layer.id
  drag.handle = null
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.origin = { ...layer }
  ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onHandlePointerDown(
  event: PointerEvent,
  layer: ImageLayerSplitLayer,
  handle: ResizeHandle
): void {
  if (spaceHeld.value) {
    onStagePanStart(event)
    return
  }
  draft.selectedId = layer.id
  pushDraftHistory()
  event.preventDefault()
  drag.kind = 'resize'
  drag.id = layer.id
  drag.handle = handle
  drag.startX = event.clientX
  drag.startY = event.clientY
  drag.origin = { ...layer }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
}

function onPointerMove(event: PointerEvent): void {
  if (!drag.kind || !drag.origin) return
  const delta = scaleFromDisplay(event.clientX - drag.startX, event.clientY - drag.startY)
  if (drag.kind === 'move') {
    replaceLayer({
      ...drag.origin,
      left: drag.origin.left + delta.dx,
      top: drag.origin.top + delta.dy
    })
    return
  }
  const origin = drag.origin
  const handle = drag.handle
  if (!handle) return
  let left = origin.left
  let top = origin.top
  let width = origin.width
  let height = origin.height
  const ratio = origin.width / Math.max(1, origin.height)
  if (handle.includes('e')) width = Math.max(8, origin.width + delta.dx)
  if (handle.includes('s')) height = Math.max(8, origin.height + delta.dy)
  if (handle.includes('w')) {
    width = Math.max(8, origin.width - delta.dx)
    left = origin.left + origin.width - width
  }
  if (handle.includes('n')) {
    height = Math.max(8, origin.height - delta.dy)
    top = origin.top + origin.height - height
  }
  height = Math.max(8, Math.round(width / ratio))
  if (handle.includes('n')) top = origin.top + origin.height - height
  if (handle.includes('w')) left = origin.left + origin.width - width
  replaceLayer({ ...origin, left, top, width, height })
}

function onPointerUp(): void {
  drag.kind = null
  drag.id = ''
  drag.handle = null
  drag.origin = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

function reorder(direction: 'up' | 'down'): void {
  if (!draft.selectedId) return
  pushDraftHistory()
  draft.layers = reorderLayerSplit(draft.layers, draft.selectedId, direction)
}

function toggleGroupCollapsed(groupId: string): void {
  pushDraftHistory()
  draft.groups = toggleLayerSplitGroupCollapsed(draft.groups, groupId)
}

function toggleGroupVisible(groupId: string): void {
  pushDraftHistory()
  draft.groups = toggleLayerSplitGroupVisible(draft.groups, groupId)
}

function selectGroup(groupId: string): void {
  const group = draft.groups.find((item) => item.id === groupId)
  if (!group) return
  const source = draft.layers.find((layer) => layer.id === group.sourceLayerId)
  const firstChild = draft.layers.find((layer) => layer.groupId === groupId)
  draft.selectedId = source?.id || firstChild?.id || draft.selectedId
}

function onSplitSelected(): void {
  const layer = selectedLayer.value
  if (!layer || !canSplitSelected.value) return
  if (previewTimer) {
    clearTimeout(previewTimer)
    previewTimer = null
  }
  emit('split-selected', {
    layerId: layer.id,
    prompt: draft.prompt,
    resolution: draft.resolution,
    generateModel: generateModel.value,
    generateProviderInstanceId: generateProviderInstanceId.value,
    imageLayerSplit: normalizeImageLayerSplit(draft)
  })
}

function toggleVisible(id: string): void {
  const layer = findLayer(id)
  if (!layer) return
  pushDraftHistory()
  replaceLayer({ ...layer, visible: !layer.visible })
}

function toggleBaseVisible(): void {
  const layer = baseLayer.value
  if (!layer) return
  toggleVisible(layer.id)
}

function resetSelected(): void {
  const layer = selectedLayer.value
  if (!layer) return
  pushDraftHistory()
  replaceLayer(resetLayerSplitRect(layer, draft.canvasWidth, draft.canvasHeight))
}

function resetAll(): void {
  pushDraftHistory()
  draft.layers = draft.layers.map((layer) =>
    resetLayerSplitRect(layer, draft.canvasWidth, draft.canvasHeight)
  )
}

function onKeydown(event: KeyboardEvent): void {
  const layer = selectedLayer.value
  if (!layer || isBase(layer)) return
  const step = event.shiftKey ? 10 : 1
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, -step, 0))
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, step, 0))
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, 0, -step))
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    pushDraftHistory()
    replaceLayer(nudgeLayerSplit(layer, 0, step))
  } else if (event.key === ']' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    reorder('up')
  } else if (event.key === '[' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    reorder('down')
  }
}

function fitDisplay(): void {
  const stage = stageEl.value
  const cw = Math.max(1, draft.canvasWidth)
  const ch = Math.max(1, draft.canvasHeight)
  const ar = cw / ch
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
  resetView()
}

function resetView(): void {
  zoom.value = 1
  panOffset.x = 0
  panOffset.y = 0
}

function onStageWheel(event: WheelEvent): void {
  if (!hasCanvas.value || !event.deltaY) return
  const stage = stageEl.value
  if (!stage) return
  const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom.value * factor))
  if (next === zoom.value) return
  const rect = stage.getBoundingClientRect()
  const prevGapX = Math.max((stage.clientWidth - display.w * zoom.value) / 2, STAGE_PAD)
  const prevGapY = Math.max((stage.clientHeight - display.h * zoom.value) / 2, STAGE_PAD)
  const cx = (event.clientX - rect.left - prevGapX - panOffset.x) / zoom.value
  const cy = (event.clientY - rect.top - prevGapY - panOffset.y) / zoom.value
  const gapX = Math.max((stage.clientWidth - display.w * next) / 2, STAGE_PAD)
  const gapY = Math.max((stage.clientHeight - display.h * next) / 2, STAGE_PAD)
  panOffset.x = event.clientX - rect.left - gapX - cx * next
  panOffset.y = event.clientY - rect.top - gapY - cy * next
  zoom.value = next
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el?.closest('input, textarea, select, [contenteditable="true"]')
}

function endStagePan(): void {
  pan.active = false
  window.removeEventListener('pointermove', onStagePanMove)
  window.removeEventListener('pointerup', onStagePanEnd)
}

function onStagePanStart(event: PointerEvent): void {
  if (!spaceHeld.value || !hasCanvas.value || !event.isPrimary) return
  event.preventDefault()
  pan.active = true
  pan.startX = event.clientX
  pan.startY = event.clientY
  pan.originX = panOffset.x
  pan.originY = panOffset.y
  window.addEventListener('pointermove', onStagePanMove)
  window.addEventListener('pointerup', onStagePanEnd)
}

function onStagePanMove(event: PointerEvent): void {
  if (!pan.active) return
  panOffset.x = pan.originX + (event.clientX - pan.startX)
  panOffset.y = pan.originY + (event.clientY - pan.startY)
}

function onStagePanEnd(): void {
  endStagePan()
}

function onWindowSpaceKeydown(event: KeyboardEvent): void {
  if (!props.open || event.code !== 'Space' || event.repeat) return
  if (isEditableTarget(event.target) || !hasCanvas.value) return
  event.preventDefault()
  spaceHeld.value = true
}

function onWindowSpaceKeyup(event: KeyboardEvent): void {
  if (event.code !== 'Space') return
  spaceHeld.value = false
  endStagePan()
}

function onWindowBlur(): void {
  spaceHeld.value = false
  endStagePan()
}

function buildSavePayload(): LayerSplitEditorSavePayload {
  return {
    ...imageLayerSplitToNodePatch(normalizeImageLayerSplit(draft)),
    generateModel: generateModel.value,
    generateProviderInstanceId: generateProviderInstanceId.value
  }
}

function emitPreview(): void {
  if (!props.open || hydrating.value || splitting.value) return
  if (previewTimer) clearTimeout(previewTimer)
  previewTimer = setTimeout(() => {
    previewTimer = null
    if (!props.open || hydrating.value) return
    emit('update', buildSavePayload())
  }, 48)
}

function onModelChange(): void {
  const opt = modelOptions.value.find((o) => o.key === selectionKey.value)
  generateModel.value = opt?.model ?? ''
  generateProviderInstanceId.value = opt?.providerInstanceId ?? ''
}

async function refreshModels(): Promise<void> {
  const preferred = preferredModelKey(props.generateProviderInstanceId, props.generateModel)
  const { options, selectedKey } = await loadGenerateModelOptions('image', preferred)
  modelOptions.value = options
  selectionKey.value = selectedKey || options[0]?.key || ''
  onModelChange()
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      window.removeEventListener('keydown', onWindowUndoKeydown, true)
      window.removeEventListener('keydown', onWindowSpaceKeydown, true)
      window.removeEventListener('keyup', onWindowSpaceKeyup, true)
      window.removeEventListener('blur', onWindowBlur)
      onWindowBlur()
      releaseDiveHistoryBridge()
      resetLocalHistory()
      return
    }
    resetLocalHistory()
    window.addEventListener('keydown', onWindowUndoKeydown, true)
    window.addEventListener('keydown', onWindowSpaceKeydown, true)
    window.addEventListener('keyup', onWindowSpaceKeyup, true)
    window.addEventListener('blur', onWindowBlur)
    bindDiveHistory()
    hydrating.value = true
    Object.assign(draft, normalizeImageLayerSplit(props.setup ?? DEFAULT_IMAGE_LAYER_SPLIT))
    generateModel.value = props.generateModel ?? ''
    generateProviderInstanceId.value = props.generateProviderInstanceId ?? ''
    void refreshModels()
    void nextTick(() => {
      fitDisplay()
      hydrating.value = false
      emitPreview()
    })
  },
  { immediate: true }
)

watch(
  () =>
    [
      props.setup?.sourceFingerprint ?? '',
      (props.setup?.layers ?? []).map((layer) => layer.id).join('|'),
      (props.setup?.groups ?? []).map((group) => group.id).join('|')
    ].join('::'),
  (key) => {
    if (!props.open || !key) return
    resetLocalHistory()
    hydrating.value = true
    Object.assign(draft, normalizeImageLayerSplit(props.setup ?? DEFAULT_IMAGE_LAYER_SPLIT))
    void nextTick(() => {
      fitDisplay()
      hydrating.value = false
    })
  }
)

watch(draft, () => emitPreview(), { deep: true })
watch([generateModel, generateProviderInstanceId], () => emitPreview())

watch(
  () => [props.open, draft.canvasWidth, draft.canvasHeight] as const,
  ([open]) => {
    if (open) fitDisplay()
  }
)

function save(): void {
  emit('save', buildSavePayload())
}

function onClose(): void {
  onPointerUp()
  if (dirty.value) save()
  emit('close')
}

onBeforeUnmount(() => {
  onPointerUp()
  window.removeEventListener('keydown', onWindowUndoKeydown, true)
  releaseDiveHistoryBridge()
  if (previewTimer) clearTimeout(previewTimer)
  if (exportMsgTimer) clearTimeout(exportMsgTimer)
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

.topbar,
.bottom {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}

.bottom {
  border-bottom: none;
  border-top: 1px solid var(--border);
}

.sel-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  font-size: 13px;
}

.sel-meta strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.z-tag {
  font-size: 11px;
  color: var(--text-muted);
}

.tool-btn {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
}

.tool-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.layer-count {
  margin-left: auto;
  font-size: 12px;
  color: var(--text-muted);
}

.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
}

.stage {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  padding: 16px;
  overflow: hidden;
  outline: none;
}

.stage.space-pan,
.stage.space-pan .layer,
.stage.space-pan .handle {
  cursor: grab;
}

.stage.panning,
.stage.panning .layer,
.stage.panning .handle {
  cursor: grabbing;
}

.stage-empty {
  margin: auto;
  color: var(--text-muted);
  font-size: 13px;
  max-width: 360px;
  text-align: center;
  line-height: 1.5;
}

.canvas-wrap {
  position: relative;
  flex: 0 0 auto;
  margin: auto;
  background-image:
    linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
    linear-gradient(-45deg, transparent 75%, #3a3a3a 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-color: #2a2a2a;
}

.stage-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  font-size: 13px;
}

.layer {
  position: absolute;
  box-sizing: border-box;
  cursor: move;
}

.layer.base {
  cursor: default;
}

.layer.selected {
  outline: 2px solid #4a90e2;
  outline-offset: -1px;
}

.layer img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
  -webkit-user-drag: none;
}

.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 1px solid #fff;
  background: #4a90e2;
  border-radius: 1px;
  z-index: 4;
}

.handle.nw { left: -5px; top: -5px; cursor: nwse-resize; }
.handle.ne { right: -5px; top: -5px; cursor: nesw-resize; }
.handle.sw { left: -5px; bottom: -5px; cursor: nesw-resize; }
.handle.se { right: -5px; bottom: -5px; cursor: nwse-resize; }

.sidebar {
  width: 236px;
  flex: 0 0 236px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--bg-elevated);
  overflow: hidden;
  padding: 10px;
}

.side-head {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-bottom: 8px;
}

.side-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.side-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
}

.icon-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-hover);
  color: var(--text);
  cursor: pointer;
}

.icon-btn:hover:not(:disabled) {
  border-color: #4a90e2;
  color: #4a90e2;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.psd-btn {
  width: auto;
  padding: 0 5px;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.side-export {
  flex: 0 0 auto;
  margin: 0 0 8px;
  font-size: 11px;
  color: #7dcea0;
  line-height: 1.35;
}

.side-export.error {
  color: #e07070;
}

.side-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

.side-empty,
.side-error {
  margin: 0 0 8px;
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.4;
}

.side-error {
  color: #e07070;
}

.layer-row.group-row {
  font-weight: 600;
}

.chevron {
  width: 14px;
  flex: 0 0 14px;
  font-size: 12px;
  opacity: 0.8;
}

.layer-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  padding: 6px;
  margin-bottom: 4px;
  text-align: left;
  cursor: pointer;
}

.layer-row.active {
  border-color: #4a90e2;
  background: var(--bg-hover);
}

.layer-row.dim {
  opacity: 0.55;
}

.eye {
  font-size: 12px;
  opacity: 0.85;
}

.eye.off {
  opacity: 0.28;
}

.thumb {
  width: 36px;
  height: 36px;
  object-fit: contain;
  border-radius: 4px;
  background: #111;
}

.thumb.placeholder {
  display: inline-block;
}

.row-meta {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.row-name {
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-z {
  font-size: 11px;
  color: var(--text-muted);
}

.prompt {
  flex: 1 1 240px;
  min-height: 56px;
  resize: vertical;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 8px 10px;
  font-size: 13px;
}

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.tool {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.tool-model {
  min-width: 200px;
}

.select {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 6px 8px;
}
</style>
