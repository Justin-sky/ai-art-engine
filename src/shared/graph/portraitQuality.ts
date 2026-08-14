import { normalizePortraitTexture } from './portraitTexture'

/** 专业人像质量参数引擎：连续参数 + 规格 + 预设 + 结构化提示词合成。 */

export type PortraitQualityGroup = 'skin' | 'light' | 'blend' | 'color' | 'detail'
export type PortraitQualityExecutor = 'local' | 'generative'

export interface PortraitQualityState {
  /** 磨皮强度 0-100 */
  skinSmoothing: number
  /** 毛孔保留 0-100 */
  skinPore: number
  /** 肤色均匀 0-100 */
  skinEvenness: number
  /** 瑕疵移除 0-100 */
  blemishRemoval: number
  /** 主光比 0-100 */
  lightRatio: number
  /** 补光 0-100 */
  fillLight: number
  /** 轮廓光 0-100 */
  rimLight: number
  /** 眼神光 0-100 */
  catchlight: number
  /** 氛围强度 0-100 */
  atmosphere: number
  /** 人景融合 0-100 */
  personSceneBlend: number
  /** 边缘过渡 0-100 */
  edgeTransition: number
  /** 色温 -100（冷）..100（暖） */
  colorTemp: number
  /** 饱和度 -100..100 */
  saturation: number
  /** 对比度 -100..100 */
  contrast: number
  /** 肤色调 -100（冷）..100（暖） */
  skinTone: number
  /** 锐度 0-100 */
  sharpness: number
  /** 颗粒 0-100 */
  grain: number
  /** 柔焦 0-100 */
  softFocus: number
  /** 局部对比 / 清晰度 0-100 */
  clarity: number
  /** 暗角 0-100 */
  vignette: number
}

export type PortraitQualityParamKey = keyof PortraitQualityState

export interface PortraitQualityParamSpec {
  key: PortraitQualityParamKey
  group: PortraitQualityGroup
  labelKey: string
  min: number
  max: number
  step: number
  default: number
  executor: PortraitQualityExecutor
  /** 生成式参数：值 → 提示词片段（本地参数留空，走确定性预览） */
  promptTemplate?: (value: number) => string
}

function level(value: number): string {
  if (value >= 68) return '强烈'
  if (value >= 38) return '明显'
  if (value >= 14) return '适度'
  return '轻微'
}

function bipolar(value: number, neg: string, pos: string): string {
  if (value > 12) return `${pos}${level(Math.abs(value))}`
  if (value < -12) return `${neg}${level(Math.abs(value))}`
  return ''
}

