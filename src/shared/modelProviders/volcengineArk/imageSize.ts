/**
 * Seedream 图片 `size` 参数换算。
 *
 * 火山方舟 /images/generations 的 `size` 只接受两种写法：
 * 1. 分辨率关键字（如 2K / 4K）：模型自行决定宽高比；
 * 2. 像素宽高（如 2048x2048、2560x1440）：宽高比由像素决定。
 *
 * 应用内节点同时持有 resolution + aspectRatio；若把 `2K` 直接下发，
 * 模型不会遵循 16:9 等比例；若把 `16:9` 直接下发，接口不识别该值。
 * 因此这里把两者合并成像素宽高，保证「分辨率 + 宽高比」都被模型遵循。
 */

/** 分辨率档位 → 基准边长（1K=1024、2K=2048…） */
const SEEDREAM_TIER_BASE_PIXELS: Readonly<Record<string, number>> = {
  '1K': 1024,
  '2K': 2048,
  '3K': 3072,
  '4K': 4096
}

/** 通用分辨率档位（各 Seedream 型号只支持其中子集，见 modelCapabilities.json） */
export const SEEDREAM_RESOLUTION_TIERS: readonly string[] = ['1K', '2K', '3K', '4K']

/** 官方 2K 推荐像素表（宽×高），Seedream 3/4/4.5/5 通用 */
const SEEDREAM_2K_PRESETS: Readonly<Record<string, { width: number; height: number }>> = {
  '1:1': { width: 2048, height: 2048 },
  '4:3': { width: 2304, height: 1728 },
  '3:4': { width: 1728, height: 2304 },
  '3:2': { width: 2496, height: 1664 },
  '2:3': { width: 1664, height: 2496 },
  '16:9': { width: 2560, height: 1440 },
  '9:16': { width: 1440, height: 2560 },
  '21:9': { width: 3024, height: 1296 },
  '9:21': { width: 1296, height: 3024 }
}

/** 官方 4K 推荐像素表（Seedream 4.0 / 4.5 文档值） */
const SEEDREAM_4K_PRESETS: Readonly<Record<string, { width: number; height: number }>> = {
  '1:1': { width: 4096, height: 4096 },
  '4:3': { width: 4694, height: 3520 },
  '3:4': { width: 3520, height: 4694 },
  '3:2': { width: 4992, height: 3328 },
  '2:3': { width: 3328, height: 4992 },
  '16:9': { width: 5404, height: 3040 },
  '9:16': { width: 3040, height: 5404 },
  '21:9': { width: 6198, height: 2656 },
  '9:21': { width: 2656, height: 6198 }
}

/** Seedream 4.5 / 5 等要求的总像素下限（2560×1440 = 3686400） */
export const SEEDREAM_MIN_PIXELS = 3_686_400

function normalizeResolution(value: string | undefined): string | null {
  const raw = value?.trim()
  if (!raw) return null
  // 已是像素宽高：统一成 2048x2048 形式
  const pixel = /^(\d+)\s*[xX×*]\s*(\d+)$/.exec(raw)
  if (pixel) {
    const width = Number(pixel[1])
    const height = Number(pixel[2])
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      return `${width}x${height}`
    }
  }
  const upper = raw.toUpperCase()
  if (SEEDREAM_TIER_BASE_PIXELS[upper] != null) return upper
  // 无法识别时原样返回，由调用方决定是否透传
  return raw
}

function normalizeRatio(value: string | undefined): string | null {
  const raw = value?.trim().replace(/\s+/g, '')
  if (!raw) return null
  const m = /^(\d+):(\d+)$/.exec(raw)
  if (!m) return null
  const width = Number(m[1])
  const height = Number(m[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }
  return `${width}:${height}`
}

function scalePreset(
  preset: { width: number; height: number },
  scale: number
): { width: number; height: number } {
  return {
    width: Math.round(preset.width * scale),
    height: Math.round(preset.height * scale)
  }
}

/** 非官方预设比例：按“分辨率档位总像素 ≈ base²”反推宽高，保证比例一致 */
function genericSize(base: number, ratioWidth: number, ratioHeight: number): string {
  const aspect = ratioWidth / ratioHeight
  let width = Math.round(Math.sqrt(base * base * aspect))
  let height = Math.round(width / aspect)
  width = Math.max(1, width)
  height = Math.max(1, height)
  return `${width}x${height}`
}

/** 面积不足下限时按比例放大，保持宽高比不变 */
function enforceMinPixels(
  width: number,
  height: number,
  minPixels: number | undefined
): { width: number; height: number } {
  if (!minPixels || minPixels <= 0) return { width, height }
  const area = width * height
  if (area >= minPixels) return { width, height }
  const factor = Math.sqrt(minPixels / area)
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor))
  }
}

