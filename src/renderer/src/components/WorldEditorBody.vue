<template>
  <div class="world-editor-body">
    <div class="graph-row">
      <div class="graph-pane">
        <NodeGraphEditor
          v-for="kind in kinds"
          v-show="activeTab === kind"
          :key="`${worldAssetId}:${kind}`"
          class="kind-graph"
          :asset-id="worldAssetId"
          :world-element-kind="kind"
          scope="elementWorkflow"
        />
      </div>
      <aside class="world-inspector-pane">
        <InspectorPanel />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { WORLD_ELEMENT_KINDS, type WorldElementKind } from '@shared/graph'
import { useEditorKernel } from '../editor/kernel'
import { useWorkspaceStore } from '../stores/workspace'
import InspectorPanel from './InspectorPanel.vue'
import NodeGraphEditor from './NodeGraphEditor.vue'

const props = defineProps<{
  worldAssetId: string
  activeTab: WorldElementKind
}>()

const editor = useEditorKernel()
const workspace = useWorkspaceStore()
const kinds = WORLD_ELEMENT_KINDS

function elementGraphDocumentId(kind: WorldElementKind): string {
  return `graph:asset:${props.worldAssetId}:element:${kind}`
}

onMounted(() => {
  workspace.focusProjectGlobals()
})

watch(
  () => props.activeTab,
  () => {
    workspace.focusProjectGlobals()
  }
)

async function flushSave(): Promise<void> {
  // 四类子图共用 genParams，必须串行写盘；documents.save 对干净文档会立即跳过
  for (const kind of WORLD_ELEMENT_KINDS) {
    await editor.documents.save(elementGraphDocumentId(kind))
  }
}

defineExpose({ flushSave })
</script>

<style scoped>
.world-editor-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.graph-row {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.graph-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
}

.kind-graph {
  position: absolute;
  inset: 0;
}

.world-inspector-pane {
  flex: none;
  width: 300px;
  min-width: 260px;
  max-width: 360px;
  border-left: 1px solid var(--border);
  background: var(--bg-panel, var(--bg-elevated));
  overflow: auto;
}
</style>
