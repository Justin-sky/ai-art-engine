import type { EditorDiveNodeToolViewId } from '../model/editorDive'
import type { GraphEditorDialogsApi } from './graphEditorDialogsKey'

export type GraphNodeToolOpener = (nodeId: string, mode?: string) => void | Promise<void>

export type GraphNodeToolHost = {
  api: GraphEditorDialogsApi
  openers: Partial<Record<EditorDiveNodeToolViewId, GraphNodeToolOpener>>
}

class GraphEditorNodeToolRegistry {
  private hosts = new Map<string, GraphNodeToolHost>()

  register(hostId: string, host: GraphNodeToolHost): () => void {
    const id = hostId.trim()
    if (!id) return () => undefined
    this.hosts.set(id, host)
    return () => {
      if (this.hosts.get(id) === host) this.hosts.delete(id)
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
