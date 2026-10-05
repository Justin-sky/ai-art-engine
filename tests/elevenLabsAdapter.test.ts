import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyModalityMap,
  allowsEmptyApiKey,
  isElevenLabsProvider,
  supportsAudioModality,
  type ModelProviderInstance
} from '../src/shared/modelProvider'
import {
  buildElevenTtsBody,
  elevenFormatOf,
  elevenTtsPath,
  isKnownElevenModel,
  listElevenFallbackModels,
  parseElevenModels,
  parseElevenVoices,
  resolveElevenOutputFormat
} from '../src/shared/modelProviders/elevenlabs/voice'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: (config: Record<string, unknown>) => ({
      // 原样保留 create 的配置，便于断言 baseURL / 鉴权头
      defaults: config,
      get: getMock,
      post: postMock,
      interceptors: { request: { use: () => undefined } }
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import { elevenLabsAdapter } from '../src/main/services/modelProviders/elevenlabs/adapter'
import { createElevenLabsHttpClient } from '../src/main/services/modelProviders/elevenlabs/http'
import { readElevenLabsHttpError } from '../src/main/services/modelProviders/elevenlabs/httpError'

/**
 * ElevenLabs 语音合成。
 *
 * 事实全部核对自官方 `openapi.json`（`https://api.elevenlabs.io/openapi.json`）：
 * - 端点 `POST /v1/text-to-speech/{voice_id}`，body 唯一必填是 `text`
 * - `model_id` 默认 `eleven_multilingual_v2`
 * - 鉴权头是 `xi-api-key`（不是 Bearer）
 * - `GET /v1/voices` 给出 voice_id / name（无 Key 也返回公开音色）
 */
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

describe('ElevenLabs 协议映射（纯函数）', () => {
  it('端点把 voice_id 编码进路径', () => {
    expect(elevenTtsPath('21m00Tcm4TlvDq8ikWAM')).toBe('/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM')
    // 自定义音色 id 里可能有需要转义的字符
    expect(elevenTtsPath('a/b c')).toBe('/v1/text-to-speech/a%2Fb%20c')
  })

  it('请求体只带规范里的字段，text 必有', () => {
    expect(buildElevenTtsBody({ text: '你好', modelId: 'eleven_v3' })).toEqual({
      text: '你好',
      model_id: 'eleven_v3'
    })
    // 可选字段为空时不写进 body（避免用空值覆盖上游默认）
    expect(
      buildElevenTtsBody({ text: 'hi', modelId: '', languageCode: '  ', voiceSettings: {} })
    ).toEqual({ text: 'hi' })
    expect(
      buildElevenTtsBody({
        text: 'hi',
        modelId: 'eleven_v3',
        languageCode: 'zh',
        seed: 42.9,
        applyTextNormalization: 'on'
      })
    ).toEqual({
      text: 'hi',
      model_id: 'eleven_v3',
      language_code: 'zh',
      seed: 42,
      apply_text_normalization: 'on'
    })
  })

  it('输出格式只认支持的取值，非法值退回默认', () => {
    expect(resolveElevenOutputFormat('mp3_44100_192')).toBe('mp3_44100_192')
    expect(resolveElevenOutputFormat('pcm_24000')).toBe('pcm_24000')
    expect(resolveElevenOutputFormat('ulaw_8000')).toBe('mp3_44100_128')
    expect(resolveElevenOutputFormat(undefined)).toBe('mp3_44100_128')
  })

  it('格式决定扩展名与 format 标记', () => {
    expect(elevenFormatOf('mp3_44100_128')).toEqual({
      ext: 'mp3',
      format: 'mp3',
      contentTypeHint: 'audio/mpeg'
    })
    expect(elevenFormatOf('pcm_16000').format).toBe('pcm')
    expect(elevenFormatOf('pcm_16000').ext).toBe('wav')
  })

  it('模型目录：排除不能做 TTS 的模型，保留语言信息', () => {
    const models = parseElevenModels([
      {
        model_id: 'eleven_v3',
        name: 'Eleven v3',
        description: 'most expressive',
        languages: [{ name: 'zh' }, { name: 'en' }]
      },
      { model_id: 'scribe_v1', name: 'Scribe', can_do_text_to_speech: false },
      { model_id: '' },
      'not-an-object'
    ])
    expect(models.map((m) => m.id)).toEqual(['eleven_v3'])
    expect(models[0]!.modality).toBe('audio')
    expect(models[0]!.capabilities?.languages).toEqual(['zh', 'en'])
  })

  it('音色目录：取 voice_id + 名字（名字就是要显示给用户的）', () => {
    const voices = parseElevenVoices({
      voices: [
        {
          voice_id: 'EXAVITQu4vr4xnSDxMaL',
          name: 'Sarah - Mature, Reassuring',
          category: 'premade'
        },
        { voice_id: 'CwhRBWXzGAHq8TQ4Fs17', name: 'Roger' },
        { voice_id: '' },
        null
      ]
    })
    expect(voices).toEqual([
      { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah - Mature, Reassuring', category: 'premade' },
      { id: 'CwhRBWXzGAHq8TQ4Fs17', label: 'Roger' }
    ])
    // 不是预期形状时不抛错，只是空
    expect(parseElevenVoices(null)).toEqual([])
    expect(parseElevenVoices({ voices: 'nope' })).toEqual([])
  })

  it('离线兜底表覆盖主流 TTS 模型', () => {
    const ids = listElevenFallbackModels().map((m) => m.id)
    expect(ids).toContain('eleven_v3')
    expect(ids).toContain('eleven_multilingual_v2')
    expect(isKnownElevenModel('eleven_v3')).toBe(true)
    expect(isKnownElevenModel('nope')).toBe(false)
  })
})

describe('ElevenLabs provider 接线', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('鉴权头是 xi-api-key（不是 Bearer），Base URL 去掉尾斜杠', () => {
    // 这条单独验：适配器的 postMock 断言看不到 client 的默认头
    const client = createElevenLabsHttpClient(
      provider({ baseUrl: 'https://api.elevenlabs.io/' })
    ) as unknown as { defaults: { baseURL?: string; headers?: Record<string, string> } }
    expect(client.defaults.baseURL).toBe('https://api.elevenlabs.io')
    expect(client.defaults.headers?.['xi-api-key']).toBe('sk_eleven_test')
    expect(JSON.stringify(client.defaults.headers)).not.toContain('Bearer')
    // 没填 Key 时不发空的鉴权头（公开目录端点仍可用）
    const anonymous = createElevenLabsHttpClient(provider({ apiKey: '' })) as unknown as {
      defaults: { headers?: Record<string, string> }
    }
    expect(anonymous.defaults.headers?.['xi-api-key']).toBeUndefined()
  })

  it('错误体 detail.message 能取出来（通用实现只认字符串 detail）', async () => {
    const axiosErr = {
      isAxiosError: true,
      response: { status: 401, data: { detail: { message: 'invalid api key', status: 'auth' } } }
    }
    await expect(readElevenLabsHttpError(axiosErr)).resolves.toBe('invalid api key')
    // 字段级校验错误（数组）
    await expect(
      readElevenLabsHttpError({
        isAxiosError: true,
        response: {
          status: 422,
          data: { detail: [{ msg: 'text too long' }, { msg: 'bad voice' }] }
        }
      })
    ).resolves.toBe('text too long; bad voice')
    // 字符串 detail 与 message 兜底
    await expect(
      readElevenLabsHttpError({
        isAxiosError: true,
        response: { status: 400, data: { message: 'nope' } }
      })
    ).resolves.toBe('nope')
  })

  it('被认定为「支持音频」且只有音频模态', () => {
    expect(supportsAudioModality('elevenlabs')).toBe(true)
    expect(isElevenLabsProvider('elevenlabs')).toBe(true)
    // 目录公开可读，所以允许先配后填 Key
    expect(allowsEmptyApiKey('elevenlabs')).toBe(true)
  })

  it('目录只服务音频模态（模型 + 失败兜底）', async () => {
    getMock.mockResolvedValueOnce({
      data: [{ model_id: 'eleven_v3', name: 'Eleven v3' }]
    })
    const models = await elevenLabsAdapter.fetchCatalog(provider(), 'audio')
    expect(models.map((m) => m.id)).toEqual(['eleven_v3'])

    // 远端失败 → 退回离线兜底表，不是空列表（否则声音节点无从选择）
    getMock.mockRejectedValueOnce(new Error('network'))
    const fallback = await elevenLabsAdapter.fetchCatalog(provider(), 'audio')
    expect(fallback.length).toBeGreaterThan(0)

    // 其它模态一律空
    getMock.mockClear()
    expect(await elevenLabsAdapter.fetchCatalog(provider(), 'image')).toEqual([])
    expect(getMock).not.toHaveBeenCalled()
  })

  it('语音合成：POST /v1/text-to-speech/{voice_id}，xi-api-key 鉴权，output_format 走 query', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2, 3]) })
    const result = await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: '你好世界',
      voice: 'EXAVITQu4vr4xnSDxMaL'
    })

    const [path, body, config] = postMock.mock.calls[0] as [
      string,
      Record<string, unknown>,
      { params?: Record<string, unknown>; responseType?: string }
    ]
    expect(path).toBe('/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL')
    expect(body).toEqual({ text: '你好世界', model_id: 'eleven_v3' })
    expect(config.params).toEqual({ output_format: 'mp3_44100_128' })
    expect(config.responseType).toBe('arraybuffer')
    expect(result.voice).toBe('EXAVITQu4vr4xnSDxMaL')
    expect(result.format).toBe('mp3')
    expect(result.filePath).toBeTruthy()
    // 遵守既定契约：适配器只给 filePath，assetId/relativePath 由 facade 补
    expect(result.assetId).toBeUndefined()
  })

  it('要 pcm 时落 .wav 并标记为 pcm', async () => {
    postMock.mockResolvedValueOnce({ data: new Uint8Array([9]) })
    const result = await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
      input: 'hi',
      voice: 'v1',
      responseFormat: 'pcm_16000'
    })
    expect(result.format).toBe('pcm')
    expect(result.filePath?.endsWith('.wav')).toBe(true)
  })

  it('没给音色时明确报错（voice_id 在路径里，缺了连端点都拼不出来）', async () => {
    await expect(
      elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', { input: 'hi' })
    ).rejects.toThrow(/voice_id/)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('上游错误原文要带出来', async () => {
    postMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 401, data: { detail: { message: 'invalid api key' } } }
    })
    await expect(
      elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', { input: 'hi', voice: 'v1' })
    ).rejects.toThrow(/invalid api key/)
  })

  it('音色标签：voice_id → 名字，供声音节点显示', async () => {
    getMock.mockResolvedValueOnce({
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
