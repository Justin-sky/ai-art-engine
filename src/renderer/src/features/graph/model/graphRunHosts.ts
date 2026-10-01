import type { Ref } from 'vue'
import type { GraphNodeRunState } from '@shared/graph'

export interface GraphRunHostApi {
  /** 与 useGraphRunSession.runStates 同一 reactive 对象 */
  runStates: Record<string, GraphNodeRunState>
  isRunning: Ref<boolean>
  runningTargetNodeId: Ref<string | null>
  /**
   * 与画布上进行中运行冲突、因而不能单独启动新运行的节点。
   * 并行的其它链上的节点不在此集合内。
   */
  blockedNodeIds: Ref<ReadonlySet<string>>
  /** 进行中运行此刻正在写状态的节点并集（含待执行）；这些节点的状态不可被外部覆盖 */
  activeRunNodeIds: Ref<ReadonlySet<string>>
  runToNode: (nodeId: string) => Promise<unknown>
  stopWorkflow: () => void
  toggleNodeRun: (nodeId: string) => void
}

class GraphRunHostRegistry {
  private readonly hosts = new Map<string, GraphRunHostApi>()

  register(hostId: string, api: GraphRunHostApi): () => void {
    this.hosts.set(hostId, api)
    return () => {
      if (this.hosts.get(hostId) === api) this.hosts.delete(hostId)
    }
  }

  get(hostId: string | null | undefined): GraphRunHostApi | null {
    return hostId ? (this.hosts.get(hostId) ?? null) : null
  }

  /** 某资产编辑器下是否有节点图正在执行（含 script/asset 及 scope 后缀） */
  isRunningForAsset(assetId: string): boolean {
    if (!assetId) return false
    const prefixes = [`script:${assetId}`, `asset:${assetId}`]
    for (const [hostId, api] of this.hosts) {
      const matched = prefixes.some(
        (prefix) => hostId === prefix || hostId.startsWith(`${prefix}:`)
      )
      if (matched && api.isRunning.value) return true
    }
    return false
  }

  reset(): void {
    this.hosts.clear()
  }
}

export const graphRunHosts = new GraphRunHostRegistry()
