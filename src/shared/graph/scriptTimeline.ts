/** 成片时间线：存于剧本资产 genParams.scriptTimeline */
import {
  normalizeTimelineKeyframes,
  type TimelineBuiltinStickerId,
  type TimelineClipKeyframe,
  type TimelineEaseType,
  type TimelineMainCameraPreset,
  type TimelineTweenInPreset,
  type TimelineTweenLoopPreset,
  type TimelineTweenOutPreset
} from './timelineTween'
import type { TimelineFilterPresetId, TimelineVisualEffectId } from './timelineCreativePack'

export * from './timelineTween'
export * from './timelineCreativePack'

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
export const TRACK_LANE_MAX = 8

/** 同类型轨道的子轨道索引归一化（0~7，缺省 0） */
export function normalizeClipLane(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(TRACK_LANE_MAX - 1, Math.max(0, Math.floor(n)))
}

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

export type ScriptTimelineTransitionType =
  | 'none'
  | 'dissolve'
  | 'fade'
  | 'fadeout'
  | 'fadein'
  | 'flash'
  | 'fadegrays'
  | 'hblur'
  | 'distance'
  | 'smoothleft'
  | 'smoothright'
  | 'smoothup'
  | 'smoothdown'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'wipetl'
  | 'wipetr'
  | 'wipebl'
  | 'wipebr'
  | 'circleopen'
  | 'circleclose'
  | 'rectcrop'
  | 'radial'
  | 'zoomin'
  | 'pixelize'
  | 'horzopen'
  | 'horzclose'
  | 'vertopen'
  | 'vertclose'
  | 'hlslice'
  | 'hrslice'
  | 'vuslice'
  | 'vdslice'
  | 'squeezeh'
  | 'squeezev'
  | 'diagtl'
  | 'diagbr'

