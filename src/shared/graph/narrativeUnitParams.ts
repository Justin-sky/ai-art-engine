import type { GraphTextItem } from './execute/types'
import type { GraphDocument, GraphNode, GraphNodeParams, GraphValue } from './types'
import { createNodeFromType } from './create'
import { findOutputNode } from './query'
import type { NarrativeUnitRow } from './narrativeUnitParse'

/** narrative 资产 genParams 中存放各单元细化图的键 */
export const NARRATIVE_UNIT_GRAPHS_PARAM_KEY = 'narrativeUnitGraphs'

export type NarrativeUnitGraphs = Record<string, GraphDocument>

export function readNarrativeUnitGraphsFromGenParams(
  genParams?: Record<string, unknown> | null
): NarrativeUnitGraphs {
  const raw = genParams?.[NARRATIVE_UNIT_GRAPHS_PARAM_KEY]
  if (!raw || typeof raw !== 'object') return {}
  const out: NarrativeUnitGraphs = {}
  for (const [id, doc] of Object.entries(raw as Record<string, unknown>)) {
    if (doc && typeof doc === 'object') out[id] = doc as GraphDocument
  }
  return out
}

export function readNarrativeUnitGraphFromGenParams(
  genParams: Record<string, unknown> | null | undefined,
  unitId: string
): GraphDocument | null {
  const id = unitId.trim()
  if (!id) return null
  return readNarrativeUnitGraphsFromGenParams(genParams)[id] ?? null
}

export function withNarrativeUnitGraph(
  genParams: Record<string, unknown> | null | undefined,
  unitId: string,
  graph: GraphDocument
): Record<string, unknown> {
  const id = unitId.trim()
  const prev = readNarrativeUnitGraphsFromGenParams(genParams)
  return {
    ...(genParams ?? {}),
    [NARRATIVE_UNIT_GRAPHS_PARAM_KEY]: {
      ...prev,
      [id]: graph
    }
  }
}

export function readBoundUnitIdFromNodeParams(
  params: GraphNodeParams | undefined | null
): string | undefined {
  const id = params?.boundUnitId?.trim()
  return id || undefined
}

function worldRefNames(refs: NarrativeUnitRow['characters']): string {
  return refs.map((ref) => ref.name.trim()).filter(Boolean).join('、')
}

/** 参考节点输出：单元目录字段拼成可读文本 */
export function formatNarrativeUnitRefText(unit: NarrativeUnitRow): string {
  const lines: string[] = []
  const title = unit.title.trim() || 'Untitled'
  lines.push(`#${unit.order} ${title}`)
  if (unit.dramaticFunction.trim()) lines.push(`戏剧功能：${unit.dramaticFunction.trim()}`)
  const characters = worldRefNames(unit.characters)
  if (characters) lines.push(`角色：${characters}`)
  const scenes = worldRefNames(unit.scenes)
  if (scenes) lines.push(`场景：${scenes}`)
  const props = worldRefNames(unit.props)
  if (props) lines.push(`道具：${props}`)
  const weapons = worldRefNames(unit.weapons)
  if (weapons) lines.push(`武器：${weapons}`)
  if (unit.emotionalBeat.trim()) lines.push(`情绪节拍：${unit.emotionalBeat.trim()}`)
  if (unit.summary.trim()) lines.push(`摘要：${unit.summary.trim()}`)
  if (unit.sourceExcerpt.trim()) lines.push(`原文摘录：${unit.sourceExcerpt.trim()}`)
  if (unit.durationHint.trim()) lines.push(`时长提示：${unit.durationHint.trim()}`)
  return lines.join('\n')
}

export function createNarrativeUnitRefNode(
  unit: NarrativeUnitRow,
  position: { x: number; y: number },
  options?: { title?: string }
): GraphNode {
  const title = options?.title?.trim() || unit.title.trim() || 'Narrative ref'
  return createNodeFromType('narrative.unitRef', position, {
    title,
    params: { boundUnitId: unit.id }
  })
}

/**
 * 旧版默认「生成指令」正文（曾写在指令窗口）。
 * 现已迁入系统提示词；执行/Inspector 遇到此文案视为未配置指令。
 */
export const LEGACY_NARRATIVE_UNIT_GEN_INSTRUCTION = `基于上游叙事单元参考，对该单元的主题、故事脉络与环境氛围做深度细化。
要求：
1. 保留角色关系与戏剧功能，不改写既定结局走向；
2. 补足场景空间、时代感、物件与氛围细节，便于后续分镜与视觉；
3. 输出条理清晰的中文细化正文（可含小标题），不要输出 JSON。`

/** @deprecated 使用 LEGACY_NARRATIVE_UNIT_GEN_INSTRUCTION；新节点指令窗口默认为空 */
export const DEFAULT_NARRATIVE_UNIT_GEN_INSTRUCTION = LEGACY_NARRATIVE_UNIT_GEN_INSTRUCTION

export function isLegacyNarrativeUnitGenInstruction(raw: string | undefined | null): boolean {
  return (raw?.trim() ?? '') === LEGACY_NARRATIVE_UNIT_GEN_INSTRUCTION.trim()
}

/** 叙事生成节点默认参数：规则在系统提示词，指令窗口留给临时焦点 */
export function defaultNarrativeUnitGenParams(): Pick<
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
    return {
      text: resultText,
      ...(relativePath ? { relativePath } : {})
    }
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
    return {
      text: fromLive,
      ...(livePath ? { relativePath: livePath } : {})
    }
  }

  const localText = node.params.text?.trim() ?? ''
  if (localText && localText !== '…' && localText !== '...') {
    return { text: localText }
  }

  return null
}

/**
 * 从叙事单元细化图收集「叙事输出」文本（不级联跑生成）。
 * 优先 output.narrativeUnit，再回退上游 / narrative.unitGen。
 */
export function collectTextFromNarrativeUnitGraph(
  doc: GraphDocument | null | undefined
): GraphTextItem | null {
  if (!doc?.nodes?.length) return null

  const output =
    doc.nodes.find((node) => node.typeId === 'output.narrativeUnit') ?? findOutputNode(doc)

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

  const unitGen = doc.nodes.find((node) => node.typeId === 'narrative.unitGen')
  const fromGen = collectTextItemFromNode(doc, unitGen)
  if (fromGen?.text.trim() || fromGen?.relativePath?.trim()) return fromGen
  return null
}
