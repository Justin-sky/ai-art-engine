/**
 * 语义时间线「查看结果」的载荷解析 + 输出摘要。
 *
 * 为什么单独成模块：这两件事原来内联在 `GraphNodeCard.vue` 里，结果是
 * **结构化值（第 2 步起 `kind: 'semanticTimeline'`）上线后没人同步** ——
 * 卡片双击直接变成静默无响应（`resolveSemanticOutText` 只认 `kind === 'text'`）。
 * 抽出来之后可以按纯函数把「运行输出 / 节点参数 / 只留 timelineId」三种来源都钉住。
 */
import type { GraphNode } from '@shared/graph/types'
import type { GraphNodeRunState, GraphValue } from '@shared/graph/execute/types'

export interface SemanticTimelineViewTarget {
  /** 时间线 id（`stl.*`），dive 视图据此读 `Semantic/<id>/timeline.json` */
  id: string
  /** 内联 JSON：输出尚未落盘时直接渲染，省一次读盘 */
  json?: string
  /** 原视频工程相对路径（dive 里显示视频用；透传节点从上游拿） */
  sourceRelativePath?: string
  /**
   * 打开 dive 时的**来源节点**（语义编辑 / 变体节点）。
   *
   * 有它，dive 里的编辑面板才能把改动**写回节点参数** —— 编辑台在 dive，
   * 但节点参数仍是唯一事实来源，构建还是走画布上的节点。
   */
  editorNodeId?: string
  hostId?: string
}

/** 运行输出里的时间线文本（兼容旧的纯文本值与新的结构化值） */
export function semanticTimelineTextFromRunState(
  runState: GraphNodeRunState | null | undefined
): string {
  const out = runState?.outputs?.out
  if (!out) return ''
  if (out.kind === 'text') return out.text.trim()
  // 结构化值的真身是 `doc`，但 dive 视图要 JSON 文本；`text` 就是它的 JSON 序列化
  if (out.kind === 'semanticTimeline') return out.text.trim()
  return ''
}

/** 校验并取出 `{id, json}`：必须是时间线文档（有 stl. id 与 source）才算数 */
function parseTimelineJson(raw: unknown): SemanticTimelineViewTarget | null {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return null
  try {
    const doc = JSON.parse(text) as { id?: unknown; source?: unknown }
    if (typeof doc.id === 'string' && doc.id.startsWith('stl.') && doc.source) {
      return { id: doc.id, json: text }
    }
  } catch {
    /* not json */
  }
  return null
}

/**
 * 解析双击要打开的目标，按可靠度取：
 * 1. 本次运行的输出（含未落盘的最新 JSON）；
 * 2. 节点参数里的 `timelineJson`（手写/上游撑起来的时间线）；
 * 3. 只留 `semanticTimelineId`（重开工程后运行输出已不在内存里，交给 dive 按 id 读盘）。
 *
 * 三种来源都顺带带上 `sourceRelativePath`（分析节点会存原视频路径）—— 语义时间线是透传节点，
 * 从上游解析时也靠这条把视频带进 dive。
 */
export function resolveSemanticTimelineViewTarget(
  node: Pick<GraphNode, 'params'>,
  runState: GraphNodeRunState | null | undefined
): SemanticTimelineViewTarget | null {
  const sourceRelativePath = String(node.params?.sourceRelativePath ?? '').trim() || undefined
  const withSource = (
    target: SemanticTimelineViewTarget | null
  ): SemanticTimelineViewTarget | null => (target ? { ...target, sourceRelativePath } : null)
  const fromRun = parseTimelineJson(semanticTimelineTextFromRunState(runState))
  if (fromRun) return withSource(fromRun)
  const fromParams = parseTimelineJson(node.params?.timelineJson)
  if (fromParams) return withSource(fromParams)
  const id = String(node.params?.semanticTimelineId ?? '').trim()
  return id.startsWith('stl.') ? { id, sourceRelativePath } : null
}

/**
 * 原视频的显示比例（CSS `aspect-ratio` 值）。
 *
 * `<video width:100% height:auto>` 在加载元数据后会按**实际比例**自适应，
 * 但元数据到位前盒子是 0 高 → 布局会跳一下。用时间线里记的 `source.width/height`
 * 先把比例占住（竖屏 9:16 / 横屏 16:9 / 方形都能正确预留）。
 * 取值非法时返回 undefined（交给浏览器用内在比例）。
 */
