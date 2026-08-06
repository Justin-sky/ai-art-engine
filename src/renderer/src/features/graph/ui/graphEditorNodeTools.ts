import type { EditorDiveNodeToolViewId } from '../model/editorDive'
import type { GraphEditorDialogsApi } from './graphEditorDialogsKey'
import { ref } from 'vue'

export type GraphNodeToolOpener = (nodeId: string, mode?: string) => void | Promise<void>

export type GraphNodeToolHost = {
  api: GraphEditorDialogsApi
  openers: Partial<Record<EditorDiveNodeToolViewId, GraphNodeToolOpener>>
}

class GraphEditorNodeToolRegistry {
  private hosts = new Map<string, GraphNodeToolHost>()
  /** 注册/注销版本号：宿主编辑器可能晚于 dive 工具视图挂载，需驱动 computed 重新读取 */
  readonly revision = ref(0)

  register(hostId: string, host: GraphNodeToolHost): () => void {
    const id = hostId.trim()
    if (!id) return () => undefined
    this.hosts.set(id, host)
    this.revision.value += 1
    return () => {
      if (this.hosts.get(id) === host) {
        this.hosts.delete(id)
        this.revision.value += 1
      }
    }
  }

  get(hostId: string | null | undefined): GraphNodeToolHost | null {
    const id = hostId?.trim()
    if (!id) return null
    return this.hosts.get(id) ?? null
  }

  async open(
    hostId: string,
    viewId: EditorDiveNodeToolViewId,
    nodeId: string,
    mode?: string
  ): Promise<boolean> {
    const host = this.get(hostId)
    const opener = host?.openers[viewId]
    if (!opener) return false
    await opener(nodeId, mode)
    return true
  }
}

export const graphEditorNodeTools = new GraphEditorNodeToolRegistry()
