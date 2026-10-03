import { describe, expect, it } from 'vitest'
import {
  isCustomImageModelId,
  isCustomTextModelId
} from '../src/shared/modelProviders/custom/modelCapabilities'

describe('customModelCapabilities', () => {
  it('把网关目录里的图片生成模型判定为图片（实测 NewAPI 网关只返回这类）', () => {
    expect(isCustomImageModelId('gpt-image-2.5-flare')).toBe(true)
    expect(isCustomImageModelId('gpt-image-2')).toBe(true)
    expect(isCustomImageModelId('gpt-image-2.5-sunburst')).toBe(true)
    expect(isCustomImageModelId('dall-e-3')).toBe(true)
    expect(isCustomImageModelId('flux.1-schnell')).toBe(true)
    expect(isCustomImageModelId('stable-diffusion-3.5-large')).toBe(true)
    expect(isCustomImageModelId('sdxl')).toBe(true)
    expect(isCustomImageModelId('seedream-4.0')).toBe(true)
    expect(isCustomImageModelId('cogview-4')).toBe(true)
    expect(isCustomImageModelId('qwen-image')).toBe(true)
    expect(isCustomImageModelId('imagen-4.0-generate-001')).toBe(true)
    expect(isCustomImageModelId('nano-banana-pro')).toBe(true)
  })

  it('保留可对话的文本模型（不误伤）', () => {
    expect(isCustomTextModelId('gpt-4o')).toBe(true)
    expect(isCustomTextModelId('gpt-4o-mini')).toBe(true)
    expect(isCustomTextModelId('gpt-5.5')).toBe(true)
    expect(isCustomTextModelId('deepseek-chat')).toBe(true)
    expect(isCustomTextModelId('deepseek-v4-1-flash-260910')).toBe(true)
    expect(isCustomTextModelId('claude-3-5-sonnet')).toBe(true)
    expect(isCustomTextModelId('gemini-2.5-flash')).toBe(true)
    expect(isCustomTextModelId('glm-4-flash')).toBe(true)
    expect(isCustomTextModelId('qwen-max')).toBe(true)
    expect(isCustomTextModelId('moonshot-v1-128k')).toBe(true)
    // 方舟的接入点 id 形态
    expect(isCustomTextModelId('ep-20260101000000-abcde')).toBe(true)
  })

  it('图片模型不会进文本页签，文本模型不会被当成图片', () => {
    for (const id of ['gpt-image-2', 'dall-e-3', 'flux.1-dev', 'sdxl']) {
      expect(isCustomTextModelId(id)).toBe(false)
      expect(isCustomImageModelId(id)).toBe(true)
    }
    for (const id of ['gpt-4o', 'deepseek-chat', 'claude-3-5-sonnet']) {
      expect(isCustomTextModelId(id)).toBe(true)
      expect(isCustomImageModelId(id)).toBe(false)
    }
  })

  it('忽略首尾空白、空 id 一律不算文本模型', () => {
    expect(isCustomImageModelId('  gpt-image-2  ')).toBe(true)
    expect(isCustomTextModelId('  gpt-4o  ')).toBe(true)
    expect(isCustomTextModelId('')).toBe(false)
    expect(isCustomTextModelId('   ')).toBe(false)
  })
})
