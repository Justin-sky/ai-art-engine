import type { CatalogModel, ModelModality, ModelProviderKind } from '@shared/modelProvider'
import { listOpenAiCatalogModels, resolveOpenAiModelCapabilities } from './openai/modelCapabilities'
import { listOpenAiTtsCatalogModels } from './openai/ttsModels'
import { listZhipuCatalogModels, resolveZhipuModelCapabilities } from './zhipu/modelCapabilities'
import { resolveVolcengineArkModelCapabilities } from './volcengineArk/modelCapabilities'
import { listKlingCatalogModels, resolveKlingModelCapabilities } from './kling/modelCapabilities'
import { resolveComfyUiModelCapabilities } from './comfyui/modelCapabilities'
import {
  listMiniMaxCatalogModels,
  resolveMiniMaxModelCapabilities
} from './minimax/modelCapabilities'
import {
  listDashScopeCatalogModels,
  resolveDashScopeModelCapabilities
} from './dashscope/modelCapabilities'
import {
  listModelScopeCatalogModels,
  resolveModelScopeModelCapabilities
} from './modelscope/modelCapabilities'
import { listXaiCatalogModels, resolveXaiModelCapabilities } from './xai/modelCapabilities'
import { listGoogleCatalogModels, resolveGoogleModelCapabilities } from './google/modelCapabilities'
import {
  listMagicRouterCatalogModels,
  resolveMagicRouterModelCapabilities
} from './magicrouter/modelCapabilities'
import { listElevenModelsOfKind } from './elevenlabs/voice'

const ANTHROPIC_STATIC_TEXT_MODELS: CatalogModel[] = [
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', modality: 'text' },
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', modality: 'text' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', modality: 'text' },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', modality: 'text' },
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', modality: 'text' },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', modality: 'text' }
]

const DEEPSEEK_STATIC_TEXT_MODELS: CatalogModel[] = [
  { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', modality: 'text' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', modality: 'text' },
  { id: 'deepseek-chat', name: 'deepseek-chat', modality: 'text' },
  { id: 'deepseek-reasoner', name: 'deepseek-reasoner', modality: 'text' }
]

