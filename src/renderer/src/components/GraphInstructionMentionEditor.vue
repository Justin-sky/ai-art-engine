<template>
  <div ref="rootEl" class="instruction-box" :class="variant">
    <div class="toolbar">
      <div
        v-if="styleChips.length || frameChips.length || mentionChips.length"
        class="ref-strip"
      >
        <div
          v-for="chip in styleChips"
          :key="chip.id"
          class="ref-chip style-chip"
        >
          <button
            type="button"
            class="ref-thumb"
            @click="insertToken(`@${chip.index}`)"
            @pointerenter="showRefPreview('style', chip, $event)"
            @pointerleave="hideRefPreview"
          >
            <span class="ref-role">{{ chip.roleLabel }}</span>
            <span class="ref-index">{{ chip.index }}</span>
            <img v-if="chip.thumbUrl" :src="chip.thumbUrl" alt="" draggable="false" />
            <span v-else class="ref-fallback">🎨</span>
          </button>
        </div>
        <div
          v-for="chip in frameChips"
          :key="chip.edgeId"
          class="ref-chip frame-chip"
        >
          <div
            class="ref-thumb"
            @pointerenter="showRefPreview('frame', chip, $event)"
            @pointerleave="hideRefPreview"
          >
            <span class="ref-role">{{ chip.roleLabel }}</span>
            <img v-if="chip.thumbUrl" :src="chip.thumbUrl" alt="" draggable="false" />
            <span v-else class="ref-fallback"><WorkspaceItemIcon :icon="chip.icon" :size="16" /></span>
          </div>
          <button
            type="button"
            class="ref-close"
            :title="t('graph.inspector.generate.disconnectRef')"
            @pointerdown.stop
            @click.stop="disconnect(chip.edgeId)"
          >
            ×
          </button>
        </div>
        <div
          v-for="chip in mentionChips"
          :key="chip.edgeId"
          class="ref-chip"
          :class="{
            dragging: dragFromId === chip.edgeId && dragMoved,
            'drag-over': dragOverId === chip.edgeId && dragFromId !== chip.edgeId
          }"
          :data-edge-id="chip.edgeId"
          :title="chipDragTitle(chip)"
          @pointerdown="onChipPointerDown(chip, $event)"
          @pointermove="onChipPointerMove($event)"
          @pointerup="onChipPointerUp($event)"
          @pointercancel="onChipPointerCancel"
        >
          <button
            type="button"
            class="ref-thumb"
            @click="onThumbClick(chip)"
            @pointerenter="showRefPreview('mention', chip, $event)"
            @pointerleave="hideRefPreview"
          >
            <span class="ref-index">{{ chip.index }}</span>
            <img v-if="chip.thumbUrl" :src="chip.thumbUrl" alt="" draggable="false" />
            <span v-else class="ref-fallback"><WorkspaceItemIcon :icon="chip.icon" :size="16" /></span>
          </button>
          <button
            type="button"
            class="ref-close"
            :title="t('graph.inspector.generate.disconnectRef')"
            @pointerdown.stop
            @click.stop="disconnect(chip.edgeId)"
          >
            ×
          </button>
        </div>
      </div>
      <div v-else class="toolbar-spacer" />

      <div class="toolbar-actions">
        <button
          v-if="presetKind"
          ref="presetBtnEl"
          type="button"
          class="preset-btn"
          :title="t('graph.inspector.generate.presets.open')"
          :aria-expanded="menuOpen"
          @click.stop="toggleMenu"
        >
          <span class="preset-icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="preview-btn"
          :title="t('graph.inspector.generate.instructionPreview')"
          @click.stop.prevent="openPromptPreview"
        >
          <span class="preview-icon" aria-hidden="true" />
        </button>
        <button
          v-if="variant === 'inline'"
          type="button"
          class="expand-btn"
          :title="t('graph.inspector.generate.instructionExpand')"
          @click.stop.prevent="emit('expand')"
        >
          <ExpandArrowsIcon />
        </button>
      </div>
    </div>

    <!-- Teleport：避免 instruction-box overflow / 画布 transform 遮挡 -->
    <Teleport to="body">
      <div
        v-if="menuOpen && presets.length"
        ref="presetMenuEl"
        class="preset-menu"
        :class="{ 'has-tabs': presetTabs.length > 1 }"
        :style="presetMenuStyle"
        @mousedown.stop
        @click.stop
      >
        <div class="preset-menu-title">{{ presetMenuTitle }}</div>
        <div v-if="presetTabs.length > 1" class="preset-tabs" role="tablist">
          <button
            v-for="tab in presetTabs"
            :key="tab"
            type="button"
            class="preset-tab"
            role="tab"
            :class="{ active: activePresetTab === tab }"
            :aria-selected="activePresetTab === tab"
            @click="activePresetTab = tab"
          >
            {{ presetTabLabel(tab) }}
          </button>
        </div>
        <div class="preset-grid">
          <button
            v-for="item in visiblePresets"
            :key="item.id"
            type="button"
            class="preset-card"
            :title="t(item.titleKey)"
            @click="applyPreset(item)"
          >
            <PresetVisualGlyph class="preset-glyph" :visual="visualForPreset(item)" />
            <span class="preset-card-title">{{ t(item.titleKey) }}</span>
          </button>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="dragMoved && dragGhost"
        class="ref-drag-ghost"
        :style="dragGhostStyle"
        aria-hidden="true"
      >
        <span class="ref-index">{{ dragGhost.index }}</span>
        <img v-if="dragGhost.thumbUrl" :src="dragGhost.thumbUrl" alt="" draggable="false" />
        <span v-else class="ref-fallback"><WorkspaceItemIcon :icon="dragGhost.icon" :size="16" /></span>
      </div>
    </Teleport>

    <Teleport to="body">
      <div
        v-if="refPreview"
        ref="refPreviewEl"
        class="ref-preview-tip"
        role="tooltip"
        :style="refPreviewStyle"
      >
        <div class="ref-preview-title">{{ refPreview.title }}</div>
        <img v-if="refPreview.thumbUrl" :src="refPreview.thumbUrl" alt="" draggable="false" />
        <div v-if="refPreview.text" class="ref-preview-text">{{ refPreview.text }}</div>
      </div>
    </Teleport>

    <div class="editor-area" @mousedown="onEditorMouseDown" @dblclick.stop="onEditorDblClick">
      <RefMentionTextarea
        ref="editorRef"
        class="instruction-input"
        :model-value="modelValue"
        :options="mentionOptions"
        :rows="rows"
        :placeholder="placeholder"
        hint=""
        @update:model-value="onUpdate"
        @change="emit('change')"
      />
    </div>

    <div v-if="$slots.footer" class="footer-toolbar" @pointerdown.stop @dblclick.stop>
      <slot name="footer" />
    </div>

    <GraphTextNotepadDialog
      :open="previewOpen"
      :title="t('graph.inspector.generate.instructionPreviewTitle')"
      :text="previewText"
      :images="previewImages"
      :editable="false"
      :embedded="false"
      @close="previewOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ASSET_TYPE_ICONS,
  clampStyleImageWeight,
  normalizeProjectStyleImages,
  portMentionIndex,
  resolveGenerateStyleImages,
  type ProjectStyleImage
} from '@shared/domain'
import {
  buildInstructionFinalPromptPreview,
  insertInstructionPresetText,
  resolveInstructionFinalPreviewKind,
  resolveInstructionVisual,
  resolveNodeTextContent,
  type RefMentionOption,
  readBoundBeatIdFromNodeParams,
  formatBeatRefText,
  shouldKeepInstructionMentionToken,
  softResolveBoundaryInputParams,
  isBoundaryInputNode,
  type GraphNode,
  type GraphValue,
  type InstructionMentionSource,
  type InstructionPreset,
  type InstructionPresetKind,
  type InstructionPresetTab,
  type PresetVisual
} from '@shared/graph'
import ExpandArrowsIcon from './icons/ExpandArrowsIcon.vue'
import WorkspaceItemIcon from './WorkspaceItemIcon.vue'
import PresetVisualGlyph from './PresetVisualGlyph.vue'
import GraphTextNotepadDialog, {
  type NotepadPreviewImage
} from './GraphTextNotepadDialog.vue'
import RefMentionTextarea from './RefMentionTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useProjectStore } from '../stores/project'
import { loadBeatCatalog } from '../features/beat/applyBeatCatalogOnOpen'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import {
  fetchTextFromAssetRelativePath,
  resolveAssetText
} from '../features/media/resolveAssetText'
import {
  enrichStyleImagesWithLibraryPrompts,
  getDefaultStylePreset
} from '../features/stylePresets/defaultLibrary'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  isVideoFramePortId
} from '@shared/graph'
import {
  buildMentionIndexMapAfterReorder,
  buildMentionIndexMapForStyleReserveChange,
  graphEditorHosts,
  remapInstructionMentions,
  useGraphEditorRevision
} from '../features/graph/model/graphEditorHosts'

