<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">
      {{ hint }}
    </p>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input
        v-model="displayName"
        type="text"
        @change="persistTitle"
      >
    </label>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <section class="output-section">
      <h3>{{ t('graph.inspector.outputPreview') }}</h3>
      <GraphNodeOutputPreview
        v-if="hostId"
        :node="node"
        :host-id="hostId"
      />
    </section>
  </div>
  <div
    v-else
    class="node-inspector empty"
  >
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  isSelectImageNode,
  isSelectBeatNode,
  isSelectTextNode,
  isSelectVideoNode,
  isSelectVoiceNode,
  type GraphNode
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const SELECT_TYPE_IDS = new Set([
  'image.select',
  'video.select',
  'voice.select',
  'text.select',
  'beat.select'
])

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current || !current.typeId || !SELECT_TYPE_IDS.has(current.typeId)) return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''
)

const hint = computed(() => {
  const current = node.value
  if (!current) return ''
  if (isSelectImageNode(current)) return t('graph.selectImage.hint')
  if (isSelectVideoNode(current)) return t('graph.selectVideo.hint')
  if (isSelectVoiceNode(current)) return t('graph.selectVoice.hint')
  if (isSelectTextNode(current)) return t('graph.selectText.hint')
  if (isSelectBeatNode(current)) return t('graph.selectBeat.hint')
  return t('graph.inspector.select.hint')
})

const displayName = ref('')

watch(
  node,
  (current) => {
    displayName.value = current?.title?.trim() || ''
  },
  { immediate: true }
)

function persistTitle(): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, {}, displayName.value)
  graphEditorHosts.bumpRevision()
}
</script>

<style scoped>
.node-inspector {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  height: 100%;
  overflow: auto;
}

.node-inspector.empty {
  color: var(--text-muted);
  align-items: center;
  justify-content: center;
}

.head h2 {
  margin: 0;
  font-size: 14px;
}

.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

input {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 13px;
}

.output-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.output-section h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}
</style>
