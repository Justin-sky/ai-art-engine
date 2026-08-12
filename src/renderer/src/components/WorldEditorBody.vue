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
          :world-gen-node-id="worldGenNodeId"
          scope="elementWorkflow"
          :hide-toolbar="hideGraphToolbar"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, provide, toRef, watch } from 'vue'
import { LEGACY_WORLD_GEN_NODE_ID, WORLD_ELEMENT_KINDS, type WorldElementKind } from '@shared/graph'
import { useEditorKernel } from '../editor/kernel'
import { worldElementKindKey } from '../features/world/worldElementKindKey'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'

const props = withDefaults(
  defineProps<{
    worldAssetId: string
    worldGenNodeId?: string
    activeTab: WorldElementKind
    hideGraphToolbar?: boolean
  }>(),
  {
    hideGraphToolbar: false
  }
)

provide(worldElementKindKey, toRef(props, 'activeTab'))

const editor = useEditorKernel()
const workspace = useWorkspaceStore()
const kinds = WORLD_ELEMENT_KINDS

function elementGraphDocumentId(kind: WorldElementKind): string {
  const nodeKey =
    props.worldGenNodeId?.trim() && props.worldGenNodeId.trim() !== LEGACY_WORLD_GEN_NODE_ID
      ? props.worldGenNodeId.trim()
      : ''
  return nodeKey
    ? `graph:asset:${props.worldAssetId}:element:${kind}:${nodeKey}`
    : `graph:asset:${props.worldAssetId}:element:${kind}`
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
</style>
