import type { Ref } from 'vue'
import type { GraphNodeRunState } from '@shared/graph'

export interface GraphRunHostApi {
  /** 与 useGraphRunSession.runStates 同一 reactive 对象 */
  runStates: Record<string, GraphNodeRunState>
  isRunning: Ref<boolean>
  runningTargetNodeId: Ref<string | null>
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
    return hostId ? this.hosts.get(hostId) ?? null : null
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
