/**
 * 成片时间线 DOTween 风格补间动画、多关键帧序列（Sequence）、内置参数化贴纸与 FFmpeg 动态表达式编译器。
 *
 * 设计目标：
 * 1. 前后端 100% 数学同源：Vue 60fps 实时预览（CSS Transform）与主进程 FFmpeg 成片导出共用同一套缓动与关键帧模型；
 * 2. 双层正交叠加架构：
 *    - 第一层（零门槛一键预设）：入场动画 `tweenIn` + 循环待机动画 `tweenLoop` + 出场动画 `tweenOut`；
 *    - 第二层（DOTween Sequence 多关键帧序列）：`keyframes[]` 支持任意时间点记录 `{ x, y, width, height, rotation, opacity, ease }`；
 *    - 最终变换：$\text{FinalTransform}(t) = \text{KeyframeSequence}(t) \oplus \text{TweenIn}(t) \oplus \text{TweenLoop}(t) \oplus \text{TweenOut}(t)$；
 * 3. 主视频轨（`video`）同步支持一键 Ken Burns 推拉摇移运镜（`cameraMotion`）；
 * 4. 内置零外部文件依赖的参数化高清透明矢量贴纸库（`TIMELINE_BUILTIN_STICKERS`）。
 */

export type TimelineEaseType =
  | 'linear'
  | 'inQuad'
  | 'outQuad'
  | 'inOutQuad'
  | 'inCubic'
  | 'outCubic'
  | 'inOutCubic'
  | 'inOutSine'
  | 'outBack'
  | 'inBack'
  | 'outBounce'
  | 'outElastic'

export const TIMELINE_EASE_TYPES: readonly TimelineEaseType[] = [
  'linear',
  'outQuad',
  'inQuad',
  'inOutQuad',
  'outCubic',
  'inCubic',
  'inOutCubic',
  'inOutSine',
  'outBack',
  'inBack',
  'outBounce',
  'outElastic'
] as const

export type TimelineTweenInPreset =
  | 'none'
  | 'fadeIn'
  | 'popIn'
  | 'elasticIn'
  | 'bounceIn'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'spinIn'
  | 'zoomIn'

export const TIMELINE_TWEEN_IN_PRESETS: readonly TimelineTweenInPreset[] = [
  'none',
  'popIn',
  'elasticIn',
  'bounceIn',
  'fadeIn',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'spinIn',
  'zoomIn'
] as const

export type TimelineTweenOutPreset =
  'none' | 'fadeOut' | 'popOut' | 'slideLeft' | 'slideRight' | 'slideUp' | 'slideDown' | 'zoomOut'

export const TIMELINE_TWEEN_OUT_PRESETS: readonly TimelineTweenOutPreset[] = [
  'none',
  'popOut',
  'fadeOut',
  'slideLeft',
  'slideRight',
  'slideUp',
  'slideDown',
  'zoomOut'
] as const

export type TimelineTweenLoopPreset =
  'none' | 'floatY' | 'pulse' | 'heartbeat' | 'wiggle' | 'bounce' | 'spin' | 'shake'

export const TIMELINE_TWEEN_LOOP_PRESETS: readonly TimelineTweenLoopPreset[] = [
  'none',
  'floatY',
  'pulse',
  'heartbeat',
  'wiggle',
  'bounce',
  'spin',
  'shake'
] as const

export type TimelineMainCameraPreset =
  | 'none'
  | 'kenBurnsIn'
  | 'kenBurnsOut'
  | 'panLeft'
  | 'panRight'
  | 'panUp'
  | 'panDown'
  | 'scrollPanZoomIn'

export type TimelineCameraMotionPreset = TimelineMainCameraPreset

export const TIMELINE_MAIN_CAMERA_PRESETS: readonly TimelineMainCameraPreset[] = [
  'none',
  'kenBurnsIn',
  'kenBurnsOut',
  'panLeft',
  'panRight',
  'panUp',
  'panDown',
  'scrollPanZoomIn'
] as const

export const TIMELINE_CAMERA_MOTION_PRESETS = TIMELINE_MAIN_CAMERA_PRESETS

/** DOTween Sequence 关键帧节点（局部时间 offsetSec 相对于片段起点 startSec） */
export interface TimelineClipKeyframe {
  /** 距离片段起点的秒数（0 <= offsetSec <= durationSec） */
  offsetSec: number
  /** 画中画/贴纸左边界（0..1，相对画布宽） */
  x: number
  /** 画中画/贴纸上边界（0..1，相对画布高） */
  y: number
  /** 画中画/贴纸宽度（0.02..1，相对画布宽） */
  width: number
  /** 画中画/贴纸高度（0.02..1，相对画布高） */
  height: number
  /** 旋转角度（度，-360..360，缺省 0） */
  rotation?: number
  /** 不透明度（0..1，缺省 1） */
  opacity?: number
  /** 从当前关键帧过渡到下一关键帧的 DOTween 缓动函数（缺省 'inOutCubic'） */
  ease?: TimelineEaseType
}

/** 参与补间求值的片段最小契约 */
export interface TimelineTweenableClip {
  startSec: number
  durationSec: number
  overlayX?: number
  overlayY?: number
  overlayWidth?: number
  overlayHeight?: number
  overlayRotation?: number
  opacity?: number
  fadeInSec?: number
  fadeOutSec?: number
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
  stickerId?: string
}

export interface OverlayEvaluatedTransform {
  /** 归一化左上角 X（未含中心缩放偏移） */
  x: number
  /** 归一化左上角 Y（未含中心缩放偏移） */
  y: number
  /** 归一化左上角 left（已含中心缩放偏移，可直接用于 CSS left） */
  left: number
  /** 归一化左上角 top（已含中心缩放偏移，可直接用于 CSS top） */
  top: number
  /** 归一化渲染宽度（已乘 scaleX） */
  width: number
  /** 归一化渲染高度（已乘 scaleY） */
  height: number
  /** 围绕中心点的附加缩放倍率 X（1 = 原始大小） */
  scaleX: number
  /** 围绕中心点的附加缩放倍率 Y（1 = 原始大小） */
  scaleY: number
  /** 围绕中心点的旋转角度（度） */
  rotation: number
  /** 围绕中心点的旋转角度（度，同 rotation） */
  rotationDeg: number
  /** 最终不透明度（0..1） */
  opacity: number
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000
}

export function isTimelineEaseType(v: unknown): v is TimelineEaseType {
  return typeof v === 'string' && (TIMELINE_EASE_TYPES as readonly string[]).includes(v)
}

export function isTimelineTweenInPreset(v: unknown): v is TimelineTweenInPreset {
  return typeof v === 'string' && (TIMELINE_TWEEN_IN_PRESETS as readonly string[]).includes(v)
}

export function isTimelineTweenOutPreset(v: unknown): v is TimelineTweenOutPreset {
  return typeof v === 'string' && (TIMELINE_TWEEN_OUT_PRESETS as readonly string[]).includes(v)
}

export function isTimelineTweenLoopPreset(v: unknown): v is TimelineTweenLoopPreset {
  return typeof v === 'string' && (TIMELINE_TWEEN_LOOP_PRESETS as readonly string[]).includes(v)
}

export function isTimelineMainCameraPreset(v: unknown): v is TimelineMainCameraPreset {
  return typeof v === 'string' && (TIMELINE_MAIN_CAMERA_PRESETS as readonly string[]).includes(v)
}

/**
 * 标准 DOTween 缓动函数求值器：输入归一化进度 $t \in [0, 1]$，返回缓动进度（`outBack` / `outElastic` 可短暂超出 $[0, 1]$ 产生回弹）。
 */
