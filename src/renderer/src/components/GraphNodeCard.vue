<template>
  <div
    class="graph-node"
    :class="{
      selected,
      output: node.category === 'output',
      'asset-ref': isAssetRef,
      'asset-missing': isMissingLinkedAsset,
      'processing-node': isProcessingNode,
      'lock-node': isLocked,
      connecting: connecting,
      'link-mode': linkMode,
      'run-error': runStatus === 'error',
      'run-running': runStatus === 'running',
      'instruction-open': instructionOpen,
      'preview-collapsed': previewCollapsed
    }"
    :data-node-id="node.id"
    :style="{
      left: `${node.position.x}px`,
      top: `${node.position.y}px`,
      width: `${width}px`,
      height: `${height}px`
    }"
    @pointerdown.stop="onPointerDown"
    @dragstart.prevent
  >
    <div class="node-title">
      <input
        v-if="editingTitle"
        ref="titleInputEl"
        v-model="titleDraft"
        class="title-input"
        :size="Math.max(12, titleDraft.length)"
        @pointerdown.stop
        @dblclick.stop
        @blur="commitTitleEdit"
        @keydown.enter.prevent="commitTitleEdit"
        @keydown.esc.prevent="cancelTitleEdit"
      />
      <span
        v-else
        class="title"
        :title="displayTitle"
        @dblclick.stop="startTitleEdit"
      >{{ displayTitle }}</span>
    </div>

    <div class="node-head">
      <button
        type="button"
        class="collapse-tri-btn"
        :class="{ collapsed: previewCollapsed }"
        :title="previewCollapsed ? t('graph.node.expandPreview') : t('graph.node.collapsePreview')"
        :aria-expanded="!previewCollapsed"
        :aria-label="previewCollapsed ? t('graph.node.expandPreview') : t('graph.node.collapsePreview')"
        @pointerdown.stop
        @click.stop="togglePreviewCollapsed"
      >
        <span class="collapse-tri" aria-hidden="true" />
      </button>
      <div class="head-actions">
        <button
          v-if="canLock"
          type="button"
          class="lock-btn"
          :class="{ active: isLocked }"
          :title="isLocked ? t('graph.node.disableLock') : t('graph.node.enableLock')"
          :aria-pressed="isLocked"
          :aria-label="isLocked ? t('graph.node.disableLock') : t('graph.node.enableLock')"
          @pointerdown.stop
          @click.stop="toggleLock"
        >
          <LockIcon :locked="isLocked" :size="12" />
        </button>
        <span
          v-if="runStatus && runStatus !== 'idle' && runStatus !== 'skipped'"
          class="run-pill"
          :class="runStatus"
          :title="runError || runStatusLabel"
        >
          {{ runStatusLabel }}
        </span>
        <GraphNodeRunControl
          v-if="hasInPort"
          compact
          :status="runStatus"
          :is-running="isGraphRunning"
          :blocked="isGraphRunning || isMissingLinkedAsset"
          @toggle="emit('runToggle', node.id)"
        />
      </div>
    </div>

    <div
      v-show="!previewCollapsed"
      class="preview"
      :class="{
        'has-text': !!textPreview || cardTextGridItems.length > 1,
        'preview-icon-only': hideCardPreview
      }"
      @dblclick.stop="onPreviewDblClick"
    >
      <div
        v-if="hideCardPreview"
        class="media-fallback preview-icon-fallback"
        :title="scriptNodePreviewTitle"
      >
        <span class="icon">{{ typeIcon }}</span>
        <span class="hint">{{ scriptNodePreviewTitle }}</span>
      </div>

      <template v-else>
      <img
        v-if="(isDirectorGenerateNode || isDirectorOutputNode) && directorLivePreview && cardImageGridSrcs.length <= 1"
        :src="directorLivePreview"
        alt=""
        class="camera-live-preview"
        loading="lazy"
        decoding="async"
        draggable="false"
      />

      <div
        v-else-if="cardImageGridSrcs.length > 1"
        class="card-preview-grid"
        :title="previewOpenHint"
      >
        <img
          v-for="(src, index) in cardImageGridSrcs"
          :key="`grid-img-${index}`"
          :src="src"
          alt=""
          loading="lazy"
          decoding="async"
          draggable="false"
        />
      </div>

      <img
        v-else-if="(isSelectImageNode(node) || isSelectShotEntitiesNode(node) || isMultiAngleEditorNode(node) || isLightingEditorNode(node) || isPortraitTextureEditorNode(node) || isEmotionEditorNode(node) || isUpscaleEditorNode(node) || isExpandEditorNode(node) || isRedrawEditorNode(node) || isEraseEditorNode(node) || isMatteEditorNode(node) || isCropEditorNode(node) || isGridSplitEditorNode(node)) && selectImagePreview"
        :src="selectImagePreview"
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
      />

      <div
        v-else-if="cardTextGridItems.length > 1"
        class="card-text-grid"
        :title="previewOpenHint"
      >
        <pre
          v-for="(item, index) in cardTextGridItems"
          :key="`grid-text-${index}`"
          class="card-text-grid-item"
        >{{ item }}</pre>
      </div>

      <div v-else-if="textPreview" class="text-preview" :title="previewOpenHint">
        <pre class="text-preview-body">{{ textPreview }}</pre>
        <span class="text-preview-hint">{{ previewOpenHint }}</span>
      </div>

      <img
        v-else-if="previewKind === 'image' && previewUrl"
        :src="previewUrl"
        alt=""
        loading="lazy"
        decoding="async"
        draggable="false"
      />

      <video
        v-else-if="previewKind === 'video' && previewUrl"
        ref="videoEl"
        :src="previewUrl"
        :muted="mediaMuted"
        :loop="mediaLoop"
        preload="auto"
        playsinline
        draggable="false"
        @play="onMediaPlay"
        @pause="onMediaPause"
        @ended="onMediaEnded"
        @timeupdate="onMediaTimeUpdate"
        @loadedmetadata="onMediaLoaded"
        @durationchange="onMediaLoaded"
        @mouseenter="onVideoMouseEnter"
        @mouseleave="onVideoMouseLeave"
        @error="onVideoError"
      />

      <div v-else-if="previewKind === 'voice'" class="media-fallback audio">
        <span class="icon">{{ typeIcon }}</span>
        <span v-if="!showMediaTransport || !previewUrl || mediaError" class="hint">{{
          previewHint
        }}</span>
        <audio
          v-if="previewUrl"
          ref="audioEl"
          :src="previewUrl"
          :muted="mediaMuted"
          :loop="mediaLoop"
          preload="auto"
          @play="onMediaPlay"
          @pause="onMediaPause"
          @ended="onMediaEnded"
          @timeupdate="onMediaTimeUpdate"
          @loadedmetadata="onMediaLoaded"
          @durationchange="onMediaLoaded"
          @error="onAudioError"
        />
      </div>

      <div v-else class="media-fallback">
        <span class="icon">{{ typeIcon }}</span>
        <span class="hint">{{ previewHint }}</span>
      </div>

      <div
        v-if="showMediaTransport && previewUrl && !mediaError"
        class="transport"
        @pointerdown.stop
        @click.stop
        @wheel.stop
      >
        <div class="transport-actions">
          <button type="button" class="ctrl-btn" :title="t('graph.media.restart')" @click="seekToStart">
            <span class="icon-restart" />
          </button>
          <button
            type="button"
            class="ctrl-btn primary"
            :title="mediaPlaying ? t('graph.media.pause') : t('graph.media.play')"
            @click="togglePlayback"
          >
            <span :class="{ pause: mediaPlaying, triangle: !mediaPlaying }" />
          </button>
          <div class="time-row inline">
            <span>{{ formatTime(currentTime) }}</span>
            <span>/</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
        </div>
        <div class="progress-wrap">
          <input
            ref="progressInput"
            class="progress"
            type="range"
            min="0"
            max="1000"
            step="1"
            :value="progressValue"
            @input="onSeekInput"
            @change="onSeekChange"
          />
        </div>
      </div>

      <span v-if="mediaError" class="media-error">{{ mediaErrorText }}</span>
      </template>
    </div>

    <div
      v-if="instructionOpen && instructionKind && hostId"
      class="instruction-panel"
      @pointerdown.stop
      @dblclick.stop
      @wheel.stop
    >
      <div class="instruction-panel-label">{{ t('graph.inspector.generate.instruction') }}</div>
      <GraphInstructionMentionEditor
        v-model="instruction"
        :host-id="hostId"
        :node-id="node.id"
        :preset-kind="instructionKind"
        :rows="5"
        :placeholder="instructionPlaceholder"
        @change="persistInstruction"
        @expand="openInstructionDialog"
      >
        <template #footer>
          <InstructionModelSelect
            v-model="selectedModelKey"
            :options="modelOptions"
            :title="instructionModelTitle"
            :empty-label="t('graph.inspector.generate.noModels')"
            @change="persistGenerateModel"
          />
          <ImageGenerateParamsSelect
            v-if="showImageGenerateParams"
            v-model="imageGenerateParams"
            :model-key="selectedModelKey"
            @change="persistImageGenerateParams"
          />
          <VideoGenerateParamsSelect
            v-if="showVideoGenerateParams"
            v-model="videoGenerateParams"
            :model-key="selectedModelKey"
            :hide-frame-mode="instructionKind === 'lipSync'"
            @change="persistVideoGenerateParams"
          />
        </template>
      </GraphInstructionMentionEditor>
      <GraphInstructionEditorDialog
        v-if="instructionDialogMounted"
        :open="instructionDialogOpen"
        v-model="instruction"
        :host-id="hostId"
        :node-id="node.id"
        :preset-kind="instructionKind"
        :placeholder="instructionPlaceholder"
        @change="persistInstruction"
        @close="instructionDialogOpen = false"
      />
    </div>

    <div
      v-for="(port, index) in inPorts"
      :key="`in-${port.id}`"
      class="port-wrap in"
      :style="portWrapStyle(inPorts.length, index)"
    >
      <span class="port-type">{{ inPortTypeLabel(port) }}</span>
      <button
        type="button"
        class="port in"
        :class="[portDataTypeClass(port), { 'port-square': isBatchPort(port) }]"
        :data-port-id="port.id"
        :title="inPortTitle(port)"
        @pointerdown.stop.prevent="onInPortDown(port.id, $event)"
      />
      <span
        v-if="shouldShowPortLimitBadge(port)"
        class="port-limit"
      >{{ portLimitBadge(port) }}</span>
    </div>
    <div
      v-for="(port, index) in outPorts"
      :key="`out-${port.id}`"
      class="port-wrap out"
      :style="portWrapStyle(outPorts.length, index)"
    >
      <button
        type="button"
        class="port out"
        :class="[portDataTypeClass(port), { 'port-square': isBatchPort(port) }]"
        :data-port-id="port.id"
        :title="outPortTitle(port)"
        @pointerdown.stop.prevent="onOutPortDown(port.id, $event)"
      />
      <span class="port-type">{{ outPortTypeLabel(port) }}</span>
    </div>

    <GraphNodeResizeHandle v-if="!previewCollapsed" @resize-start="onResizeStart" />

    <span
      v-if="!previewCollapsed"
      class="type-badge"
      :class="typeBadgeClass"
      :title="typeBadgeTitle"
    >{{ typeBadgeIcon }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import GraphNodeResizeHandle from './GraphNodeResizeHandle.vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import LockIcon from './icons/LockIcon.vue'
import GraphInstructionMentionEditor from './GraphInstructionMentionEditor.vue'
import GraphInstructionEditorDialog from './GraphInstructionEditorDialog.vue'
import InstructionModelSelect from './InstructionModelSelect.vue'
import ImageGenerateParamsSelect from './ImageGenerateParamsSelect.vue'
import VideoGenerateParamsSelect from './VideoGenerateParamsSelect.vue'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  loadGenerateModelOptions,
  parseModelKey,
  preferredModelKey,
  type GenerateModelModality,
  type GenerateModelOption
} from '../features/graph/model/generateModelOptions'
import { loadImageGenerateCapabilities } from '../features/graph/model/imageGenerateCapabilities'
import { loadVideoGeneratePortLimits } from '../features/graph/model/videoGenerateCapabilities'
import {
  ASSET_TYPE_ICONS,
  assetDisplayIcon,
  isImportedMediaRefAsset,
  isSoundAsset,
  resolveGenerateStyleImages,
  type AssetInfo
} from '@shared/domain'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  GRAPH_OUT_ALL_PORT_ID,
  deductReservedImageSlots,
  formatDurationRange,
  formatPortLimitBadge,
  getGraphScopeDefinition,
  getNodePorts,
  getNodeSize,
  nodePortYRatio,
  GraphPortType,
  imageGenerateParamsToNodePatch,
  isNodeTextCapable,
  isAssetRefNode,
  isGenerateLocked,
  isProcessingAssetNode,
  supportsGenerateLock,
  isVideoFramePortId,
  isDirectorProcessingNode,
  isScriptShotImageGenNode,
  isScriptShotParamsNode,
  isScriptShotSplitNode,
  isScriptShotTableNode,
  isScriptShotVideoGenNode,
  isTimelineOutputNode,
  isWorldGenNode,
  isWorldExtractNode,
  isWorldTableNode,
  isNarrativeSplitNode,
  isNarrativeTableNode,
  isNarrativeGenNode,
  isNarrativeOutputNode,
  isNarrativeUnitOutputNode,
  isWorldOutputNode,
  isSelectImageNode,
  isSelectVideoNode,
  isSelectVoiceNode,
  isSelectTextNode,
  isSelectNarrativeNode,
  isSelectShotEntitiesNode,
  isPluralGraphPortDataType,
  isMultiAngleEditorNode,
  isLightingEditorNode,
  isPortraitTextureEditorNode,
  isEmotionEditorNode,
  isUpscaleEditorNode,
  isLipSyncNode,
  isExpandEditorNode,
  isRedrawEditorNode,
  isEraseEditorNode,
  isMatteEditorNode,
  isCropEditorNode,
  isGridSplitEditorNode,
  portLimitMaxForDataType,
  readImageGenerateParamsFromNode,
  readVideoGenerateParamsFromNode,
  resolveNodeTextContent,
  resolveNodeType,
  shouldShowPortLimitBadge as shouldShowPortLimitBadgeShared,
  videoGenerateParamsToNodePatch,
  type GraphNode,
  type GraphPortDataType,
  type GraphPortDef,
  type GraphNodeRunState,
  type GraphNodeRunStatus,
  type ImageGenerateParams,
  type InstructionPresetKind,
  type VideoGenerateParams,
  type VideoGeneratePortLimits
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphScope } from '../composables/useGraphScope'
import { isAudioFilePath, isVideoFilePath } from '@shared/import'
import { parseGraphHostContext } from '@shared/editorGlobals'
import {
  resolveAssetFileUrl,
  resolveAssetPreviewUrl
} from '../features/media/assetUrlCache'
import { graphPreviewLoadScheduler } from '../features/media/previewLoadScheduler'
import { graphPreviewVisibilityKey } from '../features/media/graphPreviewVisibility'
import { openFullImagePreview } from '../features/media/openFullImagePreview'
import { useProjectStore } from '../stores/project'
import {
  editorDiveKey,
  type EditorDiveViewMeta
} from '../features/graph/model/editorDive'
import { resolveGraphNodeDisplayTitle } from '../features/graph/model/graphNodeDisplayTitle'

