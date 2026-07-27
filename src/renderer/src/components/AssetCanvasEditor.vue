<template>
  <div class="asset-canvas-editor">
    <div v-if="!diving" class="toolbar">
      <span>{{ t('studio.editor.canvas') }}</span>
      <span class="spacer" />
      <span class="hint">{{ t('canvas.asset.hint') }}</span>
      <GraphToolbarCollapseBtn v-model="toolbarCollapsed" />
    </div>

    <!-- 根剧集图：dive 时用 v-show 保留 live host，便于子层解析父图入边 -->
    <NodeGraphEditor
      v-show="!diving"
      class="canvas-graph"
      :asset-id="canvasAssetId"
      :hide-toolbar="toolbarCollapsed"
    />

    <EditorDiveChildHost :frame="diving ? diveTop : null" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useStudioI18n } from '../composables/useStudioI18n'
import { useAssetRecord } from '../composables/useAssetRecord'
import { useEditorDiveHost } from '../composables/useEditorDiveHost'
import { useWorkspaceStore } from '../stores/workspace'
import NodeGraphEditor from './NodeGraphEditor.vue'
import GraphToolbarCollapseBtn from './GraphToolbarCollapseBtn.vue'
import EditorDiveChildHost from './EditorDiveChildHost.vue'

const props = defineProps<{
  canvasAssetId: string
}>()

const { t } = useStudioI18n()
const workspace = useWorkspaceStore()
const toolbarCollapsed = ref(false)
const { asset: canvasAsset } = useAssetRecord(props.canvasAssetId)

const rootTitle = computed(
  () => canvasAsset.value?.name?.trim() || t('studio.dive.root')
)

const { diving, diveTop } = useEditorDiveHost({
  kind: 'canvas',
  assetId: () => props.canvasAssetId,
  rootTitle
})

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
  display: flex;
  flex-direction: column;
}
</style>
