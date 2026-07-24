import type { ShotAudioRef, ShotGenRef } from '../domain'
import { ensureBuiltinNodeTypes } from './builtinState'
import { collectAssetValuesUpstream } from './collect'
import { findOutputNode } from './query'
import { contributionFromAssets, nodeToAssetValue } from './execute/values'
import type { GraphAssetValue } from './execute/types'
import { isProcessingAssetNode } from './nodeRole'
import { findShotWorkflowVideoNode, listVideoMentionContribution } from './shotVideoBridge'
import type { GraphDocument } from './types'
import { GRAPH_OUTPUT_NODE_IDS } from './types'

/**
 * 分镜/图生成引用贡献。
 * 优先从 shotWorkflow 的 asset.video 非帧入边收集（与 @n / 指令条一致）；
 * 无视频加工节点时回退为「连到输出」的上游资产。
 */
export function graphToGenerationContribution(graph: GraphDocument): {
  genRefs: ShotGenRef[]
  audioRefs: ShotAudioRef[]
} {
  ensureBuiltinNodeTypes()
  if (findShotWorkflowVideoNode(graph)) {
    return listVideoMentionContribution(graph)
  }

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
