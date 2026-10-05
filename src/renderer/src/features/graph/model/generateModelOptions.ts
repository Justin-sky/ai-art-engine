import type {
  ModalityModelConfig,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind
} from '@shared/modelProvider'
import {
  allowsEmptyApiKey,
  isDecisionProviderKind,
  isLocalOpenAiProvider,
  isModel3dProviderKind,
  isVllmProvider,
  isWorldProviderKind,
  modalityConfig,
  providerModelDisplayName
} from '@shared/modelProvider'

export interface GenerateModelOption {
  key: string
  label: string
  providerInstanceId: string
  providerKind: ModelProviderKind
  model: string
}

/**
 * 生成模型下拉的展示名：优先设置里缓存的目录名（拉取目录时写入），
 * 其次 provider 内置展示名（目录只返回 id 的 provider，如 DeepSeek 的 deepseek-flash），
 * 最后回退 id；若 provider 名已出现在展示名开头则不重复拼接。
 */
function resolveModelOptionLabel(
  provider: ModelProviderInstance,
  config: ModalityModelConfig,
  modelId: string
): string {
  const cachedName = config.catalog?.[modelId]?.name?.trim()
  const display = cachedName || providerModelDisplayName(provider.providerKind, modelId)
  const providerLabel = provider.label.trim()
  if (!providerLabel || display.toLowerCase().startsWith(providerLabel.toLowerCase()))
    return display
  return `${providerLabel} · ${display}`
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
    if (isLocalOpenAiProvider(provider) && !isVllmProvider(provider) && modality !== 'text') {
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
    if (provider.providerKind === 'modelscope' && modality !== 'text' && modality !== 'image') {
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
    // Anthropic（Claude）：仅文本
    if (provider.providerKind === 'anthropic' && modality !== 'text') {
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
    // 3D 模型生成：仅支持 3D 供应商
    if (modality === 'model3d' && !isModel3dProviderKind(provider.providerKind)) {
      continue
    }
    // 空间世界生成：仅支持空间世界供应商（World Labs Marble）
    if (modality === 'spatialWorld' && !isWorldProviderKind(provider.providerKind)) {
      continue
    }
    // 反向约束：空间世界供应商只做世界生成，不出现在图片 / 视频 / 文本等其它模态的下拉里
    if (isWorldProviderKind(provider.providerKind) && modality !== 'spatialWorld') {
      continue
    }
    // 决策：只有提供决策协议的供应商（OpenRouter Decisions API / TypeSafe System One）
    if (modality === 'decisions' && !isDecisionProviderKind(provider.providerKind)) {
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
        label: resolveModelOptionLabel(provider, sel, model),
        providerInstanceId: provider.id,
        providerKind: provider.providerKind,
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

export function preferredModelKey(providerInstanceId?: string, model?: string): string {
  if (!providerInstanceId || !model) return ''
  return modelKey(providerInstanceId, model)
}

export type GenerateModelModality =
  'text' | 'image' | 'video' | 'audio' | 'model3d' | 'spatialWorld' | 'decisions'

/** 打开编辑窗时会连打 getSettings；短缓存避免同一次打开多 Dialog 重复 IPC */
let settingsCache: {
  at: number
  value: Awaited<ReturnType<typeof window.studio.getSettings>>
} | null = null
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

/** 可选项为空的成因：用于在选择器旁说明「为什么是空的」，而不是干瞪一个空下拉 */
export type EmptyModelOptionsReason =
  'noProvider' | 'providerDisabled' | 'missingApiKey' | 'noSelection' | 'unknown'

/**
 * 未产出任何选项时判定成因。
 *
 * `buildModelOptions` 会跳过「未启用 / 缺 Key / 该模态没勾模型」的提供商，
 * 所以空列表有三种完全不同的解释；这里按最可操作的一条给出结论。
 * 只考虑**支持该模态**的提供商（例如 decisions 只有 OpenRouter 与 TypeSafe），
 * 否则别的提供商的启用状态会把结论带偏。
 */
export function resolveEmptyModelOptionsReason(
  providers: ModelProviderInstance[],
  modality: ModelModality
): EmptyModelOptionsReason {
  const supports = (kind: ModelProviderKind): boolean => {
    // 决策协议供应商（OpenRouter / TypeSafe）：支持 decisions，且各自另有能力
    if (isDecisionProviderKind(kind)) return modality === 'decisions' || kind === 'openrouter'
    if (modality === 'decisions') return false
    if (kind === 'comfyui')
      return modality === 'image' || modality === 'video' || modality === 'audio'
    if (isVllmProvider(kind)) return modality === 'text' || modality === 'video'
    if (isLocalOpenAiProvider(kind)) return modality === 'text'
    if (isWorldProviderKind(kind)) return modality === 'spatialWorld'
    if (isModel3dProviderKind(kind)) return modality === 'model3d'
    if (kind === 'volcengine-ark' || kind === 'dashscope' || kind === 'minimax') {
      return modality !== 'model3d'
    }
    if (kind === 'kling') return modality === 'image' || modality === 'video'
    if (kind === 'custom') return modality === 'text' || modality === 'image'
    // 其余（openai / deepseek / moonshot / anthropic / zhipu / google / xai / modelscope …）：文本 + 部分图片
    return modality === 'text' || modality === 'image'
  }

  const candidates = providers.filter((p) => supports(p.providerKind))
  if (!candidates.length) return 'noProvider'
  if (candidates.every((p) => !p.enabled)) return 'providerDisabled'
  if (candidates.some((p) => !p.apiKey.trim() && !allowsEmptyApiKey(p))) return 'missingApiKey'
  return 'noSelection'
}

export async function loadGenerateModelOptions(
  modality: GenerateModelModality,
  preferredKey?: string,
  currentKey?: string
): Promise<{
  options: GenerateModelOption[]
  selectedKey: string
  emptyReason: EmptyModelOptionsReason | null
}> {
  try {
    const settings = await getSettingsCached()
    const providers = settings.models?.providers ?? []
    const options = buildModelOptions(providers, modality)
    const done = (selectedKey: string) => ({
      options,
      selectedKey,
      emptyReason: options.length ? null : resolveEmptyModelOptionsReason(providers, modality)
    })
    if (preferredKey && options.some((o) => o.key === preferredKey)) {
      return done(preferredKey)
    }
    if (currentKey && options.some((o) => o.key === currentKey)) {
      return done(currentKey)
    }
    return done(pickDefaultModelKey(providers, modality, options))
  } catch {
    return { options: [], selectedKey: '', emptyReason: 'unknown' }
  }
}
