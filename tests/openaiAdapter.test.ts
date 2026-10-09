import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock,
      interceptors: {
        request: { use: () => undefined }
      }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

vi.mock('../src/main/services/modelProviders/openaiCompat', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/main/services/modelProviders/openaiCompat')>()
  return {
    ...actual,
    generateOpenAiCompatibleText: vi.fn(async (_p, modelId: string, input: { prompt: string }) => ({
      text: `echo:${input.prompt}`,
      model: modelId
    }))
  }
})

import { openAiAdapter } from '../src/main/services/modelProviders/openai/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'oa-1',
    providerKind: 'openai',
    label: 'OpenAI',
    apiKey: 'sk-test',
    baseUrl: 'https://api.openai.com/v1',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('openAiAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('returns static image catalog', async () => {
    const images = await openAiAdapter.fetchCatalog(provider(), 'image')
    expect(images.some((m) => m.id === 'gpt-image-1')).toBe(true)
    expect(images.some((m) => m.id === 'gpt-image-2')).toBe(true)
  })

  it('fetches and filters text catalog from GET /models', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        data: [
          { id: 'gpt-5.5' },
          { id: 'gpt-4o-mini' },
          { id: 'gpt-image-1' },
          { id: 'whisper-1' },
          { id: 'o3' }
        ]
      }
    })
    const models = await openAiAdapter.fetchCatalog(provider(), 'text')
    expect(models.map((m) => m.id).sort()).toEqual(['gpt-4o-mini', 'gpt-5.5', 'o3'])
  })

  it('returns static TTS catalog for the audio modality (with voices)', async () => {
    const models = await openAiAdapter.fetchCatalog(provider(), 'audio')
    expect(models.map((m) => m.id)).toEqual(['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'])
    const tts1 = models.find((m) => m.id === 'tts-1')!
    expect(tts1.modality).toBe('audio')
    expect((tts1.capabilities?.supported_voices as string[]).length).toBeGreaterThan(5)
  })

  it('returns empty catalog for unsupported modalities', async () => {
    expect(await openAiAdapter.fetchCatalog(provider(), 'video')).toEqual([])
    expect(await openAiAdapter.fetchCatalog(provider(), 'model3d')).toEqual([])
  })

  it('delegates text generation to OpenAI compatible client', async () => {
    const result = await openAiAdapter.generateText(provider(), 'gpt-5.5', {
      prompt: 'hello'
    })
    expect(result.text).toBe('echo:hello')
    expect(result.model).toBe('gpt-5.5')
  })

  it('generates text-to-image with mapped size and quality', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ b64_json: 'QUJD' }] }
    })
    const result = await openAiAdapter.generateImage(provider(), 'gpt-image-1', {
      prompt: 'a cat',
      aspectRatio: '16:9',
      quality: 'medium',
      n: 2
    })
    expect(postMock).toHaveBeenCalledWith('/images/generations', {
      model: 'gpt-image-1',
      prompt: 'a cat',
      size: '1536x1024',
      quality: 'medium',
      n: 2
    })
    expect(result.images[0]).toBe('data:image/png;base64,QUJD')
  })

  it('sends reference image via /images/edits multipart form', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ url: 'https://cdn.example.com/out.png' }] }
    })
    const result = await openAiAdapter.generateImage(provider(), 'gpt-image-1', {
      prompt: 'make it red',
      aspectRatio: '1:1',
      inputReferences: ['data:image/png;base64,iVBORw0KGgo=']
    })
    expect(postMock).toHaveBeenCalledTimes(1)
    const [path, form] = postMock.mock.calls[0] as [string, FormData, unknown]
    expect(path).toBe('/images/edits')
    expect(form.get('model')).toBe('gpt-image-1')
    expect(form.get('prompt')).toBe('make it red')
    expect(form.get('size')).toBe('1024x1024')
    expect(form.get('image')).toBeInstanceOf(Blob)
    expect(result.images[0]).toBe('https://cdn.example.com/out.png')
  })

  it('多参考图：gpt-image 系列全部提交（image[]）并把 @n 改写成图n', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ url: 'https://cdn.example.com/two.png' }] }
    })
    const result = await openAiAdapter.generateImage(provider(), 'gpt-image-2.5-sunburst', {
      prompt: '将@1中的人物替换成@2中的人物',
      aspectRatio: '1:1',
      inputReferences: ['data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,d29ybGQ=']
    })

    const [path, form] = postMock.mock.calls[0] as [string, FormData, unknown]
    expect(path).toBe('/images/edits')
    // 模型不认识应用内的 @n：与方舟 / Gemini / OpenRouter 同口径改成「图n」
    expect(form.get('prompt')).toBe('将图1中的人物替换成图2中的人物')
    // 两张都发出去了，且用官方多图约定的 image[] 重复字段
    expect(form.getAll('image[]')).toHaveLength(2)
    expect(form.get('image')).toBeNull()
    // 没有丢图就不该有提示
    expect(result.referenceNotes).toBeUndefined()
  })

  it('只吃单图的老模型：多余参考图不发，但要在运行日志里说清楚', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ url: 'https://cdn.example.com/one.png' }] }
    })
    const result = await openAiAdapter.generateImage(provider(), 'dall-e-2', {
      prompt: '把@2的人换成@1的人',
      aspectRatio: '1:1',
      inputReferences: ['data:image/png;base64,aGVsbG8=', 'data:image/jpeg;base64,d29ybGQ=']
    })

    const [, form] = postMock.mock.calls[0] as [string, FormData, unknown]
    expect(form.getAll('image')).toHaveLength(1)
    expect(form.getAll('image[]')).toHaveLength(0)
    expect(result.referenceNotes?.[0]).toContain('dall-e-2')
    expect(result.referenceNotes?.[0]).toContain('1 张参考图')
  })

  it('纯文生图也把 @n 改写成图n（提示词口径统一）', async () => {
    postMock.mockResolvedValueOnce({
      data: { data: [{ b64_json: 'QUJD' }] }
    })
    await openAiAdapter.generateImage(provider(), 'gpt-image-1', {
      prompt: '参考@1的风格画一只猫'
    })
    const [path, body] = postMock.mock.calls[0] as [string, { prompt: string }, unknown]
    expect(path).toBe('/images/generations')
    expect(body.prompt).toBe('参考图1的风格画一只猫')
  })

  it('语音合成：POST /audio/speech，body 为 model + input + voice', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3, 4]) })
    const result = await openAiAdapter.generateSpeech(provider(), 'tts-1', {
      input: '你好，世界',
      voice: 'nova'
    })

    const [path, body, config] = postMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { responseType?: string }
    ]
    expect(path).toBe('/audio/speech')
    expect(body).toEqual({
      model: 'tts-1',
      input: '你好，世界',
      voice: 'nova',
      response_format: 'mp3'
    })
    // 音频必须以二进制收，否则 axios 会按文本解码把 mp3 弄坏
    expect(config.responseType).toBe('arraybuffer')
    expect(result.voice).toBe('nova')
    expect(result.format).toBe('mp3')
    expect(result.filePath).toBeTruthy()
  })

  it('语音合成：已知模型用它的兜底音色，未知模型不猜声音也不省略 voice', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2]) })
    await openAiAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.voice).toBe('alloy')

    // 聚合器上的未知模型：不猜 alloy（第三方会回 speaker alloy not found），
    // 也不把 voice 省掉再发出去。OpenRouter 对没有服务端默认音色的模型会拒成
    // `Required field is not filled in (body.voice)`。那是音色 ID，不是语音样本。
    await expect(
      openAiAdapter.generateSpeech(provider(), 'fish-audio/s2.1-pro', { input: 'hi' })
    ).rejects.toThrow(/音色 ID/)
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('语音合成：已知不接受 voice 的模型仍然省略该字段', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2]) })
    await openAiAdapter.generateSpeech(provider(), 'bytedance-seed/seed-audio-1-0', {
      input: 'a calm narrator',
      voice: 'alloy'
    })
    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body).not.toHaveProperty('voice')
    expect(body.model).toBe('bytedance-seed/seed-audio-1-0')
  })

  it('语音合成：显式指定的声音照发（哪怕模型未知）', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2]) })
    await openAiAdapter.generateSpeech(provider(), 'some-aggregator-tts', {
      input: 'hi',
      voice: 'zh_female_1'
    })
    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.voice).toBe('zh_female_1')
  })

  it('语音合成：pcm 用 .pcm 后缀，speed 透传', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([9]) })
    const result = await openAiAdapter.generateSpeech(provider(), 'tts-1-hd', {
      input: 'hi',
      responseFormat: 'pcm',
      speed: 1.25
    })
    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.response_format).toBe('pcm')
    expect(body.speed).toBe(1.25)
    expect(result.format).toBe('pcm')
    expect(result.filePath?.endsWith('.pcm')).toBe(true)
  })

  it('语音合成：空音频要报错，上游错误要带出原文', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array(0) })
    await expect(
      openAiAdapter.generateSpeech(provider(), 'tts-1', { input: 'hi' })
    ).rejects.toThrow()

    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: { message: 'model not found' } } }
    })
    await expect(
      openAiAdapter.generateSpeech(provider(), 'nope', { input: 'hi', voice: 'alloy' })
    ).rejects.toThrow(/model not found/)
  })

  it('rejects video (Sora) with a clear message', async () => {
    await expect(openAiAdapter.submitVideo(provider(), 'sora-2', { prompt: 'x' })).rejects.toThrow(
      /暂未接入视频/
    )
  })
})
