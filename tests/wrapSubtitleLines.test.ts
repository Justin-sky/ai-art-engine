import { describe, expect, it } from 'vitest'
import {
  buildSubtitleDrawtextMotion,
  subtitleFadeSec,
  wrapSubtitleLines
} from '../src/shared/subtitleWrap'

describe('wrapSubtitleLines', () => {
  it('短句不拆', () => {
    expect(wrapSubtitleLines('双击编辑生成指令', 20)).toEqual(['双击编辑生成指令'])
  })

  it('长中文按字数拆行且不超出上限', () => {
    const text = '在画布上选中图片生成节点，双击卡片打开生成指令，输入提示词后点击运行'
    const lines = wrapSubtitleLines(text, 12)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(12)
    }
    expect(lines.join('')).toBe(text.replace(/\s+/g, ''))
  })

  it('英文优先在空格处断行', () => {
    const lines = wrapSubtitleLines('click the run button to generate', 14)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.some((line) => line.includes(' '))).toBe(true)
  })
})

describe('buildSubtitleDrawtextMotion：淡入上滚 / 淡出', () => {
  it('淡入时长随片段伸缩且不超过半段', () => {
    expect(subtitleFadeSec(10)).toBeLessThanOrEqual(0.45)
    expect(subtitleFadeSec(0.5)).toBeLessThanOrEqual(0.5 / 2.4)
  })

  it('产出 enable / alpha / y，且 y 含上滚项', () => {
    const motion = buildSubtitleDrawtextMotion({
      startSec: 1,
      endSec: 4,
      fromBottom: 80,
      risePx: 20
    })
    expect(motion.enable).toContain('between(t')
    expect(motion.alpha).toContain('alpha=')
    expect(motion.y).toMatch(/y=h-80-20\+20\*/)
  })
})
