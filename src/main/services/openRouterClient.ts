/**
 * 兼容入口：历史 import 路径 `./openRouterClient` 仍可用。
 * 实现已迁至 `modelProviders/` 适配器架构。
 */
export {
  openRouterClient,
  modelProviderFacade,
  toMediaUrl,
  toImageUrl,
  toVideoUrl,
  toAudioUrl,
  prepareVideoInputReferencesForApi,
  getProviderAdapter,
  registerProviderAdapter
} from './modelProviders'
export type { ModelProviderAdapter, VideoPollResult } from './modelProviders'
