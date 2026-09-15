/**
 * Search provider 注册中心。
 *
 * 与 modelProviders 的 Cordis plugin 路径**有意分离**——search 数量小、不需要
 * 上下文注入，模块级 Map 注册足以；后续若需要按工程维度动态注册，再迁 Cordis。
 *
 * 入口：
 *   getBuiltinSearchProvider(kind) → 拿适配器（设置 UI / IPC 门面共用）
 *   listBuiltinSearchProviders()   → 全量列举（用于"恢复出厂设置"或诊断）
 *   builtinSearchProviderKinds     → 仅供设置 UI 列举（顺序即展示顺序）
 */
import { SEARCH_PROVIDER_KINDS, type SearchProviderKind } from '@shared/searchProvider'
import { braveSearchAdapter } from '../services/searchProviders/brave/adapter'
import { deepseekSearchAdapter } from '../services/searchProviders/deepseekSearch/adapter'
import { mockSearchAdapter } from '../services/searchProviders/mock/adapter'
import { serpapiSearchAdapter } from '../services/searchProviders/serpapi/adapter'
import { tavilySearchAdapter } from '../services/searchProviders/tavily/adapter'
import type { SearchProviderAdapter } from '../services/searchProviders/types'

const registry = new Map<SearchProviderKind, SearchProviderAdapter>()

function register(adapter: SearchProviderAdapter): void {
  if (registry.has(adapter.kind)) {
    throw new Error(`Search provider ${adapter.kind} already registered`)
  }
  registry.set(adapter.kind, adapter)
}

// 顺序与 builtinSearchProviderKinds（=SEARCH_PROVIDER_KINDS 顺序）一致
register(deepseekSearchAdapter)
register(tavilySearchAdapter)
register(braveSearchAdapter)
register(serpapiSearchAdapter)
register(mockSearchAdapter)

/** 拿指定 kind 的内置适配器；未注册返回 undefined */
export function getBuiltinSearchProvider(
  kind: SearchProviderKind
): SearchProviderAdapter | undefined {
  return registry.get(kind)
}

/** 全量内置适配器列表（顺序与 builtinSearchProviderKinds 一致） */
export function listBuiltinSearchProviders(): SearchProviderAdapter[] {
  return builtinSearchProviderKinds.map(
    (kind) =>
      registry.get(kind) ??
      (() => {
        throw new Error(`Missing search adapter: ${kind}`)
      })()
  )
}

/** UI 设置下拉 / 文档列举用：与 SEARCH_PROVIDER_KINDS 顺序一致 */
export const builtinSearchProviderKinds: readonly SearchProviderKind[] = SEARCH_PROVIDER_KINDS.map(
  (m) => m.id
)