const { t, te, assetTypeLabel, graphTypeLabel } = useStudioI18n()
const project = useProjectStore()
const graphScope = useGraphScope()
const previewVisibility = inject(graphPreviewVisibilityKey, null)
const editorDive = inject(editorDiveKey, null)
const hostAssetId = computed(() => parseGraphHostContext(props.hostId).id?.trim() || '')

const previewInViewport = computed(() => {
  if (!previewVisibility) return true
  // 触达 revision，保证视口变化时重算
  void previewVisibility.revision.value
  return previewVisibility.visibleNodeIds.value.has(props.node.id)
})

const previewPriority = computed(() => (props.selected ? 100 : 10))

let previewLoadCancel: (() => void) | null = null
let selectPreviewCancel: (() => void) | null = null
let directorPreviewCancel: (() => void) | null = null
let cardImageGridCancel: (() => void) | null = null

function cancelPreviewLoads(): void {
  previewLoadCancel?.()
  previewLoadCancel = null
  selectPreviewCancel?.()
  selectPreviewCancel = null
  directorPreviewCancel?.()
  directorPreviewCancel = null
  cardImageGridCancel?.()
  cardImageGridCancel = null
}

const props = defineProps<{
  node: GraphNode
  selected: boolean
  connecting?: boolean
  /** 画布处于拖线/连线中：全部节点显示端口，便于对准 */
  linkMode?: boolean
  asset?: AssetInfo | null
  runStatus?: GraphNodeRunStatus
  runError?: string
  runState?: GraphNodeRunState | null
  isGraphRunning?: boolean
  hostId?: string
}>()

const emit = defineEmits<{
  dragStart: [nodeId: string, event: PointerEvent]
  outPortDown: [nodeId: string, portId: string, event: PointerEvent]
  inPortDown: [nodeId: string, portId: string, event: PointerEvent]
  resizeStart: [nodeId: string, event: PointerEvent]
  titleChange: [nodeId: string, title: string]
  runToggle: [nodeId: string]
  selectImageOpen: [nodeId: string]
  selectVideoOpen: [nodeId: string]
  selectVoiceOpen: [nodeId: string]
  selectTextOpen: [nodeId: string]
  textsOpen: [nodeId: string]
  textOpen: [nodeId: string]
}>()

const audioEl = ref<HTMLAudioElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const progressInput = ref<HTMLInputElement | null>(null)
const previewUrl = ref('')
const mediaPlaying = ref(false)
const mediaError = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const seeking = ref(false)
const editingTitle = ref(false)
const titleDraft = ref('')
const titleInputEl = ref<HTMLInputElement | null>(null)
const instructionOpen = ref(false)
/** 首次展开大窗后再挂载，避免双击打开指令面板时顺带创建 Dialog */
const instructionDialogMounted = ref(false)
const instructionDialogOpen = ref(false)
const instruction = ref('')
const modelOptions = ref<GenerateModelOption[]>([])
const selectedModelKey = ref('')
const imageGenerateParams = ref<ImageGenerateParams>(
  readImageGenerateParamsFromNode(props.node.params)
)
const videoGenerateParams = ref<VideoGenerateParams>(
  readVideoGenerateParamsFromNode(props.node.params)
)
/** 当前图片模型参考图上限；非图片生成时为 null（角标用 *） */
const imageMaxInputReferences = ref<number | null>(null)
/** 视频生成节点端口限额（含时长） */
const videoPortLimits = ref<VideoGeneratePortLimits | null>(null)

const nodeSize = computed(() => getNodeSize(props.node))
const nodePorts = computed(() => getNodePorts(props.node))
const inPorts = computed(() => nodePorts.value.filter((p) => p.direction === 'in'))
const outPorts = computed(() => nodePorts.value.filter((p) => p.direction === 'out'))
const hasInPort = computed(() => inPorts.value.length > 0)

function portTypeLabel(dataType: GraphPortDataType): string {
  return t(`graph.port.types.${dataType}`)
}

/** Houdini 风格：复数端口（out-all / select 输入）用方形 */
function isBatchPort(port: GraphPortDef): boolean {
  return isPluralGraphPortDataType(port.dataType) || port.id === GRAPH_OUT_ALL_PORT_ID
}

function portDataTypeClass(port: GraphPortDef): string {
  switch (port.dataType) {
    case GraphPortType.world:
      return 'port-world'
    case GraphPortType.worldEntities:
      return 'port-world-entities'
    case GraphPortType.shotEntities:
      return 'port-shot-entities'
    case GraphPortType.videoEntities:
      return 'port-video-entities'
    case GraphPortType.narrative:
      return 'port-narrative'
    case GraphPortType.shots:
      return 'port-shots'
    default:
      return ''
  }
}

function outPortTypeLabel(port: GraphPortDef): string {
  if (port.id === GRAPH_OUT_ALL_PORT_ID) {
    return t('graph.port.outAllShort')
  }
  return portTypeLabel(port.dataType)
}

function outPortTitle(port: GraphPortDef): string {
  const type = portTypeLabel(port.dataType)
  if (port.id === GRAPH_OUT_ALL_PORT_ID) {
    return `${t('graph.port.outAllTitle')} · ${type}`
  }
  return `${t('graph.port.outTitle')} · ${type}`
}

function inPortTypeLabel(port: GraphPortDef): string {
  if (port.id === VIDEO_FIRST_FRAME_PORT_ID) return t('graph.port.firstFrame')
  if (port.id === VIDEO_LAST_FRAME_PORT_ID) return t('graph.port.lastFrame')
  if (
    port.id === 'in-image' &&
    (props.node.typeId === 'asset.video' || props.node.typeId === 'video.lipSync') &&
    (isProcessingAssetNode(props.node) || props.node.typeId === 'video.lipSync')
  ) {
    return t('graph.port.referenceImage')
  }
  return portTypeLabel(port.dataType)
}