interface RefChip {
  edgeId: string
  sourceNodeId: string
  index: number
  title: string
  icon: string
  thumbUrl: string
  snippet: string
}

interface FrameChip {
  edgeId: string
  sourceNodeId: string
  targetPort: string
  roleLabel: string
  title: string
  icon: string
  thumbUrl: string
}

interface StyleChip {
  id: string
  index: number
  roleLabel: string
  title: string
  thumbUrl: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    hostId: string
    nodeId: string
    rows?: number
    placeholder?: string
    presetKind?: InstructionPresetKind | null
    /** inline：Inspector 紧凑框；dialog：大窗内嵌（不显示展开按钮） */
    variant?: 'inline' | 'dialog'
  }>(),
  {
    rows: 8,
    presetKind: null,
    variant: 'inline'
  }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
  expand: []
}>()

const { t, locale, assetTypeLabel, graphTypeLabel } = useStudioI18n()
const project = useProjectStore()
const revision = useGraphEditorRevision()
const thumbUrls = ref<Record<string, string>>({})
const menuOpen = ref(false)
const previewOpen = ref(false)
const previewText = ref('')
const previewImages = ref<NotepadPreviewImage[]>([])
const rootEl = ref<HTMLElement | null>(null)
const presetBtnEl = ref<HTMLButtonElement | null>(null)
const presetMenuEl = ref<HTMLElement | null>(null)
const presetMenuStyle = ref<Record<string, string>>({
  position: 'fixed',
  top: '-9999px',
  left: '-9999px',
  zIndex: '4100',
  visibility: 'hidden'
})
const editorRef = ref<{
  focus: () => void
  getSelection: () => { start: number; end: number }
  setSelection: (start: number, end?: number) => void
} | null>(null)
const dragFromId = ref<string | null>(null)
const dragOverId = ref<string | null>(null)
const dragMoved = ref(false)
const dragGhost = ref<RefChip | null>(null)
const dragGhostX = ref(0)
const dragGhostY = ref(0)
let suppressThumbClick = false
let dragPointerId: number | null = null
let dragStartX = 0
let dragStartY = 0
let dragOffsetX = 0
let dragOffsetY = 0
const DRAG_THRESHOLD_PX = 5

const dragGhostStyle = computed(() => ({
  transform: `translate3d(${Math.round(dragGhostX.value)}px, ${Math.round(dragGhostY.value)}px, 0)`
}))

interface RefPreviewContent {
  title: string
  thumbUrl: string
  text: string
}

/** 悬停预览浮层：图片显示缩略大图（限制尺寸），文本显示正文前段 */
const refPreview = ref<RefPreviewContent | null>(null)
const refPreviewEl = ref<HTMLElement | null>(null)
const refPreviewStyle = ref<Record<string, string>>({
  position: 'fixed',
  top: '-9999px',
  left: '-9999px',
  zIndex: '5200'
})
/** 预览代次：异步文件正文返回时若已切走/关闭则丢弃 */
let refPreviewEpoch = 0

