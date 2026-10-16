<template>
  <div v-if="node" class="image-process-inspector">
    <div class="tool-switcher">
      <label class="tool-switcher-label">
        <span>{{ t('graph.imageProcess.toolLabel') }}</span>
        <select
          class="tool-select"
          :value="activeTool"
          @change="onToolChange(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="tool in IMAGE_PROCESS_TOOLS" :key="tool" :value="tool">
            {{ graphTypeLabel(`image.${tool}`) }}
          </option>
        </select>
      </label>
    </div>

    <div class="tool-body">
      <CropInspector v-if="activeTool === 'crop'" />
      <div v-else-if="activeTool === 'transform'" class="node-inspector">
        <div class="head">
          <h2>{{ displayTitle }}</h2>
        </div>
        <p class="hint">
          {{ t('graph.transform.hint') }}
        </p>

        <GraphNodeRunControl
          v-if="hasInPort"
          :status="runStatus"
          :is-running="isGraphRunning"
          :blocked="blocked"
          @toggle="toggleRun"
        />

        <GraphNodeOutputPreview v-if="node && hostId" :node="node" :host-id="hostId" />

        <dl v-if="transformState" class="meta">
          <div>
            <dt>{{ t('graph.transform.scale') }}</dt>
            <dd>{{ Math.round(transformState.scale * 100) }}%</dd>
          </div>
          <div>
            <dt>{{ t('graph.transform.rotate') }}</dt>
            <dd>{{ transformState.rotate }}°</dd>
          </div>
        </dl>
      </div>
      <ComposeProcessInspector v-else-if="activeTool === 'compose'" />
      <GridSplitInspector v-else-if="activeTool === 'gridSplit'" />
      <CutoutProcessInspector v-else-if="activeTool === 'cutout'" />
      <MatteInspector v-else-if="activeTool === 'matte'" />
      <EraseInspector v-else-if="activeTool === 'erase'" />
      <RedrawInspector v-else-if="activeTool === 'redraw'" />
      <ExpandInspector v-else-if="activeTool === 'expand'" />
      <UpscaleInspector v-else-if="activeTool === 'upscale'" />
    </div>
  </div>
  <div v-else class="node-inspector empty">
    {{ t('graph.inspector.node.empty') }}
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import {
  IMAGE_PROCESS_TOOLS,
  isImageProcessNode,
  readImageTransformFromNode,
  resolveImageProcessTool,
  type ImageProcessToolId
} from '@shared/graph'
import CropInspector from './CropInspector.vue'
import ComposeProcessInspector from './ComposeProcessInspector.vue'
import GridSplitInspector from './GridSplitInspector.vue'
import CutoutProcessInspector from './CutoutProcessInspector.vue'
import MatteInspector from './MatteInspector.vue'
import EraseInspector from './EraseInspector.vue'
import RedrawInspector from './RedrawInspector.vue'
import ExpandInspector from './ExpandInspector.vue'
import UpscaleInspector from './UpscaleInspector.vue'
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
  return isImageProcessNode(current) ? current : null
})

const hostId = computed(() => {
  const selection = editor.selection.current.value
  return selection.kind === 'graph.node' ? (selection.hostId ?? '') : ''
})

const activeTool = computed<ImageProcessToolId>(() => resolveImageProcessTool(node.value))

const { hasInPort, runStatus, isGraphRunning, blocked, toggleRun } = useGraphNodeRun(node)
const typeLabel = computed(() => graphTypeLabel('image.process'))
const displayTitle = useNodeDisplayTitle(node, typeLabel)

const transformState = computed(() =>
  node.value ? readImageTransformFromNode(node.value.params) : null
)

function onToolChange(raw: string): void {
  const current = node.value
  const hId = hostId.value
  if (!current || !hId) return
  if (!(IMAGE_PROCESS_TOOLS as readonly string[]).includes(raw)) return
  const nextTool = raw as ImageProcessToolId
  if (nextTool === activeTool.value) return
  graphEditorHosts.updateNode(hId, current.id, { imageProcessTool: nextTool })
  graphEditorHosts.bumpRevision()
}
</script>

<style scoped>
.image-process-inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: auto;
}

.tool-switcher {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
  flex-shrink: 0;
}

.tool-switcher-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
  color: var(--text-muted);
}

.tool-select {
  flex: 1;
  max-width: 180px;
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--bg-input, var(--bg-panel));
  color: var(--text);
  font-size: 12px;
}

.tool-body {
  flex: 1;
  min-height: 0;
}

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

.meta > div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.meta dt {
  color: var(--text-muted);
}

.meta dd {
  margin: 0;
  font-variant-numeric: tabular-nums;
}
</style>
