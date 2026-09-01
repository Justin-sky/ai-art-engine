/** Model provider + catalog types shared by main/renderer */

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
/** OpenAI 官方 API（文本 / 图片） */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
/** DeepSeek 开放平台（OpenAI 兼容，仅文本） */
export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com'
/** 智谱开放平台（OpenAI 兼容；GLM 文本 + CogView 图片） */
export const ZHIPU_DEFAULT_BASE_URL = 'https://open.bigmodel.cn/api/paas/v4'
/** 本地 vLLM（OpenAI 兼容；默认端口 8000） */
export const VLLM_DEFAULT_BASE_URL = 'http://localhost:8000/v1'
/** 本地 Ollama（OpenAI 兼容端点；默认端口 11434） */
export const OLLAMA_DEFAULT_BASE_URL = 'http://localhost:11434/v1'
/** 本地 LM Studio（OpenAI 兼容端点；默认端口 1234） */
export const LMSTUDIO_DEFAULT_BASE_URL = 'http://localhost:1234/v1'
/** 月之暗面 Kimi（Moonshot AI，OpenAI 兼容，仅文本） */
export const MOONSHOT_DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1'
/** xAI（Grok，OpenAI 兼容；文本 / 图片 / 视频） */
export const XAI_DEFAULT_BASE_URL = 'https://api.x.ai/v1'
/** Google Gemini（走官方 OpenAI 兼容层） */
export const GOOGLE_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'
/** 火山方舟（Ark）OpenAI 兼容端点 */
export const VOLCENGINE_ARK_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'
/** 豆包语音控制台（声音设计 API Key / speaker_id；与方舟 Ark Key 可能不同） */
export const VOLCENGINE_OPENSPEECH_CREDENTIALS_URL =
  'https://console.volcengine.com/speech/app'
/** 可灵（Kling）国内开放平台 */
export const KLING_DEFAULT_BASE_URL = 'https://api-beijing.klingai.com'
/** MiniMax（原海螺 AI）国内开放平台 */
export const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com'
/** 通义千问 / 万相（阿里云百炼 DashScope OpenAI 兼容） */
export const DASHSCOPE_DEFAULT_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1'
/** 魔塔 / 魔搭 ModelScope API-Inference（OpenAI 兼容） */
export const MODELSCOPE_DEFAULT_BASE_URL = 'https://api-inference.modelscope.cn/v1'
/** ComfyUI API 2（本机 comfy-api-proxy 默认 8189；云端填 https://cloud.comfy.org） */
export const COMFYUI_DEFAULT_BASE_URL = 'http://127.0.0.1:8189'
/** MagicRouter（多供应商聚合，OpenAI 兼容；文本 / 图片 / 视频） */
export const MAGICROUTER_DEFAULT_BASE_URL = 'https://api.magicrouter.ai/v1'
/** Hyper3D Rodin（3D 模型生成） */
export const HYPER3D_DEFAULT_BASE_URL = 'https://api.hyper3d.com/api/v2'
/** Luma Genie（Dream Machine，3D 模型生成） */
export const LUMA_DEFAULT_BASE_URL = 'https://api.lumalabs.ai/dream-machine/v1'
/** AHOLO 开放平台 Lux3D（3D 模型生成；cn 区域，com 区域走 https://api.aholo3d.com） */
export const LUX3D_DEFAULT_BASE_URL = 'https://api.aholo3d.cn'

export type ModelProviderKind =
  | 'openrouter'
  | 'openai'
  | 'deepseek'
  | 'zhipu'
  | 'moonshot'
  | 'xai'
  | 'google'
  | 'vllm'
  | 'ollama'
  | 'lmstudio'
  | 'volcengine-ark'
  | 'kling'
  | 'minimax'
  | 'dashscope'
  | 'modelscope'
  | 'comfyui'
  | 'magicrouter'
  | 'tripo'
  | 'meshy'
  | 'hyper3d'
  | 'luma'
  | 'lux3d'

export interface ModelProviderKindMeta {
  id: ModelProviderKind
  label: string
  defaultBaseUrl: string
  /** 控制台 / 密钥申请页，设置 UI 与手册共用 */
  credentialsUrl: string
}

