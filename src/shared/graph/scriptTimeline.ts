/** 成片时间线：存于剧本资产 genParams.scriptTimeline */
export type ScriptTimelineTrackKind = 'video' | 'overlay' | 'voice' | 'subtitle' | 'music'

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
  /** 仅 input：来源图节点 id（时间线上「重拍此镜头」定位用） */
  nodeId?: string
  /** 仅 input：来源图节点标题（展示/定位提示用） */
  nodeTitle?: string
}

export type ScriptTimelineClip = {
  id: string
  track: ScriptTimelineTrackKind
  sourceId: string
  title: string
  relativePath?: string
  assetId?: string
  /** 来源图节点 id（回到对应节点图分支 / 时间线重拍） */
  sourceNodeId?: string
  /** 来源图节点标题（展示用） */
  sourceNodeTitle?: string
  /** 字幕轨正文；无媒体时仅烧录/叠加此文本 */
  text?: string
  /** 轨道上的起始时间（秒） */
  startSec: number
  durationSec: number
  /** 声音/音乐轨片段音量（0~1） */
  volume?: number
  /** 淡入时长（秒） */
  fadeInSec?: number
  /** 淡出时长（秒） */
  fadeOutSec?: number
  /** 画中画左边界（相对导出画布宽度，0~1） */
  overlayX?: number
  /** 画中画上边界（相对导出画布高度，0~1） */
  overlayY?: number
  /** 画中画宽度（相对导出画布宽度，0~1） */
  overlayWidth?: number
  /** 画中画高度（相对导出画布高度，0~1） */
  overlayHeight?: number
  /** 画中画不透明度（0~1） */
  opacity?: number
  /** 入场淡入转场时长（秒，视频轨） */
  transitionInSec?: number
  /** 出场淡出转场时长（秒，视频轨） */
  transitionOutSec?: number
  /** 转场效果：none/dissolve/fade/flash */
  transitionType?:
    | 'none'
    | 'dissolve'
    | 'fade'
    | 'fadeout'
    | 'fadein'
    | 'flash'
    | 'slideleft'
    | 'slideright'
    | 'slideup'
    | 'slidedown'
    | 'wipeleft'
    | 'wiperight'
    | 'wipeup'
    | 'wipedown'
    | 'circleopen'
    | 'circleclose'
}

export type ScriptTimelineSettings = {
  /** 时间线总时长（秒）；至少覆盖素材内容 */
  durationSec?: number
  /** 播放速度倍率 */
  playbackRate?: number
  /** 播放到末尾后循环 */
  loop?: boolean
  /** 导出画布宽度（像素） */
  exportWidth?: number
  /** 导出画布高度（像素） */
  exportHeight?: number
  /** 导出帧率 */
  exportFps?: number
  /** 视频目标码率（kbps） */
  exportVideoBitrateKbps?: number
  /** 字幕字号（像素） */
  subtitleFontSize?: number
  /** 字幕距底部距离（像素） */
  subtitleYOffset?: number
  /** 字幕颜色（#RRGGBB） */
  subtitleColor?: string
  /** 预览框比例：video/export/16:9/9:16/1:1/4:3/3:4 */
  previewFrameRatio?: string
  /** 时间线轨道高度（像素） */
  trackHeight?: number
}

export type ScriptTimelineDocument = {
  clips: ScriptTimelineClip[]
  /** 最近一次从输出节点收集到的素材（便于关闭后再开） */
  sources?: ScriptTimelineSource[]
  /** 导入素材的自定义分组 */
  sourceGroups?: ScriptTimelineSourceGroup[]
  /** 当前隐藏的轨道 */
  hiddenTracks?: ScriptTimelineTrackKind[]
  /** 当前锁定的轨道 */
  lockedTracks?: ScriptTimelineTrackKind[]
  /** 当前折叠的轨道 */
  collapsedTracks?: ScriptTimelineTrackKind[]
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
  volume?: number
  fadeInSec?: number
  fadeOutSec?: number
  overlayX?: number
  overlayY?: number
  overlayWidth?: number
  overlayHeight?: number
  opacity?: number
  transitionInSec?: number
  transitionOutSec?: number
  transitionType?:
    | 'none'
    | 'dissolve'
    | 'fade'
    | 'fadeout'
    | 'fadein'
    | 'flash'
    | 'slideleft'
    | 'slideright'
    | 'slideup'
    | 'slidedown'
    | 'wipeleft'
    | 'wiperight'
    | 'wipeup'
    | 'wipedown'
    | 'circleopen'
    | 'circleclose'
}

export type TimelineExportInput = {
  clips: TimelineExportClip[]
  durationSec: number
  playbackRate?: number
  width?: number
  height?: number
  fps?: number
  videoBitrateKbps?: number
  subtitleFontSize?: number
  subtitleYOffset?: number
  subtitleColor?: string
  /** 另存为默认文件名（不含路径） */
  defaultFileName?: string
}

export type TimelineExportResult =
  | { ok: true; filePath: string; assetId?: string; engine: 'ffmpeg' }
  | { ok: false; canceled?: boolean; error: string }

