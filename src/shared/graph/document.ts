import type { GraphDocument, GraphNodeParams } from './types'
import { copyDocumentRunStates } from './runStatePersist'

function cloneNodeParams(params: GraphNodeParams | undefined): GraphNodeParams {
  const source = params ?? {}
  try {
    return structuredClone(source)
  } catch {
    // Vue reactive Proxy 等不可 structuredClone 时回退 JSON
    return JSON.parse(JSON.stringify(source)) as GraphNodeParams
  }
}

export function cloneGraphDocument(document: GraphDocument): GraphDocument {
  return {
    nodes: document.nodes.map((node) => ({
      ...node,
      position: { ...node.position },
      size: node.size ? { ...node.size } : undefined,
      // params 内数组/对象需深拷贝，避免与 live 图共享 generatedImages 等引用
      params: cloneNodeParams(node.params)
    })),
    edges: document.edges.map((edge) => ({ ...edge })),
    groups: (document.groups ?? []).map((group) => ({ ...group })),
    viewport: { ...document.viewport },
    runStates: copyDocumentRunStates(document)
  }
}

/** 保持 reactive 根对象身份，替换内部文档内容。 */
export function replaceGraphDocument(target: GraphDocument, source: GraphDocument): void {
  const next = cloneGraphDocument(source)
  target.nodes.splice(0, target.nodes.length, ...next.nodes)
  target.edges.splice(0, target.edges.length, ...next.edges)
  if (!target.groups) target.groups = []
  target.groups.splice(0, target.groups.length, ...(next.groups ?? []))
  Object.assign(target.viewport, next.viewport)
  target.runStates = next.runStates
}

export function graphDocumentsEqual(a: GraphDocument, b: GraphDocument): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}
