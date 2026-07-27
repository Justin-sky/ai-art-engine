<template>
  <div v-if="frame" class="editor-dive-child">
    <AssetEditor
      v-if="frame.kind === 'screenplay' || frame.kind === 'asset'"
      :key="frame.assetId"
      :asset-id="frame.assetId"
      embedded
    />
    <NarrativeAssetEditor
      v-else-if="frame.kind === 'narrative'"
      :key="frame.assetId"
      :narrative-asset-id="frame.assetId"
      embedded
    />
    <WorldElementEditor
      v-else-if="frame.kind === 'world'"
      :key="frame.assetId"
      :world-asset-id="frame.assetId"
      embedded
    />
    <ScriptEditor
      v-else-if="frame.kind === 'script'"
      :key="frame.assetId"
      :script-asset-id="frame.assetId"
      embedded
    />
    <DirectorEditor
      v-else-if="frame.kind === 'director'"
      :key="frame.assetId"
      :director-asset-id="frame.assetId"
      embedded
    />
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import type { EditorDiveFrame } from '../features/graph/model/editorDive'

/** 异步加载，避免与各主编辑器互相静态引用形成环 */
const AssetEditor = defineAsyncComponent(() => import('./AssetEditor.vue'))
const NarrativeAssetEditor = defineAsyncComponent(() => import('./NarrativeAssetEditor.vue'))
const WorldElementEditor = defineAsyncComponent(() => import('./WorldElementEditor.vue'))
const ScriptEditor = defineAsyncComponent(() => import('./ScriptEditor.vue'))
const DirectorEditor = defineAsyncComponent(() => import('./DirectorEditor.vue'))

defineProps<{
  frame: EditorDiveFrame | null
}>()
</script>

<style scoped>
.editor-dive-child {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.editor-dive-child > :deep(.asset-editor),
.editor-dive-child > :deep(.narrative-asset-editor),
.editor-dive-child > :deep(.world-element-editor),
.editor-dive-child > :deep(.script-editor),
.editor-dive-child > :deep(.director-editor) {
  flex: 1;
  min-height: 0;
  height: 100%;
}
</style>
