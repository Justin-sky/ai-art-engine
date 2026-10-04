import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  describePortraitFraming,
  parseAspectRatio,
  portraitAspectRatioForSize,
  portraitResolutionTierForSize
} from '../src/shared/graph/portraitFraming'

/**
 * 人像处理的画幅与尺寸换算。
 *
 * 线上踩过：执行器只发 resolution/quality、**不发 aspectRatio**，于是模型按自己的默认画幅
 * （多为 1:1）出图 —— 竖幅人像修完变方图、构图也变了。这个文件锁两件事：
 *   1. 源图尺寸必须换算成**标准枚举**里的比例（非枚举值在适配器里会退化成「不发该字段」，
 *      等于又回到默认画幅）；
 *   2. 「输出尺寸 = 自动」要按源图最大边选一个装得下的档，而不是一律 1K。
 */

const ROOT = join(__dirname, '..')

describe('比例解析与最近标准比例', () => {
  it('解析合法比例，拒绝非法值', () => {
    expect(parseAspectRatio('16:9')).toBeCloseTo(16 / 9, 6)
    expect(parseAspectRatio(' 4 : 3 ')).toBeCloseTo(4 / 3, 6)
    expect(parseAspectRatio('auto')).toBeNull()
    expect(parseAspectRatio('2K')).toBeNull()
    expect(parseAspectRatio('0:1')).toBeNull()
    expect(parseAspectRatio(undefined)).toBeNull()
  })

  it('常见相机画幅映射到最近的标准比例', () => {
    expect(portraitAspectRatioForSize(4032, 3024)).toBe('4:3') // 手机主摄 4:3
    expect(portraitAspectRatioForSize(3024, 4032)).toBe('3:4') // 竖幅
    expect(portraitAspectRatioForSize(3000, 3000)).toBe('1:1')
    expect(portraitAspectRatioForSize(6000, 4000)).toBe('3:2') // 全画幅横构图
    expect(portraitAspectRatioForSize(4000, 6000)).toBe('2:3')
    expect(portraitAspectRatioForSize(1920, 1080)).toBe('16:9')
    expect(portraitAspectRatioForSize(1080, 1920)).toBe('9:16')
    // 5:4（中画幅/证件底板）不在枚举里 → 落到最近的 4:3，而不是原样下发
    expect(portraitAspectRatioForSize(5000, 4000)).toBe('4:3')
    expect(portraitAspectRatioForSize(8000, 1000)).toBe('16:9')
  })

  it('异常尺寸不崩，且仍落在枚举里', () => {
    expect(portraitAspectRatioForSize(0, 0)).toBe('1:1')
    // 宽为 NaN 时按 1 处理 → 极端细长 → 落到最窄的 9:16，而不是 16:9
    expect(portraitAspectRatioForSize(Number.NaN, 100)).toBe('9:16')
    expect(portraitAspectRatioForSize(Number.NaN, Number.NaN)).toBe('1:1')
  })

  it('映射结果一定落在标准枚举里（否则适配器会不发该字段，又回到默认画幅）', () => {
    const allowed = new Set(['1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16'])
    for (let w = 200; w <= 8000; w += 137) {
      for (const h of [200, 667, 1080, 1500, 2667, 4000, 6000]) {
        expect(allowed.has(portraitAspectRatioForSize(w, h)), `${w}×${h}`).toBe(true)
      }
    }
  })
})

describe('输出尺寸 = 自动时的档位选择', () => {
  it('取恰好装得下原图的最小档', () => {
    expect(portraitResolutionTierForSize(800, 600)).toBe('1K')
    expect(portraitResolutionTierForSize(1024, 1024)).toBe('1K')
    expect(portraitResolutionTierForSize(1200, 1600)).toBe('2K')
    expect(portraitResolutionTierForSize(2048, 2048)).toBe('2K')
    expect(portraitResolutionTierForSize(4032, 3024)).toBe('4K')
    expect(portraitResolutionTierForSize(8000, 6000)).toBe('4K')
  })

  it('异常尺寸退化为 1K，不产生 NaN 档位', () => {
    expect(portraitResolutionTierForSize(0, 0)).toBe('1K')
    expect(portraitResolutionTierForSize(Number.NaN, Number.NaN)).toBe('1K')
  })
})