export function evaluateTimelineEase(ease: TimelineEaseType | undefined, rawT: number): number {
  const t = clamp(Number.isFinite(rawT) ? rawT : 0, 0, 1)
  if (t <= 0) return 0
  if (t >= 1) return 1

  switch (ease ?? 'outCubic') {
    case 'linear':
      return t
    case 'inQuad':
      return t * t
    case 'outQuad':
      return 1 - (1 - t) * (1 - t)
    case 'inOutQuad':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    case 'inCubic':
      return t * t * t
    case 'outCubic': {
      const u = 1 - t
      return 1 - u * u * u
    }
    case 'inOutCubic':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    case 'inOutSine':
      return -(Math.cos(Math.PI * t) - 1) / 2
    case 'outBack': {
      const c1 = 1.70158
      const c3 = c1 + 1
      const u = t - 1
      return 1 + c3 * u * u * u + c1 * u * u
    }
    case 'inBack': {
      const c1 = 1.70158
      const c3 = c1 + 1
      return c3 * t * t * t - c1 * t * t
    }
    case 'outBounce': {
      const n1 = 7.5625
      const d1 = 2.75
      if (t < 1 / d1) {
        return n1 * t * t
      } else if (t < 2 / d1) {
        const u = t - 1.5 / d1
        return n1 * u * u + 0.75
      } else if (t < 2.5 / d1) {
        const u = t - 2.25 / d1
        return n1 * u * u + 0.9375
      } else {
        const u = t - 2.625 / d1
        return n1 * u * u + 0.984375
      }
    }
    case 'outElastic': {
      const c4 = (2 * Math.PI) / 3
      return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
    }
    default:
      return t
  }
}

/** 每个入场预设的默认推荐 DOTween 缓动函数 */
export function defaultEaseForTweenIn(preset: TimelineTweenInPreset | undefined): TimelineEaseType {
  switch (preset) {
    case 'popIn':
      return 'outBack'
    case 'elasticIn':
      return 'outElastic'
    case 'bounceIn':
      return 'outBounce'
    case 'fadeIn':
      return 'inOutSine'
    case 'spinIn':
    case 'zoomIn':
      return 'outBack'
    case 'slideLeft':
    case 'slideRight':
    case 'slideUp':
    case 'slideDown':
    default:
      return 'outCubic'
  }
}

/** 每个出场预设的默认推荐 DOTween 缓动函数 */
export function defaultEaseForTweenOut(
  preset: TimelineTweenOutPreset | undefined
): TimelineEaseType {
  switch (preset) {
    case 'popOut':
    case 'zoomOut':
      return 'inBack'
    case 'fadeOut':
      return 'inOutSine'
    case 'slideLeft':
    case 'slideRight':
    case 'slideUp':
    case 'slideDown':
    default:
      return 'inCubic'
  }
}

/** 清洗并按时间排序关键帧数组 */
export function normalizeTimelineKeyframes(
  raw: unknown,
  maxDurationSec = 3600
): TimelineClipKeyframe[] {
  if (!Array.isArray(raw)) return []
  const maxDur = Math.max(0.05, Number.isFinite(maxDurationSec) ? maxDurationSec : 3600)
  const parsed: TimelineClipKeyframe[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<TimelineClipKeyframe>
    const offsetSec = Number(row.offsetSec)
    const x = Number(row.x)
    const y = Number(row.y)
    const width = Number(row.width)
    const height = Number(row.height)
    if (![offsetSec, x, y, width, height].every(Number.isFinite)) continue
    const kf: TimelineClipKeyframe = {
      offsetSec: round4(clamp(offsetSec, 0, maxDur)),
      x: round4(clamp(x, -1, 2)),
      y: round4(clamp(y, -1, 2)),
      width: round4(clamp(width, 0.02, 2)),
      height: round4(clamp(height, 0.02, 2))
    }
    if (Number.isFinite(Number(row.rotation))) {
      kf.rotation = round4(clamp(Number(row.rotation), -720, 720))
    }
    if (Number.isFinite(Number(row.opacity))) {
      kf.opacity = round4(clamp(Number(row.opacity), 0, 1))
    }
    if (isTimelineEaseType(row.ease)) {
      kf.ease = row.ease
    }
    parsed.push(kf)
  }
  parsed.sort((a, b) => a.offsetSec - b.offsetSec)
  // 合并同一时间点（< 0.02s）的重复关键帧，后者覆盖前者
  const deduped: TimelineClipKeyframe[] = []
  for (const kf of parsed) {
    const last = deduped[deduped.length - 1]
    if (last && Math.abs(kf.offsetSec - last.offsetSec) < 0.02) {
      deduped[deduped.length - 1] = kf
    } else {
      deduped.push(kf)
    }
  }
  return deduped
}

/**
 * 在指定局部时间 `offsetSec` 插入或更新一个关键帧（支持传入 clip 对象或已有 keyframes 数组）。
 */
export function upsertTimelineClipKeyframe(
  clipOrExisting: TimelineTweenableClip | readonly TimelineClipKeyframe[] | undefined,
  offsetOrDurationSec: number,
  keyframePatch: Partial<TimelineClipKeyframe>,
  snapToleranceSec = 0.04
): TimelineClipKeyframe[] {
  const isClipObj =
    clipOrExisting !== null && typeof clipOrExisting === 'object' && !Array.isArray(clipOrExisting)
  const clipObj = isClipObj ? (clipOrExisting as TimelineTweenableClip) : undefined
  const existing = isClipObj
    ? clipObj?.keyframes
    : (clipOrExisting as readonly TimelineClipKeyframe[] | undefined)
  const clipDurationSec = isClipObj
    ? Math.max(0.05, Number(clipObj?.durationSec) || 3)
    : Math.max(0.05, Number(offsetOrDurationSec) || 3)
  const rawOffset = isClipObj ? offsetOrDurationSec : (keyframePatch.offsetSec ?? 0)

  const list = normalizeTimelineKeyframes(existing ?? [], clipDurationSec)
  const clampedOffset = round4(clamp(rawOffset, 0, clipDurationSec))
  const idx = list.findIndex((k) => Math.abs(k.offsetSec - clampedOffset) <= snapToleranceSec)
  const prev = idx >= 0 ? list[idx] : undefined
  const nextKf: TimelineClipKeyframe = {
    offsetSec: prev ? prev.offsetSec : clampedOffset,
    x: round4(clamp(keyframePatch.x ?? prev?.x ?? clipObj?.overlayX ?? 0.12, -1, 2)),
    y: round4(clamp(keyframePatch.y ?? prev?.y ?? clipObj?.overlayY ?? 0.12, -1, 2)),
    width: round4(
      clamp(keyframePatch.width ?? prev?.width ?? clipObj?.overlayWidth ?? 0.36, 0.02, 2)
    ),
    height: round4(
      clamp(keyframePatch.height ?? prev?.height ?? clipObj?.overlayHeight ?? 0.36, 0.02, 2)
    ),
    rotation: round4(
      clamp(keyframePatch.rotation ?? prev?.rotation ?? clipObj?.overlayRotation ?? 0, -720, 720)
    ),
    opacity: round4(clamp(keyframePatch.opacity ?? prev?.opacity ?? clipObj?.opacity ?? 1, 0, 1)),
    ease: keyframePatch.ease ?? prev?.ease ?? 'inOutCubic'
  }
  if (idx >= 0) {
    list[idx] = nextKf
  } else {
    list.push(nextKf)
  }
  return normalizeTimelineKeyframes(list, clipDurationSec)
}

/** 删除指定局部时间 `offsetSec` 附近的关键帧（兼容 2 参数或 3 参数调用） */
export function removeTimelineClipKeyframeAt(
  existing: readonly TimelineClipKeyframe[] | undefined,
  offsetOrDurationSec: number,
  maybeOffsetSec?: number,
  toleranceSec = 0.06
): TimelineClipKeyframe[] {
  const hasExplicitDuration = typeof maybeOffsetSec === 'number' && Number.isFinite(maybeOffsetSec)
  const clipDurationSec = hasExplicitDuration ? offsetOrDurationSec : 3600
  const offsetSec = hasExplicitDuration ? maybeOffsetSec! : offsetOrDurationSec
  const list = normalizeTimelineKeyframes(existing ?? [], clipDurationSec)
  return list.filter((k) => Math.abs(k.offsetSec - offsetSec) > toleranceSec)
}

/** 判断片段是否配置了任何有效的 DOTween 动画或关键帧序列 */
export function hasOverlayClipTween(clip: TimelineTweenableClip | null | undefined): boolean {
  if (!clip) return false
  if (clip.tweenIn && clip.tweenIn !== 'none') return true
  if (clip.tweenOut && clip.tweenOut !== 'none') return true
  if (clip.tweenLoop && clip.tweenLoop !== 'none') return true
  if (Math.abs(Number(clip.overlayRotation) || 0) > 0.05) return true
  if (Array.isArray(clip.keyframes) && clip.keyframes.length > 0) return true
  return false
}

/**
 * 核心求值函数：给定 `clip` 与片段内局部时间 `localTimeSec`（`currentTime - clip.startSec`），
 * 精确计算当前时刻的 `{ x, y, width, height, scaleX, scaleY, rotationDeg, opacity }`。
 */