/** 引入节点正文前段，避免大文本撑爆浮层 */
function sourcePreviewText(source: GraphNode): string {
  return resolveSourcePlainText(source).slice(0, 300)
}

/** 补充文件正文：剧本/文本资产以旁挂 txt/md 为准，其次节点内联，最后落盘 generatedTexts */
async function resolveSourcePreviewText(source: GraphNode): Promise<string> {
  const assetId = source.assetId?.trim()
  if (assetId) {
    try {
      const fromAsset = await resolveAssetText(assetId)
      if (fromAsset?.trim()) return fromAsset.trim()
    } catch {
      /* 读文件失败时回退内联 / generatedTexts */
    }
  }
  const inline = sourcePreviewText(source)
  if (inline) return inline
  for (const item of source.params.generatedTexts ?? []) {
    const path = item.relativePath?.trim()
    if (!path) continue
    try {
      const fromFile = await fetchTextFromAssetRelativePath(path)
      if (fromFile.trim()) return fromFile.trim()
    } catch {
      /* 尝试下一条 */
    }
  }
  return ''
}

function showRefPreview(
  kind: 'style' | 'frame' | 'mention',
  chip: StyleChip | FrameChip | RefChip,
  event: Event
): void {
  // 拖动换序期间不弹预览，避免遮挡干扰
  if (dragPointerId != null) return
  const anchor = event.currentTarget as HTMLElement | null
  if (!anchor) return
  const epoch = ++refPreviewEpoch
  const source =
    kind === 'style'
      ? null
      : graphEditorHosts.getNode(
          props.hostId,
          (chip as RefChip | FrameChip).sourceNodeId
        )
  const text = source ? sourcePreviewText(source) : ''
  refPreview.value = { title: chip.title, thumbUrl: chip.thumbUrl, text }
  void nextTick(() => positionRefPreview(anchor))
  // 文件正文异步补充：内联为空（剧本旁挂 txt 等）或资产正文优先时写回
  if (source) {
    void resolveSourcePreviewText(source).then((fileText) => {
      if (!fileText || epoch !== refPreviewEpoch) return
      const current = refPreview.value
      if (!current) return
      refPreview.value = { ...current, text: fileText.slice(0, 300) }
      requestAnimationFrame(() => {
        if (anchor.isConnected) positionRefPreview(anchor)
      })
    })
  }
}

function hideRefPreview(): void {
  refPreviewEpoch += 1
  refPreview.value = null
}

function positionRefPreview(anchor: HTMLElement): void {
  const tip = refPreviewEl.value
  if (!tip || !refPreview.value) return
  const rect = anchor.getBoundingClientRect()
  const vw = window.visualViewport?.width ?? window.innerWidth
  const vh = window.visualViewport?.height ?? window.innerHeight
  const tw = tip.offsetWidth
  const th = tip.offsetHeight
  const gap = 8
  // 优先放在缩略图右侧；右侧放不下则放左侧，上下超界时贴边收拢
  let left = rect.right + gap
  if (left + tw > vw - 8) left = Math.max(8, rect.left - tw - gap)
  left = Math.max(8, left)
  let top = rect.top
  if (top + th > vh - 8) top = Math.max(8, vh - th - 8)
  top = Math.max(8, top)
  refPreviewStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    zIndex: '5200'
  }
}

/** 预设按需动态加载，避免首次打开指令面板时同步解析大段模板 */
const presets = ref<InstructionPreset[]>([])
const presetTabs = ref<InstructionPresetTab[]>([])
const activePresetTab = ref<InstructionPresetTab>('general')
let presetsLoadedKind: InstructionPresetKind | null = null

async function ensurePresetsLoaded(): Promise<void> {
  const kind = props.presetKind
  if (!kind) {
    presets.value = []
    presetTabs.value = []
    presetsLoadedKind = null
    return
  }
  if (presetsLoadedKind === kind) return
  const mod = await import('@shared/graph/instructionPresets')
  presets.value = mod.listInstructionPresets(kind)
  presetTabs.value = mod.listInstructionPresetTabs(kind)
  activePresetTab.value = presetTabs.value[0] ?? 'general'
  presetsLoadedKind = kind
}

const visiblePresets = computed(() => {
  if (presetTabs.value.length <= 1) return presets.value
  const tab = activePresetTab.value
  return presets.value.filter((item) => (item.tab ?? 'general') === tab)
})

const presetMenuTitle = computed(() => {
  if (props.presetKind === 'screenplay') return t('graph.inspector.generate.presets.titleScreenplay')
  if (props.presetKind === 'optimize') return t('graph.inspector.generate.presets.titleOptimize')
  if (props.presetKind === 'toPrompt') return t('graph.inspector.generate.presets.titleToPrompt')
  if (props.presetKind === 'worldExtract') return t('graph.inspector.generate.presets.titleWorldExtract')
  if (props.presetKind === 'beatSplit') {
    return t('graph.inspector.generate.presets.titleBeatSplit')
  }
  if (props.presetKind === 'image') return t('graph.inspector.generate.presets.titleImage')
  if (props.presetKind === 'video') return t('graph.inspector.generate.presets.titleVideo')
  if (props.presetKind === 'lipSync') return t('graph.inspector.generate.presets.titleLipSync')
  return t('graph.inspector.generate.presets.title')
})

function presetTabLabel(tab: InstructionPresetTab): string {
  if (tab === 'game') return t('graph.inspector.generate.presets.tabGame')
  if (tab === 'film') return t('graph.inspector.generate.presets.tabFilm')
  return t('graph.inspector.generate.presets.tabGeneral')
}

function sourceTitle(node: GraphNode): string {
  const custom = node.title?.trim()
  if (custom) return custom
  if (node.typeId) return graphTypeLabel(node.typeId)
  if (node.assetType) return assetTypeLabel(node.assetType)
  return t('graph.defaultNode')
}

