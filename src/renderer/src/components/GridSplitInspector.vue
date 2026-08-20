<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.inspector.gridSplit.hint') }}
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

    <dl class="meta">
      <div>
        <dt>{{ t('graph.gridSplit.grid') }}</dt>
        <dd>{{ gridLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.gridSplit.selected') }}</dt>
        <dd>{{ selectedLabel }}</dd>
      </div>
    </dl>
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
import { readImageGridSplitFromNode } from '@shared/graph'
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
  return current?.typeId === 'image.gridSplit' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('image.gridSplit'))

const grid = computed(() =>
  node.value ? readImageGridSplitFromNode(node.value.params) : null
)

const gridLabel = computed(() => {
  const g = grid.value
  if (!g) return '—'
  return `${g.rows}×${g.cols}`
})

const selectedLabel = computed(() => {
  const g = grid.value
  if (!g) return '—'
  if (!g.selected.length) return t('graph.gridSplit.allCells')
  return g.selected.join(', ')
})
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
  word-break: break-all;
}
</style>
