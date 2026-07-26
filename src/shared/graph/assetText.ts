import { isProcessingAssetNode } from './nodeRole'
import { findOutputNode } from './query'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphValue } from './types'

function normalizePlaceholderText(raw: string | undefined): string {
  const localRaw = raw?.trim() ?? ''
  return localRaw === '…' || localRaw === '...' ? '' : localRaw
}

function findAllScreenplayProcessingNodes(graphJson: unknown): GraphNode[] {
  if (!graphJson || typeof graphJson !== 'object') return []
  const nodes = (graphJson as GraphDocument).nodes
  if (!Array.isArray(nodes)) return []
  return nodes.filter(
    (node) => isProcessingAssetNode(node) && node.assetType === 'screenplay'
  )
}

function findScreenplayProcessingNode(graphJson: unknown): GraphNode | null {
  return findAllScreenplayProcessingNodes(graphJson)[0] ?? null
}

function isTextOutputNode(node: GraphNode): boolean {
  return (
    node.category === 'output' &&
    (node.typeId === 'output.text' ||
      node.params.outputKind === 'text' ||
      typeof node.params.resultText === 'string')
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
  if (value.kind === 'output') {
    if (value.texts?.length) {
      return value.texts
        .map((item) => item.text?.trim() ?? '')
        .filter(Boolean)
        .join('\n\n')
    }
    return (value.notes ?? [])
      .map((item) => item.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n')
  }
  return ''
}

function pushRelativePath(paths: string[], raw?: string): void {
  const path = raw?.trim() ?? ''
  if (!path || paths.includes(path)) return
  paths.push(path)
}

function collectPathsFromValue(value: GraphValue | undefined, paths: string[]): void {
  if (!value) return
  if (value.kind === 'texts') {
    for (const item of value.items) pushRelativePath(paths, item.relativePath)
    return
  }
  if (value.kind === 'output' && value.texts?.length) {
    for (const item of value.texts) pushRelativePath(paths, item.relativePath)
  }
}

function collectPathsFromNode(doc: GraphDocument, node: GraphNode | null, paths: string[]): void {
  if (!node) return
  for (const item of node.params.generatedTexts ?? []) {
    pushRelativePath(paths, item.relativePath)
  }
  collectPathsFromValue(doc.runStates?.[node.id]?.outputs?.out, paths)
}

function textFromNode(doc: GraphDocument, node: GraphNode | null): string {
  if (!node) return ''

  if (isTextOutputNode(node)) {
    const resultText = node.params.resultText?.trim() ?? ''
    if (resultText) return resultText
    const live = textFromGraphValue(doc.runStates?.[node.id]?.outputs?.out)
    if (live) return live
    const fromGenerated = (node.params.generatedTexts ?? [])
      .map((item) => item.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n')
    if (fromGenerated) return fromGenerated
    return ''
  }

  const processingText = normalizePlaceholderText(node.params.text)
  if (processingText) return processingText

  const fromGenerated = (node.params.generatedTexts ?? [])
    .map((item) => item.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
  if (fromGenerated) return fromGenerated

  return textFromGraphValue(doc.runStates?.[node.id]?.outputs?.out)
}

/** 收集剧本图内旁挂正文路径：以文本输出节点为准，再回退上游 / 生成节点 */
export function collectScreenplayTextRelativePaths(graphJson: unknown): string[] {
  if (!graphJson || typeof graphJson !== 'object') return []
  const doc = graphJson as GraphDocument
  const paths: string[] = []

  const output = findOutputNode(doc)
  if (output && isTextOutputNode(output)) {
    collectPathsFromNode(doc, output, paths)
    if (paths.length) return paths

    const sourceIds = [
      ...new Set(doc.edges.filter((edge) => edge.target === output.id).map((edge) => edge.source))
    ]
    for (const id of sourceIds) {
      collectPathsFromNode(doc, doc.nodes.find((n) => n.id === id) ?? null, paths)
    }
    if (paths.length) return paths
  }

  for (const node of findAllScreenplayProcessingNodes(graphJson)) {
    collectPathsFromNode(doc, node, paths)
  }
  return paths
}

function textFromGraphNodes(graphJson: unknown): string {
  if (!graphJson || typeof graphJson !== 'object') return ''
  const doc = graphJson as GraphDocument
  const nodes = doc.nodes
  if (!Array.isArray(nodes)) return ''

  const output = findOutputNode(doc)
  if (output && isTextOutputNode(output)) {
    const fromOutput = textFromNode(doc, output)
    if (fromOutput) return fromOutput

    const sourceIds = [
      ...new Set(doc.edges.filter((edge) => edge.target === output.id).map((edge) => edge.source))
    ]
    const fromSources = sourceIds
      .map((id) => textFromNode(doc, doc.nodes.find((n) => n.id === id) ?? null))
      .filter(Boolean)
      .join('\n\n')
    if (fromSources) return fromSources
  }

  const fromProcessing = findAllScreenplayProcessingNodes(graphJson)
    .map((node) => textFromNode(doc, node))
    .filter(Boolean)
    .join('\n\n')
  if (fromProcessing) return fromProcessing

  // 兼容旧图：无明确文本输出时仍读第一个加工节点
  const processing = findScreenplayProcessingNode(graphJson)
  const legacy = textFromNode(doc, processing)
  if (legacy) return legacy

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