function sourceIcon(node: GraphNode): string {
  if (node.assetType && ASSET_TYPE_ICONS[node.assetType]) {
    return ASSET_TYPE_ICONS[node.assetType]
  }
  if (node.typeId === 'play.script') return '📝'
  if (node.typeId === 'note.text') return '📌'
  return '📄'
}

/** 预览/芯片摘要用：场参考节点需现场拼正文 */
function resolveSourcePlainText(node: GraphNode): string {
  if (node.typeId === 'beat.unitRef') {
    const beatId = readBoundBeatIdFromNodeParams(node.params)
    const assetId = resolveHostBeatAssetId(props.hostId)
    if (beatId && assetId) {
      const unit = loadBeatCatalog(assetId).find((row) => row.id === beatId)
      if (unit) return formatBeatRefText(unit)
    }
  }
  return resolveNodeTextContent(node)?.text?.trim() ?? node.params.notes?.trim() ?? ''
}

function resolveHostBeatAssetId(hostId: string): string | null {
  const match = /^asset:([^:]+)/.exec(hostId)
  return match?.[1] ?? null
}

function sourceSnippet(node: GraphNode): string {
  // 芯片摘要用轻量字段，避免打开指令面板时做全量拼装
  const quick =
    node.params.text?.trim() ||
    node.params.resultText?.trim() ||
    node.params.notes?.trim() ||
    ''
  if (quick) return quick.slice(0, 80)
  return ''
}

/** 从 GraphValue 取可预览相对路径 */
function mediaPathFromValue(value: GraphValue | undefined): string {
  if (!value) return ''
  if (value.kind === 'image' || value.kind === 'video') {
    return value.relativePath?.trim().replace(/\\/g, '/') || ''
  }
  if (value.kind === 'images' || value.kind === 'videos') {
    const item = value.items.find((i) => i.relativePath?.trim())
    return item?.relativePath?.trim().replace(/\\/g, '/') || ''
  }
  return ''
}

/** data: 预览（边界/图库内嵌） */
function resolveSourcePreviewDataUrl(source: GraphNode): string {
  const direct = source.params.previewDataUrl?.trim()
  if (direct?.startsWith('data:')) return direct
  const images = source.params.generatedImages
  if (!Array.isArray(images) || !images.length) return ''
  const selectedId = source.params.selectedImageId?.trim()
  const item =
    (selectedId ? images.find((row) => row.id === selectedId) : undefined) ||
    images[images.length - 1]
  const dataUrl = item?.dataUrl?.trim()
  return dataUrl?.startsWith('data:') ? dataUrl : ''
}

/**
 * 引用芯片缩略图路径：资产 relativePath、边界 previewRelativePath、图库落盘路径。
 * Cache/ 下的边界通常没有 assetId，必须读 previewRelativePath。
 */
function resolveSourcePreviewPath(source: GraphNode): string {
  const previewRel = source.params.previewRelativePath?.trim().replace(/\\/g, '/')
  if (previewRel) return previewRel
  const images = source.params.generatedImages
  if (Array.isArray(images) && images.length) {
    const selectedId = source.params.selectedImageId?.trim()
    const item =
      (selectedId ? images.find((row) => row.id === selectedId) : undefined) ||
      images[images.length - 1]
    const path = item?.relativePath?.trim().replace(/\\/g, '/')
    if (path) return path
  }
  if (isBoundaryInputNode(source)) {
    return mediaPathFromValue(softResolveBoundaryInputParams(source))
  }
  return ''
}

/** thumbUrls 缓存键：优先 assetId，否则用预览相对路径 */
function sourceThumbCacheKey(source: GraphNode | null): string {
  if (!source) return ''
  const assetId = source.assetId?.trim()
  if (assetId) return `asset:${assetId}`
  const path = resolveSourcePreviewPath(source)
  return path ? `path:${path}` : ''
}

function lookupThumbUrl(source: GraphNode | null): string {
  if (!source) return ''
  const dataUrl = resolveSourcePreviewDataUrl(source)
  if (dataUrl) return dataUrl
  const key = sourceThumbCacheKey(source)
  return key ? thumbUrls.value[key] ?? '' : ''
}

function toRefChip(
  edge: { edgeId: string; sourceNodeId: string; index: number },
  source: GraphNode | null
): RefChip {
  const title = source ? sourceTitle(source) : edge.sourceNodeId.slice(0, 8)
  return {
    edgeId: edge.edgeId,
    sourceNodeId: edge.sourceNodeId,
    index: edge.index,
    title,
    icon: source ? sourceIcon(source) : '📄',
    thumbUrl: lookupThumbUrl(source),
    snippet: source ? sourceSnippet(source) : ''
  }
}

function styleImagePreviewUrl(item: ProjectStyleImage): string {
  if (item.dataUrl?.startsWith('data:')) return item.dataUrl
  if (!item.libraryId) return ''
  return getDefaultStylePreset(item.libraryId)?.imageUrl?.trim() || ''
}

/** 当前节点生效的风格参考图（全局或本地） */
const activeStyleImages = computed((): ProjectStyleImage[] => {
  void revision.value
  if (props.presetKind !== 'image' && props.presetKind !== 'video') return []
  const node = graphEditorHosts.getNode(props.hostId, props.nodeId)
  return resolveGenerateStyleImages(
    {
      styleImagesUseGlobal: node?.params.styleImagesUseGlobal,
      styleImages: node?.params.styleImages
    },
    project.config?.styleImages
  )
})

/** 风格图占用 @1..@k，端口引用从 k+1 起（与 API image[] 顺序一致） */
const styleMentionReserve = computed(() => activeStyleImages.value.length)

/** 指令框内展示风格缩略图：标明「风格」，不可拖动换序 */
const styleChips = computed((): StyleChip[] => {
  const roleLabel = t('graph.inspector.generate.styleRefRole')
  return activeStyleImages.value.map((item, i) => {
    const index = i + 1
    const name = item.name?.trim() || t('graph.inspector.generate.previewStyleImageFallback')
    return {
      id: item.id,
      index,
      roleLabel,
      title: t('graph.inspector.generate.styleRefTitle', {
        n: index,
        name,
        weight: clampStyleImageWeight(item.weight)
      }),
      thumbUrl: styleImagePreviewUrl(item)
    }
  })
})

