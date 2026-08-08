import type { ModelProviderKind } from '@shared/modelProvider'
import type { ModelProviderAdapter } from './types'
import { openRouterAdapter } from './openrouter/adapter'
import { openAiAdapter } from './openai/adapter'
import { deepSeekAdapter } from './deepseek/adapter'
import { zhipuAdapter } from './zhipu/adapter'
import { vllmAdapter, ollamaAdapter, lmStudioAdapter } from './localOpenAi'
import { volcengineArkAdapter } from './volcengineArk/adapter'
import { klingAdapter } from './kling/adapter'
import { miniMaxAdapter } from './minimax/adapter'
import { dashscopeAdapter } from './dashscope/adapter'
import { modelScopeAdapter } from './modelscope/adapter'

const adapters: Record<ModelProviderKind, ModelProviderAdapter> = {
  openrouter: openRouterAdapter,
  openai: openAiAdapter,
  deepseek: deepSeekAdapter,
  zhipu: zhipuAdapter,
  vllm: vllmAdapter,
  ollama: ollamaAdapter,
  lmstudio: lmStudioAdapter,
  'volcengine-ark': volcengineArkAdapter,
  kling: klingAdapter,
  minimax: miniMaxAdapter,
  dashscope: dashscopeAdapter,
  modelscope: modelScopeAdapter
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
