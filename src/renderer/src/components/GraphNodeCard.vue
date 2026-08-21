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
      'force-chrome': forceShowChrome,
      'suppress-chrome': suppressChrome,
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
      >
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
        <span
          class="collapse-tri"
          aria-hidden="true"
        />
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
          <LockIcon
            :locked="isLocked"
            :size="12"
          />
        </button>
        <span
          v-if="runStatus && runStatus !== 'idle' && runStatus !== 'skipped'"
          class="run-pill"
          :class="runStatus"
          :title="runError || runStatusLabel"
        >
          {{ runStatusLabel }}
        </span>
        <span
          v-if="reviewStatus"
          class="run-pill"
          :class="reviewStatus === 'FAIL' ? 'error' : 'done'"
          :title="reviewReason || (reviewStatus === 'FAIL' ? '导演审核失败' : '导演审核通过')"
        >
          {{ reviewStatus === 'FAIL' ? 'FAIL' : 'PASS' }}
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
        <span class="icon"><WorkspaceItemIcon
          :icon="typeIcon"
          :size="18"
        /></span>
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
          @load="onPreviewImageLoad"
        >

        <div
          v-else-if="isAnim2dNode && cardAnimFrames.length > 1"
          class="card-preview-grid anim2d-live"
          :title="previewOpenHint"
        >
          <img
            :src="cardAnimFrames[animFrameIndex]"
            alt=""
            loading="lazy"
            decoding="async"
            draggable="false"
            @load="onPreviewImageLoad"
          >
        </div>

        <div
          v-else-if="cardImageGridSrcs.length > 1"
          class="card-preview-grid"
          :class="cardImageGridExpanded ? 'is-expanded' : 'is-stacked'"
          :style="
            cardImageGridExpanded
              ? { gridTemplateColumns: `repeat(${cardImageGridColCount}, minmax(0, 1fr))` }
              : undefined
          "
          :title="previewOpenHint"
        >
          <template v-if="cardImageGridExpanded">
            <img
              v-for="(src, index) in cardImageGridSrcs"
              :key="`grid-img-${index}`"
              :src="src"
              alt=""
              loading="lazy"
              decoding="async"
              draggable="false"
              @load="onCardGridImageLoad(index, $event)"
            >
          </template>
          <template v-else>
            <img
              v-for="(src, index) in cardImageStackSrcs"
              :key="`stack-img-${index}`"
              class="stack-layer"
              :style="cardImageStackStyle(index, cardImageStackSrcs.length)"
              :src="src"
              alt=""
              loading="lazy"
              decoding="async"
              draggable="false"
              @load="index === cardImageStackSrcs.length - 1 ? onPreviewImageLoad($event) : undefined"
            >
          </template>
          <button
            type="button"
            class="grid-expand-btn"
            :title="
              cardImageGridExpanded
                ? t('graph.node.collapseImageGrid')
                : t('graph.node.expandImageGrid')
            "
            :aria-expanded="cardImageGridExpanded"
            :aria-label="
              cardImageGridExpanded
                ? t('graph.node.collapseImageGrid')
                : t('graph.node.expandImageGrid')
            "
            @pointerdown.stop
            @click.stop="toggleCardImageGridExpanded"
          >
            <span class="grid-expand-count">{{ cardImageGridSrcs.length }}</span>
            <span class="grid-expand-label">{{
              cardImageGridExpanded
                ? t('graph.node.collapseImageGridShort')
                : t('graph.node.expandImageGridShort')
            }}</span>
          </button>
        </div>

        <img
          v-else-if="(isFrameAnimGenNode || isSelectImageNode(node) || isMultiAngleEditorNode(node) || isLightingEditorNode(node) || isPortraitTextureEditorNode(node) || isEmotionEditorNode(node) || isUpscaleEditorNode(node) || isExpandEditorNode(node) || isRedrawEditorNode(node) || isEraseEditorNode(node) || isMatteEditorNode(node) || isCropEditorNode(node) || isGridSplitEditorNode(node) || isLayerSplitEditorNode(node) || isFramePullNode(node)) && selectImagePreview"
          :src="selectImagePreview"
          alt=""
          loading="lazy"
          decoding="async"
          draggable="false"
          @load="onPreviewImageLoad"
        >

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

        <div
          v-else-if="textPreview"
          class="text-preview"
          :title="previewOpenHint"
        >
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
          @load="onPreviewImageLoad"
        >

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

        <div
          v-else-if="previewKind === 'voice'"
          class="media-fallback audio"
        >
          <span class="icon"><WorkspaceItemIcon
            :icon="typeIcon"
            :size="18"
          /></span>
          <span
            v-if="!showMediaTransport || !previewUrl || mediaError"
            class="hint"
          >{{
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

        <div
          v-else-if="isFramePullNode(node)"
          class="media-fallback frame-pull-hint"
        >
          <span class="icon"><WorkspaceItemIcon
            :icon="typeIcon"
            :size="18"
          /></span>
          <span class="hint">{{ t('graph.inspector.framePull.openHint') }}</span>
        </div>

        <div
          v-else
          class="media-fallback"
        >
          <span class="icon"><WorkspaceItemIcon
            :icon="typeIcon"
            :size="18"
          /></span>
          <span class="hint">{{ previewHint }}</span>
        </div>

        <div
          v-if="showMediaTransport && previewUrl && !mediaError"
          class="transport"
          @pointerdown.stop
          @click.stop
          @wheel.stop
        >
          <div class="time-row inline">
            <span>{{ formatTime(currentTime) }}</span>
            <span>/</span>
            <span>{{ formatTime(duration) }}</span>
          </div>
          <div class="transport-row">
            <button
              type="button"
              class="ctrl-btn"
              :title="t('graph.media.restart')"
              @click="seekToStart"
            >
              <span class="icon-restart" />
            </button>
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
              >
            </div>
            <button
              type="button"
              class="ctrl-btn primary"
              :title="mediaPlaying ? t('graph.media.pause') : t('graph.media.play')"
              @click="togglePlayback"
            >
              <span :class="{ pause: mediaPlaying, triangle: !mediaPlaying }" />
            </button>
          </div>
        </div>

        <span
          v-if="mediaError"
          class="media-error"
        >{{ mediaErrorText }}</span>
      </template>
    </div>

    <div
      v-if="instructionOpen && instructionKind && hostId"
      class="instruction-panel"
      @pointerdown.stop
      @dblclick.stop
      @wheel.stop
    >
      <div class="instruction-panel-label">
        {{ t('graph.inspector.generate.instruction') }}
      </div>
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
        v-model="instruction"
        :open="instructionDialogOpen"
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
        :class="[
          portDataTypeClass(port),
          {
            'port-square': isPluralGraphPortDataType(port.dataType),
            'snap-highlight': snapHighlightPortIds?.has(port.id),
            'snap-ready': snapReadyPortIds?.has(port.id)
          }
        ]"
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
        :class="[
          portDataTypeClass(port),
          {
            'port-square': isBatchPort(port),
            'snap-highlight': snapHighlightPortIds?.has(port.id),
            'snap-ready': snapReadyPortIds?.has(port.id)
          }
        ]"
        :data-port-id="port.id"
        :title="outPortTitle(port)"
        @pointerdown.stop.prevent="onOutPortDown(port.id, $event)"
      />
      <span class="port-type">{{ outPortTypeLabel(port) }}</span>
    </div>

    <GraphNodeResizeHandle
      v-if="!previewCollapsed"
      @resize-start="onResizeStart"
    />

    <span
      v-if="!previewCollapsed"
      class="type-badge"
      :class="typeBadgeClass"
      :title="typeBadgeTitle"
    ><WorkspaceItemIcon
      :icon="typeBadgeIcon"
      :size="14"
    /></span>
  </div>