function portWrapStyle(count: number, index: number): Record<string, string> {
  // 与 getNodePortCenter 同源：在包含标题栏的整张卡片内均匀排布
  const pct = nodePortYRatio(index, count, height.value) * 100
  return { top: `${pct}%` }
}
const width = computed(() => nodeSize.value.w)
const height = computed(() => nodeSize.value.h)

const isAssetRef = computed(() => isAssetRefNode(props.node))
/** 拖入的是导入素材（引用）还是右键创建的可编辑宿主资产 */
const isImportedRefAsset = computed(
  () => isAssetRef.value && isImportedMediaRefAsset(props.asset ?? null)
)
/** 绑定了 assetId 但工程中已找不到对应资产 */
const isMissingLinkedAsset = computed(
  () => isAssetRef.value && !!props.node.assetId?.trim() && !props.asset
)
const isProcessingNode = computed(() => isProcessingAssetNode(props.node))
const canLock = computed(() => supportsGenerateLock(props.node))
const isLocked = computed(() => isGenerateLocked(props.node))
const isScreenplayOutputNode = computed(
  () =>
    props.node.category === 'output' &&
    !isNarrativeOutputNode(props.node) &&
    !isNarrativeUnitOutputNode(props.node) &&
    (props.node.typeId === 'output.text' || props.node.params.outputKind === 'text')
)
const previewCollapsed = computed(() => props.node.params.previewCollapsed === true)

function togglePreviewCollapsed(): void {
  if (!props.hostId) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    previewCollapsed: !previewCollapsed.value
  })
}

function toggleLock(): void {
  if (!props.hostId || !canLock.value) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    locked: !isLocked.value
  })
}

/**
 * 支持节点下方生成指令面板：
 * - 生成节点：剧本 / 图片 / 视频 / 声音 / 全景
 * - 工具节点：图片反推提示词（对齐图片生成）/ 提示词优化（对齐剧本生成）
 */
const instructionKind = computed((): InstructionPresetKind | null => {
  switch (props.node.typeId) {
    case 'image.toPrompt':
      return 'toPrompt'
    case 'prompt.optimize':
      return 'optimize'
    case 'narrative.unitGen':
      return 'narrativeUnitGen'
    case 'script.shotSplit':
      return 'shotSplit'
    case 'world.extract':
      return 'worldExtract'
    case 'narrative.split':
      return 'narrativeSplit'
    case 'asset.screenplay':
      return isProcessingNode.value ? 'screenplay' : null
    case 'asset.image':
      return isProcessingNode.value ? 'image' : null
    case 'asset.video':
      return isProcessingNode.value ? 'video' : null
    case 'video.lipSync':
      return 'lipSync'
    case 'asset.voice':
      return isProcessingNode.value ? 'voice' : null
    default:
      return null
  }
})

const portLimitKind = computed((): 'image' | 'video' | null => {
  if (instructionKind.value === 'image') return 'image'
  if (instructionKind.value === 'video' || instructionKind.value === 'lipSync') return 'video'
  return null
})

/** 画面风格参考图占用图片输入口槽位 */
const styleImageSlotCount = computed(() => {
  if (portLimitKind.value !== 'image' && portLimitKind.value !== 'video') return 0
  return resolveGenerateStyleImages(
    {
      styleImagesUseGlobal: props.node.params.styleImagesUseGlobal,
      styleImages: props.node.params.styleImages
    },
    project.config?.styleImages
  ).length
})

function shouldShowPortLimitBadge(port: GraphPortDef): boolean {
  return portLimitKind.value != null && shouldShowPortLimitBadgeShared(port)
}

function portLimitMax(port: GraphPortDef): number | null | undefined {
  if (isVideoFramePortId(port.id)) return 1
  const raw = portLimitMaxForDataType(port.dataType, {
    kind: portLimitKind.value,
    imageMax: imageMaxInputReferences.value,
    videoLimits: videoPortLimits.value
  })
  if (port.dataType === GraphPortType.image) {
    return deductReservedImageSlots(raw, styleImageSlotCount.value)
  }
  return raw
}

function portLimitBadge(port: GraphPortDef): string {
  return formatPortLimitBadge(portLimitMax(port))
}

function inPortTitle(port: GraphPortDef): string {
  const parts = [t('graph.port.inTitle'), inPortTypeLabel(port)]
  if (shouldShowPortLimitBadge(port)) {
    const max = portLimitMax(port)
    if (typeof max === 'number') {
      const styleN = styleImageSlotCount.value
      if (styleN > 0 && port.dataType === GraphPortType.image) {
        parts.push(t('graph.port.limitMaxAfterStyle', { n: max, style: styleN }))
      } else {
        parts.push(t('graph.port.limitMax', { n: max }))
      }
    } else {
      parts.push(t('graph.port.limitUnknown'))
    }
  }
  if (
    portLimitKind.value === 'video' &&
    port.dataType === 'video' &&
    videoPortLimits.value?.durations.length
  ) {
    parts.push(
      t('graph.port.outputDuration', {
        range: formatDurationRange(videoPortLimits.value.durations)
      })
    )
  }
  return parts.join(' · ')
}

const instructionModality = computed((): GenerateModelModality => {
  if (instructionKind.value === 'image') {
    return 'image'
  }
  if (instructionKind.value === 'video' || instructionKind.value === 'lipSync') return 'video'
  if (instructionKind.value === 'voice') return 'audio'
  return 'text'
})

const instructionPlaceholder = computed(() => {
  if (instructionKind.value === 'toPrompt') {
    return t('graph.inspector.generate.toPromptInstructionPlaceholder')
  }
  if (instructionKind.value === 'image') {
    return t('graph.inspector.generate.imageInstructionPlaceholder')
  }
  if (instructionKind.value === 'lipSync') {
    return t('graph.inspector.generate.lipSyncInstructionPlaceholder')
  }
  if (instructionKind.value === 'video') {
    return t('graph.inspector.generate.videoInstructionPlaceholder')
  }
  if (instructionKind.value === 'voice') {
    return t('graph.inspector.generate.voiceInstructionPlaceholder')
  }
  if (instructionKind.value === 'shotSplit') {
    return t('graph.inspector.generate.shotSplitInstructionPlaceholder')
  }
  if (instructionKind.value === 'worldExtract') {
    return t('graph.inspector.generate.worldExtractInstructionPlaceholder')
  }
  if (instructionKind.value === 'narrativeSplit') {
    return t('graph.inspector.generate.narrativeSplitInstructionPlaceholder')
  }
  if (instructionKind.value === 'narrativeUnitGen') {
    return t('graph.inspector.generate.narrativeUnitGenInstructionPlaceholder')
  }
  return t('graph.inspector.generate.instructionPlaceholder')
})

const instructionModelTitle = computed(() => {
  if (instructionKind.value === 'image') {
    return t('graph.inspector.generate.imageModel')
  }
  if (instructionKind.value === 'video' || instructionKind.value === 'lipSync') {
    return t('graph.inspector.generate.videoModel')
  }
  if (instructionKind.value === 'voice') return t('graph.inspector.generate.voiceModel')
  return t('graph.inspector.generate.model')
})

/** 图片生成：模型旁展示生成参数（按模型能力动态） */
const showImageGenerateParams = computed(
  () => instructionKind.value === 'image'
)

/** 视频 / 对口型：模型旁展示生成参数（按时长/比例等能力动态） */
const showVideoGenerateParams = computed(
  () => instructionKind.value === 'video' || instructionKind.value === 'lipSync'
)

const typeLabel = computed(() => {
  if (isAssetRef.value) {
    const assetType = props.node.assetType ?? props.asset?.type
    return assetType ? assetTypeLabel(assetType) : t('asset.generic')
  }
  if (props.node.category === 'output') {
    if (isTimelineOutputNode(props.node)) return t('graph.titles.timelineOutput')
    if (isNarrativeOutputNode(props.node)) return t('graph.titles.narrativeOutput')
    if (isNarrativeUnitOutputNode(props.node)) return t('graph.titles.narrativeUnitOutput')
    if (isWorldOutputNode(props.node)) return t('graph.titles.worldOutput')
    if (isScreenplayOutputNode.value) return t('graph.titles.screenplayOutput')
    if (props.node.typeId && te(`graph.types.${props.node.typeId}`)) {
      return graphTypeLabel(props.node.typeId)
    }
    const scopeDef = getGraphScopeDefinition(graphScope.value)
    if (scopeDef.outputTitleI18nKey && props.node.params.outputKind === scopeDef.output.kind) {
      return t(scopeDef.outputTitleI18nKey)
    }
    return t(`graph.titles.assetOutput.${props.node.params.outputKind ?? 'video'}`)
  }
  // 内置 typeId（选择节点 / 工具节点 / 分镜流程等）优先走 graph.types.*
  if (props.node.typeId && te(`graph.types.${props.node.typeId}`)) {
    return graphTypeLabel(props.node.typeId)
  }
  if (props.node.typeId && (isProcessingNode.value || instructionKind.value)) {
    return graphTypeLabel(props.node.typeId)
  }
  const assetType = props.node.assetType ?? props.asset?.type
  return assetType ? assetTypeLabel(assetType) : t('asset.generic')
})

const rolePill = computed(() => {
  if (isMissingLinkedAsset.value) return t('graph.nodeRole.missing')
  if (isAssetRef.value) {
    return isImportedRefAsset.value ? t('graph.nodeRole.ref') : t('graph.nodeRole.host')
  }
  if (isProcessingNode.value) return t('graph.nodeRole.generate')
  if (props.node.category === 'output') return t('graph.nodeRole.output')
  return ''
})

/** 可双击 dive 进入内图的宿主资产节点（非导入引用） */
const canDiveIntoHost = computed(
  () => isAssetRef.value && !isImportedRefAsset.value && !isMissingLinkedAsset.value
)

/**
 * 可双击进入子图/子编辑器的工作流节点（分镜画面/视频、世界/叙事表等）。
 * 与宿主 📦 区分：用叠层图标表示内含子图。
 */
const canDiveIntoSubgraph = computed(() => {
  const n = props.node
  return (
    isScriptShotImageGenNode(n) ||
    isScriptShotVideoGenNode(n) ||
    isScriptShotTableNode(n) ||
    isTimelineOutputNode(n) ||
    isWorldTableNode(n) ||
    isWorldGenNode(n) ||
    isNarrativeTableNode(n) ||
    isNarrativeGenNode(n) ||
    isNarrativeOutputNode(n) ||
    isDirectorProcessingNode(n)
  )
})