const mentionChips = computed((): RefChip[] => {
  void revision.value
  const edges = graphEditorHosts
    .listIncomingEdges(props.hostId, props.nodeId)
    .filter((edge) => !isVideoFramePortId(edge.targetPort))
  const reserve = styleMentionReserve.value
  // 重新按非帧口编号，并叠加风格占位，与执行侧 / API @n 一致
  return edges.map((edge, i) => {
    const source = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
    return toRefChip({ ...edge, index: portMentionIndex(i, reserve) }, source)
  })
})

const frameChips = computed((): FrameChip[] => {
  void revision.value
  const edges = graphEditorHosts
    .listIncomingEdges(props.hostId, props.nodeId)
    .filter((edge) => isVideoFramePortId(edge.targetPort))
  const order = [VIDEO_FIRST_FRAME_PORT_ID, VIDEO_LAST_FRAME_PORT_ID]
  return [...edges]
    .sort((a, b) => {
      const ai = order.indexOf((a.targetPort ?? '') as (typeof order)[number])
      const bi = order.indexOf((b.targetPort ?? '') as (typeof order)[number])
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi)
    })
    .map((edge) => {
      const source = graphEditorHosts.getNode(props.hostId, edge.sourceNodeId)
      const title = source ? sourceTitle(source) : edge.sourceNodeId.slice(0, 8)
      const roleLabel =
        edge.targetPort === VIDEO_LAST_FRAME_PORT_ID
          ? t('graph.port.lastFrame')
          : t('graph.port.firstFrame')
      return {
        edgeId: edge.edgeId,
        sourceNodeId: edge.sourceNodeId,
        targetPort: edge.targetPort ?? VIDEO_FIRST_FRAME_PORT_ID,
        roleLabel,
        title: `${roleLabel} · ${title}`,
        icon: source ? sourceIcon(source) : '📄',
        thumbUrl: lookupThumbUrl(source)
      }
    })
})

const mentionOptions = computed((): RefMentionOption[] =>
  mentionChips.value.map((chip) => ({
    token: `@${chip.index}`,
    label: chip.snippet ? `${chip.title} · ${chip.snippet}` : chip.title,
    kind: 'visual'
  }))
)

watch(
  [mentionChips, frameChips],
  async ([mentions, frames]) => {
    for (const chip of [...mentions, ...frames]) {
      const source = graphEditorHosts.getNode(props.hostId, chip.sourceNodeId)
      if (!source) continue
      // data: 已在 lookupThumbUrl 同步返回，无需异步缓存
      if (resolveSourcePreviewDataUrl(source)) continue
      const key = sourceThumbCacheKey(source)
      if (!key || thumbUrls.value[key]) continue

      let path = ''
      const assetId = source.assetId?.trim()
      if (assetId) {
        const asset = project.assets.find((item) => item.id === assetId)
        if (asset && (asset.type === 'image' || asset.type === 'video')) {
          path =
            asset.type === 'image'
              ? asset.relativePath?.trim() || ''
              : asset.thumbnailPath?.trim() || asset.relativePath?.trim() || ''
        }
      }
      // 边界常无 assetId，或资产表缺失时仍可读 previewRelativePath
      if (!path) path = resolveSourcePreviewPath(source)
      if (!path) continue
      try {
        thumbUrls.value[key] = await resolveAssetPreviewUrl(path)
      } catch {
        /* ignore */
      }
    }
  },
  { immediate: true, deep: true }
)

/** 风格张数变化时，平移指令里已有的端口 `@n`，与 chips 保持一致 */
watch(styleMentionReserve, (next, prev) => {
  if (prev == null || next === prev) return
  if (props.presetKind !== 'image' && props.presetKind !== 'video') return
  const portCount = graphEditorHosts
    .listIncomingEdges(props.hostId, props.nodeId)
    .filter((edge) => !isVideoFramePortId(edge.targetPort)).length
  const indexMap = buildMentionIndexMapForStyleReserveChange(prev, next, portCount)
  const nextText = remapInstructionMentions(props.modelValue ?? '', indexMap)
  if (nextText !== (props.modelValue ?? '')) {
    emit('update:modelValue', nextText)
    emit('change')
  }
})

function onUpdate(value: string): void {
  emit('update:modelValue', value)
}

function disconnect(edgeId: string): void {
  graphEditorHosts.removeEdge(props.hostId, edgeId)
}

function chipDragTitle(chip: RefChip): string {
  return `${chip.title} · ${t('graph.inspector.generate.reorderRef')}`
}

function setDraggingCursor(on: boolean): void {
  document.body.classList.toggle('instruction-ref-dragging', on)
}

function resetChipDrag(): void {
  dragFromId.value = null
  dragOverId.value = null
  dragMoved.value = false
  dragGhost.value = null
  dragPointerId = null
  setDraggingCursor(false)
}

function applyChipReorder(fromId: string, toId: string): void {
  if (fromId === toId) return
  const oldMentionIds = mentionChips.value.map((item) => item.edgeId)
  const fromIdx = oldMentionIds.indexOf(fromId)
  const toIdx = oldMentionIds.indexOf(toId)
  if (fromIdx < 0 || toIdx < 0) return

  const nextMentionIds = [...oldMentionIds]
  nextMentionIds.splice(fromIdx, 1)
  nextMentionIds.splice(toIdx, 0, fromId)
  if (nextMentionIds.every((id, i) => id === oldMentionIds[i])) return

  // 帧口位置保持不变，只在 mention 槽位上换序
  const allEdges = graphEditorHosts.listIncomingEdges(props.hostId, props.nodeId)
  let mi = 0
  const nextFullIds = allEdges.map((edge) =>
    isVideoFramePortId(edge.targetPort) ? edge.edgeId : nextMentionIds[mi++]!
  )

  const indexMap = buildMentionIndexMapAfterReorder(
    oldMentionIds,
    nextMentionIds,
    styleMentionReserve.value
  )
  const nextText = remapInstructionMentions(props.modelValue ?? '', indexMap)
  graphEditorHosts.reorderIncomingEdges(props.hostId, props.nodeId, nextFullIds)
  if (nextText !== (props.modelValue ?? '')) {
    emit('update:modelValue', nextText)
    emit('change')
  }
}

