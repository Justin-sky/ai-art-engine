/** 成片时间线：存于剧本资产 genParams.scriptTimeline */
export type ScriptTimelineTrackKind = 'video' | 'voice' | 'subtitle' | 'music'

export type ScriptTimelineSource = {
  id: string
  title: string
  relativePath?: string
  assetId?: string
  /** 元数据时长（秒）；未知时由预览探测补齐 */
  durationSec?: number
}

export type ScriptTimelineClip = {
  id: string
  track: ScriptTimelineTrackKind
  sourceId: string
  title: string
  relativePath?: string
  assetId?: string
  /** 轨道上的起始时间（秒） */
  startSec: number
  durationSec: number
}

export type ScriptTimelineSettings = {
  /** 时间线总时长（秒）；至少覆盖素材内容 */
  durationSec?: number
  /** 播放速度倍率 */
  playbackRate?: number
  /** 播放到末尾后循环 */
  loop?: boolean
}

export type ScriptTimelineDocument = {
  clips: ScriptTimelineClip[]
  /** 最近一次从输出节点收集到的素材（便于关闭后再开） */
  sources?: ScriptTimelineSource[]
  settings?: ScriptTimelineSettings
}

export const SCRIPT_TIMELINE_PARAM_KEY = 'scriptTimeline'

const PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const

export function normalizePlaybackRate(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 1
  let best = 1
  let bestDist = Infinity
  for (const rate of PLAYBACK_RATES) {
    const d = Math.abs(rate - n)
    if (d < bestDist) {
      best = rate
      bestDist = d
    }
  }
  return best
}

export function readScriptTimelineFromGenParams(
  genParams?: Record<string, unknown> | null
): ScriptTimelineDocument {
  const raw = genParams?.[SCRIPT_TIMELINE_PARAM_KEY]
  if (!raw || typeof raw !== 'object') return { clips: [] }
  const doc = raw as ScriptTimelineDocument
  return {
    clips: Array.isArray(doc.clips) ? doc.clips.filter(isClip) : [],
    sources: Array.isArray(doc.sources) ? doc.sources.filter(isSource) : [],
    settings: sanitizeSettings(doc.settings)
  }
}

export function withScriptTimeline(
  genParams: Record<string, unknown> | null | undefined,
  timeline: ScriptTimelineDocument
): Record<string, unknown> {
  const settings = sanitizeSettings(timeline.settings)
  return {
    ...(genParams ?? {}),
    [SCRIPT_TIMELINE_PARAM_KEY]: {
      clips: timeline.clips,
      ...(timeline.sources?.length ? { sources: timeline.sources } : {}),
      ...(settings ? { settings } : {})
    }
  }
}

function sanitizeSettings(raw: unknown): ScriptTimelineSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const row = raw as ScriptTimelineSettings
  const next: ScriptTimelineSettings = {}
  if (typeof row.durationSec === 'number' && Number.isFinite(row.durationSec) && row.durationSec > 0) {
    next.durationSec = Math.min(3600, Math.max(1, row.durationSec))
  }
  if (row.playbackRate != null) {
    next.playbackRate = normalizePlaybackRate(row.playbackRate)
  }
  if (typeof row.loop === 'boolean') next.loop = row.loop
  return Object.keys(next).length ? next : undefined
}

function isSource(item: unknown): item is ScriptTimelineSource {
  if (!item || typeof item !== 'object') return false
  const row = item as ScriptTimelineSource
  return typeof row.id === 'string' && typeof row.title === 'string'
}

function isClip(item: unknown): item is ScriptTimelineClip {
  if (!item || typeof item !== 'object') return false
  const row = item as ScriptTimelineClip
  return (
    typeof row.id === 'string' &&
    typeof row.sourceId === 'string' &&
    typeof row.title === 'string' &&
    typeof row.startSec === 'number' &&
    typeof row.durationSec === 'number' &&
    (row.track === 'video' ||
      row.track === 'voice' ||
      row.track === 'subtitle' ||
      row.track === 'music')
  )
}