/** 类型色块：用颜色区分角色，图标表示类型（锁定由标题栏锁按钮表示，不改图标） */
const typeBadgeClass = computed(() => {
  if (isMissingLinkedAsset.value) return 'role-missing'
  if (canDiveIntoHost.value) return 'role-host'
  if (canDiveIntoSubgraph.value) return 'role-subgraph'
  if (isAssetRef.value) return isImportedRefAsset.value ? 'role-ref' : 'role-host'
  if (isProcessingNode.value) return 'role-generate'
  if (props.node.category === 'output') return 'role-output'
  return 'role-default'
})

const typeBadgeIcon = computed(() => {
  if (isMissingLinkedAsset.value) return '!'
  // 宿主节点：package；分镜图/视频等：叠层表示内含子图
  if (canDiveIntoHost.value) return '📦'
  if (canDiveIntoSubgraph.value) return '⧉'
  return typeIcon.value
})

const typeBadgeTitle = computed(() => {
  if (canDiveIntoHost.value) {
    const role = t('graph.nodeRole.host')
    return `${role} · ${typeLabel.value} · ${t('graph.assetHost.hint')}`
  }
  if (canDiveIntoSubgraph.value) {
    const role = t('graph.nodeRole.subgraph')
    return `${role} · ${typeLabel.value} · ${t('graph.subgraphDive.hint')}`
  }
  const role = rolePill.value
  return role ? `${role} · ${typeLabel.value}` : typeLabel.value
})

const displayTitle = computed(() => {
  if (isMissingLinkedAsset.value) {
    const custom = props.node.title?.trim()
    return custom ? `${custom} ${t('asset.deleted')}` : t('asset.deleted')
  }
  if (isAssetRef.value) {
    const assetName = props.asset?.name?.trim()
    if (assetName) return assetName
  }
  // 英文 defaultTitle / 内置输出标题走 i18n，与任务日志 resolveGraphNodeDisplayTitle 一致
  return resolveGraphNodeDisplayTitle(props.node, {
    scope: graphScope.value,
    t,
    graphTypeLabel,
    fallbackId: t('graph.defaultNode')
  })
})

const typeIcon = computed(() => {
  if (isScriptShotSplitNode(props.node)) return '✂️'
  if (isScriptShotTableNode(props.node)) return '📊'
  if (isScriptShotImageGenNode(props.node)) return '🖼️'
  if (isScriptShotVideoGenNode(props.node)) return '🎬'
  if (isWorldExtractNode(props.node)) return '🗡️'
  if (isWorldTableNode(props.node) || isNarrativeTableNode(props.node)) return '📋'
  if (isNarrativeGenNode(props.node) || isNarrativeSplitNode(props.node)) return '📖'
  if (isWorldGenNode(props.node)) return '🤺'
  if (isWorldOutputNode(props.node)) return '🌍'
  if (isNarrativeOutputNode(props.node) || isNarrativeUnitOutputNode(props.node)) return '📖'
  if (isScreenplayOutputNode.value) return '📜'
  if (props.node.category === 'output' && props.node.params.outputKind === 'voice') return '🔊'
  if (props.asset) return assetDisplayIcon(props.asset)
  const assetType = props.node.assetType
  if (assetType) return ASSET_TYPE_ICONS[assetType]
  const defIcon = resolveNodeType(props.node)?.icon?.trim()
  return defIcon || '◆'
})

const runStatusLabel = computed(() => {
  switch (props.runStatus) {
    case 'pending':
      return t('graph.runStatus.pending')
    case 'running':
      return t('graph.runStatus.running')
    case 'done':
      return t('graph.runStatus.done')
    case 'error':
      return t('graph.runStatus.error')
    default:
      return ''
  }
})

const assetName = computed(() => props.asset?.name ?? '')

const isDirectorGenerateNode = computed(() => isDirectorProcessingNode(props.node))
const isDirectorOutputNode = computed(
  () =>
    props.node.category === 'output' &&
    props.node.params.outputKind === 'image' &&
    props.node.params.inputDataType === 'image'
)
const directorLivePreviewRaw = computed(() => {
  if (!isDirectorGenerateNode.value && !isDirectorOutputNode.value) {
    return { dataUrl: '', relativePath: '' }
  }
  return {
    dataUrl:
      props.node.params.previewDataUrl ||
      props.node.params.cameraShots?.[0]?.dataUrl ||
      '',
    relativePath:
      props.node.params.previewRelativePath ||
      props.node.params.cameraShots?.[0]?.relativePath ||
      ''
  }
})
const directorLivePreview = ref('')
watch(
  () =>
    [directorLivePreviewRaw.value, previewInViewport.value, previewPriority.value] as const,
  async ([raw, visible, priority]) => {
    directorPreviewCancel?.()
    directorPreviewCancel = null
    if (!visible) {
      directorLivePreview.value = ''
      return
    }
    if (raw.dataUrl?.trim()) {
      directorLivePreview.value = raw.dataUrl
      return
    }
    if (!raw.relativePath?.trim()) {
      directorLivePreview.value = ''
      return
    }
    const path = raw.relativePath.trim()
    const { promise, cancel } = graphPreviewLoadScheduler.enqueue(priority, () =>
      resolveAssetPreviewUrl(path)
    )
    directorPreviewCancel = cancel
    try {
      directorLivePreview.value = await promise
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      directorLivePreview.value = ''
    }
  },
  { immediate: true }
)

const selectImagePreview = ref('')
watch(
  () =>
    [
      props.node.params.previewDataUrl,
      props.node.params.previewRelativePath,
      props.node.params.generatedImages?.[props.node.params.generatedImages.length - 1]?.dataUrl,
      props.node.params.generatedImages?.[props.node.params.generatedImages.length - 1]
        ?.relativePath,
      props.node.typeId === 'world.gen'
        ? props.node.params.worldElementOutputs?.[
            (props.node.params.worldElementOutputs?.length ?? 1) - 1
          ]?.imageUrl
        : '',
      isSelectImageNode(props.node) ||
        isSelectShotEntitiesNode(props.node) ||
        isMultiAngleEditorNode(props.node) ||
        isLightingEditorNode(props.node) ||
        isPortraitTextureEditorNode(props.node) ||
        isEmotionEditorNode(props.node) ||
        isUpscaleEditorNode(props.node) ||
        isExpandEditorNode(props.node) ||
        isRedrawEditorNode(props.node) ||
        isEraseEditorNode(props.node) ||
        isMatteEditorNode(props.node) ||
        isCropEditorNode(props.node) ||
        isGridSplitEditorNode(props.node),
      previewInViewport.value,
      previewPriority.value
    ] as const,
  async ([
    dataUrl,
    relativePath,
    genDataUrl,
    genRel,
    worldImageUrl,
    showPreview,
    visible,
    priority
  ]) => {
    selectPreviewCancel?.()
    selectPreviewCancel = null
    if (!showPreview || !visible) {
      selectImagePreview.value = ''
      return
    }
    const worldUrl = worldImageUrl?.trim() || ''
    const resolvedData =
      dataUrl?.trim() ||
      genDataUrl?.trim() ||
      (worldUrl.startsWith('data:') ? worldUrl : '')
    if (resolvedData) {
      selectImagePreview.value = resolvedData
      return
    }
    const path =
      relativePath?.trim() ||
      genRel?.trim() ||
      (worldUrl && !worldUrl.startsWith('data:') ? worldUrl : '')
    if (!path) {
      selectImagePreview.value = ''
      return
    }
    const { promise, cancel } = graphPreviewLoadScheduler.enqueue(priority, () =>
      resolveAssetPreviewUrl(path)
    )
    selectPreviewCancel = cancel
    try {
      selectImagePreview.value = await promise
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      selectImagePreview.value = ''
    }
  },
  { immediate: true }
)

/** 多结果图片：节点卡网格（≥2）；单张仍走原单预览路径 */
type CardImageGridSource = { key: string; dataUrl?: string; relativePath?: string }
const cardImageGridSources = computed((): CardImageGridSource[] => {
  const worldOutputs = props.node.params.worldElementOutputs ?? []
  if (props.node.typeId === 'world.gen' && worldOutputs.length > 1) {
    return worldOutputs.map((item, index) => {
      const url = item.imageUrl?.trim() || ''
      return {
        key: `${item.type}:${item.name}:${index}`,
        dataUrl: url.startsWith('data:') ? url : undefined,
        relativePath: url && !url.startsWith('data:') ? url : undefined
      }
    })
  }
  const generated = props.node.params.generatedImages ?? []
  if (generated.length > 1) {
    return generated.map((item, index) => ({
      key: item.id?.trim() || `gen:${index}`,
      dataUrl: item.dataUrl?.trim() || undefined,
      relativePath: item.relativePath?.trim() || undefined
    }))
  }
  const shots = props.node.params.cameraShots ?? []
  if (
    shots.length > 1 &&
    (isDirectorGenerateNode.value || isDirectorOutputNode.value)
  ) {
    return shots.map((item, index) => ({
      key: item.id?.trim() || `shot:${index}`,
      dataUrl: item.dataUrl?.trim() || undefined,
      relativePath: item.relativePath?.trim() || undefined
    }))
  }
  return []
})

const cardImageGridSrcs = ref<string[]>([])
watch(
  () =>
    [cardImageGridSources.value, previewInViewport.value, previewPriority.value] as const,
  async ([sources, visible, priority]) => {
    cardImageGridCancel?.()
    cardImageGridCancel = null
    if (!visible || sources.length <= 1) {
      cardImageGridSrcs.value = []
      return
    }
    let cancelled = false
    cardImageGridCancel = () => {
      cancelled = true
    }
    const urls: string[] = []
    for (const item of sources) {
      if (cancelled) return
      if (item.dataUrl) {
        urls.push(item.dataUrl)
        continue
      }
      if (!item.relativePath) continue
      try {
        const { promise, cancel } = graphPreviewLoadScheduler.enqueue(priority, () =>
          resolveAssetPreviewUrl(item.relativePath!)
        )
        const prevCancel = cardImageGridCancel
        cardImageGridCancel = () => {
          cancelled = true
          cancel()
          prevCancel?.()
        }
        const url = await promise
        if (cancelled) return
        if (url) urls.push(url)
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return
      }
    }
    if (!cancelled) cardImageGridSrcs.value = urls
  },
  { immediate: true }
)

/** 多结果文本：节点卡小网格（≥2） */
const cardTextGridItems = computed((): string[] => {
  if (hideCardPreview.value) return []
  const items = props.node.params.generatedTexts ?? []
  if (items.length <= 1) return []
  return items
    .map((item) => (item.text?.trim() || item.title?.trim() || '').slice(0, 80))
    .filter(Boolean)
})

