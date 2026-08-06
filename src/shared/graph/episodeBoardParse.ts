/**
 * 剧集分镜流水线表格解析：
 * - 9宫格分镜表 → 9 个宫格（anchor）
 * - 4宫格动态分镜表 → 36 个动态格（9 组 × 4）
 * - 动态提示词表 → 36 条图生视频指令
 * 解析失败时允许降级：返回空数组，UI/执行层显示原文。
 */

export interface EpisodeAnchorRow {
  /** 1..9 */
  index: number
  title: string
  beatId: string
  /** 不含标题行的块正文 */
  text: string
}

export interface EpisodeCellRow {
  /** 1..9 */
  groupIndex: number
  /** 1..4 */
  cellIndex: number
  /** 格N-M */
  key: string
  /** 定场 / 引入 / 冲突 / 收尾 */
  stage: string
  text: string
}

export interface EpisodeMotionRow {
  /** 1..9 */
  groupIndex: number
  /** 1..4 */
  cellIndex: number
  /** 格N-M */
  key: string
  /** 不含标题行的块正文 */
  text: string
}

export interface EpisodeBeatRow {
  /** 节拍编号（1..N） */
  index: number
  summary: string
  audienceGain: string
  /** 情绪强度 1..10 */
  intensity: number
  /** 是否为关键锚点 */
  anchor: boolean
}

const ANCHOR_HEADING_RE = /^##\s*格\s*(\d+)/i
const ANCHOR_BEAT_REF_RE = /节拍ID\s*[:：]\s*#?\s*([0-9A-Za-z_-]+)/i
// 兼容 `| #1 |` 与 `| 1 |` 两种写法，避免模型省略井号导致整表解析失败
const BEAT_ROW_RE =
  /^\|\s*#?\s*(\d+)\s*\|([^|]*)\|([^|]*)\|([^|]*)\|\s*(是|否|YES|NO)\s*\|/i

/** 解析节拍拆解表：| 节拍编号 | 事件摘要 | 观众获得 | 情绪强度 | 关键锚点 | */
export function parseEpisodeBeatBreakdown(text: string | undefined | null): EpisodeBeatRow[] {
  const lines = text?.replace(/\r\n/g, '\n').split('\n') ?? []
  const rows: EpisodeBeatRow[] = []
  for (const raw of lines) {
    const match = BEAT_ROW_RE.exec(raw.trim())
    if (!match) continue
    const index = Number(match[1])
    if (!Number.isFinite(index)) continue
    rows.push({
      index,
      summary: match[2]?.trim() ?? '',
      audienceGain: match[3]?.trim() ?? '',
      intensity: clampIntensity(Number(match[4])),
      anchor: /是|YES/i.test(match[5] ?? '')
    })
  }
  return rows
}

function clampIntensity(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  return Math.min(10, Math.max(0, Math.round(raw)))
}

/** 按标题行拆分 Markdown 块，返回 [{ heading, body }] */
function splitHeadingBlocks(text: string, headingRe: RegExp): Array<{ heading: string; body: string }> {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Array<{ heading: string; body: string[] }> = []
  let current: { heading: string; body: string[] } | null = null
  for (const line of lines) {
    if (headingRe.test(line.trim())) {
      current = { heading: line.trim(), body: [] }
      blocks.push(current)
    } else if (current) {
      current.body.push(line)
    }
  }
  return blocks.map((block) => ({ heading: block.heading, body: block.body.join('\n').trim() }))
}

function extractTitleAfterHeading(heading: string, index: number): string {
  const dash = heading.indexOf('-')
  const after = dash >= 0 ? heading.slice(dash + 1).trim() : ''
  const cleaned = after.replace(/^[:：]\s*/, '').trim()
  return cleaned || `格${index}`
}

/** 解析 9宫格分镜表：9 个宫格块 */
export function parseEpisodeBeatBoard(text: string | undefined | null): EpisodeAnchorRow[] {
  const blocks = splitHeadingBlocks(text ?? '', ANCHOR_HEADING_RE)
  const rows: EpisodeAnchorRow[] = []
  for (const block of blocks) {
    const match = ANCHOR_HEADING_RE.exec(block.heading)
    if (!match) continue
    const index = Number(match[1])
    if (!Number.isFinite(index) || index < 1 || index > 99) continue
    const beatRef = ANCHOR_BEAT_REF_RE.exec(`${block.heading}\n${block.body}`)
    rows.push({
      index,
      title: extractTitleAfterHeading(block.heading, index),
      beatId: beatRef?.[1] ?? '',
      text: block.body
    })
  }
  return rows
}

