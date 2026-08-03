import type { GraphTextItem } from './execute/types'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphValue } from './types'
import { createNodeFromType } from './create'
import { findOutputNode } from './query'
import type { BeatRow } from './beatParse'

/** beat 资产 genParams 中存放各场细化图的键 */
export const BEAT_GRAPHS_PARAM_KEY = 'beatGraphs'

export type BeatGraphs = Record<string, GraphDocument>

export function readBeatGraphsFromGenParams(
  genParams?: Record<string, unknown> | null
): BeatGraphs {
  const raw = genParams?.[BEAT_GRAPHS_PARAM_KEY]
  if (!raw || typeof raw !== 'object') return {}
  const out: BeatGraphs = {}
  for (const [id, doc] of Object.entries(raw as Record<string, unknown>)) {
    if (doc && typeof doc === 'object') out[id] = doc as GraphDocument
  }
  return out
}

export function readBeatGraphFromGenParams(
  genParams: Record<string, unknown> | null | undefined,
  beatId: string
): GraphDocument | null {
  const id = beatId.trim()
  if (!id) return null
  return readBeatGraphsFromGenParams(genParams)[id] ?? null
}

export function withBeatGraph(
  genParams: Record<string, unknown> | null | undefined,
  beatId: string,
  graph: GraphDocument
): Record<string, unknown> {
  const id = beatId.trim()
  const prev = readBeatGraphsFromGenParams(genParams)
  return {
    ...(genParams ?? {}),
    [BEAT_GRAPHS_PARAM_KEY]: {
      ...prev,
      [id]: graph
    }
  }
}

export function readBoundBeatIdFromNodeParams(
  params: GraphNodeParams | undefined | null
): string | undefined {
  const id = params?.boundBeatId?.trim()
  return id || undefined
}

function worldRefNames(refs: BeatRow['characters']): string {
  return refs.map((ref) => ref.name.trim()).filter(Boolean).join('、')
}

/** 参考节点输出：场目录字段拼成可读文本 */
export function formatBeatRefText(beat: BeatRow): string {
  const lines: string[] = []
  const title = beat.title.trim() || 'Untitled'
  lines.push(`#${beat.order} ${title}`)
  if (beat.time.trim()) lines.push(`时间：${beat.time.trim()}`)
  if (beat.durationHint.trim()) lines.push(`时长：${beat.durationHint.trim()}`)
  if (beat.location.trim()) lines.push(`空间与地点：${beat.location.trim()}`)
  const locations = worldRefNames(beat.locations)
  if (locations) lines.push(`地点绑定：${locations}`)
  const characters = worldRefNames(beat.characters)
  if (characters) lines.push(`角色：${characters}`)
  if (beat.action.trim()) lines.push(`核心动作：${beat.action.trim()}`)
  if (beat.conflict.trim()) lines.push(`冲突与目标：${beat.conflict.trim()}`)
  if (beat.atmosphere.trim()) lines.push(`氛围与声音：${beat.atmosphere.trim()}`)
  const props = worldRefNames(beat.props)
  if (props) lines.push(`道具：${props}`)
  const weapons = worldRefNames(beat.weapons)
  if (weapons) lines.push(`武器：${weapons}`)
  if (beat.sourceExcerpt.trim()) lines.push(`原文：${beat.sourceExcerpt.trim()}`)
  return lines.join('\n')
}

export function createBeatRefNode(
  beat: BeatRow,
  position: { x: number; y: number },
  options?: { title?: string }
): GraphNode {
  const title = options?.title?.trim() || beat.title.trim() || 'Beat ref'
  return createNodeFromType('beat.unitRef', position, {
    title,
    params: { boundBeatId: beat.id }
  })
}

/** 场生成节点默认参数：规则在系统提示词，指令窗口留给临时焦点 */
export function defaultBeatUnitGenParams(): Pick<
  GraphNodeParams,
  | 'text'
  | 'generateInstruction'
  | 'generateSystemPrompt'
  | 'generateModel'
  | 'generateProviderInstanceId'
> {
  return {
    text: '',
    generateInstruction: '',
    generateSystemPrompt: '',
    generateModel: '',
    generateProviderInstanceId: ''
  }
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

function relativePathFromGraphValue(value: GraphValue | undefined): string | undefined {
  if (!value) return undefined
  if (value.kind === 'texts') {
    return value.items.map((item) => item.relativePath?.trim()).find(Boolean)
  }
  if (value.kind === 'output' && value.texts?.length) {
    return value.texts.map((item) => item.relativePath?.trim()).find(Boolean)
  }
  return undefined
}

function collectTextItemFromNode(
  doc: GraphDocument,
  node: GraphNode | null | undefined
): GraphTextItem | null {
  if (!node) return null
  const resultText = node.params.resultText?.trim() ?? ''
  if (resultText) {
    const relativePath =
      node.params.previewRelativePath?.trim() ||
      node.params.generatedTexts?.map((item) => item.relativePath?.trim()).find(Boolean)
    return { text: resultText, ...(relativePath ? { relativePath } : {}) }
  }

  const generated = node.params.generatedTexts ?? []
  const fromGeneratedText = generated
    .map((item) => item.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n')
  const fromGeneratedPath = generated.map((item) => item.relativePath?.trim()).find(Boolean)
  if (fromGeneratedText || fromGeneratedPath) {
    return {
      text: fromGeneratedText,
      ...(fromGeneratedPath ? { relativePath: fromGeneratedPath } : {})
    }
  }

  const live = doc.runStates?.[node.id]?.outputs?.out
  const fromLive = textFromGraphValue(live)
  const livePath = relativePathFromGraphValue(live)
  if (fromLive || livePath) {
    return { text: fromLive, ...(livePath ? { relativePath: livePath } : {}) }
  }

  const localText = node.params.text?.trim() ?? ''
  if (localText && localText !== '…' && localText !== '...') return { text: localText }
  return null
}

/** 从场细化图收集「场输出」文本（不级联跑生成）。 */
export function collectTextFromBeatGraph(
  doc: GraphDocument | null | undefined
): GraphTextItem | null {
  if (!doc?.nodes?.length) return null

  const output = doc.nodes.find((node) => node.typeId === 'output.beatUnit') ?? findOutputNode(doc)
  if (output) {
    const fromOutput = collectTextItemFromNode(doc, output)
    if (fromOutput?.text.trim() || fromOutput?.relativePath?.trim()) return fromOutput
    const sourceIds = [
      ...new Set(doc.edges.filter((edge) => edge.target === output.id).map((edge) => edge.source))
    ]
    for (const id of sourceIds) {
      const fromSource = collectTextItemFromNode(
        doc,
        doc.nodes.find((node) => node.id === id) ?? null
      )
      if (fromSource?.text.trim() || fromSource?.relativePath?.trim()) return fromSource
    }
  }

  const beatGen = doc.nodes.find((node) => node.typeId === 'beat.unitGen')
  const fromGen = collectTextItemFromNode(doc, beatGen)
  if (fromGen?.text.trim() || fromGen?.relativePath?.trim()) return fromGen
  return null
}