export function evaluateOverlayClipTransform(
  clip: TimelineTweenableClip,
  localTimeSec: number
): OverlayEvaluatedTransform {
  const dur = Math.max(0.05, Number(clip.durationSec) || 0.05)
  const t = clamp(Number.isFinite(localTimeSec) ? localTimeSec : 0, 0, dur)

  // ── 1. 基础变换 / DOTween Sequence 多关键帧插值层 ──
  let baseX = Number.isFinite(clip.overlayX) ? clamp(Number(clip.overlayX), -1, 2) : 0.12
  let baseY = Number.isFinite(clip.overlayY) ? clamp(Number(clip.overlayY), -1, 2) : 0.12
  let baseW = Number.isFinite(clip.overlayWidth) ? clamp(Number(clip.overlayWidth), 0.02, 2) : 0.36
  let baseH = Number.isFinite(clip.overlayHeight)
    ? clamp(Number(clip.overlayHeight), 0.02, 2)
    : 0.36
  let baseRot = Number.isFinite(clip.overlayRotation)
    ? clamp(Number(clip.overlayRotation), -720, 720)
    : 0
  let baseOpacity = Number.isFinite(clip.opacity) ? clamp(Number(clip.opacity), 0, 1) : 1

  const kfs =
    Array.isArray(clip.keyframes) && clip.keyframes.length > 0
      ? normalizeTimelineKeyframes(clip.keyframes, dur)
      : []

  if (kfs.length === 1) {
    const k0 = kfs[0]!
    baseX = k0.x
    baseY = k0.y
    baseW = k0.width
    baseH = k0.height
    baseRot = k0.rotation ?? baseRot
    baseOpacity = k0.opacity ?? baseOpacity
  } else if (kfs.length >= 2) {
    if (t <= kfs[0]!.offsetSec) {
      const k0 = kfs[0]!
      baseX = k0.x
      baseY = k0.y
      baseW = k0.width
      baseH = k0.height
      baseRot = k0.rotation ?? baseRot
      baseOpacity = k0.opacity ?? baseOpacity
    } else if (t >= kfs[kfs.length - 1]!.offsetSec) {
      const kn = kfs[kfs.length - 1]!
      baseX = kn.x
      baseY = kn.y
      baseW = kn.width
      baseH = kn.height
      baseRot = kn.rotation ?? baseRot
      baseOpacity = kn.opacity ?? baseOpacity
    } else {
      for (let i = 0; i < kfs.length - 1; i++) {
        const a = kfs[i]!
        const b = kfs[i + 1]!
        if (t >= a.offsetSec && t <= b.offsetSec) {
          const span = Math.max(0.001, b.offsetSec - a.offsetSec)
          const rawU = (t - a.offsetSec) / span
          const e = evaluateTimelineEase(a.ease ?? 'inOutCubic', rawU)
          baseX = a.x + (b.x - a.x) * e
          baseY = a.y + (b.y - a.y) * e
          baseW = Math.max(0.02, a.width + (b.width - a.width) * e)
          baseH = Math.max(0.02, a.height + (b.height - a.height) * e)
          const rotA = a.rotation ?? baseRot
          const rotB = b.rotation ?? baseRot
          baseRot = rotA + (rotB - rotA) * e
          const opA = a.opacity ?? baseOpacity
          const opB = b.opacity ?? baseOpacity
          baseOpacity = clamp(opA + (opB - opA) * e, 0, 1)
          break
        }
      }
    }
  }

  let dx = 0
  let dy = 0
  let scaleX = 1
  let scaleY = 1
  let dRot = 0
  let opacityMult = 1

  // 传统线性淡入淡出包络（兼容旧 fadeInSec / fadeOutSec）
  const fadeInSec = Math.max(0, Number(clip.fadeInSec) || 0)
  const fadeOutSec = Math.max(0, Number(clip.fadeOutSec) || 0)
  if (fadeInSec > 0.01 && t < fadeInSec) {
    opacityMult *= clamp(t / fadeInSec, 0, 1)
  }
  if (fadeOutSec > 0.01 && t > dur - fadeOutSec) {
    opacityMult *= clamp((dur - t) / fadeOutSec, 0, 1)
  }

  // ── 2. 入场 DOTween 动画层 (`tweenIn`) ──
  const tweenIn = isTimelineTweenInPreset(clip.tweenIn) ? clip.tweenIn : 'none'
  const inDur =
    tweenIn !== 'none'
      ? clamp(Number(clip.tweenInDurationSec) || 0.45, 0.08, Math.max(0.08, dur * 0.85))
      : 0
  if (tweenIn !== 'none' && t < inDur) {
    const rawU = t / inDur
    const ease = clip.tweenInEase ?? defaultEaseForTweenIn(tweenIn)
    const e = evaluateTimelineEase(ease, rawU)
    const rem = 1 - e // 从 1 收敛到 0（若 outBack/outElastic 会短暂变为负数产生回弹！）
    const fadeProgress = clamp(rawU * 2.2, 0, 1)

    switch (tweenIn) {
      case 'fadeIn':
        opacityMult *= clamp(e, 0, 1)
        break
      case 'popIn':
      case 'elasticIn':
        scaleX *= Math.max(0.01, e)
        scaleY *= Math.max(0.01, e)
        opacityMult *= fadeProgress
        break
      case 'bounceIn':
        dy -= 0.42 * rem
        scaleY *= Math.max(0.2, 1 - 0.18 * Math.abs(rem))
        opacityMult *= fadeProgress
        break
      case 'slideLeft':
        dx -= (baseX + baseW + 0.08) * rem
        opacityMult *= fadeProgress
        break
      case 'slideRight':
        dx += (1.08 - baseX) * rem
        opacityMult *= fadeProgress
        break
      case 'slideUp':
        dy -= (baseY + baseH + 0.08) * rem
        opacityMult *= fadeProgress
        break
      case 'slideDown':
        dy += (1.08 - baseY) * rem
        opacityMult *= fadeProgress
        break
      case 'spinIn':
        scaleX *= Math.max(0.02, e)
        scaleY *= Math.max(0.02, e)
        dRot -= 360 * rem
        opacityMult *= fadeProgress
        break
      case 'zoomIn':
        scaleX *= Math.max(0.05, 1 + 0.85 * rem)
        scaleY *= Math.max(0.05, 1 + 0.85 * rem)
        opacityMult *= clamp(e, 0, 1)
        break
    }
  }

  // ── 3. 出场 DOTween 动画层 (`tweenOut`) ──
  const tweenOut = isTimelineTweenOutPreset(clip.tweenOut) ? clip.tweenOut : 'none'
  const outDur =
    tweenOut !== 'none'
      ? clamp(Number(clip.tweenOutDurationSec) || 0.4, 0.08, Math.max(0.08, dur * 0.85))
      : 0
  const outStart = Math.max(0, dur - outDur)
  if (tweenOut !== 'none' && t > outStart) {
    const rawU = (t - outStart) / Math.max(0.001, outDur)
    const ease = clip.tweenOutEase ?? defaultEaseForTweenOut(tweenOut)
    const e = evaluateTimelineEase(ease, rawU) // 从 0 增长到 1
    const fadeRemain = clamp(1 - rawU * 1.15, 0, 1)

    switch (tweenOut) {
      case 'fadeOut':
        opacityMult *= clamp(1 - e, 0, 1)
        break
      case 'popOut':
        scaleX *= Math.max(0.01, 1 - e)
        scaleY *= Math.max(0.01, 1 - e)
        opacityMult *= fadeRemain
        break
      case 'slideLeft':
        dx -= (baseX + baseW + 0.08) * e
        opacityMult *= fadeRemain
        break
      case 'slideRight':
        dx += (1.08 - baseX) * e
        opacityMult *= fadeRemain
        break
      case 'slideUp':
        dy -= (baseY + baseH + 0.08) * e
        opacityMult *= fadeRemain
        break
      case 'slideDown':
        dy += (1.08 - baseY) * e
        opacityMult *= fadeRemain
        break
      case 'zoomOut':
        scaleX *= Math.max(0.05, 1 + 0.75 * e)
        scaleY *= Math.max(0.05, 1 + 0.75 * e)
        opacityMult *= clamp(1 - e, 0, 1)
        break
    }
  }

  // ── 4. 循环待机 DOTween 动画层 (`tweenLoop`) ──
  const tweenLoop = isTimelineTweenLoopPreset(clip.tweenLoop) ? clip.tweenLoop : 'none'
  if (tweenLoop !== 'none') {
    const speedHz = clamp(Number(clip.tweenLoopSpeedHz) || 1.2, 0.2, 6)
    const intensity = clamp(Number(clip.tweenLoopIntensity) || 1, 0.1, 3)
    // 在入场/出场阶段平滑衰减循环波幅，避免入场滑入与待机浮动打架
    const inEnv = inDur > 0.01 && t < inDur ? clamp(t / inDur, 0, 1) : 1
    const outEnv = outDur > 0.01 && t > outStart ? clamp((dur - t) / outDur, 0, 1) : 1
    const env = inEnv * outEnv * intensity
    const phase = 2 * Math.PI * speedHz * t

    switch (tweenLoop) {
      case 'floatY':
        dy -= 0.024 * env * Math.sin(phase)
        break
      case 'pulse': {
        const s = 1 + 0.085 * env * Math.sin(phase)
        scaleX *= Math.max(0.1, s)
        scaleY *= Math.max(0.1, s)
        break
      }
      case 'heartbeat': {
        // 双峰心脏搏动包络 (DOPunchScale)
        const cyc = (t * speedHz) % 1
        const beat1 = Math.exp(-Math.pow((cyc - 0.15) / 0.07, 2))
        const beat2 = 0.65 * Math.exp(-Math.pow((cyc - 0.34) / 0.08, 2))
        const s = 1 + 0.14 * env * (beat1 + beat2)
        scaleX *= s
        scaleY *= s
        break
      }
      case 'wiggle':
        dRot += 9.5 * env * Math.sin(phase)
        break
      case 'bounce': {
        const b = Math.abs(Math.sin(Math.PI * speedHz * t))
        dy -= 0.042 * env * b
        // 落地微压扁与腾空微拉伸 (Squash & Stretch)
        const squash = (0.5 - b) * 0.06 * env
        scaleX *= 1 + squash
        scaleY *= 1 - squash
        break
      }
      case 'spin':
        dRot += (360 * speedHz * t * intensity) % 360
        break
      case 'shake':
        dx += 0.012 * env * Math.sin(phase * 3.1)
        dy += 0.01 * env * Math.cos(phase * 2.7)
        dRot += 4.5 * env * Math.sin(phase * 3.7)
        break
    }
  }

  const scaledW = round4(Math.max(0.004, baseW * scaleX))
  const scaledH = round4(Math.max(0.004, baseH * scaleY))
  const left = round4(baseX + dx + (baseW - scaledW) / 2)
  const top = round4(baseY + dy + (baseH - scaledH) / 2)
  const rot = round4(baseRot + dRot)

  return {
    x: round4(baseX + dx),
    y: round4(baseY + dy),
    left,
    top,
    width: scaledW,
    height: scaledH,
    scaleX: round4(scaleX),
    scaleY: round4(scaleY),
    rotation: rot,
    rotationDeg: rot,
    opacity: round4(clamp(baseOpacity * opacityMult, 0, 1))
  }
}

