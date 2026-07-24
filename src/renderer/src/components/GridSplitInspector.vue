<template>
  <div class="node-inspector" v-if="node">
    <div class="head">
      <h2>{{ node.title || typeLabel }}</h2>
    </div>
    <p class="hint">{{ t('graph.inspector.gridSplit.hint') }}</p>

    <GraphNodeRunControl
      v-if="hasInPort"
      :status="runStatus"
      :is-running="isGraphRunning"
      :blocked="blocked"
      @toggle="toggleRun"
    />

    <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

    <dl class="meta">
      <div>
        <dt>{{ t('graph.gridSplit.grid') }}</dt>
        <dd>{{ gridLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.gridSplit.selected') }}</dt>
        <dd>{{ selectedLabel }}</dd>
      </div>
      <div>
        <dt>{{ t('graph.gridSplit.scale') }}</dt>
        <dd>{{ scaleLabel }}</dd>
      </div>
    </dl>

    <label>
      {{ t('graph.gridSplit.systemPrompt') }}
      <ExpandableTextarea
        :key="`sys-${node.id}`"
        v-model="systemPrompt"
        :title="t('graph.gridSplit.systemPrompt')"
        :rows="4"
        :placeholder="t('graph.inspector.generate.systemPromptPlaceholder')"
        @change="persistSystemPrompt"
      />
    </label>
  </div>
  <div v-else class="node-inspector empty">{{ t('graph.inspector.node.empty') }}</div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_EN,
  DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_ZH,
  defaultGridSplitSystemPrompt,
  readImageGridSplitFromNode,
  resolveGridSplitSystemPrompt
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

const scaleLabel = computed(() => {
  const g = grid.value
  if (!g) return '—'
  return `${g.scale}×`
})

const systemPrompt = ref('')
const loadedNodeId = ref<string | null>(null)
const loadedHostId = ref<string | null>(null)

function loadSystemPrompt(current: NonNullable<typeof node.value>): void {
  loadedNodeId.value = current.id
  loadedHostId.value = hostId.value
  systemPrompt.value = resolveGridSplitSystemPrompt(
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
    cur === DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_EN ||
    cur === DEFAULT_GRID_SPLIT_SYSTEM_PROMPT_ZH
  ) {
    systemPrompt.value = defaultGridSplitSystemPrompt(String(next))
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
  color: var(--text, #e8eaed);
  text-align: right;
  word-break: break-all;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}
</style>
