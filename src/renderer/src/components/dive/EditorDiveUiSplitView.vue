<template>
  <div class="ui-split-dive">
    <div v-if="loading" class="hint">
      {{ t('divePipeline.uiSplit.loading') }}
    </div>
    <AssetEditor v-else-if="innerAssetId" :key="innerAssetId" :asset-id="innerAssetId" embedded />
    <div v-else class="hint">
      {{ errorText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue'
import {
  buildUiSplitHostInterface,
  buildUiSplitInnerGraph,
  normalizeStoredUiScreens,
  screensFromUiGenIncoming,
  softResolveSourceOutput,
  UI_SPLIT_INNER_GRAPH_VERSION,
  type ResolveHostInputSlotsOptions,
  type UiScreenPromptItem
} from '@shared/graph'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useProjectStore } from '../../stores/project'
import { toPlain } from '../../utils/toPlain'

const AssetEditor = defineAsyncComponent(() => import('../AssetEditor.vue'))

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const project = useProjectStore()
const { locale, t } = useStudioI18n()
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
    const hostAssetId = props.hostId.startsWith('asset:') ? props.hostId.slice('asset:'.length) : ''
    // 直接按输入端口数组展开（无需先 cook）；端口无输出时回退已存提示词
    let screens = resolveScreensFromIncomingPort(props.nodeId)
    const storedScreens = normalizeStoredUiScreens(node?.params?.uiScreens)
    if (!screens.length) {
      screens = storedScreens
    } else if (storedScreens.length) {
      screens = screens.map((item) => {
        const prev = storedScreens.find(
          (p) => (p.id && p.id === item.id) || (p.title && p.title === item.title)
        )
        return prev && prev.enabled === false ? { ...item, enabled: false } : item
      })
    }
    const existing = node?.params?.uiSplitAssetId?.trim() || ''
    const existingSubgraphAsset = existing
      ? project.assets.find(
          (asset) => asset.id === existing && asset.type === 'subgraph' && asset.id !== hostAssetId
        )
      : undefined
    const sameScreens =
      screens.length > 0 &&
      JSON.stringify(screens) === JSON.stringify(node?.params?.uiScreens ?? [])
    const sameVersion = node?.params?.uiSplitGraphVersion === UI_SPLIT_INNER_GRAPH_VERSION
    if (screens.length && node && !sameScreens) {
      const summary = screens.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
      graphEditorHosts.updateNode(props.hostId, props.nodeId, {
        uiScreens: toPlain(screens),
        text: summary
      })
    }
    if (existingSubgraphAsset && sameScreens && sameVersion) {
      innerAssetId.value = existingSubgraphAsset.id
      return
    }
    if (!screens.length) {
      errorText.value = t('divePipeline.uiSplit.error.noScreens')
      return
    }
    const plainGraphJson = toPlain(
      buildUiSplitInnerGraph(toPlain(screens), locale.value, {
        generateModel: node?.params?.generateModel,
        generateProviderInstanceId: node?.params?.generateProviderInstanceId,
        defaultAspectRatio: node?.params?.generateAspectRatio as never,
        generateTransparentBg: node?.params?.generateTransparentBg !== false,
        stylePreset: node?.params?.uiGenStylePreset as never,
        styleImagesUseGlobal: node?.params?.styleImagesUseGlobal !== false,
        generatedImages: toPlain(node?.params?.generatedImages)
      })
    )
    const plainHostInterface = toPlain(buildUiSplitHostInterface(toPlain(screens)))
    const created = await window.studio.createAsset({
      type: 'subgraph',
      name: `UI拆分·${node?.title?.trim() || props.nodeId}`, // cjk-ok 持久化资产名前缀（存的是名字不是标签）
      folderId: null,
      genParams: {
        graphJson: plainGraphJson,
        hostInterface: plainHostInterface
      } as never
    })
    innerAssetId.value = created.id
    graphEditorHosts.updateNode(props.hostId, props.nodeId, {
      uiSplitAssetId: created.id,
      uiSplitGraphVersion: UI_SPLIT_INNER_GRAPH_VERSION
    })
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
