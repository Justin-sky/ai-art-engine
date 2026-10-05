import type {
  CustomApiStyle,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind
} from '@shared/modelProvider'
import {
  DEFAULT_CUSTOM_API_STYLE,
  MODEL_PROVIDER_KINDS,
  createEmptyModalityMap,
  findProviderById,
  isCustomApiStyle,
  pickActiveProvider
} from '@shared/modelProvider'
import { settingsService } from '../settingsService'
import { fail } from '@shared/errors/appError'
import { PROVIDER_ERRORS } from './catalog'

export function defaultBaseUrlForKind(kind: ModelProviderKind): string {
  return (
    MODEL_PROVIDER_KINDS.find((p) => p.id === kind)?.defaultBaseUrl ??
    MODEL_PROVIDER_KINDS[0]!.defaultBaseUrl
  )
}

export function defaultLabelForKind(kind: ModelProviderKind): string {
  return MODEL_PROVIDER_KINDS.find((p) => p.id === kind)?.label ?? kind
}

export function resolveActiveProvider(
  modality: ModelModality,
  providerInstanceId?: string,
  modelId?: string
): { provider: ModelProviderInstance; modelId: string } {
  const settings = settingsService.get()
  const picked = pickActiveProvider(
    settings.models.providers,
    modality,
    providerInstanceId,
    modelId
  )
  if (!picked) {
    throw fail(PROVIDER_ERRORS.noActiveProvider, { modality })
  }
  return picked
}

/**
 * 音乐 / BGM 的提供商与模型解析。
 *
 * 先按 **music 模态**解析（音乐模型现在归这个桶：MiniMax music-*、百炼 fun-music-*、
 * ElevenLabs music_*、OpenRouter 的 Google Lyria 3）；
 * 解析不到再退回 audio 模态 —— 兼容两件事：
 * 1. 升级前的老设置（音乐模型当时借用 audio 桶）
 * 2. 用户只在「声音」页签勾了模型、没勾音乐的情况
 *
 * 直接用 `'audio'` 是错的：那样用户选了 Lyria，解析会退回音频桶里的 TTS 模型
 * （如微软 MAI-Voice），等于把音乐请求发给了语音模型。
 */
export function resolveActiveMusicProvider(
  providerInstanceId?: string,
  modelId?: string
): { provider: ModelProviderInstance; modelId: string } {
  const settings = settingsService.get()
  const providers = settings.models.providers
  const picked =
    pickActiveProvider(providers, 'music', providerInstanceId, modelId) ??
    pickActiveProvider(providers, 'audio', providerInstanceId, modelId)
  if (!picked) throw fail(PROVIDER_ERRORS.noActiveProvider, { modality: 'music' })
  return picked
}

/** 列表/测连时：合并已保存实例与 UI 未保存 overrides */
export function buildProviderSnapshot(input: {
  providerInstanceId: string
  apiKey?: string
  baseUrl?: string
  nativeBaseUrl?: string
  providerKind?: ModelProviderKind
  apiStyle?: CustomApiStyle
}): ModelProviderInstance {
  const settings = settingsService.get()
  const saved = findProviderById(settings.models.providers, input.providerInstanceId)
  const kind = input.providerKind ?? saved?.providerKind ?? 'openrouter'
  const apiStyle =
    saved?.apiStyle ??
    (isCustomApiStyle(input.apiStyle) ? input.apiStyle : DEFAULT_CUSTOM_API_STYLE)
  return {
    id: input.providerInstanceId,
    providerKind: kind,
    label: saved?.label ?? defaultLabelForKind(kind),
    apiKey: input.apiKey ?? saved?.apiKey ?? '',
    baseUrl: input.baseUrl ?? saved?.baseUrl ?? defaultBaseUrlForKind(kind),
    nativeBaseUrl: input.nativeBaseUrl ?? saved?.nativeBaseUrl ?? '',
    ...(kind === 'custom' ? { apiStyle } : {}),
    enabled: saved?.enabled ?? true,
    modalities: saved?.modalities ?? createEmptyModalityMap()
  }
}
