<template>
  <div class="ui-split-dive">
    <div v-if="loading" class="hint">正在打开 UI 界面拆分内图…</div>
    <AssetEditor v-else-if="innerAssetId" :key="innerAssetId" :asset-id="innerAssetId" embedded />
    <div v-else class="hint">{{ errorText }}</div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue'
import {
  buildUiSplitHostInterface,
  buildUiSplitInnerGraph,
  type UiScreenPromptItem
} from '@shared/graph'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../../stores/project'

const AssetEditor = defineAsyncComponent(() => import('../AssetEditor.vue'))

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const project = useProjectStore()
const innerAssetId = ref('')
const loading = ref(true)
const errorText = ref('')

onMounted(async () => {
  try {
    const node = graphEditorHosts.getNode(props.hostId, props.nodeId)
    const screens: UiScreenPromptItem[] = node?.params?.uiScreens ?? []
    const existing = node?.params?.uiSplitAssetId
    if (existing && project.assets.some((asset) => asset.id === existing)) {
      innerAssetId.value = existing
      return
    }
    if (!screens.length) {
      errorText.value = '请先生成界面提示词，再双击进入内图。'
      return
    }
    const created = await window.studio.createAsset({
      type: 'subgraph',
      name: `UI拆分·${node?.title?.trim() || props.nodeId}`,
      folderId: null,
      genParams: {
        graphJson: buildUiSplitInnerGraph(screens),
        hostInterface: buildUiSplitHostInterface(screens)
      } as never
    })
    innerAssetId.value = created.id
    graphEditorHosts.updateNode(props.hostId, props.nodeId, { uiSplitAssetId: created.id })
    await graphEditorHosts.flush(props.hostId)
    await project.refreshLibrary()
  } catch (err) {
    errorText.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
})
</script>

<style scoped>
.ui-split-dive {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.hint {
  color: var(--text-muted);
  padding: 16px;
  font-size: 13px;
}
</style>
