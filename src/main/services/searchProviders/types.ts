/**
 * Search provider 适配器接口。
 *
 * 与 ModelProviderAdapter 平行：单一搜索厂商的可插拔实现。
 * 新增厂商：
 *   1) src/shared/searchProvider.ts 的 SearchProviderKind / SEARCH_PROVIDER_KINDS 各加一项
 *   2) src/main/services/searchProviders/<kind>/adapter.ts 实现本接口
 *   3) src/main/plugins/searchProviders.ts 的 builtinSearchProviderPlugins 追加
 */
import type {
  FetchInput,
  FetchResult,
  SearchInput,
  SearchProviderInstance,
  SearchProviderKind,
  SearchResult
} from '@shared/searchProvider'

export interface SearchProviderAdapter {
  readonly kind: SearchProviderKind
  /** 探测 Key + 端点是否可用；网络层报错时抛 fail(SEARCH_PROVIDER_ERRORS.*) */
  assertAuth(provider: SearchProviderInstance): Promise<void>
  /**
   * 文本搜索：把 web 内容以 hits 形式拉回。
   * 不支持时 reject SEARCH_PROVIDER_ERRORS.unsupportedCapability。
   */
  search(provider: SearchProviderInstance, input: SearchInput): Promise<SearchResult>
  /**
   * 抓取单个 URL 的正文。可选：未实现时上层走本地代理或退化为降级链路。
   * 不支持时 reject SEARCH_PROVIDER_ERRORS.unsupportedCapability。
   */
  fetch?(provider: SearchProviderInstance, input: FetchInput): Promise<FetchResult>
}