export type ScriptTimelineClip = {
  id: string
  track: ScriptTimelineTrackKind
  /** 同类型轨道下的并行子轨索引（0=第1轨，1=第2轨……；支持同类型多轨自由时间重叠） */
  lane?: number
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
  /** 自然饱和度微调（-100~100，缺省 0） */
  vibrance?: number
  /** 色温微调（-100~100，缺省 0） */
  temperature?: number
  /** 色调微调（-100~100，缺省 0） */
  tint?: number
  /** 高光微调（-100~100，缺省 0） */
  highlights?: number
  /** 阴影微调（-100~100，缺省 0） */
  shadows?: number
  /** 锐化强度（0~100，缺省 0） */
  sharpen?: number
  /** 暗角强度（0~100，缺省 0） */
  vignette?: number
  /** 褪色灰雾（0~100，缺省 0） */
  fade?: number
  /** 胶片颗粒（0~100，缺省 0） */
  grain?: number
  /** 滤镜预设 ID */
  filterPreset?: TimelineFilterPresetId
  /** 滤镜强度（0~100，缺省 100） */
  filterIntensity?: number
  /** 画面特效 ID */
  visualEffect?: TimelineVisualEffectId
  /** 特效强度（0~100，缺省 75） */
  effectIntensity?: number
  /** 画面裁剪左边界（相对源画面宽度，0~1，缺省 0） */
  cropX?: number
  /** 画面裁剪上边界（相对源画面高度，0~1，缺省 0） */
  cropY?: number
  /** 画面裁剪宽度（相对源画面宽度，0.05~1，缺省 1） */
  cropWidth?: number
  /** 画面裁剪高度（相对源画面高度，0.05~1，缺省 1） */
  cropHeight?: number
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
  /** 画中画/贴纸旋转角度（度，-360~360，缺省 0） */
  overlayRotation?: number
  /** 画中画不透明度（0~1） */
  opacity?: number
  /** DOTween 入场补间预设（画中画 / 贴纸） */
  tweenIn?: TimelineTweenInPreset
  /** DOTween 入场时长（秒，缺省 0.45） */
  tweenInDurationSec?: number
  /** DOTween 入场缓动曲线 */
  tweenInEase?: TimelineEaseType
  /** DOTween 出场补间预设（画中画 / 贴纸） */
  tweenOut?: TimelineTweenOutPreset
  /** DOTween 出场时长（秒，缺省 0.4） */
  tweenOutDurationSec?: number
  /** DOTween 出场缓动曲线 */
  tweenOutEase?: TimelineEaseType
  /** DOTween 循环待机动画预设（画中画 / 贴纸） */
  tweenLoop?: TimelineTweenLoopPreset
  /** DOTween 循环频率（Hz，缺省 1.2） */
  tweenLoopSpeedHz?: number
  /** DOTween 循环幅度倍率（0.1~3，缺省 1） */
  tweenLoopIntensity?: number
  /** 主视频轨（或画中画）Ken Burns 推拉摇移运镜预设 */
  cameraMotion?: TimelineMainCameraPreset
  /** DOTween Sequence 多关键帧序列（局部时间 offsetSec 升序） */
  keyframes?: TimelineClipKeyframe[]
  /** 内置参数化贴纸 ID（由贴纸库插入时记录） */
  stickerId?: TimelineBuiltinStickerId | string
  /** 内置参数化贴纸主色覆盖（#RRGGBB） */
  stickerColor?: string
  /** 入场淡入转场时长（秒，视频轨） */
  transitionInSec?: number
  /** 出场淡出转场时长（秒，视频轨） */
  transitionOutSec?: number
  /** 转场效果 */
  transitionType?: ScriptTimelineTransitionType
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
  /** 各轨道类型展开的并行子轨道数量（1~8，缺省按片段实际最大 lane+1 自动展开） */
  trackLaneCounts?: Partial<Record<ScriptTimelineTrackKind, number>>
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
  /** 同类型轨道下的并行子轨索引（0=第1轨，1=第2轨……） */
  lane?: number
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
  vibrance?: number
  temperature?: number
  tint?: number
  highlights?: number
  shadows?: number
  sharpen?: number
  vignette?: number
  fade?: number
  grain?: number
  filterPreset?: TimelineFilterPresetId
  filterIntensity?: number
  visualEffect?: TimelineVisualEffectId
  effectIntensity?: number
  cropX?: number
  cropY?: number
  cropWidth?: number
  cropHeight?: number
  textColor?: string
  fontSize?: number
  volume?: number
  fadeInSec?: number
  fadeOutSec?: number
  overlayX?: number
  overlayY?: number
  overlayWidth?: number
  overlayHeight?: number
  overlayRotation?: number
  opacity?: number
  tweenIn?: TimelineTweenInPreset
  tweenInDurationSec?: number
  tweenInEase?: TimelineEaseType
  tweenOut?: TimelineTweenOutPreset
  tweenOutDurationSec?: number
  tweenOutEase?: TimelineEaseType
  tweenLoop?: TimelineTweenLoopPreset
  tweenLoopSpeedHz?: number
  tweenLoopIntensity?: number
  cameraMotion?: TimelineMainCameraPreset
  keyframes?: TimelineClipKeyframe[]
  stickerId?: TimelineBuiltinStickerId | string
  stickerColor?: string
  /** 渲染进程预光栅化的 PNG dataURL（规避无 librsvg 的 FFmpeg 无法解码 .svg） */
  stickerPngDataUrl?: string
  transitionInSec?: number
  transitionOutSec?: number
  transitionType?: ScriptTimelineTransitionType
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

/**
 * 清洗并提取每一幕的真实场景名：
 * 剥离「古画取景」「写实复活」「右段/中段/左段」等节点结构/方位临时字样；
 * 若剥离后无真实场景名（例如旧节点名「第3幕·古画取景（左段）」或「【 第3幕·左段 】」），返回 undefined。
 */
export function cleanActSceneTitle(raw: string | undefined, actIndex?: number): string | undefined {
  if (!raw?.trim()) return undefined
  const trimmed = raw.trim()
  const actMatch =
    trimmed.match(/第\s*(\d+)\s*[幕场集镜章节话回]/i) ?? // cjk-ok
    trimmed.match(/(?:Act|Scene|Shot|分镜|镜头|片段)\s*#?(\d+)/i) // cjk-ok
  const actNum = actMatch ? Number(actMatch[1]) : actIndex !== undefined ? actIndex + 1 : null

  const core = trimmed
    .replace(/^[【[\s]+|[】\]\s]+$/g, '')
    .replace(/第\s*\d+\s*[幕场集镜章节话回]/gi, '') // cjk-ok
    .replace(/(?:Act|Scene|Shot|分镜|镜头|片段)\s*#?\d+/gi, '') // cjk-ok
    .replace(
      /(?:古画一镜入画|古画取景|入画取景|写实复活|北宋实景还原|实景还原|多模态识图命名|多模态识图选区|多模态识图|市井环境音|选区镜头|选区|取景|切片)/g, // cjk-ok
      ''
    )
    .replace(/(?:古画)?[右中左上前下后]段/g, '') // cjk-ok
    .replace(/[（(]\s*[·•:：\-—]?\s*[）)]/g, '')
    .replace(/^[（(]\s*|\s*[）)]$/g, '')
    .replace(/^[·•:：\-—\s（()）]+|[·•:：\-—\s（()）]+$/g, '')
    .trim()

  if (
    !core ||
    core.length < 2 ||
    /^(?:[右中左上前下后]段|古画|取景|复活|实景|还原|\d+)$/i.test(core) // cjk-ok
  ) {
    return undefined
  }
  return actNum !== null ? `第${actNum}幕 · ${core}` : core // cjk-ok
}

/**
 * 从识图文本或节点提示词中提取干净、优美的古风叙事字幕分句（过滤模型提示词工程术语与格式引导语）。
 */
export function extractActNarrationSegments(rawText: string | undefined): string[] {
  if (!rawText?.trim()) return []
  let body = rawText
    .trim()
    .replace(/^【[^】]{1,32}】\s*/, '')
    .replace(
      /^(?:请仔细识别|严格按以下格式|第一行必须为|多模态识图选区|Default reference window).*$/gim, // cjk-ok
      ''
    )

  // 若包含多行「第二行/第三行」结构，优先提取描述鲜活运动的第三行或去除行号前缀
  const lines = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  const thirdLine = lines.find((l) => /^第三行\s*[:：]/.test(l)) // cjk-ok
  if (thirdLine) {
    body = thirdLine
  } else {
    body = lines.filter((l) => !/^第[一1]行\s*[:：]/.test(l)).join('，') // cjk-ok
  }

  const prefixLabelRe =
    /^(?:第[一二三四1234]行|场景名|画面描述|动态描述|镜头描述|解说词|旁白|字幕)\s*[:：]\s*/gm // cjk-ok
  const dollyLeadRe =
    /^[^：:\n]{0,38}(?:一镜到底|向前推进|严格依据参考图|转化为\s*8K)[^：:\n]*[：:]\s*/gm // cjk-ok
  const reviveLeadRe =
    /^(?:结合识图描述[，,、]?\s*)?(?:画面中的[^，,。]{0,14}完全活过来[，,、]?\s*|画中(?:数十名)?人物全部鲜活运动起来[，,、]?\s*|整条古街人物全部活起来[，,、]?\s*)/gm // cjk-ok
  const parenMetaRe =
    /[（(][^）)]*(?:1:1|写实|还原|构图|选区|Dolly|Push-In|Immersive|Cinematic|Smooth|[右中左]段|例如|x∈)[^）)]*[）)]/gi // cjk-ok
  const techClauseRe =
    /(?:1:1|8K|35mm|ARRI|水印|参考图|第一行|第二行|第三行|四字古风|彻底去除|水墨线条|绢本泛黄|电影级景深|物理运动|历史大片质感|视线交互|全员自然动态|纯画面|无文字)/i // cjk-ok

  body = body
    .replace(prefixLabelRe, '')
    .replace(dollyLeadRe, '')
    .replace(reviveLeadRe, '')
    .replace(parenMetaRe, '')
    .trim()

  const rawClauses = body
    .split(/[。！？!?\n；;，,]+/)
    .map((c) => c.replace(/^[\s、·•:：\-—]+|[\s、·•:：\-—]+$/g, '').trim())
    .filter((c) => {
      if (!c || c.length < 3) return false
      if (!/[\u4e00-\u9fa5]/.test(c)) return false
      if (techClauseRe.test(c)) {
        return false
      }
      return true
    })

  const segments: string[] = []
  let acc = ''
  for (const clause of rawClauses) {
    if (!acc) {
      acc = clause
    } else if (acc.length + 1 + clause.length <= 22) {
      acc = `${acc}，${clause}`
    } else {
      segments.push(acc)
      acc = clause
      if (segments.length >= 3) {
        acc = ''
        break
      }
    }
  }
  if (acc && segments.length < 3) {
    segments.push(acc)
  }
  return segments
}

export function isWesternMasterpieceHint(text: string | undefined): boolean {
  if (!text?.trim()) return false
  const westernRe =
    /油画|壁画|亚麻布|蛋彩|焦点透视|明暗对照|伦勃朗|巴洛克|文艺复兴|印象派|后印象派|古典主义|卢浮宫|雅典学院|柏拉图|亚里士多德|夜巡|修拉|大碗岛|雷诺阿|煎饼磨坊|莫奈|梵高|达芬奇|拉斐尔|勃鲁盖尔|维米尔|卡拉瓦乔|塞纳河|巴黎|骑士|修道院|大教堂|圣母|天使|古典拱廊|western|oil painting|fresco|renaissance|baroque|impressionis|louvre|rembrandt|raphael|monet|van gogh/i // cjk-ok
  return westernRe.test(text)
}

function inferActSceneTitleFromDescription(
  text: string,
  actIndex: number,
  culture: 'chinese' | 'western' = 'chinese'
): string {
  const prefix = `第${actIndex + 1}幕` // cjk-ok
  if (culture === 'western' || isWesternMasterpieceHint(text)) {
    if (/雅典|哲人|柏拉图|亚里士多德|学派|拱廊/.test(text)) return `${prefix} · 雅典哲思` // cjk-ok
    if (/夜巡|火枪|伦勃朗|卫队|骑士|列阵/.test(text)) return `${prefix} · 光影夜巡` // cjk-ok
    if (/舞会|磨坊|雷诺阿|塞纳河|大碗岛|阳伞|巴黎|咖啡/.test(text)) return `${prefix} · 塞纳午后` // cjk-ok
    if (/婚礼|农夫|勃鲁盖尔|宴席|酒馆/.test(text)) return `${prefix} · 佛兰德斯欢宴` // cjk-ok
    const westDefaults = ['古典群像', '透视焦点', '光影余韵'] // cjk-ok
    return `${prefix} · ${westDefaults[actIndex] ?? '名画入画'}` // cjk-ok
  }
  if (/虹桥|争渡|漕船|撑篙|拉纤|叠梁/.test(text)) return `${prefix} · 虹桥争渡` // cjk-ok
  if (/孙羊正店|彩楼|欢门|酒旗|茶肆|酒肆|古街|坊市|宵禁/.test(text)) return `${prefix} · 孙羊正店` // cjk-ok
  if (/柳岸|石桥|驮队|毛驴|城郊|汴郊/.test(text)) return `${prefix} · 汴郊柳岸` // cjk-ok
  if (/庭院|回廊|轩窗|雅集/.test(text)) return `${prefix} · 翠柳庭院` // cjk-ok
  if (/江山|青绿|峰峦|远帆/.test(text)) return `${prefix} · 千里江山` // cjk-ok
  const defaults = ['汴郊柳岸', '虹桥争渡', '孙羊正店'] // cjk-ok
  return `${prefix} · ${defaults[actIndex] ?? '古画入画'}` // cjk-ok
}

export interface ActCharacterDialogueLine {
  speaker: string
  text: string
  voice: string
  lane: number
}

const DEFAULT_WESTERN_COMMENTARY_BY_ACT: Array<{
  sceneTitle: string
  segments: string[]
  dialogues: ActCharacterDialogueLine[]
}> = [
  {
    sceneTitle: '第1幕 · 古典群像', // cjk-ok
    segments: [
      '西方古典名画以严谨的几何构图与油彩肌理，铺陈前景人物群像', // cjk-ok
      '随着镜头推入画布深处，油彩笔触悄然消融，历史人物随之苏醒' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '前景学者', // cjk-ok
        text: '诸位请看这卷手稿中的几何推演，宇宙万物的和谐比例皆藏于这光影与线条之中！', // cjk-ok
        voice: 'onyx',
        lane: 0
      },
      {
        speaker: '青年门徒', // cjk-ok
        text: '先生所言极是！容我将这组精妙的透视法则记录下来，与学园同仁共勉！', // cjk-ok
        voice: 'echo',
        lane: 1
      }
    ]
  },
  {
    sceneTitle: '第2幕 · 透视焦点', // cjk-ok
    segments: [
      '全画视觉中心汇聚于线性透视灭点，穹顶天光与戏剧性明暗交织', // cjk-ok
      '核心主角色在黄金分割点上昂首论道，定格欧洲艺术史的不朽瞬间' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '画中主哲人', // cjk-ok
        text: '仰望苍穹，真理存在于永恒的理念世界；唯有超越感官表象，方能触及智慧本源！', // cjk-ok
        voice: 'onyx',
        lane: 0
      },
      {
        speaker: '同行思想家', // cjk-ok
        text: '但我们的双足立于坚实的大地，观察自然万物与人间秩序，同样是通往真理的必经之路！', // cjk-ok
        voice: 'fable',
        lane: 1
      }
    ]
  },
  {
    sceneTitle: '第3幕 · 光影余韵', // cjk-ok
    segments: [
      '镜头移向画卷侧翼与纵深远景，伦勃朗式的柔和侧光勾勒出人物神韵', // cjk-ok
      '衣褶丝绒质感与古典建筑空间交相辉映，尽显西方人文主义精神光辉' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '远景画师', // cjk-ok
        text: '趁着这束穿过拱廊的金色午后阳光，把此刻诸位的雄辩与风采永远留在画布之上吧！', // cjk-ok
        voice: 'echo',
        lane: 0
      },
      {
        speaker: '旁立贵族', // cjk-ok
        text: '如此盛景，纵使历经数百年岁月流转，后世观者亦能听见我们今日的谈笑回响！', // cjk-ok
        voice: 'onyx',
        lane: 1
      }
    ]
  }
]

