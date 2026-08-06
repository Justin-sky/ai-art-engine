import { ensureBuiltinNodeTypes } from './builtinState'
import { collectAssetValuesUpstream } from './collect'
import { findOutputNode } from './query'
import { contributionFromAssets, nodeToAssetValue } from './execute/values'
import type { GraphAssetValue } from './execute/types'
import { isProcessingAssetNode } from './nodeRole'
import type { GraphDocument } from './types'
import { GRAPH_OUTPUT_NODE_IDS } from './types'

/**
 * 图生成引用贡献。
 * 从「连到输出」的上游资产收集生成引用。
 */
export function graphToGenerationContribution(graph: GraphDocument): {
  genRefs: Array<{
    role: string
    assetId: string
    refIndex: number
    label?: string
    weight?: number
  }>
  audioRefs: Array<{
    kind: string
    assetId?: string
    text?: string
    refIndex?: number
  }>
} {
  ensureBuiltinNodeTypes()

  const outputId = findOutputNode(graph)?.id ?? GRAPH_OUTPUT_NODE_IDS.video
  const values: GraphAssetValue[] = []

  for (const edge of graph.edges.filter((item) => item.target === outputId)) {
    const source = graph.nodes.find((node) => node.id === edge.source)
    if (!source) continue
    if (source.category === 'asset' && source.assetId) {
      const value = nodeToAssetValue(source)
      if (value) values.push(value)
      continue
    }
    if (isProcessingAssetNode(source)) {
      values.push(...collectAssetValuesUpstream(graph, source))
    }
  }

  return contributionFromAssets(values)
}
