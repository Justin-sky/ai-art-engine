import type { GraphPortDataType, GraphPortDef } from './types'
import { GraphPortType } from './types'

/** 媒体输入口才显示数量上限角标（文本口不显示） */
export const PORT_LIMIT_MEDIA_TYPES: ReadonlySet<GraphPortDataType> = new Set([
  GraphPortType.image,
  GraphPortType.video,
  GraphPortType.voice
])

export function isPortLimitMediaType(dataType: GraphPortDataType): boolean {
  return PORT_LIMIT_MEDIA_TYPES.has(dataType)
}

/**
 * 端口数量上限：number 为声明值；null 表示未声明（UI 显示 *）。
 */
export type PortInputLimitMax = number | null

export interface VideoGeneratePortLimits {
  maxImages: PortInputLimitMax
  maxVideos: PortInputLimitMax
  maxVoices: PortInputLimitMax
  /** 输出时长可选秒数；空表示未声明 */
  durations: number[]
}

export const UNKNOWN_VIDEO_PORT_LIMITS: VideoGeneratePortLimits = {
  maxImages: null,
  maxVideos: null,
  maxVoices: null,
  durations: []
}

/** Seedance 2.0 官方参考素材上限（catalog 未声明时的已知回退） */
export const SEEDANCE_VIDEO_PORT_LIMITS: Omit<VideoGeneratePortLimits, 'durations'> = {
  maxImages: 9,
  maxVideos: 3,
  maxVoices: 3
}

export function isSeedanceVideoModel(modelId: string | undefined): boolean {
  return Boolean(modelId && /seedance/i.test(modelId))
}

function asPositiveInt(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < 0) return null
  return Math.floor(n)
}

function parseDurationList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return [
    ...new Set(
      raw
        .map((v) => Number(v))
        .filter((n) => Number.isFinite(n) && n > 0)
        .map((n) => Math.round(n))
    )
  ].sort((a, b) => a - b)
}

/**
 * 从视频模型 catalog capabilities 解析端口限额。
 * 优先读显式字段；Seedance 用已知上限；否则为未声明（*）。
 */
export function resolveVideoGeneratePortLimits(
  modelId: string | undefined,
  capabilities?: Record<string, unknown> | null
): VideoGeneratePortLimits {
  const caps = capabilities && typeof capabilities === 'object' ? capabilities : null
  const durations = parseDurationList(caps?.supported_durations)

  const sp =
    caps?.supported_parameters &&
    typeof caps.supported_parameters === 'object' &&
    !Array.isArray(caps.supported_parameters)
      ? (caps.supported_parameters as Record<string, unknown>)
      : null

  const fromSp = (key: string): PortInputLimitMax => {
    if (!sp) return null
    const raw = sp[key]
    if (raw == null) return null
    if (typeof raw === 'object' && raw && 'max' in (raw as object)) {
      return asPositiveInt((raw as { max?: unknown }).max)
    }
    return asPositiveInt(raw)
  }

  // 分类型上限优先（max_images / max_input_images）；未声明时回退总参考数 input_references
  let maxImages =
    fromSp('max_images') ??
    asPositiveInt(caps?.max_input_images) ??
    fromSp('input_references')
  let maxVideos = fromSp('max_videos') ?? asPositiveInt(caps?.max_input_videos)
  let maxVoices = fromSp('max_audios') ?? asPositiveInt(caps?.max_input_audios)

  if (isSeedanceVideoModel(modelId)) {
    maxImages = maxImages ?? SEEDANCE_VIDEO_PORT_LIMITS.maxImages
    maxVideos = maxVideos ?? SEEDANCE_VIDEO_PORT_LIMITS.maxVideos
    maxVoices = maxVoices ?? SEEDANCE_VIDEO_PORT_LIMITS.maxVoices
  }

  return {
    maxImages,
    maxVideos,
    maxVoices,
    durations
  }
}

/** 角标文案：有上限显示数字，未声明显示 * */
export function formatPortLimitBadge(max: PortInputLimitMax | undefined): string {
  if (typeof max === 'number' && Number.isFinite(max) && max >= 0) {
    return String(Math.floor(max))
  }
  return '*'
}

export function formatDurationRange(durations: number[]): string {
  if (!durations.length) return ''
  if (durations.length === 1) return `${durations[0]}s`
  const lo = durations[0]!
  const hi = durations[durations.length - 1]!
  if (durations.length === hi - lo + 1) return `${lo}–${hi}s`
  return `${durations.join('/')}s`
}

/** 按端口数据类型取数量上限 */
export function portLimitMaxForDataType(
  dataType: GraphPortDataType,
  opts: {
    kind: 'image' | 'video' | null
    imageMax?: PortInputLimitMax
    videoLimits?: VideoGeneratePortLimits | null
  }
): PortInputLimitMax | undefined {
  if (!isPortLimitMediaType(dataType)) return undefined
  if (opts.kind === 'image') {
    if (dataType === GraphPortType.image) {
      return opts.imageMax === undefined ? null : opts.imageMax
    }
    return undefined
  }
  if (opts.kind === 'video') {
    const limits = opts.videoLimits ?? UNKNOWN_VIDEO_PORT_LIMITS
    if (dataType === GraphPortType.image) {
      return limits.maxImages
    }
    if (dataType === GraphPortType.video) {
      return limits.maxVideos
    }
    if (dataType === GraphPortType.voice) return limits.maxVoices
  }
  return undefined
}

export function shouldShowPortLimitBadge(port: Pick<GraphPortDef, 'direction' | 'dataType'>): boolean {
  return port.direction === 'in' && isPortLimitMediaType(port.dataType)
}

/**
 * 风格参考图占用图片输入槽位后的剩余上限。
 * null / undefined 原样返回（未声明上限时角标仍为 *）。
 */
export function deductReservedImageSlots(
  max: PortInputLimitMax | undefined,
  reserved: number
): PortInputLimitMax | undefined {
  if (max === undefined || max === null) return max
  const n = Math.max(0, Math.floor(reserved))
  return Math.max(0, max - n)
}

/**
 * 合并风格图与端口参考图：风格图优先占位，剩余槽位给端口图。
 * 保证提交 API 时风格图与参考图同批，且超限时优先保留风格图。
 */
export function mergeImageUrlsWithStyleBudget(
  portUrls: string[],
  styleUrls: string[],
  max: number
): string[] {
  const cap = Math.max(0, Math.floor(max))
  const styles = styleUrls.map((url) => url.trim()).filter(Boolean).slice(0, cap)
  const rest = Math.max(0, cap - styles.length)
  const ports = portUrls.map((url) => url.trim()).filter(Boolean).slice(0, rest)
  return [...styles, ...ports]
}