/**
 * 主视频轨（`video`）Ken Burns 推拉摇移运镜求值器（用于 Vue 实时预览）。
 */
export function evaluateMainClipCameraTransform(
  clip: TimelineTweenableClip | null | undefined,
  localTimeSec: number
): { scale: number; translateXPercent: number; translateYPercent: number } {
  const preset = clip && isTimelineMainCameraPreset(clip.cameraMotion) ? clip.cameraMotion : 'none'
  if (!clip || preset === 'none') {
    return { scale: 1, translateXPercent: 0, translateYPercent: 0 }
  }
  const dur = Math.max(0.05, Number(clip.durationSec) || 0.05)
  const rawProgress = clamp(localTimeSec / dur, 0, 1)
  const u = evaluateTimelineEase('inOutSine', rawProgress)

  switch (preset) {
    case 'kenBurnsIn':
      return { scale: round4(1 + 0.16 * u), translateXPercent: 0, translateYPercent: 0 }
    case 'kenBurnsOut':
      return { scale: round4(1.16 - 0.16 * u), translateXPercent: 0, translateYPercent: 0 }
    case 'panLeft':
      return { scale: 1.12, translateXPercent: round4(5 - 10 * u), translateYPercent: 0 }
    case 'panRight':
      return { scale: 1.12, translateXPercent: round4(-5 + 10 * u), translateYPercent: 0 }
    case 'panUp':
      return { scale: 1.12, translateXPercent: 0, translateYPercent: round4(5 - 10 * u) }
    case 'panDown':
      return { scale: 1.12, translateXPercent: 0, translateYPercent: round4(-5 + 10 * u) }
    case 'scrollPanZoomIn': {
      // 三阶段古画运镜（加长平移寻景版）：0~56% 画卷从容水平横移寻景(Pan) → 56~68% 朱印/鎏金框取景定格(Lock) → 68~100% 纵深推进至中近景(1.18x -> 1.38x)并与写实视频首帧平滑对位
      if (rawProgress <= 0.56) {
        const uPan = evaluateTimelineEase('inOutSine', rawProgress / 0.56)
        return {
          scale: 1.18,
          translateXPercent: round4(-13.5 * (1 - uPan)),
          translateYPercent: round4(1.4 * (1 - uPan))
        }
      }
      if (rawProgress <= 0.68) {
        return { scale: 1.18, translateXPercent: 0, translateYPercent: 0 }
      }
      const uPush = evaluateTimelineEase('inOutCubic', (rawProgress - 0.68) / 0.32)
      return {
        scale: round4(1.18 + 0.2 * uPush),
        translateXPercent: 0,
        translateYPercent: 0
      }
    }
    default:
      return { scale: 1, translateXPercent: 0, translateYPercent: 0 }
  }
}

// ── FFmpeg 动态滤镜链编译器 ──────────────────────────────────────

/**
 * 将归一化进度表达式 `u`（取值 0..1）编译为 FFmpeg 代数缓动表达式（内部逗号已用 `\,` 转义以适配 FFmpeg filter 参数）。
 */
export function buildFfmpegEaseExpr(ease: TimelineEaseType | undefined, u: string): string {
  const uc = `clip(${u}\\,0\\,1)`
  switch (ease ?? 'outCubic') {
    case 'linear':
      return uc
    case 'inQuad':
      return `pow(${uc}\\,2)`
    case 'outQuad':
      return `(1-pow(1-${uc}\\,2))`
    case 'inOutQuad':
      return `if(lt(${uc}\\,0.5)\\,2*pow(${uc}\\,2)\\,1-pow(-2*${uc}+2\\,2)/2)`
    case 'inCubic':
      return `pow(${uc}\\,3)`
    case 'outCubic':
      return `(1-pow(1-${uc}\\,3))`
    case 'inOutCubic':
      return `if(lt(${uc}\\,0.5)\\,4*pow(${uc}\\,3)\\,1-pow(-2*${uc}+2\\,3)/2)`
    case 'inOutSine':
      return `(-(cos(PI*${uc})-1)/2)`
    case 'outBack':
      return `(1+2.70158*pow(${uc}-1\\,3)+1.70158*pow(${uc}-1\\,2))`
    case 'inBack':
      return `(2.70158*pow(${uc}\\,3)-1.70158*pow(${uc}\\,2))`
    case 'outBounce':
      return `(1-pow(1-${uc}\\,2)*abs(cos(3.5*PI*${uc})))`
    case 'outElastic':
      return `(pow(2\\,-10*${uc})*sin((${uc}*10-0.75)*2.094395)+1)`
    default:
      return uc
  }
}

