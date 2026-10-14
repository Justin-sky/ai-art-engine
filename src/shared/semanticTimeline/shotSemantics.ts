/**
 * 一镜的**语义输入**：哪些事件 / 节拍 / 导演意图会影响这一镜的画面。
 *
 * 这是唯一的定义处 —— 提示词拼装（`buildPromptPlan`）与脏检测（`shotSemanticSignature`
 * → `diffAgainstBaseline`）都从这里取。两边口径一旦分叉，就会出现"提示词变了、镜头却
 * 被判为未改而直通原片"的静默失效，所以不要在别处再写一份筛选。
 */
import { shortHash, stableStringify } from './ids'
import type {
  DirectorIntent,
  SemanticEvent,
  SemanticEventType,
  SemanticTimeline,
  SemanticTrackKind,
  StoryBeat
} from './types'

/** 导演意图可用的轨道（与 `SemanticTrackKind` 一一对应；执行器 / 检查器共用） */
export const SEMANTIC_TRACK_KINDS: readonly SemanticTrackKind[] = [
  'story',
  'character',
  'camera',
  'emotion',
  'audio',
  'text',
  'vfx',
  'edit'
]

export const SEMANTIC_EVENT_TYPES: readonly SemanticEventType[] = [
  'story',
  'character',
  'camera',
  'emotion',
  'audio',
  'text',
  'product'
]

/**
 * 能进**画面**提示词的手法轨道。`light` 不在 `SemanticTrackKind` 里，但规则包会产出它，
 * 所以单独列出；其余轨道（声音 / 字幕 / 剪辑 …）属于后期，不进画面、也不触发画面重生成。
 */
export const PICTURE_TRACK_KINDS: readonly string[] = ['camera', 'light', 'vfx']

/** 意图手法可接受的轨道：语义轨道 + 规则包里的画面轨 */
export function isKnownTechniqueTrack(track: unknown): boolean {
  return (
    typeof track === 'string' &&
    ((SEMANTIC_TRACK_KINDS as readonly string[]).includes(track) ||
      PICTURE_TRACK_KINDS.includes(track))
  )
}

function arr<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : []
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && a.end > b.start
}

export interface ShotSemanticInputs {
  events: SemanticEvent[]
  intents: DirectorIntent[]
  beats: StoryBeat[]
}

/**
 * 按时间重叠取本镜的语义输入。
 *
 * 意图的归属：trigger 命中镜内事件（id 或 label）；兜底按意图自带的时间范围落在镜内
 * （手写过 label、对不上时仍能带上）。
 */
export function shotSemanticInputs(
  doc: Pick<SemanticTimeline, 'events' | 'intents' | 'beats'> | null | undefined,
  range: { start: number; end: number }
): ShotSemanticInputs {
  const events = arr(doc?.events).filter((e) => e?.timeRange && overlaps(e.timeRange, range))
  const eventIds = new Set(events.map((e) => e.id))
  const eventLabels = new Set(events.map((e) => e.label))
  const intents = arr(doc?.intents).filter((intent) => {
    const trigger = String(intent?.trigger ?? '')
    if (!trigger) return false
    if (eventIds.has(trigger) || eventLabels.has(trigger)) return true
    const own = (intent as { timeRange?: { start: number; end: number } }).timeRange
    return !!own && overlaps(own, range)
  })
  const beats = arr(doc?.beats).filter((b) => b?.timeRange && overlaps(b.timeRange, range))
  return { events, intents, beats }
}

/** 意图里**影响画面**的手法（声音 / 字幕 / 剪辑轨不算） */
export function pictureTechniques(
  intent: DirectorIntent
): Array<{ track: string; action: string }> {
  return arr(intent?.techniques)
    .filter((t) => PICTURE_TRACK_KINDS.includes(String(t?.track ?? '')))
    .map((t) => ({ track: String(t.track), action: String(t?.action ?? '').trim() }))
    .filter((t) => !!t.action)
}

const r3 = (n: number | undefined): number => Number((n ?? 0).toFixed(3))

/**
 * 本镜语义输入的指纹：只取**会改变画面提示词或导演命令**的字段。
 *
 * - 事件：类型 / 标签 / 描述 / 重要度 / 时间（规则按 label、type 命中；描述进提示词）
 * - 意图：触发 / 目标 / 画面轨手法（声音轨手法改了不该让画面重出）
 * - 节拍：类型 / 情绪标签（规则按 beatType、emotion 命中）
 */
export function shotSemanticSignature(
  doc: Pick<SemanticTimeline, 'events' | 'intents' | 'beats'> | null | undefined,
  range: { start: number; end: number }
): string {
  const inputs = shotSemanticInputs(doc, range)
  const byId = <T extends { id: string }>(items: T[]): T[] =>
    [...items].sort((a, b) => a.id.localeCompare(b.id))
  return shortHash(
    stableStringify({
      ev: byId(inputs.events).map((e) => ({
        id: e.id,
        type: e.type,
        label: e.label,
        desc: e.description?.trim(),
        imp: r3(e.importance),
        s: r3(e.timeRange.start),
        e: r3(e.timeRange.end)
      })),
      in: byId(inputs.intents).map((i) => ({
        id: i.id,
        trigger: i.trigger,
        goal: i.goal,
        tech: pictureTechniques(i)
      })),
      bt: byId(inputs.beats).map((b) => ({ id: b.id, type: b.type, emo: b.emotion?.label }))
    }),
    16
  )
}
