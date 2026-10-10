/**
 * 镜头描述 / 事件抽取 / 节拍归类 / 意图推断 — 纯解析与规则兜底。
 * 提示词与 GraphSkill 在 graphSkills / 节点侧；这里保证无证据事件被丢弃。
 */
import { beatId, eventId, intentId, makeTimeRange, matchStableEventId } from './ids'
import { assignBeatsByTimeFraction, findVocabulary, COMMERCE_VOCABULARY } from './vocabulary'
import type {
  BeatVocabulary,
  DirectorIntent,
  SemanticEvent,
  ShotEvidence,
  StoryBeat,
  UtteranceEvidence
} from './types'

export interface ShotDescription {
  shotId: string
  subject?: string
  action?: string
  emotion?: string
  shotSize?: string
  angle?: string
  cameraMotion?: string
  focalLengthHint?: string
  raw?: string
}

export interface RawEventDraft {
  label: string
  type?: SemanticEvent['type']
  description: string
  start: number
  end: number
  entities?: string[]
  evidence: string[]
  importance?: number
  confidence?: number
}

/** 丢弃无证据草稿，并稳定化 ID */
export function draftsToEvents(
  drafts: RawEventDraft[],
  fps: number,
  previous: SemanticEvent[] = []
): SemanticEvent[] {
  const out: SemanticEvent[] = []
  for (const d of drafts) {
    if (!d.evidence?.length) continue
    const range = makeTimeRange(d.start, d.end, fps)
    const id =
      matchStableEventId(d.label, range, previous) ?? eventId(d.label, range.start, range.end)
    const locked = previous.find((p) => p.id === id && p.locked)
    if (locked) {
      out.push(locked)
      continue
    }
    out.push({
      id,
      timeRange: range,
      type: d.type ?? 'story',
      label: d.label,
      description: d.description,
      importance: d.importance ?? 0.5,
      entities: d.entities ?? [],
      evidence: [...d.evidence],
      intents: [],
      confidence: d.confidence ?? 0.7,
      origin: 'analysis'
    })
  }
  return out
}

/** 按词表时间比例把事件归入节拍（LLM 失败时的兜底） */
export function assignBeatsHeuristic(
  events: SemanticEvent[],
  durationSec: number,
  fps: number,
  vocabulary: string | BeatVocabulary = 'commerce.v1'
): StoryBeat[] {
  const vocab =
    typeof vocabulary === 'string'
      ? (findVocabulary(vocabulary) ?? COMMERCE_VOCABULARY)
      : vocabulary.beats.length > 0
        ? vocabulary
        : COMMERCE_VOCABULARY
  const slots = assignBeatsByTimeFraction(durationSec, vocab)
  return slots.map((slot) => {
    const start = slot.startFrac * durationSec
    const end = slot.endFrac * durationSec
    const inBeat = events.filter((e) => e.timeRange.start < end && e.timeRange.end > start)
    const beatType = slot.type
    return {
      id: beatId(beatType, start),
      type: beatType,
      vocabulary: vocab.id,
      timeRange: makeTimeRange(start, end, fps),
      emotion: { label: 'neutral', intensity: 0.4 },
      description: vocab.beats.find((b) => b.type === beatType)?.label ?? beatType,
      events: inBeat.map((e) => e.id)
    }
  })
}

/** 从转写关键词启发式抽事件（无 VLM 时的最小可用） */
export function heuristicEventsFromUtterances(
  utterances: UtteranceEvidence[],
  shots: ShotEvidence[],
  fps: number
): SemanticEvent[] {
  const drafts: RawEventDraft[] = []
  for (const u of utterances) {
    const text = u.text
    const shot =
      shots.find((s) => s.range.start <= u.range.start && s.range.end >= u.range.start) ?? shots[0]
    const evidence = [u.id, ...(shot ? [shot.id] : [])]
    const priceCue = /价格|只要|块钱|元|¥|\$|price|offer/i // cjk-ok
    const ctaCue = /点击|下单|链接|购买|buy|shop/i // cjk-ok
    const problemCue = /干燥|卡粉|问题|痛点|problem/i // cjk-ok
    if (priceCue.test(text)) {
      drafts.push({
        label: 'price_announce',
        type: 'product',
        description: text.slice(0, 80),
        start: u.range.start,
        end: u.range.end,
        evidence,
        importance: 0.9
      })
    } else if (ctaCue.test(text)) {
      drafts.push({
        label: 'cta',
        type: 'story',
        description: text.slice(0, 80),
        start: u.range.start,
        end: u.range.end,
        evidence,
        importance: 0.85
      })
    } else if (problemCue.test(text)) {
      drafts.push({
        label: 'problem_hook',
        type: 'story',
        description: text.slice(0, 80),
        start: u.range.start,
        end: u.range.end,
        evidence,
        importance: 0.75
      })
    }
  }
  return draftsToEvents(drafts, fps)
}

/** 从事件反推基础导演意图 */
export function inferIntentsFromEvents(events: SemanticEvent[]): DirectorIntent[] {
  const intents: DirectorIntent[] = []
  for (const ev of events) {
    if (ev.label === 'price_announce') {
      intents.push({
        id: intentId(ev.id, 'sell'),
        trigger: ev.id,
        goal: 'sell',
        techniques: [
          { track: 'camera', action: 'push_in', params: { zoom: 1.12 } },
          { track: 'text', action: 'emphasis', params: { scale: 1.2 } }
        ],
        reason: '价格出现：推近并强调字幕', // cjk-ok
        origin: 'analysis'
      })
    } else if (ev.label === 'cta') {
      intents.push({
        id: intentId(ev.id, 'clarify'),
        trigger: ev.id,
        goal: 'clarify',
        techniques: [{ track: 'text', action: 'emphasis', params: { scale: 1.15 } }],
        reason: '行动号召：加强字幕', // cjk-ok
        origin: 'analysis'
      })
    }
  }
  return intents
}

/** 解析模型返回的 JSON 数组（容错代码块） */
export function parseJsonArray<T>(text: string): T[] {
  const trimmed = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  const body = fence ? fence[1]!.trim() : trimmed
  const start = body.indexOf('[')
  const end = body.lastIndexOf(']')
  if (start < 0 || end < start) return []
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as unknown
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export function parseShotDescriptions(text: string): ShotDescription[] {
  return parseJsonArray<ShotDescription>(text).filter((d) => typeof d.shotId === 'string')
}

export function parseEventDrafts(text: string): RawEventDraft[] {
  return parseJsonArray<RawEventDraft>(text).filter(
    (d) => typeof d.label === 'string' && Array.isArray(d.evidence)
  )
}