function buildPiecewiseKeyframeExpr(
  kfs: readonly TimelineClipKeyframe[],
  prop: 'x' | 'y' | 'width' | 'height' | 'rotation',
  scaleFactor: number,
  tLocalExpr: string
): string {
  const valOf = (k: TimelineClipKeyframe): number => {
    const raw =
      prop === 'x'
        ? k.x
        : prop === 'y'
          ? k.y
          : prop === 'width'
            ? k.width
            : prop === 'height'
              ? k.height
              : (k.rotation ?? 0)
    return Math.round(raw * scaleFactor * 1000) / 1000
  }
  if (kfs.length === 0) return '0'
  if (kfs.length === 1) return String(valOf(kfs[0]!))

  let expr = String(valOf(kfs[kfs.length - 1]!))
  for (let i = kfs.length - 2; i >= 0; i--) {
    const a = kfs[i]!
    const b = kfs[i + 1]!
    const va = valOf(a)
    const vb = valOf(b)
    const span = Math.max(0.001, b.offsetSec - a.offsetSec)
    const uExpr = `((${tLocalExpr}-${a.offsetSec.toFixed(3)})/${span.toFixed(3)})`
    const eExpr = buildFfmpegEaseExpr(a.ease ?? 'inOutCubic', uExpr)
    const segExpr =
      Math.abs(vb - va) < 1e-4 ? String(va) : `(${va}+(${(vb - va).toFixed(3)})*${eExpr})`
    expr = `if(lt(${tLocalExpr}\\,${b.offsetSec.toFixed(3)})\\,${segExpr}\\,${expr})`
  }
  const first = kfs[0]!
  if (first.offsetSec > 0.001) {
    expr = `if(lt(${tLocalExpr}\\,${first.offsetSec.toFixed(3)})\\,${valOf(first)}\\,${expr})`
  }
  return expr
}

/**
 * 为 `overlay` 轨片段（画中画 / 透明贴纸）生成完整的 FFmpeg 滤镜链：
 * - 全程保留 RGBA 透明通道（`pad=...:color=black@0.0`），彻底消除透明 PNG/GIF 贴纸的黑边；
 * - 编译入场/出场/循环/关键帧的动态 X、Y、旋转与 Alpha 淡入淡出表达式。
 */
export function buildOverlayClipFfmpegFilterSteps(input: {
  clip: TimelineTweenableClip
  inputIndex: number
  srcTrimExpr: string
  ptsExpr: string
  tpadOpt: string
  cropOpt: string
  eqOpt: string
  width: number
  height: number
  fps: number
  prevVideoLabel: string
}): { steps: string[]; outVideoLabel: string } {
  const {
    clip,
    inputIndex,
    srcTrimExpr,
    ptsExpr,
    tpadOpt,
    cropOpt,
    eqOpt,
    width,
    height,
    fps,
    prevVideoLabel
  } = input

  const start = Math.max(0, Number(clip.startSec) || 0)
  const dur = Math.max(0.05, Number(clip.durationSec) || 0.05)
  const opacity = Number.isFinite(clip.opacity) ? clamp(Number(clip.opacity), 0, 1) : 1
  const relX = Number.isFinite(clip.overlayX) ? clamp(Number(clip.overlayX), -1, 2) : 0.12
  const relY = Number.isFinite(clip.overlayY) ? clamp(Number(clip.overlayY), -1, 2) : 0.12
  const relW = Number.isFinite(clip.overlayWidth) ? clamp(Number(clip.overlayWidth), 0.02, 1) : 0.36
  const relH = Number.isFinite(clip.overlayHeight)
    ? clamp(Number(clip.overlayHeight), 0.02, 1)
    : 0.36
  const ow = Math.max(2, Math.round(width * relW))
  const oh = Math.max(2, Math.round(height * relH))
  const baseX = Math.max(0, Math.min(width - ow, Math.round(width * relX)))
  const baseY = Math.max(0, Math.min(height - oh, Math.round(height * relY)))

  const vLabel = `pip${inputIndex}`
  const ovLabel = `pipov${inputIndex}`

  // 若无任何 DOTween 动画与旋转，保持极简滤镜链（同时用 color=black@0.0 保证透明贴纸无黑框）
  if (!hasOverlayClipTween(clip)) {
    const steps = [
      `[${inputIndex}:v]trim=${srcTrimExpr},${ptsExpr}${tpadOpt}${cropOpt}${eqOpt},scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,setsar=1,fps=${fps},format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[${vLabel}]`,
      `[${prevVideoLabel}][${vLabel}]overlay=${baseX}:${baseY}:enable='between(t\\,${start.toFixed(3)}\\,${(start + dur).toFixed(3)})'[${ovLabel}]`
    ]
    return { steps, outVideoLabel: ovLabel }
  }

  // 在 overlay 滤镜中，时间变量 `t` 是全局时间线秒数，因此片段内局部时间为 `(t - start)`
  const tl = `(t-${start.toFixed(3)})`
  const kfs =
    Array.isArray(clip.keyframes) && clip.keyframes.length > 0
      ? normalizeTimelineKeyframes(clip.keyframes, dur)
      : []

  let xExpr = kfs.length > 0 ? buildPiecewiseKeyframeExpr(kfs, 'x', width, tl) : String(baseX)
  let yExpr = kfs.length > 0 ? buildPiecewiseKeyframeExpr(kfs, 'y', height, tl) : String(baseY)

  const tweenIn = isTimelineTweenInPreset(clip.tweenIn) ? clip.tweenIn : 'none'
  const inDur =
    tweenIn !== 'none'
      ? clamp(Number(clip.tweenInDurationSec) || 0.45, 0.08, Math.max(0.08, dur * 0.85))
      : 0
  if (tweenIn !== 'none' && inDur > 0) {
    const ease = clip.tweenInEase ?? defaultEaseForTweenIn(tweenIn)
    const eIn = buildFfmpegEaseExpr(ease, `(${tl}/${inDur.toFixed(3)})`)
    const remIn = `if(lt(${tl}\\,${inDur.toFixed(3)})\\,(1-${eIn})\\,0)`
    if (tweenIn === 'slideLeft') {
      xExpr = `(${xExpr}-${Math.round(baseX + ow + width * 0.08)}*${remIn})`
    } else if (tweenIn === 'slideRight') {
      xExpr = `(${xExpr}+${Math.round(width * 1.08 - baseX)}*${remIn})`
    } else if (tweenIn === 'slideUp') {
      yExpr = `(${yExpr}-${Math.round(baseY + oh + height * 0.08)}*${remIn})`
    } else if (tweenIn === 'slideDown') {
      yExpr = `(${yExpr}+${Math.round(height * 1.08 - baseY)}*${remIn})`
    } else if (tweenIn === 'bounceIn' || tweenIn === 'popIn' || tweenIn === 'elasticIn') {
      const dropPx = Math.round(height * (tweenIn === 'bounceIn' ? 0.36 : 0.08))
      yExpr = `(${yExpr}-${dropPx}*${remIn})`
    }
  }

  const tweenOut = isTimelineTweenOutPreset(clip.tweenOut) ? clip.tweenOut : 'none'
  const outDur =
    tweenOut !== 'none'
      ? clamp(Number(clip.tweenOutDurationSec) || 0.4, 0.08, Math.max(0.08, dur * 0.85))
      : 0
  const outStart = Math.max(0, dur - outDur)
  if (tweenOut !== 'none' && outDur > 0) {
    const ease = clip.tweenOutEase ?? defaultEaseForTweenOut(tweenOut)
    const eOut = buildFfmpegEaseExpr(ease, `((${tl}-${outStart.toFixed(3)})/${outDur.toFixed(3)})`)
    const progOut = `if(gt(${tl}\\,${outStart.toFixed(3)})\\,${eOut}\\,0)`
    if (tweenOut === 'slideLeft') {
      xExpr = `(${xExpr}-${Math.round(baseX + ow + width * 0.08)}*${progOut})`
    } else if (tweenOut === 'slideRight') {
      xExpr = `(${xExpr}+${Math.round(width * 1.08 - baseX)}*${progOut})`
    } else if (tweenOut === 'slideUp') {
      yExpr = `(${yExpr}-${Math.round(baseY + oh + height * 0.08)}*${progOut})`
    } else if (tweenOut === 'slideDown' || tweenOut === 'popOut') {
      const exitPx = Math.round(height * (tweenOut === 'popOut' ? 0.08 : 1.08 - relY))
      yExpr = `(${yExpr}+${exitPx}*${progOut})`
    }
  }

  const tweenLoop = isTimelineTweenLoopPreset(clip.tweenLoop) ? clip.tweenLoop : 'none'
  const speedHz = clamp(Number(clip.tweenLoopSpeedHz) || 1.2, 0.2, 6)
  const intensity = clamp(Number(clip.tweenLoopIntensity) || 1, 0.1, 3)
  if (tweenLoop === 'floatY') {
    const ampPx = Math.max(2, Math.round(height * 0.024 * intensity))
    yExpr = `(${yExpr}-${ampPx}*sin(2*PI*${speedHz.toFixed(2)}*${tl}))`
  } else if (tweenLoop === 'bounce') {
    const ampPx = Math.max(2, Math.round(height * 0.042 * intensity))
    yExpr = `(${yExpr}-${ampPx}*abs(sin(PI*${speedHz.toFixed(2)}*${tl})))`
  } else if (tweenLoop === 'shake') {
    const ampX = Math.max(1, Math.round(width * 0.012 * intensity))
    const ampY = Math.max(1, Math.round(height * 0.01 * intensity))
    xExpr = `(${xExpr}+${ampX}*sin(6.2*PI*${speedHz.toFixed(2)}*${tl}))`
    yExpr = `(${yExpr}+${ampY}*cos(5.4*PI*${speedHz.toFixed(2)}*${tl}))`
  }

  // 构建旋转与 Alpha 淡入淡出附加滤镜（流内时间 `t` 从 0 开始）
  const extraStreamFilters: string[] = []
  const baseRotDeg = Number(clip.overlayRotation) || 0
  const hasKeyframeRot = kfs.some((k) => Math.abs(k.rotation ?? 0) > 0.05)
  const needsRotate =
    Math.abs(baseRotDeg) > 0.05 ||
    hasKeyframeRot ||
    tweenIn === 'spinIn' ||
    tweenLoop === 'wiggle' ||
    tweenLoop === 'spin' ||
    tweenLoop === 'shake'

  if (needsRotate) {
    let degExpr = hasKeyframeRot
      ? buildPiecewiseKeyframeExpr(kfs, 'rotation', 1, 't')
      : String(round4(baseRotDeg))
    if (tweenIn === 'spinIn' && inDur > 0) {
      const eSpin = buildFfmpegEaseExpr(clip.tweenInEase ?? 'outBack', `(t/${inDur.toFixed(3)})`)
      degExpr = `(${degExpr}-360*if(lt(t\\,${inDur.toFixed(3)})\\,(1-${eSpin})\\,0))`
    }
    if (tweenLoop === 'wiggle') {
      degExpr = `(${degExpr}+${(9.5 * intensity).toFixed(2)}*sin(2*PI*${speedHz.toFixed(2)}*t))`
    } else if (tweenLoop === 'spin') {
      degExpr = `(${degExpr}+${(360 * speedHz * intensity).toFixed(1)}*t)`
    } else if (tweenLoop === 'shake') {
      degExpr = `(${degExpr}+${(4.5 * intensity).toFixed(2)}*sin(7.4*PI*${speedHz.toFixed(2)}*t))`
    }
    extraStreamFilters.push(
      `rotate=a='(${degExpr})*PI/180':ow=${ow}:oh=${oh}:c=0x00000000:bilinear=1`
    )
  }

  const effFadeIn = Math.max(
    Number(clip.fadeInSec) || 0,
    tweenIn === 'fadeIn' || tweenIn === 'popIn' || tweenIn === 'elasticIn' || tweenIn === 'zoomIn'
      ? Math.min(inDur, 0.35)
      : 0
  )
  const effFadeOut = Math.max(
    Number(clip.fadeOutSec) || 0,
    tweenOut === 'fadeOut' || tweenOut === 'popOut' || tweenOut === 'zoomOut'
      ? Math.min(outDur, 0.35)
      : 0
  )
  if (effFadeIn > 0.02) {
    extraStreamFilters.push(`fade=t=in:st=0:d=${effFadeIn.toFixed(3)}:alpha=1`)
  }
  if (effFadeOut > 0.02 && dur > effFadeOut) {
    extraStreamFilters.push(
      `fade=t=out:st=${Math.max(0, dur - effFadeOut).toFixed(3)}:d=${effFadeOut.toFixed(3)}:alpha=1`
    )
  }

  const extraOpt = extraStreamFilters.length > 0 ? `,${extraStreamFilters.join(',')}` : ''
  const steps = [
    `[${inputIndex}:v]trim=${srcTrimExpr},${ptsExpr}${tpadOpt}${cropOpt}${eqOpt},scale=${ow}:${oh}:force_original_aspect_ratio=decrease,pad=${ow}:${oh}:(ow-iw)/2:(oh-ih)/2:color=black@0.0,setsar=1,fps=${fps},format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}${extraOpt}[${vLabel}]`,
    `[${prevVideoLabel}][${vLabel}]overlay=x='${xExpr}':y='${yExpr}':enable='between(t\\,${start.toFixed(3)}\\,${(start + dur).toFixed(3)})'[${ovLabel}]`
  ]
  return { steps, outVideoLabel: ovLabel }
}