describe('日志口径', () => {
  it('自动档说明「按哪个档出图、回贴到原图尺寸」', () => {
    const line = describePortraitFraming({
      width: 4032,
      height: 3024,
      measured: true,
      outputSize: 'auto'
    })
    expect(line).toContain('framing: 4:3')
    expect(line).toContain('source 4032x3024')
    expect(line).toContain('auto -> 4K tier, then fit back to source size')
  })

  it('显式档位只报画幅与档位，不谎报会回贴尺寸', () => {
    const line = describePortraitFraming({
      width: 1200,
      height: 1600,
      measured: false,
      outputSize: '2K'
    })
    expect(line).toContain('framing: 3:4')
    expect(line).toContain('(assumed)')
    expect(line).toContain('output size 2K')
    expect(line).not.toContain('fit back')
  })
})

describe('能力缝接线（缺一处就报「能力未注入」或静默不生效）', () => {
  it('类型声明 + 引擎中转 + 两处注入点都接上', () => {
    const types = readFileSync(join(ROOT, 'src/shared/graph/execute/types.ts'), 'utf8')
    expect(types).toMatch(/fitPortraitToSourceSize\?:/)
    expect(types).toMatch(
      /fitPortraitToSourceSize\?: NodeExecuteContext\['fitPortraitToSourceSize'\]/
    )

    const engine = readFileSync(join(ROOT, 'src/shared/graph/execute/engine.ts'), 'utf8')
    expect(engine).toContain('fitPortraitToSourceSize: options.fitPortraitToSourceSize')
    expect(engine).toContain('flattenPortraitBackground: options.flattenPortraitBackground')
    expect(types).toMatch(
      /flattenPortraitBackground\?: NodeExecuteContext\['flattenPortraitBackground'\]/
    )

    for (const file of [
      'src/renderer/src/features/graph/controllers/useGraphRunSession.ts',
      'src/renderer/src/stores/graphTasks.ts'
    ]) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const seam of ['fitPortraitToSourceSize', 'flattenPortraitBackground']) {
        expect(src, `${file} 缺少 ${seam}`).toContain(seam)
        expect(src, `${file} 没从 portraitCapabilities 引入 ${seam}`).toMatch(
          new RegExp(
            `import \\{[\\s\\S]{0,600}${seam}[\\s\\S]{0,600}\\} from '.*portraitCapabilities'`
          )
        )
      }
    }
  })

  it('本地清底的合成方向是「先铺背景、再把人物按蒙版叠回」', () => {
    const caps = readFileSync(
      join(ROOT, 'src/renderer/src/features/graph/model/portraitCapabilities.ts'),
      'utf8'
    )
    const fn =
      /export async function flattenPortraitBackground\([\s\S]*?\n\}\n/.exec(caps)?.[0] ?? ''
    expect(fn).toBeTruthy()
    expect(fn).toContain('buildPersonMaskCanvas')
    // 蒙版之外（= 背景）必须是目标背景色：先铺满背景，再 destination-in 出人物层叠回去
    expect(fn).toMatch(/fillRect\(0, 0, width, height\)/)
    expect(fn).toContain("globalCompositeOperation = 'destination-in'")
    expect(fn).toContain('createLinearGradient')
    // 缺人物蒙版时如实返回 applied:false，调用方沿用原图
    expect(fn).toContain('applied: false')
  })

  it('执行器把画幅与档位真的发给了模型（画幅不发就是默认 1:1）', () => {
    const executor = readFileSync(join(ROOT, 'src/shared/graph/execute/portrait.ts'), 'utf8')
    const call =
      /const result = await ctx\.generateImage\(\{[\s\S]*?\n    \}\)/.exec(executor)?.[0] ?? ''
    expect(call).toBeTruthy()
    expect(call).toContain('aspectRatio,')
    expect(call).toContain('resolution,')
    expect(executor).toContain('portraitAspectRatioForSize(frameSize.width, frameSize.height)')
    // 自动档才回贴原尺寸；显式档位由用户选的那个档说了算
    expect(executor).toContain("state.outputSize === 'auto' && ctx.fitPortraitToSourceSize")
  })
})
