/**
 * 模型供应商适配层。
 *
 * 新增厂商步骤：
 * 1. 实现 ModelProviderAdapter，在 main/plugins/providers.ts 用 createProviderPlugin 挂上
 *    （设置页 kind 目录取自已登记插件，不是静态表 filter）
 * 2. shared/modelProvider.ts：MODEL_PROVIDER_KINDS 增加 kind（落盘 / 规范化）
 *
 * 对外门面：`modelProviderFacade`。
 */
export type { ModelProviderAdapter, VideoPollResult } from './types'
export {
  getProviderAdapter,
  listRegisteredProviderKinds,
  loadProviderAdapter
} from './registry'
export { modelProviderFacade } from './facade'
export {
  toMediaUrl,
  toImageUrl,
  toVideoUrl,
  toAudioUrl
} from './mediaUrl'
export { prepareVideoInputReferencesForApi } from './videoRefs'
