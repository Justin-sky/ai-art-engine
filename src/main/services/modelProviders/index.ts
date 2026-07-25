/**
 * 模型供应商适配层。
 *
 * 新增厂商步骤：
 * 1. shared/modelProvider.ts：MODEL_PROVIDER_KINDS 增加 kind
 * 2. 实现 ModelProviderAdapter（参考 openrouter/ / volcengineArk/ / kling/ / minimax/ / dashscope/ / modelscope/）
 * 3. registry.ts 注册
 *
 * 对外门面保持与历史 openRouterClient 相同方法签名。
 */
export type { ModelProviderAdapter, VideoPollResult } from './types'
export { getProviderAdapter, registerProviderAdapter } from './registry'
export { modelProviderFacade, openRouterClient } from './facade'
export {
  toMediaUrl,
  toImageUrl,
  toVideoUrl,
  toAudioUrl
} from './mediaUrl'
export { prepareVideoInputReferencesForApi } from './videoRefs'
