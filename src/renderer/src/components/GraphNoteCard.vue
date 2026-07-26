<template>
  <div
    class="graph-note"
    :class="{ selected }"
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
      <span class="type-pill">{{ badgeLabel }}</span>
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
      <span
        v-if="runStatus && runStatus !== 'idle' && runStatus !== 'skipped'"
        class="run-pill"
        :class="runStatus"
        :title="runError || runStatusLabel"
      >
        {{ runStatusLabel }}
      </span>
    </div>

    <div class="note-content">
      <div class="note-body">{{ displayText }}</div>
    </div>

    <GraphNodeResizeHandle @resize-start="onResizeStart" />

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
import { computed, nextTick, ref, watch } from 'vue'
import GraphNodeResizeHandle from './GraphNodeResizeHandle.vue'
import { getNodePorts, getNodeSize, resolveNodeType, type GraphNode, type GraphNodeRunStatus, type GraphPortDataType } from '@shared/graph'
import { useStudioI18n } from '../composables/useStudioI18n'

const { t } = useStudioI18n()

const props = defineProps<{
  node: GraphNode
  selected: boolean
  runStatus?: GraphNodeRunStatus
  runError?: string
}>()

const emit = defineEmits<{
  dragStart: [nodeId: string, event: PointerEvent]
  textOpen: [nodeId: string]
  titleChange: [nodeId: string, title: string]
  resizeStart: [nodeId: string, event: PointerEvent]
  outPortDown: [nodeId: string, portId: string, event: PointerEvent]
}>()

const nodeSize = computed(() => getNodeSize(props.node))
const nodePorts = computed(() => getNodePorts(props.node))
const outPorts = computed(() => nodePorts.value.filter((p) => p.direction === 'out'))

function portTypeLabel(dataType: GraphPortDataType): string {
  return t(`graph.port.types.${dataType}`)
}

function portWrapStyle(count: number, index: number): Record<string, string> {
  const pct = ((index + 1) / (count + 1)) * 100
  return { top: `${pct}%` }
}

const width = computed(() => nodeSize.value.w)
const height = computed(() => nodeSize.value.h)
const presentation = computed(() => resolveNodeType(props.node)?.presentation)
const badgeLabel = computed(() =>
  presentation.value?.badgeKey ? t(presentation.value.badgeKey) : t('graph.note.badge')
)
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

function onBodyDblClick(): void {
  emit('textOpen', props.node.id)
}
</script>

<style scoped>
.graph-note {
  position: absolute;
  border: 1px solid #5a4a28;
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
  border-color: #c9a227;
  box-shadow: 0 0 0 1px #c9a22788, 0 6px 18px rgba(201, 162, 39, 0.15);
  z-index: 18;
}

.note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid #5a4a2844;
  min-width: 0;
  flex-shrink: 0;
}

.type-pill {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(201, 162, 39, 0.2);
  color: #e8c547;
  flex-shrink: 0;
}

.title {
  font-size: 11px;
  color: var(--graph-note-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.title-input {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  padding: 1px 4px;
  border: 1px solid #c9a22766;
  border-radius: 4px;
  background: var(--graph-note-preview-bg);
  color: var(--graph-note-text);
}

.title-input:focus {
  outline: none;
  border-color: #c9a227;
}

.run-pill {
  margin-left: auto;
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

.port-wrap.out {
  right: 0;
}

.port-type {
  position: absolute;
  top: 0;
  left: 10px;
  font-size: 9px;
  line-height: 1;
  color: var(--text-muted);
  white-space: nowrap;
  pointer-events: none;
  user-select: none;
  transform: translateY(-50%);
}

.port {
  position: absolute;
  top: 0;
  left: 0;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid #8ab4d8;
  border-radius: 50%;
  background: var(--graph-port-bg);
  cursor: crosshair;
  pointer-events: auto;
  transform: translate(-50%, -50%);
}

.port:hover {
  background: #5ec8ff;
  border-color: #c8f6ff;
}
</style>
