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
 */
export function resolveSemanticTimelineViewTarget(
  node: Pick<GraphNode, 'params'>,
  runState: GraphNodeRunState | null | undefined
): SemanticTimelineViewTarget | null {
  const fromRun = parseTimelineJson(semanticTimelineTextFromRunState(runState))
  if (fromRun) return fromRun
  const fromParams = parseTimelineJson(node.params?.timelineJson)
  if (fromParams) return fromParams
  const id = String(node.params?.semanticTimelineId ?? '').trim()
  return id.startsWith('stl.') ? { id } : null
}

interface TimelineCounts {
  shots?: number
  utterances?: number
  entities?: number
  ocr?: number
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
