import { isProcessingAssetNode } from './nodeRole'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphValue } from './types'

function normalizePlaceholderText(raw: string | undefined): string {
  const localRaw = raw?.trim() ?? ''
  return localRaw === '…' || localRaw === '...' ? '' : localRaw
}

function findScreenplayProcessingNode(graphJson: unknown): GraphNode | null {
  if (!graphJson || typeof graphJson !== 'object') return null
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return null
  return (
    nodes.find(
      (node) => isProcessingAssetNode(node) && node.assetType === 'screenplay'
    ) ?? null
  )
}

function textFromGraphValue(value: GraphValue | undefined): string {
  if (!value) return ''
  if (value.kind === 'text') return value.text.trim()
  if (value.kind === 'texts') {
    return value.items
      .map((item) => item.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

/** 收集剧本图内 generatedTexts / runStates 上的旁挂正文路径（txt/md） */
export function collectScreenplayTextRelativePaths(graphJson: unknown): string[] {
  if (!graphJson || typeof graphJson !== 'object') return []
  const doc = graphJson as GraphDocument
  const paths: string[] = []
  const push = (raw?: string): void => {
    const path = raw?.trim() ?? ''
    if (!path || paths.includes(path)) return
    paths.push(path)
  }

  const processing = findScreenplayProcessingNode(graphJson)
  for (const item of processing?.params.generatedTexts ?? []) {
    push(item.relativePath)
  }

  const runStates = doc.runStates
  if (runStates && typeof runStates === 'object') {
    for (const state of Object.values(runStates)) {
      const out = state?.outputs?.out
      if (out?.kind === 'texts') {
        for (const item of out.items) push(item.relativePath)
      }
    }
  }
  return paths
}

function textFromGraphNodes(graphJson: unknown): string {
  if (!graphJson || typeof graphJson !== 'object') return ''
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return ''

  const processing = findScreenplayProcessingNode(graphJson)
  const processingText = normalizePlaceholderText(processing?.params.text)
  if (processingText) return processingText

  // 落盘后 generatedTexts 可能仍带内嵌正文
  const fromGenerated = (processing?.params.generatedTexts ?? [])
    .map((item) => item.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
  if (fromGenerated) return fromGenerated

  const runOut = processing
    ? textFromGraphValue(
        (graphJson as GraphDocument).runStates?.[processing.id]?.outputs?.out
      )
    : ''
  if (runOut) return runOut

  const output = nodes.find(
    (node) =>
      node.category === 'output' &&
      (node.typeId === 'output.text' ||
        node.params.outputKind === 'text' ||
        typeof node.params.resultText === 'string')
  )
  const resultText = output?.params.resultText?.trim() ?? ''
  if (resultText) return resultText

  const noteParts = nodes
    .filter((node) => node.typeId === 'play.script' || node.typeId === 'note.text')
    .map((node) => normalizePlaceholderText(node.params.text))
    .filter(Boolean)
  return noteParts.join('\n\n')
}

/**
 * 从 genParams / 节点 params 解析文本（分镜等无旁挂文件的资产）。
 * 剧本正文以旁挂 txt 为准，应走 resolveAssetText。
 */
export function resolveAssetTextFromGenParams(
  genParams?: Record<string, unknown> | null,
  nodeParams?: Pick<GraphNodeParams, 'text'> | null
): string {
  const fromNode = normalizePlaceholderText(nodeParams?.text)
  if (fromNode) return fromNode
  return textFromGraphNodes(genParams?.graphJson)
}