export function sourceAspectRatio(source: { width?: number; height?: number }): string | undefined {
  const w = Number(source?.width)
  const h = Number(source?.height)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return undefined
  return `${w} / ${h}`
}

export type EvidenceRefKind =
  'event' | 'beat' | 'intent' | 'entity' | 'shot' | 'utterance' | 'ocr' | 'unknown'

export interface ResolvedEvidenceRef {
  /** 原始 id（放进 tooltip 供排查） */
  raw: string
  kind: EvidenceRefKind
  /** 人读的短标签（不含类型前缀）：事件 label / 实体名 / 镜头序号… */
  detail: string
  /** 已知时间（给了就能点着跳播放条） */
  startSec?: number
  endSec?: number
}

export interface EvidenceRefContext {
  events?: ReadonlyArray<{
    id: string
    label?: string
    timeRange?: { start: number; end: number }
  }>
  beats?: ReadonlyArray<{ id: string; type?: string; timeRange?: { start: number; end: number } }>
  intents?: ReadonlyArray<{ id: string; goal?: string }>
  entities?: ReadonlyArray<{ id: string; name?: string }>
  /** 话语证据（来自 `evidence/utterances.json`，用于显示原句与时间） */
  utterances?: ReadonlyMap<string, { text?: string; start?: number; end?: number }>
  /** 镜头证据（来自 `evidence/shots.json`） */
  shots?: ReadonlyMap<string, { start?: number; end?: number }>
  fps?: number
}

function timeOf(range?: { start: number; end: number }): { startSec?: number; endSec?: number } {
  if (!range) return {}
  return {
    ...(Number.isFinite(range.start) ? { startSec: range.start } : {}),
    ...(Number.isFinite(range.end) ? { endSec: range.end } : {})
  }
}

/**
 * 证据 id → 人读标签。
 *
 * 这些 id 是内容哈希（`ev.c732c3a6d0` / `utt.007.49529d7876`），直接摆在面板上没人看得懂。
 * 能在时间线文档里查到就查（事件 / 节拍 / 意图 / 实体）；查不到就**从 id 自身解析**：
 * `shot.<序号>.<起始帧>` 能算出镜头号与时间，`utt.<序号>.<hash>` 至少给出序号。
 * 全都解析不出来时退回原始 id（绝不显示"未知"把信息丢掉）。
 */
export function resolveEvidenceRef(raw: string, ctx: EvidenceRefContext = {}): ResolvedEvidenceRef {
  const id = raw?.trim() ?? ''
  const fps = Number(ctx.fps) > 0 ? Number(ctx.fps) : 30
  if (!id) return { raw: id, kind: 'unknown', detail: '' }

  if (id.startsWith('ev.')) {
    const hit = ctx.events?.find((e) => e.id === id)
    return {
      raw: id,
      kind: 'event',
      detail: hit?.label?.trim() || id.slice(3, 9),
      ...timeOf(hit?.timeRange)
    }
  }
  if (id.startsWith('beat.')) {
    const hit = ctx.beats?.find((b) => b.id === id)
    return {
      raw: id,
      kind: 'beat',
      detail: hit?.type?.trim() || id.slice(5, 11),
      ...timeOf(hit?.timeRange)
    }
  }
  if (id.startsWith('intent.')) {
    const hit = ctx.intents?.find((i) => i.id === id)
    return { raw: id, kind: 'intent', detail: hit?.goal?.trim() || id.slice(7, 13) }
  }
  if (id.startsWith('ent.')) {
    const hit = ctx.entities?.find((e) => e.id === id)
    return {
      raw: id,
      kind: 'entity',
      detail: hit?.name?.trim() || id.split('.').slice(2).join('.')
    }
  }
  if (id.startsWith('shot.')) {
    // shot.<序号>.<起始帧> —— 只有 3 段，别多解构一层（否则序号取到帧号）
    const [, index, frame] = id.split('.')
    const score = Number(index)
    const frameNo = Number(frame)
    const fromFrame =
      Number.isFinite(frameNo) && Number.isFinite(fps) ? Math.max(0, frameNo / fps) : undefined
    const hit = ctx.shots?.get(id)
    const start = Number.isFinite(hit?.start) ? Number(hit?.start) : fromFrame
    const end = Number.isFinite(hit?.end) ? Number(hit?.end) : undefined
    return {
      raw: id,
      kind: 'shot',
      detail: Number.isFinite(score) ? String(score) : id.slice(5),
      ...(start != null ? { startSec: start } : {}),
      ...(end != null ? { endSec: end } : {})
    }
  }
  if (id.startsWith('utt.')) {
    const [, index] = id.split('.')
    const hit = ctx.utterances?.get(id)
    const score = Number(index)
    const text = hit?.text?.trim()
    return {
      raw: id,
      kind: 'utterance',
      detail: text
        ? text.length > 24
          ? `${text.slice(0, 24)}…`
          : text
        : Number.isFinite(score)
          ? String(score)
          : id.slice(4, 10),
      ...(Number.isFinite(hit?.start) ? { startSec: Number(hit?.start) } : {}),
      ...(Number.isFinite(hit?.end) ? { endSec: Number(hit?.end) } : {})
    }
  }
  if (id.startsWith('ocr.')) {
    const [, index] = id.split('.')
    const score = Number(index)
    return {
      raw: id,
      kind: 'ocr',
      detail: Number.isFinite(score) ? String(score) : id.slice(4, 10)
    }
  }
  return { raw: id, kind: 'unknown', detail: id }
}

