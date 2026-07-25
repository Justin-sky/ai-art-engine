<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.matte.hint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <label>
      {{ t('graph.matte.systemPrompt') }}
      <ExpandableTextarea
        :key="`sys-${node.id}`"
        v-model="systemPrompt"
        :title="t('graph.matte.systemPrompt')"
        :rows="5"
        :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>

    <label>
      {{ t('graph.matte.mergedPrompt') }}
      <textarea class="prompt-view" :value="mergedPrompt || emptyPrompt" rows="6" readonly />
    </label>
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_MATTE_SYSTEM_PROMPT_EN,
  DEFAULT_MATTE_SYSTEM_PROMPT_ZH,
  buildMatteUserPrompt,
  defaultMatteSystemPrompt,
  readImageMatteFromNode,
  resolveMatteSystemPrompt
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import ExpandableTextarea from './ExpandableTextarea.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const { t, locale, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.matte' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('image.matte'))
const emptyPrompt = computed(() => t('graph.matte.promptEmpty'))
const systemPrompt = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

const mergedPrompt = computed(() => {
  const current = node.value
  if (!current) return ''
  return buildMatteUserPrompt(readImageMatteFromNode(current.params))
})

function loadSystemPrompt(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  systemPrompt.value = resolveMatteSystemPrompt(
    current.params.generateSystemPrompt,
    String(locale.value)
  )
}

watch(
  node,
  (current) => {
    if (!current) {
      systemPrompt.value = ''
      loadedNodeId.value = null
      loadedHostId.value = null
      return
    }
    const sameNode = current.id === loadedNodeId.value && hostId.value === loadedHostId.value
    if (!sameNode) loadSystemPrompt(current)
  },
  { immediate: true }
)

watch(locale, (next) => {
  if (!node.value) return
  const cur = systemPrompt.value.trim()
  if (
    !cur ||
    cur === DEFAULT_MATTE_SYSTEM_PROMPT_EN ||
    cur === DEFAULT_MATTE_SYSTEM_PROMPT_ZH
  ) {
    systemPrompt.value = defaultMatteSystemPrompt(String(next))
  }
})

function persistSystemPrompt(): void {
  if (!node.value) return
  const selection = editor.selection.current.value
  graphEditorHosts.updateNode(selection.hostId, node.value.id, {
    generateSystemPrompt: systemPrompt.value
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

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.prompt-view {
  min-height: 96px;
  opacity: 0.9;
  cursor: default;
  background: var(--bg-elevated);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.45;
  resize: vertical;
  font-family: inherit;
}
</style>
