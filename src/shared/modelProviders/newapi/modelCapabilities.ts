/**
 * NewAPI（及 one-api 系中转网关）的模型模态判定与端点选择。
 *
 * 为什么单独一个文件：NewAPI 的 `GET /api/pricing` 会公开一份端点字典，把「端点类型」
 * 映射到实际请求路径，例如
 *
 *   "image-generation": { "path": "/v1/images/generations", "method": "POST" }
 *   "image-edit":       { "path": "/v1/images/edits",       "method": "POST" }
 *   "openai":           { "path": "/v1/chat/completions",   "method": "POST" }
 *
 * 模型条目则带 `supported_endpoint_types: ["openai","image-generation",...]`。
 * 于是「这个模型能不能出图、该打哪个端点」不再需要猜命名 —— 这是 NewAPI 提供商相对
 * 通用「自定义提供商」的核心增量（后者只能按 id 命名特征做启发式）。
 *
 * 目录仍以**令牌可见**的 `GET /v1/models` 为准（尊重令牌的模型权限）；`/api/pricing`
 * 只用于补充端点元数据，不参与「列出哪些模型」。
 */

/**
 * 网关没给端点元数据时的兜底：按 id 命名特征判定「明确是图片生成」的模型。
 * 与「自定义提供商」用同一套词表；这里内联一份，避免两个提供商模块互相依赖。
 */
const IMAGE_MODEL_PATTERN =
  /(gpt-image|dall-?e|dalle|stable-?diffusion|sdxl|sd3|sd-?\d|flux|midjourney|\bmj\b|imagen|seedream|cogview|kolors|qwen-image|wanx|doubao-?seedream|nano-?banana|ideogram|recraft|photon|playground-v|firefly|t2i|text-?to-?image|image-?gen|drawing)/i

/** 该 id 是否明确属于图片生成模型（仅按命名特征，判不出来时返回 false） */
export function isImageModelIdByNaming(modelId: string): boolean {
  return IMAGE_MODEL_PATTERN.test(modelId.trim())
}

/** `/api/pricing` 顶层的端点字典：端点类型 → 实际路径（path 形如 `/v1/images/generations`） */
export type NewApiEndpointTable = Record<string, { path?: string; method?: string }>

/** 端点类型里与图片相关的那些；其余（`openai` / `gemini` 等）一律按对话端点处理 */
const IMAGE_ENDPOINT_ROUTES = {
  'image-generation': 'generation',
  image_generation: 'generation',
  'image-edit': 'edit',
  image_edit: 'edit'
} as const

export interface NewApiModelRoutes {
  /** 出图端点路径（模型声明了 image-generation 时才有） */
  generation?: string
  /** 参考图编辑端点路径（模型声明了 image-edit 时才有） */
  edit?: string
  /** 对话端点路径（模型声明了 openai 时才有） */
  chat?: string
}

function normalizeEndpointTypes(supportedEndpointTypes: readonly string[] | undefined): string[] {
  return (supportedEndpointTypes ?? []).map((t) => String(t).trim().toLowerCase()).filter(Boolean)
}

/**
 * 从网关给出的 `supported_endpoint_types` + 端点字典解析出该模型实际可打的端点路径。
 * 端点字典缺失时只返回命中关系（路径为 undefined），由调用方回退到标准 OpenAI 路径。
 */
export function resolveNewApiModelRoutes(
  supportedEndpointTypes: readonly string[] | undefined,
  endpoints?: NewApiEndpointTable
): NewApiModelRoutes {
  const table = endpoints ?? {}
  const types = normalizeEndpointTypes(supportedEndpointTypes)
  const out: NewApiModelRoutes = {}
  const pathOf = (endpointType: string): string | undefined => {
    // 端点字典的键可能是连字符（image-generation）或下划线（image_generation）写法，两种都试
    const keys = [endpointType, endpointType.replace(/_/g, '-')]
    for (const key of keys) {
      const path = table[key]?.path
      if (typeof path === 'string' && path.trim()) return path.trim()
    }
    return undefined
  }
  for (const type of types) {
    const route = IMAGE_ENDPOINT_ROUTES[type as keyof typeof IMAGE_ENDPOINT_ROUTES]
    if (route === 'generation') out.generation ??= pathOf(type)
    else if (route === 'edit') out.edit ??= pathOf(type)
    else if (type === 'openai') out.chat ??= pathOf(type)
  }
  return out
}

/**
 * 该模型是否属于「图片」模态。
 *
 * 判定顺序：
 * 1. 端点元数据命中 `image-generation` / `image-edit` → 图片（网关自己声明的，最可靠）；
 * 2. 没有元数据时退回命名启发式（`isImageModelIdByNaming`）。
 *
 * 注意元数据是**加分项**：网关没给 `supported_endpoint_types` 时不会误判为文本。
 */
export function isNewApiImageModel(
  modelId: string,
  supportedEndpointTypes?: readonly string[]
): boolean {
  const types = normalizeEndpointTypes(supportedEndpointTypes)
  if (types.some((t) => t in IMAGE_ENDPOINT_ROUTES)) return true
  return isImageModelIdByNaming(modelId)
}

/** 与之互补：能出图的模型不再出现在文本页签里 */
export function isNewApiTextModelId(
  modelId: string,
  supportedEndpointTypes?: readonly string[]
): boolean {
  const id = modelId.trim()
  if (!id) return false
  return !isNewApiImageModel(id, supportedEndpointTypes)
}
