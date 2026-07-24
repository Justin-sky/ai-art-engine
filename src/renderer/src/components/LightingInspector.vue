<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <span class="type">{{ typeLabel }}</span>
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.lighting.hint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <label>
      {{ t('graph.lighting.outputPrompt') }}
      <textarea class="prompt-view" :value="outputPrompt || emptyPrompt" rows="8" readonly />
    </label>
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  readLightingSetupFromNode,
  resolveLightingOutputPrompt,
  textFromGraphValue
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../features/graph/model/graphRunHosts'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.lighting' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('image.lighting'))
const emptyPrompt = computed(() => t('graph.lighting.promptEmpty'))

const outputPrompt = computed(() => {
  const current = node.value
  if (!current) return ''
  const live = textFromGraphValue(
    graphRunHosts.get(hostId.value)?.runStates?.[current.id]?.outputs?.out
  )
  if (live.trim()) return live.trim()
  const cached = current.params.lightingPrompt?.trim()
  if (cached) return cached
  return resolveLightingOutputPrompt(readLightingSetupFromNode(current.params))
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

.head .type {
  font-size: 11px;
  color: var(--text-muted);
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

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
  flex: 1 1 auto;
  min-height: 0;
}

.prompt-view {
  flex: 1 1 auto;
  min-height: 160px;
  opacity: 0.9;
  cursor: default;
  background: var(--bg-elevated, #1a1d22);
  color: var(--text, #e8eaed);
  border: 1px solid var(--border, #333);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  resize: vertical;
  font-family: inherit;
}
</style>
