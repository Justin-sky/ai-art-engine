import {
  collectHostOutputLifts,
  withHostOutputLifts,
  type GraphDocument,
  type GraphNodeRunState
} from '@shared/graph'
import { isDraftAssetId } from '@shared/domain'
import { persistAssetRecord } from '../../../composables/useAssetRecord'
import { useDraftStore } from '../../../stores/drafts'
import { useProjectStore } from '../../../stores/project'
import { graphEditorHosts } from './graphEditorHosts'
import { graphRunHosts } from './graphRunHosts'

function isInnerGraphHostId(hostId: string, assetId: string): boolean {
  const prefix = `asset:${assetId}`
  return hostId === prefix || hostId.startsWith(`${prefix}:`)
}

function parentAssetIdFromHostId(hostId: string): string | null {
  const assetMatch = /^asset:([^:]+)$/.exec(hostId)
  if (assetMatch?.[1]) return assetMatch[1]
  const scriptMatch = /^script:([^:]+)$/.exec(hostId)
  if (scriptMatch?.[1]) return scriptMatch[1]
  return null
}

function toPlain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 内图（dive / 任务）跑完后，把 boundary 出口抬到父图宿主实例的 runStates。
 * 与外层「Cook 子图」写回宿主 outputs 对齐，使预览与「执行当前」可复用缓存。
 */
export async function liftHostOutputsFromInnerGraph(
  assetId: string,
  innerDoc: GraphDocument,
  innerStates: Record<string, GraphNodeRunState>
): Promise<void> {
  const id = assetId.trim()
  if (!id) return

  const liveParentHostIds = new Set<string>()
  const liveParentAssetIds = new Set<string>()

  for (const { hostId, document } of graphEditorHosts.listLiveEntries()) {
    if (isInnerGraphHostId(hostId, id)) continue
    const lifts = collectHostOutputLifts(id, innerDoc, innerStates, document)
    if (!lifts.length) continue

    const runHost = graphRunHosts.get(hostId)
    if (runHost) {
      for (const lift of lifts) {
        const prev = runHost.runStates[lift.hostNodeId]
        runHost.runStates[lift.hostNodeId] = {
          ...(prev ?? {}),
          status: 'done',
          outputs: lift.outputs,
          error: undefined
        }
      }
    }
    // 实时编辑器同步：把抬升后的 runStates + params 图库一并写入宿主文档，
    // 外层端口预览与「不 cook 单跑复用」立即可见。
    graphEditorHosts.applyExternalGraph(hostId, withHostOutputLifts(toPlain(document), lifts))
    liveParentHostIds.add(hostId)
    const parentAssetId = parentAssetIdFromHostId(hostId)
    if (parentAssetId) liveParentAssetIds.add(parentAssetId)
  }

  for (const hostId of liveParentHostIds) {
    await graphEditorHosts.flush(hostId)
  }
  if (liveParentHostIds.size) graphEditorHosts.bumpRevision()

  const project = useProjectStore()
  const drafts = useDraftStore()

  const persistParent = async (
    parentAssetId: string,
    prevParams: Record<string, unknown>,
    rawDoc: unknown
  ): Promise<void> => {
    if (liveParentAssetIds.has(parentAssetId)) return
    if (!rawDoc || typeof rawDoc !== 'object') return
    const doc = rawDoc as GraphDocument
    if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) return
    const lifts = collectHostOutputLifts(id, innerDoc, innerStates, doc)
    if (!lifts.length) return
    const next = withHostOutputLifts(doc, lifts)
    await persistAssetRecord(parentAssetId, {
      genParams: { ...prevParams, graphJson: toPlain(next) }
    })
  }

  for (const asset of project.assets) {
    if (asset.id === id) continue
    await persistParent(
      asset.id,
      (asset.genParams as Record<string, unknown> | undefined) ?? {},
      asset.genParams?.graphJson
    )
  }
  for (const draft of drafts.drafts) {
    if (draft.id === id || !isDraftAssetId(draft.id)) continue
    await persistParent(
      draft.id,
      (draft.genParams as Record<string, unknown> | undefined) ?? {},
      draft.genParams?.graphJson
    )
  }
}
