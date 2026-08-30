<template>
  <div
    v-if="node"
    class="note-inspector"
  >
    <div class="head">
      <span
        class="type"
        :class="typeToneClass"
      >{{ typeLabel }}</span>
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ hintText }}
    </p>

    <template v-if="isBoundary">
      <div class="meta-row">
        <span class="meta-label">{{ t('graph.inspector.boundary.dataType') }}</span>
        <span
          class="meta-value type-chip"
          :class="typeToneClass"
        >{{ dataTypeLabel }}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">{{ t('graph.inspector.boundary.port') }}</span>
        <span class="meta-value mono">{{ boundaryPortId }}</span>
      </div>

      <label>
        {{ t('graph.inspector.note.title') }}
        <input
          v-model="localTitle"
          @change="persistTitleOnly"
        >
      </label>

      <section class="preview-section">
        <div class="preview-label">
          {{ t('graph.inspector.boundary.preview') }}
        </div>
        <GraphNodeOutputPreview
          v-if="hostId"
          :node="node"
          :host-id="hostId"
        />
      </section>
    </template>

    <template v-else-if="isInputSlot">
      <div class="meta-row">
        <span class="meta-label">{{ t('graph.inspector.inputInterface.dataType') }}</span>
        <span
          class="meta-value type-chip"
          :class="`slot-${slotDataType}`"
        >{{ dataTypeLabel }}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">{{ t('graph.inspector.inputInterface.port') }}</span>
        <span class="meta-value mono">{{ slotBinding?.portId ?? '—' }}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">{{ t('graph.inspector.inputInterface.index') }}</span>
        <span class="meta-value mono">{{ slotIndexDisplay }}</span>
      </div>

      <label>
        {{ t('graph.inspector.note.title') }}
        <input
          v-model="localTitle"
          @change="persistTitleOnly"
        >
      </label>

      <div class="preview-block">
        <div class="preview-label">
          {{ t('graph.inspector.inputInterface.preview') }}
        </div>
        <pre class="preview-body">{{ previewText }}</pre>
      </div>
    </template>

    <template v-else>
      <label>
        {{ t('graph.inspector.note.title') }}
        <input
          v-model="localTitle"
          @change="persist"
        >
      </label>

      <label>
        {{ bodyLabel }}
        <ExpandableTextarea
          :key="`${node.id}-body`"
          v-model="localText"
          :title="bodyLabel"
          :rows="8"
          :placeholder="bodyPlaceholder"
          @change="persist"
        />
      </label>
    </template>
  </div>
  <div
    v-else
    class="note-inspector empty"
  >
    {{ emptyText }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  GRAPH_INPUT_SLOT_TYPE_ID,
  GraphPortType,
  isBoundaryInputNode,
  isBoundaryOutputNode,
  isBoundaryProxyNode,
  readHostInputSlot,
  type GraphPortDataType
} from '@shared/graph'

const { t } = useStudioI18n()
const editor = useEditorKernel()

const localTitle = ref('')
const localText = ref('')

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const n = graphEditorHosts.getNode(selection.hostId, id)
  return n?.category === 'note' ? n : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const isTextNode = computed(() => node.value?.typeId === 'play.script')
const isInputSlot = computed(() => node.value?.typeId === GRAPH_INPUT_SLOT_TYPE_ID)
const isBoundary = computed(() => !!node.value && isBoundaryProxyNode(node.value))
const isBoundaryInput = computed(() => !!node.value && isBoundaryInputNode(node.value))
const isBoundaryOutput = computed(() => !!node.value && isBoundaryOutputNode(node.value))

const slotBinding = computed(() => (node.value ? readHostInputSlot(node.value) : null))
const boundaryPort = computed(() => node.value?.params.hostBoundaryPort ?? null)

const slotDataType = computed<GraphPortDataType>(() => slotBinding.value?.dataType ?? 'text')
const boundaryDataType = computed<GraphPortDataType>(
  () => boundaryPort.value?.dataType ?? GraphPortType.text
)

const previewToneType = computed(() => {
  if (isBoundary.value) return previewToneFromPort(boundaryDataType.value)
  if (isInputSlot.value) return previewToneFromPort(slotDataType.value)
  return 'text'
})

const typeToneClass = computed(() => `slot-${previewToneType.value}`)

