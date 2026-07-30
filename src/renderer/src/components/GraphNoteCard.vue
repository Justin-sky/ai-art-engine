<template>
  <div
    class="graph-note"
    :class="[
      {
        selected,
        'preview-collapsed': previewCollapsed,
        'lock-node': isLocked
      },
      isInputSlot ? `input-slot slot-${slotDataType}` : null
    ]"
    :data-node-id="node.id"
    :style="{
      left: `${node.position.x}px`,
      top: `${node.position.y}px`,
      width: `${width}px`,
      height: `${height}px`
    }"
    @pointerdown.stop="onPointerDown"
    @dblclick.stop="onBodyDblClick"
  >
    <div class="note-head">
      <button
        v-if="isInputSlot || isBoundary"
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
      <span v-if="isLocked" class="type-pill lock">{{ t('graph.nodeRole.lock') }}</span>
      <span v-else class="type-pill">{{ badgeLabel }}</span>
      <input
        v-if="editingTitle"
        ref="titleInputEl"
        v-model="titleDraft"
        class="title-input"
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
      </div>
    </div>

    <div v-show="!previewCollapsed" class="note-content" :class="{ 'has-media': !!mediaPreviewUrl }">
      <img
        v-if="mediaPreviewUrl"
        :src="mediaPreviewUrl"
        alt=""
        class="note-media-preview"
        loading="lazy"
        decoding="async"
        draggable="false"
      />
      <div v-else class="note-body">{{ displayText }}</div>
    </div>

    <GraphNodeResizeHandle v-if="!previewCollapsed" @resize-start="onResizeStart" />

    <div
      v-for="(port, index) in inPorts"
      :key="`in-${port.id}`"
      class="port-wrap in"
      :style="portWrapStyle(inPorts.length, index)"
    >
      <span class="port-type">{{ portTypeLabel(port.dataType) }}</span>
      <button
        type="button"
        class="port in"
        :data-port-id="port.id"
        :title="`${t('graph.port.inTitle')} · ${portTypeLabel(port.dataType)}`"
        @pointerdown.stop.prevent="onInPortDown(port.id, $event)"
      />
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
        :data-port-id="port.id"
        :title="`${t('graph.port.outTitle')} · ${portTypeLabel(port.dataType)}`"
        @pointerdown.stop.prevent="onOutPortDown(port.id, $event)"
      />
      <span class="port-type">{{ portTypeLabel(port.dataType) }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import GraphNodeResizeHandle from './GraphNodeResizeHandle.vue'
import LockIcon from './icons/LockIcon.vue'
import {
  getNodePorts,
  getNodeSize,
  GRAPH_INPUT_SLOT_TYPE_ID,
  graphValueHasPayload,
  isBoundaryProxyNode,
  isGenerateLocked,
  nodePortYRatio,
  readHostInputSlot,
  resolveNodeType,
  isBoundaryInputNode,
  softResolveBoundaryInputParams,
  softResolveBoundaryOutputValue,
  supportsGenerateLock,
  type GraphDocument,
  type GraphNode,
  type GraphNodeRunState,
  type GraphNodeRunStatus,
  type GraphPortDataType,
  type GraphValue
} from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'
import { resolveAssetPreviewUrl } from '../features/media/assetUrlCache'
import { graphPreviewLoadScheduler } from '../features/media/previewLoadScheduler'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const { t, te } = useStudioI18n()

const props = defineProps<{
  node: GraphNode
  selected: boolean
  hostId?: string
  runStatus?: GraphNodeRunStatus
  runError?: string
  runState?: GraphNodeRunState
}>()

const emit = defineEmits<{
  dragStart: [nodeId: string, event: PointerEvent]
  titleChange: [nodeId: string, title: string]
  resizeStart: [nodeId: string, event: PointerEvent]
  outPortDown: [nodeId: string, portId: string, event: PointerEvent]
  inPortDown: [nodeId: string, portId: string, event: PointerEvent]
  textOpen: [nodeId: string]
}>()

const nodeSize = computed(() => getNodeSize(props.node))
const nodePorts = computed(() => getNodePorts(props.node))
const inPorts = computed(() => nodePorts.value.filter((p) => p.direction === 'in'))
const outPorts = computed(() => nodePorts.value.filter((p) => p.direction === 'out'))
const isInputSlot = computed(() => props.node.typeId === GRAPH_INPUT_SLOT_TYPE_ID)
const isBoundary = computed(() => isBoundaryProxyNode(props.node))
const canLock = computed(() => supportsGenerateLock(props.node))
const isLocked = computed(() => isGenerateLocked(props.node))
const slotBinding = computed(() => readHostInputSlot(props.node))
const slotDataType = computed<GraphPortDataType>(
  () => slotBinding.value?.dataType ?? outPorts.value[0]?.dataType ?? 'text'
)
const boundaryDataType = computed(
  () => props.node.params.hostBoundaryPort?.dataType ?? 'text'
)
const isImageBoundary = computed(
  () =>
    isBoundary.value &&
    (boundaryDataType.value === 'image' || boundaryDataType.value === 'images')
)

function portTypeLabel(dataType: GraphPortDataType): string {
  return t(`graph.port.types.${dataType}`)
}

function portWrapStyle(count: number, index: number): Record<string, string> {
  // 与 getNodePortCenter 同源：在标题栏下方 body 区排布
  const pct = nodePortYRatio(index, count, height.value) * 100
  return { top: `${pct}%` }
}

const width = computed(() => nodeSize.value.w)
const height = computed(() => nodeSize.value.h)

function mediaPathFromValue(value: GraphValue | undefined): string {
  if (!value) return ''
  if (value.kind === 'image') return value.relativePath?.trim() || ''
  if (value.kind === 'images') {
    const item = value.items.find((i) => i.relativePath?.trim())
    return item?.relativePath?.trim() || ''
  }
  return ''
}

const boundaryImagePath = computed(() => {
  if (!isImageBoundary.value) return ''
  void graphEditorHosts.revision.value
  void props.runState?.status
  void props.runState?.outputs?.out
  const local = props.node.params.previewRelativePath?.trim()
  if (local) return local
  const fromRun = mediaPathFromValue(props.runState?.outputs?.out as GraphValue | undefined)
  if (fromRun) return fromRun
  // 边界输入：读 params 注入；边界输出：soft 上游
  if (isBoundaryInputNode(props.node)) {
    return mediaPathFromValue(softResolveBoundaryInputParams(props.node))
  }
  if (!props.hostId) return ''
  const base = graphEditorHosts.getDocument(props.hostId)
  if (!base) return ''
  const liveStates = graphRunHosts.get(props.hostId)?.runStates
  const doc: GraphDocument = liveStates
    ? { ...base, runStates: { ...(base.runStates ?? {}), ...liveStates } }
    : base
  const soft = softResolveBoundaryOutputValue(doc, props.node.id)
  return graphValueHasPayload(soft) ? mediaPathFromValue(soft) : ''
})

/**
 * 输入接口：默认折叠。
 * 图片边界输出：有可预览图时默认展开；用户折叠后保留折叠。
 */
const previewCollapsed = computed(() => {
  if (isImageBoundary.value) {
    if (!boundaryImagePath.value) return true
    const hasLocalPreview = !!props.node.params.previewRelativePath?.trim()
    return hasLocalPreview && props.node.params.previewCollapsed === true
  }
  if (isInputSlot.value || isBoundary.value) {
    return props.node.params.previewCollapsed !== false
  }
  return false
})

function togglePreviewCollapsed(): void {
  if (!props.hostId || (!isInputSlot.value && !isBoundary.value)) return
  const nextCollapsed = !previewCollapsed.value
  const patch: Record<string, unknown> = { previewCollapsed: nextCollapsed }
  // 折叠/展开时把 soft-resolve 到的路径落盘，便于记住折叠态
  if (isImageBoundary.value && boundaryImagePath.value) {
    patch.previewRelativePath = boundaryImagePath.value
  }
  graphEditorHosts.updateNode(props.hostId, props.node.id, patch)
}

const mediaPreviewUrl = ref('')
let mediaPreviewCancel: (() => void) | null = null
watch(
  () => [boundaryImagePath.value, previewCollapsed.value] as const,
  async ([path, collapsed]) => {
    mediaPreviewCancel?.()
    mediaPreviewCancel = null
    if (collapsed || !path) {
      mediaPreviewUrl.value = ''
      return
    }
    const { promise, cancel } = graphPreviewLoadScheduler.enqueue(0, () =>
      resolveAssetPreviewUrl(path)
    )
    mediaPreviewCancel = cancel
    try {
      mediaPreviewUrl.value = await promise
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      mediaPreviewUrl.value = ''
    }
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  mediaPreviewCancel?.()
  mediaPreviewCancel = null
})

function toggleLock(): void {
  if (!props.hostId || !canLock.value) return
  graphEditorHosts.updateNode(props.hostId, props.node.id, {
    locked: !isLocked.value
  })
}

const presentation = computed(() => resolveNodeType(props.node)?.presentation)
const badgeLabel = computed(() => {
  if (isInputSlot.value) {
    const byType = `graph.inputInterface.badgeByType.${slotDataType.value}`
    if (te(byType)) return t(byType)
    const portType = `graph.port.types.${slotDataType.value}`
    if (te(portType)) return t(portType)
    return t('graph.inputInterface.badge')
  }
  return presentation.value?.badgeKey ? t(presentation.value.badgeKey) : t('graph.note.badge')
})
const editingTitle = ref(false)
const titleDraft = ref('')
const titleInputEl = ref<HTMLInputElement | null>(null)

const displayTitle = computed(() => {
  const custom = props.node.title?.trim()
  if (custom) return custom
  const key = presentation.value?.defaultTitleKey
  return key ? t(key) : t('graph.note.title')
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

const displayText = computed(() => {
  if (isInputSlot.value) {
    const text = props.node.params.text?.trim()
    if (text) return text
    const path = props.node.params.previewRelativePath?.trim()
    if (path) return path
    const byType = `graph.inputInterface.placeholderByType.${slotDataType.value}`
    if (te(byType)) return t(byType)
    return t('graph.inputInterface.placeholder')
  }
  if (isImageBoundary.value) {
    return boundaryImagePath.value || t('graph.inspector.boundary.previewEmpty')
  }
  if (isBoundary.value) {
    return t('graph.inspector.boundary.previewEmpty')
  }
  const text = props.node.params.text?.trim()
  if (text) return text
  const key = presentation.value?.textPlaceholderKey
  return key ? t(key) : t('graph.note.placeholder')
})

watch(
  () => props.selected,
  (on) => {
    if (!on) editingTitle.value = false
  }
)

function startTitleEdit(): void {
  titleDraft.value = props.node.title?.trim() || displayTitle.value
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
  const prev = props.node.title?.trim() ?? ''
  if (next === prev) return
  emit('titleChange', props.node.id, next)
}

function cancelTitleEdit(): void {
  editingTitle.value = false
  titleDraft.value = props.node.title?.trim() || displayTitle.value
}

function onPointerDown(e: PointerEvent): void {
  if (editingTitle.value) return
  emit('dragStart', props.node.id, e)
}

function onResizeStart(e: PointerEvent): void {
  emit('resizeStart', props.node.id, e)
}

function onOutPortDown(portId: string, e: PointerEvent): void {
  emit('outPortDown', props.node.id, portId, e)
}

function onInPortDown(portId: string, e: PointerEvent): void {
  emit('inPortDown', props.node.id, portId, e)
}

function onBodyDblClick(): void {
  // 输入接口 / 边界代理只读，不打开记事本
  if (isInputSlot.value || isBoundary.value) return
  emit('textOpen', props.node.id)
}
</script>

<style scoped>
.graph-note {
  --slot-accent: #c9a227;
  --slot-accent-soft: rgba(201, 162, 39, 0.2);
  --slot-border: #5a4a28;
  --slot-port: #8ab4d8;
  position: absolute;
  border: 1px solid var(--slot-border);
  border-radius: 8px;
  background: linear-gradient(
    160deg,
    var(--graph-note-bg-from) 0%,
    var(--graph-note-bg-to) 100%
  );
  box-shadow: 0 4px 14px var(--shadow);
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
  z-index: 8;
}

.graph-note:active {
  cursor: grabbing;
}

.graph-note.selected {
  border-color: var(--slot-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--slot-accent) 50%, transparent),
    0 6px 18px color-mix(in srgb, var(--slot-accent) 18%, transparent);
  z-index: 18;
}

/* 输入接口：按数据类型着色（非备注黄） */
.graph-note.input-slot.slot-text {
  --slot-accent: #5eb0e0;
  --slot-accent-soft: rgba(94, 176, 224, 0.22);
  --slot-border: #3a6a88;
  --slot-port: #5eb0e0;
}

.graph-note.input-slot.slot-image {
  --slot-accent: #6bcf8e;
  --slot-accent-soft: rgba(107, 207, 142, 0.22);
  --slot-border: #3d7a55;
  --slot-port: #6bcf8e;
}

.graph-note.input-slot.slot-voice {
  --slot-accent: #e09a5a;
  --slot-accent-soft: rgba(224, 154, 90, 0.22);
  --slot-border: #8a5a30;
  --slot-port: #e09a5a;
}

.graph-note.input-slot.slot-video {
  --slot-accent: #a78bfa;
  --slot-accent-soft: rgba(167, 139, 250, 0.22);
  --slot-border: #5a4a88;
  --slot-port: #a78bfa;
}

.graph-note.input-slot.slot-model {
  --slot-accent: #94a3b8;
  --slot-accent-soft: rgba(148, 163, 184, 0.22);
  --slot-border: #4a5568;
  --slot-port: #94a3b8;
}

.note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--slot-border) 40%, transparent);
  min-width: 0;
  flex-shrink: 0;
}