const DEFAULT_HISTORICAL_COMMENTARY_BY_ACT: Array<{
  sceneTitle: string
  segments: string[]
  dialogues: ActCharacterDialogueLine[]
}> = [
  {
    sceneTitle: '第1幕 · 汴郊柳岸', // cjk-ok
    segments: [
      '画卷右首起笔北宋汴京城郊，张择端以工笔勾勒早春柳岸', // cjk-ok
      '驮队行旅踏着晨雾过桥入城，拉开大宋都城拂晓复苏的序幕' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '赶驴脚夫', // cjk-ok
        text: '得儿——驾！弟兄们加把劲，趁着城门刚开，咱们赶早把这批木炭送到东京城里去！', // cjk-ok
        voice: 'onyx',
        lane: 0
      },
      {
        speaker: '同行旅人', // cjk-ok
        text: '老哥莫急！你看这汴河柳林春风拂面，走这一趟可真是舒坦！', // cjk-ok
        voice: 'echo',
        lane: 1
      }
    ]
  },
  {
    sceneTitle: '第2幕 · 虹桥争渡', // cjk-ok
    segments: [
      '全卷高潮聚焦汴河虹桥，无柱叠梁木拱桥横跨湍急水面', // cjk-ok
      '满载江南钱粮的漕船紧急降桅穿桥，船夫合力撑篙拉纤', // cjk-ok
      '桥上商贩行人凭栏呼应，堪称宋代界画与漕运文明的巅峰' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '船头舵工', // cjk-ok
        text: '快落桅杆！桥洞水急，前头撑篙的弟兄死死顶住水头，千万别撞上虹桥木拱！', // cjk-ok
        voice: 'onyx',
        lane: 0
      },
      {
        speaker: '桥上百姓', // cjk-ok
        text: '船上的伙计当心呐！我们已经把缆绳抛下来了，快接住绳头往岸边拉！', // cjk-ok
        voice: 'fable',
        lane: 1
      }
    ]
  },
  {
    sceneTitle: '第3幕 · 孙羊正店', // cjk-ok
    segments: [
      '北宋彻底打破唐代坊市宵禁，汴京街市与正店酒楼昼夜繁华', // cjk-ok
      '孙羊正店三层彩楼欢门迎风招展，茶坊雅座内文人清谈品茗', // cjk-ok
      '车马商旅穿行青石长街，定格《东京梦华录》里的盛世烟火' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '酒楼小二', // cjk-ok
        text: '客官里面请嘞！刚开坛的孙羊正店上等美酒，二楼雅座正好凭栏赏景！', // cjk-ok
        voice: 'echo',
        lane: 0
      },
      {
        speaker: '雅座文人', // cjk-ok
        text: '掌柜的好酒！来，兄台，咱们满饮此杯，今夜灯火不绝，真乃大宋盛世良宵！', // cjk-ok
        voice: 'onyx',
        lane: 1
      }
    ]
  },
  {
    sceneTitle: '第4幕 · 临水廊亭', // cjk-ok
    segments: [
      '汴河水畔轩窗敞亮，临水廊亭内宾主凭栏小憩', // cjk-ok
      '侍女捧果盘缓步侍立，微风拂过水面带来阵阵茶香' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '端果盘侍女', // cjk-ok
        text: '公子请用茶果，这刚用井水冰镇过的时鲜果子，最是消暑解乏！', // cjk-ok
        voice: 'alloy',
        lane: 0
      },
      {
        speaker: '廊亭公子', // cjk-ok
        text: '有劳了！坐看汴河千帆竞渡、岸上人声鼎沸，确是汴京独一份的闲适！', // cjk-ok
        voice: 'onyx',
        lane: 1
      }
    ]
  },
  {
    sceneTitle: '第5幕 · 瓮城城门', // cjk-ok
    segments: [
      '高耸的瓮城城楼巍然矗立，驼队商旅络绎不绝穿门而过', // cjk-ok
      '守城卒吏查验过所引子，汇聚大宋东西南北的百货商贸' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '西域胡商', // cjk-ok
        text: '官爷请过目，咱们这支驼队满载西域香料与良驹，特地赶来东京城交易！', // cjk-ok
        voice: 'fable',
        lane: 0
      },
      {
        speaker: '城门官吏', // cjk-ok
        text: '引帖核验无误，放行入城！进城后顺着御街直走便是榷货务与正店街市！', // cjk-ok
        voice: 'onyx',
        lane: 1
      }
    ]
  },
  {
    sceneTitle: '第6幕 · 十字街市', // cjk-ok
    segments: [
      '城门内十字长街百肆杂陈，算命卜卦与香饮摊子鳞次栉比', // cjk-ok
      '行人摩肩接踵驻足问询，勾勒出北宋市民生活的鲜活肌理' // cjk-ok
    ],
    dialogues: [
      {
        speaker: '算命先生', // cjk-ok
        text: '这位郎君留步！老夫观你印堂紫气盈门，此番入京赶考必定金榜题名！', // cjk-ok
        voice: 'echo',
        lane: 0
      },
      {
        speaker: '赶考书生', // cjk-ok
        text: '借先生吉言！若真能蟾宫折桂，定来先生摊前奉上厚礼道谢！', // cjk-ok
        voice: 'onyx',
        lane: 1
      }
    ]
  }
]