const typeLabel = computed(() => {
  if (isBoundaryInput.value) return t('graph.boundaryInput.badge')
  if (isBoundaryOutput.value) return t('graph.boundaryOutput.badge')
  if (isInputSlot.value) return t('graph.inputInterface.badge')
  return isTextNode.value ? t('graph.scriptNode.title') : t('graph.note.title')
})
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const hintText = computed(() => {
  if (isBoundaryInput.value) return t('graph.inspector.boundary.hintInput')
  if (isBoundaryOutput.value) return t('graph.inspector.boundary.hintOutput')
  if (isInputSlot.value) return t('graph.inspector.inputInterface.hint')
  return isTextNode.value ? t('graph.inspector.script.hint') : t('graph.inspector.note.hint')
})

const bodyLabel = computed(() =>
  isTextNode.value ? t('graph.inspector.script.body') : t('graph.inspector.note.body')
)

const bodyPlaceholder = computed(() =>
  isTextNode.value
    ? t('graph.scriptNode.placeholder')
    : t('graph.note.placeholder')
)

const emptyText = computed(() => {
  if (isBoundary.value) return t('graph.inspector.boundary.empty')
  if (isInputSlot.value) return t('graph.inspector.inputInterface.empty')
  return isTextNode.value ? t('graph.inspector.script.empty') : t('graph.inspector.note.empty')
})

const dataTypeLabel = computed(() => {
  const type = isBoundary.value ? boundaryDataType.value : slotDataType.value
  return t(`graph.port.types.${type}`)
})

const boundaryPortId = computed(() => boundaryPort.value?.portId?.trim() || '—')

const slotIndexDisplay = computed(() => {
  const index = slotBinding.value?.index
  return typeof index === 'number' ? String(index + 1) : '—'
})

const previewText = computed(() => {
  const n = node.value
  if (!n) return t('graph.inspector.inputInterface.previewEmpty')
  const text = n.params.text?.trim()
  if (text) return text
  const path = n.params.previewRelativePath?.trim()
  if (path) return path
  const url = n.params.previewDataUrl?.trim()
  if (url) return t('graph.inspector.inputInterface.previewEmbedded')
  return t('graph.inspector.inputInterface.previewEmpty')
})

function previewToneFromPort(dataType: GraphPortDataType): 'text' | 'image' | 'voice' | 'video' {
  if (dataType === GraphPortType.image || dataType === GraphPortType.images) return 'image'
  if (dataType === GraphPortType.video || dataType === GraphPortType.videos) return 'video'
  if (dataType === GraphPortType.voice || dataType === GraphPortType.voices) return 'voice'
  return 'text'
}

watch(
  node,
  (n) => {
    if (!n) return
    localTitle.value = n.title ?? ''
    localText.value = n.params.text ?? ''
  },
  { immediate: true }
)

function persist(): void {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id || !node.value) return
  const fallback = isTextNode.value ? '…' : t('graph.note.draftPlaceholder')
  graphEditorHosts.updateNode(
    selection.hostId,
    id,
    { text: localText.value.trim() || fallback },
    localTitle.value
  )
}

function persistTitleOnly(): void {
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id || !node.value) return
  graphEditorHosts.updateNode(selection.hostId, id, {}, localTitle.value)
}
</script>

<style scoped>
.note-inspector {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.note-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head .type {
  font-size: 11px;
  color: var(--text-muted);
}

.head .type.slot-text {
  color: #5eb0e0;
}

.head .type.slot-image {
  color: #6bcf8e;
}

.head .type.slot-voice {
  color: #e09a5a;
}

.head .type.slot-video {
  color: #a78bfa;
}

.head h2 {
  margin: 4px 0 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.meta-label {
  color: var(--text-muted);
}

.meta-value.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--text);
}

.type-chip {
  font-size: 11px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
}

.type-chip.slot-text {
  background: rgba(94, 176, 224, 0.18);
  color: #5eb0e0;
}

.type-chip.slot-image {
  background: rgba(107, 207, 142, 0.18);
  color: #6bcf8e;
}

.type-chip.slot-voice {
  background: rgba(224, 154, 90, 0.18);
  color: #e09a5a;
}

.type-chip.slot-video {
  background: rgba(167, 139, 250, 0.18);
  color: #a78bfa;
}

.preview-section,
.preview-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.preview-label {
  font-size: 12px;
  color: var(--text-muted);
}

.preview-body {
  margin: 0;
  flex: 1;
  min-height: 120px;
  max-height: 360px;
  overflow: auto;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text);
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

input,
:deep(textarea) {
  font-size: 12px;
}
</style>
