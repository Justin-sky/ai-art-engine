import { describe, expect, it } from 'vitest'
import {
  buildWishChantPool,
  detectWishPromptCategory,
  formatLuckTotal,
  pickNextWishChant,
  rollLuckGain
} from '../src/shared/chatWishShrine'

describe('chatWishShrine', () => {
  it('detects context categories from user prompt', () => {
    expect(detectWishPromptCategory('帮我画一张赛博朋克风格的海报')).toBe('image')
    expect(detectWishPromptCategory('把分镜合成为成片视频并加转场')).toBe('video')
    expect(detectWishPromptCategory('用 Blender 绑定角色骨骼并修复报错')).toBe('code3d')
    expect(detectWishPromptCategory('你好，帮我规划一下项目')).toBe('general')
  })

  it('guarantees top 3 viral chants (no-error, one-shot, save-money) come first', () => {
    const pool = buildWishChantPool('image')
    expect(pool.slice(0, 3).map((c) => c.id)).toEqual(['no-error', 'one-shot', 'save-money'])
    expect(pool.some((c) => c.category === 'image')).toBe(true)
  })

  it('picks localized normal and critical chants', () => {
    const firstZh = pickNextWishChant({ category: 'general', stepIndex: 0, isEn: false })
    expect(firstZh.text).toContain('不报错')
    expect(firstZh.critical).toBe(false)

    const thirdZh = pickNextWishChant({ category: 'general', stepIndex: 2, isEn: false })
    expect(thirdZh.text).toContain('少花钱')

    const critZh = pickNextWishChant({
      category: 'general',
      stepIndex: 0,
      isEn: false,
      critical: true
    })
    expect(critZh.critical).toBe(true)
    expect(critZh.tone).toBe('crit')

    const firstEn = pickNextWishChant({ category: 'general', stepIndex: 0, isEn: true })
    expect(firstEn.text).toContain('Zero Errors')
  })

  it('rolls random luck gains in game damage-number tiers', () => {
    const seq = (values: number[]) => {
      let i = 0
      return () => values[i++ % values.length]!
    }
    expect(rollLuckGain({ rng: seq([0.5, 0]) })).toEqual({ value: 1, tier: 'normal' })
    expect(rollLuckGain({ rng: seq([0.1, 0.999]) })).toEqual({ value: 520, tier: 'big' })
    expect(rollLuckGain({ rng: seq([0.01, 0]) })).toEqual({ value: 666, tier: 'crit' })
    expect(rollLuckGain({ boost: true, rng: seq([0.2, 0.99999]) })).toEqual({
      value: 9999,
      tier: 'crit'
    })
    for (let i = 0; i < 200; i++) {
      const r = rollLuckGain()
      expect(r.value).toBeGreaterThanOrEqual(1)
      expect(Number.isInteger(r.value)).toBe(true)
    }
  })

  it('formats luck totals compactly', () => {
    expect(formatLuckTotal(1234)).toBe('1,234')
    expect(formatLuckTotal(12345)).toBe('1.2w')
    expect(formatLuckTotal(12345, true)).toBe('12.3k')
  })
})
