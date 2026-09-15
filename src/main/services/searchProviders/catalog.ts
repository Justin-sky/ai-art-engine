import { defErr, defErrSimple, type BiDef } from '@shared/errors/appError'

/**
 * searchProviders 各 adapter 共用的错误条目（仅 main 进程使用）。
 * 句式集中；adapter 内部细节错误用 readHttpError / formatAuthError 抓的 raw 文本
 * 作为 detail 参数嵌入。
 */
export const SEARCH_PROVIDER_ERRORS = {
  missingApiKey: defErrSimple(
    'search.missingApiKey',
    '请先填写搜索服务商的 API Key',
    'Search provider API Key is required'
  ),
  missingQuery: defErrSimple(
    'search.missingQuery',
    '搜索关键词不能为空',
    'Search query is required'
  ),
  missingUrl: defErrSimple('search.missingUrl', '抓取 URL 不能为空', 'Fetch URL is required'),
  unsupportedCapability: defErr<{ capability: 'search' | 'fetch'; name: string }>(
    'search.unsupportedCapability',
    ({ name, capability }) => `${name}暂不支持${capability === 'search' ? '搜索' : '抓取'}能力`,
    ({ name, capability }) => `${name} does not support ${capability}`
  ),
  invalidApiKey: defErr<{ detail: string }>(
    'search.invalidApiKey',
    ({ detail }) => `API Key 无效：${detail}`,
    ({ detail }) => `Invalid API Key: ${detail}`
  ),
  connectionTestFailed: defErr<{ detail: string }>(
    'search.connectionTestFailed',
    ({ detail }) => `连接测试失败：${detail}`,
    ({ detail }) => `Connection test failed: ${detail}`
  ),
  searchFailed: defErr<{ detail: string }>(
    'search.searchFailed',
    ({ detail }) => `搜索失败：${detail}`,
    ({ detail }) => `Search failed: ${detail}`
  ),
  fetchFailed: defErr<{ detail: string }>(
    'search.fetchFailed',
    ({ detail }) => `抓取失败：${detail}`,
    ({ detail }) => `Fetch failed: ${detail}`
  ),
  emptyResult: defErrSimple('search.emptyResult', '搜索未返回结果', 'No search hits returned'),
  parseFailed: defErr<{ detail: string }>(
    'search.parseFailed',
    ({ detail }) => `解析上游响应失败：${detail}`,
    ({ detail }) => `Failed to parse upstream response: ${detail}`
  )
} satisfies Record<string, BiDef<never> | BiDef<undefined>>