export const PORTRAIT_QUALITY_PARAMS: readonly PortraitQualityParamSpec[] = [
  { key: 'skinSmoothing', group: 'skin', labelKey: 'skinSmoothing', min: 0, max: 100, step: 1, default: 20, executor: 'local' },
  { key: 'skinPore', group: 'skin', labelKey: 'skinPore', min: 0, max: 100, step: 1, default: 60, executor: 'local' },
  { key: 'skinEvenness', group: 'skin', labelKey: 'skinEvenness', min: 0, max: 100, step: 1, default: 25, executor: 'local' },
  { key: 'blemishRemoval', group: 'skin', labelKey: 'blemishRemoval', min: 0, max: 100, step: 1, default: 20, executor: 'local' },
  { key: 'lightRatio', group: 'light', labelKey: 'lightRatio', min: 0, max: 100, step: 1, default: 50, executor: 'generative', promptTemplate: (v) => (v <= 34 ? '柔光比' : v >= 66 ? '强光比' : '自然光比') },
  { key: 'fillLight', group: 'light', labelKey: 'fillLight', min: 0, max: 100, step: 1, default: 40, executor: 'generative', promptTemplate: (v) => (v >= 55 ? `${level(v)}补光` : '') },
  { key: 'rimLight', group: 'light', labelKey: 'rimLight', min: 0, max: 100, step: 1, default: 25, executor: 'generative', promptTemplate: (v) => (v >= 20 ? `${level(v)}轮廓光` : '') },
  { key: 'catchlight', group: 'light', labelKey: 'catchlight', min: 0, max: 100, step: 1, default: 30, executor: 'generative', promptTemplate: (v) => (v >= 20 ? `${level(v)}眼神光` : '') },
  { key: 'atmosphere', group: 'light', labelKey: 'atmosphere', min: 0, max: 100, step: 1, default: 20, executor: 'generative', promptTemplate: (v) => (v >= 15 ? `${level(v)}氛围感` : '') },
  { key: 'personSceneBlend', group: 'blend', labelKey: 'personSceneBlend', min: 0, max: 100, step: 1, default: 50, executor: 'generative', promptTemplate: (v) => (v <= 30 ? '人景轻度融合' : v >= 70 ? '人景深度融合' : '人景自然融合') },
  { key: 'edgeTransition', group: 'blend', labelKey: 'edgeTransition', min: 0, max: 100, step: 1, default: 50, executor: 'generative', promptTemplate: (v) => (v <= 34 ? '边缘清晰过渡' : v >= 66 ? '边缘柔和过渡' : '边缘自然过渡') },
  { key: 'colorTemp', group: 'color', labelKey: 'colorTemp', min: -100, max: 100, step: 1, default: 0, executor: 'local' },
  { key: 'saturation', group: 'color', labelKey: 'saturation', min: -100, max: 100, step: 1, default: 0, executor: 'local' },
  { key: 'contrast', group: 'color', labelKey: 'contrast', min: -100, max: 100, step: 1, default: 0, executor: 'local' },
  { key: 'skinTone', group: 'color', labelKey: 'skinTone', min: -100, max: 100, step: 1, default: 0, executor: 'local' },
  { key: 'sharpness', group: 'detail', labelKey: 'sharpness', min: 0, max: 100, step: 1, default: 40, executor: 'local' },
  { key: 'grain', group: 'detail', labelKey: 'grain', min: 0, max: 100, step: 1, default: 0, executor: 'local' },
  { key: 'softFocus', group: 'detail', labelKey: 'softFocus', min: 0, max: 100, step: 1, default: 0, executor: 'local' },
  { key: 'clarity', group: 'detail', labelKey: 'clarity', min: 0, max: 100, step: 1, default: 15, executor: 'local' },
  { key: 'vignette', group: 'detail', labelKey: 'vignette', min: 0, max: 100, step: 1, default: 0, executor: 'local' }
]

export const DEFAULT_PORTRAIT_QUALITY: PortraitQualityState = Object.fromEntries(
  PORTRAIT_QUALITY_PARAMS.map((p) => [p.key, p.default])
) as unknown as PortraitQualityState

export interface PortraitQualityPreset {
  id: string
  labelKey: string
  state: PortraitQualityState
}

export const PORTRAIT_QUALITY_PRESETS: readonly PortraitQualityPreset[] = [
  {
    id: 'natural',
    labelKey: 'natural',
    state: { ...DEFAULT_PORTRAIT_QUALITY }
  },
  {
    id: 'magazine',
    labelKey: 'magazine',
    state: {
      ...DEFAULT_PORTRAIT_QUALITY,
      skinSmoothing: 45,
      skinEvenness: 45,
      sharpness: 65,
      clarity: 45,
      saturation: 12,
      colorTemp: 8
    }
  },
  {
    id: 'commercial',
    labelKey: 'commercial',
    state: {
      ...DEFAULT_PORTRAIT_QUALITY,
      skinSmoothing: 75,
      skinEvenness: 70,
      blemishRemoval: 65,
      sharpness: 75,
      clarity: 60,
      saturation: 25,
      contrast: 18
    }
  },
  {
    id: 'cinematic',
    labelKey: 'cinematic',
    state: {
      ...DEFAULT_PORTRAIT_QUALITY,
      atmosphere: 55,
      lightRatio: 68,
      contrast: 30,
      colorTemp: 14,
      grain: 18,
      vignette: 22,
      saturation: -8
    }
  },
  {
    id: 'retro',
    labelKey: 'retro',
    state: {
      ...DEFAULT_PORTRAIT_QUALITY,
      colorTemp: 28,
      skinTone: 22,
      grain: 32,
      softFocus: 22,
      saturation: -18,
      contrast: -6,
      vignette: 28
    }
  }
]

export function normalizePortraitQuality(
  raw?: Partial<PortraitQualityState> | null
): PortraitQualityState {
  const base = { ...DEFAULT_PORTRAIT_QUALITY, ...(raw ?? {}) }
  const out: Partial<Record<PortraitQualityParamKey, number>> = {}
  for (const p of PORTRAIT_QUALITY_PARAMS) {
    const value = Number(base[p.key])
    out[p.key] = Number.isFinite(value)
      ? Math.min(p.max, Math.max(p.min, value))
      : p.default
  }
  return out as PortraitQualityState
}

