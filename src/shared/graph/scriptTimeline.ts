/** 成片时间线：存于剧本资产 genParams.scriptTimeline */
export type ScriptTimelineTrackKind = 'video' | 'overlay' | 'voice' | 'subtitle' | 'music' | 'sfx'

/** 混音轨级增益（0~2，1=原始音量；缺省按 1） */
export type TimelineMixGains = Partial<Record<ScriptTimelineTrackKind, number>>

export const MIX_GAIN_MIN = 0
export const MIX_GAIN_MAX = 2
export const MIX_EQ_GAIN_MIN_DB = -12
export const MIX_EQ_GAIN_MAX_DB = 12

/** 轨道增益 → 线性音量（clamp 到 [0,2]） */
export function clampTrackGain(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(MIX_GAIN_MAX, Math.max(MIX_GAIN_MIN, n))
}

/** EQ 增益（dB）clamp 到 [-12,12] */
export function clampMixEqGainDb(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(MIX_EQ_GAIN_MAX_DB, Math.max(MIX_EQ_GAIN_MIN_DB, n))
}

/** 人声闪避 BGM 保留比例 clamp 到 [0.05, 0.8]，缺省 0.25 */
export function clampMixDuckingRatio(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.25
  return Math.min(0.8, Math.max(0.05, Math.round(n * 100) / 100))
}

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

/** 成片时间线画幅适配模式：contain=黑边完整保留，cover=裁切铺满，blur=高斯模糊背景填充 */
export type ScriptTimelineScaleMode = 'contain' | 'cover' | 'blur'

export const CLIP_SPEED_MIN = 0.25
export const CLIP_SPEED_MAX = 4
export const CLIP_FREEZE_TAIL_MAX_SEC = 30

/** 片段变速倍率 clamp 到 [0.25, 4]，缺省 1 */
export function clampClipSpeed(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.min(CLIP_SPEED_MAX, Math.max(CLIP_SPEED_MIN, Math.round(n * 100) / 100))
}

/** 片段尾帧定格秒数 clamp 到 [0, 30]，缺省 0 */
export function clampClipFreezeTailSec(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(CLIP_FREEZE_TAIL_MAX_SEC, Math.max(0, Math.round(n * 100) / 100))
}

