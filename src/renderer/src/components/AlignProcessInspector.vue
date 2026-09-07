<template>
  <div v-if="node" class="node-inspector">
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.align.hint') }}
    </p>

    <section v-if="state" class="panel">
      <div class="field">
        <label>{{ t('graph.align.canvasWidth') }}</label>
        <input
          type="number"
          min="16"
          max="8192"
          step="16"
          :value="state.canvasWidth"
          @change="patchCanvas('canvasWidth', $event)"
        />
        <span class="unit">px</span>
      </div>
      <div class="field">
        <label>{{ t('graph.align.canvasHeight') }}</label>
        <input
          type="number"
          min="16"
          max="8192"
          step="16"
          :value="state.canvasHeight"
          @change="patchCanvas('canvasHeight', $event)"
        />
        <span class="unit">px</span>
      </div>
      <div class="field">
        <label>{{ t('graph.align.anchor') }}</label>
        <select :value="state.anchor" @change="patchAnchor($event)">
          <option value="center">{{ t('graph.align.anchorCenter') }}</option>
          <option value="ground">{{ t('graph.align.anchorGround') }}</option>
        </select>
      </div>
      <div class="field">
        <label>{{ t('graph.align.subjectHeight') }}</label>
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          :value="state.contentHeightRatio"
          @input="patchRatio('contentHeightRatio', $event)"
        />
        <span class="pct">{{ Math.round(state.contentHeightRatio * 100) }}%</span>
      </div>
      <div v-if="state.anchor === 'ground'" class="field">
        <label>{{ t('graph.align.groundGap') }}</label>
        <input
          type="range"
          min="0"
          max="0.5"
          step="0.01"
          :value="state.groundRatio"
          @input="patchRatio('groundRatio', $event)"
        />
        <span class="pct">{{ Math.round(state.groundRatio * 100) }}%</span>
      </div>
      <label class="check">
        <input
          type="checkbox"
          :checked="state.fitWithinWidth"
          @change="patchFit($event)"
        />
        {{ t('graph.align.fitWidth') }}
      </label>
      <p class="summary">{{ t('graph.align.output') }}：{{ state.canvasWidth }}×{{ state.canvasHeight }} · {{ state.anchor === 'ground' ? t('graph.align.anchorGround') : t('graph.align.anchorCenter') }}</p>
    </section>

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
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'
import {
  normalizeImageAlign,
  type ImageAlignState
} from '@shared/graph'

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.align' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const state = computed(() =>
  node.value ? normalizeImageAlign(node.value.params.imageAlign) : null
)

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('image.align'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

function applyPatch(patch: Partial<ImageAlignState>): void {
  if (!node.value || !state.value) return
  const next = { ...state.value, ...patch }
  graphEditorHosts.updateNode(hostId.value, node.value.id, {
    imageAlign: normalizeImageAlign(next)
  })
}

function patchCanvas(
  key: 'canvasWidth' | 'canvasHeight',
  event: Event
): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const clamped = Math.min(8192, Math.max(16, Math.round(raw)))
  applyPatch({ [key]: clamped })
}

function patchAnchor(event: Event): void {
  const value = (event.target as HTMLSelectElement).value
  applyPatch({ anchor: value === 'center' ? 'center' : 'ground' })
}

function patchRatio(
  key: 'contentHeightRatio' | 'groundRatio',
  event: Event
): void {
  const raw = Number((event.target as HTMLInputElement).value)
  const range = key === 'contentHeightRatio' ? { min: 0.1, max: 1 } : { min: 0, max: 0.5 }
  applyPatch({ [key]: Math.min(range.max, Math.max(range.min, raw)) })
}

function patchFit(event: Event): void {
  applyPatch({ fitWithinWidth: (event.target as HTMLInputElement).checked })
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

.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  background: var(--bg-subtle);
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
}

.field label {
  flex: 1;
  font-size: 12px;
  color: var(--text-secondary);
}

.field input[type='number'] {
  width: 84px;
}

.field input[type='range'] {
  flex: 1;
}

.field select {
  min-width: 132px;
}

.unit,
.pct {
  font-size: 11px;
  color: var(--text-muted);
}

.pct {
  width: 40px;
  text-align: right;
}

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}

.summary {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
</style>