/**
 * 轨道 id → i18n 键后缀。
 *
 * 文档里的 track 是**机器 id**（camera / character / audio / text / vfx / emotion / edit…），
 * 直接显示就会在中文界面里露出英文（手法列表里踩到过）。返回 undefined 表示不认识的 id ——
 * 调用方应原样显示（别把信息丢了）。
 */
export function trackLabelKey(track: string): string | undefined {
  switch (track?.trim().toLowerCase()) {
    case 'camera':
      return 'trackCamera'
    case 'audio':
      return 'trackAudio'
    case 'text':
      return 'trackText'
    case 'vfx':
      return 'trackVfx'
    case 'character':
      return 'trackCharacter'
    case 'emotion':
      return 'trackEmotion'
    case 'edit':
      return 'trackEdit'
    // 层名复用（story / entity 既是轨道 id 也是层标题）
    case 'story':
      return 'layerStory'
    case 'entity':
      return 'layerEntity'
    default:
      return undefined
  }
}

/** 实体 kind → i18n 键后缀（同样是机器值：person / product / …） */
export function entityKindKey(kind: string): string | undefined {
  switch (kind?.trim().toLowerCase()) {
    case 'person':
      return 'entityKindPerson'
    case 'product':
      return 'entityKindProduct'
    case 'object':
      return 'entityKindObject'
    case 'text':
      return 'entityKindText'
    case 'logo':
      return 'entityKindLogo'
    case 'background':
      return 'entityKindBackground'
    case 'voice':
      return 'entityKindVoice'
    default:
      return undefined
  }
}

/**
 * 点实体片段时该跳到哪一秒。
 *
 * 一个实体可能在**多个镜头**出现（每次出现渲染一个片段），点击必须跳到**被点的那个片段**，
 * 而不是永远跳第一次出现（真 bug：一个实体三处出现，点哪都回到第一处）。
 * `index` 越界 / 缺失时退回第一次出现；没有出现记录时返回 undefined（调用方不动播放条）。
 */
export function appearanceSeekSeconds(
  appearances: ReadonlyArray<{ range: { start: number; end: number } }> | undefined,
  index?: number
): number | undefined {
  const list = appearances ?? []
  if (list.length === 0) return undefined
  const picked =
    index != null && Number.isInteger(index) && index >= 0 && index < list.length
      ? list[index]
      : list[0]
  const start = picked?.range?.start
  return Number.isFinite(start) ? (start as number) : undefined
}

/**
 * 从运行输出里取**成片**的相对路径。
 *
 * 语义重建出 `out-video`（单条）。双击节点应该先看**成片**，而不是只看 JSON 计划 ——
 * 成片才是这个节点的产物。没有成片（只出计划 / 拼接失败）时返回 undefined，
 * 调用方回落到文本结果。
 */
export function resolveBuiltVideoRelativePath(
  outputs: Record<string, unknown> | null | undefined
): string | undefined {
  const path = (outputs?.['out-video'] as { relativePath?: unknown } | undefined)?.relativePath
  return typeof path === 'string' && path.trim() ? path.trim() : undefined
}

/** 右栏（视频+证据）可调宽度的边界 */
export const SIDE_PANE_MIN_WIDTH = 320
export const SIDE_PANE_MAX_WIDTH = 900
/** 左栏（轨道）的最小可见宽度：拖到头时保留这么多，别把轨道挤没 */
export const TRACKS_PANE_MIN_WIDTH = 280

