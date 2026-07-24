import catalog from './modelCapabilities.json'

export type VolcengineArkCapabilityProfileId = keyof typeof catalog.profiles

export interface VolcengineArkCapabilityRule {
  match: string
  profile: string
}

export interface VolcengineArkModelCapabilitiesCatalog {
  meta: {
    console: string
    docs: string[]
    note: string
  }
  profiles: Record<
    string,
    {
      modality: 'image' | 'video' | 'text' | 'voice'
      label: string
      capabilities: Record<string, unknown>
    }
  >
  rules: VolcengineArkCapabilityRule[]
}

const data = catalog as VolcengineArkModelCapabilitiesCatalog

const compiledRules = data.rules.map((rule) => ({
  profile: rule.profile,
  re: new RegExp(rule.match, 'i')
}))

/** 接入点 id（ep-*）等无法从名称推断时的模态默认 profile */
const MODALITY_FALLBACK_PROFILE: Partial<Record<'image' | 'video', string>> = {
  image: 'seedream-4.5',
  video: 'seedance-2'
}

/** 原始静态目录（便于测试 / 文档引用） */
export function getVolcengineArkModelCapabilitiesCatalog(): VolcengineArkModelCapabilitiesCatalog {
  return data
}

function profileCapabilities(profileId: string): Record<string, unknown> | null {
  const profile = data.profiles[profileId]
  if (!profile?.capabilities) return null
  return { ...profile.capabilities }
}

/** 方舟推理接入点 id，无法从字符串识别 Seedream/Seedance 族 */
export function isOpaqueVolcengineArkEndpointId(modelId: string): boolean {
  return /^ep[-_]/i.test(modelId.trim())
}

/**
 * 按模型 id / 显示名匹配 Seedream/Seedance 能力配置。
 * 未命中时：仅对 `ep-*` 接入点按 image/video modality 回退到默认族。
 */
export function resolveVolcengineArkModelCapabilities(
  modelId: string,
  modelName?: string,
  modality?: 'image' | 'video' | 'text' | 'voice'
): Record<string, unknown> | null {
  const text = `${modelId} ${modelName ?? ''}`.trim()
  if (text) {
    for (const rule of compiledRules) {
      if (!rule.re.test(text)) continue
      return profileCapabilities(rule.profile)
    }
  }
  if (
    (modality === 'image' || modality === 'video') &&
    isOpaqueVolcengineArkEndpointId(modelId)
  ) {
    const fallback = MODALITY_FALLBACK_PROFILE[modality]
    if (fallback) return profileCapabilities(fallback)
  }
  return null
}

/** 命中的 profile id；未命中返回 null（不含 modality 回退） */
export function resolveVolcengineArkCapabilityProfileId(
  modelId: string,
  modelName?: string
): string | null {
  const text = `${modelId} ${modelName ?? ''}`.trim()
  if (!text) return null
  for (const rule of compiledRules) {
    if (rule.re.test(text)) return rule.profile
  }
  return null
}