/** 分镜 / 世界元素流程节点：不展示正文预览，仅显示图标+提示以便双击 */
const hideCardPreview = computed(
  () =>
    isScriptShotSplitNode(props.node) ||
    isScriptShotTableNode(props.node) ||
    isScriptShotImageGenNode(props.node) ||
    isScriptShotVideoGenNode(props.node) ||
    isWorldExtractNode(props.node) ||
    isWorldTableNode(props.node) ||
    isWorldGenNode(props.node) ||
    isNarrativeSplitNode(props.node) ||
    isNarrativeTableNode(props.node) ||
    isNarrativeGenNode(props.node)
)

const scriptNodePreviewTitle = computed(() => {
  if (
    isScriptShotSplitNode(props.node) ||
    isWorldExtractNode(props.node) ||
    isNarrativeSplitNode(props.node)
  ) {
    return t('graph.generateNode.instructionHint')
  }
  if (isScriptShotTableNode(props.node)) return t('graph.scriptShotTableNode.hint')
  if (isScriptShotImageGenNode(props.node)) return t('graph.scriptShotImageGenNode.hint')
  if (isScriptShotVideoGenNode(props.node)) {
    return t('graph.scriptShotVideoGenNode.hint')
  }
  if (isWorldTableNode(props.node)) return t('graph.worldTableNode.hint')
  if (isWorldGenNode(props.node)) return t('graph.worldGenNode.hint')
  if (isNarrativeTableNode(props.node)) return t('graph.narrativeTableNode.hint')
  if (isNarrativeGenNode(props.node)) return t('graph.narrativeGenNode.hint')
  return ''
})

/** 节点上展示的文本输出（执行结果或已保存正文）；有内容才覆盖媒体预览 */
const textPreview = computed(() => {
  // 剧本 / 分镜引用：不展示正文预览（图标 + 引用提示）
  if (
    isAssetRef.value &&
    (props.node.assetType === 'screenplay' || props.node.assetType === 'script')
  ) {
    return ''
  }
  if (hideCardPreview.value) return ''
  if (!isNodeTextCapable(props.node)) return ''
  const content = resolveNodeTextContent(props.node, props.runState)
  return content?.text.trim() ?? ''
})

const previewHint = computed(() => {
  if (isDirectorGenerateNode.value) {
    return directorLivePreview.value
      ? t('graph.directorNode.live')
      : t('graph.directorNode.hint')
  }
  if (isTimelineOutputNode(props.node)) {
    return t('graph.timelineOutputNode.hint')
  }
  if (isScriptShotTableNode(props.node)) return t('graph.scriptShotTableNode.hint')
  if (isScriptShotImageGenNode(props.node)) return t('graph.scriptShotImageGenNode.hint')
  if (isScriptShotVideoGenNode(props.node)) {
    return t('graph.scriptShotVideoGenNode.hint')
  }
  if (isWorldTableNode(props.node)) return t('graph.worldTableNode.hint')
  if (isWorldGenNode(props.node)) return t('graph.worldGenNode.hint')
  if (isNarrativeTableNode(props.node)) return t('graph.narrativeTableNode.hint')
  if (isNarrativeGenNode(props.node)) return t('graph.narrativeGenNode.hint')
  if (isSelectImageNode(props.node)) return t('graph.selectImage.hint')
  if (isSelectVideoNode(props.node)) return t('graph.selectVideo.hint')
  if (isSelectVoiceNode(props.node)) return t('graph.selectVoice.hint')
  if (isSelectTextNode(props.node)) return t('graph.selectText.hint')
  if (isSelectNarrativeNode(props.node)) return t('graph.selectNarrative.hint')
  if (isSelectShotEntitiesNode(props.node)) return t('graph.selectShotEntities.hint')
  if (isMultiAngleEditorNode(props.node)) return t('graph.multiAngle.hint')
  if (isLightingEditorNode(props.node)) return t('graph.lighting.hint')
  if (isPortraitTextureEditorNode(props.node)) return t('graph.portraitTexture.hint')
  if (isEmotionEditorNode(props.node)) return t('graph.emotion.hint')
  if (isUpscaleEditorNode(props.node)) return t('graph.upscale.hint')
  if (isLipSyncNode(props.node)) return t('graph.lipSync.hint')
  if (isExpandEditorNode(props.node)) return t('graph.expand.hint')
  if (isRedrawEditorNode(props.node)) return t('graph.redraw.hint')
  if (isEraseEditorNode(props.node)) return t('graph.erase.hint')
  if (isMatteEditorNode(props.node)) return t('graph.matte.hint')
  if (isCropEditorNode(props.node)) return t('graph.crop.hint')
  if (isGridSplitEditorNode(props.node)) return t('graph.gridSplit.hint')
  if (instructionKind.value) return t('graph.generateNode.instructionHint')
  if (isMissingLinkedAsset.value) return t('graph.assetMissing.hint')
  if (isAssetRef.value) {
    return isImportedRefAsset.value ? t('graph.assetRef.hint') : t('graph.assetHost.hint')
  }
  if (isProcessingNode.value) return t('graph.generateNode.hint')
  return assetName.value || typeLabel.value
})

const previewOpenHint = computed(() => {
  if (instructionKind.value === 'screenplay') return t('graph.generateNode.instructionHint')
  if (isScreenplayOutputNode.value) return t('graph.textsPreview.hint')
  if (isSelectTextNode(props.node)) return t('graph.selectText.hint')
  if (isSelectNarrativeNode(props.node)) return t('graph.selectNarrative.hint')
  if (isSelectShotEntitiesNode(props.node)) return t('graph.selectShotEntities.hint')
  // 预览区已有正文时，双击优先打开记事本
  if (
    textPreview.value &&
    !isAssetRef.value &&
    !isSelectShotEntitiesNode(props.node) &&
    isNodeTextCapable(props.node)
  ) {
    return t('graph.notepad.openHint')
  }
  if (instructionKind.value) return t('graph.generateNode.instructionHint')
  return t('graph.notepad.openHint')
})

const previewKind = computed((): 'image' | 'video' | 'voice' | 'none' => {
  // 文本/剧本输出：预览走记事本，不走媒体预览
  if (isScreenplayOutputNode.value) return 'none'
  // 输出节点以 outputKind 为准（宿主资产可能是 script，不能用来决定预览类型）
  if (props.node.category === 'output') {
    const kind = props.node.params.outputKind
    if (kind === 'image') return 'image'
    if (kind === 'video') return 'video'
    if (kind === 'voice') return 'voice'
    if (kind === 'text') return 'none'
  }
  if (isSelectVideoNode(props.node)) return 'video'
  if (isSelectVoiceNode(props.node)) return 'voice'
  const t = props.node.assetType ?? props.asset?.type
  if (!t) return 'none'
  if (t === 'image') return 'image'
  if (t === 'video') return 'video'
  if (isSoundAsset(t)) return 'voice'
  return 'none'
})

const showMediaTransport = computed(
  () => previewKind.value === 'video' || previewKind.value === 'voice'
)

const mediaMuted = computed(() => props.node.params.muted === true)
const mediaLoop = computed(() => props.node.params.loop === true)
const mediaVolume = computed(() => props.node.params.volume ?? 1)
const mediaRate = computed(() => props.node.params.playbackRate ?? 1)

const progressValue = computed(() => {
  if (!duration.value) return 0
  return Math.round((currentTime.value / duration.value) * 1000)
})

const mediaErrorText = computed(() =>
  previewKind.value === 'voice' ? t('graph.preview.audioError') : t('graph.preview.videoError')
)

function activeMediaEl(): HTMLMediaElement | null {
  if (previewKind.value === 'video') return videoEl.value
  if (previewKind.value === 'voice') return audioEl.value
  return null
}

function applyMediaParams(): void {
  const el = activeMediaEl()
  if (!el) return
  el.muted = mediaMuted.value
  el.loop = mediaLoop.value
  el.volume = Math.min(1, Math.max(0, mediaVolume.value))
  try {
    el.playbackRate = mediaRate.value
  } catch {
    // ignore unsupported rate
  }
}

function syncMediaClock(el?: HTMLMediaElement | null): void {
  const media = el ?? activeMediaEl()
  if (!media) return
  if (!seeking.value) currentTime.value = media.currentTime || 0
  if (Number.isFinite(media.duration) && media.duration > 0) {
    duration.value = media.duration
  }
  // Chromium 对受控 range 有时不刷新滑块，直接写 DOM value
  if (progressInput.value && duration.value > 0 && !seeking.value) {
    progressInput.value.value = String(
      Math.round((currentTime.value / duration.value) * 1000)
    )
  }
}

let progressRaf = 0

function stopProgressTicker(): void {
  if (progressRaf) {
    cancelAnimationFrame(progressRaf)
    progressRaf = 0
  }
}

function startProgressTicker(): void {
  stopProgressTicker()
  const tick = (): void => {
    syncMediaClock()
    if (mediaPlaying.value) progressRaf = requestAnimationFrame(tick)
    else progressRaf = 0
  }
  progressRaf = requestAnimationFrame(tick)
}

const loadedMediaKey = ref('')

watch(
  () => {
    const kind = previewKind.value
    const ownRel = props.asset?.relativePath?.trim() || ''
    const previewRel = props.node.params.previewRelativePath?.trim() || ''
    const selectedId = props.node.params.selectedImageId?.trim()
    const gallery = props.node.params.generatedImages ?? []
    const galleryPick =
      (selectedId ? gallery.find((item) => item.id?.trim() === selectedId) : undefined) ||
      gallery[gallery.length - 1]
    const galleryRel = galleryPick?.relativePath?.trim() || ''
    // 音视频只接受可播放扩展名，避免把首帧 PNG / 缩略图塞进 <video>
    let path = ownRel || previewRel || galleryRel
    if (kind === 'video') {
      path = [ownRel, previewRel, galleryRel].find((p) => p && isVideoFilePath(p)) || ''
    } else if (kind === 'voice') {
      path = [ownRel, previewRel, galleryRel].find((p) => p && isAudioFilePath(p)) || ''
    }
    const mode = kind === 'video' || kind === 'voice' ? 'full' : 'preview'
    // 图片始终用原图路径走 preview API（内部 ensure thumb）；音视频用原文件
    return {
      mediaKey: `${props.asset?.id ?? props.node.id}::${kind}::${mode}::${path}`,
      path,
      mode,
      visible: previewInViewport.value && kind !== 'none',
      priority: previewPriority.value
    }
  },
  async ({ mediaKey, path, mode, visible, priority }) => {
    previewLoadCancel?.()
    previewLoadCancel = null

    if (!visible) {
      stopProgressTicker()
      mediaError.value = false
      mediaPlaying.value = false
      currentTime.value = 0
      duration.value = 0
      previewUrl.value = ''
      loadedMediaKey.value = ''
      return
    }

    // 同一媒体不要重载，否则滚轮缩放触发的资产保存会打断播放
    if (mediaKey && mediaKey === loadedMediaKey.value && previewUrl.value) return

    stopProgressTicker()
    mediaError.value = false
    mediaPlaying.value = false
    currentTime.value = 0
    duration.value = 0
    if (!path) {
      previewUrl.value = ''
      loadedMediaKey.value = ''
      return
    }
    const { promise, cancel } = graphPreviewLoadScheduler.enqueue(priority, () =>
      mode === 'preview' ? resolveAssetPreviewUrl(path) : resolveAssetFileUrl(path)
    )
    previewLoadCancel = cancel
    try {
      const url = await promise
      if (url === previewUrl.value && loadedMediaKey.value === mediaKey) return
      previewUrl.value = url
      loadedMediaKey.value = mediaKey
      await nextTick()
      const el = activeMediaEl()
      el?.load()
      applyMediaParams()
      syncMediaClock(el)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      previewUrl.value = ''
      loadedMediaKey.value = ''
    }
  },
  { immediate: true }
)