.graph-note.preview-collapsed .note-head {
  border-bottom: none;
  border-radius: 8px;
  height: 100%;
  box-sizing: border-box;
}

.collapse-tri-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  margin: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  cursor: pointer;
  color: var(--text-muted);
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
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
}

.collapse-tri-btn.collapsed .collapse-tri {
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 5px solid currentColor;
  border-right: none;
}

.type-pill {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--slot-accent-soft);
  color: var(--slot-accent);
  flex-shrink: 0;
}

.type-pill.lock {
  background: color-mix(in srgb, #c4a35a 28%, transparent);
  color: #e6cf8a;
}

.graph-note.lock-node {
  border-color: color-mix(in srgb, #c4a35a 55%, var(--slot-border));
}

.head-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
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

.title {
  font-size: 11px;
  color: var(--graph-note-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
  min-width: 0;
}

.title-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid color-mix(in srgb, var(--slot-accent) 40%, transparent);
  border-radius: 4px;
  background: var(--graph-note-preview-bg);
  color: var(--graph-note-text);
}

.title-input:focus {
  outline: none;
  border-color: var(--slot-accent);
}

.run-pill {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
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

.note-content {
  flex: 1;
  min-height: 0;
  padding: 6px 8px 8px;
  display: flex;
  overflow: hidden;
  border-radius: 0 0 8px 8px;
}

.note-content.has-media {
  padding: 0;
  background: #0a0a0c;
}

.note-media-preview {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  pointer-events: none;
  user-select: none;
}

.note-body {
  flex: 1;
  min-height: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--graph-note-text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

:deep(.resize-handle) {
  z-index: 50;
}

.port-wrap {
  position: absolute;
  width: 0;
  height: 0;
  z-index: 30;
  pointer-events: none;
}

.port-wrap.in {
  left: 0;
}

.port-wrap.out {
  right: 0;
}

.port-wrap.in .port-type,
.port-wrap.out .port-type {
  position: absolute;
  left: 0;
  top: 0;
  font-size: 9px;
  line-height: 1;
  color: var(--slot-port);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
}

.port-wrap.in .port-type {
  transform: translate(calc(-100% - 8px), calc(-100% - 4px));
  text-align: right;
}

.port-wrap.out .port-type {
  transform: translate(8px, calc(-100% - 4px));
  text-align: left;
}

.port {
  position: absolute;
  top: 0;
  left: 0;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid var(--slot-port);
  border-radius: 50%;
  background: var(--graph-port-bg);
  cursor: crosshair;
  pointer-events: auto;
  transform: translate(-50%, -50%);
}

.port.in {
  border-color: #ffb347;
  background: var(--graph-port-in-bg, var(--graph-port-bg));
}

.port:hover {
  background: var(--slot-port);
  border-color: color-mix(in srgb, var(--slot-port) 60%, white);
}

.port.in:hover {
  background: #ffb347;
  border-color: color-mix(in srgb, #ffb347 60%, white);
}
</style>