/**
 * 为主视频轨（`video`）生成 Ken Burns 推拉摇移滤镜片段（流内时间 `t` 从 0 到 `dur`）。
 */
export function buildMainClipCameraFfmpegFilter(
  cameraMotion: TimelineMainCameraPreset | undefined,
  width: number,
  height: number,
  durationSec: number
): string {
  if (!cameraMotion || cameraMotion === 'none') return ''
  const dur = Math.max(0.1, durationSec)
  // 放大至 1.16 倍画幅后通过动态 crop(x, y) 实现平滑无抖动推拉摇移
  const sw = Math.round((width * 1.16) / 2) * 2
  const sh = Math.round((height * 1.16) / 2) * 2
  const dxMax = Math.max(2, sw - width)
  const dyMax = Math.max(2, sh - height)
  const u = `clip(t/${dur.toFixed(3)}\\,0\\,1)`

  switch (cameraMotion) {
    case 'panLeft':
      return `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='${dxMax}*(1-${u})':y='${Math.round(dyMax / 2)}'`
    case 'panRight':
      return `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='${dxMax}*${u}':y='${Math.round(dyMax / 2)}'`
    case 'panUp':
      return `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='${Math.round(dxMax / 2)}':y='${dyMax}*(1-${u})'`
    case 'panDown':
      return `scale=${sw}:${sh}:force_original_aspect_ratio=increase,crop=${width}:${height}:x='${Math.round(dxMax / 2)}':y='${dyMax}*${u}'`
    case 'kenBurnsIn':
    case 'kenBurnsOut': {
      const zExpr = cameraMotion === 'kenBurnsIn' ? `(1+0.14*${u})` : `(1.14-0.14*${u})`
      return `scale=w='trunc(${width}*${zExpr}/2)*2':h='trunc(${height}*${zExpr}/2)*2':eval=frame,crop=${width}:${height}:x='(iw-${width})/2':y='(ih-${height})/2'`
    }
    case 'scrollPanZoomIn': {
      // 0~56% 从容水平移镜(Pan: x 从 0.95*(iw-w) 平滑移至 0.5*(iw-w)) → 56~68% 朱印/鎏金框锁定定格 → 68~100% 纵深推进至 1.38x 中近景
      const uPan = buildFfmpegEaseExpr('inOutSine', `(${u}/0.56)`)
      const uPush = buildFfmpegEaseExpr('inOutCubic', `((${u}-0.68)/0.32)`)
      const zExpr = `if(gt(${u}\\,0.68)\\,(1.18+0.20*${uPush})\\,1.18)`
      const xRatioExpr = `if(lt(${u}\\,0.56)\\,(0.95-0.45*${uPan})\\,0.5)`
      return `scale=w='trunc(${width}*${zExpr}/2)*2':h='trunc(${height}*${zExpr}/2)*2':eval=frame,crop=${width}:${height}:x='(iw-${width})*${xRatioExpr}':y='(ih-${height})/2'`
    }
    default:
      return ''
  }
}

// ── 内置零依赖参数化高清矢量贴纸库 ──────────────────────────────

export type TimelineBuiltinStickerId =
  | 'focus-circle'
  | 'arrow-pointer'
  | 'badge-important'
  | 'check-correct'
  | 'cross-warn'
  | 'step-badge'
  | 'callout-bubble'
  | 'sparkle-star'
  | 'viewfinder-frame'
  | 'scroll-seal-frame'
  | 'museum-gilded-frame'

export interface TimelineBuiltinStickerSpec {
  id: TimelineBuiltinStickerId
  labelKey: string
  icon: string
  defaultTitle: string
  defaultColor: string
  defaultText?: string
  defaultWidth: number
  defaultHeight: number
  defaultTweenIn: TimelineTweenInPreset
  defaultTweenLoop: TimelineTweenLoopPreset
  defaultTweenOut: TimelineTweenOutPreset
}

export type TimelineBuiltinStickerPreset = TimelineBuiltinStickerSpec

