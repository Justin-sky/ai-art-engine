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
  screensFromUiGenIncoming,
  softResolveSourceOutput,
  type ResolveHostInputSlotsOptions,
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

/** 从输入端口（上游 texts 数组）直接软解析界面列表，无需先 cook */
function resolveScreensFromIncomingPort(nodeId: string): UiScreenPromptItem[] {
  const doc = graphEditorHosts.getDocument(props.hostId)
  if (!doc) return []
  const incoming = graphEditorHosts.listIncomingEdges(props.hostId, nodeId, 'in')
  if (!incoming.length) return []
  const options: ResolveHostInputSlotsOptions = {
    resolveLiveAssetGraph: (id) => graphEditorHosts.getLiveAssetDocument(id) ?? undefined,
    resolveAssetGenParams: (id) => project.assets.find((a) => a.id === id)?.genParams
  }
  const values = incoming.map((edge) =>
    softResolveSourceOutput(doc, edge.sourceNodeId, edge.sourcePort ?? 'out', options)
  )
  return screensFromUiGenIncoming(values)
}

onMounted(async () => {
  try {
    const node = graphEditorHosts.getNode(props.hostId, props.nodeId)
    // 直接按输入端口数组展开（无需先 cook）；端口无输出时回退已存提示词
    let screens = resolveScreensFromIncomingPort(props.nodeId)
    if (!screens.length) {
      screens = Array.isArray(node?.params?.uiScreens)
        ? node!.params.uiScreens!.filter((item) => !!item?.prompt?.trim())
        : []
    }
    const existing = node?.params?.uiSplitAssetId
    const sameScreens =
      screens.length > 0 &&
      JSON.stringify(screens) === JSON.stringify(node?.params?.uiScreens ?? [])
    if (screens.length && node && !sameScreens) {
      graphEditorHosts.updateNode(props.hostId, props.nodeId, { uiScreens: screens })
    }
    if (existing && sameScreens && project.assets.some((asset) => asset.id === existing)) {
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
