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
  isVolcengineArkProvider
} from '@shared/openrouter'
import { resolveVolcengineArkModelCapabilities } from '@shared/modelProviders/volcengineArk/modelCapabilities'
import { modelKey, parseModelKey } from './generateModelOptions'

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
  let isArk = false
  try {
    const settings = await window.studio.getSettings()
    const provider = settings.models?.providers?.find((p) => p.id === providerInstanceId)
    isArk = isVolcengineArkProvider(provider)
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
    // 继续走本地方舟配置
  }

  if (isArk) {
    return resolveVolcengineArkModelCapabilities(modelId, catalogName, 'video')
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
export async function loadVideoGeneratePortLimits(
  key: string
): Promise<VideoGeneratePortLimits> {
  const bundle = await loadVideoGenerateCapabilities(key)
  return bundle.portLimits
}

export async function loadVideoGenerateParamCapabilities(
  key: string
): Promise<VideoGenerateParamCapabilities> {
  const bundle = await loadVideoGenerateCapabilities(key)
  return bundle.params
}

export async function resolveVideoGenerateCapabilitiesForRun(input: {
  model?: string
  providerInstanceId?: string
}): Promise<VideoGenerateCapabilitiesBundle | undefined> {
  const providerInstanceId = input.providerInstanceId?.trim()
  const model = input.model?.trim()
  if (!providerInstanceId || !model) return undefined
  return loadVideoGenerateCapabilities(modelKey(providerInstanceId, model))
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
