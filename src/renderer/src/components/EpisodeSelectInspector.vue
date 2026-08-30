<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ displayTitle }}</h2>
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

    <section
      v-if="isAnchorSelect"
      class="select-section"
    >
      <h3>{{ t('graph.inspector.episode.anchorLabel') }}</h3>
      <div class="grid-buttons">
        <button
          v-for="n in 9"
          :key="n"
          type="button"
          class="pick-btn"
          :class="{ active: anchorIndex === n }"
          @click="setAnchorIndex(n)"
        >
          {{ n }}
        </button>
      </div>
    </section>

    <template v-else>
      <section class="select-section">
        <h3>{{ t('graph.inspector.episode.groupLabel') }}</h3>
        <div class="grid-buttons">
          <button
            v-for="g in 9"
            :key="g"
            type="button"
            class="pick-btn"
            :class="{ active: cellGroupIndex === g }"
            @click="setGroup(g)"
          >
            {{ g }}
          </button>
        </div>
      </section>
      <section class="select-section">
        <h3>{{ t('graph.inspector.episode.cellLabel') }}</h3>
        <div class="grid-buttons">
          <button
            v-for="c in 4"
            :key="c"
            type="button"
            class="pick-btn"
            :class="{ active: cellIndex === c }"
            @click="setCell(c)"
          >
            {{ c }}
          </button>
        </div>
      </section>
    </template>

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
import type { GraphNode } from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const EPISODE_SELECT_TYPE_IDS = new Set(['episode.anchorSelect', 'episode.cellSelect'])

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed((): GraphNode | null => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  if (!current || !current.typeId || !EPISODE_SELECT_TYPE_IDS.has(current.typeId)) return null
  return current
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const isAnchorSelect = computed(() => node.value?.typeId === 'episode.anchorSelect')
const anchorIndex = computed(() => Number(node.value?.params?.anchorIndex ?? 1))
const cellGroupIndex = computed(() => Number(node.value?.params?.cellGroupIndex ?? 1))
const cellIndex = computed(() => Number(node.value?.params?.cellIndex ?? 1))

const typeLabel = computed(() =>
  node.value?.typeId ? graphTypeLabel(node.value.typeId) : ''
)
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const hint = computed(() =>
  isAnchorSelect.value
    ? t('graph.inspector.episode.anchorHint')
    : t('graph.inspector.episode.cellHint')
)

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

function patchParams(params: Partial<GraphNode['params']>): void {
  const current = node.value
  const hid = hostId.value
  if (!current || !hid) return
  graphEditorHosts.updateNode(hid, current.id, params)
}

function setAnchorIndex(n: number): void {
  if (anchorIndex.value === n) return
  patchParams({ anchorIndex: n })
}

function setGroup(g: number): void {
  if (cellGroupIndex.value === g) return
  patchParams({ cellGroupIndex: g })
}

function setCell(c: number): void {
  if (cellIndex.value === c) return
  patchParams({ cellIndex: c })
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

.select-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.select-section h3 {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
}

.grid-buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pick-btn {
  width: 34px;
  height: 30px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--text);
  font-size: 12px;
  cursor: pointer;
}

.pick-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.pick-btn.active {
  border-color: var(--accent);
  color: var(--accent-fg);
  background: var(--accent);
  font-weight: 700;
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
