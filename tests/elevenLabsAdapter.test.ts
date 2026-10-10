import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import axios from 'axios'
import {
  createEmptyModalityMap,
  allowsEmptyApiKey,
  isElevenLabsProvider,
  supportsAudioModality,
  type ModelProviderInstance
} from '../src/shared/modelProvider'
import { segmentsToUtterances } from '../src/shared/semanticTimeline/utterances'
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
import { elevenLabsAdapter } from '../src/main/services/modelProviders/elevenlabs/adapter'

/**
 * ElevenLabs 适配器（直连 HTTP，不用官方 SDK）。
 *
 * 用 axios mock adapter 记录真实发出的请求：路径、snake_case body、
 * `output_format` query、`xi-api-key` 头。
 */

type Captured = {
  url: string
  method: string
  headers: Record<string, unknown>
  data: unknown
  params?: unknown
}

const captured: Captured[] = []
let nextHandler: (config: {
  url?: string
  method?: string
  headers?: Record<string, unknown>
  data?: unknown
  params?: unknown
  responseType?: string
}) => { status: number; data: unknown; headers?: Record<string, string> } = () => ({
  status: 200,
  data: new ArrayBuffer(3),
  headers: { 'content-type': 'audio/mpeg' }
})

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

beforeEach(() => {
  captured.length = 0
  nextHandler = () => ({
    status: 200,
    data: new ArrayBuffer(3),
    headers: { 'content-type': 'audio/mpeg' }
  })
  vi.spyOn(axios, 'create').mockImplementation((defaults) => {
    const baseURL = String(defaults?.baseURL ?? '')
    const defaultHeaders = { ...(defaults?.headers as Record<string, unknown>) }
    return {
      defaults,
      get: async (url: string, config?: { headers?: Record<string, unknown> }) => {
        const headers = { ...defaultHeaders, ...config?.headers }
        captured.push({ url: `${baseURL}${url}`, method: 'GET', headers, data: undefined })
        const res = nextHandler({ url, method: 'GET', headers })
        if (res.status >= 400) {
          const err = Object.assign(new Error(`Request failed with status code ${res.status}`), {
            isAxiosError: true,
            response: { status: res.status, data: res.data, headers: res.headers ?? {} },
            config: { url }
          })
          throw err
        }
        return { data: res.data, status: res.status, headers: res.headers ?? {}, config: {} }
      },
      post: async (
        url: string,
        data?: unknown,
        config?: {
          headers?: Record<string, unknown>
          params?: Record<string, unknown>
          responseType?: string
        }
      ) => {
        const headers = { ...defaultHeaders, ...config?.headers }
        const query =
          config?.params && typeof config.params.output_format === 'string'
            ? `?output_format=${config.params.output_format}`
            : ''
        captured.push({
          url: `${baseURL}${url}${query}`,
          method: 'POST',
          headers,
          data,
          params: config?.params
        })
        const res = nextHandler({
          url,
          method: 'POST',
          headers,
          data,
          params: config?.params,
          responseType: config?.responseType
        })
        if (res.status >= 400) {
          const err = Object.assign(new Error(`Request failed with status code ${res.status}`), {
            isAxiosError: true,
            response: { status: res.status, data: res.data, headers: res.headers ?? {} },
            config: { url, responseType: config?.responseType }
          })
          throw err
        }
        return { data: res.data, status: res.status, headers: res.headers ?? {}, config: {} }
      }
    } as never
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ElevenLabs 协议映射（纯函数）', () => {
  it('请求体用线格式 snake_case', () => {
    expect(buildElevenTtsRequest({ text: '你好', modelId: 'eleven_v3' })).toEqual({
      text: '你好',
      model_id: 'eleven_v3'
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
        { text: '一', voice_id: 'v1' },
        { text: '二', voice_id: 'v2' }
      ],
      model_id: 'eleven_v3'
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
        model_id: 'eleven_v3',
        name: 'Eleven v3',
        description: 'most expressive',
        languages: [{ name: 'zh' }, { name: 'en' }]
      },
      { model_id: 'scribe_v2', name: 'Scribe' },
      { model_id: 'music_v2_5', name: 'Music' },
      { model_id: 'eleven_text_to_sound_v2', name: 'SFX' },
      { model_id: '' },
      null
    ])
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

  it('音色目录：取 voice_id + 名字（兼容 camelCase）', () => {
    expect(
      parseElevenVoices({
        voices: [
          { voice_id: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah - Mature', category: 'premade' },
          { voiceId: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger' },
          { voice_id: '' }
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
        language_code: 'zho',
        words: [
          { text: '你好', start: 0, end: 0.5, type: 'word' },
          { text: '。', start: 0.5, end: 0.6, type: 'word' },
          { text: ' ', start: 0.6, end: 0.7, type: 'spacing' },
          { text: '世界', start: 0.7, end: 1.2, type: 'word' }
        ]
      },
      'scribe_v2'
    )
    expect(
      result.segments.map((s) => ({ startSec: s.startSec, endSec: s.endSec, text: s.text }))
    ).toEqual([
      { startSec: 0, endSec: 0.6, text: '你好。' },
      { startSec: 0.7, endSec: 1.2, text: '世界' }
    ])
    // 词级时间戳要留在段上（下游按「段里带不带 words」判定词级），spacing 不进正文也不进 words
    expect(result.segments[0]!.words).toEqual([
      { text: '你好', startSec: 0, endSec: 0.5 },
      { text: '。', startSec: 0.5, endSec: 0.6 }
    ])
    expect(result.segments[1]!.words).toEqual([{ text: '世界', startSec: 0.7, endSec: 1.2 }])
    expect(result.granularity).toBe('word')
    expect(result.text).toBe('你好。世界')
    expect(result.language).toBe('zho')

    // 下游效果：utterances 拿到词级时间与 word 级标记（否则分析会报「word timestamps unavailable」）
    const utterances = segmentsToUtterances(result.segments, 30, result.granularity ?? 'sentence')
    expect(utterances.map((u) => u.text)).toEqual(['你好。', '世界'])
    expect(utterances.every((u) => u.granularity === 'word')).toBe(true)
    expect(utterances[0]!.words?.map((w) => w.text)).toEqual(['你好', '。'])
  })

  it('转写：没有词级时间戳时退化为整段，并显式声明 sentence', () => {
    const result = parseElevenTranscript({ text: '整段文本' }, 'scribe_v2')
    expect(result.segments).toEqual([{ startSec: 0, endSec: 0, text: '整段文本' }])
    expect(result.granularity).toBe('sentence')
  })
})

describe('ElevenLabs provider 接线（直连 HTTP）', () => {
  it('被认定为「支持音频」且只有音频模态', () => {
    expect(supportsAudioModality('elevenlabs')).toBe(true)
    expect(isElevenLabsProvider('elevenlabs')).toBe(true)
    expect(allowsEmptyApiKey('elevenlabs')).toBe(true)
  })

  it('语音合成：路径带 voice_id，body 是 model_id，output_format 走 query', async () => {
    await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: '你好世界',
      voice: 'EXAVITQu4vr4xnSDxMaL'
    })
    const req = lastRequest()
    expect(req.method).toBe('POST')
    expect(req.url).toContain('/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL')
    expect(req.url).toContain('output_format=mp3_44100_128')
    expect(req.data).toMatchObject({ text: '你好世界', model_id: 'eleven_v3' })
    expect(req.headers['xi-api-key']).toBe('sk_eleven_test')
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
    expect(req.data).toMatchObject({
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
    expect(req.data).toMatchObject({
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

  it('音乐：/v1/music，模型收窄到规范认可的取值', async () => {
    await elevenLabsAdapter.generateMusic?.(provider(), 'music_v2_5', {
      prompt: '轻快的电子配乐',
      instrumental: true
    })
    const req = lastRequest()
    expect(req.url).toContain('/v1/music')
    expect(req.data).toMatchObject({
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
    nextHandler = () => ({
      status: 200,
      data: [
        { model_id: 'eleven_v3', name: 'Eleven v3' },
        { model_id: 'scribe_v2', name: 'Scribe v2' },
        { model_id: 'music_v2_5', name: 'Music v2.5' }
      ]
    })
    const all = await elevenLabsAdapter.listAllAudioModels?.(provider())
    expect(all?.map((m) => m.id)).toEqual(['eleven_v3', 'scribe_v2', 'music_v2_5'])
    const ttsOnly = await elevenLabsAdapter.fetchCatalog(provider(), 'audio')
    expect(ttsOnly.map((m) => m.id)).toEqual(['eleven_v3'])
    const musicOnly = await elevenLabsAdapter.fetchCatalog(provider(), 'music')
    expect(musicOnly.map((m) => m.id)).toEqual(['music_v2_5'])
    const sfxOnly = await elevenLabsAdapter.fetchCatalog(provider(), 'sfx')
    expect(sfxOnly.map((m) => m.id)).toEqual(['eleven_text_to_sound_v2'])
    expect(sfxOnly.every((m) => m.modality === 'sfx')).toBe(true)
  })

  it('音乐目录拉不到时退回本地表，且本地表里有音乐模型（页签不能是空的）', async () => {
    nextHandler = () => ({
      status: 400,
      data: { detail: { message: 'nope' } }
    })
    const onError = await elevenLabsAdapter.fetchCatalog(provider(), 'music')
    expect(onError.length).toBeGreaterThan(0)
    expect(onError.every((m) => m.capabilities?.elevenKind === 'music')).toBe(true)

    nextHandler = () => ({
      status: 200,
      data: {}
    })
    const onOddShape = await elevenLabsAdapter.fetchCatalog(provider(), 'music')
    expect(onOddShape.map((m) => m.id)).toContain('music_v2_5')

    const unsupported = await elevenLabsAdapter.fetchCatalog(provider(), 'model3d')
    expect(unsupported).toEqual([])
  })

  it('账号目录里只有 TTS、没有音乐时，音乐仍然给得出来（按类别兜底）', async () => {
    nextHandler = () => ({
      status: 200,
      data: [
        { model_id: 'eleven_v3', name: 'Eleven v3', can_do_text_to_speech: true },
        { model_id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5' }
      ]
    })

    const tts = await elevenLabsAdapter.fetchCatalog(provider(), 'audio')
    expect(tts.map((m) => m.id)).toEqual(['eleven_v3', 'eleven_flash_v2_5'])

    const music = await elevenLabsAdapter.fetchCatalog(provider(), 'music')
    expect(music.map((m) => m.id)).toContain('music_v2_5')
    expect(music.every((m) => m.capabilities?.elevenKind === 'music')).toBe(true)

    const sfx = await elevenLabsAdapter.fetchCatalog(provider(), 'sfx')
    expect(sfx.map((m) => m.id)).toContain('eleven_text_to_sound_v2')
    expect(sfx.every((m) => m.capabilities?.elevenKind === 'sfx')).toBe(true)
  })

  it('音色标签：voice_id → 名字，供声音节点显示', async () => {
    nextHandler = () => ({
      status: 200,
      data: {
        voices: [
          { voice_id: 'v1', name: 'Sarah - Mature' },
          { voice_id: 'v2', name: 'Roger - Casual' }
        ]
      }
    })
    const labels = await elevenLabsAdapter.fetchVoiceLabels?.(provider())
    expect(labels).toEqual({ v1: 'Sarah - Mature', v2: 'Roger - Casual' })
  })

  it('上游错误原文要带出来', async () => {
    nextHandler = () => ({
      status: 401,
      data: { detail: { message: 'invalid api key' } }
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
    expect(buildElevenSoundRequest({ text: 'x', durationSeconds: 0.2 }).duration_seconds).toBe(0.5)
    expect(buildElevenSoundRequest({ text: 'x', durationSeconds: 60 }).duration_seconds).toBe(30)
    expect(buildElevenSoundRequest({ text: 'x', durationSeconds: 12 }).duration_seconds).toBe(12)
    expect(buildElevenSoundRequest({ text: 'x', promptInfluence: -1 }).prompt_influence).toBe(0)
    expect(buildElevenSoundRequest({ text: 'x', promptInfluence: 3 }).prompt_influence).toBe(1)
    expect(buildElevenSoundRequest({ text: 'x' }).prompt_influence).toBeUndefined()
    expect(buildElevenSoundRequest({ text: 'x', loop: false }).loop).toBeUndefined()
  })

  it('音乐模型收窄：非法值退回 music_v2_5', () => {
    expect(resolveElevenMusicModel('music_v2')).toBe('music_v2')
    expect(resolveElevenMusicModel('music_v2_5')).toBe('music_v2_5')
    expect(resolveElevenMusicModel('eleven_v3')).toBe('music_v2_5')
    expect(resolveElevenMusicModel(undefined)).toBe('music_v2_5')
    expect(buildElevenMusicRequest({ prompt: 'p', modelId: 'eleven_v3' }).model_id).toBe(
      'music_v2_5'
    )
  })
})
