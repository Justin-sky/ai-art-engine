import {
  parseVideoGenerateParamCapabilities,
  resolveVideoGeneratePortLimits,
  UNKNOWN_VIDEO_PORT_LIMITS,
  hasAnyVideoGenerateCapability,
  type VideoGenerateParamCapabilities,
  type VideoGeneratePortLimits
} from '@shared/graph'
import {
  getSavedModelCatalogEntry,
  isGoogleProvider,
  type ModelModality,
  type ModelProviderKind
} from '@shared/modelProvider'
import { resolveStaticCapabilitiesForProvider } from '@shared/modelProviders/staticCatalogRegistry'
import { resolveVolcengineArkModelCapabilities } from '@shared/modelProviders/volcengineArk/modelCapabilities'
import { resolveGoogleModelCapabilities } from '@shared/modelProviders/google/modelCapabilities'
import {
  modelKey,
  parseModelKey,
  buildModelOptions,
  pickDefaultModelKey
} from './generateModelOptions'

export interface VideoGenerateCapabilitiesBundle {
  params: VideoGenerateParamCapabilities
  portLimits: VideoGeneratePortLimits
}

const EMPTY_BUNDLE: VideoGenerateCapabilitiesBundle = {
  params: {
    aspectRatios: [],
    resolutions: [],
    durations: [],
    supportsGenerateAudio: false,
    supportedFrameImages: []
  },
  portLimits: { ...UNKNOWN_VIDEO_PORT_LIMITS }
}

const cache = new Map<string, VideoGenerateCapabilitiesBundle>()

function parseBundle(
  modelId: string | undefined,
  capabilities: Record<string, unknown> | null | undefined
): VideoGenerateCapabilitiesBundle {
  const caps = capabilities ?? null
  return {
    params: parseVideoGenerateParamCapabilities(caps),
    portLimits: resolveVideoGeneratePortLimits(modelId, caps)
  }
}

function isUsableVideoCaps(raw: Record<string, unknown> | null | undefined): boolean {
  if (!raw) return false
  return hasAnyVideoGenerateCapability(parseVideoGenerateParamCapabilities(raw))
}

async function resolveVideoCapabilitiesRaw(
  providerInstanceId: string,
  modelId: string
): Promise<Record<string, unknown> | null> {
  let catalogName: string | undefined
  let providerKind: ModelProviderKind | undefined
  try {
    const settings = await window.studio.getSettings()
    const provider = settings.models?.providers?.find((p) => p.id === providerInstanceId)
    providerKind = provider?.providerKind
    if (isGoogleProvider(provider)) {
      return resolveGoogleModelCapabilities(modelId, 'video')
    }
    const saved = getSavedModelCatalogEntry(
      settings.models?.providers,
      providerInstanceId,
      'video',
      modelId
    )
    if (saved?.name) catalogName = saved.name
    if (isUsableVideoCaps(saved?.capabilities)) {
      return saved!.capabilities ?? null
    }
  } catch {
    // ignore
  }

  try {
    const list = await window.studio.listModels({
      modality: 'video',
      providerInstanceId
    })
    const model = list.find((m) => m.id === modelId)
    catalogName = model?.name ?? catalogName
    const fromApi = (model?.capabilities as Record<string, unknown> | undefined) ?? null
    if (isUsableVideoCaps(fromApi)) {
      return fromApi
    }
  } catch {
    // 继续走本地静态配置
  }

  if (providerKind) {
    const local = resolveStaticCapabilitiesForProvider(providerKind, modelId, 'video', catalogName)
    if (local) return local
    if (providerKind !== 'openrouter' && providerKind !== 'custom' && providerKind !== 'newapi') {
      return resolveVolcengineArkModelCapabilities(modelId, catalogName)
    }
  }
  return resolveVolcengineArkModelCapabilities(modelId, catalogName)
}

/** 同步读取已缓存的视频模型能力（未加载过则返回 null） */
export function getCachedVideoGenerateCapabilities(
  key: string
): VideoGenerateCapabilitiesBundle | null {
  return cache.get(key) ?? null
}

/** 按 provider + model 拉取视频模型能力（参数 + 端口限额） */
export async function loadVideoGenerateCapabilities(
  key: string
): Promise<VideoGenerateCapabilitiesBundle> {
  const parsed = parseModelKey(key)
  if (!parsed) return { ...EMPTY_BUNDLE, portLimits: { ...UNKNOWN_VIDEO_PORT_LIMITS } }

  const cached = cache.get(key)
  if (cached) return cached

  const raw = await resolveVideoCapabilitiesRaw(parsed.providerInstanceId, parsed.model)
  const bundle = parseBundle(parsed.model, raw)
  cache.set(key, bundle)
  return bundle
}

/** 按 provider + model 拉取视频模型能力并解析端口限额 */
export async function loadVideoGeneratePortLimits(key: string): Promise<VideoGeneratePortLimits> {
  const bundle = await loadVideoGenerateCapabilities(key)
  return bundle.portLimits
}

export async function loadVideoGenerateParamCapabilities(
  key: string
): Promise<VideoGenerateParamCapabilities> {
  const bundle = await loadVideoGenerateCapabilities(key)
  return bundle.params
}

/**
 * 节点没钉模型时（检查器显示「跟随设置默认」）：从设置里解析该模态的默认模型 key。
 *
 * 与下拉里的「默认」同一口径（`pickDefaultModelKey`），保证「默认」在运行期也**真的**被解析成
 * 一个具体模型 —— 否则能力表为空，调用方只能拿镜头时长当生成时长（1s / 2s），
 * 而默认模型（如 Seedance 2）的合法档位是 4..15s，整批镜头会被上游 400 打回（实测踩到）。
 */
async function resolveFallbackModelKey(
  modality: ModelModality,
  pinnedProviderInstanceId: string | undefined
): Promise<string> {
  try {
    const settings = await window.studio.getSettings()
    const providers = settings.models?.providers ?? []
    const options = buildModelOptions(providers, modality)
    const scoped = pinnedProviderInstanceId
      ? options.filter((o) => o.providerInstanceId === pinnedProviderInstanceId)
      : options
    return pickDefaultModelKey(providers, modality, scoped) || scoped[0]?.key || ''
  } catch {
    return ''
  }
}

export async function resolveVideoGenerateCapabilitiesForRun(input: {
  model?: string
  providerInstanceId?: string
}): Promise<VideoGenerateCapabilitiesBundle | undefined> {
  const providerInstanceId = input.providerInstanceId?.trim()
  const model = input.model?.trim()
  if (providerInstanceId && model) {
    return loadVideoGenerateCapabilities(modelKey(providerInstanceId, model))
  }
  /**
   * 只有一半（或两样都没有）时**不能直接放弃**：语义重建这类节点会把「默认模型」交给运行期，
   * 这里必须把默认模型解析出来，否则 durations 为空 —— 那是上面那条 400 的根因。
   */
  const fallbackKey = await resolveFallbackModelKey('video', providerInstanceId || undefined)
  if (!fallbackKey) return undefined
  return loadVideoGenerateCapabilities(fallbackKey)
}

export async function resolveVideoGeneratePortLimitsForRun(input: {
  model?: string
  providerInstanceId?: string
}): Promise<VideoGeneratePortLimits> {
  const bundle = await resolveVideoGenerateCapabilitiesForRun(input)
  return bundle?.portLimits ?? { ...UNKNOWN_VIDEO_PORT_LIMITS }
}

export function clearVideoGeneratePortLimitsCache(): void {
  cache.clear()
}

export function clearVideoGenerateCapabilitiesCache(): void {
  cache.clear()
}