/** 设置落盘与规范化用的 kind 目录。运行时适配器由主进程 Cordis 插件登记。 */
export const MODEL_PROVIDER_KINDS: readonly ModelProviderKindMeta[] = [
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultBaseUrl: OPENROUTER_DEFAULT_BASE_URL,
    credentialsUrl: 'https://openrouter.ai/keys'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: OPENAI_DEFAULT_BASE_URL,
    credentialsUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultBaseUrl: DEEPSEEK_DEFAULT_BASE_URL,
    credentialsUrl: 'https://platform.deepseek.com/api_keys'
  },
  {
    id: 'zhipu',
    label: '智谱',
    defaultBaseUrl: ZHIPU_DEFAULT_BASE_URL,
    credentialsUrl: 'https://open.bigmodel.cn/usercenter/apikeys'
  },
  {
    id: 'moonshot',
    label: 'Kimi（月之暗面）',
    defaultBaseUrl: MOONSHOT_DEFAULT_BASE_URL,
    credentialsUrl: 'https://platform.moonshot.cn/console/api-keys'
  },
  {
    id: 'xai',
    label: 'xAI（Grok）',
    defaultBaseUrl: XAI_DEFAULT_BASE_URL,
    credentialsUrl: 'https://console.x.ai/'
  },
  {
    id: 'google',
    label: 'Google（Gemini）',
    defaultBaseUrl: GOOGLE_DEFAULT_BASE_URL,
    credentialsUrl: 'https://aistudio.google.com/apikey'
  },
  {
    id: 'vllm',
    label: 'vLLM',
    defaultBaseUrl: VLLM_DEFAULT_BASE_URL,
    credentialsUrl: 'https://docs.vllm.ai'
  },
  {
    id: 'ollama',
    label: 'Ollama',
    defaultBaseUrl: OLLAMA_DEFAULT_BASE_URL,
    credentialsUrl: 'https://ollama.com'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    defaultBaseUrl: LMSTUDIO_DEFAULT_BASE_URL,
    credentialsUrl: 'https://lmstudio.ai'
  },
  {
    id: 'volcengine-ark',
    label: '火山方舟',
    defaultBaseUrl: VOLCENGINE_ARK_DEFAULT_BASE_URL,
    credentialsUrl: 'https://console.volcengine.com/ark/region:ark-cn-beijing/apiKey'
  },
  {
    id: 'kling',
    label: '可灵',
    defaultBaseUrl: KLING_DEFAULT_BASE_URL,
    credentialsUrl: 'https://app.klingai.com/cn/dev'
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    defaultBaseUrl: MINIMAX_DEFAULT_BASE_URL,
    credentialsUrl:
      'https://platform.minimaxi.com/user-center/basic-information/interface-key'
  },
  {
    id: 'dashscope',
    label: '通义千问',
    defaultBaseUrl: DASHSCOPE_DEFAULT_BASE_URL,
    credentialsUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key'
  },
  {
    id: 'modelscope',
    label: '魔塔',
    defaultBaseUrl: MODELSCOPE_DEFAULT_BASE_URL,
    credentialsUrl: 'https://modelscope.cn/my/myaccesstoken'
  },
  {
    id: 'comfyui',
    label: 'ComfyUI',
    defaultBaseUrl: COMFYUI_DEFAULT_BASE_URL,
    credentialsUrl: 'https://docs.comfy.org/development/api-development/getting-an-api-key'
  },
  {
    id: 'magicrouter',
    label: 'MagicRouter',
    defaultBaseUrl: MAGICROUTER_DEFAULT_BASE_URL,
    credentialsUrl: 'https://www.magicrouter.ai/docs/api'
  },
  {
    id: 'tripo',
    label: 'Tripo',
    defaultBaseUrl: 'https://api.tripo3d.ai',
    credentialsUrl: 'https://platform.tripo3d.ai/'
  },
  {
    id: 'meshy',
    label: 'Meshy',
    defaultBaseUrl: 'https://api.meshy.ai',
    credentialsUrl: 'https://www.meshy.ai/'
  },
  {
    id: 'hyper3d',
    label: 'Rodin（Hyper3D）',
    defaultBaseUrl: HYPER3D_DEFAULT_BASE_URL,
    credentialsUrl: 'https://hyper3d.ai/'
  },
  {
    id: 'luma',
    label: 'Luma AI',
    defaultBaseUrl: LUMA_DEFAULT_BASE_URL,
    credentialsUrl: 'https://lumalabs.ai/'
  },
  {
    id: 'lux3d',
    label: 'Lux3D',
    defaultBaseUrl: LUX3D_DEFAULT_BASE_URL,
    credentialsUrl: 'https://labs.aholo3d.cn/'
  }
]

export function modelProviderCredentialsUrl(kind: ModelProviderKind): string {
  return (
    MODEL_PROVIDER_KINDS.find((p) => p.id === kind)?.credentialsUrl ??
    MODEL_PROVIDER_KINDS[0]!.credentialsUrl
  )
}

