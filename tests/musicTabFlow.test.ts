import { describe, expect, it } from 'vitest'
import { createEmptyModalityMap, normalizeModelsSettings } from '../src/shared/modelProvider'
import { settingsModalitiesFor } from '../src/shared/modelProviders/settingsModalities'
import { listMiniMaxCatalogModels } from '../src/shared/modelProviders/minimax/modelCapabilities'
import { listDashScopeCatalogModels } from '../src/shared/modelProviders/dashscope/modelCapabilities'

/**
 * 真实流程串测：**读落盘设置 → 算页签 → 拉目录**。
 *
 * 单测只覆盖「函数被正确调用」不够 —— 用户的路径是从 settings.json 读回提供商、
 * 渲染页签、点「拉取模型」。这条把三段串起来，防止某一段单独正确但合起来是空的。
 */
describe('音乐页签的真实流程', () => {
  it('从落盘设置归一化后，MiniMax 的音乐页签与目录都在', () => {
    // 模拟 settings.json 里已保存的 MiniMax 实例（music 桶是空的，用户还没勾）
    const normalized = normalizeModelsSettings({
      providers: [
        {
          id: 'mm-1',
          providerKind: 'minimax',
          label: 'MiniMax',
          apiKey: 'k',
          baseUrl: 'https://api.minimaxi.com',
          enabled: true,
          modalities: {
            text: { selectedModelIds: ['MiniMax-M3'], defaultModelId: 'MiniMax-M3' },
            audio: { selectedModelIds: ['voice-design'], defaultModelId: 'voice-design' }
          }
        }
      ]
    })
    const provider = normalized.providers[0]!
    // 归一化必须补出 music 桶，否则后续 modalityConfig(provider,'music') 会踩空
    expect(provider.modalities.music).toEqual({ selectedModelIds: [], defaultModelId: '' })

    const tabs = settingsModalitiesFor(provider)
    expect(tabs, `实际页签：${tabs.join(', ')}`).toContain('music')

    // 音乐页签点「拉取模型」时拿到的目录
    const catalog = listMiniMaxCatalogModels('music')
    expect(catalog.map((m) => m.id)).toEqual(['music-3.0', 'music-2.6'])
  })

  it('百炼同理', () => {
    const normalized = normalizeModelsSettings({
      providers: [
        {
          id: 'ds-1',
          providerKind: 'dashscope',
          label: '百炼',
          apiKey: 'k',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          enabled: true,
          modalities: { text: { selectedModelIds: ['qwen-max'], defaultModelId: 'qwen-max' } }
        }
      ]
    })
    const provider = normalized.providers[0]!
    expect(settingsModalitiesFor(provider)).toContain('music')
    expect(listDashScopeCatalogModels('music').map((m) => m.id)).toEqual([
      'fun-music-v1',
      'fun-music-preview'
    ])
  })

  it('页面切到音乐页签后 currentModality 不会回退到 text', () => {
    const provider = {
      id: 'mm-2',
      providerKind: 'minimax' as const,
      label: 'MiniMax',
      apiKey: 'k',
      baseUrl: 'https://api.minimaxi.com',
      enabled: true,
      modalities: createEmptyModalityMap()
    }
    const allowed = settingsModalitiesFor(provider)
    // 这是 currentModality 的核心逻辑：选了 music 且它被允许 → 就用 music
    expect(allowed.includes('music')).toBe(true)
    // 若 allowed 里没有 music，currentModality 会把页签悄悄掰回第一个模态
    expect(allowed[0]).toBe('text')
  })
})