watch(
  () =>
    [
      props.node.params.muted,
      props.node.params.loop,
      props.node.params.volume,
      props.node.params.playbackRate
    ] as const,
  () => applyMediaParams()
)

function onPointerDown(e: PointerEvent): void {
  if (editingTitle.value) return
  emit('dragStart', props.node.id, e)
}

function editableTitleDraft(): string {
  if (isAssetRef.value) {
    return props.asset?.name?.trim() || props.node.title?.trim() || displayTitle.value
  }
  return props.node.title?.trim() || displayTitle.value
}

function startTitleEdit(): void {
  if (isMissingLinkedAsset.value) return
  titleDraft.value = editableTitleDraft()
  editingTitle.value = true
  void nextTick(() => {
    titleInputEl.value?.focus()
    titleInputEl.value?.select()
  })
}

function commitTitleEdit(): void {
  if (!editingTitle.value) return
  editingTitle.value = false
  const next = titleDraft.value.trim()
  const prev = isAssetRef.value
    ? props.asset?.name?.trim() || props.node.title?.trim() || ''
    : (props.node.title?.trim() ?? '')
  if (next === prev) return
  if (isAssetRef.value && !next) return
  emit('titleChange', props.node.id, next)
}

function cancelTitleEdit(): void {
  editingTitle.value = false
  titleDraft.value = editableTitleDraft()
}

watch(
  () => props.selected,
  (on) => {
    if (!on) {
      editingTitle.value = false
      instructionOpen.value = false
      instructionDialogOpen.value = false
    }
  }
)

watch(
  () => props.node.params.generateInstruction,
  (value) => {
    const next = value ?? ''
    if (next !== instruction.value) instruction.value = next
  },
  { immediate: true }
)

watch(instructionOpen, (open) => {
  if (open) {
    instruction.value = props.node.params.generateInstruction ?? ''
    window.setTimeout(() => {
      void refreshModelOptions()
    }, 0)
  } else {
    instructionDialogOpen.value = false
  }
})

watch(instructionDialogOpen, (open) => {
  if (open) instructionDialogMounted.value = true
})

function openInstructionDialog(): void {
  instructionDialogMounted.value = true
  instructionDialogOpen.value = true
}

watch(
  () =>
    [
      props.node.params.generateProviderInstanceId,
      props.node.params.generateModel
    ] as const,
  ([providerInstanceId, model]) => {
    const key = preferredModelKey(providerInstanceId, model)
    if (key && key !== selectedModelKey.value && modelOptions.value.some((o) => o.key === key)) {
      selectedModelKey.value = key
    }
  }
)

watch(
  () =>
    [
      props.node.params.generateAspectRatio,
      props.node.params.generateResolution,
      props.node.params.generateQuality,
      props.node.params.generateCount
    ] as const,
  () => {
    imageGenerateParams.value = readImageGenerateParamsFromNode(props.node.params)
  }
)

watch(
  () =>
    [
      props.node.params.generateAspectRatio,
      props.node.params.generateResolution,
      props.node.params.generateDuration,
      props.node.params.generateAudio
    ] as const,
  () => {
    if (!showVideoGenerateParams.value) return
    videoGenerateParams.value = readVideoGenerateParamsFromNode(props.node.params)
  }
)

watch(
  [selectedModelKey, showImageGenerateParams],
  async ([key, show]) => {
    if (!show || !key.trim()) {
      imageMaxInputReferences.value = null
      return
    }
    try {
      const caps = await loadImageGenerateCapabilities(key)
      imageMaxInputReferences.value =
        typeof caps.maxInputReferences === 'number' ? caps.maxInputReferences : null
    } catch {
      imageMaxInputReferences.value = null
    }
  },
  { immediate: true }
)

watch(
  [selectedModelKey, portLimitKind],
  async ([key, kind]) => {
    if (kind !== 'video' || !key.trim()) {
      videoPortLimits.value = null
      return
    }
    try {
      videoPortLimits.value = await loadVideoGeneratePortLimits(key)
    } catch {
      videoPortLimits.value = null
    }
  },
  { immediate: true }
)

async function refreshModelOptions(): Promise<void> {
  if (!instructionKind.value) return
  const preferred = preferredModelKey(
    props.node.params.generateProviderInstanceId,
    props.node.params.generateModel
  )
  const { options, selectedKey } = await loadGenerateModelOptions(
    instructionModality.value,
    preferred,
    selectedModelKey.value
  )
  modelOptions.value = options
  selectedModelKey.value = selectedKey
}

function persistInstruction(): void {
  if (!props.hostId || !instructionKind.value) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    generateInstruction: instruction.value
  })
}

function persistGenerateModel(): void {
  if (!props.hostId || !instructionKind.value) return
  const parsed = parseModelKey(selectedModelKey.value)
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    generateModel: parsed?.model ?? '',
    generateProviderInstanceId: parsed?.providerInstanceId ?? ''
  })
}

function persistImageGenerateParams(): void {
  if (!props.hostId || !showImageGenerateParams.value) return
  graphEditorHosts.updateNode(
    props.hostId,
    props.node.id,
    imageGenerateParamsToNodePatch(imageGenerateParams.value)
  )
}

function persistVideoGenerateParams(): void {
  if (!props.hostId || !showVideoGenerateParams.value) return
  const nextMode = videoGenerateParams.value.frameMode ?? 'none'
  graphEditorHosts.updateNode(
    props.hostId,
    props.node.id,
    videoGenerateParamsToNodePatch(videoGenerateParams.value)
  )
  for (const edge of graphEditorHosts.listIncomingEdges(props.hostId, props.node.id)) {
    const port = edge.targetPort
    if (!isVideoFramePortId(port)) continue
    if (nextMode === 'none') {
      graphEditorHosts.removeEdge(props.hostId, edge.edgeId)
      continue
    }
    if (nextMode === 'first' && port === VIDEO_LAST_FRAME_PORT_ID) {
      graphEditorHosts.removeEdge(props.hostId, edge.edgeId)
    }
  }
  graphEditorHosts.bumpRevision()
}

function onOutPortDown(portId: string, e: PointerEvent): void {
  if (isMissingLinkedAsset.value) return
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  emit('outPortDown', props.node.id, portId, e)
}

function onInPortDown(portId: string, e: PointerEvent): void {
  if (isMissingLinkedAsset.value) return
  emit('inPortDown', props.node.id, portId, e)
}

async function diveView(meta: EditorDiveViewMeta, title?: string): Promise<boolean> {
  if (!editorDive?.rootKey) return false
  if (props.hostId) {
    try {
      await graphEditorHosts.flush(props.hostId)
    } catch (err) {
      console.error('[GraphNodeCard] flush before dive failed', err)
    }
  }
  await editorDive.diveView(meta, title)
  return true
}

async function diveNodeTool(
  viewId: Extract<EditorDiveViewMeta, { hostId: string }>['viewId'],
  title?: string,
  mode?: string
): Promise<boolean> {
  const hostId = props.hostId?.trim()
  if (!hostId) return false
  return diveView(
    { viewId, hostId, nodeId: props.node.id, ...(mode ? { mode } : {}) },
    title
  )
}

