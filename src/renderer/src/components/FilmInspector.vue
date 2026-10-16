<template>
  <div v-if="node" class="node-inspector film-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
      <button type="button" class="workbench-btn" @click="openWorkbench">
        {{ t('graph.inspector.film.openWorkbench') }}
      </button>
    </div>
    <p class="hint">
      {{ t(`graph.inspector.film.hint.${kind}`) }}
    </p>
    <p class="hint">
      {{ t('graph.inspector.film.openWorkbenchHint') }}
    </p>

    <label>
      {{ t('graph.inspector.displayName') }}
      <input v-model="displayName" type="text" @change="persistTitle" />
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
      <GraphNodeOutputPreview v-if="hostId" :node="node" :host-id="hostId" />
      <GraphNodeOutputPreview
        v-if="hostId && (kind === 'cast' || kind === 'workbench')"
        :node="node"
        :host-id="hostId"
        port-id="out-sheets"
      />
      <GraphNodeOutputPreview
        v-if="hostId && (kind === 'render' || kind === 'workbench')"
        :node="node"
        :host-id="hostId"
        port-id="out-images"
      />
      <GraphNodeOutputPreview
        v-if="hostId && (kind === 'render' || kind === 'workbench')"
        :node="node"
        :host-id="hostId"
        port-id="out-videos"
      />
    </section>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { isFilmNodeTypeId, type GraphNode } from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { useWorkspaceStore } from '../stores/workspace'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

type FilmKind = 'workbench' | 'breakdown' | 'review' | 'cast' | 'shot' | 'render'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()
const workspace = useWorkspaceStore()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current && isFilmNodeTypeId(current.typeId) ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const kind = computed(
  (): FilmKind => (node.value?.typeId?.slice('film.'.length) ?? 'breakdown') as FilmKind
)
const typeLabel = computed(() => (node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''))
const displayTitle = useNodeDisplayTitle(node, typeLabel)
const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

function openWorkbench(): void {
  const current = node.value
  const rootKey = workspace.activeDiveRootKey?.trim()
  if (!rootKey || !hostId.value || !current) return
  workspace.diveIntoView(
    rootKey,
    {
      viewId: 'film.workbench',
      hostId: hostId.value,
      nodeId: current.id
    },
    displayTitle.value
  )
}

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
  if (!current || !hostId.value) return
  graphEditorHosts.updateNode(hostId.value, current.id, {}, displayName.value)
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
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.head h2 {
  margin: 0;
  font-size: 14px;
}
.workbench-btn {
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  color: var(--accent);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.45;
}
label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
input[type='text'] {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 12px;
  font-family: inherit;
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
