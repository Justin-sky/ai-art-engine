/**
 * 图片生成节点参数（对齐 OpenRouter /api/v1/images）。
 * UI 按模型 `supported_parameters` 动态显示可选值。
 */

export interface ImageGenerateParams {
  aspectRatio?: string
  resolution?: string
  quality?: string
  /** 生成张数 n */
  count?: number
}

export interface ImageGenerateParamCapabilities {
  aspectRatios: string[]
  resolutions: string[]
  qualities: string[]
  counts: number[]
  /**
   * 模型允许的 `input_references` 数量上限。
   * 未声明时为 undefined，执行侧回退到 DEFAULT_MAX_INPUT_REFERENCES。
   */
  maxInputReferences?: number
}

/** OpenRouter 文档示例 / 历史硬编码上限 */
export const DEFAULT_MAX_INPUT_REFERENCES = 14

/** 无目录能力时的常见回退（与参考 UI 一致） */
export const DEFAULT_IMAGE_GENERATE_CAPABILITIES: ImageGenerateParamCapabilities = {
  qualities: ['low', 'medium', 'high'],
  resolutions: ['1K', '2K', '4K'],
  aspectRatios: [
    '1:1',
    '1:2',
    '2:1',
    '9:16',
    '16:9',
    '3:4',
    '4:3',
    '3:2',
    '2:3',
    '5:4',
    '4:5',
    '21:9',
    '9:21'
  ],
  counts: [1, 2, 4],
  maxInputReferences: DEFAULT_MAX_INPUT_REFERENCES
}

const PREFERRED_COUNTS = [1, 2, 4]

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function parseEnumValues(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((v) => String(v).trim()).filter(Boolean)
  }
  const obj = asRecord(raw)
  if (!obj) return []
  const values = obj.values
  if (Array.isArray(values)) {
    return values.map((v) => String(v).trim()).filter(Boolean)
  }
  return []
}

function parseCountOptions(raw: unknown): number[] {
  if (typeof raw === 'boolean') {
    return raw ? PREFERRED_COUNTS.slice() : []
  }
  if (Array.isArray(raw)) {
    return uniqueSortedInts(raw.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 1))
  }
  const obj = asRecord(raw)
  if (!obj) return []
  if (Array.isArray(obj.values)) {
    return uniqueSortedInts(
      obj.values.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n >= 1)
    )
  }
  const min = Number(obj.min ?? 1)
  const max = Number(obj.max ?? 1)
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < 1) return []
  const lo = Math.max(1, Math.floor(min))
  const hi = Math.max(lo, Math.floor(max))
  const preferred = PREFERRED_COUNTS.filter((n) => n >= lo && n <= hi)
  if (preferred.length) {
    if (!preferred.includes(hi) && hi > preferred[preferred.length - 1]!) {
      return [...preferred, hi]
    }
    return preferred
  }
  const out: number[] = []
  for (let n = lo; n <= Math.min(hi, lo + 7); n++) out.push(n)
  return out
}

function uniqueSortedInts(values: number[]): number[] {
  return [...new Set(values.map((n) => Math.floor(n)))].sort((a, b) => a - b)
}

/**
 * 解析 `input_references` 能力：
 * - `{ type: 'range', min, max }` → max
 * - `true` / `{ type: 'boolean' }` → 支持但未知上限，回退默认
 * - `false` → 0
 */
export function parseInputReferencesMax(raw: unknown): number | undefined {
  if (raw == null) return undefined
  if (typeof raw === 'boolean') return raw ? DEFAULT_MAX_INPUT_REFERENCES : 0
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw)
  }
  const obj = asRecord(raw)
  if (!obj) return undefined
  if (obj.type === 'boolean') return DEFAULT_MAX_INPUT_REFERENCES
  const max = Number(obj.max)
  if (Number.isFinite(max) && max >= 0) return Math.floor(max)
  return undefined
}

/** 执行侧：取模型参考图上限；未知时回退默认 */
export function resolveMaxInputReferences(
  caps?: Pick<ImageGenerateParamCapabilities, 'maxInputReferences'> | null
): number {
  const max = caps?.maxInputReferences
  if (typeof max === 'number' && Number.isFinite(max) && max >= 0) {
    return Math.floor(max)
  }
  return DEFAULT_MAX_INPUT_REFERENCES
}

/** 归一化 quality：standard → medium */
export function normalizeImageQuality(value: string | undefined): string {
  const raw = value?.trim().toLowerCase() ?? ''
  if (!raw) return ''
  if (raw === 'standard') return 'medium'
  return raw
}

/**
 * 从 OpenRouter 图片模型 `supported_parameters` 解析可选控件。
 * 某字段不在 capabilities 中则对应数组为空（UI 隐藏该段）。
 */
