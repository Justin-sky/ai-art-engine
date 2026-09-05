<template>
  <div
    v-if="node"
    class="node-inspector"
  >
    <div class="head">
      <h2>{{ displayTitle }}</h2>
    </div>
    <p class="hint">
      {{ t('graph.cutout.hint') }}
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
      <label class="row">
        <span>{{ t('cutout.detectConf') }}<b>{{ Math.round(local.confThreshold * 100) }}%</b></span>
        <input
          v-model.number="local.confThreshold"
          type="range"
          min="0.05"
          max="0.9"
          step="0.05"
          @change="submit({ confThreshold: local.confThreshold })"
        >
      </label>
      <label class="row">
        <span>{{ t('cutout.threshold') }}<b>{{ Math.round(local.threshold * 100) }}%</b></span>
        <input
          v-model.number="local.threshold"
          type="range"
          min="0.05"
          max="1"
          step="0.05"
          @change="submit({ threshold: local.threshold })"
        >
      </label>
      <label class="row">
        <span>{{ t('cutout.feather') }}<b>{{ local.feather }}px</b></span>
        <input
          v-model.number="local.feather"
          type="range"
          min="0"
          max="96"
          step="1"
          @change="submit({ feather: local.feather })"
        >
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="local.cropToSubject"
          @change="submit({ cropToSubject: ($event.target as HTMLInputElement).checked })"
        >
        {{ t('cutout.crop') }}
      </label>
      <label class="check">
        <input
          type="checkbox"
          :checked="local.personOnly"
          @change="submit({ personOnly: ($event.target as HTMLInputElement).checked })"
        >
        {{ t('cutout.personOnly') }}
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
  DEFAULT_IMAGE_CUTOUT,
  readImageCutoutFromNode,
  type ImageCutoutState
} from '@shared/graph'
import GraphNodeRunControl from './GraphNodeRunControl.vue'
import GraphNodeOutputPreview from './GraphNodeOutputPreview.vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useNodeDisplayTitle } from '../composables/useNodeDisplayTitle'
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
  return current?.typeId === 'image.cutout' ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? selection.hostId ?? '' : ''
})

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)

const typeLabel = computed(() => graphTypeLabel('image.cutout'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const local = ref<ImageCutoutState | null>(null)
watch(
  node,
  () => {
    local.value = node.value
      ? readImageCutoutFromNode(node.value.params)
      : { ...DEFAULT_IMAGE_CUTOUT }
  },
  { immediate: true }
)

function submit(patch: Partial<ImageCutoutState>): void {
  const n = node.value
  if (!n) return
  graphEditorHosts.updateNode(hostId.value, n.id, {
    imageCutout: { ...readImageCutoutFromNode(n.params), ...patch }
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
  gap: 10px;
  font-size: 12px;
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

.check {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--text);
  cursor: pointer;
}
</style>