export const TIMELINE_BUILTIN_STICKERS: readonly TimelineBuiltinStickerSpec[] = [
  {
    id: 'focus-circle',
    labelKey: 'script.timeline.stickerPreset.focus-circle',
    icon: '⭕',
    defaultTitle: '重点红圈高亮', // cjk-ok
    defaultColor: '#FF2E4C',
    defaultWidth: 0.24,
    defaultHeight: 0.24,
    defaultTweenIn: 'popIn',
    defaultTweenLoop: 'pulse',
    defaultTweenOut: 'popOut'
  },
  {
    id: 'arrow-pointer',
    labelKey: 'script.timeline.stickerPreset.arrow-pointer',
    icon: '↘️',
    defaultTitle: '动感指示箭头', // cjk-ok
    defaultColor: '#FFE600',
    defaultWidth: 0.18,
    defaultHeight: 0.18,
    defaultTweenIn: 'slideLeft',
    defaultTweenLoop: 'bounce',
    defaultTweenOut: 'fadeOut'
  },
  {
    id: 'badge-important',
    labelKey: 'script.timeline.stickerPreset.badge-important',
    icon: '🔥',
    defaultTitle: '核心重点角标', // cjk-ok
    defaultColor: '#FF2E4C',
    defaultText: 'KEY POINT · 重点', // cjk-ok
    defaultWidth: 0.26,
    defaultHeight: 0.12,
    defaultTweenIn: 'elasticIn',
    defaultTweenLoop: 'heartbeat',
    defaultTweenOut: 'popOut'
  },
  {
    id: 'check-correct',
    labelKey: 'script.timeline.stickerPreset.check-correct',
    icon: '✅',
    defaultTitle: '正确勾选徽章', // cjk-ok
    defaultColor: '#10B981',
    defaultWidth: 0.16,
    defaultHeight: 0.16,
    defaultTweenIn: 'bounceIn',
    defaultTweenLoop: 'floatY',
    defaultTweenOut: 'popOut'
  },
  {
    id: 'cross-warn',
    labelKey: 'script.timeline.stickerPreset.cross-warn',
    icon: '❌',
    defaultTitle: '避坑警示徽章', // cjk-ok
    defaultColor: '#EF4444',
    defaultWidth: 0.16,
    defaultHeight: 0.16,
    defaultTweenIn: 'popIn',
    defaultTweenLoop: 'shake',
    defaultTweenOut: 'popOut'
  },
  {
    id: 'step-badge',
    labelKey: 'script.timeline.stickerPreset.step-badge',
    icon: '①',
    defaultTitle: '步骤序号角标', // cjk-ok
    defaultColor: '#6366F1',
    defaultText: '01',
    defaultWidth: 0.15,
    defaultHeight: 0.15,
    defaultTweenIn: 'spinIn',
    defaultTweenLoop: 'floatY',
    defaultTweenOut: 'popOut'
  },
  {
    id: 'callout-bubble',
    labelKey: 'script.timeline.stickerPreset.callout-bubble',
    icon: '💬',
    defaultTitle: '科普提示气泡', // cjk-ok
    defaultColor: '#38BDF8',
    defaultText: '核心知识点 💡', // cjk-ok
    defaultWidth: 0.28,
    defaultHeight: 0.18,
    defaultTweenIn: 'popIn',
    defaultTweenLoop: 'wiggle',
    defaultTweenOut: 'fadeOut'
  },
  {
    id: 'sparkle-star',
    labelKey: 'script.timeline.stickerPreset.sparkle-star',
    icon: '✨',
    defaultTitle: '高光闪烁星芒', // cjk-ok
    defaultColor: '#FACC15',
    defaultWidth: 0.16,
    defaultHeight: 0.16,
    defaultTweenIn: 'zoomIn',
    defaultTweenLoop: 'spin',
    defaultTweenOut: 'fadeOut'
  },
  {
    id: 'viewfinder-frame',
    labelKey: 'script.timeline.stickerPreset.viewfinder-frame',
    icon: '📷',
    defaultTitle: '古画取景对焦框', // cjk-ok
    defaultColor: '#F59E0B',
    defaultText: 'SNAP · 入画取景', // cjk-ok
    defaultWidth: 0.88,
    defaultHeight: 0.84,
    defaultTweenIn: 'zoomIn',
    defaultTweenLoop: 'pulse',
    defaultTweenOut: 'fadeOut'
  },
  {
    id: 'scroll-seal-frame',
    labelKey: 'script.timeline.stickerPreset.scroll-seal-frame',
    icon: '🏮',
    defaultTitle: '东方文博朱印框', // cjk-ok
    defaultColor: '#D97706',
    defaultText: '御览 · 入画', // cjk-ok
    defaultWidth: 0.88,
    defaultHeight: 0.84,
    defaultTweenIn: 'zoomIn',
    defaultTweenLoop: 'pulse',
    defaultTweenOut: 'fadeOut'
  },
  {
    id: 'museum-gilded-frame',
    labelKey: 'script.timeline.stickerPreset.museum-gilded-frame',
    icon: '🏛️',
    defaultTitle: '西洋鎏金馆藏框', // cjk-ok
    defaultColor: '#EAB308',
    defaultText: 'GALLERY · ARCHIVE',
    defaultWidth: 0.88,
    defaultHeight: 0.84,
    defaultTweenIn: 'zoomIn',
    defaultTweenLoop: 'pulse',
    defaultTweenOut: 'fadeOut'
  }
] as const

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export interface TimelineBuiltinStickerRenderOptions {
  text?: string
  color?: string
}

/**
 * 生成内置参数化贴纸的高清透明背景 SVG 字符串（512×512 画布）。
 */