/** 生成式参数 → 提示词（忽略接近默认值、无模板的本地参数） */
function generativePrompt(state: PortraitQualityState): string[] {
  const parts: string[] = []
  for (const p of PORTRAIT_QUALITY_PARAMS) {
    if (p.executor !== 'generative' || !p.promptTemplate) continue
    const value = state[p.key]
    const clause = p.promptTemplate(value).trim()
    if (clause) parts.push(clause)
  }
  return parts
}

/** 本地参数 → 提示词提示（用于生成时近似，预览走确定性渲染） */
function localPromptHints(state: PortraitQualityState): string[] {
  const hints: string[] = []
  if (state.skinSmoothing >= 45) hints.push(`${level(state.skinSmoothing)}磨皮`)
  if (state.skinEvenness >= 45) hints.push('肤色均匀')
  if (state.blemishRemoval >= 45) hints.push('瑕疵移除')
  if (state.sharpness >= 60) hints.push(`${level(state.sharpness)}锐化`)
  if (state.grain >= 20) hints.push(`${level(state.grain)}胶片颗粒`)
  if (state.softFocus >= 30) hints.push('柔焦')
  if (state.vignette >= 20) hints.push('轻微暗角')
  const c = bipolar(state.colorTemp, '冷色温', '暖色温')
  const s = bipolar(state.saturation, '降低饱和度', '提高饱和度')
  const k = bipolar(state.contrast, '低对比', '高对比')
  const t = bipolar(state.skinTone, '冷调肤色', '暖调肤色')
  for (const h of [c, s, k, t]) if (h) hints.push(h)
  return hints
}

export interface PortraitQualityPrompt {
  main: string
  negative: string
}

export function buildPortraitQualityPrompt(state: PortraitQualityState): PortraitQualityPrompt {
  const s = normalizePortraitQuality(state)
  const main = [...generativePrompt(s), ...localPromptHints(s)].join('，')
  const negative: string[] = []
  if (s.skinSmoothing >= 70 || s.softFocus >= 60) {
    negative.push('过度磨皮', '塑料感', '五官变形')
  }
  if (s.grain >= 50) negative.push('噪点过重')
  return { main, negative: negative.join('，') }
}

export function resolvePortraitQualityOutputPrompt(state: PortraitQualityState): string {
  return buildPortraitQualityPrompt(state).main
}

export function readPortraitQualityFromNode(params: {
  portraitQuality?: Partial<PortraitQualityState>
  portraitTexture?: object
}): PortraitQualityState {
  if (params.portraitQuality) return normalizePortraitQuality(params.portraitQuality)
  return portraitQualityFromLegacy(params.portraitTexture)
}

/** 旧五维离散档位 → 连续参数（向后兼容迁移） */
function portraitQualityFromLegacy(raw?: object): PortraitQualityState {
  const legacy = normalizePortraitTexture(raw as Parameters<typeof normalizePortraitTexture>[0])
  const state = { ...DEFAULT_PORTRAIT_QUALITY }
  state.personSceneBlend =
    legacy.personScene === 'light' ? 25 : legacy.personScene === 'deep' ? 75 : 50
  state.fillLight = legacy.lightShadow === 'softFill' ? 70 : legacy.lightShadow === 'atmosphere' ? 30 : 40
  state.atmosphere = legacy.lightShadow === 'atmosphere' ? 60 : 20
  state.skinSmoothing = legacy.skin === 'clear' ? 55 : legacy.skin === 'real' ? 8 : 20
  state.skinEvenness = legacy.skin === 'clear' ? 60 : 25
  state.skinPore = legacy.skin === 'real' ? 90 : legacy.skin === 'clear' ? 35 : 60
  state.grain = legacy.texture === 'grain' ? 30 : 0
  state.softFocus = legacy.texture === 'soft' ? 30 : 0
  state.sharpness = legacy.sharpness === 'softFocus' ? 8 : legacy.sharpness === 'hd' ? 80 : 40
  state.clarity = legacy.sharpness === 'hd' ? 55 : 15
  return normalizePortraitQuality(state)
}

export function portraitQualityToNodePatch(state: PortraitQualityState): {
  portraitQuality: PortraitQualityState
  portraitQualityPrompt: string
  portraitQualityNegative: string
} {
  const normalized = normalizePortraitQuality(state)
  const prompt = buildPortraitQualityPrompt(normalized)
  return {
    portraitQuality: normalized,
    portraitQualityPrompt: prompt.main,
    portraitQualityNegative: prompt.negative
  }
}