export type ModelModality = 'text' | 'image' | 'video' | 'audio' | 'model3d'

export const MODEL_MODALITIES: readonly ModelModality[] = [
  'text',
  'image',
  'video',
  'audio',
  'model3d'
] as const

/** 拉取目录时缓存的模型元数据（随设置持久化，供生成参数 UI 离线使用） */
export interface SavedCatalogModelEntry {
  id: string
  name: string
  /** 与 CatalogModel.capabilities 同形：分辨率、时长、supported_frame_images 等 */
  capabilities?: Record<string, unknown>
}

/** 某一模态下勾选的模型 */
export interface ModalityModelConfig {
  selectedModelIds: string[]
  defaultModelId: string
  /** 已勾选模型的目录快照（拉取/勾选时写入） */
  catalog?: Record<string, SavedCatalogModelEntry>
}

export type ProviderModalityMap = Record<ModelModality, ModalityModelConfig>

/** 一个模型提供商实例：凭证共用，各模态分别勾选模型 */
export interface ModelProviderInstance {
  /** 本地实例 id */
  id: string
  providerKind: ModelProviderKind
  /** 显示名，默认等于提供商名 */
  label: string
  /** API Key */
  apiKey: string
  baseUrl: string
  /**
   * ComfyUI 本体地址（读 userdata / workflow）。
   * Base URL 仍是 comfy-api-proxy（默认 8189）；两套 ComfyUI 时填正在用的那套，例如 http://127.0.0.1:8188。
   */
  nativeBaseUrl?: string
  enabled: boolean
  /** 各模态下的模型勾选与默认项 */
  modalities: ProviderModalityMap
}

export function isVolcengineArkProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'volcengine-ark'
  return provider.providerKind === 'volcengine-ark'
}

export function isKlingProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'kling'
  return provider.providerKind === 'kling'
}

export function isMiniMaxProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'minimax'
  return provider.providerKind === 'minimax'
}

export function isDashScopeProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'dashscope'
  return provider.providerKind === 'dashscope'
}

export function isModelScopeProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'modelscope'
  return provider.providerKind === 'modelscope'
}

export function isOpenAiProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'openai'
  return provider.providerKind === 'openai'
}

export function isDeepSeekProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'deepseek'
  return provider.providerKind === 'deepseek'
}

export function isZhipuProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'zhipu'
  return provider.providerKind === 'zhipu'
}

export function isMoonshotProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'moonshot'
  return provider.providerKind === 'moonshot'
}

export function isXaiProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'xai'
  return provider.providerKind === 'xai'
}

export function isGoogleProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'google'
  return provider.providerKind === 'google'
}

export function isVllmProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'vllm'
  return provider.providerKind === 'vllm'
}

export function isOllamaProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'ollama'
  return provider.providerKind === 'ollama'
}

export function isLmStudioProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'lmstudio'
  return provider.providerKind === 'lmstudio'
}

export function isComfyUiProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'comfyui'
  return provider.providerKind === 'comfyui'
}

export function isMagicRouterProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'magicrouter'
  return provider.providerKind === 'magicrouter'
}

/** 支持 3D 模型生成（model3d）的提供商 kind */
export function isModel3dProviderKind(kind: ModelProviderKind): boolean {
  return (
    kind === 'meshy' || kind === 'tripo' || kind === 'hyper3d' || kind === 'luma' || kind === 'lux3d'
  )
}

/** 本机服务允许空 Key：vLLM / Ollama / LM Studio / ComfyUI（云端仍可填 Key） */
export function allowsEmptyApiKey(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  return isLocalOpenAiProvider(provider) || isComfyUiProvider(provider)
}

/** 本地 OpenAI 兼容推理服务：无需 API Key，允许空密钥使用 */
export const LOCAL_OPENAI_PROVIDER_KINDS: readonly ModelProviderKind[] = [
  'vllm',
  'ollama',
  'lmstudio'
]

export function isLocalOpenAiProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  const kind = typeof provider === 'string' ? provider : provider.providerKind
  return (LOCAL_OPENAI_PROVIDER_KINDS as readonly string[]).includes(kind)
}