function onChipPointerDown(chip: RefChip, event: PointerEvent): void {
  if (event.button !== 0) return
  const target = event.target as HTMLElement | null
  if (target?.closest('.ref-close')) return
  // 节点卡有 @dragstart.prevent，改用 pointer 换序，避免 HTML5 DnD 被父级取消
  const chipEl = event.currentTarget as HTMLElement
  const rect = chipEl.getBoundingClientRect()
  dragFromId.value = chip.edgeId
  dragOverId.value = null
  dragMoved.value = false
  dragGhost.value = null
  dragPointerId = event.pointerId
  dragStartX = event.clientX
  dragStartY = event.clientY
  dragOffsetX = event.clientX - rect.left
  dragOffsetY = event.clientY - rect.top
  chipEl.setPointerCapture(event.pointerId)
}

function updateDragGhostPosition(clientX: number, clientY: number): void {
  dragGhostX.value = clientX - dragOffsetX
  dragGhostY.value = clientY - dragOffsetY
}

function onChipPointerMove(event: PointerEvent): void {
  if (dragPointerId == null || event.pointerId !== dragPointerId || !dragFromId.value) return
  const dx = event.clientX - dragStartX
  const dy = event.clientY - dragStartY
  if (!dragMoved.value) {
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
    dragMoved.value = true
    const chip = mentionChips.value.find((item) => item.edgeId === dragFromId.value) ?? null
    dragGhost.value = chip
    updateDragGhostPosition(event.clientX, event.clientY)
    setDraggingCursor(true)
  } else {
    updateDragGhostPosition(event.clientX, event.clientY)
  }
  // 幽灵层 pointer-events:none，不会挡住命中检测
  const el = document.elementFromPoint(event.clientX, event.clientY)
  // 仅端口引用可换序；风格 / 首尾帧 chip 无 data-edge-id，不可作为落点
  const over = el?.closest('.ref-chip[data-edge-id]') as HTMLElement | null
  const overId = over?.dataset.edgeId ?? null
  dragOverId.value = overId && overId !== dragFromId.value ? overId : null
}

function onChipPointerUp(event: PointerEvent): void {
  if (dragPointerId == null || event.pointerId !== dragPointerId) return
  const fromId = dragFromId.value
  const toId = dragOverId.value
  const moved = dragMoved.value
  try {
    ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  } catch {
    /* already released */
  }
  resetChipDrag()
  if (moved) suppressThumbClick = true
  if (!moved || !fromId || !toId) return
  applyChipReorder(fromId, toId)
}

function onChipPointerCancel(): void {
  resetChipDrag()
}

function onThumbClick(chip: RefChip): void {
  if (suppressThumbClick) {
    suppressThumbClick = false
    return
  }
  insertToken(`@${chip.index}`)
}

function insertToken(token: string): void {
  const current = props.modelValue ?? ''
  const spacer = !current || /\s$/.test(current) ? '' : ' '
  emit('update:modelValue', `${current}${spacer}${token} `)
  emit('change')
  editorRef.value?.focus()
}

function onEditorDblClick(): void {
  // 内联编辑框双击打开大窗（节点下方面板与 Inspector 共用）
  if (props.variant === 'inline') emit('expand')
}

function updatePresetMenuPosition(): void {
  // 锚在工具栏右侧操作区（与原先 absolute right 视觉一致）
  const anchor =
    (rootEl.value?.querySelector('.toolbar-actions') as HTMLElement | null) ??
    presetBtnEl.value
  const menu = presetMenuEl.value
  if (!anchor) return

  const rect = anchor.getBoundingClientRect()
  const gap = 6
  const menuW = menu?.offsetWidth || 200
  const menuH = menu?.offsetHeight || Math.min(320, 48 + presets.value.length * 34)

  let top = rect.bottom + gap
  // 菜单右缘对齐锚点右缘
  let left = rect.right - menuW

  if (left < 8) left = 8
  if (left + menuW > window.innerWidth - 8) {
    left = Math.max(8, window.innerWidth - menuW - 8)
  }
  if (top + menuH > window.innerHeight - 8) {
    top = Math.max(8, rect.top - menuH - gap)
  }

  presetMenuStyle.value = {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    right: 'auto',
    zIndex: '4100',
    visibility: 'visible'
  }
}

async function openPresetMenu(): Promise<void> {
  await ensurePresetsLoaded()
  if (!presets.value.length) return
  if (presetTabs.value.length) {
    activePresetTab.value = presetTabs.value[0] ?? 'general'
  }
  presetMenuStyle.value = {
    position: 'fixed',
    top: '-9999px',
    left: '-9999px',
    zIndex: '4100',
    visibility: 'hidden'
  }
  menuOpen.value = true
  await nextTick()
  updatePresetMenuPosition()
  // 再测一次：字体/滚动条就绪后尺寸更准
  requestAnimationFrame(() => updatePresetMenuPosition())
}

function toggleMenu(): void {
  if (menuOpen.value) {
    closeMenu()
    return
  }
  void openPresetMenu()
}

function closeMenu(): void {
  menuOpen.value = false
}

function onPresetMenuReposition(): void {
  if (!menuOpen.value) return
  updatePresetMenuPosition()
}

function visualForPreset(item: InstructionPreset): PresetVisual {
  return resolveInstructionVisual(item)
}

