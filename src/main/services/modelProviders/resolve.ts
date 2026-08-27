import type { ModelModality, ModelProviderInstance, ModelProviderKind } from '@shared/modelProvider'
import {
  MODEL_PROVIDER_KINDS,
  createEmptyModalityMap,
  findProviderById,
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

/** 列表/测连时：合并已保存实例与 UI 未保存 overrides */
export function buildProviderSnapshot(input: {
  providerInstanceId: string
  apiKey?: string
  baseUrl?: string
  nativeBaseUrl?: string
  providerKind?: ModelProviderKind
}): ModelProviderInstance {
  const settings = settingsService.get()
  const saved = findProviderById(settings.models.providers, input.providerInstanceId)
  const kind = input.providerKind ?? saved?.providerKind ?? 'openrouter'
  return {
    id: input.providerInstanceId,
    providerKind: kind,
    label: saved?.label ?? defaultLabelForKind(kind),
    apiKey: input.apiKey ?? saved?.apiKey ?? '',
    baseUrl: input.baseUrl ?? saved?.baseUrl ?? defaultBaseUrlForKind(kind),
    nativeBaseUrl: input.nativeBaseUrl ?? saved?.nativeBaseUrl ?? '',
    enabled: saved?.enabled ?? true,
    modalities: saved?.modalities ?? createEmptyModalityMap()
  }
}
