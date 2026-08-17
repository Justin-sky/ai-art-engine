import type { ModelModality, ModelProviderInstance } from '@shared/modelProvider'
import {
  allowsEmptyApiKey,
  isLocalOpenAiProvider,
  isVllmProvider,
  modalityConfig
} from '@shared/modelProvider'

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
    if (!provider.enabled) continue
    // 本地 OpenAI 兼容服务与 ComfyUI 无需 API Key
    if (!provider.apiKey.trim() && !allowsEmptyApiKey(provider)) continue
    // 本地服务仅文本（多模态理解可在文本节点传图）
    if (isVllmProvider(provider) && modality !== 'text' && modality !== 'video') continue
    if (
      isLocalOpenAiProvider(provider) &&
      !isVllmProvider(provider) &&
      modality !== 'text'
    ) {
      continue
    }
    // 声音（audio）：火山方舟 voice_design / MiniMax 音色设计；排除 OpenRouter 等
    if (
      modality === 'audio' &&
      provider.providerKind !== 'volcengine-ark' &&
      provider.providerKind !== 'minimax' &&
      provider.providerKind !== 'comfyui'
    ) {
      continue
    }
    if (provider.providerKind === 'comfyui' && modality === 'text') continue
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
    // OpenAI：仅文本 + 图片
    if (provider.providerKind === 'openai' && modality !== 'text' && modality !== 'image') {
      continue
    }
    // DeepSeek：仅文本
    if (provider.providerKind === 'deepseek' && modality !== 'text') {
      continue
    }
    // 智谱：文本 + 图片
    if (provider.providerKind === 'zhipu' && modality !== 'text' && modality !== 'image') {
      continue
    }
    // Kimi（月之暗面）：仅文本
    if (provider.providerKind === 'moonshot' && modality !== 'text') {
      continue
    }
    // Google（Gemini）：文本 / 图片 / 视频
    if (
      provider.providerKind === 'google' &&
      modality !== 'text' &&
      modality !== 'image' &&
      modality !== 'video'
    ) {
      continue
    }
    // xAI（Grok）：文本 / 图片 / 视频
    if (
      provider.providerKind === 'xai' &&
      modality !== 'text' &&
      modality !== 'image' &&
      modality !== 'video'
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
    if (!provider.enabled) continue
    if (!provider.apiKey.trim() && !allowsEmptyApiKey(provider)) continue
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
