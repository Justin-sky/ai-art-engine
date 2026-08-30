<template>
  <div
    class="graph-demo-card"
    :class="{ selected, editing }"
    :data-node-id="node.id"
    :style="{
      left: `${node.position.x}px`,
      top: `${node.position.y}px`,
      width: `${width}px`,
      height: `${height}px`
    }"
    @pointerdown.stop="onPointerDown"
    @dblclick.stop="startEdit"
  >
    <div class="demo-head">
      <span class="type-pill">{{ t('graph.demo.badge') }}</span>
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
      >
      <span
        v-else
        class="title"
        :title="displayTitle"
        @dblclick.stop="startTitleEdit"
      >{{ displayTitle }}</span>
    </div>

    <div class="demo-content">
      <textarea
        v-if="editing"
        ref="inputEl"
        v-model="draft"
        class="demo-input"
        @pointerdown.stop
        @blur="commitEdit"
        @keydown.esc.prevent="cancelEdit"
        @keydown.enter.ctrl.prevent="commitEdit"
      />
      <div
        v-else
        class="demo-body"
      >
        {{ displayText }}
      </div>
    </div>

    <GraphNodeResizeHandle
      v-if="!editing"
      @resize-start="onResizeStart"
    />

    <button
      v-for="(port, index) in outPorts"
      :key="port.id"
      type="button"
      class="port out"
      :data-port-id="port.id"
      :title="t('graph.port.outTitle')"
      :style="{ top: `${((index + 1) / (outPorts.length + 1)) * 100}%` }"
      @pointerdown.stop.prevent="onOutPortDown(port.id, $event)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import GraphNodeResizeHandle from '../../../components/GraphNodeResizeHandle.vue'
import { getNodePorts, getNodeSize, type GraphNode } from '@shared/graph'
import { useStudioI18n } from '../../../composables/useStudioI18n'
import { resolveGraphNodeDisplayTitle } from '../../../features/graph/model/graphNodeDisplayTitle'

const { t, graphTypeLabel } = useStudioI18n()

const props = defineProps<{
  node: GraphNode
  selected: boolean
}>()

const emit = defineEmits<{
  dragStart: [nodeId: string, event: PointerEvent]
  textChange: [nodeId: string, text: string]
  titleChange: [nodeId: string, title: string]
  resizeStart: [nodeId: string, event: PointerEvent]
  outPortDown: [nodeId: string, portId: string, event: PointerEvent]
}>()

const nodeSize = computed(() => getNodeSize(props.node))
const nodePorts = computed(() => getNodePorts(props.node))
const outPorts = computed(() => nodePorts.value.filter((port) => port.direction === 'out'))
const width = computed(() => nodeSize.value.w)
const height = computed(() => nodeSize.value.h)

const editing = ref(false)
const editingTitle = ref(false)
const draft = ref('')
const titleDraft = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const titleInputEl = ref<HTMLInputElement | null>(null)

const displayTitle = computed(() => {
  const custom = props.node.title?.trim()
  if (custom) {
    return resolveGraphNodeDisplayTitle(props.node, {
      scope: undefined,
      t,
      graphTypeLabel
    })
  }
  return t('graph.demo.title')
})
const displayText = computed(() => props.node.params.text?.trim() || t('graph.demo.placeholder'))

watch(
  () => props.selected,
  (on) => {
    if (!on) {
      editing.value = false
      editingTitle.value = false
    }
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

function onPointerDown(event: PointerEvent): void {
  if (editing.value || editingTitle.value) return
  emit('dragStart', props.node.id, event)
}

function onResizeStart(event: PointerEvent): void {
  emit('resizeStart', props.node.id, event)
}

function onOutPortDown(portId: string, event: PointerEvent): void {
  emit('outPortDown', props.node.id, portId, event)
}

function startEdit(): void {
  draft.value = props.node.params.text ?? ''
  editing.value = true
  void nextTick(() => {
    inputEl.value?.focus()
    inputEl.value?.select()
  })
}

function commitEdit(): void {
  if (!editing.value) return
  editing.value = false
  const text = draft.value.trim() || t('graph.demo.placeholder')
  if (text !== props.node.params.text) {
    emit('textChange', props.node.id, text)
  }
}

function cancelEdit(): void {
  editing.value = false
  draft.value = props.node.params.text ?? ''
}
</script>

<style scoped>
.graph-demo-card {
  position: absolute;
  border: 1px solid #3d5a80;
  border-radius: 10px;
  background: linear-gradient(160deg, #1a2438 0%, #121a28 100%);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  overflow: visible;
  box-sizing: border-box;
  cursor: grab;
  user-select: none;
  z-index: 8;
}

.graph-demo-card:active {
  cursor: grabbing;
}

.graph-demo-card.selected {
  border-color: #6ec8ff;
  box-shadow: 0 0 0 1px #6ec8ff88, 0 6px 18px rgba(110, 200, 255, 0.18);
  z-index: 18;
}

.graph-demo-card.editing {
  z-index: 22;
  cursor: text;
}

.demo-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--accent-45);
  min-width: 0;
  flex-shrink: 0;
}

.type-pill {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--accent-18);
  color: var(--accent-fg);
  flex-shrink: 0;
}

.title {
  font-size: 11px;
  color: var(--text-muted);
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
  border: 1px solid var(--accent-45);
  border-radius: 4px;
  background: var(--bg-input);
  color: var(--text);
}

.title-input:focus {
  outline: none;
  border-color: var(--accent);
}

.demo-content {
  flex: 1;
  min-height: 0;
  padding: 6px 8px 8px;
  display: flex;
  overflow: hidden;
  border-radius: 0 0 10px 10px;
}

.demo-body {
  flex: 1;
  min-height: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow: auto;
}

.demo-input {
  flex: 1;
  min-height: 0;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--accent-45);
  border-radius: 6px;
  background: var(--bg-input);
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
  resize: none;
  box-sizing: border-box;
  font-family: inherit;
  overflow: auto;
}

.demo-input:focus {
  outline: none;
  border-color: var(--accent);
}

:deep(.resize-handle) {
  z-index: 50;
}

.port {
  position: absolute;
  width: 12px;
  height: 12px;
  padding: 0;
  border: 2px solid var(--accent);
  border-radius: 50%;
  background: var(--graph-port-bg);
  cursor: crosshair;
  z-index: 30;
}

.port.out {
  right: 0;
  transform: translate(50%, -50%);
}

.port:hover {
  background: var(--accent-fg);
  border-color: var(--accent-hover);
}
</style>