export type ScriptTimelineClip = {
  id: string
  track: ScriptTimelineTrackKind
  sourceId: string
  title: string
  relativePath?: string
  assetId?: string
  /** 来源图节点 id（随素材上轨继承；时间线「重拍此镜头」/定位回节点图用） */
  nodeId?: string
  /** 来源图节点标题（展示/定位提示用） */
  nodeTitle?: string
  /** 字幕轨正文；无媒体时仅烧录/叠加此文本 */
  text?: string
  /** 轨道上的起始时间（秒） */
  startSec: number
  durationSec: number
  /** 视频 / 叠加 / 音频轨片段在源文件内的取段起点（秒）；缺省 0 = 从源文件开头 */
  sourceOffsetSec?: number
  /** 片段播放变速倍率（0.25~4，缺省 1） */
  speed?: number
  /** 视频片段末尾定格延长时长（秒，0~30，缺省 0） */
  freezeTailSec?: number
  /** 片段级亮度微调（-0.5~0.5，缺省 0） */
  brightness?: number
  /** 片段级对比度微调（0.5~2，缺省 1） */
  contrast?: number
  /** 片段级饱和度微调（0~3，缺省 1） */
  saturation?: number
  /** 字幕片段独立字色覆盖（#RRGGBB） */
  textColor?: string
  /** 字幕片段独立字号覆盖（像素） */
  fontSize?: number
  /** 声音/音乐/视频轨片段音量（0~1） */
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
  /** 画幅比例不一致时的填充方式：contain(黑边)/cover(裁切)/blur(模糊背景) */
  scaleMode?: ScriptTimelineScaleMode
  /** 字幕字号（像素） */
  subtitleFontSize?: number
  /** 字幕距底部距离（像素） */
  subtitleYOffset?: number
  /** 字幕颜色（#RRGGBB） */
  subtitleColor?: string
  /** 字幕描边颜色（#RRGGBB，默认 #000000） */
  subtitleBorderColor?: string
  /** 字幕描边宽度（像素，0~16，默认 3） */
  subtitleBorderWidth?: number
  /** 字幕底框开关 */
  subtitleBoxEnabled?: boolean
  /** 字幕底框颜色（#RRGGBB，默认 #000000） */
  subtitleBoxColor?: string
  /** 字幕底框不透明度（0.1~1，默认 0.55） */
  subtitleBoxOpacity?: number
  /** 字幕入场动效（默认 'none'；支持 'fade' / true） */
  subtitleMotion?: boolean | 'none' | 'fade'
  /** 预览框比例：video/export/16:9/9:16/1:1/4:3/3:4 */
  previewFrameRatio?: string
  /** 时间线轨道高度（像素） */
  trackHeight?: number
  /** 混音器：轨道级增益（0~2，1=原始音量；缺省按 1） */
  mixGains?: TimelineMixGains
  /** 混音器：主输出增益（0~2，1=原始音量） */
  mixMasterGain?: number
  /** 混音器：低频增益（dB，-12~12） */
  mixBassGainDb?: number
  /** 混音器：高频增益（dB，-12~12） */
  mixTrebleGainDb?: number
  /** 混音器：启用动态压缩 */
  mixCompression?: boolean
  /** 混音器：人声闪避 BGM（配音出现时自动压低音乐轨音量） */
  mixAutoDucking?: boolean
  /** 混音器：人声闪避时 BGM 保留比例（0.05~0.8，默认 0.25） */
  mixDuckingRatio?: number
  /** 混音器：响度标准化（EBU R128 / -16 LUFS） */
  mixLoudnorm?: boolean
  /** 导出目标平台预设（douyin/kuaishou/shipinhao/tiktok/youtube/custom） */
  exportPlatformId?: string
  /** 水印：是否启用 */
  watermarkEnabled?: boolean
  /** 水印：图片本地路径 */
  watermarkSrc?: string
  /** 水印：不透明度 0~1 */
  watermarkOpacity?: number
  /** 水印：相对视频宽度比例 0.05~0.5 */
  watermarkScale?: number
  /** 水印：角落位置 br/bl/tr/tl */
  watermarkPosition?: string
}

export type ScriptTimelineDocument = {
  clips: ScriptTimelineClip[]
  /** 最近一次从输出节点收集到的素材（便于关闭后再开） */
  sources?: ScriptTimelineSource[]
  /** 导入素材的自定义分组 */
  sourceGroups?: ScriptTimelineSourceGroup[]
  /** 当前隐藏的轨道 */
  hiddenTracks?: ScriptTimelineTrackKind[]
  /** 当前静音的轨道（预览与导出均不出声） */
  mutedTracks?: ScriptTimelineTrackKind[]
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
  /** 源文件内的取段起点（秒），缺省 0；打点选段片段在导出按此偏移后截取 */
  sourceOffsetSec?: number
  speed?: number
  freezeTailSec?: number
  brightness?: number
  contrast?: number
  saturation?: number
  textColor?: string
  fontSize?: number
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
  scaleMode?: ScriptTimelineScaleMode
  subtitleFontSize?: number
  subtitleYOffset?: number
  subtitleColor?: string
  subtitleBorderColor?: string
  subtitleBorderWidth?: number
  subtitleBoxEnabled?: boolean
  subtitleBoxColor?: string
  subtitleBoxOpacity?: number
  subtitleMotion?: boolean | 'none' | 'fade'
  /** 混音器：轨道级增益（0~2） */
  mixGains?: TimelineMixGains
  /** 混音器：主输出增益（0~2） */
  mixMasterGain?: number
  /** 混音器：低频增益（dB） */
  mixBassGainDb?: number
  /** 混音器：高频增益（dB） */
  mixTrebleGainDb?: number
  /** 混音器：启用动态压缩 */
  mixCompression?: boolean
  /** 混音器：人声闪避 BGM */
  mixAutoDucking?: boolean
  /** 混音器：人声闪避保留比例（0.05~0.8，默认 0.25） */
  mixDuckingRatio?: number
  /** 混音器：响度标准化（-16 LUFS） */
  mixLoudnorm?: boolean
  /** 静音的轨道：这些轨道的声音不混入成片 */
  mutedTracks?: ScriptTimelineTrackKind[]
  /** 水印：图片文件绝对路径（启用时叠加到成片） */
  watermarkSrc?: string
  /** 水印：不透明度 0~1 */
  watermarkOpacity?: number
  /** 水印：相对视频宽度比例（0.05~0.5） */
  watermarkScale?: number
  /** 水印：角落位置 */
  watermarkPosition?: 'br' | 'bl' | 'tr' | 'tl'
  /** 另存为默认文件名（不含路径） */
  defaultFileName?: string
  /**
   * 目标文件绝对路径（无界面 / Agent 链路必填）：给出时不弹「另存为」对话框，
   * 直接写该路径（缺扩展名自动补 .mp4，自动创建父目录）。
   */
  targetPath?: string
}

