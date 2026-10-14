import { afterEach, describe, expect, it } from 'vitest'
import { createEmptyModalityMap, type ModelProviderInstance } from '../src/shared/modelProvider'
import {
  clearVideoGenerateCapabilitiesCache,
  resolveVideoGenerateCapabilitiesForRun
} from '../src/renderer/src/features/graph/model/videoGenerateCapabilities'
import { invalidateGenerateModelSettingsCache } from '../src/renderer/src/features/graph/model/generateModelOptions'

/**
 * 「节点没钉模型 → 跟随设置默认」这条路上的能力解析。
 *
 * 实测踩到（语义重建整趟）：

 *   语义重建：生成 9 镜 · 直通原片 0 镜 · 配音 1 句 · 模型 默认
 *   shot.002.423 生成失败：Duration 2s is not supported for this model.
 *     Supported durations: 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15s
 *
 * 9 镜里 6 镜被上游按「时长不合法」打回 —— 因为没钉模型时 `resolveVideoGenerateCapabilitiesForRun`
 * 直接返回 undefined，durations 为空，调用方只能拿镜头时长（1s / 2s）当生成时长。
 * 默认模型必须在这里被解析成一个具体模型，能力表才拿得到。
 */

function videoProvider(id: string, model: string): ModelProviderInstance {
  const modalities = createEmptyModalityMap()
  modalities.video.selectedModelIds = [model]
  modalities.video.defaultModelId = model
  return {
    id,
    label: 'Ark',
    providerKind: 'volcengine-ark',
    apiKey: 'ak',
    baseUrl: 'https://ark.example.com',
    enabled: true,
    modalities
  } as unknown as ModelProviderInstance
}

function stubStudio(providers: ModelProviderInstance[]): void {
  ;(globalThis as { window?: unknown }).window = {
    studio: {
      getSettings: async () => ({ models: { providers } }),
      listModels: async () => []
    }
  }
}

afterEach(() => {
  clearVideoGenerateCapabilitiesCache()
  invalidateGenerateModelSettingsCache()
  delete (globalThis as { window?: unknown }).window
})

describe('视频模型能力：没钉模型时按默认模型解析', () => {
  it('默认 Seedance 2：durations 拿到 4..15（而不是空 → 拿镜头时长硬发）', async () => {
    stubStudio([videoProvider('ark-1', 'bytedance/seedance-2.0-mini')])
    const bundle = await resolveVideoGenerateCapabilitiesForRun({})
    expect(bundle?.params.durations).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
  })

  it('钉了模型时按钉的那个解析（原行为不变）', async () => {
    stubStudio([videoProvider('ark-1', 'bytedance/seedance-2.0-mini')])
    const bundle = await resolveVideoGenerateCapabilitiesForRun({
      model: 'seedance-1.5',
      providerInstanceId: 'ark-1'
    })
    expect(bundle?.params.durations).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('设置里一个视频模型都没有时不硬编：返回 undefined，交给调用方兜底', async () => {
    stubStudio([])
    expect(await resolveVideoGenerateCapabilitiesForRun({})).toBeUndefined()
  })
})
