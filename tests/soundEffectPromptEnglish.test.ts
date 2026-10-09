import { describe, expect, it } from 'vitest'
import { soundEffectPromptNeedsEnglish } from '../src/shared/modelProviders/elevenlabs/voice'

/**
 * ElevenLabs sound-generation 对中文会念出描述（像 TTS）。
 * 节点路径靠这个判定决定要不要先译成英文。
 */
describe('soundEffectPromptNeedsEnglish', () => {
  it('中文 / 日文 / 韩文描述需要英译', () => {
    expect(soundEffectPromptNeedsEnglish('雷声')).toBe(true)
    expect(soundEffectPromptNeedsEnglish('一声近距离炸雷 → 低频滚雷')).toBe(true)
    expect(soundEffectPromptNeedsEnglish('雨の音')).toBe(true)
    expect(soundEffectPromptNeedsEnglish('천둥소리')).toBe(true)
  })

  it('英文音效描述不需要英译', () => {
    expect(soundEffectPromptNeedsEnglish('close thunder clap with long reverb')).toBe(false)
    expect(soundEffectPromptNeedsEnglish('rain on a tin roof')).toBe(false)
    expect(soundEffectPromptNeedsEnglish('whoosh, braam, impact')).toBe(false)
  })

  it('中英混杂仍视为需要英译', () => {
    expect(soundEffectPromptNeedsEnglish('thunder 雷声 rumble')).toBe(true)
  })
})
