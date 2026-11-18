import { describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'
import {
  createEmptyModalityMap,
  isCustomProvider,
  isLocalOpenAiProvider,
  MODEL_MODALITIES,
  MODEL_PROVIDER_KINDS,
  type CustomApiStyle,
  type ModelProviderInstance,
  type ModelProviderKind
} from '../src/shared/modelProvider'
import type { McpActivityTool } from '../src/shared/ipc'
import { settingsModalitiesFor } from '../src/shared/modelProviders/settingsModalities'
import enUS from '../src/renderer/src/i18n/locales/en-US'
import zhCN from '../src/renderer/src/i18n/locales/zh-CN'

function makeProvider(
  kind: ModelProviderKind,
  overrides?: Partial<ModelProviderInstance>
): ModelProviderInstance {
  return {
    id: `p-${kind}`,
    providerKind: kind,
    label: kind,
    apiKey: 'k',
    baseUrl: 'https://example.com',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

function providerModalityHintGroup(provider: ModelProviderInstance): string {
  if (isCustomProvider(provider)) return 'customModalityHint'
  if (provider.providerKind === 'moonshot') return 'moonshotModalityHint'
  if (provider.providerKind === 'google') return 'googleModalityHint'
  if (provider.providerKind === 'xai') return 'xaiModalityHint'
  if (isLocalOpenAiProvider(provider)) return 'localModalityHint'
  if (provider.providerKind === 'zhipu') return 'zhipuModalityHint'
  if (provider.providerKind === 'deepseek') return 'deepseekModalityHint'
  if (provider.providerKind === 'anthropic') return 'anthropicModalityHint'
  if (provider.providerKind === 'openai') return 'openaiModalityHint'
  if (provider.providerKind === 'openrouter') return 'openrouterModalityHint'
  if (provider.providerKind === 'elevenlabs') return 'elevenLabsModalityHint'
  if (provider.providerKind === 'volcengine-ark') return 'arkModalityHint'
  if (provider.providerKind === 'kling') return 'klingModalityHint'
  if (provider.providerKind === 'minimax') return 'minimaxModalityHint'
  if (provider.providerKind === 'dashscope') return 'dashscopeModalityHint'
  if (provider.providerKind === 'modelscope') return 'modelscopeModalityHint'
  if (provider.providerKind === 'comfyui') return 'comfyuiModalityHint'
  if (provider.providerKind === 'magicrouter') return 'magicrouterModalityHint'
  if (provider.providerKind === 'typesafe') return 'typesafeModalityHint'
  if (provider.providerKind === 'worldlabs') return 'worldlabsModalityHint'
  return 'modalityHint'
}

const ALL_MCP_ACTIVITY_TOOLS: readonly McpActivityTool[] = [
  'generate_image',
  'generate_video',
  'generate_speech',
  'generate_dialogue',
  'generate_sound_effect',
  'generate_music',
  'generate_model3d',
  'rig_model3d',
  'segment_model3d',
  'post_process_model3d',
  'generate_world',
  'export_spatial_world',
  'decide',
  'graph_icon_refine',
  'task_run',
  'asset_import',
  'blender_export',
  'gameplay_build',
  'screen_record_stop',
  'tutorial_compose',
  'skill_search',
  'skill_install',
  'skill_uninstall',
  'game_one_sentence_create'
]

describe('settings.models & graph.tasks.mcpKind 动态 i18n 键完整性（零 intlify 警告）', () => {
  for (const locale of ['zh-CN', 'en-US'] as const) {
    it(`${locale}：全部提供商的 credentialsHint、模态标签与专属模态说明均完整定义且无控制台警告`, () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const i18n = createI18n({
          legacy: false,
          locale,
          fallbackLocale: {
            'zh-CN': ['en-US'],
            'en-US': [],
            default: ['en-US']
          },
          messages: {
            'zh-CN': zhCN,
            'en-US': enUS
          }
        })
        const t = i18n.global.t as (key: string) => string
        const te = i18n.global.te as (key: string, targetLocale?: string) => boolean

        for (const mod of MODEL_MODALITIES) {
          const modKey = `settings.models.modality.${mod}`
          const genericHintKey = `settings.models.modalityHint.${mod}`
          expect(te(modKey, locale), modKey).toBe(true)
          expect(te(genericHintKey, locale), genericHintKey).toBe(true)
          expect(t(modKey)).not.toBe(modKey)
          expect(t(genericHintKey)).not.toBe(genericHintKey)
        }

        const customStyles: CustomApiStyle[] = ['openai', 'anthropic', 'gemini']
        for (const meta of MODEL_PROVIDER_KINDS) {
          const credKey = `settings.models.credentialsHint.${meta.id}`
          expect(te(credKey, locale), credKey).toBe(true)
          expect(t(credKey)).not.toBe(credKey)

          const instances =
            meta.id === 'custom'
              ? customStyles.map((apiStyle) => makeProvider('custom', { apiStyle }))
              : [makeProvider(meta.id)]

          for (const inst of instances) {
            const group = providerModalityHintGroup(inst)
            for (const mod of settingsModalitiesFor(inst)) {
              const hintKey = `settings.models.${group}.${mod}`
              expect(te(hintKey, locale), `${inst.providerKind}:${mod} -> ${hintKey}`).toBe(true)
              expect(t(hintKey)).not.toBe(hintKey)
            }
          }
        }

        for (const tool of ALL_MCP_ACTIVITY_TOOLS) {
          const toolKey = `graph.tasks.mcpKind.${tool}`
          expect(te(toolKey, locale), toolKey).toBe(true)
          expect(t(toolKey)).not.toBe(toolKey)
        }

        expect(warnSpy).not.toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
      }
    })
  }
})
