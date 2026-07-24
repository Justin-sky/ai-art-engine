import { nodeToAssetValue } from './execute/values'
import { isProcessingAssetNode } from './nodeRole'
import type { GraphAssetValue } from './execute/types'
import type { GraphDocument, GraphNode } from './types'

function directTextFromNode(node: GraphNode): string | undefined {
  if (node.typeId !== 'play.script') return undefined
  const text = node.params.text?.trim()
  return text || undefined
}

/** 收集节点直接连入的 play.script 文本（与执行器 flattenTextValues 对齐） */
export function collectDirectTextInputs(graph: GraphDocument, nodeId: string): string {
  const parts: string[] = []
  for (const edge of graph.edges) {
    if (edge.target !== nodeId) continue
    const source = graph.nodes.find((item) => item.id === edge.source)
    if (!source) continue
    const text = directTextFromNode(source)
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

function applyProcessingParams(
  value: GraphAssetValue,
  node: GraphNode,
  incomingText: string
): GraphAssetValue {
  const notes = [node.params.notes, value.notes, incomingText].filter(Boolean).join('\n') || undefined
  return {
    ...value,
    label: node.params.label ?? value.label,
    weight: node.params.weight ?? value.weight,
    volume: node.params.volume ?? value.volume,
    muted: node.params.muted ?? value.muted,
    notes,
    title: node.title ?? value.title
  }
}

/** 静态收集加工节点上游资产值（含直接文本输入合并到 notes） */
export function collectAssetValuesUpstream(
  graph: GraphDocument,
  node: GraphNode
): GraphAssetValue[] {
  const incoming = graph.edges.filter((edge) => edge.target === node.id)
  const values: GraphAssetValue[] = []

  for (const edge of incoming) {
    const source = graph.nodes.find((item) => item.id === edge.source)
    if (!source) continue
    if (source.category === 'asset' && source.assetId) {
      const value = nodeToAssetValue(source)
      if (value) values.push(value)
      continue
    }
    if (isProcessingAssetNode(source)) {
      const incomingText = collectDirectTextInputs(graph, source.id)
      values.push(
        ...collectAssetValuesUpstream(graph, source).map((value) =>
          applyProcessingParams(value, source, incomingText)
        )
      )
    }
  }
  return values
}
