<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.compose.hint') }}
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

    <div
      v-if="local"
      class="params"
    >
      <div class="group">
        <span class="group-label">{{ t('compose.frame') }}</span>
        <div class="seg">
          <button
            v-for="frame in FRAMES"
            :key="frame.id"
            type="button"
            :class="{ active: local.aspectId === frame.id }"
            @click="submit({ aspectId: frame.id })"
          >
            {{ t(frame.labelKey) }}
          </button>
        </div>
      </div>

      <div class="group">
        <span class="group-label">{{ t('compose.strategy') }}</span>
        <label class="radio">
          <input
            type="radio"
            name="compose-strategy"
            :checked="local.strategy === 'center'"
            @change="submit({ strategy: 'center' })"
          >
          <span>
            {{ t('compose.strategyCenter') }}
            <i>{{ t('compose.strategyCenterHint') }}</i>
          </span>
        </label>
        <label class="radio">
          <input
            type="radio"
            name="compose-strategy"
            :checked="local.strategy === 'headroom'"
            @change="submit({ strategy: 'headroom' })"
          >
          <span>
            {{ t('compose.strategyHeadroom') }}
            <i>{{ t('compose.strategyHeadroomHint') }}</i>
          </span>
        </label>
      </div>

      <label class="row">
        <span>{{ t('cutout.detectConf') }}<b>{{ Math.round(local.confThreshold * 100) }}%</b></span>
        <input
          v-model.number="local.confThreshold"
          type="range"
          min="0.2"
          max="0.9"
          step="0.05"
          @change="submit({ confThreshold: local.confThreshold })"
        >
      </label>
    </div>
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
  DEFAULT_IMAGE_COMPOSE,
  readImageComposeFromNode,
  type ImageComposeState
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
import { useGraphNodeRun } from '../composables/useGraphNodeRun'
import { useEditorKernel } from '../editor/kernel'
import { graphEditorHosts } from '../features/graph/model/graphEditorHosts'

const FRAMES: ReadonlyArray<{ id: string; labelKey: string }> = [
  { id: '9:16', labelKey: 'compose.frame9_16' },
  { id: '1:1', labelKey: 'compose.frame1_1' },
  { id: '16:9', labelKey: 'compose.frame16_9' }
]

const { t, graphTypeLabel } = useStudioI18n()
const editor = useEditorKernel()

const node = computed(() => {
  void graphEditorHosts.revision.value
  const selection = editor.selection.current.value
  const id = selection.kind === 'graph.node' ? selection.id : null
  if (!id) return null
  const current = graphEditorHosts.getNode(selection.hostId, id)
  return current?.typeId === 'image.compose' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('image.compose'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const local = ref<ImageComposeState | null>(null)
watch(
  node,
  () => {
    local.value = node.value
      ? readImageComposeFromNode(node.value.params)
      : { ...DEFAULT_IMAGE_COMPOSE }
  },
  { immediate: true }
)

function submit(patch: Partial<ImageComposeState>): void {
  const n = node.value
  if (!n) return
  graphEditorHosts.updateNode(hostId.value, n.id, {
    imageCompose: { ...readImageComposeFromNode(n.params), ...patch }
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

.params {
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-size: 12px;
}

.group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.group-label {
  color: var(--text-muted);
}

.seg {
  display: flex;
  gap: 6px;
}

.seg button {
  flex: 1;
  padding: 6px 4px;
  font-size: 12px;
  border: 1px solid var(--border, rgba(128, 128, 128, 0.35));
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}

.seg button.active {
  border-color: var(--accent, #4a90e2);
  background: color-mix(in srgb, var(--accent, #4a90e2) 18%, transparent);
}

.radio {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  color: var(--text);
  cursor: pointer;
}

.radio i {
  display: block;
  font-style: normal;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.4;
}

.row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--text-muted);
}

.row b {
  color: var(--text);
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}

.row input[type='range'] {
  width: 100%;
}
</style>
