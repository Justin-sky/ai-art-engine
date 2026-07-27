import { isDraftAssetId } from '@shared/domain'
import type { GraphDocument, WorldElementGenResult } from '@shared/graph'
import { graphEditorHosts } from '../graph/model/graphEditorHosts'
import { useDraftStore } from '../../stores/drafts'
import { useProjectStore } from '../../stores/project'

function readPersistedScriptGraph(scriptAssetId: string): GraphDocument | null {
  if (isDraftAssetId(scriptAssetId)) {
    const draft = useDraftStore().getDraft(scriptAssetId)
    const raw = draft?.genParams?.graphJson
    return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
  }
  const asset = useProjectStore().assets.find((item) => item.id === scriptAssetId)
  const raw = asset?.genParams?.graphJson
  return raw && typeof raw === 'object' ? (raw as GraphDocument) : null
}

function worldOutputsFromNodeParams(params: unknown): WorldElementGenResult[] {
  if (!params || typeof params !== 'object') return []
  const raw = (params as { worldElementOutputs?: unknown }).worldElementOutputs
  if (!Array.isArray(raw)) return []
  return raw.filter((item): item is WorldElementGenResult => {
    if (!item || typeof item !== 'object') return false
    const row = item as Record<string, unknown>
    return (
      typeof row.type === 'string' &&
      typeof row.name === 'string' &&
      typeof row.imageUrl === 'string' &&
      Boolean(row.name.trim() && row.imageUrl.trim())
    )
  })
}

/**
 * 打开分镜表格时读取 `script.shotTable` 已同步的世界元素实体。
 * 优先 live 画布节点 params，否则回退资产 graphJson。
 */
export function readShotTableWorldOutputs(scriptAssetId: string): WorldElementGenResult[] {
  const id = scriptAssetId.trim()
  if (!id) return []

  const liveHostId = `asset:${id}`
  const liveNode = graphEditorHosts.findNode(
    liveHostId,
    (node) => node.typeId === 'script.shotTable'
  )
  const fromLive = worldOutputsFromNodeParams(liveNode?.params)
  if (fromLive.length) return fromLive

  const doc = readPersistedScriptGraph(id)
  const table = doc?.nodes?.find((node) => node.typeId === 'script.shotTable')
  return worldOutputsFromNodeParams(table?.params)
}