/** 魔塔目录启发式：文生图 vs 文本/多模态对话 */
export function classifyModelScopeModelModality(model: {
  id?: string
  name?: string
}): ModelModality {
  const text = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase()
  if (
    /flux|sdxl|stable.?diffusion|majic|t2i|text2image|image.?gen|lora|wanx|kolors|playground/.test(
      text
    )
  ) {
    return 'image'
  }
  if (/t2v|i2v|text2video|image2video|video.?gen/.test(text)) {
    return 'video'
  }
  if (/tts|cosyvoice|speech|sambert/.test(text)) {
    return 'audio'
  }
  return 'text'
}

/**
 * 百炼目录启发式归类：万相图/视频 vs 千问文本。
 * 未命中图/视频规则的默认归入文本。
 */
export function classifyDashScopeModelModality(model: {
  id?: string
  name?: string
}): ModelModality {
  const text = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase()
  if (
    /wanx|wan2|t2i|text2image|image-synthesis|qwen-image|flux/.test(text) &&
    !/t2v|i2v|video/.test(text)
  ) {
    return 'image'
  }
  if (/t2v|i2v|video-synthesis|wan.*video|\bv2v\b|happyhorse|kling\/|kling-v3/.test(text)) {
    return 'video'
  }
  if (/cosyvoice|sambert|\btts\b|speech|fun-music|\bmusic\b/.test(text)) {
    return 'audio'
  }
  return 'text'
}

/**
 * 方舟 /models 无 OpenRouter 式模态目录，按接入点 id/名称启发式归类。
 * 未命中图片/视频/音频规则的默认归入文本。
 */
export function classifyVolcengineArkModelModality(
  model: { id?: string; name?: string }
): ModelModality {
  const text = `${model.id ?? ''} ${model.name ?? ''}`.toLowerCase()
  if (/seedream|seededit|img2img|\bt2i\b|\bi2i\b|image-generation/.test(text)) {
    return 'image'
  }
  if (/seedance|\bt2v\b|\bi2v\b|text2video|image2video|video-generation/.test(text)) {
    return 'video'
  }
  if (
    /bigtts|\btts\b|\bspeech\b|soudium|megatts|audio-generation|voice-generation|voice-clone|seed-icl|seed-tts/.test(
      text
    )
  ) {
    return 'audio'
  }
  return 'text'
}

export interface ModelsSettings {
  providers: ModelProviderInstance[]
}

export function createEmptyModalityConfig(): ModalityModelConfig {
  return { selectedModelIds: [], defaultModelId: '' }
}

export function createEmptyModalityMap(): ProviderModalityMap {
  return {
    text: createEmptyModalityConfig(),
    image: createEmptyModalityConfig(),
    video: createEmptyModalityConfig(),
    audio: createEmptyModalityConfig(),
    model3d: createEmptyModalityConfig()
  }
}

export function createEmptyModelsSettings(): ModelsSettings {
  return { providers: [] }
}

export function modalityConfig(
  provider: ModelProviderInstance,
  modality: ModelModality
): ModalityModelConfig {
  return provider.modalities[modality] ?? createEmptyModalityConfig()
}

export function findProviderById(
  providers: ModelProviderInstance[],
  id: string | undefined | null
): ModelProviderInstance | undefined {
  if (!id) return undefined
  return providers.find((p) => p.id === id)
}

function cloneJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  } catch {
    return { ...(value as Record<string, unknown>) }
  }
}

export function catalogEntryFromModel(
  model: Pick<CatalogModel, 'id' | 'name' | 'capabilities'>
): SavedCatalogModelEntry {
  const capabilities = cloneJsonRecord(model.capabilities)
  return {
    id: model.id,
    name: model.name?.trim() || model.id,
    ...(capabilities ? { capabilities } : {})
  }
}

/** 按当前勾选列表，用远端目录刷新/裁剪 catalog 快照 */
export function syncModalityCatalogEntries(
  config: ModalityModelConfig,
  models: Array<Pick<CatalogModel, 'id' | 'name' | 'capabilities'>>
): void {
  const byId = new Map(models.map((m) => [m.id, m]))
  const next: Record<string, SavedCatalogModelEntry> = { ...(config.catalog ?? {}) }
  for (const id of config.selectedModelIds) {
    const model = byId.get(id)
    if (model) next[id] = catalogEntryFromModel(model)
  }
  for (const id of Object.keys(next)) {
    if (!config.selectedModelIds.includes(id)) delete next[id]
  }
  config.catalog = Object.keys(next).length ? next : undefined
}

/** 读取设置里已缓存的模型能力（不发起目录请求） */
export function getSavedModelCatalogEntry(
  providers: ModelProviderInstance[] | undefined,
  providerInstanceId: string,
  modality: ModelModality,
  modelId: string
): SavedCatalogModelEntry | null {
  const provider = findProviderById(providers ?? [], providerInstanceId)
  if (!provider) return null
  return modalityConfig(provider, modality).catalog?.[modelId] ?? null
}