</template>

<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import GraphNodeResizeHandle from './GraphNodeResizeHandle.vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import LockIcon from './icons/LockIcon.vue'
import WorkspaceItemIcon from './WorkspaceItemIcon.vue'
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
import { composeImageGridCell } from '../features/graph/model/composeImageGridCell'
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
  defaultGameSystemUserPrompt,
  defaultFrameAnimGenUserPrompt,
  defaultUiSplitUserPrompt,
  deductReservedImageSlots,
  formatDurationRange,
  formatPortLimitBadge,
  getGraphScopeDefinition,
  getNodePorts,
  cardImageGridCols,
  cardImageGridMediaSize,
  fitNodeSizeToMediaAspect,
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
  isTimelineOutputNode,
  isWorldGenNode,
  isWorldExtractNode,
  isWorldTableNode,
  isBeatSplitNode,
  isBeatTableNode,
  isBeatGenNode,
  isBeatOutputNode,
  isBeatUnitOutputNode,
  isEpisodeAnchorSelectNode,
  isEpisodeCellSelectNode,
  anim2dCellKeys,
  isWorldOutputNode,
  isSelectImageNode,
  isSelectVideoNode,
  isSelectVoiceNode,
  isSelectTextNode,
  isSelectBeatNode,
  isFramePullNode,
  isReshootNode,
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
  isLayerSplitEditorNode,
  portLimitMaxForDataType,
  readImageGenerateParamsFromNode,
  readAnim2dFromNode,
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
  type EditorDiveNodeToolViewId,
  type EditorDiveViewMeta
} from '../features/graph/model/editorDive'
import { graphEditorNodeTools } from '../features/graph/ui/graphEditorNodeTools'
import { resolveGraphNodeDisplayTitle } from '../features/graph/model/graphNodeDisplayTitle'

const { t, te, locale, assetTypeLabel, graphTypeLabel } = useStudioI18n()
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
  /** 拖节点重合：类型兼容的端口高亮 */
  snapHighlightPortIds?: ReadonlySet<string>
  /** 拖节点靠近：即将自动连线的端口 */
  snapReadyPortIds?: ReadonlySet<string>
  /**
   * 画布有选中节点时：全部节点显示顶栏菜单与左下角类型图标。
   * 未选中时仅悬停当前节点显示。
   */
  forceShowChrome?: boolean
  /** 缩放节点时强制隐藏顶栏/标题/类型图标等，保持预览干净 */
  suppressChrome?: boolean
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
  /** 按预览媒体比例自动适配节点尺寸 */
  sizeChange: [nodeId: string, size: { w: number; h: number }]
  runToggle: [nodeId: string]
  selectImageOpen: [nodeId: string]
  selectVideoOpen: [nodeId: string]
  selectVoiceOpen: [nodeId: string]
  selectTextOpen: [nodeId: string]
  textsOpen: [nodeId: string]
  uiSplitOpen: [nodeId: string]
  textOpen: [nodeId: string]
}>()

const audioEl = ref<HTMLAudioElement | null>(null)
const videoEl = ref<HTMLVideoElement | null>(null)
const progressInput = ref<HTMLInputElement | null>(null)
const previewUrl = ref('')
const mediaPlaying = ref(false)
const mediaError = ref(false)
/** 2D 帧动画：卡片自动播放帧预览 */
const isAnim2dNode = computed(() => props.node.typeId === 'anim.2d')
/** 生成帧动画序列图：note 分类但输出图片，需走图片预览与尺寸自适应 */
const isFrameAnimGenNode = computed(() => props.node.typeId === 'frame.animGen')
const animFrameIndex = ref(0)
const cardAnimFrames = ref<string[]>([])
/** 用户双击暂停后，避免视口 watch 立刻重新自动播放 */
let animCardUserPaused = false
let animCardTimer: ReturnType<typeof setInterval> | null = null
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

