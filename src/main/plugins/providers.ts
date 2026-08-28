import type { Context } from '@cordisjs/core'
import { MODEL_PROVIDER_KINDS, type ModelProviderKindMeta } from '@shared/modelProvider'
import type { ModelProviderAdapter } from '../services/modelProviders/types'
import { openRouterAdapter } from '../services/modelProviders/openrouter/adapter'
import { openAiAdapter } from '../services/modelProviders/openai/adapter'
import { deepSeekAdapter } from '../services/modelProviders/deepseek/adapter'
import { zhipuAdapter } from '../services/modelProviders/zhipu/adapter'
import { moonshotAdapter } from '../services/modelProviders/moonshot/adapter'
import { xaiAdapter } from '../services/modelProviders/xai/adapter'
import { googleAdapter } from '../services/modelProviders/google/adapter'
import { vllmAdapter, ollamaAdapter, lmStudioAdapter } from '../services/modelProviders/localOpenAi'
import { volcengineArkAdapter } from '../services/modelProviders/volcengineArk/adapter'
import { klingAdapter } from '../services/modelProviders/kling/adapter'
import { miniMaxAdapter } from '../services/modelProviders/minimax/adapter'
import { dashscopeAdapter } from '../services/modelProviders/dashscope/adapter'
import { modelScopeAdapter } from '../services/modelProviders/modelscope/adapter'
import { comfyUiAdapter } from '../services/modelProviders/comfyui/adapter'
import { magicRouterAdapter } from '../services/modelProviders/magicrouter/adapter'
import { tripoAdapter } from '../services/modelProviders/tripo/adapter'
import { meshyAdapter } from '../services/modelProviders/meshy/adapter'
import { hyper3dAdapter } from '../services/modelProviders/hyper3d/adapter'
import { lumaAdapter } from '../services/modelProviders/luma/adapter'
import { lux3dAdapter } from '../services/modelProviders/lux3d/adapter'

function resolveProviderMeta(
  adapter: ModelProviderAdapter,
  meta?: ModelProviderKindMeta
): ModelProviderKindMeta {
  if (meta) {
    if (meta.id !== adapter.kind) {
      throw new Error(`Provider meta id ${meta.id} does not match adapter ${adapter.kind}`)
    }
    return meta
  }
  const found = MODEL_PROVIDER_KINDS.find((item) => item.id === adapter.kind)
  if (!found) {
    throw new Error(
      `Unknown model provider kind: ${adapter.kind}. Add it to MODEL_PROVIDER_KINDS or pass meta.`
    )
  }
  return found
}

export function createProviderPlugin(adapter: ModelProviderAdapter, meta?: ModelProviderKindMeta) {
  const resolved = resolveProviderMeta(adapter, meta)
  return {
    name: `provider.${adapter.kind}`,
    inject: ['providers'],
    apply(ctx: Context): void {
      ctx.providers.register(adapter, resolved)
    }
  }
}

export const builtinProviderPlugins = [
  createProviderPlugin(openRouterAdapter),
  createProviderPlugin(openAiAdapter),
  createProviderPlugin(deepSeekAdapter),
  createProviderPlugin(zhipuAdapter),
  createProviderPlugin(moonshotAdapter),
  createProviderPlugin(xaiAdapter),
  createProviderPlugin(googleAdapter),
  createProviderPlugin(vllmAdapter),
  createProviderPlugin(ollamaAdapter),
  createProviderPlugin(lmStudioAdapter),
  createProviderPlugin(volcengineArkAdapter),
  createProviderPlugin(klingAdapter),
  createProviderPlugin(miniMaxAdapter),
  createProviderPlugin(dashscopeAdapter),
  createProviderPlugin(modelScopeAdapter),
  createProviderPlugin(comfyUiAdapter),
  createProviderPlugin(magicRouterAdapter),
  createProviderPlugin(tripoAdapter),
  createProviderPlugin(meshyAdapter),
  createProviderPlugin(hyper3dAdapter),
  createProviderPlugin(lumaAdapter),
  createProviderPlugin(lux3dAdapter)
] as const