export function createProviderInstance(
  kind: ModelProviderKind = 'openrouter',
  overrides?: Partial<ModelProviderInstance>
): ModelProviderInstance {
  const meta = MODEL_PROVIDER_KINDS.find((p) => p.id === kind) ?? MODEL_PROVIDER_KINDS[0]
  const base: ModelProviderInstance = {
    id: newLocalId(),
    providerKind: kind,
    label: meta.label,
    apiKey: '',
    baseUrl: meta.defaultBaseUrl,
    nativeBaseUrl: '',
    enabled: true,
    modalities: createEmptyModalityMap()
  }
  if (!overrides) return base
  return normalizeProviderInstance({ ...base, ...overrides }) ?? base
}

/** 目录中的通用模型条目（UI 列表用） */
export interface CatalogModel {
  id: string
  name: string
  description?: string
  modality: ModelModality
  /** 原始能力字段，便于 UI 展示参数范围 */
  capabilities?: Record<string, unknown>
}

export interface OpenRouterTextModel {
  id: string
  name: string
  description?: string
  created?: number
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
    modality?: string
  }
  pricing?: Record<string, string>
  context_length?: number
  supported_parameters?: string[]
  /** TTS 模型可用声音 */
  supported_voices?: string[]
}

/**
 * 目录项是否适合「文本」模态勾选。
 * 有 output_modalities 时须含 text；无标注时保留（兼容未声明模态的网关）。
 */
export function isTextCatalogModel(model: {
  architecture?: { output_modalities?: string[] | null } | null
}): boolean {
  const outs = model.architecture?.output_modalities
  if (!outs || outs.length === 0) return true
  return outs.includes('text')
}

export interface OpenRouterImageModel {
  id: string
  name: string
  description?: string
  created?: number
  architecture?: {
    input_modalities?: string[]
    output_modalities?: string[]
  }
  supported_parameters?: Record<string, unknown>
  supports_streaming?: boolean
}

export interface OpenRouterVideoModel {
  id: string
  name: string
  description?: string
  created?: number
  supported_resolutions?: string[]
  supported_aspect_ratios?: string[]
  supported_sizes?: string[]
  supported_durations?: number[]
  supported_frame_images?: string[] | null
  generate_audio?: boolean | null
  seed?: boolean | null
  pricing_skus?: Record<string, string>
  allowed_passthrough_parameters?: string[]
}

export interface ListModelsInput {
  modality: ModelModality
  /** 提供商实例 id；已保存配置时用于查找 */
  providerInstanceId: string
  /** 未点保存时由前端直接传入，避免读到旧密钥 */
  apiKey?: string
  baseUrl?: string
  /** ComfyUI 本体地址（读 workflow）；未保存时由设置页传入 */
  nativeBaseUrl?: string
  providerKind?: ModelProviderKind
}

export interface GenerateTextInput {
  prompt: string
  system?: string
  model?: string
  /** 不传则取 settings.models.providers 中该模态首个已启用且有密钥的实例 */
  providerInstanceId?: string
  /** 视觉输入：data URL 或 http(s) URL，走 chat/completions 多模态 */
  images?: string[]
}

export interface GenerateTextResult {
  text: string
  model: string
}

/** 图片生成参考图元信息：用于执行日志展示来源与落盘路径，不落 data URL */
export interface GraphImageReferenceMeta {
  /** 来源：风格库 / 端口参考图 / 角色一致性 */
  source: 'style' | 'port' | 'character'
  /** 端口参考图落盘相对路径（风格库条目通常无工程相对路径） */
  relativePath?: string
  /** 风格库条目名 / 自定义上传图名 */
  name?: string
}

export interface GenerateImageInput {
  prompt: string
  model?: string
  providerInstanceId?: string
  aspectRatio?: string
  resolution?: string
  /** OpenRouter quality：auto / low / medium / high */
  quality?: string
  n?: number
  /** 随机种子：固定后同参数可复现；缺省由服务端随机 */
  seed?: number
  /** 参考图 data URL 或 http(s) */
  inputReferences?: string[]
  /** MCP：工程内相对输出目录（generateImageAsset 落盘位置，缺省 Cache/Images 只落盘不登记资产；指定 Assets/ 下目录则登记为资产） */
  outputDir?: string
  /** 与 inputReferences 一一对应的参考图元信息（仅用于日志） */
  inputReferenceMeta?: GraphImageReferenceMeta[]
  /** Seedream 5.0 Pro：图层分离（layer_decomposition） */
  layerDecomposition?: boolean
}