/** Houdini 风格：复数端口（images/videos… / out-all / multiple）用方形 */
function isBatchPort(port: GraphPortDef): boolean {
  return (
    isPluralGraphPortDataType(port.dataType) ||
    port.multiple === true ||
    port.id === GRAPH_OUT_ALL_PORT_ID
  )
}

function portDataTypeClass(port: GraphPortDef): string {
  switch (port.dataType) {
    case GraphPortType.world:
      return 'port-world'
    case GraphPortType.worldEntities:
      return 'port-world-entities'
    case GraphPortType.beat:
      return 'port-beat'
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
    (props.node.typeId === 'asset.video' ||
      props.node.typeId === 'video.lipSync' ||
      props.node.typeId === 'video.reshoot') &&
    (isProcessingAssetNode(props.node) ||
      props.node.typeId === 'video.lipSync' ||
      props.node.typeId === 'video.reshoot')
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
    !isBeatOutputNode(props.node) &&
    !isBeatUnitOutputNode(props.node) &&
    (props.node.typeId === 'output.text' || props.node.params.outputKind === 'text')
)
const previewCollapsed = computed(() => props.node.params.previewCollapsed === true)
/** 多图默认错位叠放；仅显式 true 时平铺 */
const cardImageGridExpanded = computed(() => props.node.params.cardImageGridExpanded === true)

const cardImageGridColCount = computed(() => cardImageGridCols(cardImageGridSrcs.value.length))

function togglePreviewCollapsed(): void {
  if (!props.hostId) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    previewCollapsed: !previewCollapsed.value
  })
}

function toggleCardImageGridExpanded(): void {
  if (!props.hostId) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    cardImageGridExpanded: !cardImageGridExpanded.value
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
    case 'beat.unitGen':
      return 'beatUnitGen'
    case 'world.extract':
      return 'worldExtract'
    case 'beat.split':
      return 'beatSplit'
    case 'ui.split':
      return 'uiSplit'
    case 'frame.animGen':
      return 'frameAnimGen'
    case 'asset.screenplay':
      return isProcessingNode.value ? 'screenplay' : null
    case 'asset.gameSystem':
      return isProcessingNode.value ? 'screenplay' : null
    case 'asset.image':
      return isProcessingNode.value ? 'image' : null
    case 'asset.video':
      return isProcessingNode.value ? 'video' : null
    case 'video.lipSync':
      return 'lipSync'
    case 'video.reshoot':
      return 'reshoot'
    case 'image.upscale':
      return 'image'
    case 'asset.voice':
      return isProcessingNode.value ? 'voice' : null
    default:
      return null
  }
})