const GROUP_HEADING_RE = /^##\s*组\s*(\d+)/i
const CELL_ITEM_RE = /^[-*]\s*\*\*格\s*(\d+)-(\d+)\s*\(([^)]*)\)\*\*[:：]?\s*(.*)$/i
const STAGE_ORDER = ['定场', '引入', '冲突', '收尾']

/** 解析 4宫格动态分镜表：9 组 × 4 = 36 格 */
export function parseEpisodeSequenceBoard(text: string | undefined | null): EpisodeCellRow[] {
  const lines = text?.replace(/\r\n/g, '\n').split('\n') ?? []
  const rows: EpisodeCellRow[] = []
  let groupIndex = 0
  for (const raw of lines) {
    const line = raw.trim()
    const groupMatch = GROUP_HEADING_RE.exec(line)
    if (groupMatch) {
      groupIndex = Number(groupMatch[1])
      continue
    }
    const cellMatch = CELL_ITEM_RE.exec(line)
    if (!cellMatch) continue
    const g = Number(cellMatch[1])
    const c = Number(cellMatch[2])
    const stage = cellMatch[3]?.trim() || STAGE_ORDER[c - 1] || ''
    const desc = cellMatch[4]?.trim() || ''
    if (!Number.isFinite(g) || !Number.isFinite(c) || g < 1 || c < 1 || c > 4) continue
    rows.push({
      groupIndex: g || groupIndex,
      cellIndex: c,
      key: `格${g}-${c}`,
      stage,
      text: desc
    })
  }
  return rows
}

const MOTION_HEADING_RE = /^##\s*镜头\s*(\d+)/i
const MOTION_SOURCE_RE = /组\s*(\d+)\s*[-—]\s*格\s*(\d+)(?:\s*[-—]\s*(\d+))?/i

/** 解析动态提示词表：36 条（按 [来源: 4宫格 组x-格y] 归组） */
export function parseEpisodeMotionPrompts(text: string | undefined | null): EpisodeMotionRow[] {
  const blocks = splitHeadingBlocks(text ?? '', MOTION_HEADING_RE)
  const rows: EpisodeMotionRow[] = []
  for (const block of blocks) {
    const match = MOTION_HEADING_RE.exec(block.heading)
    if (!match) continue
    const source = MOTION_SOURCE_RE.exec(block.heading)
    const groupIndex = source ? Number(source[1]) : rows.length === 0 ? 1 : rows[rows.length - 1]!.groupIndex
    const cellIndex = source
      ? Number(source[2])
      : rows.length === 0
        ? 1
        : rows[rows.length - 1]!.cellIndex + 1
    rows.push({
      groupIndex,
      cellIndex,
      key: `格${groupIndex}-${cellIndex}`,
      text: block.body
    })
  }
  return rows
}

/** 从 9宫格表选择指定宫格；找不到返回 null */
export function selectEpisodeAnchor(
  text: string | undefined | null,
  index: number
): EpisodeAnchorRow | null {
  return parseEpisodeBeatBoard(text).find((row) => row.index === index) ?? null
}

/** 从 4宫格动态分镜表选择指定动态格 */
export function selectEpisodeCell(
  text: string | undefined | null,
  groupIndex: number,
  cellIndex: number
): EpisodeCellRow | null {
  return (
    parseEpisodeSequenceBoard(text).find(
      (row) => row.groupIndex === groupIndex && row.cellIndex === cellIndex
    ) ?? null
  )
}

/** 从动态提示词表选择指定动态格对应的提示词 */
export function selectEpisodeMotion(
  text: string | undefined | null,
  groupIndex: number,
  cellIndex: number
): EpisodeMotionRow | null {
  return (
    parseEpisodeMotionPrompts(text).find(
      (row) => row.groupIndex === groupIndex && row.cellIndex === cellIndex
    ) ?? null
  )
}
