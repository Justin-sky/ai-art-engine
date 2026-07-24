import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue'
import {
  cloneGraphDocument,
  createDefaultGraph,
  normalizeAssetGraph,
  type GraphDocument,
  type GraphNodeParams
} from '@shared/graph'
import { toPlain } from '../../utils/toPlain'
import { persistAssetRecord } from '../../composables/useAssetRecord'
import { useProjectStore } from '../../stores/project'
import {
  buildIncomingEdgeRefs,
  graphEditorHosts,
  reorderIncomingEdgesByIds
} from '../graph/model/graphEditorHosts'

/**
 * 独立舞台窗口没有 NodeGraphEditor，这里用资产里的 graphJson 注册轻量 host，
 * 以便读取模型入边、写回机位 viewer。
 */
export function useDirectorStageGraphHost(directorAssetId: Ref<string>): {
  ready: Ref<boolean>
} {
  const project = useProjectStore()
  const ready = ref(false)
  const document = shallowRef<GraphDocument>(createDefaultGraph())
  let unregister: (() => void) | null = null
  let saveTimer: ReturnType<typeof setTimeout> | null = null
  let registeredHostId: string | null = null

  function readGraphFromAsset(assetId: string): GraphDocument {
    const asset = project.assets.find((item) => item.id === assetId)
    const raw = asset?.genParams?.graphJson
    if (raw && typeof raw === 'object') {
      return normalizeAssetGraph(cloneGraphDocument(raw as GraphDocument), asset?.type ?? 'motion')
    }
    return createDefaultGraph()
  }

  function currentGenParams(assetId: string): Record<string, unknown> {
    return { ...(project.assets.find((item) => item.id === assetId)?.genParams ?? {}) }
  }

  function schedulePersistGraph(assetId: string): void {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = null
      void persistAssetRecord(
        assetId,
        {
          genParams: {
            ...currentGenParams(assetId),
            graphJson: toPlain(document.value)
          }
        },
        { recordCommand: false, label: 'Sync director graph from stage window' }
      )
    }, 200)
  }

  async function flushGraph(assetId: string): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    await persistAssetRecord(
      assetId,
      {
        genParams: {
          ...currentGenParams(assetId),
          graphJson: toPlain(document.value)
        }
      },
      { recordCommand: false, label: 'Flush director graph from stage window' }
    )
  }

  function teardown(): void {
    const assetId = registeredHostId
    if (saveTimer && assetId) {
      clearTimeout(saveTimer)
      saveTimer = null
      void persistAssetRecord(
        assetId,
        {
          genParams: {
            ...currentGenParams(assetId),
            graphJson: toPlain(document.value)
          }
        },
        { recordCommand: false, label: 'Flush director graph from stage window' }
      ).catch(() => {
        /* 卸载阶段尽力落盘 */
      })
    } else if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    unregister?.()
    unregister = null
    registeredHostId = null
    ready.value = false
  }

  function ensureHost(assetId: string): void {
    if (!assetId || !project.assets.some((item) => item.id === assetId)) {
      teardown()
      return
    }
    if (registeredHostId === assetId && unregister) {
      ready.value = true
      return
    }
    teardown()
    document.value = readGraphFromAsset(assetId)
    const hostId = `asset:${assetId}`
    registeredHostId = assetId
    unregister = graphEditorHosts.register(hostId, {
      getNode: (nodeId) => document.value.nodes.find((n) => n.id === nodeId) ?? null,
      findNode: (predicate) => document.value.nodes.find(predicate) ?? null,
      listIncomingEdges: (nodeId, portId) =>
        buildIncomingEdgeRefs(document.value.edges, nodeId, portId),
      removeEdge: (edgeId) => {
        if (!document.value.edges.some((edge) => edge.id === edgeId)) return
        document.value = {
          ...document.value,
          edges: document.value.edges.filter((edge) => edge.id !== edgeId)
        }
        schedulePersistGraph(assetId)
        graphEditorHosts.bumpRevision()
      },
      reorderIncomingEdges: (nodeId, orderedEdgeIds) => {
        const next = reorderIncomingEdgesByIds(document.value.edges, nodeId, orderedEdgeIds)
        if (!next) return
        document.value = { ...document.value, edges: next }
        schedulePersistGraph(assetId)
        graphEditorHosts.bumpRevision()
      },
      updateNode: (nodeId, params: Partial<GraphNodeParams>, title?: string) => {
        const node = document.value.nodes.find((n) => n.id === nodeId)
        if (!node) return
        node.params = { ...node.params, ...params }
        if (title !== undefined) node.title = title
        schedulePersistGraph(assetId)
        graphEditorHosts.bumpRevision()
      },
      setNodeAsset: () => {
        /* 舞台窗口不改节点资产绑定 */
      },
      flush: () => flushGraph(assetId)
    })
    graphEditorHosts.bumpRevision()
    ready.value = true
  }

  watch(
    () => [directorAssetId.value, project.assets.find((item) => item.id === directorAssetId.value)?.id] as const,
    () => ensureHost(directorAssetId.value),
    { immediate: true }
  )

  watch(
    () => project.assets.find((item) => item.id === directorAssetId.value)?.updatedAt,
    () => {
      const assetId = directorAssetId.value
      if (!assetId || !unregister || saveTimer) return
      document.value = readGraphFromAsset(assetId)
      graphEditorHosts.bumpRevision()
    }
  )

  onBeforeUnmount(() => {
    teardown()
  })

  return { ready }
}
