import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Fetcher } from '@elevenlabs/elevenlabs-js/core'
import {
  createEmptyModalityMap,
  allowsEmptyApiKey,
  isElevenLabsProvider,
  supportsAudioModality,
  type ModelProviderInstance
} from '../src/shared/modelProvider'
import {
  buildElevenDialogueRequest,
  buildElevenMusicRequest,
  buildElevenSoundRequest,
  buildElevenTtsRequest,
  elevenFormatOf,
  elevenModelKind,
  filterElevenModelsByKind,
  isKnownElevenModel,
  listElevenFallbackModels,
  parseElevenModels,
  parseElevenTranscript,
  parseElevenVoices,
  resolveElevenMusicModel,
  resolveElevenOutputFormat
} from '../src/shared/modelProviders/elevenlabs/voice'

/**
 * ElevenLabs 适配器（官方 SDK 版）。
 *
 * 测试方式：把 SDK 的 `fetcher` 换成一个记录器 —— 这样测的是**真实 SDK 代码路径**
 * （路径、camelCase → snake_case 转换、query 参数拼装全由 SDK 做），
 * 而不是像以前那样绕过 SDK mock axios。
 *
 * 关键断言点是**线上真实字段名**（body 里是 `model_id`、`voice_id`、
 * `duration_seconds`，query 里是 `output_format`）—— SDK 负责从 camelCase 转换，
 * 所以这里能同时验证「我们传对了 SDK 参数」和「SDK 发出了正确的线格式」。
 */
const captured: Array<{
  url: string
  method: string
  headers: Record<string, unknown>
  body: unknown
  maxRetries?: number
}> = []

let nextResponse: () => Response = () =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'audio/mpeg' }
  })

/**
 * 记录器 fetcher。
 *
 * 三个要点（都是踩过才知道的）：
 * 1. SDK 把 query 作为**独立字段** `args.queryString` 传进来，**不拼进 url** ——
 *    真实 `core.fetcher` 才负责合并；这里必须自己拼，否则会误判成「SDK 丢了参数」
 * 2. SDK 期望返回的 `body` 已按 `responseType` 解码（json → 对象、streaming → 流），
 *    不是原始 Response；不解码会触发上游兜底分支
 * 3. `args.body` 已经是**线格式**（snake_case），所以断言的是真实字段名
 */
function makeFetcher(): Fetcher {
  return async (args) => {
    const query = args.queryString ? `?${args.queryString}` : ''
    captured.push({
      url: `${args.url}${query}`,
      method: args.method,
      headers: args.headers ?? {},
      body: args.body,
      maxRetries: args.maxRetries
    })
    const response = nextResponse()
    if (!response.ok) {
      return {
        ok: false,
        error: {
          reason: 'non-json',
          statusCode: response.status,
          rawBody: await response.text()
        },
        rawResponse: response
      } as never
    }
    const body =
      args.responseType === 'streaming' || args.responseType === 'blob'
        ? response.body
        : await response.json()
    return { ok: true, body, rawResponse: response } as never
  }
}

vi.mock('../src/main/services/modelProviders/elevenlabs/client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../src/main/services/modelProviders/elevenlabs/client')>()
  return {
    ...actual,
    // 保留真实实现，只把 fetcher 换成记录器
    createElevenClient: (provider: ModelProviderInstance, timeoutMs?: number) =>
      actual.createElevenClient(provider, timeoutMs, makeFetcher())
  }
})

import { elevenLabsAdapter } from '../src/main/services/modelProviders/elevenlabs/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'el-1',
    providerKind: 'elevenlabs',
    label: 'ElevenLabs',
    apiKey: 'sk_eleven_test',
    baseUrl: 'https://api.elevenlabs.io',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

function lastRequest() {
  const last = captured.at(-1)
  expect(last, '没有任何请求被发出').toBeTruthy()
  return last!
}

