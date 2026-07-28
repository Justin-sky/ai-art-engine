import { isDraftAssetId } from '@shared/domain'
import {
  extractShotTableWorldEntities,
  type GraphDocument,
  type WorldElementGenResult
} from '@shared/graph'
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

/**
 * 打开分镜表格时读取可绑定的世界元素实体。
 * 优先 live 画布，否则回退资产 graphJson；两者都含表格节点缓存与
 * in-worldEntities 上游产物，未运行表格节点时也能绑定。
 */
export function readShotTableWorldOutputs(scriptAssetId: string): WorldElementGenResult[] {
  const id = scriptAssetId.trim()
  if (!id) return []

  const fromLive = extractShotTableWorldEntities(graphEditorHosts.getDocument(`asset:${id}`))
  if (fromLive.length) return fromLive

  return extractShotTableWorldEntities(readPersistedScriptGraph(id))
}