function onPreviewDblClick(): void {
  if (isMissingLinkedAsset.value) return
  void (async () => {
    const title = displayTitle.value

    if (isDirectorProcessingNode(props.node)) {
      const directorAssetId = hostAssetId.value
      if (!directorAssetId) return
      await diveView(
        {
          viewId: 'director.stage',
          directorAssetId,
          processingNodeId: props.node.id
        },
        title
      )
      return
    }

    if (isSelectImageNode(props.node) || isSelectShotEntitiesNode(props.node)) {
      emit('selectImageOpen', props.node.id)
      return
    }
    if (isSelectVideoNode(props.node)) {
      emit('selectVideoOpen', props.node.id)
      return
    }
    if (isSelectVoiceNode(props.node)) {
      emit('selectVoiceOpen', props.node.id)
      return
    }
    if (isSelectTextNode(props.node) || isSelectNarrativeNode(props.node)) {
      emit('selectTextOpen', props.node.id)
      return
    }
    if (isScreenplayOutputNode.value) {
      emit('textsOpen', props.node.id)
      return
    }
    if (isMultiAngleEditorNode(props.node)) {
      await diveNodeTool('node.multiAngle', title)
      return
    }
    if (isLightingEditorNode(props.node)) {
      await diveNodeTool('node.lighting', title)
      return
    }
    if (isPortraitTextureEditorNode(props.node)) {
      await diveNodeTool('node.portraitTexture', title)
      return
    }
    if (isEmotionEditorNode(props.node)) {
      await diveNodeTool('node.emotion', title)
      return
    }
    if (isUpscaleEditorNode(props.node)) {
      await diveNodeTool('node.upscale', title)
      return
    }
    if (isExpandEditorNode(props.node)) {
      await diveNodeTool('node.expand', title)
      return
    }
    if (isRedrawEditorNode(props.node)) {
      await diveNodeTool('node.redraw', title)
      return
    }
    if (isEraseEditorNode(props.node)) {
      await diveNodeTool('node.erase', title)
      return
    }
    if (isMatteEditorNode(props.node)) {
      await diveNodeTool('node.matte', title)
      return
    }
    if (isCropEditorNode(props.node)) {
      await diveNodeTool('node.crop', title)
      return
    }
    if (isGridSplitEditorNode(props.node)) {
      await diveNodeTool('node.gridSplit', title)
      return
    }
    // 分镜参数：双击无效，参数在右侧 Inspector 编辑
    if (isScriptShotParamsNode(props.node)) return

    const scriptAssetId = hostAssetId.value
    if (isScriptShotTableNode(props.node) && scriptAssetId) {
      await diveView({ viewId: 'script.shotTable', scriptAssetId }, title)
      return
    }
    if (isScriptShotImageGenNode(props.node) && scriptAssetId) {
      await diveView({ viewId: 'script.shotImage', scriptAssetId }, title)
      return
    }
    if (isScriptShotVideoGenNode(props.node) && scriptAssetId) {
      await diveView({ viewId: 'script.shotVideo', scriptAssetId }, title)
      return
    }
    if (isTimelineOutputNode(props.node) && scriptAssetId) {
      await diveView({ viewId: 'script.timeline', scriptAssetId }, title)
      return
    }

    const worldAssetId = hostAssetId.value
    if (isWorldTableNode(props.node) && worldAssetId) {
      await diveView({ viewId: 'world.table', worldAssetId }, title)
      return
    }
    if (isWorldGenNode(props.node) && worldAssetId) {
      await diveView({ viewId: 'world.editor', worldAssetId }, title)
      return
    }

    const narrativeAssetId = hostAssetId.value
    if (isNarrativeTableNode(props.node) && narrativeAssetId) {
      await diveView({ viewId: 'narrative.table', narrativeAssetId }, title)
      return
    }
    if ((isNarrativeGenNode(props.node) || isNarrativeOutputNode(props.node)) && narrativeAssetId) {
      await diveView({ viewId: 'narrative.gen', narrativeAssetId }, title)
      return
    }

    // 生成剧本：双击展开生成指令面板（勿被正文预览抢成记事本）
    if (instructionKind.value === 'screenplay') {
      instructionOpen.value = !instructionOpen.value
      return
    }
    // 叙事生成：双击只开关指令面板，不打开正文预览/记事本
    if (instructionKind.value === 'narrativeUnitGen') {
      instructionOpen.value = !instructionOpen.value
      return
    }
    // 预览区已有正文：双击打开记事本弹窗，避免误开空的生成指令
    if (
      textPreview.value &&
      !isAssetRef.value &&
      !isScreenplayOutputNode.value &&
      isNodeTextCapable(props.node)
    ) {
      emit('textOpen', props.node.id)
      return
    }
    // 加工 / 工具节点：双击展开 / 收起生成指令
    if (instructionKind.value) {
      instructionOpen.value = !instructionOpen.value
      return
    }
    // 有文本输出 / 剧本文档的节点：双击打开记事本弹窗（引用节点除外）
    if (!isAssetRef.value && isNodeTextCapable(props.node)) {
      emit('textOpen', props.node.id)
      return
    }

    // 宿主资产节点：同面板 dive
    if (isAssetRef.value && !isImportedRefAsset.value) {
      const assetId = props.node.assetId?.trim() || props.asset?.id
      if (assetId && editorDive?.rootKey) {
        if (props.hostId) {
          try {
            await graphEditorHosts.flush(props.hostId)
          } catch (err) {
            console.error('[GraphNodeCard] flush before dive failed', err)
          }
        }
        await editorDive.diveAsset(assetId)
      }
      return
    }

    // 引用型图片 / 音视频：双击预览
    if (
      isAssetRef.value &&
      props.asset?.relativePath &&
      (previewKind.value === 'image' ||
        previewKind.value === 'video' ||
        previewKind.value === 'voice')
    ) {
      await openFullImagePreview({
        relativePath: props.asset.relativePath,
        title: props.asset.name
      })
    }
  })()
}

function onResizeStart(e: PointerEvent): void {
  emit('resizeStart', props.node.id, e)
}

let playRequestId = 0

async function togglePlayback(): Promise<void> {
  const el = activeMediaEl()
  if (!el) return
  applyMediaParams()

  // 串行化 play/pause，避免连点时 play() 被后续 pause() 打断（AbortError）
  const requestId = ++playRequestId
  if (!el.paused) {
    el.pause()
    mediaPlaying.value = false
    stopProgressTicker()
    syncMediaClock(el)
    return
  }

  mediaPlaying.value = true
  startProgressTicker()
  try {
    await el.play()
    if (requestId !== playRequestId) return
    mediaPlaying.value = !el.paused
    if (mediaPlaying.value) startProgressTicker()
    else stopProgressTicker()
    syncMediaClock(el)
  } catch (error) {
    if (requestId !== playRequestId) return
    // AbortError 通常是下一次 pause/重载打断当前 play，属于正常竞态
    if (error instanceof DOMException && error.name === 'AbortError') {
      mediaPlaying.value = !el.paused
      if (mediaPlaying.value) startProgressTicker()
      else stopProgressTicker()
      return
    }
    mediaError.value = true
    mediaPlaying.value = false
    stopProgressTicker()
    console.error('[GraphNodeCard] playback failed', error)
  }
}

function seekToStart(): void {
  const el = activeMediaEl()
  if (!el) return
  el.currentTime = 0
  currentTime.value = 0
}

function onSeekInput(e: Event): void {
  seeking.value = true
  const el = activeMediaEl()
  if (!el || !duration.value) return
  const value = Number((e.target as HTMLInputElement).value)
  currentTime.value = (value / 1000) * duration.value
}

function onSeekChange(e: Event): void {
  const el = activeMediaEl()
  if (!el || !duration.value) {
    seeking.value = false
    return
  }
  const value = Number((e.target as HTMLInputElement).value)
  el.currentTime = (value / 1000) * duration.value
  currentTime.value = el.currentTime
  seeking.value = false
}

function onMediaPlay(): void {
  mediaPlaying.value = true
  startProgressTicker()
}

function onMediaPause(): void {
  mediaPlaying.value = false
  stopProgressTicker()
  syncMediaClock()
}

function onMediaEnded(): void {
  mediaPlaying.value = false
  stopProgressTicker()
  syncMediaClock()
  if (!mediaLoop.value && duration.value) currentTime.value = duration.value
}

function onMediaTimeUpdate(e: Event): void {
  syncMediaClock(e.currentTarget as HTMLMediaElement)
}

function onMediaLoaded(e: Event): void {
  const el = e.currentTarget as HTMLMediaElement
  applyMediaParams()
  syncMediaClock(el)
}

onBeforeUnmount(() => {
  cancelPreviewLoads()
  stopProgressTicker()
})

function onVideoMouseEnter(e: MouseEvent): void {
  // 有播放控件时改为手动控制，避免悬停自动播放抢占进度条
  if (showMediaTransport.value) return
  void (e.currentTarget as HTMLVideoElement).play()
}

function onVideoMouseLeave(e: MouseEvent): void {
  if (showMediaTransport.value) return
  ;(e.currentTarget as HTMLVideoElement).pause()
}

function onVideoError(): void {
  if (!previewUrl.value) return
  mediaError.value = true
  mediaPlaying.value = false
  stopProgressTicker()
}

function onAudioError(): void {
  if (!previewUrl.value) return
  mediaError.value = true
  mediaPlaying.value = false
  stopProgressTicker()
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const total = Math.floor(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
</script>

<style scoped>
.graph-node {
  position: absolute;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--graph-node-bg);
  box-shadow: 0 4px 16px var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
  z-index: 2;
}

.graph-node.output {
  background: linear-gradient(
    160deg,
    var(--graph-node-output-from) 0%,
    var(--graph-node-bg) 55%
  );
  border-color: #3d6ea8;
  z-index: 12;
}

.graph-node.asset-ref {
  border-style: dashed;
  border-color: #6b7280;
  background: var(--graph-node-asset-bg);
}

.graph-node.asset-missing {
  opacity: 0.55;
  border-style: dashed;
  border-color: var(--danger, #c45c5c);
  background: var(--graph-node-bg);
  filter: grayscale(0.35);
}

.graph-node.asset-missing .title {
  cursor: default;
  color: var(--text-muted);
}

.graph-node.processing-node {
  border-color: #3d9a6e;
  background: linear-gradient(
    160deg,
    var(--graph-node-processing-from) 0%,
    var(--graph-node-bg) 55%
  );
}

.graph-node.lock-node {
  border-color: #8a7a4a;
  opacity: 0.82;
  background: linear-gradient(
    160deg,
    color-mix(in srgb, #c4a35a 18%, var(--graph-node-bg)) 0%,
    var(--graph-node-bg) 55%
  );
}

.graph-node.connecting {
  border-color: var(--warning);
}

.graph-node.selected,
.graph-node.connecting,
.graph-node.instruction-open {
  z-index: 20;
}

.instruction-panel {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: max(100%, 320px);
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: 1px solid #3d9a6e;
  border-radius: 10px;
  background: var(--graph-instruction-bg);
  box-shadow: 0 8px 24px var(--shadow);
  box-sizing: border-box;
  cursor: default;
  user-select: text;
}

.instruction-panel-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #7dcea0;
}


.graph-node.run-error {
  border-color: #c45c5c;
}

.graph-node.run-running {
  border-color: var(--accent);
}

/* 真实拖动时由画布 .dragging-nodes 统一切换为 grabbing，避免单击/双击变成移动光标 */

.graph-node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent), 0 6px 20px var(--accent-22);
}

.node-title {
  position: absolute;
  left: 50%;
  bottom: calc(100% + 6px);
  transform: translateX(-50%);
  z-index: 45;
  display: flex;
  align-items: center;
  width: max-content;
  max-width: none;
}

.node-head {
  position: relative;
  /* 高于 port-wrap(30)，避免右侧输出口标签盖住执行/锁定按钮 */
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border);
  min-width: 0;
  border-radius: 10px 10px 0 0;
  overflow: hidden;
}

.graph-node.preview-collapsed .node-head {
  border-bottom: none;
  border-radius: 10px;
  height: 100%;
  box-sizing: border-box;
}

/* 折叠三角：与锁定按钮同尺寸 */
.collapse-tri-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  padding: 0;
  margin: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  color: color-mix(in srgb, var(--text-muted) 90%, transparent);
  line-height: 0;
}

.collapse-tri-btn:hover {
  background: var(--wash-06);
  color: var(--text);
}

/* 实心三角：展开朝下，收起朝右 */
.collapse-tri {
  display: block;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 7px solid currentColor;
}

.collapse-tri-btn.collapsed .collapse-tri {
  border-top: 6px solid transparent;
  border-bottom: 6px solid transparent;
  border-left: 7px solid currentColor;
  border-right: none;
}