function extractActDialogueLines(
  rawText: string | undefined,
  actIndex: number,
  fallbackPromptTexts?: Array<string | undefined>,
  culture: 'chinese' | 'western' = 'chinese'
): ActCharacterDialogueLine[] {
  const presetList =
    culture === 'western' ? DEFAULT_WESTERN_COMMENTARY_BY_ACT : DEFAULT_HISTORICAL_COMMENTARY_BY_ACT
  const preset = presetList[actIndex]
  const fallbackDialogues = preset
    ? preset.dialogues.map((d) => ({ ...d }))
    : [
        {
          speaker: '画中人甲', // cjk-ok
          text: '兄台请看，这汴京春色如画，车马盈门，真乃太平盛景！', // cjk-ok
          voice: 'onyx',
          lane: 0
        },
        {
          speaker: '画中人乙', // cjk-ok
          text: '正是！趁着今日天朗气清，咱们且往前面酒肆小酌几杯！', // cjk-ok
          voice: 'echo',
          lane: 1
        }
      ]
  const candidateTexts = [rawText, ...(fallbackPromptTexts ?? [])].filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0
  )
  if (!candidateTexts.length) return fallbackDialogues

  const parsed: ActCharacterDialogueLine[] = []
  const voices = ['onyx', 'echo', 'fable', 'alloy']
  for (const src of candidateTexts) {
    const lines = src
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    for (const line of lines) {
      const m = line.match(
        /^(?:[-*•]?\s*)(?:角色[AB12甲乙]|人物[AB12甲乙]|对白[12]?|台词[12]?|([^：:“"【[\]]{2,8}))\s*[:：]\s*[“"「]?([^”"」\n]{4,80})[”"」]?$/ // cjk-ok
      )
      if (m) {
        const speaker = (m[1] ?? '').trim() || (parsed.length === 0 ? '画中主角色' : '画中次角色') // cjk-ok
        const text = (m[2] ?? '').trim()
        if (
          text &&
          !/^(?:第一行|第二行|第三行|场景名|画面描述|历史解说|严禁|请识别)/.test(speaker) && // cjk-ok
          !/1:1|8K|ARRI|水印/.test(text) // cjk-ok
        ) {
          const lane = parsed.length % 2
          parsed.push({
            speaker,
            text,
            voice: voices[parsed.length % voices.length]!,
            lane
          })
        }
      }
    }
    if (parsed.length >= 2) break

    // 兼容视频生成提示词中的行内人物开口对白（如：茶博士笑着招呼道：“客官里面请……”；行商拱手笑道：“……”）
    const inlineQuoteRegex =
      /([^，。；：—\s“"「【】()\n]{2,14}?)(?:笑着|高声|俯身|拱手|举杯|挥臂|快步|上前|抚须|立于船头)*(?:招呼道|高喊道|应和道|赞叹道|招呼|高喊|应和|笑道|赞叹|说道|喊道|道|说|喊)[:：]?[“"「]([^”"」\n]{4,80})[”"」]/g // cjk-ok
    for (const im of src.matchAll(inlineQuoteRegex)) {
      const rawSpeaker = (im[1] ?? '')
        .replace(/^(?:画面中|镜头中|只见|其中|由)/, '') // cjk-ok
        .trim()
      const text = (im[2] ?? '').trim()
      if (rawSpeaker && text && !parsed.some((p) => p.text === text)) {
        const lane = parsed.length % 2
        parsed.push({
          speaker: rawSpeaker,
          text,
          voice: voices[parsed.length % voices.length]!,
          lane
        })
      }
      if (parsed.length >= 2) break
    }
    if (parsed.length >= 2) break
  }
  return parsed.length >= 1 ? parsed.slice(0, 2) : fallbackDialogues
}

function isHistoricalCommentaryText(text: string | undefined): boolean {
  if (!text?.trim()) return false
  if (/以\s*@?\d|以首帧|唯一构图依据|dolly\s*in|generateFrameMode/i.test(text)) return false // cjk-ok
  const historyRe =
    /画卷|起笔|工笔|界画|张择端|漕运|坊市|宵禁|东京梦华|叠梁|北宋|汴京|汴河|柳岸|虹桥|茶肆|酒旗|长街|绢上|八百年|江南钱粮|传世|朝代|画师|笔墨|文博|历史|油画|壁画|焦点透视|明暗对照|伦勃朗|巴洛克|文艺复兴|印象派|古典主义|卢浮宫|艺术史|画布/ // cjk-ok
  return historyRe.test(text)
}

export function parseActSceneSubtitlePlan(input: {
  actIndex: number
  rawText?: string
  titleCandidates?: Array<string | undefined>
  fallbackPromptTexts?: Array<string | undefined>
  cultureHint?: 'chinese' | 'western'
}): {
  sceneTitle: string
  narrationText: string
  narrationSegments: string[]
  dialogueLines: ActCharacterDialogueLine[]
  culture: 'chinese' | 'western'
} {
  const { actIndex, rawText, titleCandidates = [], fallbackPromptTexts = [], cultureHint } = input
  const allHintText = [rawText, ...titleCandidates, ...fallbackPromptTexts]
    .filter(Boolean)
    .join(' ')
  const culture: 'chinese' | 'western' =
    cultureHint ?? (isWesternMasterpieceHint(allHintText) ? 'western' : 'chinese')

  const bracketMatch = rawText?.match(/【([^】]{2,28})】/)
  let sceneTitle = cleanActSceneTitle(bracketMatch?.[1], actIndex)
  if (!sceneTitle) {
    for (const cand of titleCandidates) {
      const cleaned = cleanActSceneTitle(cand, actIndex)
      if (cleaned) {
        sceneTitle = cleaned
        break
      }
    }
  }
  if (!sceneTitle) {
    for (const fb of fallbackPromptTexts) {
      const m = fb?.match(/【([^】]{2,28})】/)
      const cleaned = cleanActSceneTitle(m?.[1], actIndex)
      if (cleaned) {
        sceneTitle = cleaned
        break
      }
    }
  }

  let narrationSegments = isHistoricalCommentaryText(rawText)
    ? extractActNarrationSegments(rawText)
    : []
  if (!narrationSegments.length) {
    for (const fb of fallbackPromptTexts) {
      if (!isHistoricalCommentaryText(fb)) continue
      const segs = extractActNarrationSegments(fb)
      if (segs.length) {
        narrationSegments = segs
        break
      }
    }
  }

  const combinedHint = [rawText, ...fallbackPromptTexts, ...narrationSegments]
    .filter(Boolean)
    .join(' ')
  if (!sceneTitle) {
    sceneTitle = inferActSceneTitleFromDescription(combinedHint, actIndex, culture)
  }

  if (!narrationSegments.length) {
    const presetList =
      culture === 'western'
        ? DEFAULT_WESTERN_COMMENTARY_BY_ACT
        : DEFAULT_HISTORICAL_COMMENTARY_BY_ACT
    const preset = presetList[actIndex]
    if (preset) {
      narrationSegments = [...preset.segments]
    } else {
      const extracted = extractActNarrationSegments(rawText)
      narrationSegments = extracted.length
        ? extracted
        : culture === 'western'
          ? [
              '传世西洋名画以精妙透视与光影肌理，定格欧洲人文史的辉煌瞬间', // cjk-ok
              '随着镜头推入画布深处，油彩笔触渐次消融，画中人物尽数复苏' // cjk-ok
            ]
          : [
              '传世古画以细腻界画工笔，定格千年前的山水楼阁与市井百态', // cjk-ok
              '随着镜头推入画卷深处，历史长河中的人物与烟火尽数复苏' // cjk-ok
            ]
    }
  }

  const dialogueLines = extractActDialogueLines(rawText, actIndex, fallbackPromptTexts, culture)
  const narrationText = `${narrationSegments.join('，')}。`
  return { sceneTitle, narrationText, narrationSegments, dialogueLines, culture }
}

export function upgradeTemporaryAutoSubtitlesInTimeline(
  clips: ScriptTimelineClip[],
  genParams?: Record<string, unknown> | null
): ScriptTimelineClip[] {
  const hasVoiceActClip = new Set<number>()
  for (const c of clips) {
    if (
      c.track === 'voice' &&
      c.id.startsWith('clip:auto:a:') &&
      !/环境音|sfx/i.test(`${c.title ?? ''} ${c.relativePath ?? ''}`) // cjk-ok
    ) {
      const m = c.id.match(/^clip:auto:a:(\d+)(?:_\d+)?:/)
      if (m) hasVoiceActClip.add(Number(m[1]))
    }
  }
  const extractClipActIdx = (clip: ScriptTimelineClip): number | null => {
    const idMatch = clip.id.match(/^clip:auto:(?:v|a|pre|real|outro|vf):(\d+)(?:_\d+)?:/)
    if (idMatch) return Number(idMatch[1])
    const s = `${clip.title ?? ''} ${clip.nodeTitle ?? ''} ${clip.nodeId ?? ''}`
    const m =
      s.match(/(?:第\s*(\d+)\s*幕|分镜\s*#?(\d+)|act\s*#?(\d+)|shot\s*#?(\d+))/i) ?? // cjk-ok
      s.match(/^#?(\d+)[\s._:\uff1a-]/)
    const numStr = m ? (m[1] ?? m[2] ?? m[3] ?? m[4]) : undefined
    return numStr ? Math.max(0, Number(numStr) - 1) : null
  }

  // 若上游节点重跑后在轨道末尾追加了重复的 clip:auto:v:<ts>:<rand> 或 clip:auto:a:<ts>:<rand>，
  // 将其最新媒体路径原地合并回对应幕的主片段并移除末尾重复片段
  const indexedAutoVideoByAct = new Map<number, ScriptTimelineClip>()
  const indexedAutoVoiceByAct = new Map<number, ScriptTimelineClip>()
  for (const c of clips) {
    const vMatch = c.id.match(/^clip:auto:v:(\d+):/)
    if (vMatch && c.track === 'video') {
      indexedAutoVideoByAct.set(Number(vMatch[1]), c)
    }
    const aMatch = c.id.match(/^clip:auto:a:(\d+)(?:_0)?:/)
    if (aMatch && c.track === 'voice') {
      indexedAutoVoiceByAct.set(Number(aMatch[1]), c)
    }
  }

  const redundantTailClipIds = new Set<string>()
  const clipReplacements = new Map<string, Partial<ScriptTimelineClip>>()
  if (indexedAutoVideoByAct.size > 0 || indexedAutoVoiceByAct.size > 0) {
    for (const c of clips) {
      const isTailAutoVideo = c.track === 'video' && /^clip:auto:v:(?!\d+:)[^:]+:/.test(c.id)
      const isTailAutoVoice =
        c.track === 'voice' && /^clip:auto:a:(?!\d+(?:_\d+)?:)[^:]+:/.test(c.id)
      if (!isTailAutoVideo && !isTailAutoVoice) continue
      const actIdx = extractClipActIdx(c)
      const targetMap = isTailAutoVideo ? indexedAutoVideoByAct : indexedAutoVoiceByAct
      let target = actIdx !== null ? targetMap.get(actIdx) : undefined
      if (!target) {
        for (const candidate of targetMap.values()) {
          if (
            (c.nodeId && candidate.nodeId && c.nodeId === candidate.nodeId) ||
            (c.title && candidate.title && c.title.trim() === candidate.title.trim())
          ) {
            target = candidate
            break
          }
        }
      }
      if (target) {
        clipReplacements.set(target.id, {
          sourceId: c.sourceId || target.sourceId,
          relativePath: c.relativePath || target.relativePath,
          ...(c.assetId ? { assetId: c.assetId } : {}),
          ...(c.nodeId ? { nodeId: c.nodeId } : {}),
          ...(c.nodeTitle ? { nodeTitle: c.nodeTitle } : {})
        })
        redundantTailClipIds.add(c.id)
      }
    }
  }

  const dedupedClips = clips
    .filter((c) => {
      if (redundantTailClipIds.has(c.id)) return false
      const m = c.id.match(/^clip:auto:narr:(\d+):/)
      return m ? !hasVoiceActClip.has(Number(m[1])) : true
    })
    .map((c) => {
      const patch = clipReplacements.get(c.id)
      return patch ? { ...c, ...patch } : c
    })

  const isAncientScrollHybrid = dedupedClips.some((c) => c.id.startsWith('clip:auto:pre:'))
  const autoSubClips = dedupedClips.filter(
    (c) => c.track === 'subtitle' && c.id.startsWith('clip:auto:sub:')
  )
  const tempSubRe =
    /[右中左上前下后]段|古画取景|写实复活|店小二热情迎客|微风吹拂垂柳枝条|蒸笼白气升腾|湍急河水拍打船头/ // cjk-ok
  const hasTempAutoSub = autoSubClips.some((c) =>
    tempSubRe.test(`${c.text ?? ''} ${c.title ?? ''}`)
  )
  const hasOnlyBannerWithoutNarration =
    isAncientScrollHybrid &&
    autoSubClips.length > 0 &&
    !autoSubClips.some((c) => /^clip:auto:sub:\d+_[123]:/.test(c.id))
  const hasTempAutoLabel = dedupedClips.some(
    (c) =>
      (c.id.startsWith('clip:auto:pre:') || c.id.startsWith('clip:auto:vf:')) &&
      (/[右中左上前下后]段|古画取景/.test(`${c.text ?? ''} ${c.title ?? ''}`) || // cjk-ok
        c.stickerId === 'viewfinder-frame' ||
        c.visualEffect === 'strobe-flash')
  )
  if (!hasTempAutoSub && !hasOnlyBannerWithoutNarration && !hasTempAutoLabel) return dedupedClips

  // 从宿主图 graphJson 中提取每幕的识图文本与提示词
  const graphNodes: Array<{
    id?: string
    typeId?: string
    title?: string
    params?: Record<string, unknown>
  }> =
    genParams?.graphJson &&
    typeof genParams.graphJson === 'object' &&
    Array.isArray((genParams.graphJson as { nodes?: unknown[] }).nodes)
      ? ((genParams.graphJson as { nodes: Array<Record<string, unknown>> }).nodes as Array<{
          id?: string
          typeId?: string
          title?: string
          params?: Record<string, unknown>
        }>)
      : []

  const extractNodeActIdx = (title?: string, id?: string): number | null => {
    const s = `${title ?? ''} ${id ?? ''}`
    const m = s.match(/第\s*(\d+)\s*幕/i) ?? s.match(/act\s*(\d+)/i) // cjk-ok
    return m ? Math.max(0, Number(m[1]) - 1) : null
  }

  const getActPlan = (actIndex: number) => {
    const matchingNodes = graphNodes.filter((n) => extractNodeActIdx(n.title, n.id) === actIndex)
    const voiceNode = matchingNodes.find((n) => n.typeId === 'asset.voice')
    const recognizeNode = matchingNodes.find((n) => n.typeId === 'image.toPrompt')
    const cropNode = matchingNodes.find((n) => n.typeId === 'image.process')
    const videoNode = matchingNodes.find((n) => n.typeId === 'asset.video')
    const realNode = matchingNodes.find((n) => n.typeId === 'asset.image')

    const rawText =
      (typeof voiceNode?.params?.generateInstruction === 'string' &&
        voiceNode.params.generateInstruction.trim()) ||
      (typeof recognizeNode?.params?.text === 'string' && recognizeNode.params.text.trim()) ||
      (typeof cropNode?.params?.text === 'string' && cropNode.params.text.trim()) ||
      undefined
    const fallbackPromptTexts = [
      typeof videoNode?.params?.generateInstruction === 'string'
        ? videoNode.params.generateInstruction
        : undefined,
      typeof realNode?.params?.generateInstruction === 'string'
        ? realNode.params.generateInstruction
        : undefined
    ]
    const cultureHint =
      cropNode?.params?.paintingCulture === 'western'
        ? ('western' as const)
        : cropNode?.params?.paintingCulture === 'chinese'
          ? ('chinese' as const)
          : undefined
    return parseActSceneSubtitlePlan({
      actIndex,
      rawText,
      titleCandidates: [cropNode?.title, videoNode?.title, realNode?.title],
      fallbackPromptTexts,
      cultureHint
    })
  }

  const rebuiltActs = new Set<number>()
  const nextClips: ScriptTimelineClip[] = []
  for (const clip of dedupedClips) {
    const vfMatch = clip.id.match(/^clip:auto:(?:pre|vf):(\d+):/)
    if (vfMatch) {
      const actIdx = Number(vfMatch[1])
      const plan = getActPlan(actIdx)
      const isWestern = plan.culture === 'western'
      const isPreVideo = clip.id.startsWith('clip:auto:pre:')
      nextClips.push({
        ...clip,
        title: plan.sceneTitle,
        ...(isPreVideo
          ? {
              cameraMotion: 'scrollPanZoomIn' as const,
              filterPreset:
                clip.filterPreset ??
                (isWestern ? ('kodak-portra' as const) : ('golden-autumn' as const)),
              visualEffect:
                clip.visualEffect === 'strobe-flash'
                  ? ('gold-sparkle' as const)
                  : (clip.visualEffect ?? ('gold-sparkle' as const)),
              effectIntensity: clip.effectIntensity ?? 0.45,
              ...(actIdx > 0
                ? {
                    transitionType:
                      clip.transitionType ??
                      (isWestern ? ('smoothright' as const) : ('smoothleft' as const)),
                    transitionInSec: Math.max(0.85, clip.transitionInSec ?? 0)
                  }
                : {})
            }
          : {
              sourceId: `sticker:${isWestern ? 'museum-gilded-frame' : 'scroll-seal-frame'}:${actIdx}`,
              stickerId: isWestern
                ? ('museum-gilded-frame' as const)
                : ('scroll-seal-frame' as const),
              stickerColor: isWestern ? '#EAB308' : '#D97706'
            }),
        ...(clip.text !== undefined ? { text: plan.sceneTitle } : {})
      })
      continue
    }

    const subAnyMatch = clip.id.match(/^clip:auto:sub:(\d+)_(\d+):(.+)$/)
    if (
      subAnyMatch &&
      clip.track === 'subtitle' &&
      (hasTempAutoSub || hasOnlyBannerWithoutNarration)
    ) {
      const actIdx = Number(subAnyMatch[1])
      if (rebuiltActs.has(actIdx)) {
        continue
      }
      rebuiltActs.add(actIdx)
      const stamp = subAnyMatch[3]!
      const plan = getActPlan(actIdx)
      const preClip = clips.find((c) => c.id.startsWith(`clip:auto:pre:${actIdx}:`))
      const realClip = clips.find((c) => c.id.startsWith(`clip:auto:real:${actIdx}:`))
      const mainVidClip = clips.find((c) => c.id.startsWith(`clip:auto:v:${actIdx}:`))
      const actStartSec = preClip ? preClip.startSec : Math.max(0, clip.startSec - 0.2)
      const actEndSec = mainVidClip
        ? mainVidClip.startSec + mainVidClip.durationSec
        : actStartSec + 10

      const bannerText = `【 ${plan.sceneTitle} 】` // cjk-ok
      nextClips.push({
        ...clip,
        id: `clip:auto:sub:${actIdx}_0:${stamp}`,
        lane: 0,
        title: bannerText,
        text: bannerText,
        textColor: clip.textColor || '#FEF08A',
        fontSize: clip.fontSize || 40,
        startSec: Math.round((actStartSec + 0.15) * 100) / 100,
        durationSec: 1.9
      })

      const bodyStart = realClip
        ? Math.round((realClip.startSec + 0.05) * 100) / 100
        : Math.round((actStartSec + 2.1) * 100) / 100
      const totalAvailDur = Math.max(2.6, actEndSec - bodyStart - 0.15)
      const hasDialogues = plan.dialogueLines.length > 0
      const narrTotalDur = hasDialogues ? Math.max(1.8, totalAvailDur * 0.44) : totalAvailDur
      const totalChars = Math.max(
        1,
        plan.narrationSegments.reduce((acc, s) => acc + s.length, 0)
      )
      let subCursor = bodyStart
      plan.narrationSegments.forEach((segText, segIdx) => {
        const isLast = segIdx === plan.narrationSegments.length - 1
        const rawDur = isLast
          ? bodyStart + narrTotalDur - subCursor
          : (narrTotalDur * segText.length) / totalChars
        const segDur = Math.max(0.75, Math.round(rawDur * 100) / 100)
        nextClips.push({
          id: `clip:auto:sub:${actIdx}_${segIdx + 1}:${stamp}`,
          track: 'subtitle',
          lane: 0,
          sourceId: `sub:act:${actIdx}:${segIdx + 1}`,
          title: segText,
          text: segText,
          startSec: Math.round(subCursor * 100) / 100,
          durationSec: segDur
        })
        subCursor += segDur
      })

      if (hasDialogues) {
        let dlgCursor = Math.round((subCursor + 0.1) * 100) / 100
        const dlgTotalDur = Math.max(1.4, actEndSec - 0.15 - dlgCursor)
        const dlgStep = dlgTotalDur / plan.dialogueLines.length
        plan.dialogueLines.forEach((dlg, dlgIdx) => {
          const isLastDlg = dlgIdx === plan.dialogueLines.length - 1
          const rawDlgDur = isLastDlg ? actEndSec - 0.15 - dlgCursor : dlgStep - 0.06
          const dlgDur = Math.max(0.75, Math.round(rawDlgDur * 100) / 100)
          const dlgLineText = `${dlg.speaker}：「${dlg.text}」`
          nextClips.push({
            id: `clip:auto:sub:${actIdx}_dlg_${dlgIdx}:${stamp}`,
            track: 'subtitle',
            lane: 0,
            sourceId: `sub:act:${actIdx}:dlg:${dlgIdx}`,
            title: dlgLineText,
            text: dlgLineText,
            textColor: '#FDE68A',
            startSec: Math.round(dlgCursor * 100) / 100,
            durationSec: dlgDur
          })
          dlgCursor += dlgDur + 0.06
        })
      }
      continue
    }

    nextClips.push(clip)
  }

  return nextClips
}

export function readScriptTimelineFromGenParams(
  genParams?: Record<string, unknown> | null,
  nodeId?: string
): ScriptTimelineDocument {
  const raw = genParams?.[timelineParamKeyForNode(nodeId)]
  if (!raw || typeof raw !== 'object') return { clips: [] }
  const doc = raw as ScriptTimelineDocument
  const rawClips = Array.isArray(doc.clips) ? doc.clips.filter(isClip) : []
  return {
    clips: upgradeTemporaryAutoSubtitlesInTimeline(rawClips, genParams),
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
  if (row.trackLaneCounts && typeof row.trackLaneCounts === 'object') {
    const laneCounts: Partial<Record<ScriptTimelineTrackKind, number>> = {}
    for (const key of Object.keys(row.trackLaneCounts) as ScriptTimelineTrackKind[]) {
      if (!isTrackKind(key)) continue
      const v = (row.trackLaneCounts as Record<string, unknown>)[key]
      if (typeof v === 'number' && Number.isFinite(v)) {
        laneCounts[key] = Math.min(TRACK_LANE_MAX, Math.max(1, Math.round(v)))
      }
    }
    if (Object.keys(laneCounts).length) next.trackLaneCounts = laneCounts
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
  delete first.tweenOut

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
  delete second.tweenIn
  if (Array.isArray(clip.keyframes) && clip.keyframes.length > 0) {
    first.keyframes = normalizeTimelineKeyframes(
      clip.keyframes.filter((k) => k.offsetSec <= delta + 0.01),
      delta
    )
    second.keyframes = normalizeTimelineKeyframes(
      clip.keyframes
        .filter((k) => k.offsetSec >= delta - 0.01)
        .map((k) => ({ ...k, offsetSec: Math.max(0, k.offsetSec - delta) })),
      remain
    )
  }

  return [first, second]
}

/**
 * 磁性消除指定轨道（缺省为 `video` 主视频轨）上的空白间隙：
 * - 正向间隙（`clip.startSec > prevEnd`）全部收拢；
 * - 负向重叠（相邻视频片段用于 xfade 的交叉转场重叠）原样保留。
 */
export function closeTimelineTrackGaps(
  clips: ScriptTimelineClip[],
  track: ScriptTimelineTrackKind = 'video',
  lane?: number
): { clips: ScriptTimelineClip[]; closedCount: number; savedSec: number } {
  const targetClips = clips
    .filter(
      (c) =>
        c.track === track &&
        (lane === undefined || normalizeClipLane(c.lane) === normalizeClipLane(lane))
    )
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

/**
 * 归一化画面裁剪框（0~1），并判断是否启用了有效裁剪。
 */
export function normalizeClipCropRect(
  clip?: {
    cropX?: number
    cropY?: number
    cropWidth?: number
    cropHeight?: number
  } | null
): {
  x: number
  y: number
  width: number
  height: number
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  isCropped: boolean
} {
  const rawW = Number.isFinite(clip?.cropWidth) ? Number(clip?.cropWidth) : 1
  const rawH = Number.isFinite(clip?.cropHeight) ? Number(clip?.cropHeight) : 1
  const width = Math.min(1, Math.max(0.05, Math.round(rawW * 10000) / 10000))
  const height = Math.min(1, Math.max(0.05, Math.round(rawH * 10000) / 10000))
  const rawX = Number.isFinite(clip?.cropX) ? Number(clip?.cropX) : 0
  const rawY = Number.isFinite(clip?.cropY) ? Number(clip?.cropY) : 0
  const x = Math.min(1 - width, Math.max(0, Math.round(rawX * 10000) / 10000))
  const y = Math.min(1 - height, Math.max(0, Math.round(rawY * 10000) / 10000))
  const isCropped = x > 0.001 || y > 0.001 || width < 0.999 || height < 0.999
  return {
    x,
    y,
    width,
    height,
    cropX: x,
    cropY: y,
    cropWidth: width,
    cropHeight: height,
    isCropped
  }
}

/**
 * 将片段入点（`in`）或出点（`out`）快速裁剪到时间点 `atSec`：
 * - `side === 'in'`：起点移到 `atSec`，时长缩短，非字幕片段同步推进 `sourceOffsetSec += delta * speed`；
 * - `side === 'out'`：终点收拢到 `atSec`，时长缩短为 `atSec - startSec`。
 */
export function trimTimelineClipToTime(
  clip: ScriptTimelineClip,
  atSec: number,
  side: 'in' | 'out',
  minDurationSec = 0.2
): ScriptTimelineClip | null {
  if (!Number.isFinite(atSec)) return null
  const clipEnd = clip.startSec + clip.durationSec
  if (side === 'in') {
    const delta = atSec - clip.startSec
    const nextDuration = clipEnd - atSec
    if (delta <= 0.005 || nextDuration < minDurationSec) return null
    const speed = clampClipSpeed(clip.speed)
    const srcOff = Math.max(
      0,
      Number.isFinite(clip.sourceOffsetSec) ? Number(clip.sourceOffsetSec) : 0
    )
    const next: ScriptTimelineClip = {
      ...clip,
      startSec: Number(atSec.toFixed(3)),
      durationSec: Number(nextDuration.toFixed(3))
    }
    if (clip.track !== 'subtitle') {
      next.sourceOffsetSec = Number((srcOff + delta * speed).toFixed(3))
    }
    return next
  }
  const nextDuration = atSec - clip.startSec
  const trimmedTail = clipEnd - atSec
  if (trimmedTail <= 0.005 || nextDuration < minDurationSec) return null
  return {
    ...clip,
    durationSec: Number(nextDuration.toFixed(3))
  }
}

/**
 * 在视频轨相邻片段 `left` 与 `right` 之间设置或移除转场，并自动涟漪平移 `right` 及其后续视频轨片段：
 * - 当启用非 `none` 转场且 `durationSec > 0` 时，自动令 `right.startSec = leftEnd - durationSec`，
 *   并将 `shiftDelta` 同步作用到 `right` 之后的所有主视频轨片段，保证切点重叠且不产生尾部断层；
 * - 当移除转场（`transitionType === 'none'` 或 `durationSec <= 0`）时，若 `right` 与 `left` 重叠则还原为紧贴切点。
 */
export function applyVideoTransitionBetweenClips(
  clips: ScriptTimelineClip[],
  leftId: string,
  rightId: string,
  options: {
    transitionType?: ScriptTimelineTransitionType
    durationSec?: number
  }
): ScriptTimelineClip[] {
  const vClips = clips
    .filter((c) => c.track === 'video')
    .slice()
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
  const rightIdx = vClips.findIndex((c) => c.id === rightId)
  const leftIdx = vClips.findIndex((c) => c.id === leftId)
  if (leftIdx < 0 || rightIdx < 0 || rightIdx <= leftIdx) {
    return clips.map((c) => ({ ...c }))
  }
  const left = vClips[leftIdx]
  const right = vClips[rightIdx]
  const leftEnd = left.startSec + left.durationSec
  const currentOverlap = Math.max(0, leftEnd - right.startSec)
  const currentDur = Math.max(
    currentOverlap,
    left.transitionOutSec ?? 0,
    right.transitionInSec ?? 0
  )
  let nextType: ScriptTimelineTransitionType =
    options.transitionType ??
    (right.transitionType && right.transitionType !== 'none' ? right.transitionType : 'dissolve')
  const maxDur = Math.max(0, Math.min(3, Math.min(left.durationSec, right.durationSec) - 0.15))
  let nextDur = 0
  if (nextType === 'none' || (options.durationSec !== undefined && options.durationSec <= 0.02)) {
    nextType = 'none'
    nextDur = 0
  } else if (maxDur >= 0.1) {
    const rawDur =
      options.durationSec !== undefined
        ? options.durationSec
        : currentDur > 0.04
          ? currentDur
          : Math.min(0.6, Math.min(left.durationSec, right.durationSec) * 0.35)
    nextDur = Number(Math.min(maxDur, Math.max(0.1, rawDur)).toFixed(2))
  } else {
    nextType = 'none'
    nextDur = 0
  }

  const targetRightStart =
    nextDur > 0
      ? Math.max(left.startSec + 0.1, Number((leftEnd - nextDur).toFixed(3)))
      : right.startSec < leftEnd
        ? Number(leftEnd.toFixed(3))
        : right.startSec
  const shiftDelta = Number((targetRightStart - right.startSec).toFixed(3))
  const shiftedIds = new Set<string>()
  for (let i = rightIdx; i < vClips.length; i += 1) {
    shiftedIds.add(vClips[i].id)
  }

  return clips.map((clip) => {
    if (clip.id === left.id) {
      const nextLeft: ScriptTimelineClip = { ...clip }
      if (nextDur > 0) {
        nextLeft.transitionOutSec = nextDur
      } else {
        delete nextLeft.transitionOutSec
      }
      return nextLeft
    }
    if (clip.id === right.id) {
      const nextRight: ScriptTimelineClip = {
        ...clip,
        startSec: Math.max(0, Number((clip.startSec + shiftDelta).toFixed(3))),
        transitionType: nextDur > 0 ? nextType : 'none'
      }
      if (nextDur > 0) {
        nextRight.transitionInSec = nextDur
      } else {
        delete nextRight.transitionInSec
      }
      return nextRight
    }
    if (shiftedIds.has(clip.id)) {
      return {
        ...clip,
        startSec: Math.max(0, Number((clip.startSec + shiftDelta).toFixed(3)))
      }
    }
    return { ...clip }
  })
}

/**
 * 将指定转场效果与时长批量应用到视频轨所有相邻切点。
 */
export function applyVideoTransitionToAllCuts(
  clips: ScriptTimelineClip[],
  transitionType: ScriptTimelineTransitionType,
  durationSec: number
): ScriptTimelineClip[] {
  const vClips = clips
    .filter((c) => c.track === 'video')
    .slice()
    .sort((a, b) => a.startSec - b.startSec || a.id.localeCompare(b.id))
  if (vClips.length < 2) return clips.map((c) => ({ ...c }))
  let current = clips.map((c) => ({ ...c }))
  for (let i = 1; i < vClips.length; i += 1) {
    current = applyVideoTransitionBetweenClips(current, vClips[i - 1].id, vClips[i].id, {
      transitionType,
      durationSec
    })
  }
  return current
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

export interface VoiceDuckingEnvelopePoint {
  timeSec: number
  gain: number
}

export interface VoiceDuckingOptions {
  /** 闪避压低后的 BGM 增益比例（默认 0.25，约 -12dB） */
  duckGain?: number
  /** 对白入场前的渐降提前量（秒，默认 0.18s） */
  attackSec?: number
  /** 对白结束后的渐升恢复时长（秒，默认 0.35s） */
  releaseSec?: number
  /** 相邻对白间隔小于该阈值时合并闪避区间，避免音量忽高忽低（秒，默认 0.55s） */
  mergeGapSec?: number
}

/**
 * 根据时间线上的 `voice` 人声片段自动计算 BGM 音轨的平滑闪避增益包络（Auto-Ducking Envelope）。
 */
export function computeVoiceDuckingEnvelope(
  clips: readonly ScriptTimelineClip[],
  options?: VoiceDuckingOptions
): VoiceDuckingEnvelopePoint[] {
  const duckGain = Math.min(0.9, Math.max(0.05, options?.duckGain ?? 0.25))
  const attackSec = Math.min(1.5, Math.max(0.04, options?.attackSec ?? 0.18))
  const releaseSec = Math.min(2.0, Math.max(0.06, options?.releaseSec ?? 0.35))
  const mergeGapSec = Math.max(attackSec + releaseSec, options?.mergeGapSec ?? 0.55)

  const voiceIntervals = clips
    .filter((c) => c.track === 'voice' && (c.volume ?? 1) > 0.01 && c.durationSec > 0.05)
    .map((c) => ({
      start: Math.max(0, c.startSec),
      end: Math.max(0, c.startSec + c.durationSec)
    }))
    .sort((a, b) => a.start - b.start)

  if (voiceIntervals.length === 0) {
    return [{ timeSec: 0, gain: 1 }]
  }

  const merged: Array<{ start: number; end: number }> = []
  for (const seg of voiceIntervals) {
    const last = merged[merged.length - 1]
    if (last && seg.start - last.end <= mergeGapSec) {
      last.end = Math.max(last.end, seg.end)
    } else {
      merged.push({ ...seg })
    }
  }

  const points: VoiceDuckingEnvelopePoint[] = []
  if (merged[0].start > attackSec) {
    points.push({ timeSec: 0, gain: 1 })
  }
  for (const seg of merged) {
    const rampDownStart = Math.max(0, Number((seg.start - attackSec).toFixed(3)))
    const duckStart = Number(seg.start.toFixed(3))
    const duckEnd = Number(seg.end.toFixed(3))
    const rampUpEnd = Number((seg.end + releaseSec).toFixed(3))
    if (points.length === 0 || rampDownStart > points[points.length - 1].timeSec) {
      points.push({ timeSec: rampDownStart, gain: 1 })
    }
    points.push({ timeSec: duckStart, gain: duckGain })
    points.push({ timeSec: duckEnd, gain: duckGain })
    points.push({ timeSec: rampUpEnd, gain: 1 })
  }
  return points
}

export type SubtitleStylePresetId =
  'cinemaGold' | 'shortDramaPop' | 'minimalWhite' | 'neonCyber' | 'docBox'

export interface SubtitleStylePresetDef {
  id: SubtitleStylePresetId
  labelKey: string
  settings: Pick<
    ScriptTimelineSettings,
    | 'subtitleFontSize'
    | 'subtitleYOffset'
    | 'subtitleColor'
    | 'subtitleBorderColor'
    | 'subtitleBorderWidth'
    | 'subtitleBoxEnabled'
    | 'subtitleBoxColor'
    | 'subtitleBoxOpacity'
    | 'subtitleMotion'
  >
}

export const SUBTITLE_STYLE_PRESETS: readonly SubtitleStylePresetDef[] = [
  {
    id: 'cinemaGold',
    labelKey: 'timeline.subtitlePreset.cinemaGold',
    settings: {
      subtitleFontSize: 40,
      subtitleYOffset: 68,
      subtitleColor: '#f6d365',
      subtitleBorderColor: '#141414',
      subtitleBorderWidth: 3,
      subtitleBoxEnabled: false,
      subtitleBoxColor: '#000000',
      subtitleBoxOpacity: 0.45,
      subtitleMotion: 'fade'
    }
  },
  {
    id: 'shortDramaPop',
    labelKey: 'timeline.subtitlePreset.shortDramaPop',
    settings: {
      subtitleFontSize: 52,
      subtitleYOffset: 140,
      subtitleColor: '#ffffff',
      subtitleBorderColor: '#ff3b30',
      subtitleBorderWidth: 5,
      subtitleBoxEnabled: false,
      subtitleBoxColor: '#000000',
      subtitleBoxOpacity: 0.5,
      subtitleMotion: 'fade'
    }
  },
  {
    id: 'minimalWhite',
    labelKey: 'timeline.subtitlePreset.minimalWhite',
    settings: {
      subtitleFontSize: 36,
      subtitleYOffset: 60,
      subtitleColor: '#ffffff',
      subtitleBorderColor: '#000000',
      subtitleBorderWidth: 2,
      subtitleBoxEnabled: false,
      subtitleBoxColor: '#000000',
      subtitleBoxOpacity: 0.4,
      subtitleMotion: 'none'
    }
  },
  {
    id: 'neonCyber',
    labelKey: 'timeline.subtitlePreset.neonCyber',
    settings: {
      subtitleFontSize: 44,
      subtitleYOffset: 84,
      subtitleColor: '#00f5d4',
      subtitleBorderColor: '#3a0ca3',
      subtitleBorderWidth: 4,
      subtitleBoxEnabled: false,
      subtitleBoxColor: '#090a10',
      subtitleBoxOpacity: 0.6,
      subtitleMotion: 'fade'
    }
  },
  {
    id: 'docBox',
    labelKey: 'timeline.subtitlePreset.docBox',
    settings: {
      subtitleFontSize: 38,
      subtitleYOffset: 64,
      subtitleColor: '#f8f9fa',
      subtitleBorderColor: '#000000',
      subtitleBorderWidth: 0,
      subtitleBoxEnabled: true,
      subtitleBoxColor: '#101418',
      subtitleBoxOpacity: 0.72,
      subtitleMotion: 'fade'
    }
  }
]

/**
 * 一键套用广播级/短剧级字幕排版预设到时间线设置。
 */
export function applySubtitleStylePreset(
  current: ScriptTimelineSettings | undefined,
  presetId: SubtitleStylePresetId
): ScriptTimelineSettings {
  const preset =
    SUBTITLE_STYLE_PRESETS.find((item) => item.id === presetId) ?? SUBTITLE_STYLE_PRESETS[0]
  return {
    ...(current ?? {}),
    ...preset.settings
  }
}