export interface GenerateImageLayer {
  url: string
  zIndex: number
  size?: string
  outputFormat?: string
  boundingBox?: {
    absolute?: [number, number, number, number]
    normalized?: [number, number, number, number]
  }
  name?: string
  description?: string
}

export interface GenerateImageResult {
  /** data:image/...;base64,... 或远程 URL */
  images: string[]
  model: string
  /** layer_decomposition 时与 images 对齐的图层元数据 */
  layers?: GenerateImageLayer[]
}

/** OpenRouter `/videos` 的 `input_references` 条目类型 */
export type VideoInputReferenceKind = 'image_url' | 'video_url' | 'audio_url'

export interface VideoInputReference {
  kind: VideoInputReferenceKind
  /** data URL 或 http(s) */
  url: string
}

/** 字符串视为 image_url */
export type GenerateVideoInputReference = string | VideoInputReference

/** 生成任务回写图节点的绑定（宿主资产 id + 节点 id，供重启后节点状态与后台任务对齐） */
export interface GenerateGraphBinding {
  hostId?: string
  nodeId?: string
  assetId?: string
  shotId?: string
  canvasField?: string
}

export interface GenerateVideoInput {
  prompt: string
  model?: string
  providerInstanceId?: string
  duration?: number
  resolution?: string
  aspectRatio?: string
  size?: string
  generateAudio?: boolean
  seed?: number
  /** data URL 或 http(s) */
  firstFrameImageUrl?: string
  /** MCP：生成资产挂到的资产库文件夹 id */
  folderId?: string
  lastFrameImageUrl?: string
  /**
   * 参考资源：图片全模型可用；video_url / audio_url 目前主要 Seedance 2.0 生效。
   */
  inputReferences?: GenerateVideoInputReference[]
  /** 视频主落盘目录（相对工程根）；缺省 Cache/Videos */
  outputDir?: string
  /** 落盘文件名 stem（含宿主/节点/时间戳） */
  name?: string
  /** 图节点回写绑定 */
  graphBinding?: GenerateGraphBinding
}

export interface GenerateVideoResult {
  /** 已登记的视频资产 id */
  assetId: string
  relativePath: string
  model: string
  /** 参考视频上传到对象存储的记录（便于日志展示） */
  uploads?: Array<{
    objectKey: string
    url: string
    bytes: number
    sourceLabel: string
    logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>
  }>
}

export interface GenerateVideoJob {
  jobId: string
  pollingUrl: string
  status: string
  model: string
}

// ── 3D 模型生成 ──────────────────────────────────────────

export interface GenerateModel3dInput {
  prompt: string
  model?: string
  providerInstanceId?: string
  /**
   * 风格（Lux3D 文生3D）：photorealistic / cartoon / anime /
   * hand_painted / cyberpunk / fantasy / glass；缺省 photorealistic。
   * 图生3D 无该参数，适配器会忽略。
   */
  style?: string
  /** 参考图（图生3D/多图生3D） */
  inputReferences?: GenerateVideoInputReference[]
  /** 落盘目录（相对工程根） */
  outputDir?: string
  /** MCP：生成资产挂到的资产库文件夹 id */
  folderId?: string
  /** 落盘文件名 stem */
  name?: string
  /** 图节点回写绑定 */
  graphBinding?: GenerateGraphBinding
}

export interface GenerateModel3dResult {
  /** 已登记的模型资产 id */
  assetId: string
  relativePath: string
  model: string
}

export interface GenerateModel3dJob {
  jobId: string
  pollingUrl: string
  status: string
  model: string
}

export function normalizeVideoInputReference(
  ref: GenerateVideoInputReference
): VideoInputReference {
  if (typeof ref === 'string') {
    return { kind: 'image_url', url: ref }
  }
  return {
    kind: ref.kind,
    url: ref.url
  }
}

/** 转为 OpenRouter `input_references` 请求项 */
export function toOpenRouterInputReferenceBody(
  ref: GenerateVideoInputReference
): Record<string, unknown> {
  const normalized = normalizeVideoInputReference(ref)
  if (normalized.kind === 'video_url') {
    return { type: 'video_url', video_url: { url: normalized.url } }
  }
  if (normalized.kind === 'audio_url') {
    return { type: 'audio_url', audio_url: { url: normalized.url } }
  }
  return { type: 'image_url', image_url: { url: normalized.url } }
}