export type TimelineExportResult =
  | { ok: true; filePath: string; assetId?: string; engine: 'ffmpeg' }
  | { ok: false; canceled?: boolean; error: string }

/**
 * 转场窗口 ffmpeg 微渲染请求（编辑器预览用）。
 * 语义与导出 buildFilterGraph 的单段 cross 段完全一致：A 尾窗(实际转场时长) + B 头窗(整个重叠窗口)
 * 做一次 xfade(duration=转场时长, offset=0)，输出覆盖 [B.startSec, A.endSec] 的整段预览画面。
 */
export type TimelineTransitionPreviewInput = {
  /** 前段 A：转场尾窗来源（srcOff + duration - overlap 处取 d 秒参与交叉淡化） */
  left: TimelineExportClip
  /** 后段 B：转场头窗来源（srcOff 处取 overlap 秒，淡化结束后继续播放） */
  right: TimelineExportClip
  /** 输出宽（预览画幅；主进程会按等比钳制到上限） */
  width?: number
  height?: number
  fps?: number
}

export type TimelineTransitionPreviewResult =
  | {
      ok: true
      /** studio-media 可播放 URL */ url: string
      /** 覆盖窗口时长（秒）= overlap */ durationSec: number
    }
  | { ok: false; /** 无转场 / ffmpeg 缺失 / 渲染失败 */ error: string }

export const SCRIPT_TIMELINE_PARAM_KEY = 'scriptTimeline'
export const SCRIPT_TIMELINE_NODE_PREFIX = 'scriptTimeline:'