function applyPreset(item: InstructionPreset): void {
  const current = props.modelValue ?? ''
  const position = editorRef.value?.getSelection().start ?? current.length
  const inserted = insertInstructionPresetText(current, item.body, position)
  emit('update:modelValue', inserted.text)
  emit('change')
  closeMenu()
  editorRef.value?.setSelection(inserted.cursor)
}

function buildMentionSources(): InstructionMentionSource[] {
  void revision.value
  return mentionChips.value.map((chip) => {
    const source = graphEditorHosts.getNode(props.hostId, chip.sourceNodeId)
    // 与执行侧一致：图片/视频/声音保留 @n，文本类才展开正文
    const keepMentionToken = shouldKeepInstructionMentionToken(source)
    return {
      index: chip.index,
      title: chip.title,
      text: keepMentionToken ? '' : source ? resolveSourcePlainText(source) : '',
      keepMentionToken
    }
  })
}

function buildPreviewImages(styleImages: ProjectStyleImage[]): NotepadPreviewImage[] {
  const batch: NotepadPreviewImage[] = []
  const styles = normalizeProjectStyleImages(styleImages)
  for (const [index, item] of styles.entries()) {
    const url = styleImagePreviewUrl(item)
    if (!url) continue
    const name = item.name?.trim() || t('graph.inspector.generate.previewStyleImageFallback')
    batch.push({
      url,
      label: t('graph.inspector.generate.previewStyleImageAt', {
        n: index + 1,
        name,
        weight: clampStyleImageWeight(item.weight)
      })
    })
  }
  for (const chip of frameChips.value) {
    if (!chip.thumbUrl) continue
    batch.push({ url: chip.thumbUrl, label: chip.roleLabel || chip.title })
  }
  for (const chip of mentionChips.value) {
    if (!chip.thumbUrl) continue
    batch.push({
      url: chip.thumbUrl,
      label: `@${chip.index}${chip.title ? ` ${chip.title}` : ''}`
    })
  }
  return batch
}

function openPromptPreview(): void {
  closeMenu()
  const node = graphEditorHosts.getNode(props.hostId, props.nodeId)
  const kind = resolveInstructionFinalPreviewKind(node, props.presetKind)
  const styleImages =
    kind === 'image' || kind === 'video'
      ? enrichStyleImagesWithLibraryPrompts(
          resolveGenerateStyleImages(
            {
              styleImagesUseGlobal: node?.params.styleImagesUseGlobal,
              styleImages: node?.params.styleImages
            },
            project.config?.styleImages
          ),
          String(locale.value)
        )
      : []
  previewText.value = buildInstructionFinalPromptPreview({
    kind,
    instructionRaw: props.modelValue ?? '',
    sources: buildMentionSources(),
    systemPrompt: node?.params.generateSystemPrompt,
    locale: String(locale.value),
    styleImages,
    reshootSegment:
      kind === 'reshoot'
        ? {
            startSec: Number(node?.params.reshootStartSec ?? 0),
            endSec: Number(node?.params.reshootEndSec ?? 0)
          }
        : undefined
  })
  previewImages.value =
    kind === 'image' || kind === 'video' ? buildPreviewImages(styleImages) : []
  previewOpen.value = true
}

function onEditorMouseDown(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  // 点在编辑区内空白处时聚焦输入框
  if (target?.closest('textarea') || target?.closest('.mention-menu')) return
  editorRef.value?.focus()
}

function onWindowPointerDown(e: PointerEvent): void {
  if (!menuOpen.value) return
  const target = e.target as Node | null
  if (!target) {
    closeMenu()
    return
  }
  const el = target instanceof Element ? target : target.parentElement
  if (el?.closest('.preset-btn') || el?.closest('.preset-menu') || el?.closest('.preview-btn')) return
  closeMenu()
}

watch(menuOpen, (open) => {
  if (open) {
    window.addEventListener('scroll', onPresetMenuReposition, true)
    window.addEventListener('resize', onPresetMenuReposition)
  } else {
    window.removeEventListener('scroll', onPresetMenuReposition, true)
    window.removeEventListener('resize', onPresetMenuReposition)
  }
})

watch(activePresetTab, () => {
  if (!menuOpen.value) return
  void nextTick(() => {
    updatePresetMenuPosition()
    requestAnimationFrame(() => updatePresetMenuPosition())
  })
})

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown, true)
})

onBeforeUnmount(() => {
  resetChipDrag()
  window.removeEventListener('pointerdown', onWindowPointerDown, true)
  window.removeEventListener('scroll', onPresetMenuReposition, true)
  window.removeEventListener('resize', onPresetMenuReposition)
})
</script>

<style scoped>
.instruction-box {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-panel);
  box-sizing: border-box;
  overflow: hidden;
}

.instruction-box.dialog {
  height: 100%;
  border: none;
  border-radius: 0;
  background: transparent;
}

.toolbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 10px 0;
  box-sizing: border-box;
}

.toolbar-spacer {
  flex: 1;
  min-height: 24px;
}

.toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.ref-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.ref-chip {
  position: relative;
  width: 48px;
  height: 48px;
  flex: none;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.ref-chip.frame-chip,
.ref-chip.style-chip {
  cursor: default;
  touch-action: auto;
}

.ref-chip.frame-chip .ref-thumb,
.ref-chip.style-chip .ref-thumb {
  cursor: pointer;
  border-color: color-mix(in srgb, var(--accent) 55%, var(--border));
}

.ref-chip.style-chip .ref-role {
  background: color-mix(in srgb, #c9842a 88%, #000 12%);
}

.ref-chip.style-chip .ref-index {
  left: auto;
  right: 4px;
  top: auto;
  bottom: 4px;
}

.ref-role {
  position: absolute;
  left: 2px;
  top: 2px;
  z-index: 2;
  max-width: calc(100% - 4px);
  padding: 0 4px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--accent) 85%, #000 15%);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.ref-chip.dragging {
  opacity: 0.35;
  cursor: grabbing;
}

.ref-chip.drag-over .ref-thumb {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
}

.ref-chip.dragging .ref-thumb {
  border-style: dashed;
}

.ref-drag-ghost {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 5000;
  width: 48px;
  height: 48px;
  border: 1px solid var(--accent);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.35),
    0 0 0 1px color-mix(in srgb, var(--accent) 40%, transparent);
  opacity: 0.92;
  pointer-events: none;
  will-change: transform;
}

