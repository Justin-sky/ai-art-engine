/** Model provider + catalog types shared by main/renderer */

import { meshOpsProvidersFor } from './meshOps'

export const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
/** OpenAI 官方 API（文本 / 图片） */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'
/** Anthropic Messages API（Claude；认证 x-api-key + anthropic-version） */
export const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.anthropic.com'
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
export const VOLCENGINE_OPENSPEECH_CREDENTIALS_URL = 'https://console.volcengine.com/speech/app'
/** 可灵（Kling）国内开放平台 */
export const KLING_DEFAULT_BASE_URL = 'https://api-beijing.klingai.com'
/** MiniMax（原海螺 AI）国内开放平台 */
export const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimaxi.com'
/** 通义千问 / 万相（阿里云百炼 DashScope OpenAI 兼容） */
export const DASHSCOPE_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
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
/** World Labs Marble（空间世界生成；WLT-Api-Key 鉴权，异步 operation 轮询） */
export const WORLDLABS_DEFAULT_BASE_URL = 'https://api.worldlabs.ai'
/** TypeSafe（Jev 等 System One 决策模型）：直连 `https://api.typesafe.ai`，Bearer 鉴权 */
export const TYPESAFE_DEFAULT_BASE_URL = 'https://api.typesafe.ai'
/**
 * ElevenLabs（语音合成）。
 *
 * 鉴权是 `xi-api-key` 请求头（不是 Bearer）；语音合成走
 * `POST /v1/text-to-speech/{voice_id}`，音色与模型各有目录端点
 * （`GET /v1/voices`、`GET /v1/models`），详见 `shared/modelProviders/elevenlabs`。
 */
export const ELEVENLABS_DEFAULT_BASE_URL = 'https://api.elevenlabs.io'
/**
 * NewAPI 中转网关（自建，OpenAI 兼容）。
 *
 * NewAPI 是自托管软件，没有官方公共域名，所以这里给的是占位地址，用户必须改成自己的网关。
 * 与「自定义提供商」的区别：NewAPI 会公开 `GET /api/pricing` 端点字典，模型条目带
 * `supported_endpoint_types`，可据此精确判定模型走对话还是出图端点（见
 * `shared/modelProviders/newapi/modelCapabilities.ts`），不必只靠 id 命名猜。
 */
export const NEWAPI_DEFAULT_BASE_URL = 'https://your-newapi.example.com/v1'
/** TypeSafe System One 端点（含 /v1，与 Base URL 直接拼接） */
export const TYPESAFE_SYSTEMONE_PATH = '/v1/systemone'

/**
 * TypeSafe System One 端点 URL：用户填的是 API 根（`https://api.typesafe.ai`），
 * 端点挂在其下的 `/v1/systemone`。设置页里若有人多填了 `/v1`，这里去掉避免出现 `/v1/v1/...`。
 */
export function resolveTypeSafeSystemOneUrl(baseUrl: string): string {
  const base = (baseUrl || TYPESAFE_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  return `${base.replace(/\/v1$/i, '')}${TYPESAFE_SYSTEMONE_PATH}`
}

export type ModelProviderKind =
  | 'openrouter'
  | 'typesafe'
  | 'openai'
  | 'anthropic'
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
  /** NewAPI 中转网关（自建，OpenAI 兼容；按 /api/pricing 端点元数据区分对话与出图） */
  | 'newapi'
  | 'tripo'
  | 'meshy'
  | 'hyper3d'
  | 'luma'
  | 'lux3d'
  /** World Labs（Marble 空间世界生成） */
  | 'worldlabs'
  /** ElevenLabs（语音合成；xi-api-key 鉴权，音色/模型各有目录端点） */
  | 'elevenlabs'
  /** 自定义提供商：端点类型由实例级 apiStyle 决定 */
  | 'custom'

/**
 * 自定义提供商的端点（协议）类型。
 * - openai：OpenAI 兼容（/chat/completions + /models），覆盖绝大多数中转站 / one-api / vLLM 等
 * - anthropic：Anthropic Messages API（/v1/messages + /v1/models），如 Claude 官方与 Anthropic 兼容代理
 * - gemini：Gemini 兼容（走 Google 官方 OpenAI 兼容层与多数 Gemini 网关），/chat/completions + /models
 */
export type CustomApiStyle = 'openai' | 'anthropic' | 'gemini'

export const DEFAULT_CUSTOM_API_STYLE: CustomApiStyle = 'openai'

export function isCustomApiStyle(value: unknown): value is CustomApiStyle {
  return value === 'openai' || value === 'anthropic' || value === 'gemini'
}

export function isCustomProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'custom'
  return provider.providerKind === 'custom'
}

/** 自定义提供商的端点类型：非法/缺失时回退 openai */
export function resolveCustomApiStyle(provider: ModelProviderInstance): CustomApiStyle {
  return isCustomApiStyle(provider.apiStyle) ? provider.apiStyle : DEFAULT_CUSTOM_API_STYLE
}

export interface ModelProviderKindMeta {
  id: ModelProviderKind
  label: string
  /** 需本地化的展示名（如「自定义」）走 vue-i18n；品牌名不设此字段 */
  labelKey?: string
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
    id: 'typesafe',
    label: 'TypeSafe（Jev）',
    defaultBaseUrl: TYPESAFE_DEFAULT_BASE_URL,
    credentialsUrl: 'https://docs.typesafe.ai/'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultBaseUrl: OPENAI_DEFAULT_BASE_URL,
    credentialsUrl: 'https://platform.openai.com/api-keys'
  },
  {
    id: 'anthropic',
    label: 'Anthropic（Claude）',
    defaultBaseUrl: ANTHROPIC_DEFAULT_BASE_URL,
    credentialsUrl: 'https://console.anthropic.com/settings/keys'
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
    credentialsUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key'
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
    id: 'newapi',
    label: 'NewAPI',
    /** 自建网关，默认地址是占位值，必须改成用户自己的站；出图按 /api/pricing 元数据判定 */
    defaultBaseUrl: NEWAPI_DEFAULT_BASE_URL,
    credentialsUrl: 'https://docs.newapi.pro/zh/docs'
  },
  {
    id: 'tripo',
    label: 'Tripo',
    // v3 API（openapi.tripo3d.ai/v3）；v2 的 api.tripo3d.ai 由 tripo/adapter.ts 自动映射
    defaultBaseUrl: 'https://openapi.tripo3d.ai',
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
  },
  {
    id: 'worldlabs',
    label: 'World Labs（Marble）',
    defaultBaseUrl: WORLDLABS_DEFAULT_BASE_URL,
    credentialsUrl: 'https://platform.worldlabs.ai/api-keys'
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    defaultBaseUrl: ELEVENLABS_DEFAULT_BASE_URL,
    credentialsUrl: 'https://elevenlabs.io/app/settings/api-keys'
  },
  {
    id: 'custom',
    label: '自定义', // cjk-ok 落盘默认实例名（用户可改）；下拉与列表显示走 labelKey → vue-i18n
    labelKey: 'settings.models.providerCustom',
    /** Base URL 由用户填写，无默认端点 */
    defaultBaseUrl: '',
    /** 无统一申请页；提示文案见 settings.models.customApiStyleHint */
    credentialsUrl: ''
  }
]