function timelineParamKeyForNode(nodeId?: string): string {
  const id = nodeId?.trim()
  return id && id !== 'timeline-output'
    ? `${SCRIPT_TIMELINE_NODE_PREFIX}${id}`
    : SCRIPT_TIMELINE_PARAM_KEY
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
    hiddenTracks: Array.isArray(doc.hiddenTracks) ? doc.hiddenTracks.filter(isTrackKind) : [],
    mutedTracks: Array.isArray(doc.mutedTracks) ? doc.mutedTracks.filter(isTrackKind) : [],
    lockedTracks: Array.isArray(doc.lockedTracks) ? doc.lockedTracks.filter(isTrackKind) : [],
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
      ...(timeline.mutedTracks?.length ? { mutedTracks: timeline.mutedTracks } : {}),
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
  if (
    typeof row.durationSec === 'number' &&
    Number.isFinite(row.durationSec) &&
    row.durationSec > 0
  ) {
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
  if (
    typeof row.exportVideoBitrateKbps === 'number' &&
    Number.isFinite(row.exportVideoBitrateKbps)
  ) {
    next.exportVideoBitrateKbps = Math.min(
      200000,
      Math.max(500, Math.round(row.exportVideoBitrateKbps))
    )
  }
  if (
    typeof row.scaleMode === 'string' &&
    (row.scaleMode === 'contain' || row.scaleMode === 'cover' || row.scaleMode === 'blur')
  ) {
    next.scaleMode = row.scaleMode
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
    typeof row.subtitleBorderColor === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(row.subtitleBorderColor.trim())
  ) {
    next.subtitleBorderColor = row.subtitleBorderColor.trim()
  }
  if (typeof row.subtitleBorderWidth === 'number' && Number.isFinite(row.subtitleBorderWidth)) {
    next.subtitleBorderWidth = Math.min(16, Math.max(0, Math.round(row.subtitleBorderWidth)))
  }
  if (typeof row.subtitleBoxEnabled === 'boolean') {
    next.subtitleBoxEnabled = row.subtitleBoxEnabled
  }
  if (
    typeof row.subtitleBoxColor === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(row.subtitleBoxColor.trim())
  ) {
    next.subtitleBoxColor = row.subtitleBoxColor.trim()
  }
  if (typeof row.subtitleBoxOpacity === 'number' && Number.isFinite(row.subtitleBoxOpacity)) {
    next.subtitleBoxOpacity = Math.min(
      1,
      Math.max(0.1, Math.round(row.subtitleBoxOpacity * 100) / 100)
    )
  }
  if (
    typeof row.subtitleMotion === 'boolean' ||
    row.subtitleMotion === 'none' ||
    row.subtitleMotion === 'fade'
  ) {
    next.subtitleMotion = row.subtitleMotion
  }
  if (
    typeof row.previewFrameRatio === 'string' &&
    ['video', 'export', '16:9', '9:16', '1:1', '4:3', '3:4'].includes(row.previewFrameRatio.trim())
  ) {
    next.previewFrameRatio = row.previewFrameRatio.trim()
  }
  if (typeof row.trackHeight === 'number' && Number.isFinite(row.trackHeight)) {
    next.trackHeight = Math.min(96, Math.max(36, Math.round(row.trackHeight)))
  }
  if (row.mixGains && typeof row.mixGains === 'object') {
    const mixGains: TimelineMixGains = {}
    for (const key of Object.keys(row.mixGains) as Array<keyof TimelineMixGains>) {
      const v = (row.mixGains as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) {
        mixGains[key] = clampTrackGain(v)
      }
    }
    if (Object.keys(mixGains).length) next.mixGains = mixGains
  }
  if (row.mixMasterGain != null) {
    next.mixMasterGain = clampTrackGain(row.mixMasterGain)
  }
  if (row.mixBassGainDb != null) {
    next.mixBassGainDb = clampMixEqGainDb(row.mixBassGainDb)
  }
  if (row.mixTrebleGainDb != null) {
    next.mixTrebleGainDb = clampMixEqGainDb(row.mixTrebleGainDb)
  }
  if (typeof row.mixCompression === 'boolean') next.mixCompression = row.mixCompression
  if (typeof row.mixAutoDucking === 'boolean') next.mixAutoDucking = row.mixAutoDucking
  if (typeof row.mixDuckingRatio === 'number' && Number.isFinite(row.mixDuckingRatio)) {
    next.mixDuckingRatio = Math.min(
      0.8,
      Math.max(0.05, Math.round(row.mixDuckingRatio * 100) / 100)
    )
  }
  if (typeof row.mixLoudnorm === 'boolean') next.mixLoudnorm = row.mixLoudnorm
  if (typeof row.exportPlatformId === 'string' && row.exportPlatformId.trim()) {
    next.exportPlatformId = row.exportPlatformId
  }
  if (typeof row.watermarkEnabled === 'boolean') next.watermarkEnabled = row.watermarkEnabled
  if (typeof row.watermarkSrc === 'string' && row.watermarkSrc.trim()) {
    next.watermarkSrc = row.watermarkSrc
  }
  if (typeof row.watermarkOpacity === 'number') {
    next.watermarkOpacity = Math.min(1, Math.max(0.05, row.watermarkOpacity))
  }
  if (typeof row.watermarkScale === 'number') {
    next.watermarkScale = Math.min(0.5, Math.max(0.05, row.watermarkScale))
  }
  if (
    typeof row.watermarkPosition === 'string' &&
    ['br', 'bl', 'tr', 'tl'].includes(row.watermarkPosition)
  ) {
    next.watermarkPosition = row.watermarkPosition
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
  const origin: ScriptTimelineSourceOrigin = raw.origin === 'imported' ? 'imported' : 'input'
  const mediaKind: ScriptTimelineSourceMediaKind = raw.mediaKind === 'voice' ? 'voice' : 'video'
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
  if (
    typeof raw.durationSec === 'number' &&
    Number.isFinite(raw.durationSec) &&
    raw.durationSec > 0
  ) {
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

/**
 * 在时间点 `atSec` 处将片段一分为二：
 * - 前半段保留原入点、入场淡入/转场，清除出场淡出/转场与尾帧定格；
 * - 后半段起点为 `atSec`，媒体片段自动推进 `sourceOffsetSec += delta * speed`，
 *   清除入场淡入/转场，保留原出场淡出/转场与尾帧定格。
 */
export function splitTimelineClipAtTime(
  clip: ScriptTimelineClip,
  atSec: number,
  secondId: string,
  minDurationSec = 0.2
): [ScriptTimelineClip, ScriptTimelineClip] | null {
  const delta = atSec - clip.startSec
  const remain = clip.startSec + clip.durationSec - atSec
  if (!Number.isFinite(delta) || !Number.isFinite(remain)) return null
  if (delta < minDurationSec || remain < minDurationSec) return null
  const speed = clampClipSpeed(clip.speed)
  const srcOff = Math.max(
    0,
    Number.isFinite(clip.sourceOffsetSec) ? Number(clip.sourceOffsetSec) : 0
  )
  const first: ScriptTimelineClip = {
    ...clip,
    durationSec: Number(delta.toFixed(3))
  }
  delete first.fadeOutSec
  delete first.transitionOutSec
  delete first.freezeTailSec

  const second: ScriptTimelineClip = {
    ...clip,
    id: secondId,
    startSec: Number(atSec.toFixed(3)),
    durationSec: Number(remain.toFixed(3))
  }
  if (clip.track !== 'subtitle') {
    second.sourceOffsetSec = Number((srcOff + delta * speed).toFixed(3))
  }
  delete second.fadeInSec
  delete second.transitionInSec

  return [first, second]
}

/**
 * 磁性消除指定轨道（缺省为 `video` 主视频轨）上的空白间隙：
 * - 正向间隙（`clip.startSec > prevEnd`）全部收拢；
 * - 负向重叠（相邻视频片段用于 xfade 的交叉转场重叠）原样保留。
 */
export function closeTimelineTrackGaps(
  clips: ScriptTimelineClip[],
  track: ScriptTimelineTrackKind = 'video'
): { clips: ScriptTimelineClip[]; closedCount: number; savedSec: number } {
  const targetClips = clips
    .filter((c) => c.track === track)
    .slice()
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
  if (targetClips.length === 0) {
    return { clips: clips.map((c) => ({ ...c })), closedCount: 0, savedSec: 0 }
  }
  let accumulatedShift = 0
  let prevOriginalEnd = 0
  let closedCount = 0
  const shiftedStartById = new Map<string, number>()
  for (const clip of targetClips) {
    const gap = clip.startSec - prevOriginalEnd
    if (gap > 1e-3) {
      accumulatedShift += gap
      closedCount += 1
    }
    const nextStart = Math.max(0, Math.round((clip.startSec - accumulatedShift) * 1000) / 1000)
    shiftedStartById.set(clip.id, nextStart)
    prevOriginalEnd = Math.max(prevOriginalEnd, clip.startSec + clip.durationSec)
  }
  const savedSec = Math.round(accumulatedShift * 1000) / 1000
  if (closedCount === 0 || savedSec <= 0) {
    return { clips: clips.map((c) => ({ ...c })), closedCount: 0, savedSec: 0 }
  }
  const nextClips = clips.map((clip) => {
    const nextStart = shiftedStartById.get(clip.id)
    if (nextStart === undefined) return { ...clip }
    return { ...clip, startSec: nextStart }
  })
  return { clips: nextClips, closedCount, savedSec }
}

function isTrackKind(value: unknown): value is ScriptTimelineTrackKind {
  return (
    value === 'video' ||
    value === 'overlay' ||
    value === 'voice' ||
    value === 'subtitle' ||
    value === 'music' ||
    value === 'sfx'
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
      row.track === 'music' ||
      row.track === 'sfx')
  )
}
