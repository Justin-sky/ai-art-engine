import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEmptyModalityMap,
  allowsEmptyApiKey,
  isElevenLabsProvider,
  supportsAudioModality,
  type ModelProviderInstance
} from '../src/shared/modelProvider'
import {
  buildElevenDialogueBody,
  buildElevenMusicBody,
  buildElevenSoundBody,
  buildElevenTtsBody,
  elevenFormatOf,
  elevenModelKind,
  elevenTtsPath,
  filterElevenModelsByKind,
  isKnownElevenModel,
  listElevenFallbackModels,
  parseElevenModels,
  parseElevenTranscript,
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
      'not-an-object'
    ])
    // 规范里 /v1/models **不含**「是 TTS 还是转写/音乐」的能力位
    // （只有 can_do_text_to_speech / can_do_voice_conversion / can_use_style），
    // 所以类别按 id 约定判断并标注，各调用点再按需过滤
    expect(models.map((m) => m.id)).toEqual([
      'eleven_v3',
      'scribe_v2',
      'music_v2_5',
      'eleven_text_to_sound_v2'
    ])
    expect(models.map((m) => m.capabilities?.elevenKind)).toEqual(['tts', 'stt', 'music', 'sfx'])
    expect(models[0]!.modality).toBe('audio')
    expect(models[0]!.capabilities?.languages).toEqual(['zh', 'en'])
    // 声音节点只要 tts，时间线 BGM 只要 music
    expect(filterElevenModelsByKind(models, 'tts').map((m) => m.id)).toEqual(['eleven_v3'])
    expect(filterElevenModelsByKind(models, 'music').map((m) => m.id)).toEqual(['music_v2_5'])
    expect(filterElevenModelsByKind(models, 'stt').map((m) => m.id)).toEqual(['scribe_v2'])
    expect(filterElevenModelsByKind(models, 'sfx').map((m) => m.id)).toEqual([
      'eleven_text_to_sound_v2'
    ])
  })

  it('类别判定：认不出的 id 归 other，不会被任何用途收走', () => {
    expect(elevenModelKind('eleven_v3')).toBe('tts')
    expect(elevenModelKind('scribe_v2_turbo')).toBe('stt')
    expect(elevenModelKind('music_v1')).toBe('music')
    expect(elevenModelKind('eleven_text_to_sound_v2')).toBe('sfx')
    expect(elevenModelKind('some-future-thing')).toBe('other')
    expect(elevenModelKind('')).toBe('other')
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

  /**
   * 阶段一：Speech to Text 与 Music。
   *
   * 这两条**整条管线本来就有**（适配器可选方法 → facade → IPC → preload →
   * 时间线的「配音转字幕」/ BGM/音效生成），所以只补适配器方法，不新增节点。
   */
  describe('转写与音乐', () => {
    it('转写：POST /v1/speech-to-text，multipart 带 model_id 与 file，响应是 JSON', async () => {
      const tmp = join(tmpdir(), `aae-eleven-stt-${Date.now()}.mp3`)
      writeFileSync(tmp, Buffer.from([1, 2, 3]))
      postMock.mockResolvedValueOnce({
        data: {
          text: '你好。世界',
          language_code: 'zho',
          words: [
            { text: '你好', start: 0, end: 0.5, type: 'word' },
            { text: '。', start: 0.5, end: 0.6, type: 'word' },
            { text: ' ', start: 0.6, end: 0.7, type: 'spacing' },
            { text: '世界', start: 0.7, end: 1.2, type: 'word' }
          ]
        }
      })
      const result = await elevenLabsAdapter.transcribeAudio(provider(), 'scribe_v2', {
        absPath: tmp
      })
      const [path, form, config] = postMock.mock.calls[0] as [
        string,
        FormData,
        { headers?: Record<string, unknown> }
      ]
      expect(path).toBe('/v1/speech-to-text')
      expect(form.get('model_id')).toBe('scribe_v2')
      expect(form.get('timestamps_granularity')).toBe('word')
      expect(form.get('file')).toBeInstanceOf(Blob)
      // multipart 由 axios 自己定边界，这里必须清掉默认的 application/json
      expect(config.headers?.['Content-Type']).toBeUndefined()
      // 按句读切段，且 spacing 不能混进正文
      expect(result.segments).toEqual([
        { startSec: 0, endSec: 0.6, text: '你好。' },
        { startSec: 0.7, endSec: 1.2, text: '世界' }
      ])
      expect(result.text).toBe('你好。世界')
      expect(result.language).toBe('zho')
      rmSync(tmp, { force: true })
    })

    it('转写：没有本地文件时明确报错，不发请求', async () => {
      await expect(
        elevenLabsAdapter.transcribeAudio(provider(), 'scribe_v2', { absPath: '' })
      ).rejects.toThrow(/文件/)
      expect(postMock).not.toHaveBeenCalled()
    })

    it('音乐：POST /v1/music，body 用规范的字段名，直接回音频字节走 filePath', async () => {
      postMock.mockResolvedValueOnce({ data: new Uint8Array([7, 7, 7]) })
      const result = await elevenLabsAdapter.generateMusic(provider(), 'music_v2_5', {
        prompt: '轻快的电子配乐',
        instrumental: true
      })
      const [path, body, config] = postMock.mock.calls[0] as [
        string,
        Record<string, unknown>,
        { params?: Record<string, unknown>; responseType?: string }
      ]
      expect(path).toBe('/v1/music')
      expect(body).toEqual({
        prompt: '轻快的电子配乐',
        force_instrumental: true,
        model_id: 'music_v2_5'
      })
      expect(config.params).toEqual({ output_format: 'mp3_44100_128' })
      expect(config.responseType).toBe('arraybuffer')
      // ElevenLabs 没有下载地址，直接给本地临时文件（facade 两种都支持）
      expect(result.filePath).toBeTruthy()
      expect(result.downloadUrl).toBeUndefined()
      // 契约不变：只写临时文件，不登记资产
      expect(result).not.toHaveProperty('assetId')
    })

    it('音乐：有歌词时按规范写成 lyrics_text', () => {
      expect(
        buildElevenMusicBody({ prompt: 'p', lyrics: '  第一句\n第二句  ', modelId: 'music_v2_5' })
      ).toEqual({
        prompt: 'p',
        lyrics_text: '第一句\n第二句',
        force_instrumental: true,
        model_id: 'music_v2_5'
      })
      // instrumental 显式 false 时允许人声
      expect(buildElevenMusicBody({ prompt: 'p', instrumental: false }).force_instrumental).toBe(
        false
      )
    })

    it('音乐：空提示词明确报错', async () => {
      await expect(
        elevenLabsAdapter.generateMusic(provider(), 'music_v2_5', { prompt: '   ' })
      ).rejects.toThrow(/提示词/)
      expect(postMock).not.toHaveBeenCalled()
    })

    it('音频目录接口返回全量（TTS + 转写 + 音乐），fetchCatalog 只给 TTS', async () => {
      getMock.mockResolvedValue({
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
    })

    /**
     * 阶段二：多说话人对话与专用音效端点。
     */
    it('给了 dialogue 就改走 /v1/text-to-dialogue（voice_id 是对象字段）', async () => {
      postMock.mockResolvedValueOnce({ data: new Uint8Array([1, 2]) })
      const result = await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
        input: 'A: 你好\nB: 你好',
        dialogue: [
          { text: '你好', voice: 'voice-a' },
          { text: '我也好', voice: 'voice-b' }
        ]
      })
      const [path, body, config] = postMock.mock.calls[0] as [
        string,
        Record<string, unknown>,
        { params?: Record<string, unknown>; responseType?: string }
      ]
      // 关键：**不**走单说话人路径（那里 voice_id 在路径里）
      expect(path).toBe('/v1/text-to-dialogue')
      expect(body).toEqual({
        inputs: [
          { text: '你好', voice_id: 'voice-a' },
          { text: '我也好', voice_id: 'voice-b' }
        ],
        model_id: 'eleven_v3'
      })
      expect(config.responseType).toBe('arraybuffer')
      // 多段音色去重后用逗号记录，便于日志排查
      expect(result.voice).toBe('voice-a,voice-b')
      expect(result.filePath).toBeTruthy()
      expect(result.assetId).toBeUndefined()
    })

    it('dialogue 里缺 text / voice 的段落被剔除；全空时退回单说话人校验', async () => {
      postMock.mockResolvedValue({ data: new Uint8Array([1]) })
      await elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
        input: 'x',
        voice: 'voice-a',
        dialogue: [{ text: '   ', voice: 'voice-a' }]
      })
      // 全是无效段 → 走单说话人端点
      expect(postMock.mock.calls[0]![0]).toBe('/v1/text-to-speech/voice-a')

      postMock.mockClear()
      await expect(
        elevenLabsAdapter.generateSpeech(provider(), 'eleven_v3', {
          input: 'x',
          dialogue: [{ text: '你好' }]
        })
      ).rejects.toThrow(/voice_id/)
      expect(postMock).not.toHaveBeenCalled()
    })

    it('音效：POST /v1/sound-generation，model_id 固定为唯一取值，走 filePath', async () => {
      postMock.mockResolvedValueOnce({ data: new Uint8Array([4, 4]) })
      const result = await elevenLabsAdapter.generateSoundEffect?.(provider(), '', {
        prompt: '雨落在铁皮屋顶上',
        loop: true
      })
      const [path, body, config] = postMock.mock.calls[0] as [
        string,
        Record<string, unknown>,
        { params?: Record<string, unknown>; responseType?: string }
      ]
      expect(path).toBe('/v1/sound-generation')
      expect(body).toEqual({
        text: '雨落在铁皮屋顶上',
        loop: true,
        model_id: 'eleven_text_to_sound_v2'
      })
      expect(config.responseType).toBe('arraybuffer')
      expect(result?.filePath).toBeTruthy()
      expect(result?.model).toBe('eleven_text_to_sound_v2')
    })

    it('请求体构造：音效只带有效字段，对话保留顺序', () => {
      expect(buildElevenSoundBody({ text: ' 脚步  ' })).toEqual({
        text: '脚步',
        model_id: 'eleven_text_to_sound_v2'
      })
      expect(
        buildElevenSoundBody({ text: '脚步', durationSeconds: 2.5, promptInfluence: 0.3 })
      ).toEqual({
        text: '脚步',
        duration_seconds: 2.5,
        prompt_influence: 0.3,
        model_id: 'eleven_text_to_sound_v2'
      })
      // 显式 loop=false 不写进 body（避免用 false 覆盖上游默认）
      expect(buildElevenSoundBody({ text: '脚步', loop: false }).loop).toBeUndefined()

      expect(
        buildElevenDialogueBody({
          inputs: [
            { text: '一', voice: 'v1' },
            { text: '二', voice: 'v2' }
          ],
          languageCode: 'zho'
        })
      ).toEqual({
        inputs: [
          { text: '一', voice_id: 'v1' },
          { text: '二', voice_id: 'v2' }
        ],
        language_code: 'zho'
      })
    })

    it('音效：空描述明确报错', async () => {
      await expect(
        elevenLabsAdapter.generateSoundEffect?.(provider(), '', { prompt: '  ' })
      ).rejects.toThrow(/描述/)
      expect(postMock).not.toHaveBeenCalled()
    })
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