/* 状态/类型图标：节点左下角 */
.type-badge {
  position: absolute;
  left: 6px;
  bottom: 6px;
  z-index: 35;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  font-size: 11px;
  line-height: 1;
  border: 1px solid transparent;
  background: color-mix(in srgb, var(--graph-node-bg, var(--bg-elevated)) 82%, transparent);
  color: var(--accent);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--border) 70%, transparent),
    0 1px 4px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  user-select: none;
}

.type-badge.role-generate {
  background: color-mix(in srgb, var(--accent) 28%, var(--graph-node-bg));
  border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  color: var(--accent-fg, var(--accent));
}

.type-badge.role-host {
  background: color-mix(in srgb, #5b9fd4 30%, var(--graph-node-bg));
  border-color: color-mix(in srgb, #5b9fd4 45%, transparent);
}

.type-badge.role-subgraph {
  background: color-mix(in srgb, #7b8cff 28%, var(--graph-node-bg));
  border-color: color-mix(in srgb, #7b8cff 45%, transparent);
  color: #c5ccff;
}

.type-badge.role-ref {
  background: color-mix(in srgb, var(--text-muted) 22%, var(--graph-node-bg));
  border-color: color-mix(in srgb, var(--text-muted) 30%, transparent);
  color: var(--text-muted);
}

.type-badge.role-output {
  background: color-mix(in srgb, #64b4ff 28%, var(--graph-node-bg));
  border-color: color-mix(in srgb, #64b4ff 42%, transparent);
}

.type-badge.role-missing {
  background: color-mix(in srgb, var(--danger, #c45c5c) 28%, var(--graph-node-bg));
  border-color: color-mix(in srgb, var(--danger, #c45c5c) 45%, transparent);
  color: var(--danger, #c45c5c);
  font-weight: 800;
  font-size: 12px;
}

.title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--text);
  white-space: nowrap;
  cursor: text;
  text-shadow:
    0 1px 2px var(--graph-node-bg),
    0 0 5px var(--graph-node-bg);
}

.title-input {
  min-width: 12em;
  width: auto;
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid #5a8fd466;
  border-radius: 4px;
  background: var(--graph-preview-bg);
  color: var(--text);
}

.title-input:focus {
  outline: none;
  border-color: var(--accent);
}

.head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.lock-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 18px;
  padding: 0;
  border: 1px solid color-mix(in srgb, #c4a35a 45%, transparent);
  border-radius: 4px;
  background: transparent;
  color: #b8a060;
  cursor: pointer;
  line-height: 1;
}

.lock-btn:hover {
  background: color-mix(in srgb, #c4a35a 18%, transparent);
  color: #d4b86a;
}

.lock-btn.active {
  background: color-mix(in srgb, #c4a35a 32%, transparent);
  border-color: #c4a35a;
  color: #e6cf8a;
}

.run-pill {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  letter-spacing: 0.02em;
}

.run-pill.pending {
  background: rgba(160, 160, 160, 0.2);
  color: #b0b0b0;
}

.run-pill.running {
  background: var(--accent-22);
  color: var(--accent-fg);
}

.run-pill.done {
  background: rgba(46, 125, 80, 0.25);
  color: #7dcea0;
}

.run-pill.error {
  background: rgba(160, 50, 50, 0.3);
  color: var(--danger-muted);
}

.preview {
  position: relative;
  flex: 1;
  min-height: 0;
  background: var(--graph-preview-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 0 0 10px 10px;
}

.preview.has-text {
  align-items: stretch;
  justify-content: flex-start;
}

.preview.preview-icon-only {
  cursor: pointer;
}

.preview-icon-fallback {
  width: 100%;
  height: 100%;
  justify-content: center;
}

.preview-icon-fallback .icon {
  font-size: 28px;
  line-height: 1;
  opacity: 0.85;
}

.preview img,
.preview video,
.camera-live-preview {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.text-preview {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 8px 8px 6px;
  box-sizing: border-box;
  background: var(--graph-text-preview-bg);
  cursor: text;
}

.text-preview-body {
  flex: 1;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Cascadia Code', 'Consolas', 'SF Mono', ui-monospace, monospace;
  font-size: 10px;
  line-height: 1.45;
  color: var(--graph-text-preview);
  mask-image: linear-gradient(180deg, #000 70%, transparent 100%);
}

.text-preview-hint {
  flex: none;
  margin-top: 4px;
  font-size: 9px;
  color: var(--text-muted);
  text-align: center;
  letter-spacing: 0.02em;
}

.card-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--graph-preview-bg);
}

.card-preview-grid img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: cover;
  display: block;
  background: var(--graph-preview-bg);
}

.card-text-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 4px;
  box-sizing: border-box;
  overflow: hidden;
  background: var(--graph-text-preview-bg);
}

.card-text-grid-item {
  margin: 0;
  padding: 4px;
  overflow: hidden;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'Cascadia Code', 'Consolas', 'SF Mono', ui-monospace, monospace;
  font-size: 9px;
  line-height: 1.35;
  color: var(--graph-text-preview);
  background: color-mix(in srgb, var(--graph-preview-bg) 55%, transparent);
  mask-image: linear-gradient(180deg, #000 65%, transparent 100%);
}

.media-fallback {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  color: var(--text-muted);
  font-size: 10px;
  padding: 8px;
  text-align: center;
}

.media-fallback .icon {
  font-size: 22px;
}

.media-fallback.audio {
  gap: 6px;
  padding-bottom: 52px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  justify-content: center;
}

.transport {
  position: absolute;
  left: 50%;
  bottom: 4px;
  transform: translateX(-50%);
  width: calc(100% - 16px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 7px 7px;
  border-radius: 8px;
  background: transparent;
  border: 0;
  backdrop-filter: none;
  z-index: 5;
}

.transport-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.ctrl-btn {
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.ctrl-btn.primary {
  width: 28px;
  height: 28px;
  color: #fff;
  background: var(--accent);
  border-color: transparent;
}

.ctrl-btn .triangle {
  width: 0;
  height: 0;
  margin-left: 2px;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 8px solid currentColor;
}

.ctrl-btn .pause {
  width: 8px;
  height: 12px;
  border-left: 2px solid currentColor;
  border-right: 2px solid currentColor;
}

.ctrl-btn .icon-restart {
  width: 10px;
  height: 10px;
  border: 2px solid currentColor;
  border-radius: 50%;
  border-left-color: transparent;
  position: relative;
}

.ctrl-btn .icon-restart::after {
  content: '';
  position: absolute;
  top: -3px;
  left: 4px;
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  transform: rotate(-35deg);
}

.progress-wrap {
  width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0 1px;
}

.progress {
  width: 100%;
  height: 4px;
  margin: 0;
  padding: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.time-row {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--wash-88);
  font-family: var(--mono);
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}

.time-row.inline {
  margin-left: auto;
  justify-content: flex-end;
  gap: 3px;
  white-space: nowrap;
  opacity: 0.95;
}

.media-error {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 5px;
  padding: 3px 4px;
  border-radius: 3px;
  background: rgba(130, 45, 35, 0.86);
  color: #fff;
  font-size: 9px;
  text-align: center;
}

.port-wrap {
  position: absolute;
  width: 0;
  height: 0;
  z-index: 30;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}

/* 悬停 / 选中 / 本节点连线 / 画布拖线中：显示端口 */
.graph-node:hover .port-wrap,
.graph-node.selected .port-wrap,
.graph-node.connecting .port-wrap,
.graph-node.link-mode .port-wrap {
  opacity: 1;
}

.port-wrap.in {
  left: 0;
}

.port-wrap.out {
  right: 0;
}

/* 端口名：端口上方，且整体在节点边框外 */
.port-wrap.in .port-type,
.port-wrap.out .port-type {
  position: absolute;
  left: 0;
  top: 0;
  font-size: 9px;
  line-height: 1;
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 64px;
  pointer-events: none;
  user-select: none;
}

.port-wrap.in .port-type {
  /* 左边框外、端口上方 */
  transform: translate(calc(-100% - 10px), calc(-100% - 6px));
  text-align: right;
}

.port-wrap.out .port-type {
  /* 右边框外、端口上方 */
  transform: translate(10px, calc(-100% - 6px));
  text-align: left;
}

/* 输入口数量徽标仍在端口右侧（节点内） */
.port-wrap.in .port-limit {
  position: absolute;
  top: 0;
  left: 12px;
  transform: translateY(-50%);
  min-width: 14px;
  padding: 1px 4px;
  border-radius: 3px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 9px;
  line-height: 12px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  text-align: center;
  pointer-events: none;
  user-select: none;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.25);
}

.port {
  position: absolute;
  top: 0;
  left: 0;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 2px solid var(--accent-fg);
  background: var(--graph-port-bg);
  padding: 0;
  cursor: crosshair;
  pointer-events: none;
  transform: translate(-50%, -50%);
}

.graph-node:hover .port-wrap .port,
.graph-node.selected .port-wrap .port,
.graph-node.connecting .port-wrap .port,
.graph-node.link-mode .port-wrap .port {
  pointer-events: auto;
}

/* 触控无悬停：始终显示端口 */
@media (hover: none) {
  .port-wrap {
    opacity: 1;
  }
  .port-wrap .port {
    pointer-events: auto;
  }
}

/* 多值输出口（out-all）：方形，对齐 Houdini multi 口 */
.port.port-square {
  width: 14px;
  height: 14px;
  border-radius: 2px;
}

.port.in {
  border-color: #ffb347;
  background: var(--graph-port-in-bg);
}

.port.port-world {
  border-color: #6bcb8a;
  background: color-mix(in srgb, #6bcb8a 28%, var(--graph-port-bg));
}

.port.port-world-entities {
  border-color: #4fd1a5;
  background: color-mix(in srgb, #4fd1a5 28%, var(--graph-port-bg));
}

.port.port-shot-entities {
  border-color: #e0a060;
  background: color-mix(in srgb, #e0a060 28%, var(--graph-port-bg));
}

.port.port-video-entities {
  border-color: #c77dff;
  background: color-mix(in srgb, #c77dff 28%, var(--graph-port-bg));
}

.port.port-narrative {
  border-color: #7eb6ff;
  background: color-mix(in srgb, #7eb6ff 28%, var(--graph-port-bg));
}

.port.port-shots {
  border-color: #d4a574;
  background: color-mix(in srgb, #d4a574 28%, var(--graph-port-bg));
}

.port:hover {
  transform: translate(-50%, -50%) scale(1.15);
}

:deep(.resize-handle) {
  z-index: 50;
}
</style>
