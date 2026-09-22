import { modalityConfig, type ModelProviderInstance, type ModelProviderKind } from './modelProvider'

export type DshChatInputModality = 'text' | 'image'

/** dsh llm-deepseek 内置目录里声明了看图的官方模型 */
const DEEPSEEK_OFFICIAL_VISION_MODEL_IDS = new Set([
  'deepseek-flash',
  'deepseek-v4-flash-vision-exp'
])

/**
 * 已知支持看图的模型 id（含 OpenRouter 前缀）。
 * 用于覆盖「目录未标注 / 旧快照缺 architecture」；不覆盖目录明确标成无 image 的旧版
 * `deepseek/deepseek-v4-flash`（非 4.1）。
 */
const KNOWN_VISION_MODEL_ID_RES: readonly RegExp[] = [
  /(?:^|\/)deepseek-v4\.1-flash(?:$|:)/i,
  /(?:^|\/)deepseek-flash-latest(?:$|:)/i,
  /(?:^|\/)deepseek-v4-flash-vision(?:-exp)?(?:$|:)/i,
  /(?:^|\/)deepseek-flash(?:$|:)/i,
  /(?:^|\/)mimo-v2\.6(?:-|$)/i,
  /(?:^|\/)gpt-4o/i,
  /(?:^|\/)claude-(?:3|4|opus|sonnet|haiku)/i,
  /(?:^|\/)gemini-/i
]

export function isKnownVisionModelId(modelId: string): boolean {
  const id = modelId.trim()
  if (!id) return false
  if (DEEPSEEK_OFFICIAL_VISION_MODEL_IDS.has(id)) return true
  return KNOWN_VISION_MODEL_ID_RES.some((re) => re.test(id))
}

/**
 * 从已保存的文本模型目录读取 OpenRouter 等网关的 architecture.input_modalities。
 * 无标注时返回 null（交给调用方按厂商策略兜底）。
 */
export function readCatalogImageInput(
  provider: ModelProviderInstance,
  modelId: string
): boolean | null {
  const entry = modalityConfig(provider, 'text').catalog?.[modelId]
  const arch = entry?.capabilities?.architecture as
    { input_modalities?: unknown; modality?: unknown } | undefined
  if (!arch || typeof arch !== 'object') return null

  const inputs = arch.input_modalities
  if (Array.isArray(inputs) && inputs.length > 0) {
    return inputs.some((m) => m === 'image')
  }

  // 部分快照只留 modality 字符串，如 "text+image->text"
  if (typeof arch.modality === 'string' && arch.modality.length > 0) {
    const left = arch.modality.split('->')[0] ?? arch.modality
    return /(^|\+|\/)image(\+|\/|$)/i.test(left) || left.toLowerCase().includes('image')
  }

  return null
}

/**
 * 解析写入 dsh `llm-deepseek.models[].inputModalities` 的值。
 *
 * 背景：对话经 llm-deepseek 透传 OpenAI 兼容端点。该适配器对「不在内置目录」的模型
 * 一律按纯文本处理；附图时抛 `does not accept image input`。OpenRouter 的
 * `xiaomi/mimo-v2.6-flash`、`deepseek/deepseek-v4.1-flash` 等真实多模态模型因此被误拦。
 */
export function resolveDshChatInputModalities(
  providerKind: ModelProviderKind,
  modelId: string,
  catalogAllowsImage: boolean | null
): DshChatInputModality[] {
  if (catalogAllowsImage === true) return ['text', 'image']
  // 已知看图模型：即使旧 catalog 缺 architecture / 误标，也放行
  if (isKnownVisionModelId(modelId)) return ['text', 'image']
  if (catalogAllowsImage === false) return ['text']

  if (providerKind === 'deepseek') {
    return DEEPSEEK_OFFICIAL_VISION_MODEL_IDS.has(modelId) ? ['text', 'image'] : ['text']
  }

  // 其它 OpenAI 兼容网关：目录未标注时乐观放行图片，避免误拦；真纯文本由上游 API 拒绝。
  return ['text', 'image']
}

export function resolveDshChatInputModalitiesForProvider(
  provider: ModelProviderInstance,
  modelId: string
): DshChatInputModality[] {
  return resolveDshChatInputModalities(
    provider.providerKind,
    modelId,
    readCatalogImageInput(provider, modelId)
  )
}
