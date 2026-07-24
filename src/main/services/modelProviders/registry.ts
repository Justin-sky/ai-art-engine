import type { ModelProviderKind } from '@shared/openrouter'
import type { ModelProviderAdapter } from './types'
import { openRouterAdapter } from './openrouter/adapter'
import { volcengineArkAdapter } from './volcengineArk/adapter'

const adapters: Record<ModelProviderKind, ModelProviderAdapter> = {
  openrouter: openRouterAdapter,
  'volcengine-ark': volcengineArkAdapter
}

/** 按 providerKind 取适配器；未知 kind 回退 OpenRouter */
export function getProviderAdapter(kind: ModelProviderKind | undefined | null): ModelProviderAdapter {
  if (kind && adapters[kind]) return adapters[kind]
  return openRouterAdapter
}

/** 注册新供应商适配器（扩展点；内置厂商已在模块加载时注册） */
export function registerProviderAdapter(adapter: ModelProviderAdapter): void {
  adapters[adapter.kind] = adapter
}
