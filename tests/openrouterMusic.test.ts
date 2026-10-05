import { describe, expect, it } from 'vitest'
import {
  isOpenRouterMusicModel,
  isOpenRouterSpeechModel
} from '../src/shared/modelProviders/openrouter/audioModality'
import { buildOpenRouterMusicInput } from '../src/shared/modelProviders/openrouter/music'
import { supportsMusicModality } from '../src/shared/modelProvider'

/**
 * OpenRouter 的音乐生成。
 *
 * 它与其它家不同：**没有 `/v1/music`**（实测 `/audio/generations`、`/audio/music`、
 * `/v1/music` 全 404），音乐模型（Google Lyria 3）挂在
 * `output_modalities=audio` 下、走 `POST /audio/speech`。
 *
 * 下面这些条目字段都是 2026-10 从 OpenRouter 目录**实测**抄下来的形状。
 */
const lyriaPro = {
  id: 'google/lyria-3-pro-preview',
  architecture: { input_modalities: ['text', 'image'], output_modalities: ['text', 'audio'] },
  supported_voices: null,
  supported_parameters: ['max_tokens', 'response_format', 'seed', 'temperature', 'top_p']
}
const gptAudio = {
  id: 'openai/gpt-audio',
  architecture: { input_modalities: ['text', 'audio'], output_modalities: ['text', 'audio'] },
  supported_voices: null,
  supported_parameters: [
    'frequency_penalty',
    'max_tokens',
    'response_format',
    'temperature',
    'tool_choice',
    'tools',
    'top_p'
  ]
}
const maiVoice = {
  id: 'microsoft/mai-voice-2.1-flash',
  architecture: { input_modalities: ['text'], output_modalities: ['speech'] },
  supported_voices: ['cs-CZ-Grant:MAI-Voice-2.1-Flash'],
  supported_parameters: []
}

describe('OpenRouter 音乐模型判别', () => {
  it('Lyria 是音乐：输出 audio（非 speech）、不吃工具、带 response_format', () => {
    expect(isOpenRouterMusicModel(lyriaPro)).toBe(true)
    expect(isOpenRouterMusicModel({ ...lyriaPro, id: 'google/lyria-3-clip-preview' })).toBe(true)
  })

  it('对话式音频模型不是音乐（它是 chat 模型，带 tools）', () => {
    // 与 Lyria 同属 audio 组、同样 supported_voices=null —— 只能靠工具参数区分
    expect(isOpenRouterMusicModel(gptAudio)).toBe(false)
  })

  it('TTS 模型不是音乐（输出是 speech）', () => {
    expect(isOpenRouterMusicModel(maiVoice)).toBe(false)
    expect(isOpenRouterSpeechModel(maiVoice)).toBe(true)
    // 反过来也要成立：音乐模型不能被当成 TTS
    expect(isOpenRouterSpeechModel(lyriaPro)).toBe(false)
  })

  it('字段缺失 / 形状异常时不误判为音乐', () => {
    expect(isOpenRouterMusicModel({})).toBe(false)
    expect(isOpenRouterMusicModel({ id: 'x', architecture: null })).toBe(false)
    expect(isOpenRouterMusicModel({ id: 'x', architecture: { output_modalities: 'audio' } })).toBe(
      false
    )
    // 有 audio 输出但没有 response_format（不是 /audio/speech 那类）
    expect(
      isOpenRouterMusicModel({
        id: 'x',
        architecture: { output_modalities: ['audio'] },
        supported_parameters: ['temperature']
      })
    ).toBe(false)
  })

  it('supportsMusicModality 认 OpenRouter（它没有 /v1/music，但不能因此漏掉）', () => {
    expect(supportsMusicModality('openrouter')).toBe(true)
    // 有 TTS 但没有音乐端点/模型的仍然为 false
    expect(supportsMusicModality('openai')).toBe(false)
    expect(supportsMusicModality('google')).toBe(false)
  })
})

describe('OpenRouter 音乐请求体', () => {
  it('纯音乐只发编曲描述', () => {
    expect(buildOpenRouterMusicInput({ prompt: ' 轻快的电子配乐 ', instrumental: true })).toEqual({
      input: '轻快的电子配乐'
    })
  })

  it('有歌词且非纯音乐时并进同一条文本（OpenRouter 没有独立歌词字段）', () => {
    expect(
      buildOpenRouterMusicInput({
        prompt: '温暖的民谣',
        lyrics: '  第一句\n第二句  ',
        instrumental: false
      })
    ).toEqual({ input: '温暖的民谣\n\n第一句\n第二句' })
  })

  it('纯音乐即便给了歌词也不附上', () => {
    expect(
      buildOpenRouterMusicInput({ prompt: '配乐', lyrics: '不该出现', instrumental: true }).input
    ).toBe('配乐')
  })
})
