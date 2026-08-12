<template>
  <div class="dive-view">
    <header class="head">
      <WorldEditorTabs v-model="activeTab" />
    </header>
    <WorldEditorBody
      ref="bodyRef"
      class="body"
      :world-asset-id="worldAssetId"
      :world-gen-node-id="worldGenNodeId"
      :active-tab="activeTab"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, provide, ref, watch } from 'vue'
import type { WorldElementKind } from '@shared/graph'
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
const bodyRef = ref<InstanceType<typeof WorldEditorBody> | null>(null)
const activeTab = ref<WorldElementKind>(props.tab ?? 'characters')

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

onMounted(async () => {
  try {
    await applyWorldCatalog(props.worldAssetId, undefined, props.worldGenNodeId)
  } catch (error) {
    console.warn('[dive] applyWorldCatalog failed', error)
  }
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