describe('ElevenLabs 协议映射（纯函数）', () => {
  it('请求体用 SDK 的 camelCase 形状', () => {
    expect(buildElevenTtsRequest({ text: '你好', modelId: 'eleven_v3' })).toEqual({
      text: '你好',
      modelId: 'eleven_v3'
    })
    // 可选字段为空时不写进 body（避免用空值覆盖上游默认）
    expect(buildElevenTtsRequest({ text: 'hi', modelId: '  ' })).toEqual({ text: 'hi' })

    expect(
      buildElevenDialogueRequest({
        inputs: [
          { text: '一', voice: 'v1' },
          { text: '二', voice: 'v2' }
        ],
        modelId: 'eleven_v3'
      })
    ).toEqual({
      inputs: [
        { text: '一', voiceId: 'v1' },
        { text: '二', voiceId: 'v2' }
      ],
      modelId: 'eleven_v3'
    })
  })

  it('输出格式只认支持的取值，非法值退回默认', () => {
    expect(resolveElevenOutputFormat('mp3_44100_192')).toBe('mp3_44100_192')
    expect(resolveElevenOutputFormat('pcm_24000')).toBe('pcm_24000')
    expect(resolveElevenOutputFormat('ulaw_8000')).toBe('mp3_44100_128')
    expect(resolveElevenOutputFormat(undefined)).toBe('mp3_44100_128')
    expect(elevenFormatOf('pcm_16000')).toEqual({ ext: 'wav', format: 'pcm' })
    expect(elevenFormatOf('mp3_44100_128')).toEqual({ ext: 'mp3', format: 'mp3' })
  })

  it('模型目录：全部保留并标注类别（过滤交给调用点）', () => {
    const models = parseElevenModels([
      {
        modelId: 'eleven_v3',
        name: 'Eleven v3',
        description: 'most expressive',
        languages: [{ name: 'zh' }, { name: 'en' }]
      },
      { modelId: 'scribe_v2', name: 'Scribe' },
      { modelId: 'music_v2_5', name: 'Music' },
      { modelId: 'eleven_text_to_sound_v2', name: 'SFX' },
      { modelId: '' },
      null as never
    ])
    // 规范/SDK 都**不含**「是 TTS 还是转写/音乐」的能力位
    // （只有 canDoTextToSpeech / canDoVoiceConversion / canUseStyle），
    // 所以类别按 id 约定判断并标注，各调用点再按需过滤
    expect(models.map((m) => m.id)).toEqual([
      'eleven_v3',
      'scribe_v2',
      'music_v2_5',
      'eleven_text_to_sound_v2'
    ])
    expect(models.map((m) => m.capabilities?.elevenKind)).toEqual(['tts', 'stt', 'music', 'sfx'])
    expect(models[0]!.capabilities?.languages).toEqual(['zh', 'en'])
    expect(filterElevenModelsByKind(models, 'tts').map((m) => m.id)).toEqual(['eleven_v3'])
    expect(filterElevenModelsByKind(models, 'music').map((m) => m.id)).toEqual(['music_v2_5'])
  })

  it('类别判定：认不出的 id 归 other', () => {
    expect(elevenModelKind('eleven_v3')).toBe('tts')
    expect(elevenModelKind('scribe_v2_turbo')).toBe('stt')
    expect(elevenModelKind('music_v1')).toBe('music')
    expect(elevenModelKind('eleven_text_to_sound_v2')).toBe('sfx')
    expect(elevenModelKind('some-future-thing')).toBe('other')
    expect(elevenModelKind('')).toBe('other')
  })

  it('音色目录：取 voiceId + 名字（SDK 已是 camelCase）', () => {
    expect(
      parseElevenVoices({
        voices: [
          { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah - Mature', category: 'premade' },
          { voiceId: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger' },
          { voiceId: '' }
        ]
      })
    ).toEqual([
      { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah - Mature', category: 'premade' },
      { id: 'CwhRBWXzGAHq8TQ4Fs17', label: 'Roger' }
    ])
    expect(parseElevenVoices(null)).toEqual([])
  })

  it('离线兜底表覆盖主流 TTS 模型', () => {
    const ids = listElevenFallbackModels().map((m) => m.id)
    expect(ids).toContain('eleven_v3')
    expect(ids).toContain('eleven_multilingual_v2')
    expect(isKnownElevenModel('eleven_v3')).toBe(true)
    expect(isKnownElevenModel('nope')).toBe(false)
  })

  it('转写：词级时间戳按句读聚合成段，spacing 不进正文', () => {
    const result = parseElevenTranscript(
      {
        text: '你好。世界',
        languageCode: 'zho',
        words: [
          { text: '你好', start: 0, end: 0.5, type: 'word' },
          { text: '。', start: 0.5, end: 0.6, type: 'word' },
          { text: ' ', start: 0.6, end: 0.7, type: 'spacing' },
          { text: '世界', start: 0.7, end: 1.2, type: 'word' }
        ]
      },
      'scribe_v2'
    )
    expect(result.segments).toEqual([
      { startSec: 0, endSec: 0.6, text: '你好。' },
      { startSec: 0.7, endSec: 1.2, text: '世界' }
    ])
    expect(result.text).toBe('你好。世界')
    expect(result.language).toBe('zho')
  })

  it('转写：没有词级时间戳时退化为整段', () => {
    const result = parseElevenTranscript({ text: '整段文本' }, 'scribe_v2')
    expect(result.segments).toEqual([{ startSec: 0, endSec: 0, text: '整段文本' }])
  })
})

describe('ElevenLabs provider 接线（走真实 SDK）', () => {
  beforeEach(() => {
    captured.length = 0
    nextResponse = () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' }
      })
  })

  it('被认定为「支持音频」且只有音频模态', () => {
    expect(supportsAudioModality('elevenlabs')).toBe(true)
    expect(isElevenLabsProvider('elevenlabs')).toBe(true)
    expect(allowsEmptyApiKey('elevenlabs')).toBe(true)
  })

  it('语音合成：路径带 voiceId，body 是 model_id，output_format 走 query', async () => {
    await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: '你好世界',
      voice: 'EXAVITQu4vr4xnSDxMaL'
    })
    const req = lastRequest()
    expect(req.method).toBe('POST')
    expect(req.url).toContain('/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL')
    expect(req.url).toContain('output_format=mp3_44100_128')
    // SDK 把我们传的 camelCase 转成线格式的 snake_case
    expect(req.body).toMatchObject({ text: '你好世界', model_id: 'eleven_v3' })
    expect(req.headers['xi-api-key']).toBe('sk_eleven_test')
  })

  /**
   * 生成接口是**按次计费**的：SDK 默认重试 2 次，一次超时就会重复扣费。
   * 客户端与每次请求都必须关掉重试。
   */
  it('所有生成调用都不重试（避免按次计费被重复扣）', async () => {
    await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: 'hi',
      voice: 'v1'
    })
    expect(lastRequest().maxRetries).toBe(0)

    captured.length = 0
    await elevenLabsAdapter.generateSoundEffect?.(provider(), '', { prompt: '雨声' })
    expect(lastRequest().maxRetries).toBe(0)

    captured.length = 0
    await elevenLabsAdapter.generateMusic?.(provider(), 'music_v2_5', { prompt: '配乐' })
    expect(lastRequest().maxRetries).toBe(0)
  })

  it('要 pcm 时落 .wav 并标记为 pcm', async () => {
    const result = await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: 'hi',
      voice: 'v1',
      responseFormat: 'pcm_16000'
    })
    expect(result.format).toBe('pcm')
    expect(result.filePath?.endsWith('.wav')).toBe(true)
    expect(lastRequest().url).toContain('output_format=pcm_16000')
  })

  it('没给音色时明确报错，不发请求', async () => {
    await expect(
      elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', { input: 'hi' })
    ).rejects.toThrow(/voice_id/)
    expect(captured).toHaveLength(0)
  })

  it('给了 dialogue 就改走 /v1/text-to-dialogue（voice_id 是对象字段）', async () => {
    const result = await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: 'A: 你好\nB: 我也好',
      dialogue: [
        { text: '你好', voice: 'voice-a' },
        { text: '我也好', voice: 'voice-b' }
      ]
    })
    const req = lastRequest()
    expect(req.url).toContain('/v1/text-to-dialogue')
    expect(req.body).toMatchObject({
      inputs: [
        { text: '你好', voice_id: 'voice-a' },
        { text: '我也好', voice_id: 'voice-b' }
      ],
      model_id: 'eleven_v3'
    })
    expect(result.voice).toBe('voice-a,voice-b')
    expect(result.assetId).toBeUndefined()
  })

  it('dialogue 里全无效段时退回单说话人端点', async () => {
    await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: 'x',
      voice: 'voice-a',
      dialogue: [{ text: '   ', voice: 'voice-a' }]
    })
    expect(lastRequest().url).toContain('/v1/text-to-speech/voice-a')
  })

  it('音效：/v1/sound-generation，model_id 恒为唯一取值', async () => {
    const result = await elevenLabsAdapter.generateSoundEffect?.(provider(), 'eleven_v3', {
      prompt: '雨落在铁皮屋顶上',
      loop: true
    })
    const req = lastRequest()
    expect(req.url).toContain('/v1/sound-generation')
    expect(req.body).toMatchObject({
      text: '雨落在铁皮屋顶上',
      loop: true,
      model_id: 'eleven_text_to_sound_v2'
    })
    expect(result?.model).toBe('eleven_text_to_sound_v2')
    expect(result?.filePath).toBeTruthy()
  })

  it('音效：空描述明确报错，不发请求', async () => {
    await expect(
      elevenLabsAdapter.generateSoundEffect?.(provider(), '', { prompt: '  ' })
    ).rejects.toThrow(/描述/)
    expect(captured).toHaveLength(0)
  })

  it('音乐：/v1/music，模型收窄到 SDK 认可的取值', async () => {
    await elevenLabsAdapter.generateMusic?.(provider(), 'music_v2_5', {
      prompt: '轻快的电子配乐',
      instrumental: true
    })
    const req = lastRequest()
    expect(req.url).toContain('/v1/music')
    expect(req.body).toMatchObject({
      prompt: '轻快的电子配乐',
      force_instrumental: true,
      model_id: 'music_v2_5'
    })
  })

  it('音乐：空提示词明确报错', async () => {
    await expect(
      elevenLabsAdapter.generateMusic?.(provider(), 'music_v2_5', { prompt: '   ' })
    ).rejects.toThrow(/提示词/)
    expect(captured).toHaveLength(0)
  })

  it('音频目录接口返回全量（TTS + 转写 + 音乐），fetchCatalog 按模态分流', async () => {
    nextResponse = () =>
      new Response(
        JSON.stringify([
          { model_id: 'eleven_v3', name: 'Eleven v3' },
          { model_id: 'scribe_v2', name: 'Scribe v2' },
          { model_id: 'music_v2_5', name: 'Music v2.5' }
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    const all = await elevenLabsAdapter.listAllAudioModels?.(provider())
    expect(all?.map((m) => m.id)).toEqual(['eleven_v3', 'scribe_v2', 'music_v2_5'])
    const ttsOnly = await elevenLabsAdapter.fetchCatalog(provider(), 'audio')
    expect(ttsOnly.map((m) => m.id)).toEqual(['eleven_v3'])
    // 音乐页签要拿到 music_*（混进 TTS / 转写会让人选到不能编曲的模型）
    const musicOnly = await elevenLabsAdapter.fetchCatalog(provider(), 'music')
    expect(musicOnly.map((m) => m.id)).toEqual(['music_v2_5'])
  })

  it('音乐目录拉不到时退回本地表，且本地表里有音乐模型（页签不能是空的）', async () => {
    // 两个失败口：接口报错、接口返回的形状不是数组
    nextResponse = () =>
      new Response(JSON.stringify({ detail: { message: 'nope' } }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    const onError = await elevenLabsAdapter.fetchCatalog(provider(), 'music')
    expect(onError.length).toBeGreaterThan(0)
    expect(onError.every((m) => m.capabilities?.elevenKind === 'music')).toBe(true)

    nextResponse = () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    const onOddShape = await elevenLabsAdapter.fetchCatalog(provider(), 'music')
    expect(onOddShape.map((m) => m.id)).toContain('music_v2_5')

    // 不支持该模态时不返回别的类别顶数
    const unsupported = await elevenLabsAdapter.fetchCatalog(provider(), 'model3d')
    expect(unsupported).toEqual([])
  })

  it('音色标签：voiceId → 名字，供声音节点显示', async () => {
    nextResponse = () =>
      new Response(
        JSON.stringify({
          voices: [
            { voice_id: 'v1', name: 'Sarah - Mature' },
            { voice_id: 'v2', name: 'Roger - Casual' }
          ]
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    const labels = await elevenLabsAdapter.fetchVoiceLabels?.(provider())
    expect(labels).toEqual({ v1: 'Sarah - Mature', v2: 'Roger - Casual' })
  })

  it('上游错误原文要带出来', async () => {
    nextResponse = () =>
      new Response(JSON.stringify({ detail: { message: 'invalid api key' } }), {
        status: 401,
        headers: { 'content-type': 'application/json' }
      })
    await expect(
      elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', { input: 'hi', voice: 'v1' })
    ).rejects.toThrow(/invalid api key/)
  })

  it('文本 / 图片 / 视频 / 3D 明确不支持', async () => {
    await expect(elevenLabsAdapter.generateText(provider(), 'x', { prompt: 'hi' })).rejects.toThrow(
      /语音合成/
    )
    await expect(
      elevenLabsAdapter.generateImage(provider(), 'x', { prompt: 'hi' })
    ).rejects.toThrow(/语音合成/)
    await expect(elevenLabsAdapter.submitVideo(provider(), 'x', { prompt: 'hi' })).rejects.toThrow(
      /语音合成/
    )
    await expect(
      elevenLabsAdapter.submitModel3d(provider(), 'x', { prompt: 'hi' })
    ).rejects.toThrow(/语音合成/)
  })
})

describe('音效数值字段按规范夹紧', () => {
  it('duration 0.5–30、prompt_influence 0–1', () => {
    expect(buildElevenSoundRequest({ text: 'x', durationSeconds: 0.2 }).durationSeconds).toBe(0.5)
    expect(buildElevenSoundRequest({ text: 'x', durationSeconds: 60 }).durationSeconds).toBe(30)
    expect(buildElevenSoundRequest({ text: 'x', durationSeconds: 12 }).durationSeconds).toBe(12)
    expect(buildElevenSoundRequest({ text: 'x', promptInfluence: -1 }).promptInfluence).toBe(0)
    expect(buildElevenSoundRequest({ text: 'x', promptInfluence: 3 }).promptInfluence).toBe(1)
    // 不传就不写（沿用服务端默认 0.3，而不是替它填一个值）
    expect(buildElevenSoundRequest({ text: 'x' }).promptInfluence).toBeUndefined()
    // 显式 loop=false 不写进去
    expect(buildElevenSoundRequest({ text: 'x', loop: false }).loop).toBeUndefined()
  })

  it('音乐模型收窄：非法值退回 music_v2_5', () => {
    expect(resolveElevenMusicModel('music_v2')).toBe('music_v2')
    expect(resolveElevenMusicModel('music_v2_5')).toBe('music_v2_5')
    // 主进程可能退回声音页签里的 TTS 模型，绝不能原样发出去
    expect(resolveElevenMusicModel('eleven_v3')).toBe('music_v2_5')
    expect(resolveElevenMusicModel(undefined)).toBe('music_v2_5')
    expect(buildElevenMusicRequest({ prompt: 'p', modelId: 'eleven_v3' }).modelId).toBe(
      'music_v2_5'
    )
  })
})
