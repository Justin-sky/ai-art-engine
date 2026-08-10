/**
 * 视频生成节点参数（对齐 OpenRouter /videos）。
 * UI 按模型 catalog 能力动态显示可选值。
 */

import { clampSeed } from './imageGenerateParams'

/** 视频首/尾帧专用入端口 */
export const VIDEO_FIRST_FRAME_PORT_ID = 'in-first-frame'
export const VIDEO_LAST_FRAME_PORT_ID = 'in-last-frame'

export const VIDEO_FRAME_PORT_IDS = [
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID
] as const

export type VideoFramePortId = (typeof VIDEO_FRAME_PORT_IDS)[number]

export type VideoFrameMode = 'none' | 'first' | 'first_last'

export function isVideoFramePortId(portId: string | undefined | null): boolean {
  return (
    portId === VIDEO_FIRST_FRAME_PORT_ID || portId === VIDEO_LAST_FRAME_PORT_ID
  )
}

export function availableVideoFrameModes(
  supportedFrameImages: string[]
): VideoFrameMode[] {
  const modes: VideoFrameMode[] = ['none']
  const hasFirst = supportedFrameImages.includes('first_frame')
  const hasLast = supportedFrameImages.includes('last_frame')
  if (hasFirst) modes.push('first')
  if (hasFirst && hasLast) modes.push('first_last')
  return modes
}

export function clampVideoFrameMode(
  mode: VideoFrameMode | undefined,
  supportedFrameImages: string[]
): VideoFrameMode {
  const allowed = availableVideoFrameModes(supportedFrameImages)
  if (mode && allowed.includes(mode)) return mode
  // 首尾帧不可用时降到仅首帧（若支持）
  if (mode === 'first_last' && allowed.includes('first')) return 'first'
  return 'none'
}

export interface VideoGenerateParams {
  aspectRatio?: string
  resolution?: string
  /** 输出时长（秒） */
  duration?: number
  /** 随机种子：固定可复现；缺省由服务端随机 */
  seed?: number
  /** 是否跟随工程全局种子（默认 true；false 时用 seed） */
  seedUseGlobal?: boolean
  /** 是否生成音频（模型声明 generate_audio 时可选） */
  generateAudio?: boolean
  /** 首/尾帧控制：none | first | first_last */
  frameMode?: VideoFrameMode
}

export interface VideoGenerateParamCapabilities {
  aspectRatios: string[]
  resolutions: string[]
  durations: number[]
  /** 模型声明支持 generate_audio */
  supportsGenerateAudio: boolean
  /** OpenRouter supported_frame_images / 方舟等价：first_frame、last_frame */
  supportedFrameImages: string[]
}

export const EMPTY_VIDEO_GENERATE_CAPABILITIES: VideoGenerateParamCapabilities = {
  aspectRatios: [],
  resolutions: [],
  durations: [],
  supportsGenerateAudio: false,
  supportedFrameImages: []
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const v = raw.trim()
    if (!v || seen.has(v)) continue
    seen.add(v)
    out.push(v)
  }
  return out
}

function uniqueSortedInts(values: number[]): number[] {
  return [...new Set(values.map((n) => Math.round(n)).filter((n) => Number.isFinite(n) && n > 0))].sort(
    (a, b) => a - b
  )
}

function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return uniqueStrings(raw.map((v) => String(v)))
}

function parseDurationList(raw: unknown): number[] {
  if (!Array.isArray(raw)) return []
  return uniqueSortedInts(raw.map((v) => Number(v)))
}

function parseEnumValues(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return uniqueStrings(raw.map((v) => String(v)))
  }
  const obj = asRecord(raw)
  if (!obj) return []
  if (Array.isArray(obj.values)) {
    return uniqueStrings(obj.values.map((v) => String(v)))
  }
  return []
}

function pickPreferred(options: string[], preferred: string[]): string | undefined {
  for (const p of preferred) {
    if (options.includes(p)) return p
  }
  return options[0]
}

function pickPreferredDuration(options: number[], preferred: number[]): number | undefined {
  for (const p of preferred) {
    if (options.includes(p)) return p
  }
  return options[0]
}

/**
 * 从视频模型 catalog capabilities 解析可调参数。
 * 优先顶层 supported_*；其次 supported_parameters 内枚举。
 */
export function parseVideoGenerateParamCapabilities(
  capabilities?: Record<string, unknown> | null
): VideoGenerateParamCapabilities {
  const caps = capabilities && typeof capabilities === 'object' ? capabilities : null
  if (!caps) return { ...EMPTY_VIDEO_GENERATE_CAPABILITIES }

  const sp =
    caps.supported_parameters &&
    typeof caps.supported_parameters === 'object' &&
    !Array.isArray(caps.supported_parameters)
      ? (caps.supported_parameters as Record<string, unknown>)
      : null

  const aspectRatios = uniqueStrings([
    ...parseStringList(caps.supported_aspect_ratios),
    ...(sp ? parseEnumValues(sp.aspect_ratio ?? sp.aspectRatio) : [])
  ])
  const resolutions = uniqueStrings([
    ...parseStringList(caps.supported_resolutions),
    ...(sp ? parseEnumValues(sp.resolution) : [])
  ])
  const durations = uniqueSortedInts([
    ...parseDurationList(caps.supported_durations),
    ...(sp ? parseDurationList(sp.duration ?? sp.durations) : [])
  ])

  const generateAudioRaw = caps.generate_audio ?? sp?.generate_audio
  const supportsGenerateAudio = generateAudioRaw === true

  const supportedFrameImages = uniqueStrings([
    ...parseStringList(caps.supported_frame_images),
    ...(sp ? parseStringList(sp.supported_frame_images ?? sp.frame_images) : [])
  ]).filter((v) => v === 'first_frame' || v === 'last_frame')

  return {
    aspectRatios,
    resolutions,
    durations,
    supportsGenerateAudio,
    supportedFrameImages
  }
}