export function modelProviderCredentialsUrl(kind: ModelProviderKind): string {
  return (
    MODEL_PROVIDER_KINDS.find((p) => p.id === kind)?.credentialsUrl ??
    MODEL_PROVIDER_KINDS[0]!.credentialsUrl
  )
}

export type ModelModality =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  /** 音乐生成（BGM / 配乐）：与「声音（TTS）」分开，模型与端点都不同 */
  | 'music'
  | 'model3d'
  | 'spatialWorld'
  | 'decisions'

export const MODEL_MODALITIES: readonly ModelModality[] = [
  'text',
  'image',
  'video',
  'audio',
  /**
   * 音乐生成（BGM / 配乐）。
   * 与 audio 分开：audio 是语音合成（TTS，`text` + `voice`），音乐是编曲
   * （`prompt` + 歌词 / 纯音乐），端点和模型体系都不一样 ——
   * 混在一个页签里会让「声音节点的模型下拉」出现 music_v2_5 这种不能合成的模型。
   */
  'music',
  'model3d',
  /** 空间世界（World Labs Marble）：从文本 / 图片生成可交互 3D 世界 */
  'spatialWorld',
  /** OpenRouter Decisions API（TypeSafe Jev 等）：输出结构化判定而非文本 */
  'decisions'
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
  /**
   * 该模态的默认声音（仅 audio 模态使用）。
   * TTS 的 `voice` 是必需请求字段，不填只能靠厂商默认值——聚合器上各家默认音色名不同，
   * 所以允许在设置里显式指定；生成时若节点/参数没给 voice 就取它。
   */
  defaultVoice?: string
  /**
   * 音色 id → 展示名（仅 audio 模态使用）。
   *
   * ElevenLabs 这类供应商的音色是**不透明 id**（`21m00Tcm4TlvDq8ikWAM`），
   * 光看 id 用户没法选；目录端点能给出 `Sarah - Mature, Reassuring` 这样的名字。
   * 名字不随模型变（音色属于账号而不是模型），所以与 catalog 并列存一份即可，
   * 不必在每个模型条目里各存一遍。
   */
  voiceLabels?: Record<string, string>
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
  /** 自定义提供商（providerKind === 'custom'）的端点类型；其它提供商忽略该字段 */
  apiStyle?: CustomApiStyle
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

/**
 * 哪些提供商能做「声音（TTS / 语音合成）」。
 *
 * 单一事实来源：设置页的模态页签、生成节点的模型下拉、以及「下拉为空」的成因解释
 * 都调它。这三处历史上各写了一份判断，接完 OpenAI / OpenRouter 的 TTS 之后
 * 设置里能勾模型、声音节点却显示「暂无可用模型」——就是因为节点侧那份没同步。
 * 新增一家 TTS 提供商时只改这里。
 */
export function supportsAudioModality(kind: ModelProviderKind): boolean {
  // 走 OpenAI 兼容 POST /audio/speech（model + input + voice）：OpenAI 官方与 OpenRouter
  // （以及它们背后那些同样实现该协议的聚合器）
  if (kind === 'openai' || kind === 'openrouter') return true
  // ElevenLabs 自己的协议：POST /v1/text-to-speech/{voice_id}，音色是 voice_id
  if (kind === 'elevenlabs') return true
  // 各家私有协议：方舟 openspeech 声音设计 / MiniMax 音色设计 / ComfyUI 音频工作流
  return kind === 'volcengine-ark' || kind === 'minimax' || kind === 'comfyui'
}

/**
 * 谁支持**音乐生成**（BGM / 配乐）。
 *
 * 与 `supportsAudioModality` 分开：音乐是编曲（prompt + 歌词 / 纯音乐），
 * 语音合成是 TTS（text + voice）—— 两边的端点和模型体系都不同，
 * 一家支持 TTS 不代表支持音乐（OpenAI 就没有音乐端点）。
 * 设置页「音乐」页签、音乐节点的选型、空列表成因判定都只认这一处。
 */
export function supportsMusicModality(kind: ModelProviderKind): boolean {
  // ElevenLabs `/v1/music`（music_v1 | music_v2 | music_v2_5）
  if (kind === 'elevenlabs') return true
  // MiniMax music-3.0 / 通义千问（百炼）Fun-Music：各家私有音乐端点
  if (kind === 'minimax' || kind === 'dashscope') return true
  /**
   * OpenRouter：聚合了 Google Lyria 3 音乐生成（`google/lyria-3-*`）。
   * 它**没有** `/v1/music` 端点，音乐走的是 `POST /audio/speech`（与 TTS 同端点）——
   * 所以不能按「有没有音乐端点」判断，要看目录里有没有音乐模型
   * （见 shared/modelProviders/openrouter/audioModality.ts）。
   */
  return kind === 'openrouter'
}

/**
 * 谁支持**音效生成**（`POST /v1/sound-generation`）。
 *
 * 与 `supportsAudioModality` 分开，理由和音乐一样：一家能做 TTS 不代表能做音效，
 * 这张表的粒度是「**具体端点**」而不是「音频这一大类」。
 *
 * 为什么必须单独有一张表：音效节点的提供商解析如果只看「audio 桶里勾了模型」，
 * 就会选中一家**不会做音效**的（OpenAI / MiniMax / 方舟都有 TTS），
 * 然后才在适配器那层报「不支持」—— 用户看到的是「我配了 ElevenLabs 却说我不支持」。
 * 设置页的音效选择器、节点下拉、主进程解析、空列表成因解释都只认这一处。
 */
export function supportsSoundEffect(kind: ModelProviderKind): boolean {
  // 目前只有 ElevenLabs 实现了该端点（唯一模型 eleven_text_to_sound_v2）
  return kind === 'elevenlabs'
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

export function isAnthropicProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  if (typeof provider === 'string') return provider === 'anthropic'
  return provider.providerKind === 'anthropic'
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

/**
 * 提供决策判定协议（noul / choice / score）的供应商 kind。
 * 两家的请求与应答实测一致，只是端点与鉴权不同：
 * OpenRouter `/api/alpha/decisions`、TypeSafe `/v1/systemone`。
 */
export const DECISION_PROVIDER_KINDS: readonly ModelProviderKind[] = ['openrouter', 'typesafe']

/** 该供应商 kind 是否提供决策判定 */
export function isDecisionProviderKind(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  const kind = typeof provider === 'string' ? provider : provider.providerKind
  return (DECISION_PROVIDER_KINDS as readonly string[]).includes(kind)
}

/** 支持 3D 模型生成（model3d）的提供商 kind */
export function isModel3dProviderKind(kind: ModelProviderKind): boolean {
  return (
    kind === 'meshy' ||
    kind === 'tripo' ||
    kind === 'hyper3d' ||
    kind === 'luma' ||
    kind === 'lux3d'
  )
}

/** 支持空间世界生成（world）的提供商 kind */
export const WORLD_PROVIDER_KINDS: readonly ModelProviderKind[] = ['worldlabs']

export function isWorldProviderKind(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  const kind = typeof provider === 'string' ? provider : provider.providerKind
  return (WORLD_PROVIDER_KINDS as readonly string[]).includes(kind)
}

/** 本机服务允许空 Key：vLLM / Ollama / LM Studio / ComfyUI（云端仍可填 Key） */
export function allowsEmptyApiKey(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (isLocalOpenAiProvider(provider) || isComfyUiProvider(provider)) return true
  // ElevenLabs 的模型与音色目录都是公开可读的（实测 /v1/voices 无 Key 返回 200），
  // 允许先配置、看目录、再补 Key —— 真正生成时 assertAuth / 上游会明确报缺密钥。
  return isElevenLabsProvider(provider)
}

/** ElevenLabs（语音合成；xi-api-key 鉴权，目录端点公开可读） */
export function isElevenLabsProvider(
  provider: Pick<ModelProviderInstance, 'providerKind'> | ModelProviderKind | undefined | null
): boolean {
  if (!provider) return false
  const kind = typeof provider === 'string' ? provider : provider.providerKind
  return kind === 'elevenlabs'
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
export function classifyVolcengineArkModelModality(model: {
  id?: string
  name?: string
}): ModelModality {
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
    music: createEmptyModalityConfig(),
    model3d: createEmptyModalityConfig(),
    spatialWorld: createEmptyModalityConfig(),
    decisions: createEmptyModalityConfig()
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

/**
 * 部分 provider 的官方目录只返回模型 id、不返回展示名（如 DeepSeek 的 GET /models），
 * 这里补一份「id → 人话名」映射，设置列表与生成模型下拉共用；
 * 未命中的 id 原样返回，保证新模型上线时仍可见（只是名字等于 id）。
 */
const PROVIDER_MODEL_DISPLAY_NAMES: Partial<Record<ModelProviderKind, Record<string, string>>> = {
  deepseek: {
    'deepseek-flash': 'DeepSeek V4.1 Flash',
    'deepseek-v4-pro': 'DeepSeek V4 Pro',
    'deepseek-v4-flash': 'DeepSeek V4 Flash (legacy alias → V4.1 Flash)',
    'deepseek-v4-flash-vision-exp': 'DeepSeek V4 Flash Vision (legacy alias → V4.1 Flash)'
  },
  anthropic: {
    'claude-opus-4-20250514': 'Claude Opus 4',
    'claude-sonnet-4-20250514': 'Claude Sonnet 4',
    'claude-3-7-sonnet-20250219': 'Claude Sonnet 3.7',
    'claude-3-5-sonnet-20241022': 'Claude Sonnet 3.5',
    'claude-3-5-haiku-20241022': 'Claude Haiku 3.5',
    'claude-3-opus-20240229': 'Claude Opus 3',
    'claude-3-haiku-20240307': 'Claude Haiku 3'
  }
}

/** 目录不提供展示名时的兜底：命中内置映射返回人话名，否则原样返回 id */
export function providerModelDisplayName(kind: ModelProviderKind, modelId: string): string {
  const id = modelId.trim()
  return PROVIDER_MODEL_DISPLAY_NAMES[kind]?.[id.toLowerCase()] ?? id
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
    ...(kind === 'custom' ? { apiStyle: DEFAULT_CUSTOM_API_STYLE } : {}),
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
  /** 自定义提供商的端点类型；未保存时由设置页传入 */
  apiStyle?: CustomApiStyle
}

/** 音色标签查询：字段与 ListModelsInput 一致（同一套「未保存覆盖」口径） */
export type SpeechVoiceLabelsInput = Omit<ListModelsInput, 'modality'>

export interface GenerateTextInput {
  prompt: string
  system?: string
  model?: string
  /** 不传则取 settings.models.providers 中该模态首个已启用且有密钥的实例 */
  providerInstanceId?: string
  /** 视觉输入：data URL 或 http(s) URL，走 chat/completions 多模态 */
  images?: string[]
  /**
   * OpenAI 风格 tool schema。LLM agent 多轮调用走这条；
   * 设了则一并下发 `tool_choice: 'auto'`（除非显式覆盖），让模型自行决定何时调用。
   */
  tools?: ReadonlyArray<GenerateTextTool>
  /** 'auto' | 'none' | { type:'function', function:{name}; }
   *  未传但带了 tools 时默认 'auto'；不想让模型调 tool 时显式传 'none'。 */
  toolChoice?: GenerateTextToolChoice
}

/** OpenAI 风格 tool schema 的最小子集（足够 agent loop 用） */
export interface GenerateTextTool {
  type: 'function'
  function: {
    name: string
    description?: string
    /** JSON Schema 对象（OpenAI 兼容端点接受 properties/required） */
    parameters?: Record<string, unknown>
  }
}

export type GenerateTextToolChoice =
  'auto' | 'none' | { type: 'function'; function: { name: string } }

/** 单次 tool_call（OpenAI 风格）。arguments 在 OpenAI 协议里是 JSON 字符串，已就地解析 */
export interface GenerateTextToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    /** JSON 字符串（OpenAI 协议原样）——调用方按需 JSON.parse */
    arguments: string
  }
}

export interface GenerateTextResult {
  text: string
  model: string
  /** 模型本轮要求的 tool 调用；空数组表示纯文本回答 */
  toolCalls?: ReadonlyArray<GenerateTextToolCall>
  /** finish_reason: tool_calls / stop / length 等；用于 agent loop 终止判断 */
  finishReason?: string
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
  /**
   * 调用前对参考图做过的处理说明（如超出上游单图上限时的自动压缩）。
   * 只进运行日志与结果提示，不参与出图逻辑。
   */
  referenceNotes?: string[]
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

// ── 决策（OpenRouter Decisions API）────────────────────────

/** OpenRouter Decisions 端点路径（挂在 `https://openrouter.ai/api` 下，注意不在 /v1 下） */
export const OPENROUTER_DECISIONS_PATH = '/alpha/decisions'

/**
 * Decisions 端点的实际 URL。
 *
 * 协议文档给出的端点是 `https://openrouter.ai/api/alpha/decisions`——**不在 `/v1` 下**，
 * 而本应用 OpenRouter 的 Base URL 默认是 `https://openrouter.ai/api/v1`（`/models`、`/videos`
 * 都挂在 v1 下）。实测 `POST /api/v1/alpha/decisions` 返回 404，`/api/alpha/decisions` 返回 401
 * （缺鉴权），所以这里去掉末尾的 `/v1` 再拼 `/alpha/decisions`：
 * - `https://openrouter.ai/api/v1` → `https://openrouter.ai/api/alpha/decisions`
 * - `https://openrouter.ai/api`    → `https://openrouter.ai/api/alpha/decisions`
 * - 非 openrouter.ai 的 OpenAI 兼容中转站：保留用户填的 Base URL 原样拼接，
 *   由中转站自己决定 alpha 路由挂在哪里。
 */
export function resolveOpenRouterDecisionsUrl(baseUrl: string): string {
  const base = (baseUrl || OPENROUTER_DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  const root = isOpenRouterHost(base) ? base.replace(/\/v1$/i, '') : base
  return `${root}${OPENROUTER_DECISIONS_PATH}`
}

function isOpenRouterHost(url: string): boolean {
  try {
    return /(^|\.)openrouter\.ai$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

/**
 * 决策证据条目：随请求一等下发（`state`），顺序即拼接顺序。
 * 用于把工程上下文按来源稳定喂给决策模型——文档建议 state 只放相关片段。
 */
export interface DecisionEvidenceItem {
  /** 证据来源（文件名 / 资产名），仅用于拼接出的标题行 */
  title?: string
  /** 来源的工程内相对路径 */
  path: string
  /** 证据正文 */
  text: string
}

/** 决策原语：noul=是/否概率；choice=多选一；score=有序量表 */
export type DecisionQuestionType = 'noul' | 'choice' | 'score'

/** 判定阈值：>= 视为“是”（noul 默认 0.5，choice 默认取最高概率项） */
export interface DecisionThresholds {
  noulYes?: number
  choiceMinConfidence?: number
  scoreMin?: number
}

/** 一条待判定问题（以问题名为 key 下发） */
export interface DecisionQuestionInput {
  /** 问题名：响应 answers 以此为 key，判定结果与它一一对应 */
  key: string
  type: DecisionQuestionType
  instructions: string
  /** noul：true/false 两种情形的判定说明（完整下发，不能省） */
  noulCriteria?: { yes: string; no: string }
  /** choice：选项名 → 选项说明；结果与 probabilities 的 key 一致 */
  choices?: Array<{ value: string; description?: string }>
  /** score：有序量表，index 0 = 最低档；响应 legend 同序 */
  scale?: Array<{ label: string; description?: string }>
}

/** 组装好的单条问题（OpenRouter 请求体里 questions 的元素形状） */
export type DecisionQuestionBody =
  | { type: 'noul'; instructions: string; criteria: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }

export interface DecisionRequestInput {
  /** 待判定内容：字符串，或对象 / 数组形式的相关上下文 */
  state: string | Record<string, unknown> | unknown[]
  /** 问题名 → 问题定义（响应 answers 以同一批 key 返回） */
  questions: Record<string, DecisionQuestionBody>
  /** 观测分组 id（响应不返回；仅上游日志用），≤256 字符 */
  sessionId?: string
  /** 终端用户标识，≤256 字符 */
  user?: string
}

/** 归一化后的判定答案：三种原语共用一张结构，字段按 type 取值 */
export interface DecisionAnswer {
  question: string
  type: DecisionQuestionType
  /** noul：判“是”的概率（0–1） */
  noul?: number
  /** choice：选中的选项名（probabilities 中概率最高者，上游未给 choice 时本地兜底） */
  choice?: string
  /** score：概率加权位置（index 0 = 量表最低档） */
  score?: number
  /** choice / score：分布集中度 */
  confidence?: number
  /** 各项 / 各档概率；score 的 key 是档位序号的字符串 */
  probabilities?: Record<string, number>
  /** score：档位序号 → 量表标签 */
  legend?: Record<string, string>
}

export interface DecisionResponse {
  /** 上游生成 id，便于对账 */
  id?: string
  /** 实际服务的模型（常为带日期快照，如 typesafe/jev-1.13-20260917） */
  model: string
  provider?: string
  answers: DecisionAnswer[]
  usage?: { inputTokens: number; outputTokens: number; cost?: number }
}

/** noul 判定结论 */
export interface NoulDecisionVerdict {
  type: 'noul'
  question: string
  /** 判“是”的概率（0–1） */
  probability: number
  /** probability >= 阈值 */
  verdict: boolean
  threshold: number
}

/** choice 判定结论 */
export interface ChoiceDecisionVerdict {
  type: 'choice'
  question: string
  /** 选中的选项名（与概率最高项一致；上游未给 choice 时本地兜底） */
  choice: string
  confidence: number
  /** confidence >= choiceMinConfidence（未设阈值时恒 true） */
  confident: boolean
  probabilities: Record<string, number>
  threshold?: number
}

/** score 判定结论 */
export interface ScoreDecisionVerdict {
  type: 'score'
  question: string
  /** 概率加权位置，index 0 = 量表最低档 */
  score: number
  confidence?: number
  /** score >= scoreMin（未设阈值时恒 true） */
  aboveThreshold: boolean
  probabilities: Record<string, number>
  legend: Record<string, string>
  threshold?: number
}

export type DecisionVerdict = NoulDecisionVerdict | ChoiceDecisionVerdict | ScoreDecisionVerdict

export interface GenerateDecisionsInput {
  /** 待判定状态；与 evidence 二选一，evidence 非空时按证据拼装 */
  state?: string | Record<string, unknown> | unknown[]
  /** 工程内上下文证据（按顺序拼接为 state 文本） */
  evidence?: DecisionEvidenceItem[]
  /** 问题清单（至少一条） */
  questions: DecisionQuestionInput[]
  /** 判定阈值；缺省 noulYes=0.5，choice / score 不设阈值时恒判为通过 */
  thresholds?: DecisionThresholds
  model?: string
  /** 不传则取设置里 decisions 模态首个已启用且有密钥的实例 */
  providerInstanceId?: string
  /** 观测分组 id；缺省由调用方生成 */
  sessionId?: string
  user?: string
}

/** 门面返回：上游原始答案 + 按阈值算好的判定结论 */
export interface GenerateDecisionsResult extends DecisionResponse {
  /** 与 answers 同序、可直接分支的结论（noul 的是/否、choice 的选中项、score 的位置） */
  verdicts: DecisionVerdict[]
  /** 一句话摘要，便于日志 / 节点输出展示 */
  summary: string
}

// ── 3D 模型生成 ──────────────────────────────────────────

/**
 * 支持独立骨骼蒙皮（Rigging API）的供应商：Meshy / Tripo。
 * `model.rigSkin` 节点与 MCP 校验共用；生成节点不再内联蒙皮。
 * 值由 `@shared/meshOps` 的能力矩阵派生，避免门禁散落多处。
 */
export const MODEL3D_RIG_PROVIDER_KINDS: readonly ModelProviderKind[] = meshOpsProvidersFor('rig')

/** 该供应商 kind 是否支持对已有模型做独立骨骼蒙皮 */
export function supportsModel3dRig(kind: string): boolean {
  return (MODEL3D_RIG_PROVIDER_KINDS as readonly string[]).includes(kind)
}

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
  /**
   * 是否要求上游为模型附加骨骼蒙皮（已废弃：请用 `model.rigSkin` 节点走独立 Rigging API）。
   * @deprecated
   */
  rig?: boolean
  /**
   * @deprecated 见 `model.rigSkin`
   */
  rigType?: string
  /**
   * @deprecated 见 `model.rigSkin`
   */
  rigAnimation?: string
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

/** 对已有模型做独立骨骼蒙皮（Meshy / Tripo Rigging API） */
export interface RigModel3dInput {
  /** 公网可访问的模型 URL（与 modelRelativePath 二选一，优先 url） */
  modelUrl?: string
  /** 工程内相对路径；facade 会上传对象存储得到公网 URL */
  modelRelativePath?: string
  providerInstanceId?: string
  model?: string
  /** humanoid / quadruped / … → 上游映射 */
  rigType?: string
  /**
   * Tripo 骨架命名规范：`mixamo`（默认，兼容 Mixamo 动作库）或 `tripo`（原生命名）。
   * Meshy 无此参数，忽略。
   */
  spec?: 'tripo' | 'mixamo'
  /** Tripo 输出格式：`glb`（默认，网页可直接预览）或 `fbx`（DCC / 游戏引擎）。Meshy 固定 glb */
  outFormat?: 'glb' | 'fbx'
  name?: string
  outputDir?: string
  graphBinding?: GenerateGraphBinding
}

export interface GenerateModel3dResult {
  /** 已登记的模型资产 id */
  assetId: string
  relativePath: string
  model: string
  /** 参考图上传到对象存储的记录（便于日志展示） */
  uploads?: Array<{
    objectKey: string
    url: string
    bytes: number
    sourceLabel: string
    logs: Array<{ level: 'info' | 'warn' | 'error'; message: string; ts: number }>
  }>
}

export type RigModel3dResult = GenerateModel3dResult & {
  /** 上游任务 id（Tripo `/v3/animations/rig` 的 task_id）；下游重定向要用它 */
  taskId?: string
}

/**
 * 支持「模型拆分 / 拆件」（Mesh Segmentation API）的供应商：仅 Tripo。
 * `/v3/mesh/segment`（网格分割）与 `/v3/mesh/smartsegment`（智能分割）都只有 Tripo 提供。
 */
export const MODEL3D_SEGMENT_PROVIDER_KINDS: readonly ModelProviderKind[] =
  meshOpsProvidersFor('segment')

/** 该供应商 kind 是否支持对已有模型做拆分 */
export function supportsModel3dSegment(kind: string): boolean {
  return (MODEL3D_SEGMENT_PROVIDER_KINDS as readonly string[]).includes(kind)
}

/**
 * 支持 Tripo 网格后处理 / 骨骼动画系列端点的供应商：仅 Tripo。
 * 覆盖 `/v3/mesh/complete`、`/v3/mesh/decimate`、`/v3/animations/rig-check`、`/v3/animations/retarget`。
 */
/**
 * 「支持至少一个后处理 op」的供应商（能力概览，值由能力矩阵派生）。
 *
 * ⚠️ 不要用它做门禁：各家覆盖的 op 不同（如 Meshy 有重拓扑 / 贴图，但没有部件补全 /
 * 格式转换 / 动画重定向），逐 op 判定请用 `@shared/meshOps` 的 `meshOpSupported(kind, op)`。
 */
export const MODEL3D_POST_PROCESS_PROVIDER_KINDS: readonly ModelProviderKind[] =
  meshOpsProvidersFor('meshComplete', 'retopology', 'rigCheck', 'retarget', 'convert', 'texture')

export function supportsModel3dPostProcess(kind: string): boolean {
  return (MODEL3D_POST_PROCESS_PROVIDER_KINDS as readonly string[]).includes(kind)
}

/** Tripo 后处理任务类型 */
export type Model3dPostProcessOp =
  'meshComplete' | 'retopology' | 'rigCheck' | 'retarget' | 'convert' | 'texture'

/** 部件补全模式：AI 补全（默认）或快速封口 */
export type Model3dCompletionMode = 'ai_completion' | 'quick_cap'
/** 重拓扑算法档位：`smart`=v2.0 智能（默认），`basic`=v1.0 基础减面 */
export type Model3dRetopologyMode = 'smart' | 'basic'
/** 重定向输出格式 */
export type Model3dRetargetFormat = 'glb' | 'fbx'
/** 格式转换目标格式（quad 会强制回 FBX） */
export type Model3dConvertFormat = 'GLTF' | 'FBX' | 'USDZ' | 'OBJ' | 'STL' | '3MF'
/** 导出贴图格式 */
export type Model3dTextureFormat =
  'JPEG' | 'PNG' | 'WEBP' | 'BMP' | 'DPX' | 'HDR' | 'OPEN_EXR' | 'TARGA' | 'TIFF'
/** FBX 兼容预设 */
export type Model3dFbxPreset = 'blender' | '3dsmax' | 'mixamo' | 'bake_scale'
/** 导出朝向（前向轴） */
export type Model3dExportOrientation = '+x' | '-x' | '+y' | '-y'
/** 贴图精度档位（`fast` 仅在贴图模型 v3.5-20260815 上可用） */
export type Model3dTextureQuality = 'fast' | 'standard' | 'detailed' | 'extreme'
/** 贴图对齐优先项 */
export type Model3dTextureAlignment = 'original_image' | 'geometry'

/** 重定向的可选动画：预设字符串（Tripo）与动作库 id（Meshy）两套体系 */
export interface Model3dAnimationAction {
  /** 传给上游的标识：Meshy 是 action_id，Tripo 是 preset:xxx */
  id: string
  label: string
  category?: string
  subCategory?: string
  previewUrl?: string
}

export interface ListModel3dAnimationsInput {
  providerInstanceId?: string
  /** 按 name / key 子串过滤（Meshy 服务端支持） */
  search?: string
}

/**
 * Tripo 网格后处理 / 骨骼动画（`/v3/mesh/complete`、`/v3/mesh/decimate`、
 * `/v3/animations/rig-check`、`/v3/animations/retarget`）。
 *
 * `providerTaskId` 优先：`meshComplete` 只吃 `mesh/segment` 的任务 id，
 * `retarget` 只吃 rig 任务 id；没有 id 时退回「上传模型换公网 URL」。
 */
export interface Model3dPostProcessInput {
  op: Model3dPostProcessOp
  /** 上游任务 id（拆分 / 绑骨节点的 providerTaskId） */
  providerTaskId?: string
  /** 公网可访问的模型 URL（与 modelRelativePath 二选一，优先 url） */
  modelUrl?: string
  /** 工程内相对路径；facade 会上传对象存储得到公网 URL */
  modelRelativePath?: string
  providerInstanceId?: string
  model?: string
  /** meshComplete：要补全的部件，省略 = 全部 */
  partNames?: string[]
  /** meshComplete：补全模式，缺省 ai_completion */
  completionMode?: Model3dCompletionMode
  /** retopology：算法档位，缺省 smart（v2.0） */
  retopologyMode?: Model3dRetopologyMode
  /** retopology：目标面数 */
  faceLimit?: number
  /** retopology：输出四边面 */
  quad?: boolean
  /** retopology：把贴图烘焙到低模（默认 true，v1.0 不支持） */
  bake?: boolean
  /** retarget：单个预设动画 id（与 animations 互斥） */
  animation?: string
  /** retarget：多个预设动画 id（与 animation 互斥） */
  animations?: string[]
  /** retarget：动作库动画 id（Meshy action_id；与预设动画 id 是两套体系） */
  actionIds?: number[]
  /** retarget：输出格式，缺省 glb */
  outFormat?: Model3dRetargetFormat
  /** retarget：把动画烘焙进模型（仅 glb 生效，默认 true） */
  bakeAnimation?: boolean
  /** retarget：是否带几何导出（默认 true） */
  exportWithGeometry?: boolean
  /** retarget：原地播放（不产生位移，默认 false） */
  animateInPlace?: boolean
  /** convert：目标格式（必填） */
  format?: Model3dConvertFormat
  /** convert：输出贴图尺寸（默认 4096） */
  textureSize?: number
  /** convert：贴图图片格式（默认 JPEG） */
  textureFormat?: Model3dTextureFormat
  /** convert：FBX 兼容预设（默认 blender） */
  fbxPreset?: Model3dFbxPreset
  /** convert：把 pivot 移到模型底部中心 */
  pivotToCenterBottom?: boolean
  /** convert：统一打包 UV */
  packUv?: boolean
  /** convert：导出顶点色（仅 OBJ / GLTF） */
  exportVertexColors?: boolean
  /** convert：导出朝向（前向轴） */
  exportOrientation?: Model3dExportOrientation
  /** convert：压平底部（打印件常用） */
  flattenBottom?: boolean
  /** convert：压平深度阈值（默认 0.01） */
  flattenBottomThreshold?: number
  /** convert：强制对称（仅 quad 时有效） */
  forceSymmetry?: boolean
  /** convert：导出缩放系数 */
  scaleFactor?: number
  /** convert：保留骨骼与动画数据 */
  withAnimation?: boolean
  /** texture：贴图模型版本（默认 v3.0-20250812；`fast` 需 v3.5-20260815） */
  textureVersion?: string
  /** texture：文生贴图提示词 */
  texturePromptText?: string
  /** texture：生成 PBR 材质（默认 true） */
  pbr?: boolean
  /** texture：贴图随机种子 */
  textureSeed?: number
  /** texture：贴图对齐优先项（默认 original_image） */
  textureAlignment?: Model3dTextureAlignment
  /** texture：贴图精度档位（默认 standard） */
  textureQuality?: Model3dTextureQuality
  /** texture：去掉参考图里的烘焙光照（仅 v3.5-20260815 生效） */
  delight?: boolean
  /** texture / 生成：meshopt 几何压缩 */
  compress?: string
  name?: string
  outputDir?: string
  graphBinding?: GenerateGraphBinding
}

/** 后处理结果：绑骨检查只回分析结论，其余回模型资产 */
export type Model3dPostProcessResult =
  | {
      op: 'rigCheck'
      /** 绑骨检查任务 id */
      taskId: string
      /** 该模型是否可绑骨 */
      riggable: boolean
      /** Tripo 推荐的骨架类型 */
      rigType: string
    }
  | {
      op: 'meshComplete' | 'retopology' | 'retarget' | 'convert' | 'texture'
      /** 上游任务 id（下游继续链式调用时用） */
      taskId: string
      assetId: string
      relativePath: string
      model: string
    }

/** 拆分模式：`mesh`=网格分割（几何 / 语义），`smart`=智能分割（语义命名 + mask） */
export type Model3dSegmentMode = 'mesh' | 'smart'
/** 网格分割粒度（`/v3/mesh/segment` v2 模型专用） */
export type Model3dSegmentGranularity = 'simple' | 'balanced' | 'detailed'
/** 智能分割粒度（`/v3/mesh/smartsegment`；与网格分割不是同一套枚举） */
export type Model3dSmartSegmentGranularity = 'coarse' | 'medium' | 'fine'

/** 对已有模型做拆分（Tripo Mesh Segmentation API） */
export interface SegmentModel3dInput {
  /** 公网可访问的模型 URL（与 modelRelativePath 二选一，优先 url） */
  modelUrl?: string
  /** 工程内相对路径；facade 会上传对象存储得到公网 URL */
  modelRelativePath?: string
  providerInstanceId?: string
  model?: string
  /** 拆分模式，缺省 mesh */
  mode?: Model3dSegmentMode
  /** 网格分割粒度；传入即用 v2.0-20260430（语义 + 几何） */
  granularity?: Model3dSegmentGranularity
  /** 网格分割 v2：是否按连通域拆分（默认 true） */
  splitByConnectivity?: boolean
  /** 智能分割粒度，缺省 medium */
  smartGranularity?: Model3dSmartSegmentGranularity
  /** 智能分割：点名要拆哪些部件（如「带剑与盔甲的游戏角色」） */
  hint?: string
  name?: string
  outputDir?: string
  graphBinding?: GenerateGraphBinding
}

/**
 * 拆件结果：模型资产 + 部件名。
 * 部件名不在 API 响应里，等于拆分后 GLB 各 node 名，由主进程解析落盘文件得到。
 */
export interface SegmentModel3dResult extends GenerateModel3dResult {
  mode: Model3dSegmentMode
  parts: string[]
  /** 拆分任务 id（智能分割取其中的 `mesh_segmentation` 子任务 id）；部件补全要用它 */
  taskId?: string
  /** 智能分割：部件 mask 图 URL */
  maskUrl?: string
  /** 智能分割：Tripo 识别出的部件描述 */
  description?: string
}

export interface GenerateModel3dJob {
  jobId: string
  pollingUrl: string
  status: string
  model: string
}

// ── 空间世界（World Labs Marble）────────────────────────

/** World Labs 托管媒体引用：门面把本地参考传到 `/media-assets:prepare_upload` 后拿到 id */
export interface GenerateSpatialWorldMediaAsset {
  kind: 'image' | 'video'
  /** 官方 media_asset_id */
  id: string
  /** 来源标签（日志用，如工程相对路径） */
  sourceLabel?: string
}

/** 世界生成输入：文本 / 参考图（1–4 张）/ 参考视频（1 条）生成可交互 3D 世界 */
export interface GenerateSpatialWorldInput {
  prompt: string
  model?: string
  providerInstanceId?: string
  /**
   * 参考输入（公网 http(s) URL）。本地文件与 data URL 由门面上传后改写：
   * 优先走官方托管媒体（`mediaAssets`），失败才退回对象存储公网 URL（本字段）。
   */
  inputReferences?: GenerateVideoInputReference[]
  /** 已上传到 World Labs 托管存储的参考（官方 media_asset 形态，不依赖对象存储） */
  mediaAssets?: GenerateSpatialWorldMediaAsset[]
  /** 上游展示名（World Labs display_name，最长 64 字符，可选） */
  displayName?: string
  /** 随机种子（0–4294967295，可选） */
  seed?: number
  /**
   * 单图参考是否按等距柱状全景处理（官方 `is_pano`，仅单图形态生效）：
   * `auto`（默认，自动识别 2:1 equirect）/ `always` 强制 / `never` 当普通图片。
   */
  panoMode?: 'auto' | 'always' | 'never'
  /**
   * 关闭上游 recaption：为 true 时指令原文直送（可复现性更好）。
   * 缺省由上游自动补一段画面描述——同一份输入两次结果可能不同。
   */
  disableRecaption?: boolean
  /** 世界标签（官方 tags，最多 10 个、每个 ≤32 字符） */
  tags?: string[]
  /** 世界可见性（官方 `permission.public`；缺省 false = 仅自己可见） */
  publicWorld?: boolean
  /** 落盘目录（相对工程根） */
  outputDir?: string
  /** MCP：生成资产挂到的资产库文件夹 id */
  folderId?: string
  /** 落盘文件名 stem */
  name?: string
  /** 图节点回写绑定 */
  graphBinding?: GenerateGraphBinding
}

export interface GenerateSpatialWorldJob {
  /** World Labs operation id（轮询用） */
  jobId: string
  pollingUrl: string
  status: string
  model: string
}

// ── 空间世界导出（World Labs `worlds/{id}:export`）────────────────

/** 导出资产族：`splats` 高斯泼溅（PLY）/ `mesh` 高质量网格（GLB） */
export type SpatialWorldExportAssetType = 'splats' | 'mesh'
/** HQ 网格变体：`textured` 贴图网格（约 600k 面）/ `vertex_colored` 顶点色网格（约 1M 面） */
export type SpatialWorldExportMeshVariant = 'textured' | 'vertex_colored'
/** PLY 泼溅分辨率档（官方 enum） */
export type SpatialWorldExportResolution = 'full_res' | '500k' | '150k' | '100k'

/** 空间世界导出请求（官方 ExportWorldRequest 的应用侧形态） */
export interface SpatialWorldExportRequest {
  spatialWorldId: string
  assetType: SpatialWorldExportAssetType
  format: 'ply' | 'glb'
  /** 仅 `mesh`：网格变体；缺省由上游按 textured 处理 */
  meshVariant?: SpatialWorldExportMeshVariant
  /** 仅 `splats`：PLY 分辨率档；缺省由上游按 full_res 处理 */
  resolution?: SpatialWorldExportResolution
}

/** 导出提交结果：PLY 同步（提交即带 downloadUrl），HQ 网格为进行中的 operation */
export interface SpatialWorldExportJob {
  jobId: string
  pollingUrl: string
  status: string
  downloadUrl?: string
}

/** 空间世界导出执行输入：请求 + 落盘/绑定信息 */
export interface ExportWorldInput extends SpatialWorldExportRequest {
  providerInstanceId?: string
  model?: string
  /** 参考：上游世界产物（PLY 泼溅按它的同目录同名落盘） */
  sourceRelativePath?: string
  /** 落盘目录（相对工程根） */
  outputDir?: string
  /** 落盘文件名 stem */
  name?: string
  /** 图节点回写绑定 */
  graphBinding?: GenerateGraphBinding
}

/** 空间世界导出执行结果：网格导出登记为模型资产，泼溅导出只落文件 */
export interface ExportWorldResult {
  /** `mesh` 导出登记后的资产 id；`splats` 导出为空 */
  assetId?: string
  /** 产物的工程相对路径（注册资产时与资产一致） */
  relativePath: string
  /** 导出用到的 model 名（任务记录用） */
  model: string
  assetType: SpatialWorldExportAssetType
  format: 'ply' | 'glb'
}

/**
 * 世界生成结果：与 3D 模型同口径（已登记的 GLB 资产）。
 * 世界产物同时含高斯泼溅（SPZ）与全景图，本版本只落网格，后续版本再接导出。
 */
export interface GenerateSpatialWorldResult {
  /** 已登记的模型资产 id */
  assetId: string
  relativePath: string
  model: string
  /** 参考图上传到对象存储的记录（便于日志展示） */
  uploads?: GenerateModel3dResult['uploads']
  /** 参考处理说明（如「已上传 N 个托管媒体资产」），随结果回传给运行日志 */
  referenceNotes?: string[]
  /**
   * 随世界一起返回、已落盘在主产物旁边的附加产物：
   * `splats`（高斯泼溅 SPZ）/ `pano`（360 全景图）。下载失败时 `relativePath` 缺省。
   */
  extras?: Array<{ kind: string; relativePath?: string }>
  /**
   * World Labs 世界 id（官方 World.id）。下游「空间世界导出」节点只认它，
   * 所以生成结果必须带上。
   */
  spatialWorldId?: string
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
  /**
   * 多说话人对话（ElevenLabs Text to Dialogue）：给了它就发
   * `POST /v1/text-to-dialogue`，一次合成整段对话音频；与 `input` 二选一。
   * 每个元素是一段台词 + 该段音色（voice_id）。不支持该端点的供应商会明确报错，
   * 执行层也不会把 `generateDialogue` 注入到这类供应商上（见 graph 执行上下文）。
   */
  dialogue?: Array<{ text: string; voice?: string }>
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

/** 门面层音乐生成原始结果（尚未落盘；由门面取回音频后登记资产） */
export interface GenerateMusicResult {
  model: string
  /** 音频下载地址（http(s)）。ElevenLabs 之外都是这一种（服务端给 URL） */
  downloadUrl?: string
  /**
   * 已落临时目录的音频绝对路径。
   * ElevenLabs 的 `/v1/music` 直接回音频字节、没有下载地址，所以走这一种；
   * 门面两种都支持（下载 URL 或直接用本地文件），登记资产的方式一致。
   */
  filePath?: string
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

/**
 * 音效生成输入（ElevenLabs `POST /v1/sound-generation`）。
 *
 * 与音乐分开：音效端点只接受一段描述文本，且没有歌词 / 时长结构，
 * 但多了「可无缝循环」与「描述影响力」两个音效专用开关。
 */
export interface GenerateSoundEffectInput {
  /** 音效描述（如「雨落在铁皮屋顶上」） */
  prompt: string
  /** 是否生成可无缝循环的音频（环境音常用） */
  loop?: boolean
  /** 期望时长（秒）；规范范围 0.5–30，超出会被夹到边界 */
  durationSeconds?: number
  /**
   * 提示词影响力 0–1（默认 0.3）：越高越贴合描述、随机性越低。
   * 未传即沿用服务端默认。
   */
  promptInfluence?: number
  model?: string
  providerInstanceId?: string
  /** 输出目录（相对工程根）；缺省 Cache/Sfx */
  outputDir?: string
  /** 落盘文件名 stem */
  name?: string
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

/**
 * 该模型在目录快照里声明的声音（OpenRouter 的 `supported_voices`）。
 * 各家 TTS 的声音名不通用，所以只信「模型自己声明的」，拉不到就让用户手填。
 */
export function resolveModelSupportedVoices(
  provider: ModelProviderInstance,
  modality: ModelModality,
  modelId: string
): string[] {
  const entry = modalityConfig(provider, modality).catalog?.[modelId.trim()]
  const raw = entry?.capabilities?.supported_voices
  if (!Array.isArray(raw)) return []
  return raw
    .filter((voice): voice is string => typeof voice === 'string')
    .map((voice) => voice.trim())
    .filter(Boolean)
}

/**
 * audio 模态可用的声音：优先该模型声明的，其次供应商级音色目录。
 *
 * 与 `buildModelVoiceOptions`（渲染进程）同一套优先级 —— 两边不一致就会出现
 * 「面板里列出了音色、生成时说没音色」这类错位。
 * 供应商级目录（`voiceLabels`）是给 ElevenLabs 这种「音色属于账号、不属于模型」的。
 */
export function resolveAvailableVoices(provider: ModelProviderInstance, modelId: string): string[] {
  const declared = resolveModelSupportedVoices(provider, 'audio', modelId)
  if (declared.length) return declared
  return Object.keys(modalityConfig(provider, 'audio').voiceLabels ?? {})
}

/**
 * 该提供商的语音合成是否**必须**带音色。
 *
 * ElevenLabs 把 voice_id 放在请求路径里，没有它连端点都拼不出来，
 * 不存在「留空用厂商默认」这种可能 —— 面板必须据此收起「默认音色」选项，
 * 否则用户选了它、生成时才报错。
 */
export function requiresSpeechVoice(kind: ModelProviderKind): boolean {
  return kind === 'elevenlabs'
}

/**
 * audio 模态的默认声音：设置里显式指定的优先，否则取可用音色的第一个。
 * 都没有时返回空串，交给各适配器用自己的兜底。
 */
export function resolveDefaultVoice(provider: ModelProviderInstance, modelId: string): string {
  const configured = modalityConfig(provider, 'audio').defaultVoice?.trim()
  if (configured) return configured
  return resolveAvailableVoices(provider, modelId)[0] ?? ''
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
  selected: string[],
  kind: ModelProviderKind
): Record<string, SavedCatalogModelEntry> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const src = raw as Record<string, unknown>
  const out: Record<string, SavedCatalogModelEntry> = {}
  for (const id of selected) {
    const item = src[id]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const row = item as Record<string, unknown>
    const savedName = typeof row.name === 'string' ? row.name.trim() : ''
    // 目录只返回 id 的 provider（如 DeepSeek）旧快照里 name 等于 id，这里换成内置展示名
    const name = savedName && savedName !== id ? savedName : providerModelDisplayName(kind, id)
    const capabilities = cloneJsonRecord(row.capabilities)
    out[id] = { id, name, ...(capabilities ? { capabilities } : {}) }
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeModalityConfig(
  raw: Partial<ModalityModelConfig> | null | undefined,
  kind: ModelProviderKind
): ModalityModelConfig {
  const selected = Array.isArray(raw?.selectedModelIds)
    ? raw.selectedModelIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : []
  const defaultModelId =
    typeof raw?.defaultModelId === 'string' && selected.includes(raw.defaultModelId)
      ? raw.defaultModelId
      : (selected[0] ?? '')
  const catalog = normalizeSavedCatalog(raw?.catalog, selected, kind)
  const defaultVoice = typeof raw?.defaultVoice === 'string' ? raw.defaultVoice.trim() : ''
  const voiceLabels = normalizeVoiceLabels(raw?.voiceLabels)
  return {
    selectedModelIds: selected,
    defaultModelId,
    ...(defaultVoice ? { defaultVoice } : {}),
    ...(voiceLabels ? { voiceLabels } : {}),
    ...(catalog ? { catalog } : {})
  }
}

/** 音色 id → 展示名：丢掉非字符串与空值，全空时返回 undefined（不落盘空对象） */
function normalizeVoiceLabels(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [id, label] of Object.entries(raw as Record<string, unknown>)) {
    const key = id.trim()
    if (!key || typeof label !== 'string') continue
    const value = label.trim()
    if (value) out[key] = value
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * 从旧的 audio 桶里捞出音乐模型（music 拆成独立模态前的存量数据）。
 *
 * 当时音乐借用音频模态，用户勾的 `music-3.0` / `music_v2_5` 都落在 audio 桶。
 * 拆出 music 后如果不迁移，这些用户打开设置会看到音乐页签是空的、以为选择丢了。
 *
 * **故意保留 audio 桶里的原样**：万一某个模型其实是用户特意在声音页签勾的，
 * 移除会让它彻底不可选；留在两处无害（音乐模型本就会被声音节点的目录过滤掉，
 * 那是按 TTS 类别过滤的，不靠勾选项）。
 */
function inferLegacyMusicModality(
  rawAudio: Partial<ModalityModelConfig> | undefined
): Partial<ModalityModelConfig> | undefined {
  if (!rawAudio || typeof rawAudio !== 'object') return undefined
  const ids = Array.isArray(rawAudio.selectedModelIds)
    ? rawAudio.selectedModelIds.filter(
        (id): id is string => typeof id === 'string' && isLikelyMusicModelId(id)
      )
    : []
  if (!ids.length) return undefined
  // selectedModelIds 非空但 defaultModelId 是空串时也要给出非空默认值
  // （normalizeModalityConfig 会回退到 selected[0]，但显式给出更清楚）
  const rawDefault = typeof rawAudio.defaultModelId === 'string' ? rawAudio.defaultModelId : ''
  return {
    selectedModelIds: ids,
    defaultModelId: ids.includes(rawDefault) ? rawDefault : ids[0]!
  }
}

/** 按 id 命名判断是不是音乐模型（仅用于旧数据迁移，不参与运行时选型） */
function isLikelyMusicModelId(modelId: string): boolean {
  return /(^|[/_-])music/i.test(modelId.trim()) || /^fun-music/i.test(modelId.trim())
}

function normalizeModalityMap(
  raw: Partial<ProviderModalityMap> | null | undefined,
  kind: ModelProviderKind
): ProviderModalityMap {
  const empty = createEmptyModalityMap()
  if (!raw || typeof raw !== 'object') return empty
  return {
    text: normalizeModalityConfig(raw.text, kind),
    image: normalizeModalityConfig(raw.image, kind),
    video: normalizeModalityConfig(raw.video, kind),
    audio: normalizeModalityConfig(raw.audio, kind),
    // 兼容旧工程：music 是后来从 audio 里拆出来的独立模态。
    // 老设置里音乐模型可能被勾在 audio 桶下（当时音乐借用音频模态），
    // 直接读 music 桶会是空的 —— 让用户以为勾过的模型丢了。
    music: normalizeModalityConfig(raw.music ?? inferLegacyMusicModality(raw.audio), kind),
    model3d: normalizeModalityConfig(raw.model3d, kind),
    // 兼容旧工程：改名前的模态桶是 world（世界模型），读回来别把用户已选的模型丢掉
    spatialWorld: normalizeModalityConfig(
      raw.spatialWorld ??
        ((raw as Record<string, unknown>).world as Partial<ModalityModelConfig> | undefined),
      kind
    ),
    decisions: normalizeModalityConfig(raw.decisions, kind)
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
    /^(海螺\s*AI|Hailuo(\s*AI)?(\s*\/\s*MiniMax)?|Hailuo\s*\(\s*MiniMax\s*\)|MinMax)$/i.test(label)
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
    ...(kind === 'custom'
      ? { apiStyle: isCustomApiStyle(item.apiStyle) ? item.apiStyle : DEFAULT_CUSTOM_API_STYLE }
      : {}),
    enabled: item.enabled !== false,
    modalities: normalizeModalityMap(item.modalities, kind)
  }
}