function enforceSizeString(size: string, minPixels: number | undefined): string {
  const m = /^(\d+)x(\d+)$/.exec(size)
  if (!m) return size
  const width = Number(m[1])
  const height = Number(m[2])
  const enforced = enforceMinPixels(width, height, minPixels)
  if (enforced.width === width && enforced.height === height) return size
  return `${enforced.width}x${enforced.height}`
}

/**
 * 把应用内的分辨率 + 宽高比换算为 Seedream `size` 像素值。
 *
 * - resolution 已是像素宽高：原样返回；
 * - 分辨率 + 宽高比均在官方表内：返回官方像素；
 * - 1K / 3K 无官方全量表：按 2K 官方表等比缩放；
 * - 仅给宽高比：按 2K 档位取像素；
 * - 提供 minPixels 时，面积不足下限按比例放大（如 Seedream 4.5/5 的 3686400）；
 * - 无法换算：回退返回分辨率关键字（合法的方式 1），彻底无法识别时返回 undefined。
 */
export function resolveSeedreamImageSize(
  resolution: string | undefined,
  aspectRatio: string | undefined,
  minPixels?: number
): string | undefined {
  const res = normalizeResolution(resolution)
  const ratio = normalizeRatio(aspectRatio)
  const ratioPair = ratio?.split(':').map(Number) as [number, number] | undefined

  // 已明确指定像素宽高：透传（面积不足下限时按比例放大）
  if (res && /^\d+x\d+$/.test(res)) {
    const [w, h] = res.split('x').map(Number) as [number, number]
    const enforced = enforceMinPixels(w, h, minPixels)
    if (enforced.width === w && enforced.height === h) return res
    return `${enforced.width}x${enforced.height}`
  }

  const base = res ? SEEDREAM_TIER_BASE_PIXELS[res] : undefined
  if (base != null) {
    if (ratio) {
      const table = res === '4K' ? SEEDREAM_4K_PRESETS : SEEDREAM_2K_PRESETS
      const preset = table[ratio]
      if (preset) {
        const scale = res === '4K' ? 1 : base / 2048
        let size = scale === 1 ? preset : scalePreset(preset, scale)
        // 低于模型像素下限时（如 1K），直接抬到 2K 官方表，保持推荐尺寸
        if (minPixels && size.width * size.height < minPixels) {
          const lifted = SEEDREAM_2K_PRESETS[ratio]
          if (lifted) size = lifted
        }
        return `${size.width}x${size.height}`
      }
      if (ratioPair) return enforceSizeString(genericSize(base, ratioPair[0], ratioPair[1]), minPixels)
    }
    // 只有分辨率：保留关键字写法，由模型按提示词定比例
    return res ?? undefined
  }

  // 分辨率未识别但给了宽高比：按 2K 档位换算，至少保证比例生效
  if (ratio) {
    const preset = SEEDREAM_2K_PRESETS[ratio]
    if (preset) return enforceSizeString(`${preset.width}x${preset.height}`, minPixels)
    if (ratioPair) return enforceSizeString(genericSize(2048, ratioPair[0], ratioPair[1]), minPixels)
  }

  // 分辨率未识别且无宽高比：保留原值（由上层决定是否下发）
  return res ?? undefined
}

/**
 * 校验显式分辨率档位：像素宽高或已知档位（1K/2K/3K/4K）放行，
 * 其余值（如 "512" / "low"）直接报错并给出模型可选档位。
 *
 * 背景：不同 Seedream 型号支持档位不同（5.0 仅 2K/3K/4K，4.5 仅 2K/4K，
 * 3.x 仅 1K/2K）。若用户明确指定了模型不认识的档位，此前会静默按 2K 出图，
 * 导致「要求最低分辨率 512，实际得到 2048×2048」且无任何提示。
 * 已知档位但模型不支持（如 1K on Seedream 5.0）仍交由调用方宽容抬升到最低档，
 * 以兼容节点图 UI 的 1K/2K/4K 档位选项。
 */
export function assertSeedreamResolutionSupported(
  modelId: string,
  resolution: string | undefined,
  allowedValues?: readonly string[] | null
): void {
  const res = normalizeResolution(resolution)
  if (!res) return
  if (/^\d+x\d+$/.test(res)) return
  if (SEEDREAM_RESOLUTION_TIERS.includes(res)) return
  // cjk-ok：错误消息面向 dsh/用户的本地化文案，与错误目录（catalog）同属双语域
  const hint = allowedValues?.length
    ? `该模型可选：${allowedValues.join(' / ')}` // cjk-ok
    : `可选：${SEEDREAM_RESOLUTION_TIERS.join(' / ')}` // cjk-ok
  throw new Error(`模型 ${modelId} 不支持分辨率档位 "${resolution}"，${hint}`) // cjk-ok
}
