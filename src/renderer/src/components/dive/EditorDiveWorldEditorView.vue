<template>
  <div class="dive-view">
    <header class="head">
      <WorldEditorTabs v-model="activeTab" />
    </header>
    <WorldEditorBody
      v-if="ready"
      ref="bodyRef"
      class="body"
      :world-asset-id="worldAssetId"
      :world-gen-node-id="worldGenNodeId"
      :active-tab="activeTab"
    />
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, provide, ref, watch } from 'vue'
import type { WorldElementKind } from '@shared/graph'
import { editorDiveKey } from '../../features/graph/model/editorDive'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorDiveFrameFlush } from '../../composables/useEditorDiveFrameFlush'
import { applyWorldCatalog } from '../../features/world/applyWorldCatalogOnOpen'
import { worldElementKindKey } from '../../features/world/worldElementKindKey'
import WorldEditorBody from '../WorldEditorBody.vue'
import WorldEditorTabs from '../WorldEditorTabs.vue'

const props = defineProps<{
  frameKey: string
  worldAssetId: string
  worldGenNodeId?: string
  tab?: WorldElementKind
}>()

const workspace = useWorkspaceStore()
const editorDive = inject(editorDiveKey, null)
const bodyRef = ref<InstanceType<typeof WorldEditorBody> | null>(null)
const activeTab = ref<WorldElementKind>(props.tab ?? 'characters')
// 等播种完成后再挂载四类子图编辑器，确保 NodeGraphEditor 加载时读到已同步的节点
const ready = ref(false)

provide(worldElementKindKey, activeTab)

useEditorDiveFrameFlush(
  () => props.frameKey,
  () => bodyRef.value?.flushSave()
)

watch(
  () => props.tab,
  (tab) => {
    if (tab) activeTab.value = tab
  }
)

watch(activeTab, (tab) => {
  const frame = editorDive?.frames.find((f) => f.key === props.frameKey)
  if (frame && frame.type === 'view' && frame.meta.viewId === 'world.editor') {
    frame.meta.tab = tab
  }
})

onMounted(async () => {
  try {
    await applyWorldCatalog(props.worldAssetId, undefined, props.worldGenNodeId)
  } catch (error) {
    console.warn('[dive] applyWorldCatalog failed', error)
  }
  ready.value = true
  workspace.focusProjectGlobals()
})
</script>

<style scoped>
.dive-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--bg-elevated);
}
.body {
  flex: 1;
  min-height: 0;
}
</style>
