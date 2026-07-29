/** 成片时间线：存于剧本资产 genParams.scriptTimeline */
export type ScriptTimelineTrackKind = 'video' | 'voice' | 'subtitle' | 'music'

/** 左侧素材来源：节点上游收集 vs 资产库/系统文件拖入 */
export type ScriptTimelineSourceOrigin = 'input' | 'imported'

/** 左侧素材媒体类型（决定双击默认上哪条轨） */
export type ScriptTimelineSourceMediaKind = 'video' | 'voice'

export type ScriptTimelineSourceGroup = {
  id: string
  title: string
}

export type ScriptTimelineSource = {
  id: string
  title: string
  relativePath?: string
  assetId?: string
  /** 元数据时长（秒）；未知时由预览探测补齐 */
  durationSec?: number
  /** 缺省按 input 兼容旧数据；拖入素材写 imported */
  origin?: ScriptTimelineSourceOrigin
  /** 缺省按 video 兼容旧数据 */
  mediaKind?: ScriptTimelineSourceMediaKind
  /** 仅 imported：所属分组；空/缺省=未分组 */
  groupId?: string | null
}

export type ScriptTimelineClip = {
  id: string
  track: ScriptTimelineTrackKind
  sourceId: string
  title: string
  relativePath?: string
  assetId?: string
  /** 字幕轨正文；无媒体时仅烧录/叠加此文本 */
  text?: string
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
  /** 导入素材的自定义分组 */
  sourceGroups?: ScriptTimelineSourceGroup[]
  settings?: ScriptTimelineSettings
}

/** 导出成片时传给主进程的片段 */
export type TimelineExportClip = {
  track: ScriptTimelineTrackKind
  /** 工程相对路径；主进程解析为绝对路径 */
  relativePath?: string
  /** 可选绝对路径（调试/外部文件） */
  absPath?: string
  text?: string
  title: string
  startSec: number
  durationSec: number
}

export type TimelineExportInput = {
  clips: TimelineExportClip[]
  durationSec: number
  playbackRate?: number
  /** 另存为默认文件名（不含路径） */
  defaultFileName?: string
}

export type TimelineExportResult =
  | { ok: true; filePath: string; assetId?: string; engine: 'ffmpeg' }
  | { ok: false; canceled?: boolean; error: string }

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

export function contentEndSecOfTimeline(clips: ScriptTimelineClip[]): number {
  let max = 0
  for (const clip of clips) {
    max = Math.max(max, clip.startSec + clip.durationSec)
  }
  return max
}

export function readScriptTimelineFromGenParams(
  genParams?: Record<string, unknown> | null
): ScriptTimelineDocument {
  const raw = genParams?.[SCRIPT_TIMELINE_PARAM_KEY]
  if (!raw || typeof raw !== 'object') return { clips: [] }
  const doc = raw as ScriptTimelineDocument
  return {
    clips: Array.isArray(doc.clips) ? doc.clips.filter(isClip) : [],
    sources: Array.isArray(doc.sources)
      ? doc.sources
          .map((item) => normalizeScriptTimelineSource(item))
          .filter((item): item is ScriptTimelineSource => !!item)
      : [],
    sourceGroups: Array.isArray(doc.sourceGroups)
      ? doc.sourceGroups
          .map((item) => normalizeScriptTimelineSourceGroup(item))
          .filter((item): item is ScriptTimelineSourceGroup => !!item)
      : [],
    settings: sanitizeSettings(doc.settings)
  }
}

export function withScriptTimeline(
  genParams: Record<string, unknown> | null | undefined,
  timeline: ScriptTimelineDocument
): Record<string, unknown> {
  const settings = sanitizeSettings(timeline.settings)
  const sourceGroups = (timeline.sourceGroups ?? [])
    .map((item) => normalizeScriptTimelineSourceGroup(item))
    .filter((item): item is ScriptTimelineSourceGroup => !!item)
  return {
    ...(genParams ?? {}),
    [SCRIPT_TIMELINE_PARAM_KEY]: {
      clips: timeline.clips,
      ...(timeline.sources?.length ? { sources: timeline.sources } : {}),
      ...(sourceGroups.length ? { sourceGroups } : {}),
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

export function normalizeScriptTimelineSourceGroup(
  raw: Partial<ScriptTimelineSourceGroup> | null | undefined
): ScriptTimelineSourceGroup | null {
  if (!raw || typeof raw.id !== 'string' || !raw.id.trim()) return null
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null
  return { id: raw.id.trim(), title: raw.title.trim() }
}

export function normalizeScriptTimelineSource(
  raw: Partial<ScriptTimelineSource> | null | undefined
): ScriptTimelineSource | null {
  if (!raw || typeof raw.id !== 'string' || typeof raw.title !== 'string') return null
  const origin: ScriptTimelineSourceOrigin =
    raw.origin === 'imported' ? 'imported' : 'input'
  const mediaKind: ScriptTimelineSourceMediaKind =
    raw.mediaKind === 'voice' ? 'voice' : 'video'
  const next: ScriptTimelineSource = {
    id: raw.id,
    title: raw.title,
    origin,
    mediaKind
  }
  if (typeof raw.relativePath === 'string' && raw.relativePath.trim()) {
    next.relativePath = raw.relativePath.trim()
  }
  if (typeof raw.assetId === 'string' && raw.assetId.trim()) {
    next.assetId = raw.assetId.trim()
  }
  if (typeof raw.durationSec === 'number' && Number.isFinite(raw.durationSec) && raw.durationSec > 0) {
    next.durationSec = raw.durationSec
  }
  if (origin === 'imported') {
    if (typeof raw.groupId === 'string' && raw.groupId.trim()) {
      next.groupId = raw.groupId.trim()
    } else if (raw.groupId === null) {
      next.groupId = null
    }
  }
  return next
}

function isSource(item: unknown): item is ScriptTimelineSource {
  return normalizeScriptTimelineSource(item as Partial<ScriptTimelineSource>) != null
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