export const SCRIPT_TIMELINE_PARAM_KEY = 'scriptTimeline'
export const SCRIPT_TIMELINE_NODE_PREFIX = 'scriptTimeline:'

function timelineParamKeyForNode(nodeId?: string): string {
  const id = nodeId?.trim()
  return id && id !== 'timeline-output' ? `${SCRIPT_TIMELINE_NODE_PREFIX}${id}` : SCRIPT_TIMELINE_PARAM_KEY
}

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
  genParams?: Record<string, unknown> | null,
  nodeId?: string
): ScriptTimelineDocument {
  const raw = genParams?.[timelineParamKeyForNode(nodeId)]
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
    hiddenTracks: Array.isArray(doc.hiddenTracks)
      ? doc.hiddenTracks.filter(isTrackKind)
      : [],
    lockedTracks: Array.isArray(doc.lockedTracks)
      ? doc.lockedTracks.filter(isTrackKind)
      : [],
    collapsedTracks: Array.isArray(doc.collapsedTracks)
      ? doc.collapsedTracks.filter(isTrackKind)
      : [],
    settings: sanitizeSettings(doc.settings)
  }
}

export function withScriptTimeline(
  genParams: Record<string, unknown> | null | undefined,
  timeline: ScriptTimelineDocument,
  nodeId?: string
): Record<string, unknown> {
  const settings = sanitizeSettings(timeline.settings)
  const sourceGroups = (timeline.sourceGroups ?? [])
    .map((item) => normalizeScriptTimelineSourceGroup(item))
    .filter((item): item is ScriptTimelineSourceGroup => !!item)
  return {
    ...(genParams ?? {}),
    [timelineParamKeyForNode(nodeId)]: {
      clips: timeline.clips,
      ...(timeline.sources?.length ? { sources: timeline.sources } : {}),
      ...(sourceGroups.length ? { sourceGroups } : {}),
      ...(timeline.hiddenTracks?.length ? { hiddenTracks: timeline.hiddenTracks } : {}),
      ...(timeline.lockedTracks?.length ? { lockedTracks: timeline.lockedTracks } : {}),
      ...(timeline.collapsedTracks?.length ? { collapsedTracks: timeline.collapsedTracks } : {}),
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
  if (typeof row.exportWidth === 'number' && Number.isFinite(row.exportWidth)) {
    next.exportWidth = Math.min(7680, Math.max(320, Math.round(row.exportWidth)))
  }
  if (typeof row.exportHeight === 'number' && Number.isFinite(row.exportHeight)) {
    next.exportHeight = Math.min(4320, Math.max(180, Math.round(row.exportHeight)))
  }
  if (typeof row.exportFps === 'number' && Number.isFinite(row.exportFps)) {
    next.exportFps = Math.min(60, Math.max(1, Math.round(row.exportFps)))
  }
  if (typeof row.exportVideoBitrateKbps === 'number' && Number.isFinite(row.exportVideoBitrateKbps)) {
    next.exportVideoBitrateKbps = Math.min(
      200000,
      Math.max(500, Math.round(row.exportVideoBitrateKbps))
    )
  }
  if (typeof row.subtitleFontSize === 'number' && Number.isFinite(row.subtitleFontSize)) {
    next.subtitleFontSize = Math.min(200, Math.max(12, Math.round(row.subtitleFontSize)))
  }
  if (typeof row.subtitleYOffset === 'number' && Number.isFinite(row.subtitleYOffset)) {
    next.subtitleYOffset = Math.min(1000, Math.max(0, Math.round(row.subtitleYOffset)))
  }
  if (typeof row.subtitleColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(row.subtitleColor.trim())) {
    next.subtitleColor = row.subtitleColor.trim()
  }
  if (
    typeof row.previewFrameRatio === 'string' &&
    [
      'video',
      'export',
      '16:9',
      '9:16',
      '1:1',
      '4:3',
      '3:4'
    ].includes(row.previewFrameRatio.trim())
  ) {
    next.previewFrameRatio = row.previewFrameRatio.trim()
  }
  if (typeof row.trackHeight === 'number' && Number.isFinite(row.trackHeight)) {
    next.trackHeight = Math.min(96, Math.max(36, Math.round(row.trackHeight)))
  }
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
  if (origin === 'input') {
    if (typeof raw.nodeId === 'string' && raw.nodeId.trim()) {
      next.nodeId = raw.nodeId.trim()
    }
    if (typeof raw.nodeTitle === 'string' && raw.nodeTitle.trim()) {
      next.nodeTitle = raw.nodeTitle.trim()
    }
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

function isTrackKind(value: unknown): value is ScriptTimelineTrackKind {
  return (
    value === 'video' ||
    value === 'overlay' ||
    value === 'voice' ||
    value === 'subtitle' ||
    value === 'music'
  )
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
      row.track === 'overlay' ||
      row.track === 'voice' ||
      row.track === 'subtitle' ||
      row.track === 'music')
  )
}
