import type { GraphDocument, GraphNode } from '../types'
import type { InstructionPresetKind } from '../instructionPresets'
import {
  expandInstructionMentions,
  instructionHasMentions,
  shouldKeepInstructionMentionToken,
  type InstructionMentionSource
} from '../instructionMentions'
import {
  appendStyleImagesReferencePrompt,
  portMentionIndex,
  resolveStyleMentionReserveCount,
  type ProjectStyleImage,
  type StyleReferenceSubject
} from '../../domain'
import {
  resolveImageSystemPrompt,
  resolveVideoSystemPrompt,
  resolveOptimizeSystemPrompt,
  resolveScreenplaySystemPrompt,
  resolveWorldExtractSystemPrompt,
  resolveBeatSplitSystemPrompt,
  resolveBeatUnitGenSystemPrompt,
  resolveUiSplitSystemPrompt,
  resolveToPromptSystemPrompt,
  resolveVoiceSystemPrompt
} from '../systemPromptSchemes'
import { resolveReshootSystemPrompt, buildReshootPrompt } from '../reshoot'
import {
  buildImagePrompt,
  buildVideoPrompt,
  buildOptimizePrompt,
  buildScreenplayPrompt,
  buildWorldExtractPrompt,
  buildBeatSplitPrompt,
  buildBeatUnitGenPrompt,
  buildUiSplitPrompt,
  buildToPromptUserPrompt,
  buildVoicePrompt,
  buildFrameAnimGenPrompt
} from '../userPromptSchemes'
import { buildAnim2dGridInstruction, resolveFrameAnimGenSystemPrompt } from '../anim2d'
import { expandIncomingThroughBundles } from '../bundleExpand'
import { collectIncomingValues } from './incoming'
import { formatBeatRefText } from '../beatParams'
import { isProcessingAssetNode } from '../nodeRole'
import type { GraphValue, NodeExecuteContext } from './types'

export function normalizeLocalScreenplayText(raw: string | undefined): string {
  const localRaw = raw?.trim() ?? ''
  return localRaw === '…' || localRaw === '...' ? '' : localRaw
}

export type InstructionFinalPreviewKind =
  | 'screenplay'
  | 'image'
  | 'video'
  | 'reshoot'
  | 'voice'
  | 'optimize'
  | 'toPrompt'
  | 'worldExtract'
  | 'beatSplit'
  | 'beatUnitGen'
  | 'uiSplit'
  | 'frameAnimGen'

/** 按节点 typeId / assetType / 编辑器 preset 解析预览种类 */
export function resolveInstructionFinalPreviewKind(
  node: Pick<GraphNode, 'typeId' | 'assetType'> | null | undefined,
  presetKind?: InstructionPresetKind | null
): InstructionFinalPreviewKind {
  const typeId = node?.typeId
  if (typeId === 'prompt.optimize' || presetKind === 'optimize') return 'optimize'
  if (typeId === 'image.toPrompt' || presetKind === 'toPrompt') return 'toPrompt'
  if (typeId === 'world.extract' || presetKind === 'worldExtract') return 'worldExtract'
  if (typeId === 'beat.split' || presetKind === 'beatSplit') {
    return 'beatSplit'
  }
  if (typeId === 'beat.unitGen' || presetKind === 'beatUnitGen') {
    return 'beatUnitGen'
  }
  if (typeId === 'ui.split' || presetKind === 'uiSplit') {
    return 'uiSplit'
  }
  if (typeId === 'frame.animGen' || presetKind === 'frameAnimGen') {
    return 'frameAnimGen'
  }
  if (typeId === 'video.reshoot' || presetKind === 'reshoot') return 'reshoot'

  const assetType = node?.assetType
  if (typeId === 'asset.video' || assetType === 'video' || presetKind === 'video') return 'video'
  if (typeId === 'asset.voice' || assetType === 'voice' || presetKind === 'voice') return 'voice'
  if (typeId === 'asset.image' || assetType === 'image' || presetKind === 'image') return 'image'
  if (
    typeId === 'asset.screenplay' ||
    assetType === 'screenplay' ||
    presetKind === 'screenplay'
  ) {
    return 'screenplay'
  }
  return 'screenplay'
}