.ref-drag-ghost img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ref-drag-ghost .ref-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 22px;
  background: var(--bg-hover);
}

.ref-drag-ghost .ref-index {
  position: absolute;
  left: 4px;
  top: 4px;
  z-index: 2;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bg) 70%, #000 30%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}

:global(body.instruction-ref-dragging),
:global(body.instruction-ref-dragging *) {
  cursor: grabbing !important;
}

.ref-thumb {
  position: relative;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg-elevated);
  cursor: inherit;
}

.ref-thumb:hover {
  border-color: var(--accent);
}

.ref-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.ref-index {
  position: absolute;
  left: 4px;
  top: 4px;
  z-index: 2;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--bg) 70%, #000 30%);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
  pointer-events: none;
}

.ref-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  font-size: 22px;
  background: var(--bg-hover);
}

.ref-close {
  position: absolute;
  right: -4px;
  top: -4px;
  z-index: 3;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--panel-glass);
  color: var(--text);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  opacity: 0;
}

.ref-chip:hover .ref-close {
  opacity: 1;
}

.ref-close:hover {
  background: rgba(200, 70, 70, 0.92);
  color: #fff;
}

.ref-preview-tip {
  position: fixed;
  z-index: 5200;
  box-sizing: border-box;
  max-width: min(300px, calc(100vw - 16px));
  max-height: min(320px, calc(100vh - 16px));
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elevated);
  box-shadow: 0 10px 28px var(--shadow);
  overflow: hidden;
  pointer-events: none;
}

.ref-preview-title {
  flex: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ref-preview-tip img {
  flex: none;
  width: 220px;
  height: 150px;
  object-fit: contain;
  border-radius: 6px;
  background: var(--bg-hover);
  display: block;
}

.ref-preview-text {
  flex: none;
  font-size: 12px;
  line-height: 1.55;
  color: var(--fg);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 130px;
  overflow: hidden;
}

.preset-btn {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel-glass);
  color: var(--text);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.preset-btn:hover,
.preset-btn[aria-expanded='true'] {
  border-color: var(--accent-45);
  color: var(--accent);
  background: var(--accent-12);
}

.preset-icon {
  width: 12px;
  height: 12px;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 2px;
  background:
    linear-gradient(currentColor, currentColor) 2px 3px / 8px 1.5px no-repeat,
    linear-gradient(currentColor, currentColor) 2px 6px / 8px 1.5px no-repeat,
    linear-gradient(currentColor, currentColor) 2px 9px / 5px 1.5px no-repeat;
}

.preview-btn {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.preview-btn:hover {
  color: var(--accent);
}

/* 眼睛图标：预览最终提示词 */
.preview-icon {
  position: relative;
  width: 14px;
  height: 9px;
  border: 1.5px solid currentColor;
  border-radius: 50% / 55%;
  box-sizing: border-box;
}

.preview-icon::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  transform: translate(-50%, -50%);
}

.preset-menu {
  position: fixed;
  z-index: 4100;
  width: min(320px, calc(100vw - 16px));
  max-height: min(360px, calc(100vh - 16px));
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  box-shadow: 0 10px 28px var(--shadow);
}

.preset-menu.has-tabs {
  width: min(360px, calc(100vw - 16px));
  max-height: min(420px, calc(100vh - 16px));
}

.preset-menu-title {
  padding: 4px 8px 6px;
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
}

.preset-tabs {
  display: flex;
  gap: 4px;
  padding: 0 4px 8px;
}

.preset-tab {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-panel, var(--bg));
  color: var(--text-muted);
  font-size: 11px;
  cursor: pointer;
}

.preset-tab:hover {
  color: var(--text);
  background: var(--bg-hover);
}

.preset-tab.active {
  border-color: var(--accent-45);
  color: var(--accent-fg);
  background: var(--accent-18);
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  padding: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-panel, var(--bg));
  color: var(--text);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  min-width: 0;
}

.preset-card:hover {
  background: var(--bg-hover);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}

.preset-glyph {
  height: 48px;
  min-height: 48px;
}

.preset-card-title {
  font-size: 11px;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.editor-area {
  flex: 1;
  width: 100%;
  min-height: 120px;
  padding: 8px 10px 10px;
  box-sizing: border-box;
  cursor: text;
}

.footer-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px 8px;
  border-top: 1px solid var(--border);
  box-sizing: border-box;
  background: var(--bg-elevated);
  min-height: 36px;
}

.instruction-box.inline .editor-area {
  min-height: 120px;
}

.instruction-box.dialog .editor-area {
  min-height: 280px;
}

.instruction-input {
  display: block;
  width: 100%;
}

.instruction-input :deep(.mention-wrap) {
  width: 100%;
}

.instruction-input :deep(textarea) {
  display: block;
  width: 100%;
  min-height: 120px;
  margin: 0;
  padding: 0;
  border: none !important;
  border-radius: 0;
  /* 透明底，缩放柄跟外层 instruction 面板同色 */
  --textarea-bg: var(--bg-panel);
  background: transparent !important;
  box-shadow: none !important;
  outline: none;
  resize: vertical;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
  box-sizing: border-box;
}

.instruction-box.dialog .instruction-input :deep(textarea) {
  min-height: 280px;
}

.instruction-input :deep(textarea:focus) {
  border: none !important;
  outline: none;
  box-shadow: none !important;
}

.instruction-input :deep(textarea::-webkit-resizer) {
  background-color: var(--textarea-bg);
  background-image: var(--resizer-grip);
  border: none;
}

.instruction-input :deep(.mention-hint) {
  display: none;
}

.expand-btn {
  flex: none;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.expand-btn:hover {
  color: var(--accent);
}

</style>
