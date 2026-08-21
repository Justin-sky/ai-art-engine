<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.layerSplit.hint') }}
    </p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview
      v-if="node && hostId"
      :node="node"
      :host-id="hostId"
    />

    <label>
      {{ t('graph.layerSplit.prompt') }}
      <textarea
        class="prompt"
        :value="state.prompt"
        rows="4"
        :placeholder="t('graph.layerSplit.promptPlaceholder')"
        @change="onPromptChange"
      />
    </label>

    <dl class="meta">
      <div>
        <dt>{{ t('graph.layerSplit.resolution') }}</dt>
        <dd>{{ state.resolution }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.layerSplit.layers') }}</dt>
        <dd>{{ state.layers.length || '—' }}</dd>
      </div>
      <div v-if="state.groups.length">
        <dt>{{ t('graph.layerSplit.group') }}</dt>
        <dd>{{ state.groups.length }}</dd>
      </div>
    </dl>

    <button
      v-if="state.layers.length"
      type="button"
      class="clear-btn"
      @click="clearLayers"
    >
      {{ t('graph.layerSplit.redecompose') }}
    </button>
  </div>
  <div
    v-else
    class="node-inspector empty"
  >
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  imageLayerSplitToNodePatch,
  readImageLayerSplitFromNode,
  type ImageLayerSplitState
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.layerSplit' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('image.layerSplit'))
const state = computed(() =>
  node.value ? readImageLayerSplitFromNode(node.value.params) : readImageLayerSplitFromNode({})
)

function persist(next: ImageLayerSplitState): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, imageLayerSplitToNodePatch(next))
}

function onPromptChange(event: Event): void {
  const value = (event.target as HTMLTextAreaElement).value
  persist({
    ...state.value,
    prompt: value
  })
}

function clearLayers(): void {
  persist({
    ...state.value,
    layers: [],
    groups: [],
    sourceFingerprint: '',
    canvasWidth: 0,
    canvasHeight: 0,
    selectedId: ''
  })
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

.prompt {
  display: block;
  width: 100%;
  margin-top: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg);
  color: var(--text);
  padding: 8px;
  font-size: 12px;
  resize: vertical;
}

.meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 12px;
}

.meta div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.meta dt {
  color: var(--text-muted);
}

.meta dd {
  margin: 0;
  color: var(--text);
  text-align: right;
}

.clear-btn {
  align-self: flex-start;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-hover);
  color: var(--text);
  padding: 7px 12px;
  font-size: 12px;
  cursor: pointer;
}
</style>
