import type {
  CustomApiStyle,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind
} from '@shared/modelProvider'
import {
  DEFAULT_CUSTOM_API_STYLE,
  MODEL_PROVIDER_KINDS,
  allowsEmptyApiKey,
  createEmptyModalityMap,
  findProviderById,
  isCustomApiStyle,
  modalityConfig,
  pickActiveProvider,
  supportsSoundEffect
} from '@shared/modelProvider'
import { ELEVEN_SOUND_MODEL } from '@shared/modelProviders/elevenlabs/voice'
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

/**
 * 音效生成的提供商解析（`POST /v1/sound-generation`）。
 *
 * **必须先按能力筛**：通用的 `resolveActiveProvider('audio', …)` 只要求
 * 「这家在 audio 桶里勾了模型」，于是只要用户勾过任何 TTS 模型（OpenAI / MiniMax /
 * 方舟都算），它就会选中一家**不会做音效**的，然后在适配器那层报「不支持」——
 * 用户看到的是「我明明配了 ElevenLabs，它却说我不支持」。
 *
 * 模型从 **sfx 桶**取（设置页「音效」页签）；没有勾选时退回固定的
 * `ELEVEN_SOUND_MODEL`，绝不读 audio 桶（那是 TTS，踩过「音效变成念描述」）。
 *
 * @param providerInstanceId 节点上选的实例；给了但它不会做音效时**不会**退化到别家
 *   （宁可用同一家的另一个实例，也不要偷偷换提供商）
 */
export function resolveActiveSoundEffectProvider(providerInstanceId?: string): {
  provider: ModelProviderInstance
  modelId: string
} {
  const settings = settingsService.get()
  const providers = settings.models.providers
  const capable = providers.filter(
    (p) =>
      p.enabled &&
      supportsSoundEffect(p.providerKind) &&
      (p.apiKey.trim().length > 0 || allowsEmptyApiKey(p))
  )
  if (!capable.length) throw fail(PROVIDER_ERRORS.soundEffectUnsupported)

  const requested = providerInstanceId?.trim()
  // 优先：sfx 桶里勾过模型的实例（将来多家时按勾选分流）；否则退回能做音效的第一家
  const withSfxSelection = capable.filter(
    (p) => modalityConfig(p, 'sfx').selectedModelIds.length > 0
  )
  const pool = withSfxSelection.length ? withSfxSelection : capable
  const picked =
    (requested ? pool.find((p) => p.id === requested) : undefined) ??
    (requested ? capable.find((p) => p.id === requested) : undefined) ??
    pool[0]!

  // 端点 model_id 是单值 enum：绝不信任 sfx 桶勾选（旧设置可能混进 TTS id）
  return {
    provider: picked,
    modelId: ELEVEN_SOUND_MODEL
  }
}

/** 列表/测连时：合并已保存实例与 UI 未保存 overrides */ export function buildProviderSnapshot(input: {
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