export function renderTimelineBuiltinStickerSvg(
  stickerId: TimelineBuiltinStickerId | string,
  optionsOrLabel?: string | TimelineBuiltinStickerRenderOptions
): string {
  const customLabel =
    typeof optionsOrLabel === 'string'
      ? optionsOrLabel.trim()
      : typeof optionsOrLabel?.text === 'string'
        ? optionsOrLabel.text.trim()
        : ''
  const customColor =
    typeof optionsOrLabel === 'object' &&
    optionsOrLabel !== null &&
    typeof optionsOrLabel.color === 'string' &&
    /^#[0-9a-fA-F]{6}$/.test(optionsOrLabel.color.trim())
      ? optionsOrLabel.color.trim()
      : ''

  switch (stickerId) {
    case 'focus-circle': {
      const stroke = customColor || '#FF2E4C'
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <ellipse cx="256" cy="256" rx="210" ry="168" transform="rotate(-6 256 256)" stroke="${stroke}" stroke-width="18" stroke-linecap="round" stroke-dasharray="1120 80"/>
  <ellipse cx="256" cy="256" rx="198" ry="154" transform="rotate(4 256 256)" stroke="#FF9F1C" stroke-width="8" stroke-opacity="0.85" stroke-linecap="round"/>
</svg>`
    }
    case 'arrow-pointer': {
      const c0 = customColor || '#FFE600'
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <defs>
    <linearGradient id="ag" x1="64" y1="64" x2="432" y2="432" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="${c0}"/>
      <stop offset="100%" stop-color="#FF2E4C"/>
    </linearGradient>
  </defs>
  <path d="M84 84L388 388M388 388V196M388 388H196" stroke="#111318" stroke-width="48" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M84 84L388 388M388 388V196M388 388H196" stroke="url(#ag)" stroke-width="32" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
    }
    case 'badge-important': {
      const fill = customColor || '#FF2E4C'
      const label = escapeXml((customLabel || 'KEY POINT · 重点').slice(0, 18)) // cjk-ok
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="256" viewBox="0 0 512 256" fill="none">
  <rect x="20" y="44" width="472" height="168" rx="84" fill="${fill}" stroke="#FFFFFF" stroke-width="14"/>
  <text x="256" y="146" text-anchor="middle" fill="#FFFFFF" font-family="system-ui, -apple-system, Microsoft YaHei, sans-serif" font-size="48" font-weight="900">${label}</text>
</svg>`
    }
    case 'check-correct': {
      const fill = customColor || '#10B981'
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <circle cx="256" cy="256" r="208" fill="${fill}" stroke="#FFFFFF" stroke-width="20"/>
  <path d="M156 262L226 332L364 186" stroke="#FFFFFF" stroke-width="38" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`
    }
    case 'cross-warn': {
      const fill = customColor || '#EF4444'
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <circle cx="256" cy="256" r="208" fill="${fill}" stroke="#FFFFFF" stroke-width="20"/>
  <path d="M176 176L336 336M336 176L176 336" stroke="#FFFFFF" stroke-width="38" stroke-linecap="round"/>
</svg>`
    }
    case 'step-badge': {
      const fill = customColor || '#6366F1'
      const stepText = escapeXml((customLabel || '01').slice(0, 4))
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <circle cx="256" cy="256" r="206" fill="${fill}" stroke="#FACC15" stroke-width="22"/>
  <text x="256" y="312" text-anchor="middle" fill="#FFFFFF" font-family="system-ui, -apple-system, sans-serif" font-size="168" font-weight="900">${stepText}</text>
</svg>`
    }
    case 'callout-bubble': {
      const stroke = customColor || '#38BDF8'
      const bubbleText = escapeXml((customLabel || '核心知识点 💡').slice(0, 14)) // cjk-ok
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="340" viewBox="0 0 512 340" fill="none">
  <path d="M44 40H468C481 40 492 51 492 64V224C492 237 481 248 468 248H188L104 316V248H44C31 248 20 237 20 224V64C20 51 31 40 44 40Z" fill="#1E293B" stroke="${stroke}" stroke-width="14" stroke-linejoin="round"/>
  <text x="256" y="160" text-anchor="middle" fill="#F8FAFC" font-family="system-ui, -apple-system, Microsoft YaHei, sans-serif" font-size="46" font-weight="800">${bubbleText}</text>
</svg>`
    }
    case 'viewfinder-frame': {
      const stroke = customColor || '#F59E0B'
      return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" fill="none">
  <path d="M36 132V36H132M828 36H924V132M924 408V504H828M132 504H36V408" stroke="#0F172A" stroke-opacity="0.72" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M36 132V36H132M828 36H924V132M924 408V504H828M132 504H36V408" stroke="${stroke}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="480" cy="270" r="46" stroke="${stroke}" stroke-opacity="0.88" stroke-width="4" stroke-dasharray="18 10"/>
  <path d="M480 206V234M480 306V334M416 270H444M516 270H544" stroke="${stroke}" stroke-width="4" stroke-linecap="round"/>
  <circle cx="480" cy="270" r="5" fill="#EF4444"/>
  <rect x="64" y="58" width="168" height="36" rx="18" fill="#0F172A" fill-opacity="0.75" stroke="${stroke}" stroke-width="2"/>
  <circle cx="88" cy="76" r="6" fill="#EF4444"/>
  <text x="156" y="82" text-anchor="middle" fill="#F8FAFC" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="800">AF · 50mm</text>
</svg>`
    }
    case 'scroll-seal-frame': {
      const stroke = customColor || '#D97706'
      const sealTop = '御' // cjk-ok
      const sealBottom = '览' // cjk-ok
      return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" fill="none">
  <path d="M32 140V32H140M820 32H928V140M928 400V508H820M140 508H32V400" stroke="#1C1917" stroke-opacity="0.65" stroke-width="14" stroke-linecap="square"/>
  <path d="M32 140V32H140M820 32H928V140M928 400V508H820M140 508H32V400" stroke="${stroke}" stroke-width="6" stroke-linecap="square"/>
  <rect x="46" y="46" width="868" height="448" stroke="${stroke}" stroke-opacity="0.48" stroke-width="2"/>
  <path d="M46 86H86V46M874 46V86H914M914 454H874V494M86 494V454H46" stroke="${stroke}" stroke-opacity="0.82" stroke-width="3"/>
  <rect x="64" y="62" width="46" height="68" rx="4" fill="#B91C1C" fill-opacity="0.92" stroke="#FEF3C7" stroke-width="2"/>
  <rect x="69" y="67" width="36" height="58" rx="2" stroke="#FEF3C7" stroke-opacity="0.78" stroke-width="1.2"/>
  <text x="87" y="92" text-anchor="middle" fill="#FEF3C7" font-family="STKaiti, KaiTi, serif" font-size="20" font-weight="700">${sealTop}</text>
  <text x="87" y="116" text-anchor="middle" fill="#FEF3C7" font-family="STKaiti, KaiTi, serif" font-size="20" font-weight="700">${sealBottom}</text>
  <path d="M480 236L490 270L480 304L470 270Z" stroke="${stroke}" stroke-opacity="0.72" stroke-width="2"/>
  <path d="M432 270H462M498 270H528M480 214V232M480 308V326" stroke="${stroke}" stroke-opacity="0.62" stroke-width="2" stroke-linecap="round"/>
</svg>`
    }
    case 'museum-gilded-frame': {
      const stroke = customColor || '#EAB308'
      return `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540" fill="none">
  <path d="M28 148V28H148M812 28H932V148M932 392V512H812M148 512H28V392" stroke="#18181B" stroke-opacity="0.72" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M28 148V28H148M812 28H932V148M932 392V512H812M148 512H28V392" stroke="${stroke}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="44" y="44" width="872" height="452" rx="6" stroke="${stroke}" stroke-opacity="0.54" stroke-width="2.5"/>
  <circle cx="44" cy="44" r="10" fill="#451A03" stroke="${stroke}" stroke-width="3"/>
  <circle cx="916" cy="44" r="10" fill="#451A03" stroke="${stroke}" stroke-width="3"/>
  <circle cx="916" cy="496" r="10" fill="#451A03" stroke="${stroke}" stroke-width="3"/>
  <circle cx="44" cy="496" r="10" fill="#451A03" stroke="${stroke}" stroke-width="3"/>
  <rect x="62" y="58" width="212" height="34" rx="4" fill="#450A0A" fill-opacity="0.88" stroke="${stroke}" stroke-width="2"/>
  <text x="168" y="80" text-anchor="middle" fill="#FEF08A" font-family="Georgia, Times New Roman, serif" font-size="15" font-weight="700" letter-spacing="1.5">GALLERY · ARCHIVE</text>
  <circle cx="480" cy="270" r="34" stroke="${stroke}" stroke-opacity="0.72" stroke-width="2"/>
  <circle cx="480" cy="270" r="4" fill="${stroke}"/>
  <path d="M428 270H442M518 270H532M480 218V232M480 308V322" stroke="${stroke}" stroke-opacity="0.65" stroke-width="2" stroke-linecap="round"/>
</svg>`
    }
    case 'sparkle-star':
    default: {
      const fill = customColor || '#FACC15'
      return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" fill="none">
  <path d="M256 36L302 210L476 256L302 302L256 476L210 302L36 256L210 210L256 36Z" fill="${fill}" stroke="#FFFBEB" stroke-width="14" stroke-linejoin="round"/>
  <circle cx="396" cy="116" r="24" fill="#38BDF8"/>
  <circle cx="116" cy="396" r="18" fill="#F472B6"/>
</svg>`
    }
  }
}

export function renderTimelineBuiltinStickerDataUrl(
  stickerId: TimelineBuiltinStickerId | string,
  optionsOrLabel?: string | TimelineBuiltinStickerRenderOptions
): string {
  const svg = renderTimelineBuiltinStickerSvg(stickerId, optionsOrLabel)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

/**
 * 在浏览器/渲染进程将内置 SVG 贴纸光栅化为透明背景 PNG dataURL，
 * 供主进程直接落盘为 .png 交给 FFmpeg（规避 Windows/macOS 标准 FFmpeg 缺少 librsvg 解码器导致导出报错）。
 */
export async function rasterizeTimelineStickerSvgToPngDataUrl(
  stickerId: TimelineBuiltinStickerId | string,
  optionsOrLabel?: string | TimelineBuiltinStickerRenderOptions
): Promise<string | undefined> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    return undefined
  }
  const svg = renderTimelineBuiltinStickerSvg(stickerId, optionsOrLabel)
  const wMatch = svg.match(/\bwidth="(\d+)"/)
  const hMatch = svg.match(/\bheight="(\d+)"/)
  const width = wMatch ? Math.max(64, Number(wMatch[1])) : 512
  const height = hMatch ? Math.max(64, Number(hMatch[1])) : 512
  const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

  return new Promise<string | undefined>((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => resolve(undefined), 1500)
    img.onload = () => {
      clearTimeout(timer)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(undefined)
          return
        }
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        const pngUrl = canvas.toDataURL('image/png')
        resolve(pngUrl.startsWith('data:image/png;base64,') ? pngUrl : undefined)
      } catch {
        resolve(undefined)
      }
    }
    img.onerror = () => {
      clearTimeout(timer)
      resolve(undefined)
    }
    img.src = svgDataUrl
  })
}
