import {
  DEFAULT_IMAGE_GENERATE_CAPABILITIES,
  hasAnyImageGenerateCapability,
  parseImageGenerateCapabilities,
  type ImageGenerateParamCapabilities
} from '@shared/graph'
import {
  getSavedModelCatalogEntry,
  isDashScopeProvider,
  isKlingProvider,
  isModelScopeProvider,
  isVolcengineArkProvider
} from '@shared/openrouter'
import { resolveVolcengineArkModelCapabilities } from '@shared/modelProviders/volcengineArk/modelCapabilities'
import { resolveKlingModelCapabilities } from '@shared/modelProviders/kling/modelCapabilities'
import { resolveDashScopeModelCapabilities } from '@shared/modelProviders/dashscope/modelCapabilities'
import { resolveModelScopeModelCapabilities } from '@shared/modelProviders/modelscope/modelCapabilities'
import { modelKey, parseModelKey } from './generateModelOptions'

const cache = new Map<string, ImageGenerateParamCapabilities>()

function mergeImageGenerateCapabilities(
  parsed: ImageGenerateParamCapabilities
): ImageGenerateParamCapabilities {
  const base = hasAnyImageGenerateCapability(parsed)
    ? parsed
    : DEFAULT_IMAGE_GENERATE_CAPABILITIES
  return {
    ...base,
    // 未声明时保留 undefined，端口角标显示 *；执行侧仍会回退默认上限
    ...(parsed.maxInputReferences != null
      ? { maxInputReferences: parsed.maxInputReferences }
      : { maxInputReferences: undefined })
  }
}

async function resolveSupportedParameters(
  providerInstanceId: string,
  modelId: string
): Promise<unknown> {
  let catalogName: string | undefined
  let isArk = false
  let isKling = false
  let isDashScope = false
  let isModelScope = false
  try {
    const settings = await window.studio.getSettings()
    const provider = settings.models?.providers?.find((p) => p.id === providerInstanceId)
    isArk = isVolcengineArkProvider(provider)
    isKling = isKlingProvider(provider)
    isDashScope = isDashScopeProvider(provider)
    isModelScope = isModelScopeProvider(provider)
    const saved = getSavedModelCatalogEntry(
      settings.models?.providers,
      providerInstanceId,
      'image',
      modelId
    )
    if (saved?.name) catalogName = saved.name
    const savedSp = saved?.capabilities?.supported_parameters
    if (savedSp && typeof savedSp === 'object') return savedSp
  } catch {
    // ignore
  }

  try {
    const list = await window.studio.listModels({
      modality: 'image',
      providerInstanceId
    })
    const model = list.find((m) => m.id === modelId)
    catalogName = model?.name ?? catalogName
    const fromApi = model?.capabilities?.supported_parameters
    if (fromApi && typeof fromApi === 'object') return fromApi
  } catch {
    // 继续走本地静态配置 / 默认能力
  }

  if (isKling) {
    const local = resolveKlingModelCapabilities(modelId, 'image')
    if (local?.supported_parameters) return local.supported_parameters
    return undefined
  }

  if (isDashScope) {
    const local = resolveDashScopeModelCapabilities(modelId, 'image')
    if (local?.supported_parameters) return local.supported_parameters
    return undefined
  }

  if (isModelScope) {
    const local = resolveModelScopeModelCapabilities(modelId, 'image')
    if (local?.supported_parameters) return local.supported_parameters
    return undefined
  }

  if (isArk) {
    const local = resolveVolcengineArkModelCapabilities(modelId, catalogName, 'image')
    if (local?.supported_parameters) return local.supported_parameters
  } else {
    const local = resolveVolcengineArkModelCapabilities(modelId, catalogName)
    if (local?.supported_parameters) return local.supported_parameters
  }
  return undefined
}

/** 同步读取已缓存的图片模型能力（未加载过则返回 null） */
export function getCachedImageGenerateCapabilities(
  key: string
): ImageGenerateParamCapabilities | null {
  return cache.get(key) ?? null
}

/** 按 provider + model 拉取图片模型 supported_parameters */
export async function loadImageGenerateCapabilities(
  key: string
): Promise<ImageGenerateParamCapabilities> {
  const parsedKey = parseModelKey(key)
  if (!parsedKey) {
    return { aspectRatios: [], resolutions: [], qualities: [], counts: [] }
  }

  const cached = cache.get(key)
  if (cached) return cached

  const supported = await resolveSupportedParameters(
    parsedKey.providerInstanceId,
    parsedKey.model
  )
  const caps = parseImageGenerateCapabilities(supported)
  const resolved = mergeImageGenerateCapabilities(caps)
  cache.set(key, resolved)
  return resolved
}

/** 图执行：按节点选中的图片模型解析能力（含参考图上限） */
export async function resolveImageGenerateCapabilitiesForRun(input: {
  model?: string
  providerInstanceId?: string
}): Promise<ImageGenerateParamCapabilities> {
  const providerInstanceId = input.providerInstanceId?.trim()
  const model = input.model?.trim()
  if (!providerInstanceId || !model) {
    return DEFAULT_IMAGE_GENERATE_CAPABILITIES
  }
  return loadImageGenerateCapabilities(modelKey(providerInstanceId, model))
}

export function clearImageGenerateCapabilitiesCache(): void {
  cache.clear()
}
