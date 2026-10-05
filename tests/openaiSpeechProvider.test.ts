import { describe, expect, it, vi } from 'vitest'
import { createEmptyModalityMap, type ModelProviderInstance } from '../src/shared/modelProvider'
import {
  buildModelOptions,
  buildModelVoiceOptions
} from '../src/renderer/src/features/graph/model/generateModelOptions'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      interceptors: { request: { use: () => undefined } }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import { openAiAdapter } from '../src/main/services/modelProviders/openai/adapter'

/**
 * OpenAI（官方）provider 的语音生成整条链。
 *
 * 与 OpenRouter 的关键差异：**目录来自本地静态表**，因为 OpenAI 的
 * `GET /models` 只给模型 id、不给音色列表。所以这里要验证的是
 * 「即使目录快照里什么都没有，候选与音色也能正确解析」。
 */
function openAiAudioProvider(): ModelProviderInstance {
  const modalities = createEmptyModalityMap()
  modalities.audio.selectedModelIds = ['gpt-4o-mini-tts']
  modalities.audio.defaultModelId = 'gpt-4o-mini-tts'
  return {
    id: 'oa-voice',
    providerKind: 'openai',
    label: 'OpenAI',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    modalities
  }
}

describe('OpenAI 语音生成（官方 provider）', () => {
  it('模型目录来自静态表，不依赖 GET /models', async () => {
    // 关键：不 mock get —— 静态表路径根本不该发请求
    getMock.mockClear()
    const models = await openAiAdapter.fetchCatalog(openAiAudioProvider(), 'audio')
    expect(models.map((m) => m.id)).toEqual(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'])
    expect(getMock).not.toHaveBeenCalled()
  })

  it('声音节点能列出该模型：候选来自静态目录而非设置快照', async () => {
    const provider = openAiAudioProvider()
    // 快照故意留空：模拟「用户没点过拉取目录」（OpenAI 的常见状态）
    expect(provider.modalities.audio.catalog).toBeUndefined()

    const catalog = await openAiAdapter.fetchCatalog(provider, 'audio')
    // 设置页勾选后会把能力的 supported_voices 写进快照
    provider.modalities.audio.catalog = {
      'gpt-4o-mini-tts': {
        id: 'gpt-4o-mini-tts',
        name: 'GPT-4o mini TTS',
        capabilities: catalog[0]!.capabilities
      }
    }

    const options = buildModelOptions([provider], 'audio')
    expect(options.map((o) => o.key)).toEqual(['oa-voice::gpt-4o-mini-tts'])
    expect(buildModelVoiceOptions([provider], 'audio', options)).toEqual({
      'oa-voice::gpt-4o-mini-tts': expect.arrayContaining(['alloy', 'nova', 'shimmer'])
    })
  })

  it('未选音色 → 用模型的兜底音色，请求体是标准 /audio/speech 形状', async () => {
    postMock.mockReset()
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]) })
    const result = await openAiAdapter.generateSpeech(openAiAudioProvider(), 'gpt-4o-mini-tts', {
      input: '你好'
    })
    const [path, body, config] = postMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { responseType?: string }
    ]
    expect(path).toBe('/audio/speech')
    expect(body).toEqual({
      model: 'gpt-4o-mini-tts',
      input: '你好',
      voice: 'alloy',
      response_format: 'mp3'
    })
    expect(config.responseType).toBe('arraybuffer')
    expect(result.voice).toBe('alloy')
    expect(result.filePath).toBeTruthy()
  })

  it('选了音色 → 原样发出（含 gpt-4o-mini-tts 独有的 ballad/verse）', async () => {
    postMock.mockReset()
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1]) })
    await openAiAdapter.generateSpeech(openAiAudioProvider(), 'gpt-4o-mini-tts', {
      input: 'hi',
      voice: 'verse'
    })
    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.voice).toBe('verse')
  })

  it('OpenAI 的模型不会被当成「无音色表」误伤', async () => {
    postMock.mockReset()
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1]) })
    await openAiAdapter.generateSpeech(openAiAudioProvider(), 'tts-1-hd', { input: 'hi' })
    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    // tts-1-hd 有音色表 → 应该发 alloy，而不是被静默省略
    expect(body.voice).toBe('alloy')
  })

  it('TTS 模型不会混进文本页签', async () => {
    // OpenAI 的 GET /models 同时返回对话模型与语音模型，文本侧必须剔除 tts/audio
    getMock.mockReset()
    getMock.mockResolvedValueOnce({
      data: {
        data: [{ id: 'gpt-5.5' }, { id: 'tts-1' }, { id: 'gpt-4o-mini-tts' }, { id: 'whisper-1' }]
      }
    })
    const text = await openAiAdapter.fetchCatalog(openAiAudioProvider(), 'text')
    expect(text.map((m) => m.id)).toEqual(['gpt-5.5'])
  })

  it('音频模态不进文本 / 图片的下拉', () => {
    const provider = openAiAudioProvider()
    const audioOnlyOptions = buildModelOptions([provider], 'audio')
    expect(audioOnlyOptions).toHaveLength(1)
    // 该 provider 只勾了音频模型，其它模态不该凭空多出选项
    expect(buildModelOptions([provider], 'text')).toEqual([])
    expect(buildModelOptions([provider], 'image')).toEqual([])
    // 非音频模态不产出声音映射
    expect(buildModelVoiceOptions([provider], 'text', audioOnlyOptions)).toEqual({})
  })
})