export interface GenerateSpeechInput {
  /** 文本提示 / 台词（声音设计时为 text_prompt） */
  input: string
  model?: string
  providerInstanceId?: string
  /** 声音；未传时取模型 supported_voices[0] 或 alloy；方舟声音设计为 speaker_id */
  voice?: string
  responseFormat?: 'mp3' | 'pcm'
  speed?: number
  name?: string
  /**
   * 可选参考图（data URL 或 http(s)）。
   * 方舟 voice_design 使用首张：data URL → image_bytes，否则 image_url。
   */
  images?: string[]
  /** 角色音色档案中的角色名：生成前按档案解析 voice / referenceAudio（未显式传时） */
  voiceProfile?: string
  /**
   * 声音克隆参考音频：工程内相对路径或 http(s) URL（10-30s 人声）。
   * 火山方舟 openspeech 走 few-shot 声音复刻；不支持的提供商将给出明确错误。
   */
  referenceAudio?: string
  /** 音频主落盘目录（相对工程根）；空则默认宿主资产下 Audio */
  outputDir?: string
}

export interface GenerateSpeechResult {
  model: string
  voice: string
  format: 'mp3' | 'pcm'
  /** 本地临时/资产绝对路径（主进程） */
  filePath?: string
  assetId?: string
  relativePath?: string
}

// ── 音乐 / BGM 生成 ──────────────────────────────────────────

export interface GenerateMusicInput {
  /** 音乐描述：风格 / 情绪 / 场景（如「轻快明亮的电子配乐，适合 Vlog 背景」） */
  prompt: string
  /** 歌词（纯音乐时可省略）；多段用 \n 分隔，支持 [Intro]/[Verse]/[Chorus] 等结构标签 */
  lyrics?: string
  /** 是否纯音乐（无歌词 / 人声）；缺省 true */
  instrumental?: boolean
  model?: string
  providerInstanceId?: string
  /** 输出目录（相对工程根）；缺省 Cache/Music */
  outputDir?: string
  /** 落盘文件名 stem */
  name?: string
  /** MCP：生成资产挂到的资产库文件夹 id */
  folderId?: string
}

/** 门面层音乐生成原始结果（尚未落盘；downloadUrl 由门面下载后登记资产） */
export interface GenerateMusicResult {
  model: string
  /** 音频下载地址（http(s)） */
  downloadUrl: string
  /** 音频时长（毫秒；服务端未返回时缺省） */
  durationMs?: number
}

/** 已落盘的 BGM 音乐资产（复用 voice 资产类型，便于时间线 music 轨直接铺轨） */
export interface GenerateMusicAssetResult {
  /** 已登记的声音资产 id */
  assetId: string
  relativePath: string
  model: string
  durationMs?: number
}

/** 音频转写（语音识别）输入：工程内音频文件 + 可选模型/提供商 */
export interface TranscribeAudioInput {
  /** 工程内相对路径（主进程按工程根解析为绝对路径） */
  relativePath?: string
  /** 绝对路径（调试/外部文件；优先于 relativePath） */
  absPath?: string
  /** 转写模型 id；缺省由适配器决定（OpenAI 为 whisper-1） */
  model?: string
  /** 提供商实例 id；缺省自动选首个支持转写的已配置提供商 */
  providerInstanceId?: string
  /** 音频语言代码（如 zh / en），帮助识别准确率 */
  language?: string
  /** 提示词：用于纠正识别（可选，OpenAI whisper 支持） */
  prompt?: string
}

/** 一条带时间戳的转写片段 */
export interface TranscribeAudioSegment {
  startSec: number
  endSec: number
  text: string
}

export interface TranscribeAudioResult {
  /** 按时间排序的分段结果（服务未返回时间戳时只有一段） */
  segments: TranscribeAudioSegment[]
  /** 整段文本（未分词时的兜底内容） */
  text?: string
  model: string
  language?: string
}

/** 从 AppSettings.models 解析当前可用提供商 + 默认模型 */
export function pickActiveProvider(
  providers: ModelProviderInstance[],
  modality: ModelModality,
  preferredInstanceId?: string,
  preferredModelId?: string
): { provider: ModelProviderInstance; modelId: string } | null {
  const candidates = providers.filter((p) => {
    if (!p.enabled) return false
    // 本地 OpenAI 兼容服务与 ComfyUI 允许空 API Key（云端 Comfy 仍可填 Key）
    if (!p.apiKey.trim() && !allowsEmptyApiKey(p)) return false
    return modalityConfig(p, modality).selectedModelIds.length > 0
  })
  if (!candidates.length) return null

  const provider =
    (preferredInstanceId ? findProviderById(candidates, preferredInstanceId) : undefined) ??
    candidates[0]

  const selected = modalityConfig(provider, modality).selectedModelIds
  const defaultModelId = modalityConfig(provider, modality).defaultModelId
  const modelId =
    (preferredModelId && selected.includes(preferredModelId) ? preferredModelId : undefined) ??
    (defaultModelId && selected.includes(defaultModelId) ? defaultModelId : undefined) ??
    selected[0]

  if (!modelId) return null
  return { provider, modelId }
}

