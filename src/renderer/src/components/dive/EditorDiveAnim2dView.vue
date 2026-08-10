<template>
  <div class="anim2d-dive">
    <div v-if="loading" class="hint">正在打开 2D 帧动画内图…</div>
    <AssetEditor v-else-if="innerAssetId" :key="innerAssetId" :asset-id="innerAssetId" embedded />
    <div v-else class="hint">{{ errorText }}</div>
  </div>
</template>

<script setup lang="ts">
import { defineAsyncComponent, onMounted, ref } from 'vue'
import {
  ANIM2D_INNER_GRAPH_VERSION,
  ANIM2D_HOST_INPUT_PORT_ID,
  DEFAULT_ANIM2D_STATE,
  boundaryInputNodeId,
  buildAnim2dHostInterface,
  buildAnim2dInnerGraph,
  softResolveSourceOutput,
  type ResolveHostInputSlotsOptions,
  type GraphDocument
} from '@shared/graph'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useStudioI18n } from '../../composables/useStudioI18n'
import { useProjectStore } from '../../stores/project'

const AssetEditor = defineAsyncComponent(() => import('../AssetEditor.vue'))

const props = defineProps<{
  frameKey: string
  hostId: string
  nodeId: string
}>()

const project = useProjectStore()
const { locale } = useStudioI18n()
const innerAssetId = ref('')
const loading = ref(true)
const errorText = ref('')

type ImagePreview = { dataUrl?: string; relativePath?: string }

/** 软解析外层入端口图片（上游未运行也能取到），无需先 cook */
async function resolveOuterImagePreview(hostId: string, nodeId: string): Promise<ImagePreview> {
  const doc = graphEditorHosts.getDocument(hostId)
  if (!doc) return {}
  const edges = graphEditorHosts.listIncomingEdges(hostId, nodeId, 'in')
  if (!edges.length) return {}
  const options: ResolveHostInputSlotsOptions = {
    resolveLiveAssetGraph: (id) => graphEditorHosts.getLiveAssetDocument(id) ?? undefined,
    resolveAssetGenParams: (id) => project.assets.find((a) => a.id === id)?.genParams
  }
  for (const edge of edges) {
    const value = softResolveSourceOutput(
      doc,
      edge.sourceNodeId,
      edge.sourcePort ?? 'out',
      options
    )
    if (!value) continue
    if (value.kind === 'image') {
      return {
        dataUrl: value.dataUrl?.trim() || undefined,
        relativePath: value.relativePath?.trim() || undefined
      }
    }
    if (value.kind === 'images') {
      const item = value.items.find((i) => i.dataUrl?.trim() || i.relativePath?.trim())
      if (item) {
        return {
          dataUrl: item.dataUrl?.trim() || undefined,
          relativePath: item.relativePath?.trim() || undefined
        }
      }
    }
    if (value.kind === 'asset' && value.assetType === 'image') {
      const asset = project.assets.find((a) => a.id === value.assetId)
      if (asset?.relativePath?.trim()) return { relativePath: asset.relativePath.trim() }
    }
  }
  return {}
}

/** 把外层图片预览写进内图边界输入节点 params（返回是否变更） */
function patchBoundaryInputParams(graphJson: GraphDocument, preview: ImagePreview): boolean {
  const id = boundaryInputNodeId(ANIM2D_HOST_INPUT_PORT_ID)
  const node = graphJson.nodes.find((n) => n.id === id)
  if (!node) return false
  const params = { ...(node.params ?? {}) }
  if (preview.relativePath?.trim()) params.previewRelativePath = preview.relativePath.trim()
  if (preview.dataUrl?.trim()) params.previewDataUrl = preview.dataUrl
  const changed =
    params.previewDataUrl !== node.params?.previewDataUrl ||
    params.previewRelativePath !== node.params?.previewRelativePath
  if (changed) node.params = params
  return changed
}

/** 复用已建内图时，把最新外层图片同步到边界输入节点（落盘 + 实时图） */
async function patchStoredBoundaryPreview(assetId: string, preview: ImagePreview): Promise<void> {
  const liveDoc = graphEditorHosts.getLiveAssetDocument(assetId)
  const boundaryId = boundaryInputNodeId(ANIM2D_HOST_INPUT_PORT_ID)
  if (liveDoc) {
    if (patchBoundaryInputParams(liveDoc, preview)) {
      graphEditorHosts.updateNode(`asset:${assetId}`, boundaryId, {
        previewDataUrl: preview.dataUrl?.trim() || undefined,
        previewRelativePath: preview.relativePath?.trim() || undefined
      })
      await graphEditorHosts.flush(`asset:${assetId}`)
    }
    return
  }
  const asset = project.assets.find((a) => a.id === assetId)
  const graphJson = asset?.genParams?.graphJson as GraphDocument | undefined
  if (!asset || !graphJson) return
  if (patchBoundaryInputParams(graphJson, preview)) {
    await window.studio.updateAsset({
      ...asset,
      genParams: { ...(asset.genParams ?? {}), graphJson }
    })
    await project.refreshLibrary()
  }
}

onMounted(async () => {
  try {
    const node = graphEditorHosts.getNode(props.hostId, props.nodeId)
    const preview = await resolveOuterImagePreview(props.hostId, props.nodeId)
    const existing = node?.params?.animAssetId
    const sameVersion = node?.params?.animGraphVersion === ANIM2D_INNER_GRAPH_VERSION
    if (
      existing &&
      sameVersion &&
      project.assets.some((asset) => asset.id === existing)
    ) {
      await patchStoredBoundaryPreview(existing, preview)
      innerAssetId.value = existing
      return
    }

    const graphJson = buildAnim2dInnerGraph(
      { ...DEFAULT_ANIM2D_STATE },
      'walk',
      '',
      locale.value
    )
    patchBoundaryInputParams(graphJson, preview)
    const created = await window.studio.createAsset({
      type: 'subgraph',
      name: `2D帧动画·${node?.title?.trim() || props.nodeId}`,
      folderId: null,
      genParams: {
        graphJson,
        hostInterface: buildAnim2dHostInterface()
      } as never
    })
    innerAssetId.value = created.id
    graphEditorHosts.updateNode(props.hostId, props.nodeId, {
      animAssetId: created.id,
      animGraphVersion: ANIM2D_INNER_GRAPH_VERSION
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
.anim2d-dive {
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
