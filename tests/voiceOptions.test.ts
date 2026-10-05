import { describe, expect, it } from 'vitest'
import {
  primaryLanguage,
  sortVoicesForLocale,
  voiceLanguageTag
} from '../src/renderer/src/utils/voiceOptions'

/**
 * 音色候选排序。
 *
 * 依据是实测的 OpenRouter `/models?output_modalities=speech` 返回：
 * 18/23 个语音模型带 supported_voices，最长的是 microsoft/mai-voice-2.1 的 97 个。
 * 不排序的话中文用户要在 pt-PT / ru-RU 里翻很久才见到 zh-CN-*。
 */
describe('voiceLanguageTag', () => {
  it('识别 BCP-47 风格前缀（微软 MAI Voice）', () => {
    expect(voiceLanguageTag('zh-CN-Mei:MAI-Voice-2.1')).toBe('zh-cn')
    expect(voiceLanguageTag('en-US-Harper:MAI-Voice-2.1')).toBe('en-us')
  })

  it('识别末尾语言码（Deepgram aura）', () => {
    expect(voiceLanguageTag('aura-2-agathe-fr')).toBe('fr')
    expect(voiceLanguageTag('aura-2-thalia-en')).toBe('en')
  })

  it('识别 Kokoro 的语言+口音前缀', () => {
    expect(voiceLanguageTag('zf_xiaoxiao')).toBe('zf')
    expect(voiceLanguageTag('am_adam')).toBe('am')
  })

  it('识别整词语言名（MiniMax）', () => {
    expect(voiceLanguageTag('English_expressive_narrator')).toBe('en')
    expect(voiceLanguageTag('Chinese_calm_woman')).toBe('zh')
  })

  it('没有语言信息就不猜（Gemini 的 Zephyr / xAI 的 eve）', () => {
    expect(voiceLanguageTag('Zephyr')).toBeNull()
    expect(voiceLanguageTag('Sulafat')).toBeNull()
    expect(voiceLanguageTag('eve')).toBeNull()
    expect(voiceLanguageTag('flux-alexis-en')).toBe('en')
    expect(voiceLanguageTag('')).toBeNull()
  })
})

describe('primaryLanguage', () => {
  it('取主语言码', () => {
    expect(primaryLanguage('zh-CN')).toBe('zh')
    expect(primaryLanguage('en-US')).toBe('en')
    expect(primaryLanguage('EN')).toBe('en')
    expect(primaryLanguage('')).toBe('')
  })
})

describe('sortVoicesForLocale', () => {
  const microsoft = [
    'pt-PT-Rui:MAI-Voice-2.1',
    'zh-CN-Mei:MAI-Voice-2.1',
    'ru-RU-Lev:MAI-Voice-2.1',
    'zh-CN-Wei:MAI-Voice-2.1',
    'en-US-Harper:MAI-Voice-2.1'
  ]

  it('同语言排到前面，其余保持原相对顺序', () => {
    expect(sortVoicesForLocale(microsoft, 'zh-CN')).toEqual([
      'zh-CN-Mei:MAI-Voice-2.1',
      'zh-CN-Wei:MAI-Voice-2.1',
      'pt-PT-Rui:MAI-Voice-2.1',
      'ru-RU-Lev:MAI-Voice-2.1',
      'en-US-Harper:MAI-Voice-2.1'
    ])
  })

  it('只排序不过滤：其他语言一个都不少', () => {
    const sorted = sortVoicesForLocale(microsoft, 'zh-CN')
    expect(sorted).toHaveLength(microsoft.length)
    expect([...sorted].sort()).toEqual([...microsoft].sort())
  })

  it('识别不出语言的音色不会被当成目标语言', () => {
    const sorted = sortVoicesForLocale(['Zephyr', 'Puck', 'zh-CN-Mei'], 'zh-CN')
    expect(sorted[0]).toBe('zh-CN-Mei')
  })

  it('locale 为空时原样返回（不瞎排）', () => {
    expect(sortVoicesForLocale(microsoft, '')).toEqual(microsoft)
  })

  it('不改动传入数组', () => {
    const input = [...microsoft]
    sortVoicesForLocale(input, 'zh-CN')
    expect(input).toEqual(microsoft)
  })
})
