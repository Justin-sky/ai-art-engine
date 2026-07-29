export interface EditorDiveFlushHost {
  flush: () => void | Promise<void>
}

class EditorDiveFlushRegistry {
  private hosts = new Map<string, EditorDiveFlushHost>()

  register(frameKey: string, api: EditorDiveFlushHost): () => void {
    const key = frameKey.trim()
    if (!key) return () => undefined
    this.hosts.set(key, api)
    return () => {
      if (this.hosts.get(key) === api) this.hosts.delete(key)
    }
  }

  async flush(frameKey: string): Promise<void> {
    const key = frameKey.trim()
    if (!key) return
    const host = this.hosts.get(key)
    if (!host) return
    try {
      await host.flush()
    } catch (err) {
      console.error('[EditorDiveFlush] flush failed', key, err)
    }
  }
}

export const editorDiveFlush = new EditorDiveFlushRegistry()