const portLimitKind = computed((): 'image' | 'video' | null => {
  if (instructionKind.value === 'image') return 'image'
  if (
    instructionKind.value === 'video' ||
    instructionKind.value === 'lipSync' ||
    instructionKind.value === 'reshoot'
  )
    return 'video'
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
  if (instructionKind.value === 'image' || instructionKind.value === 'frameAnimGen') {
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
  if (instructionKind.value === 'worldExtract') {
    return t('graph.inspector.generate.worldExtractInstructionPlaceholder')
  }
  if (instructionKind.value === 'beatSplit') {
    return t('graph.inspector.generate.beatSplitInstructionPlaceholder')
  }
  if (instructionKind.value === 'uiSplit') {
    return t('graph.inspector.generate.uiSplitInstructionPlaceholder')
  }
  if (instructionKind.value === 'beatUnitGen') {
    return t('graph.inspector.generate.beatUnitGenInstructionPlaceholder')
  }
  return t('graph.inspector.generate.instructionPlaceholder')
})

const instructionModelTitle = computed(() => {
  if (instructionKind.value === 'image' || instructionKind.value === 'frameAnimGen') {
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
  () => instructionKind.value === 'image' || instructionKind.value === 'frameAnimGen'
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
    if (isBeatOutputNode(props.node)) return t('graph.titles.beatOutput')
    if (isBeatUnitOutputNode(props.node)) return t('graph.titles.beatUnitOutput')
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
 * 可双击进入子图/子编辑器的工作流节点（分镜画面/视频、世界/场表等）。
 * 与宿主 📦 区分：用叠层图标表示内含子图。
 */
const canDiveIntoSubgraph = computed(() => {
  const n = props.node
  return (
    isTimelineOutputNode(n) ||
    isWorldTableNode(n) ||
    isWorldGenNode(n) ||
    isBeatTableNode(n) ||
    isBeatGenNode(n) ||
    isBeatOutputNode(n) ||
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
  // 资产引用/宿主：节点自定义标题优先，未设置时回退资产库原名（互不改写）
  if (isAssetRef.value) {
    const custom = props.node.title?.trim()
    if (custom) return custom
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
  if (isWorldExtractNode(props.node)) return '🗡️'
  if (isWorldTableNode(props.node) || isBeatTableNode(props.node)) return '📋'
  if (isBeatGenNode(props.node) || isBeatSplitNode(props.node)) return '📖'
  if (isWorldGenNode(props.node)) return '🤺'
  if (isWorldOutputNode(props.node)) return '🌍'
  if (isBeatOutputNode(props.node) || isBeatUnitOutputNode(props.node)) return '📖'
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

const reviewStatus = computed(() => props.node.params?.episodeReviewStatus ?? '')
const reviewReason = computed(() => props.node.params?.episodeReviewReason ?? '')

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
      isFrameAnimGenNode.value ||
        isSelectImageNode(props.node) ||
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
        isGridSplitEditorNode(props.node) ||
        isLayerSplitEditorNode(props.node) ||
        isFramePullNode(props.node),
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

/** 叠放层：最多 5 张，呈扑克手牌扇形；末张（最新）在最右上方 */
const cardImageStackSrcs = computed((): string[] => {
  const urls = cardImageGridSrcs.value
  if (urls.length <= 1) return urls
  return urls.slice(Math.max(0, urls.length - 5))
})

/**
 * 扑克手牌扇形：以底部为轴心，左右对称展开，右侧牌叠在最上层。
 * index 0 最左，total-1 最右（最新）。
 */
function cardImageStackStyle(index: number, total: number): Record<string, string> {
  const n = Math.max(1, total)
  const mid = (n - 1) / 2
  const t = index - mid
  // 张数少时扇角略大，张数多时收一点，避免裁切
  const rotStep = n <= 2 ? 10 : n <= 3 ? 12 : n <= 4 ? 10 : 8
  const xStep = n <= 2 ? 16 : n <= 3 ? 14 : n <= 4 ? 12 : 10
  const rot = t * rotStep
  const tx = t * xStep
  // 轻微弧线：两侧略下沉，中间略抬起
  const ty = Math.abs(t) * 5 - (mid > 0 ? 2 : 0)
  return {
    zIndex: String(index + 1),
    transformOrigin: '50% 100%',
    transform: `translate(calc(-50% + ${tx}px), calc(-42% + ${ty}px)) rotate(${rot}deg)`,
    opacity: '1'
  }
}

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
    isWorldExtractNode(props.node) ||
    isWorldTableNode(props.node) ||
    isWorldGenNode(props.node) ||
    isBeatSplitNode(props.node) ||
    isBeatTableNode(props.node) ||
    isBeatGenNode(props.node)
)

const scriptNodePreviewTitle = computed(() => {
  if (
    isWorldExtractNode(props.node) ||
    isBeatSplitNode(props.node)
  ) {
    return t('graph.generateNode.instructionHint')
  }
  if (isWorldTableNode(props.node)) return t('graph.worldTableNode.hint')
  if (isWorldGenNode(props.node)) return t('graph.worldGenNode.hint')
  if (isBeatTableNode(props.node)) return t('graph.beatTableNode.hint')
  if (isBeatGenNode(props.node)) return t('graph.beatGenNode.hint')
  return ''
})

/** 节点上展示的文本输出（执行结果或已保存正文）；有内容才覆盖媒体预览 */
const textPreview = computed(() => {
  // 剧本引用：不展示正文预览（图标 + 引用提示）
  if (isAssetRef.value && props.node.assetType === 'screenplay') {
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
  if (isWorldTableNode(props.node)) return t('graph.worldTableNode.hint')
  if (isWorldGenNode(props.node)) return t('graph.worldGenNode.hint')
  if (isBeatTableNode(props.node)) return t('graph.beatTableNode.hint')
  if (isBeatGenNode(props.node)) return t('graph.beatGenNode.hint')
  if (isSelectImageNode(props.node)) return t('graph.selectImage.hint')
  if (isSelectVideoNode(props.node)) return t('graph.selectVideo.hint')
  if (isSelectVoiceNode(props.node)) return t('graph.selectVoice.hint')
  if (isSelectTextNode(props.node)) return t('graph.selectText.hint')
  if (isSelectBeatNode(props.node)) return t('graph.selectBeat.hint')
  if (isMultiAngleEditorNode(props.node)) return t('graph.multiAngle.hint')
  if (isLightingEditorNode(props.node)) return t('graph.lighting.hint')
  if (isPortraitTextureEditorNode(props.node)) return t('graph.portraitTexture.hint')
  if (isEmotionEditorNode(props.node)) return t('graph.emotion.hint')
  if (isLipSyncNode(props.node)) return t('graph.lipSync.hint')
  if (isExpandEditorNode(props.node)) return t('graph.expand.hint')
  if (isRedrawEditorNode(props.node)) return t('graph.redraw.hint')
  if (isEraseEditorNode(props.node)) return t('graph.erase.hint')
  if (isMatteEditorNode(props.node)) return t('graph.matte.hint')
  if (isCropEditorNode(props.node)) return t('graph.crop.hint')
  if (isGridSplitEditorNode(props.node)) return t('graph.gridSplit.hint')
  if (isLayerSplitEditorNode(props.node)) return t('graph.layerSplit.hint')
  if (instructionKind.value) return t('graph.generateNode.instructionHint')
  if (isMissingLinkedAsset.value) return t('graph.assetMissing.hint')
  if (isAssetRef.value) {
    return isImportedRefAsset.value ? t('graph.assetRef.hint') : t('graph.assetHost.hint')
  }
  if (isProcessingNode.value) return t('graph.generateNode.hint')
  return assetName.value || typeLabel.value
})

const previewOpenHint = computed(() => {
  if (isAnim2dNode.value) return t('graph.anim2d.cardPlayHint')
  if (instructionKind.value === 'screenplay') return t('graph.generateNode.instructionHint')
  if (isScreenplayOutputNode.value) return t('graph.textsPreview.hint')
  if (isSelectTextNode(props.node)) return t('graph.selectText.hint')
  if (isSelectBeatNode(props.node)) return t('graph.selectBeat.hint')
  // 预览区已有正文时，双击优先打开记事本
  if (
    textPreview.value &&
    !isAssetRef.value &&
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
  // 帧动画：note 分类无 assetType，但仍输出图片，需按 image 走预览与尺寸自适应
  if (isFrameAnimGenNode.value || isAnim2dNode.value) return 'image'
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
    return props.node.title?.trim() || props.asset?.name?.trim() || displayTitle.value
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
    ? props.node.title?.trim() || props.asset?.name?.trim() || ''
    : (props.node.title?.trim() ?? '')
  if (next === prev) return
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

function resolvedNodeInstruction(): string {
  const stored = props.node.params.generateInstruction
  // 空字符串视为未填写，回落到类型默认（剧本/策划案/UI拆分/帧动画等）
  if (typeof stored === 'string' && stored.trim()) return stored
  if (props.node.typeId === 'asset.gameSystem') {
    return defaultGameSystemUserPrompt(String(locale.value))
  }
  if (props.node.typeId === 'ui.split') {
    return defaultUiSplitUserPrompt(String(locale.value))
  }
  if (props.node.typeId === 'frame.animGen') {
    return defaultFrameAnimGenUserPrompt(String(locale.value))
  }
  return ''
}

watch(
  () => props.node.params.generateInstruction,
  (value) => {
    const next =
      typeof value === 'string' && value.trim() ? value : resolvedNodeInstruction()
    if (next !== instruction.value) instruction.value = next
  },
  { immediate: true }
)

watch(instructionOpen, (open) => {
  if (open) {
    instruction.value = resolvedNodeInstruction()
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
  viewId: EditorDiveNodeToolViewId,
  title?: string,
  mode?: string
): Promise<boolean> {
  const hostId = props.hostId?.trim()
  if (!hostId) return false
  // 子图宿主在 dive 后可能被工具视图替换卸载；先在宿主仍挂载时打开工具状态，
  // 再进入 dive，工具视图挂载后直接读取已打开的状态。
  await graphEditorNodeTools.open(hostId, viewId, props.node.id, mode)
  return diveView(
    { viewId, hostId, nodeId: props.node.id, ...(mode ? { mode } : {}) },
    title
  )
}

function onPreviewDblClick(): void {
  if (isMissingLinkedAsset.value) return
  void (async () => {
    const title = displayTitle.value

    // 2D帧动画：双击播放/暂停序列帧，勿走 note 分类的记事本
    if (isAnim2dNode.value) {
      await toggleCardAnimPreview()
      return
    }

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

    if (isSelectImageNode(props.node)) {
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
    if (isSelectTextNode(props.node) || isSelectBeatNode(props.node)) {
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
    if (isFramePullNode(props.node)) {
      await diveNodeTool('node.framePull', title)
      return
    }
    if (isReshootNode(props.node)) {
      await diveNodeTool('node.reshoot', title)
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
    if (isLayerSplitEditorNode(props.node)) {
      await diveNodeTool('node.layerSplit', title)
      return
    }
    const scriptAssetId = hostAssetId.value
    if (isTimelineOutputNode(props.node) && scriptAssetId) {
      await diveView(
        { viewId: 'script.timeline', scriptAssetId, timelineNodeId: props.node.id },
        title
      )
      return
    }

    const worldAssetId = hostAssetId.value
    if (isWorldTableNode(props.node) && worldAssetId) {
      await diveView({ viewId: 'world.table', worldAssetId }, title)
      return
    }
    if (isWorldGenNode(props.node) && worldAssetId) {
      await diveView(
        { viewId: 'world.editor', worldAssetId, worldGenNodeId: props.node.id },
        title
      )
      return
    }

    const beatAssetId = hostAssetId.value
    if (isBeatTableNode(props.node) && beatAssetId) {
      await diveView({ viewId: 'beat.table', beatAssetId }, title)
      return
    }
    if ((isBeatGenNode(props.node) || isBeatOutputNode(props.node)) && beatAssetId) {
      await diveView({ viewId: 'beat.gen', beatAssetId }, title)
      return
    }

    // 剧集流水线总览由顶部工具栏打开；宫格/动态格选择双击统一打开记事本
    if (isEpisodeAnchorSelectNode(props.node) || isEpisodeCellSelectNode(props.node)) {
      emit('textOpen', props.node.id)
      return
    }

    // UI 界面生成：双击进入内图（每条提示词一条输出链）
    if (props.node.typeId === 'ui.gen') {
      emit('uiSplitOpen', props.node.id)
      return
    }

    // 生成剧本：双击展开生成指令面板（勿被正文预览抢成记事本）
    if (instructionKind.value === 'screenplay') {
      instructionOpen.value = !instructionOpen.value
      return
    }
    // 场生成：双击只开关指令面板，不打开正文预览/记事本
    if (instructionKind.value === 'beatUnitGen') {
      instructionOpen.value = !instructionOpen.value
      return
    }
    // 剧集 Agent 流水线的分镜师/动画师 prompt.optimize：
    // 即使已经产出正文，双击也优先打开/收起生成指令窗口，而不是打开记事本预览
    if (
      props.node.typeId === 'prompt.optimize' &&
      typeof props.node.params?.episodeStep === 'string'
    ) {
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

const lastAutoFitMediaKey = ref('')

/** 卡片上是否在展示可按比例适配的图片/视频 */
function hasAutoFitMediaPreview(): boolean {
  if (previewKind.value === 'image' || previewKind.value === 'video') return true
  if (isAnim2dNode.value && cardAnimFrames.value.length > 0) return true
  if (isFrameAnimGenNode.value) return true
  if (cardImageGridSrcs.value.length > 0) return true
  if (selectImagePreview.value.trim()) return true
  if (directorLivePreview.value.trim()) return true
  return false
}

watch(
  () =>
    [
      previewUrl.value,
      cardAnimFrames.value[0] ?? '',
      cardImageGridSrcs.value.length,
      cardImageGridSrcs.value[0] ?? '',
      cardImageGridExpanded.value,
      selectImagePreview.value,
      directorLivePreview.value
    ] as const,
  () => {
    lastAutoFitMediaKey.value = ''
  }
)

function tryAutoFitPreviewMedia(mediaW: number, mediaH: number, mediaKey?: string): void {
  if (!(mediaW > 0 && mediaH > 0)) return
  if (previewCollapsed.value) return
  if (props.node.params.sizeManuallyResized === true) return
  if (!hasAutoFitMediaPreview()) return
  const key =
    mediaKey ||
    `${previewUrl.value || cardAnimFrames.value[0] || cardImageGridSrcs.value[0] || selectImagePreview.value || directorLivePreview.value}|${Math.round(mediaW)}x${Math.round(mediaH)}`
  if (key === lastAutoFitMediaKey.value) return
  const next = fitNodeSizeToMediaAspect(props.node, mediaW, mediaH)
  const cur = getNodeSize(props.node)
  lastAutoFitMediaKey.value = key
  if (Math.abs(cur.w - next.w) < 1 && Math.abs(cur.h - next.h) < 1) return
  emit('sizeChange', props.node.id, next)
}

function onPreviewImageLoad(e: Event): void {
  const img = e.currentTarget as HTMLImageElement
  const src = img.currentSrc || img.src || ''
  tryAutoFitPreviewMedia(img.naturalWidth, img.naturalHeight, `${src}|${img.naturalWidth}x${img.naturalHeight}`)
}

function loadImageNaturalSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    let settled = false
    const finish = (ok: boolean): void => {
      if (settled) return
      settled = true
      if (!ok || !(img.naturalWidth > 0 && img.naturalHeight > 0)) {
        reject(new Error('IMAGE_SIZE_UNAVAILABLE'))
        return
      }
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onload = () => finish(true)
    img.onerror = () => finish(false)
    img.src = src
    // 缓存图常常不触发 @load，complete 时直接可读尺寸
    if (img.complete) finish(img.naturalWidth > 0)
  })
}

/**
 * 多图卡片尺寸适配：叠放按单张比例；平铺按方阵整网格比例。
 * 不依赖 img @load（缓存图常常不触发 load）。
 */
let cardGridAutoFitToken = 0
async function autoFitCardImageGrid(urls: string[]): Promise<void> {
  const n = urls.length
  const src = (cardImageGridExpanded.value ? urls[0] : urls[urls.length - 1])?.trim()
  if (!src || n <= 1) return
  const token = ++cardGridAutoFitToken
  const expanded = cardImageGridExpanded.value
  try {
    const { width, height } = await loadImageNaturalSize(src)
    if (token !== cardGridAutoFitToken) return
    if (cardImageGridSrcs.value.length !== n) return
    if (cardImageGridExpanded.value !== expanded) return
    if (expanded) {
      const cols = cardImageGridCols(n)
      const media = cardImageGridMediaSize(n, width, height, cols)
      tryAutoFitPreviewMedia(
        media.w,
        media.h,
        `grid:expanded:${n}:${cols}x${Math.ceil(n / cols)}:${width}x${height}`
      )
      return
    }
    tryAutoFitPreviewMedia(width, height, `grid:stacked:${n}:${width}x${height}`)
  } catch {
    /* 尺寸探测失败时保留当前节点大小 */
  }
}

watch(
  [cardImageGridSrcs, cardImageGridExpanded],
  ([urls]) => {
    if (urls.length > 1) void autoFitCardImageGrid(urls)
  },
  { flush: 'post' }
)

/** 平铺网格 @load 兜底 */
function onCardGridImageLoad(index: number, e: Event): void {
  if (index !== 0 || !cardImageGridExpanded.value) return
  const img = e.currentTarget as HTMLImageElement
  const n = cardImageGridSrcs.value.length
  const iw = img.naturalWidth
  const ih = img.naturalHeight
  if (!(iw > 0 && ih > 0) || n <= 1) return
  const cols = cardImageGridCols(n)
  const media = cardImageGridMediaSize(n, iw, ih, cols)
  tryAutoFitPreviewMedia(
    media.w,
    media.h,
    `grid:expanded:${n}:${cols}x${Math.ceil(n / cols)}:${iw}x${ih}`
  )
}

function onMediaLoaded(e: Event): void {
  const el = e.currentTarget as HTMLMediaElement
  applyMediaParams()
  syncMediaClock(el)
  if (el instanceof HTMLVideoElement) {
    tryAutoFitPreviewMedia(el.videoWidth, el.videoHeight)
  }
}

function startCardAnimPreview(): void {
  if (animCardTimer != null) return
  animCardTimer = setInterval(() => {
    const count = cardAnimFrames.value.length
    if (count <= 1) return
    animFrameIndex.value = (animFrameIndex.value + 1) % count
  }, 125)
}

function stopCardAnimPreview(): void {
  if (animCardTimer != null) {
    clearInterval(animCardTimer)
    animCardTimer = null
  }
}

/** 卡片预览：双击切换序列帧播放；未切分时先从序列图加载 */
async function toggleCardAnimPreview(): Promise<void> {
  if (animCardTimer != null) {
    stopCardAnimPreview()
    animCardUserPaused = true
    return
  }
  animCardUserPaused = false
  if (cardAnimFrames.value.length <= 1) {
    if (cardImageGridSrcs.value.length > 1) {
      cardAnimFrames.value = cardImageGridSrcs.value.slice()
    } else {
      await loadCardAnimFramesFromSequence()
    }
  }
  if (cardAnimFrames.value.length <= 1) return
  startCardAnimPreview()
}

async function loadCardAnimFramesFromSequence(): Promise<void> {
  if (!isAnim2dNode.value || cardAnimFrames.value.length > 1) return
  const s = readAnim2dFromNode(props.node.params)
  if (anim2dCellKeys(s.rows, s.cols).length <= 1) return
  const grid = props.node.params?.animGridImage as
    | { dataUrl?: string; relativePath?: string }
    | undefined
  let sourceUrl = grid?.dataUrl?.trim() || ''
  if (!sourceUrl && grid?.relativePath?.trim()) {
    try {
      sourceUrl = (await window.studio.getAssetMediaDataUrl(grid.relativePath.trim())) ?? ''
    } catch {
      sourceUrl = ''
    }
  }
  if (!sourceUrl) sourceUrl = previewUrl.value || ''
  if (!sourceUrl) return
  const next: string[] = []
  for (const key of anim2dCellKeys(s.rows, s.cols)) {
    try {
      const composed = await composeImageGridCell({
        sourceDataUrl: sourceUrl,
        state: { rows: s.rows, cols: s.cols, selected: [] },
        cellKey: key,
        edgeInset: 'auto'
      })
      if (composed.dataUrl?.trim()) next.push(composed.dataUrl.trim())
    } catch {
      /* 跳过切分失败的帧 */
    }
  }
  if (next.length > 1) cardAnimFrames.value = next
}

watch(
  () => [cardImageGridSrcs.value.slice().join('\0'), previewInViewport.value] as const,
  async () => {
    if (isAnim2dNode.value && cardImageGridSrcs.value.length > 1) {
      cardAnimFrames.value = cardImageGridSrcs.value.slice()
    } else if (cardAnimFrames.value.length <= 1) {
      await loadCardAnimFramesFromSequence()
    }
    if (
      isAnim2dNode.value &&
      previewInViewport.value &&
      cardAnimFrames.value.length > 1 &&
      !animCardUserPaused
    ) {
      animFrameIndex.value = 0
      startCardAnimPreview()
    } else {
      stopCardAnimPreview()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cancelPreviewLoads()
  stopProgressTicker()
  stopCardAnimPreview()
  cardGridAutoFitToken += 1
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
  border: 1px solid color-mix(in srgb, #c4c9d1 42%, var(--border));
  border-radius: 10px;
  background: var(--graph-node-bg);
  box-shadow: 0 2px 10px color-mix(in srgb, var(--shadow) 55%, transparent);
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
  border-color: color-mix(in srgb, #3d6ea8 78%, transparent);
  z-index: 12;
}

.graph-node.asset-ref {
  border-style: dashed;
  border-color: color-mix(in srgb, #b8bec8 65%, transparent);
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
  border-color: color-mix(in srgb, #3d9a6e 78%, transparent);
  background: linear-gradient(
    160deg,
    var(--graph-node-processing-from) 0%,
    var(--graph-node-bg) 55%
  );
}

.graph-node.lock-node {
  border-color: color-mix(in srgb, #8a7a4a 78%, transparent);
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
.graph-node.connecting {
  z-index: 20;
}

/* 指令框打开时整卡抬到所有节点之上，避免被后方/重叠节点盖住 */
.graph-node.instruction-open {
  z-index: 200;
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
  /* 叠在预览上方，不占布局高度，避免隐藏后留下空白条 */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  /* 高于 port-wrap(30)，避免右侧输出口标签盖住执行/锁定按钮 */
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  min-width: 0;
  border-radius: 10px 10px 0 0;
  overflow: hidden;
  box-sizing: border-box;
  background: color-mix(in srgb, var(--graph-node-bg, var(--bg-elevated)) 60%, transparent);
  backdrop-filter: blur(6px);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.graph-node.preview-collapsed .node-head {
  position: relative;
  top: auto;
  left: auto;
  right: auto;
  border-bottom: none;
  border-radius: 10px;
  height: 100%;
  background: transparent;
  backdrop-filter: none;
}

/* 顶栏 / 左下角类型图标：默认隐藏；悬停当前、有选中(全部)、连线/运行时显示 */
.graph-node:hover .node-head,
.graph-node.force-chrome .node-head,
.graph-node.selected .node-head,
.graph-node.connecting .node-head,
.graph-node.link-mode .node-head,
.graph-node.instruction-open .node-head,
.graph-node.run-running .node-head,
.graph-node.run-error .node-head,
.graph-node.preview-collapsed .node-head {
  opacity: 1;
  pointer-events: auto;
}

/* 拉升尺寸时盖过 hover/选中，强制保持干净 */
.graph-node.suppress-chrome .node-head,
.graph-node.suppress-chrome .type-badge,
.graph-node.suppress-chrome .transport,
.graph-node.suppress-chrome .node-title {
  opacity: 0 !important;
  pointer-events: none !important;
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
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
  user-select: none;
}

.graph-node:hover .type-badge,
.graph-node.force-chrome .type-badge,
.graph-node.selected .type-badge,
.graph-node.connecting .type-badge,
.graph-node.link-mode .type-badge,
.graph-node.instruction-open .type-badge,
.graph-node.run-running .type-badge,
.graph-node.run-error .type-badge {
  opacity: 1;
  pointer-events: auto;
}

/* 触控无悬停：始终显示顶栏与类型图标 */
@media (hover: none) {
  .node-head,
  .type-badge {
    opacity: 1;
    pointer-events: auto;
  }
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
  /* 顶栏改为叠加后，预览铺满圆角 */
  border-radius: 10px;
}

.graph-node.preview-collapsed .preview {
  display: none;
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
  /* 任意比例均完整显示，留白用预览底色 letterbox */
  object-fit: contain;
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
  position: relative;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2px;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--graph-preview-bg);
}

.card-preview-grid.anim2d-live {
  display: block;
}

.card-preview-grid.anim2d-live img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.card-preview-grid.is-expanded {
  display: grid;
  /* 列数由 :style gridTemplateColumns（方阵）注入 */
  gap: 2px;
}

.card-preview-grid.is-stacked {
  display: block;
  overflow: hidden;
}

.card-preview-grid.is-stacked .stack-layer {
  position: absolute;
  left: 50%;
  top: 50%;
  /* 略窄略高，更像手牌比例，扇开后不易互挡太多 */
  width: 58%;
  height: 72%;
  object-fit: cover;
  object-position: center;
  border-radius: 5px;
  border: 1px solid color-mix(in srgb, #fff 18%, transparent);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.3),
    0 6px 14px rgba(0, 0, 0, 0.34);
  background: var(--graph-preview-bg);
  /* origin 由 cardImageStackStyle 设为底部，便于扇形展开 */
  pointer-events: none;
}

.card-preview-grid.is-expanded img {
  width: 100%;
  height: 100%;
  min-height: 0;
  object-fit: contain;
  display: block;
  background: var(--graph-preview-bg);
}

.grid-expand-btn {
  position: absolute;
  right: 6px;
  bottom: 6px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 7px;
  border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-elevated) 88%, transparent);
  color: var(--text);
  font-size: 10px;
  line-height: 1;
  cursor: pointer;
}

.grid-expand-btn:hover {
  border-color: var(--accent, #5a8cff);
  background: var(--bg-hover, var(--bg-elevated));
}

.graph-node .grid-expand-btn {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.graph-node:hover .grid-expand-btn,
.graph-node.selected .grid-expand-btn {
  opacity: 1;
  pointer-events: auto;
}

.grid-expand-count {
  min-width: 1.1em;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
  opacity: 0.9;
}

.grid-expand-label {
  opacity: 0.85;
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
  padding-bottom: 36px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  justify-content: center;
}

.transport {
  /* 左侧避开 type-badge（left 6 + 20），右侧避开缩放手柄 */
  position: absolute;
  left: 30px;
  right: 14px;
  bottom: 3px;
  width: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 2px 3px;
  border-radius: 8px;
  background: transparent;
  border: 0;
  backdrop-filter: none;
  z-index: 5;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

/* 与顶栏/类型图标一致：默认隐藏，悬停或选中态显示 */
.graph-node:hover .transport,
.graph-node.force-chrome .transport,
.graph-node.selected .transport,
.graph-node.connecting .transport,
.graph-node.link-mode .transport,
.graph-node.instruction-open .transport,
.graph-node.run-running .transport,
.graph-node.run-error .transport {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .transport {
    opacity: 1;
    pointer-events: auto;
  }
}

.transport-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  width: 100%;
}

.ctrl-btn {
  width: 18px;
  height: 18px;
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
  width: 20px;
  height: 20px;
  color: #fff;
  background: var(--accent);
  border-color: transparent;
}

.ctrl-btn .triangle {
  width: 0;
  height: 0;
  margin-left: 1px;
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
  border-left: 5px solid currentColor;
}

.ctrl-btn .pause {
  width: 5px;
  height: 8px;
  border-left: 1.5px solid currentColor;
  border-right: 1.5px solid currentColor;
}

.ctrl-btn .icon-restart {
  width: 7px;
  height: 7px;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  border-left-color: transparent;
  position: relative;
}

.ctrl-btn .icon-restart::after {
  content: '';
  position: absolute;
  top: -2px;
  left: 2.5px;
  width: 0;
  height: 0;
  border-top: 2.5px solid transparent;
  border-bottom: 2.5px solid transparent;
  border-left: 3.5px solid currentColor;
  transform: rotate(-35deg);
}

.progress-wrap {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0 1px;
}

.progress {
  width: 100%;
  height: 3px;
  margin: 0;
  padding: 0;
  accent-color: var(--accent);
  cursor: pointer;
}

.time-row {
  display: flex;
  justify-content: space-between;
  font-size: 8px;
  color: var(--wash-88);
  font-family: var(--mono);
  line-height: 1;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.85);
}

.time-row.inline {
  justify-content: flex-end;
  gap: 3px;
  white-space: nowrap;
  opacity: 0.95;
  align-self: flex-end;
  padding-right: 2px;
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
  /* 左边框外、端口上方；端口外移 8px 后标签再往外让开 */
  transform: translate(calc(-100% - 18px), calc(-100% - 6px));
  text-align: right;
}

.port-wrap.out .port-type {
  /* 右边框外、端口上方；端口外移 8px 后标签再往外让开 */
  transform: translate(18px, calc(-100% - 6px));
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

/* 端口外移到节点边框外，与边框外切；连线锚点仍停在边框上，与端口内沿相接 */
.port-wrap.in .port {
  transform: translate(calc(-50% - 8px), -50%);
}

.port-wrap.out .port {
  transform: translate(calc(-50% + 8px), -50%);
}

.graph-node:hover .port-wrap .port,
.graph-node.selected .port-wrap .port,
.graph-node.connecting .port-wrap .port,
.graph-node.link-mode .port-wrap .port {
  pointer-events: auto;
}

.port.snap-highlight {
  pointer-events: auto;
  opacity: 1;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent, #64b4ff) 75%, transparent);
  filter: brightness(1.15);
}

.port.snap-ready {
  pointer-events: auto;
  opacity: 1;
  transform: translate(calc(-50% + 0px), -50%) scale(1.25);
  box-shadow:
    0 0 0 2px color-mix(in srgb, #7dcea0 90%, transparent),
    0 0 10px color-mix(in srgb, #7dcea0 55%, transparent);
  filter: brightness(1.25);
}

.port-wrap.in .port.snap-ready {
  transform: translate(calc(-50% - 8px), -50%) scale(1.25);
}

.port-wrap.out .port.snap-ready {
  transform: translate(calc(-50% + 8px), -50%) scale(1.25);
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

.port.port-beat {
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

.port-wrap.in .port:hover {
  transform: translate(calc(-50% - 8px), -50%) scale(1.15);
}

.port-wrap.out .port:hover {
  transform: translate(calc(-50% + 8px), -50%) scale(1.15);
}

/* 端口内 `+`（CSS 绘制，保证像素级居中）：强化“可在此连线”的提示 */
.port::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  width: 8px;
  height: 8px;
  color: var(--text, #fff);
  background:
    linear-gradient(currentColor, currentColor) 0 50% / 100% 2px no-repeat,
    linear-gradient(currentColor, currentColor) 50% 0 / 2px 100% no-repeat;
  opacity: 0.8;
  pointer-events: none;
  user-select: none;
}

:deep(.resize-handle) {
  z-index: 50;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.graph-node:hover :deep(.resize-handle),
.graph-node.selected :deep(.resize-handle) {
  opacity: 1;
  pointer-events: auto;
}
</style>