export function normalizeModelsSettings(raw?: unknown): ModelsSettings {
  if (!raw || typeof raw !== 'object') return createEmptyModelsSettings()
  const providers = (raw as { providers?: unknown }).providers
  if (!Array.isArray(providers)) return createEmptyModelsSettings()
  return {
    providers: providers
      .map((item) => normalizeProviderInstance((item ?? {}) as Partial<ModelProviderInstance>))
      .filter((item): item is ModelProviderInstance => item != null)
  }
}

function newLocalId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    /* fall through */
  }
  return `mp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeSavedCatalog(
  raw: unknown,
  selected: string[]
): Record<string, SavedCatalogModelEntry> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, SavedCatalogModelEntry> = {}
  for (const id of selected) {
    const item = src[id]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : id
    const capabilities = cloneJsonRecord(row.capabilities)
    out[id] = { id, name, ...(capabilities ? { capabilities } : {}) }
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeModalityConfig(raw?: Partial<ModalityModelConfig> | null): ModalityModelConfig {
  const selected = Array.isArray(raw?.selectedModelIds)
    ? raw.selectedModelIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  const defaultModelId =
    typeof raw?.defaultModelId === 'string' && selected.includes(raw.defaultModelId)
      ? raw.defaultModelId
      : (selected[0] ?? '')
  const catalog = normalizeSavedCatalog(raw?.catalog, selected)
  return {
    selectedModelIds: selected,
    defaultModelId,
    ...(catalog ? { catalog } : {})
  }
}

function normalizeModalityMap(raw?: Partial<ProviderModalityMap> | null): ProviderModalityMap {
  const empty = createEmptyModalityMap()
  if (!raw || typeof raw !== 'object') return empty
  return {
    text: normalizeModalityConfig(raw.text),
    image: normalizeModalityConfig(raw.image),
    video: normalizeModalityConfig(raw.video),
    audio: normalizeModalityConfig(raw.audio),
    model3d: normalizeModalityConfig(raw.model3d)
  }
}

function normalizeProviderKind(raw: unknown): ModelProviderKind | null {
  if (typeof raw !== 'string') return null
  return MODEL_PROVIDER_KINDS.some((p) => p.id === raw) ? (raw as ModelProviderKind) : null
}

/** 旧版「海螺 AI」展示名迁移为 MiniMax（自定义其它名称仍保留） */
function resolveProviderDisplayLabel(
  kind: ModelProviderKind,
  rawLabel: unknown,
  metaLabel: string
): string {
  const label = typeof rawLabel === 'string' ? rawLabel.trim() : ''
  if (!label) return metaLabel
  if (
    kind === 'minimax' &&
    /^(海螺\s*AI|Hailuo(\s*AI)?(\s*\/\s*MiniMax)?|Hailuo\s*\(\s*MiniMax\s*\)|MinMax)$/i.test(
      label
    )
  ) {
    return metaLabel
  }
  return label
}

function normalizeProviderInstance(
  item: Partial<ModelProviderInstance>
): ModelProviderInstance | null {
  const kind = normalizeProviderKind(item.providerKind)
  if (!kind) return null
  const meta = MODEL_PROVIDER_KINDS.find((p) => p.id === kind)!
  return {
    id: typeof item.id === 'string' && item.id ? item.id : newLocalId(),
    providerKind: kind,
    label: resolveProviderDisplayLabel(kind, item.label, meta.label),
    apiKey: typeof item.apiKey === 'string' ? item.apiKey : '',
    baseUrl:
      typeof item.baseUrl === 'string' && item.baseUrl.trim()
        ? item.baseUrl.replace(/\/$/, '')
        : meta.defaultBaseUrl,
    nativeBaseUrl:
      kind === 'comfyui' && typeof item.nativeBaseUrl === 'string' && item.nativeBaseUrl.trim()
        ? item.nativeBaseUrl.replace(/\/$/, '')
        : '',
    enabled: item.enabled !== false,
    modalities: normalizeModalityMap(item.modalities)
  }
}