const MOONSHOT_STATIC_TEXT_MODELS: CatalogModel[] = [
  { id: 'kimi-k2.5', name: 'Kimi K2.5', modality: 'text' },
  { id: 'kimi-k2-thinking', name: 'Kimi K2 Thinking', modality: 'text' },
  { id: 'kimi-k2-turbo-preview', name: 'Kimi K2 Turbo', modality: 'text' },
  { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', modality: 'text' }
]

/**
 * 按提供商与模态返回内置静态最新模型目录，无需等待手动点击拉取即可展示。
 */
export function getStaticCatalogForProvider(
  providerKind: ModelProviderKind,
  modality: ModelModality
): CatalogModel[] {
  switch (providerKind) {
    case 'openai':
      if (modality === 'audio') return listOpenAiTtsCatalogModels()
      return listOpenAiCatalogModels(modality)
    case 'anthropic':
      return modality === 'text' ? [...ANTHROPIC_STATIC_TEXT_MODELS] : []
    case 'deepseek':
      return modality === 'text' ? [...DEEPSEEK_STATIC_TEXT_MODELS] : []
    case 'moonshot':
      return modality === 'text' ? [...MOONSHOT_STATIC_TEXT_MODELS] : []
    case 'zhipu':
      return listZhipuCatalogModels(modality)
    case 'dashscope':
      return listDashScopeCatalogModels(modality)
    case 'minimax':
      return listMiniMaxCatalogModels(modality)
    case 'google':
      return listGoogleCatalogModels(modality)
    case 'xai':
      return listXaiCatalogModels(modality)
    case 'kling':
      return listKlingCatalogModels(modality)
    case 'modelscope':
      return listModelScopeCatalogModels(modality)
    case 'magicrouter':
      return listMagicRouterCatalogModels(modality)
    case 'elevenlabs':
      if (modality === 'audio') return listElevenModelsOfKind([], 'tts')
      if (modality === 'music') {
        return listElevenModelsOfKind([], 'music').map((m) => ({ ...m, modality: 'music' }))
      }
      if (modality === 'sfx') {
        return listElevenModelsOfKind([], 'sfx').map((m) => ({ ...m, modality: 'sfx' }))
      }
      return []
    case 'tripo':
      return modality === 'model3d'
        ? [
            {
              id: 'tripo-3d-v1',
              name: 'Tripo 3D',
              modality: 'model3d',
              description: 'Tripo 3D v3.1 (text / image / multi-image)'
            }
          ]
        : []
    case 'meshy':
      return modality === 'model3d'
        ? [
            {
              id: 'meshy-3d-v2',
              name: 'Meshy 3D v2',
              modality: 'model3d',
              description: 'Meshy 3D (text / image / multi-image)'
            }
          ]
        : []
    case 'hyper3d':
      return modality === 'model3d'
        ? [
            {
              id: 'rodin-gen-2.5',
              name: 'Rodin Gen 2.5',
              modality: 'model3d',
              description: 'Rodin (Hyper3D) 3D generation (text / image)'
            }
          ]
        : []
    case 'luma':
      return modality === 'model3d'
        ? [
            {
              id: 'luma-genie',
              name: 'Luma Genie',
              modality: 'model3d',
              description: 'Luma Genie 3D generation (text / image)'
            }
          ]
        : []
    case 'lux3d':
      return modality === 'model3d'
        ? [
            {
              id: 'G1',
              name: 'Lux3D G1',
              modality: 'model3d',
              description: 'Lux3D G1 3D generation (quality)'
            },
            {
              id: 'G1-Turbo',
              name: 'Lux3D G1-Turbo',
              modality: 'model3d',
              description: 'Lux3D G1-Turbo 3D generation (fast)'
            }
          ]
        : []
    case 'worldlabs':
      return modality === 'spatialWorld'
        ? [
            {
              id: 'marble-1.1',
              name: 'Marble 1.1',
              modality: 'spatialWorld',
              description: 'World Labs Marble 1.1 (standard world)'
            },
            {
              id: 'marble-1.1-plus',
              name: 'Marble 1.1 Plus',
              modality: 'spatialWorld',
              description: 'World Labs Marble 1.1 Plus (large world)'
            },
            {
              id: 'marble-1.0',
              name: 'Marble 1.0',
              modality: 'spatialWorld',
              description: 'World Labs Marble 1.0'
            }
          ]
        : []
    default:
      return []
  }
}

/**
 * 统一解析指定提供商 + 模态 + 模型 ID 的本地静态参数能力。
 */
export function resolveStaticCapabilitiesForProvider(
  providerKind: ModelProviderKind | undefined,
  modelId: string,
  modality: ModelModality,
  catalogName?: string
): Record<string, unknown> | undefined {
  switch (providerKind) {
    case 'volcengine-ark':
      if (modality === 'video' || modality === 'image') {
        return (
          resolveVolcengineArkModelCapabilities(modelId, catalogName ?? modelId, modality) ??
          undefined
        )
      }
      return undefined
    case 'kling':
      if (modality === 'video' || modality === 'image') {
        return resolveKlingModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'minimax':
      if (
        modality === 'video' ||
        modality === 'text' ||
        modality === 'image' ||
        modality === 'audio'
      ) {
        return resolveMiniMaxModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'dashscope':
      if (
        modality === 'video' ||
        modality === 'image' ||
        modality === 'text' ||
        modality === 'audio'
      ) {
        return resolveDashScopeModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'modelscope':
      if (modality === 'image' || modality === 'text') {
        return resolveModelScopeModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'xai':
      if (modality === 'image' || modality === 'video') {
        return resolveXaiModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'google':
      if (modality === 'image' || modality === 'video') {
        return resolveGoogleModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'zhipu':
      if (modality === 'image' || modality === 'text') {
        return resolveZhipuModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'comfyui':
      if (modality === 'image' || modality === 'video' || modality === 'audio') {
        return resolveComfyUiModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'magicrouter':
      if (modality === 'image' || modality === 'video') {
        return resolveMagicRouterModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    case 'openai':
      if (modality === 'image') {
        return resolveOpenAiModelCapabilities(modelId, modality) ?? undefined
      }
      return undefined
    default:
      return undefined
  }
}
