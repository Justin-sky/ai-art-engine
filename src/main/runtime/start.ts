import { Context, type ForkScope } from '@cordisjs/core'
import type { ModelProviderKindMeta } from '@shared/modelProvider'
import type { ObjectStorageKindMeta } from '@shared/objectStorage'
import { builtinProviderPlugins, createProviderPlugin } from '../plugins/providers'
import { builtinStoragePlugins, createStoragePlugin } from '../plugins/objectStorage'
import type { ModelProviderAdapter } from '../services/modelProviders/types'
import type { ObjectStorageAdapter } from '../services/objectStorage/types'
import { ProvidersHub, StorageHub } from './hub'
import './types'

let root: Context | null = null

export function useMainContext(): Context {
  if (!root) throw new Error('Main Cordis runtime has not started')
  return root
}

export function isMainRuntimeStarted(): boolean {
  return root !== null
}

export async function startMainRuntime(): Promise<Context> {
  if (root) return root
  const ctx = new Context()
  ctx.plugin(ProvidersHub)
  ctx.plugin(StorageHub)
  for (const plugin of builtinProviderPlugins) ctx.plugin(plugin)
  for (const plugin of builtinStoragePlugins) ctx.plugin(plugin)
  await ctx.start()
  root = ctx
  return ctx
}

export async function stopMainRuntime(): Promise<void> {
  if (!root) return
  const ctx = root
  root = null
  await ctx.stop()
}

/** 运行时再挂一家适配器（测试 / 扩展）。卸载用返回的 fork.dispose()。 */
export function loadProviderAdapter(
  adapter: ModelProviderAdapter,
  meta?: ModelProviderKindMeta
): ForkScope {
  return useMainContext().plugin(createProviderPlugin(adapter, meta))
}

export function loadStorageAdapter(
  adapter: ObjectStorageAdapter,
  meta?: ObjectStorageKindMeta
): ForkScope {
  return useMainContext().plugin(createStoragePlugin(adapter, meta))
}
