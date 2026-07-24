/**
 * 人像质感调节：五维分段选项 ↔ 提示词。
 */

export type PortraitBlendLevel = 'light' | 'natural' | 'deep'
export type PortraitLightMatchLevel = 'softFill' | 'natural' | 'atmosphere'
export type PortraitSkinLevel = 'clear' | 'natural' | 'real'
export type PortraitTextureLevel = 'soft' | 'natural' | 'grain'
export type PortraitSharpnessLevel = 'softFocus' | 'standard' | 'hd'

export interface PortraitTextureState {
  /** 人景融合 */
  personScene: PortraitBlendLevel
  /** 光影融合 */
  lightShadow: PortraitLightMatchLevel
  /** 皮肤 */
  skin: PortraitSkinLevel
  /** 纹理 */
  texture: PortraitTextureLevel
  /** 锐度 */
  sharpness: PortraitSharpnessLevel
}

export type PortraitTextureField = keyof PortraitTextureState

export interface PortraitTextureOptionDef<T extends string> {
  id: T
  /** i18n key suffix under graph.portraitTexture.options.<field>.* */
  titleKey: string
  prompt: string
}

export const PORTRAIT_PERSON_SCENE_OPTIONS: readonly PortraitTextureOptionDef<PortraitBlendLevel>[] =
  [
    { id: 'light', titleKey: 'light', prompt: '人景轻度对齐' },
    { id: 'natural', titleKey: 'natural', prompt: '人景自然融合' },
    { id: 'deep', titleKey: 'deep', prompt: '人景深度融合' }
  ] as const

export const PORTRAIT_LIGHT_SHADOW_OPTIONS: readonly PortraitTextureOptionDef<PortraitLightMatchLevel>[] =
  [
    { id: 'softFill', titleKey: 'softFill', prompt: '柔和补光光影融合' },
    { id: 'natural', titleKey: 'natural', prompt: '光影自然匹配' },
    { id: 'atmosphere', titleKey: 'atmosphere', prompt: '光影氛围强化' }
  ] as const

export const PORTRAIT_SKIN_OPTIONS: readonly PortraitTextureOptionDef<PortraitSkinLevel>[] = [
  { id: 'clear', titleKey: 'clear', prompt: '清透修饰肤质' },
  { id: 'natural', titleKey: 'natural', prompt: '自然肤质' },
  { id: 'real', titleKey: 'real', prompt: '真实肌理肤质' }
] as const

export const PORTRAIT_TEXTURE_OPTIONS: readonly PortraitTextureOptionDef<PortraitTextureLevel>[] = [
  { id: 'soft', titleKey: 'soft', prompt: '柔和纹理' },
  { id: 'natural', titleKey: 'natural', prompt: '自然纹理' },
  { id: 'grain', titleKey: 'grain', prompt: '颗粒质感纹理' }
] as const

export const PORTRAIT_SHARPNESS_OPTIONS: readonly PortraitTextureOptionDef<PortraitSharpnessLevel>[] =
  [
    { id: 'softFocus', titleKey: 'softFocus', prompt: '柔焦' },
    { id: 'standard', titleKey: 'standard', prompt: '标准清晰' },
    { id: 'hd', titleKey: 'hd', prompt: '高清锐化' }
  ] as const

export const PORTRAIT_TEXTURE_FIELDS: readonly {
  field: PortraitTextureField
  labelKey: string
  options:
    | typeof PORTRAIT_PERSON_SCENE_OPTIONS
    | typeof PORTRAIT_LIGHT_SHADOW_OPTIONS
    | typeof PORTRAIT_SKIN_OPTIONS
    | typeof PORTRAIT_TEXTURE_OPTIONS
    | typeof PORTRAIT_SHARPNESS_OPTIONS
}[] = [
  { field: 'personScene', labelKey: 'personScene', options: PORTRAIT_PERSON_SCENE_OPTIONS },
  { field: 'lightShadow', labelKey: 'lightShadow', options: PORTRAIT_LIGHT_SHADOW_OPTIONS },
  { field: 'skin', labelKey: 'skin', options: PORTRAIT_SKIN_OPTIONS },
  { field: 'texture', labelKey: 'texture', options: PORTRAIT_TEXTURE_OPTIONS },
  { field: 'sharpness', labelKey: 'sharpness', options: PORTRAIT_SHARPNESS_OPTIONS }
] as const

export const DEFAULT_PORTRAIT_TEXTURE: PortraitTextureState = {
  personScene: 'natural',
  lightShadow: 'natural',
  skin: 'natural',
  texture: 'natural',
  sharpness: 'standard'
}

function pickOptionId<T extends string>(
  value: unknown,
  options: readonly PortraitTextureOptionDef<T>[],
  fallback: T
): T {
  return options.some((o) => o.id === value) ? (value as T) : fallback
}

export function normalizePortraitTexture(
  raw?: Partial<PortraitTextureState> | null
): PortraitTextureState {
  const base = { ...DEFAULT_PORTRAIT_TEXTURE, ...(raw ?? {}) }
  return {
    personScene: pickOptionId(
      base.personScene,
      PORTRAIT_PERSON_SCENE_OPTIONS,
      DEFAULT_PORTRAIT_TEXTURE.personScene
    ),
    lightShadow: pickOptionId(
      base.lightShadow,
      PORTRAIT_LIGHT_SHADOW_OPTIONS,
      DEFAULT_PORTRAIT_TEXTURE.lightShadow
    ),
    skin: pickOptionId(base.skin, PORTRAIT_SKIN_OPTIONS, DEFAULT_PORTRAIT_TEXTURE.skin),
    texture: pickOptionId(
      base.texture,
      PORTRAIT_TEXTURE_OPTIONS,
      DEFAULT_PORTRAIT_TEXTURE.texture
    ),
    sharpness: pickOptionId(
      base.sharpness,
      PORTRAIT_SHARPNESS_OPTIONS,
      DEFAULT_PORTRAIT_TEXTURE.sharpness
    )
  }
}

function promptForField(
  field: PortraitTextureField,
  state: PortraitTextureState
): string {
  const row = PORTRAIT_TEXTURE_FIELDS.find((item) => item.field === field)!
  const opt = row.options.find((o) => o.id === state[field])
  return opt?.prompt ?? ''
}

/** 由五维选项生成最终人像质感提示词 */
export function buildPortraitTexturePrompt(state: PortraitTextureState): string {
  const s = normalizePortraitTexture(state)
  return PORTRAIT_TEXTURE_FIELDS.map((row) => promptForField(row.field, s))
    .filter(Boolean)
    .join('，')
}

export function resolvePortraitTextureOutputPrompt(state: PortraitTextureState): string {
  return buildPortraitTexturePrompt(state)
}

export function readPortraitTextureFromNode(params: {
  portraitTexture?: Partial<PortraitTextureState>
}): PortraitTextureState {
  return normalizePortraitTexture(params.portraitTexture)
}

export function portraitTextureToNodePatch(state: PortraitTextureState): {
  portraitTexture: PortraitTextureState
  portraitTexturePrompt: string
} {
  const normalized = normalizePortraitTexture(state)
  return {
    portraitTexture: normalized,
    portraitTexturePrompt: resolvePortraitTextureOutputPrompt(normalized)
  }
}
