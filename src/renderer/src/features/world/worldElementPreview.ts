/**
 * 世界元素子图预览：从四类 elementWorkflow 子图的边界输出 soft 收集
 * `{ type, name, imageUrl }` 实体结果（只读，不创建资产、不入队 cook）。
 */
import {
  collectImagesFromCompletedOutputNode,
  hostInterfaceForElementWorkflow,
  inferElementWorkflowHostInterface,
  isVisualOutputNodeComplete,
  listVisualOutputNodes,
  normalizeScopedGraph,
  readWorldElementGraphFromGenParams,
  readWorldElementIdFromNodeParams,
  readWorldElementGraphForNode,
  LEGACY_WORLD_GEN_NODE_ID,
  WORLD_ELEMENT_KIND_TO_TYPE,
  WORLD_ELEMENT_KINDS,
  type GraphDocument,
  type GraphImageItem,
  type GraphNode,
  type WorldElementGenResult
} from '@shared/graph'
import { isDraftAssetId } from '@shared/domain'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { graphRunHosts } from '../graph/model/graphRunHosts'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

function readWorldGenParams(worldAssetId: string): Record<string, unknown> | undefined {
  if (isDraftAssetId(worldAssetId)) {
    return useDraftStore().getDraft(worldAssetId)?.genParams
  }
  return useProjectStore().assets.find((item) => item.id === worldAssetId)?.genParams as
    Record<string, unknown> | undefined
}

function resolveElementName(doc: GraphDocument, output: GraphNode, fallback: string): string {
  const elementId = readWorldElementIdFromNodeParams(output.params)
  if (elementId) {
    const titled = doc.nodes.find(
      (node) => readWorldElementIdFromNodeParams(node.params) === elementId && !!node.title?.trim()
    )
    if (titled?.title?.trim()) return titled.title.trim()
  }
  if (output.title?.trim()) return output.title.trim()
  return fallback
}

function imageUrlFromItem(item: GraphImageItem): string {
  return item.relativePath?.trim() || item.dataUrl?.trim() || ''
}

function normalizeElementWorkflowDoc(raw: GraphDocument | null): GraphDocument {
  const items = raw?.nodes
    .map((node) => {
      const id = readWorldElementIdFromNodeParams(node.params)
      if (!id || node.typeId !== 'asset.image') return null
      return { id, name: node.title?.trim() || id }
    })
    .filter((item): item is { id: string; name: string } => !!item)
  const iface = items?.length
    ? hostInterfaceForElementWorkflow(items)
    : inferElementWorkflowHostInterface(raw)
  return normalizeScopedGraph('elementWorkflow', raw ?? null, {
    assetType: 'world',
    hostInterface: iface
  })
}

function resolvedElementNodeKey(nodeId?: string): string | undefined {
  const id = nodeId?.trim()
  if (!id || id === LEGACY_WORLD_GEN_NODE_ID) return undefined
  return id
}

function elementWorkflowHostId(
  worldAssetId: string,
  kind: (typeof WORLD_ELEMENT_KINDS)[number],
  nodeId?: string
): string {
  const nodeKey = resolvedElementNodeKey(nodeId)
  return nodeKey
    ? `asset:${worldAssetId}:element:${kind}:${nodeKey}`
    : `asset:${worldAssetId}:element:${kind}`
}

function readElementWorkflowDoc(
  worldAssetId: string,
  kind: (typeof WORLD_ELEMENT_KINDS)[number],
  genParams: Record<string, unknown> | undefined,
  nodeId?: string
): GraphDocument {
  const nodeKey = resolvedElementNodeKey(nodeId)
  const hostId = elementWorkflowHostId(worldAssetId, kind, nodeId)
  const live = graphEditorHosts.getDocument(hostId)
  const base = live
    ? normalizeElementWorkflowDoc(live)
    : normalizeElementWorkflowDoc(
        nodeKey
          ? readWorldElementGraphForNode(genParams, nodeKey, kind)
          : readWorldElementGraphFromGenParams(genParams, kind)
      )
  const liveStates = graphRunHosts.get(hostId)?.runStates
  if (!liveStates || !Object.keys(liveStates).length) return base
  return {
    ...base,
    runStates: { ...(base.runStates ?? {}), ...liveStates }
  }
}

/**
 * 从四类 elementWorkflow 子图的边界输出 soft 收集实体（预览用，不创建资产）。
 * 子图已有图但宿主节点尚未执行时，Inspector 仍可展示分组预览。
 */
export function previewWorldElementOutputsFromSubgraphs(input: {
  worldAssetId: string
  nodeId?: string
}): WorldElementGenResult[] {
  const worldAssetId = input.worldAssetId.trim()
  if (!worldAssetId) return []
  const genParams = readWorldGenParams(worldAssetId)
  const items: WorldElementGenResult[] = []

  for (const kind of WORLD_ELEMENT_KINDS) {
    const doc = readElementWorkflowDoc(worldAssetId, kind, genParams, input.nodeId)
    const outputs = listVisualOutputNodes(doc)
    const type = WORLD_ELEMENT_KIND_TO_TYPE[kind]

    for (let i = 0; i < outputs.length; i += 1) {
      const output = outputs[i]!
      if (!isVisualOutputNodeComplete(doc, output.id)) continue
      const images = collectImagesFromCompletedOutputNode(doc, output)
      if (!images.length) continue
      const name = resolveElementName(doc, output, `${type} · ${i + 1}`)
      const imageUrl = imageUrlFromItem(images[0]!)
      if (!imageUrl) continue
      items.push({ type, name, imageUrl })
    }
  }

  return items
}
