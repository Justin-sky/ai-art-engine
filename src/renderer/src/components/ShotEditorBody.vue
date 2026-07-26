<template>
  <div class="shot-editor-body" :class="{ embedded: embedded }">
    <div class="script-dialog-main">
      <div class="graph-row">
        <NodeGraphEditor
          ref="graphRef"
          class="script-dialog-graph"
          :scope="graphScope"
          :hide-toolbar="hideToolbar"
        />
        <aside v-if="showInspector" class="shot-inspector-pane">
          <InspectorPanel :export-canvas="exportCanvas" />
        </aside>
      </div>
      <ShotStrip class="script-dialog-shots" :script-asset-id="scriptAssetId" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import type { GraphAddScope } from '@shared/graph'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import InspectorPanel from './InspectorPanel.vue'
import ShotStrip from './ShotStrip.vue'

const props = withDefaults(
  defineProps<{
    scriptAssetId: string
    /** image → 每镜 visualGraphJson；video → 每镜 graphJson */
    kind?: 'image' | 'video'
    /**
     * 嵌入剧本画布底栏：隐藏自有 Inspector 与图工具条，共用 Studio 外层 Inspector。
     */
    embedded?: boolean
  }>(),
  {
    kind: 'video',
    embedded: false
  }
)

const workspace = useWorkspaceStore()
const graphRef = ref<InstanceType<typeof NodeGraphEditor> | null>(null)

const graphScope = computed<GraphAddScope>(() =>
  props.kind === 'image' ? 'visual' : 'shotWorkflow'
)

const showInspector = computed(() => !props.embedded)
const hideToolbar = computed(() => props.embedded)

function exportCanvas(): Promise<string | null> {
  return workspace.exportCanvasForActiveShot()
}

onMounted(() => {
  workspace.registerScriptGraphGetter(props.scriptAssetId, () =>
    graphRef.value?.getGraphDocument() ?? null
  )
  workspace.focusShot()
})

onBeforeUnmount(() => {
  workspace.unregisterScriptGraphGetter(props.scriptAssetId)
  void graphRef.value?.flushSave()
})

defineExpose({
  flushSave: () => graphRef.value?.flushSave()
})
</script>

<style scoped>
.shot-editor-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
}

.script-dialog-main {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.graph-row {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}

.script-dialog-graph {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.shot-inspector-pane {
  flex: none;
  width: 300px;
  min-width: 260px;
  max-width: 360px;
  border-left: 1px solid var(--border);
  background: var(--bg-panel, var(--bg-elevated));
  overflow: auto;
}

.script-dialog-shots {
  flex-shrink: 0;
  height: 148px;
  border-top: 1px solid var(--border);
}

.shot-editor-body.embedded .script-dialog-shots {
  height: 120px;
}
</style>