function resolveSystemPromptForPreviewKind(
  kind: InstructionFinalPreviewKind,
  raw: string | undefined,
  locale?: string
): string {
  switch (kind) {
    case 'image':
      return resolveImageSystemPrompt(raw, locale)
    case 'video':
      return resolveVideoSystemPrompt(raw, locale)
    case 'reshoot':
      return resolveReshootSystemPrompt(raw, locale)
    case 'voice':
      return resolveVoiceSystemPrompt(raw, locale)
    case 'optimize':
      return resolveOptimizeSystemPrompt(raw, locale)
    case 'toPrompt':
      return resolveToPromptSystemPrompt(raw, locale)
    case 'worldExtract':
      return resolveWorldExtractSystemPrompt(raw, locale)
    case 'beatSplit':
      return resolveBeatSplitSystemPrompt(raw, locale)
    case 'beatUnitGen':
      return resolveBeatUnitGenSystemPrompt(raw, locale)
    case 'uiSplit':
      return resolveUiSplitSystemPrompt(raw, locale)
    case 'frameAnimGen':
      return resolveFrameAnimGenSystemPrompt(raw, locale)
    case 'screenplay':
    default:
      return resolveScreenplaySystemPrompt(raw, locale)
  }
}

function buildUserPromptForPreviewKind(
  kind: InstructionFinalPreviewKind,
  instruction: string,
  locale?: string,
  reshootSegment?: { startSec?: number; endSec?: number }
): string {
  switch (kind) {
    case 'image':
      return buildImagePrompt(instruction, locale)
    case 'video':
      return buildVideoPrompt(instruction, locale)
    case 'reshoot':
      return buildReshootPrompt(instruction, reshootSegment ?? {}, locale)
    case 'voice':
      return buildVoicePrompt(instruction, locale)
    case 'optimize':
      return buildOptimizePrompt(instruction, locale)
    case 'toPrompt':
      return buildToPromptUserPrompt(instruction, locale)
    case 'worldExtract':
      return buildWorldExtractPrompt(instruction, locale)
    case 'beatSplit':
      return buildBeatSplitPrompt(instruction, locale)
    case 'beatUnitGen':
      return buildBeatUnitGenPrompt(instruction, locale)
    case 'uiSplit':
      return buildUiSplitPrompt(instruction, locale)
    case 'frameAnimGen':
      return buildFrameAnimGenPrompt(instruction, locale)
    case 'screenplay':
    default:
      return buildScreenplayPrompt(instruction, locale)
  }
}

function previewSectionLabels(locale?: string): { system: string; user: string } {
  if (locale === 'en-US' || (locale?.startsWith('en') ?? false)) {
    return { system: 'System prompt', user: 'User prompt' }
  }
  return { system: '系统提示词', user: '用户提示词' }
}