/**
 * 右栏宽度收敛：先夹绝对边界，若已知编辑器总宽再保证左栏不被挤没。
 *
 * 小窗口下 `editorWidth` 可能小于两个最小值之和 —— 此时以「右栏不小于 min」优先
 * （左栏有 `min-width: 0` + 自身横向滚动，挤窄仍可用）。
 */
export function clampSidePaneWidth(desired: number, editorWidth?: number): number {
  const value = Number.isFinite(desired) ? desired : SIDE_PANE_MIN_WIDTH
  const lowerBounded = Math.max(SIDE_PANE_MIN_WIDTH, value)
  const withTracks = Number.isFinite(editorWidth)
    ? (editorWidth as number) - TRACKS_PANE_MIN_WIDTH
    : SIDE_PANE_MAX_WIDTH
  const upper = Math.max(SIDE_PANE_MIN_WIDTH, Math.min(SIDE_PANE_MAX_WIDTH, withTracks))
  return Math.min(lowerBounded, upper)
}

/** 拖动时的宽度：右栏贴着编辑器右边缘算，等价于把手柄拖到鼠标处 */
export function sidePaneWidthFromPointer(input: {
  clientX: number
  editorRight: number
  editorWidth?: number
}): number {
  return clampSidePaneWidth(input.editorRight - input.clientX, input.editorWidth)
}

interface TimelineCounts {
  shots?: number
  utterances?: number
  entities?: number
  ocr?: number
}

/**
 * 制作层片段（机位/声音/字幕/特效）的落点：由 `intent.trigger` 指向的事件决定。
 *
 * 事件可能按 **id** 或 **label** 触发（生成侧两种都出现过）；都找不到时给 0–1 的兜底，
 * 免得片段宽度变成负值 / NaN 而整块消失。
 */
export function resolveTriggerRange(
  events: ReadonlyArray<{
    id: string
    label?: string
    timeRange: { start: number; end: number }
  }>,
  trigger: string
): { start: number; end: number } {
  const key = trigger?.trim() ?? ''
  const hit = key ? events.find((e) => e.id === key || e.label === key) : undefined
  if (!hit) return { start: 0, end: 1 }
  const start = Number.isFinite(hit.timeRange.start) ? hit.timeRange.start : 0
  const end = Number.isFinite(hit.timeRange.end) ? hit.timeRange.end : start + 1
  return { start, end: end > start ? end : start + 1 }
}

/**
 * 点选 clip 时播放条要跳到的时刻：负数归零，并夹在视频时长内。
 *
 * 不夹的话 `video.currentTime = 超出时长` 会被浏览器拒绝或产生 NaN ——
 * 事件时间来自证据，偶尔会略长于 `source.duration`（转写尾段/末帧取整）。
 */
export function clampSeekSeconds(sec: number, duration: number | undefined): number {
  const value = Number.isFinite(sec) ? sec : 0
  const max = Number.isFinite(duration) && (duration as number) > 0 ? (duration as number) : 0
  const nonNegative = Math.max(0, value)
  return max > 0 ? Math.min(nonNegative, max) : nonNegative
}

/** 一眼判断产出是否正常：id + 规模。计数从 `evidence.hashes` 取（那里存的就是计数） */
export function semanticTimelineSummaryText(value: GraphValue | undefined): string {
  if (!value || value.kind !== 'semanticTimeline') return ''
  const doc = value.doc
  if (!doc) return ''
  const hashes = (doc.evidence as { hashes?: Record<string, string> } | undefined)?.hashes
  const counts: TimelineCounts = {}
  const keys: Array<[keyof TimelineCounts, string]> = [
    ['shots', 'shots'],
    ['utterances', 'utterances'],
    ['entities', 'entities'],
    ['ocr', 'ocr']
  ]
  for (const [field, key] of keys) {
    const n = Number(hashes?.[key])
    if (Number.isFinite(n)) counts[field] = n
  }
  const parts: string[] = [doc.id]
  if (counts.shots != null) parts.push(`镜头 ${counts.shots}`) // cjk-ok
  if (counts.utterances != null) parts.push(`话语 ${counts.utterances}`) // cjk-ok
  if (counts.entities != null) parts.push(`实体 ${counts.entities}`) // cjk-ok
  if (counts.ocr != null) parts.push(`OCR ${counts.ocr}`)
  parts.push(`事件 ${doc.events.length}`) // cjk-ok
  parts.push(`节拍 ${doc.beats.length}`) // cjk-ok
  parts.push(`意图 ${doc.intents.length}`) // cjk-ok
  return parts.join(' · ')
}