export function hasAnyVideoGenerateCapability(
  caps: VideoGenerateParamCapabilities
): boolean {
  return (
    caps.aspectRatios.length > 0 ||
    caps.resolutions.length > 0 ||
    caps.durations.length > 0 ||
    caps.supportsGenerateAudio ||
    (caps.supportedFrameImages?.length ?? 0) > 0
  )
}

export function clampVideoGenerateParams(
  params: VideoGenerateParams,
  caps: VideoGenerateParamCapabilities
): VideoGenerateParams {
  const next: VideoGenerateParams = { ...params }

  if (caps.aspectRatios.length) {
    if (!next.aspectRatio || !caps.aspectRatios.includes(next.aspectRatio)) {
      next.aspectRatio =
        pickPreferred(caps.aspectRatios, ['16:9', '9:16', '1:1']) ?? caps.aspectRatios[0]
    }
  } else {
    next.aspectRatio = undefined
  }

  if (caps.resolutions.length) {
    if (!next.resolution || !caps.resolutions.includes(next.resolution)) {
      next.resolution =
        pickPreferred(caps.resolutions, ['1080p', '720p', '2K', '1K']) ?? caps.resolutions[0]
    }
  } else {
    next.resolution = undefined
  }

  if (caps.durations.length) {
    if (next.duration == null || !caps.durations.includes(next.duration)) {
      next.duration = pickPreferredDuration(caps.durations, [5, 4, 6, 8, 10]) ?? caps.durations[0]
    }
  } else {
    next.duration = undefined
  }

  if (caps.supportsGenerateAudio) {
    if (typeof next.generateAudio !== 'boolean') {
      next.generateAudio = true
    }
  } else {
    next.generateAudio = undefined
  }

  const frameImages = caps.supportedFrameImages ?? []
  if (frameImages.length) {
    next.frameMode = clampVideoFrameMode(next.frameMode, frameImages)
  } else {
    next.frameMode = 'none'
  }

  return next
}

function parseFrameMode(raw: unknown): VideoFrameMode | undefined {
  if (raw === 'none' || raw === 'first' || raw === 'first_last') return raw
  return undefined
}

export function readVideoGenerateParamsFromNode(params: {
  generateAspectRatio?: string
  generateResolution?: string
  generateDuration?: number
  generateSeed?: number
  generateSeedUseGlobal?: boolean
  generateAudio?: boolean
  generateFrameMode?: string
}): VideoGenerateParams {
  const durationRaw = params.generateDuration
  const duration =
    typeof durationRaw === 'number' && Number.isFinite(durationRaw) && durationRaw > 0
      ? Math.round(durationRaw)
      : undefined
  return {
    aspectRatio: params.generateAspectRatio?.trim() || undefined,
    resolution: params.generateResolution?.trim() || undefined,
    duration,
    seed: clampSeed(params.generateSeed),
    seedUseGlobal: params.generateSeedUseGlobal !== false,
    generateAudio: typeof params.generateAudio === 'boolean' ? params.generateAudio : undefined,
    frameMode: parseFrameMode(params.generateFrameMode) ?? 'none'
  }
}

export function videoGenerateParamsToNodePatch(params: VideoGenerateParams): {
  generateAspectRatio: string
  generateResolution: string
  generateDuration: number | undefined
  generateSeed?: number
  generateSeedUseGlobal?: boolean
  generateAudio: boolean | undefined
  generateFrameMode: VideoFrameMode
} {
  return {
    generateAspectRatio: params.aspectRatio ?? '',
    generateResolution: params.resolution ?? '',
    generateDuration: params.duration,
    ...(clampSeed(params.seed) != null ? { generateSeed: clampSeed(params.seed) } : {}),
    generateSeedUseGlobal: params.seedUseGlobal !== false,
    generateAudio: params.generateAudio,
    generateFrameMode: params.frameMode ?? 'none'
  }
}

/**
 * 执行前解析视频参数：有能力表则 clamp；无能力时保留节点已写值。
 */
export function resolveVideoGenerateParamsForApi(
  params: {
    generateAspectRatio?: string
    generateResolution?: string
    generateDuration?: number
    generateSeed?: number
    generateSeedUseGlobal?: boolean
    generateAudio?: boolean
    generateFrameMode?: string
  },
  caps?: VideoGenerateParamCapabilities | null
): VideoGenerateParams {
  const raw = readVideoGenerateParamsFromNode(params)
  if (!caps || !hasAnyVideoGenerateCapability(caps)) return raw
  return clampVideoGenerateParams(raw, caps)
}