/** 按节点类型拼接最终提示词预览（展开 @ + 对应系统提示词；无 @ 时拼上游正文，与执行一致） */
export function buildInstructionFinalPromptPreview(input: {
  kind: InstructionFinalPreviewKind
  instructionRaw: string
  sources: InstructionMentionSource[]
  systemPrompt?: string
  includeSystem?: boolean
  locale?: string
  styleImages?: ProjectStyleImage[] | null
  styleReferenceSubject?: StyleReferenceSubject
  reshootSegment?: { startSec?: number; endSec?: number }
  frameAnimGrid?: { rows?: number; cols?: number }
}): string {
  const instruction = expandInstructionMentions(input.instructionRaw.trim(), input.sources)
  let userPrompt = buildUserPromptForPreviewKind(
    input.kind,
    instruction,
    input.locale,
    input.reshootSegment
  )
  if (!instructionHasMentions(input.instructionRaw)) {
    const auto = input.sources
      .map((source) => source.text.trim())
      .filter(Boolean)
      .join('\n\n')
    if (auto) {
      userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${auto}` : auto
    }
  }
  if (input.kind === 'image' || input.kind === 'video') {
    userPrompt = appendStyleImagesReferencePrompt(userPrompt, input.styleImages, {
      locale: input.locale,
      subject: input.styleReferenceSubject
    })
  }
  if (input.kind === 'frameAnimGen' && input.frameAnimGrid) {
    const rows = Math.max(1, Math.floor(Number(input.frameAnimGrid.rows) || 1))
    const cols = Math.max(1, Math.floor(Number(input.frameAnimGrid.cols) || 4))
    const grid = buildAnim2dGridInstruction(rows, cols, input.locale)
    userPrompt = userPrompt.trim() ? `${userPrompt.trim()}\n\n${grid}` : grid
  }
  if (input.includeSystem === false) return userPrompt
  const system = resolveSystemPromptForPreviewKind(input.kind, input.systemPrompt, input.locale)
  const labels = previewSectionLabels(input.locale)
  return `【${labels.system}】\n${system}\n\n【${labels.user}】\n${userPrompt}`
}

function graphValueToMentionSource(value: GraphValue, index: number): InstructionMentionSource {
  if (value.kind === 'text') {
    return { index, title: `@${index}`, text: value.text }
  }
  if (value.kind === 'texts') {
    return {
      index,
      title: `@${index}`,
      text: value.items
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
    }
  }
  if (value.kind === 'asset') {
    const keepMentionToken = shouldKeepInstructionMentionToken({
      assetType: value.assetType,
      typeId: `asset.${value.assetType}`
    })
    return {
      index,
      title: value.title || value.label || `@${index}`,
      text: keepMentionToken ? '' : [value.notes, value.label].filter(Boolean).join('\n'),
      keepMentionToken
    }
  }
  if (value.kind === 'output') {
    return {
      index,
      title: `@${index}`,
      text: value.notes
        .map((item) => item.text.trim())
        .filter(Boolean)
        .join('\n\n')
    }
  }
  if (
    value.kind === 'image' ||
    value.kind === 'images' ||
    value.kind === 'video' ||
    value.kind === 'videos'
  ) {
    return { index, title: `@${index}`, text: '', keepMentionToken: true }
  }
  return { index, title: `@${index}`, text: '' }
}

function fallbackMentionTextFromNode(node: GraphNode | undefined): string {
  if (!node) return ''
  return (
    node.params.text?.trim() ||
    node.params.resultText?.trim() ||
    node.params.notes?.trim() ||
    ''
  )
}

function fallbackBeatUnitRefText(
  node: GraphNode | undefined,
  resolveBeatUnit?: (beatId: string) => import('../beatParse').BeatRow | null
): string {
  if (!node || node.typeId !== 'beat.unitRef' || !resolveBeatUnit) return ''
  const beatId = node.params.boundBeatId?.trim()
  if (!beatId) return ''
  const unit = resolveBeatUnit(beatId)
  return unit ? formatBeatRefText(unit) : ''
}

/**
 * 按入边顺序构建 `@n` 引用源，编号与 UI chips 一致；
 * 端口值缺正文时回退到源节点 params（与预览 resolveNodeTextContent 对齐）。
 * `mentionIndexBase`：风格图占用的编号数，端口从 base+1 起编。
 */
export function buildMentionSourcesForNode(input: {
  graph: GraphDocument
  nodeId: string
  byId: Map<string, GraphNode>
  outputs: Map<string, Record<string, GraphValue>>
  mentionIndexBase?: number
  resolveBeatUnit?: (beatId: string) => import('../beatParse').BeatRow | null
}): InstructionMentionSource[] {
  const base = Math.max(0, Math.floor(input.mentionIndexBase ?? 0))
  const incoming = expandIncomingThroughBundles(input.graph, input.nodeId)
  return incoming.map((edge, i) => {
    const index = portMentionIndex(i, base)
    const source = input.byId.get(edge.sourceNodeId)
    const sourcePort = edge.sourcePort
    const value = input.outputs.get(edge.sourceNodeId)?.[sourcePort]
    const fromValue = value ? graphValueToMentionSource(value, index) : null
    const keepMentionToken =
      fromValue?.keepMentionToken === true || shouldKeepInstructionMentionToken(source)
    const title =
      fromValue?.title?.trim() ||
      source?.title?.trim() ||
      source?.params.label?.trim() ||
      `@${index}`
    const text = keepMentionToken
      ? ''
      : fromValue?.text?.trim() ||
        fallbackMentionTextFromNode(source) ||
        fallbackBeatUnitRefText(source, input.resolveBeatUnit)
    return { index, title, text, keepMentionToken }
  })
}

/** 图片/视频生成节点：风格图占用的 `@n` 前缀数量 */
export function resolveGenerateMentionIndexBase(
  node: GraphNode,
  globalStyleImages?: ProjectStyleImage[] | null
): number {
  if (!isProcessingAssetNode(node)) return 0
  if (node.typeId !== 'asset.image' && node.typeId !== 'asset.video') return 0
  return resolveStyleMentionReserveCount(node.params, globalStyleImages)
}

export function resolveMentionSources(ctx: NodeExecuteContext): InstructionMentionSource[] {
  if (ctx.mentionSources?.length) return ctx.mentionSources
  const incoming = collectIncomingValues(ctx.inputs)
  return incoming.map((value, i) => graphValueToMentionSource(value, i + 1))
}
