<template>
  <div class="asset-canvas-editor">
    <div class="toolbar">
      <span>{{ t('studio.editor.canvas') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('canvas.asset.hint') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>
    <NodeGraphEditor
      class="canvas-graph"
      :asset-id="canvasAssetId"
      :hide-toolbar="toolbarCollapsed"
    />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'

const props = defineProps<{
  canvasAssetId: string
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const toolbarCollapsed = ref(false)

onBeforeUnmount(() => {
  workspace.consumeCanvasEditor(props.canvasAssetId)
})
</script>

<style scoped>
.asset-canvas-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
  position: relative;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
  color: var(--text-muted);
  flex-shrink: 0;
}

.spacer {
  flex: 1;
}

.hint {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.canvas-graph {
  flex: 1;
  min-height: 0;
}
</style>
