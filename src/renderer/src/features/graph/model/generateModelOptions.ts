import type { ModelModality, ModelProviderInstance } from '@shared/modelProvider'
import { modalityConfig } from '@shared/modelProvider'

export interface GenerateModelOption {
  key: string
  label: string
  providerInstanceId: string
  model: string
}

export function modelKey(providerInstanceId: string, model: string): string {
  return `${providerInstanceId}::${model}`
}

export function parseModelKey(key: string): { providerInstanceId: string; model: string } | null {
  const idx = key.indexOf('::')
  if (idx <= 0) return null
  return { providerInstanceId: key.slice(0, idx), model: key.slice(idx + 2) }
}

export function buildModelOptions(
  providers: ModelProviderInstance[],
  modality: ModelModality
): GenerateModelOption[] {
  const options: GenerateModelOption[] = []
  for (const provider of providers) {
    if (!provider.enabled || !provider.apiKey.trim()) continue
    // 声音（audio）：火山方舟 voice_design / MiniMax 音色设计；排除 OpenRouter 等
    if (
      modality === 'audio' &&
      provider.providerKind !== 'volcengine-ark' &&
      provider.providerKind !== 'minimax'
    ) {
      continue
    }
    // 可灵仅图片/视频
    if (provider.providerKind === 'kling' && modality !== 'image' && modality !== 'video') continue
    // MiniMax：文本 / 图片 / 视频 / 声音设计
    if (
      provider.providerKind === 'minimax' &&
      modality !== 'text' &&
      modality !== 'image' &&
      modality !== 'video' &&
      modality !== 'audio'
    ) {
      continue
    }
    // 魔塔：文本 + 图片
    if (
      provider.providerKind === 'modelscope' &&
      modality !== 'text' &&
      modality !== 'image'
    ) {
      continue
    }
    const sel = modalityConfig(provider, modality)
    const models =
      sel.selectedModelIds.length > 0
        ? sel.selectedModelIds
        : sel.defaultModelId
          ? [sel.defaultModelId]
          : []
    for (const model of models) {
      if (!model.trim()) continue
      options.push({
        key: modelKey(provider.id, model),
        label: `${provider.label} · ${model}`,
        providerInstanceId: provider.id,
        model
      })
    }
  }
  return options
}

export function pickDefaultModelKey(
  providers: ModelProviderInstance[],
  modality: ModelModality,
  options: GenerateModelOption[]
): string {
  if (options.length === 0) return ''
  for (const provider of providers) {
    if (!provider.enabled || !provider.apiKey.trim()) continue
    const defaultModelId = modalityConfig(provider, modality).defaultModelId
    if (defaultModelId) {
      const key = modelKey(provider.id, defaultModelId)
      if (options.some((o) => o.key === key)) return key
    }
  }
  return options[0]?.key ?? ''
}

export function preferredModelKey(
  providerInstanceId?: string,
  model?: string
): string {
  if (!providerInstanceId || !model) return ''
  return modelKey(providerInstanceId, model)
}

export type GenerateModelModality = 'text' | 'image' | 'video' | 'audio'

/** 打开编辑窗时会连打 getSettings；短缓存避免同一次打开多 Dialog 重复 IPC */
let settingsCache: { at: number; value: Awaited<ReturnType<typeof window.studio.getSettings>> } | null =
  null
const SETTINGS_CACHE_TTL_MS = 15_000

export function invalidateGenerateModelSettingsCache(): void {
  settingsCache = null
}

async function getSettingsCached(): Promise<Awaited<ReturnType<typeof window.studio.getSettings>>> {
  const now = Date.now()
  if (settingsCache && now - settingsCache.at < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.value
  }
  const value = await window.studio.getSettings()
  settingsCache = { at: now, value }
  return value
}

export async function loadGenerateModelOptions(
  modality: GenerateModelModality,
  preferredKey?: string,
  currentKey?: string
): Promise<{ options: GenerateModelOption[]; selectedKey: string }> {
  try {
    const settings = await getSettingsCached()
    const providers = settings.models?.providers ?? []
    const options = buildModelOptions(providers, modality)
    if (preferredKey && options.some((o) => o.key === preferredKey)) {
      return { options, selectedKey: preferredKey }
    }
    if (currentKey && options.some((o) => o.key === currentKey)) {
      return { options, selectedKey: currentKey }
    }
    return { options, selectedKey: pickDefaultModelKey(providers, modality, options) }
  } catch {
    return { options: [], selectedKey: '' }
  }
}