export function parseImageGenerateCapabilities(
  supportedParameters: unknown
): ImageGenerateParamCapabilities {
  const sp = asRecord(supportedParameters)
  if (!sp) {
    return { aspectRatios: [], resolutions: [], qualities: [], counts: [] }
  }

  const aspectRatios = parseEnumValues(sp.aspect_ratio ?? sp.aspectRatio)
  const resolutions = parseEnumValues(sp.resolution)
  const qualities = parseEnumValues(sp.quality).map((q) => normalizeImageQuality(q) || q)
  const counts = parseCountOptions(sp.n)
  const maxInputReferences = parseInputReferencesMax(
    sp.input_references ?? sp.inputReferences
  )

  return {
    aspectRatios: uniqueStrings(aspectRatios),
    resolutions: uniqueStrings(resolutions),
    qualities: uniqueStrings(qualities),
    counts,
    ...(maxInputReferences != null ? { maxInputReferences } : {})
  }
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of values) {
    const key = v.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  return out
}

export function hasAnyImageGenerateCapability(caps: ImageGenerateParamCapabilities): boolean {
  return (
    caps.aspectRatios.length > 0 ||
    caps.resolutions.length > 0 ||
    caps.qualities.length > 0 ||
    caps.counts.length > 0
  )
}

/** 将已存参数钳制到当前模型能力内；无能力时保留原值 */
export function clampImageGenerateParams(
  params: ImageGenerateParams,
  caps: ImageGenerateParamCapabilities
): ImageGenerateParams {
  const next: ImageGenerateParams = { ...params }
  if (caps.aspectRatios.length) {
    if (!next.aspectRatio || !caps.aspectRatios.includes(next.aspectRatio)) {
      next.aspectRatio =
        pickPreferred(caps.aspectRatios, ['16:9', '1:1']) ?? caps.aspectRatios[0]
    }
  }
  if (caps.resolutions.length) {
    if (!next.resolution || !caps.resolutions.includes(next.resolution)) {
      next.resolution = pickPreferred(caps.resolutions, ['2K', '1K', '4K']) ?? caps.resolutions[0]
    }
  }
  if (caps.qualities.length) {
    const q = normalizeImageQuality(next.quality)
    if (!q || !caps.qualities.includes(q)) {
      next.quality = pickPreferred(caps.qualities, ['medium', 'high', 'low', 'auto']) ?? caps.qualities[0]
    } else {
      next.quality = q
    }
  }
  if (caps.counts.length) {
    if (next.count == null || !caps.counts.includes(next.count)) {
      next.count = pickPreferredNum(caps.counts, [1, 2, 4]) ?? caps.counts[0]
    }
  }
  return next
}

function pickPreferred(options: string[], preferred: string[]): string | undefined {
  for (const p of preferred) {
    if (options.includes(p)) return p
  }
  return undefined
}

function pickPreferredNum(options: number[], preferred: number[]): number | undefined {
  for (const p of preferred) {
    if (options.includes(p)) return p
  }
  return undefined
}

export function readImageGenerateParamsFromNode(params: {
  generateAspectRatio?: string
  generateResolution?: string
  generateQuality?: string
  generateCount?: number
}): ImageGenerateParams {
  return {
    aspectRatio: params.generateAspectRatio?.trim() || undefined,
    resolution: params.generateResolution?.trim() || undefined,
    quality: normalizeImageQuality(params.generateQuality) || undefined,
    count:
      typeof params.generateCount === 'number' && params.generateCount >= 1
        ? Math.floor(params.generateCount)
        : undefined
  }
}

/**
 * 执行前解析图片参数：缺省时用默认能力表填入（16:9 / 2K / medium / 1），
 * 保证请求与日志始终带上完整参数。
 */
export function resolveImageGenerateParamsForApi(
  params: {
    generateAspectRatio?: string
    generateResolution?: string
    generateQuality?: string
    generateCount?: number
  },
  caps: ImageGenerateParamCapabilities = DEFAULT_IMAGE_GENERATE_CAPABILITIES
): ImageGenerateParams {
  return clampImageGenerateParams(readImageGenerateParamsFromNode(params), caps)
}

export function imageGenerateParamsToNodePatch(params: ImageGenerateParams): {
  generateAspectRatio: string
  generateResolution: string
  generateQuality: string
  generateCount?: number
} {
  return {
    generateAspectRatio: params.aspectRatio ?? '',
    generateResolution: params.resolution ?? '',
    generateQuality: params.quality ?? '',
    ...(params.count != null && params.count >= 1 ? { generateCount: Math.floor(params.count) } : {})
  }
}
