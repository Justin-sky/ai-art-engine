import { describe, expect, it } from 'vitest'
import {
  GAME_PLAY_SMOKE_BLACK_LUMA,
  evaluateGamePlaySmoke,
  type GamePlaySmokeSample
} from '../src/shared/gamePlayJob'

/**
 * 试玩门禁的判定口径（Electron 那半边单独在 main 里做，这里只测纯函数）。
 *
 * 判定顺序是有意设计的：硬错误 → 有没有采到帧 → 是不是整屏黑 → 最后才看静止；
 * 「静止」只算 warn，因为等输入的回合制游戏本来就可能几秒不动。
 */
function sample(meanLuma: number, hash: string, pixels = 5120): GamePlaySmokeSample {
  return { meanLuma, hash, pixels }
}

function evaluate(
  samples: GamePlaySmokeSample[],
  extra: { errors?: string[]; warnings?: string[] } = {}
) {
  return evaluateGamePlaySmoke({
    errors: extra.errors ?? [],
    warnings: extra.warnings ?? [],
    samples,
    durationMs: 1200,
    htmlRelativePath: 'Cache/GamePlayJobs/j1/project/dist/single.html',
    checkedAt: '2026-09-26T00:00:00.000Z'
  })
}

describe('试玩门禁判定', () => {
  it('画面在动且没有报错 → pass', () => {
    const report = evaluate([sample(40, 'a'), sample(42, 'b'), sample(38, 'c')])
    expect(report.status).toBe('pass')
    expect(report.ok).toBe(true)
    expect(report.errors).toEqual([])
    expect(report.warnings).toEqual([])
    expect(report.metrics).toMatchObject({ frames: 3, distinctFrames: 3, durationMs: 1200 })
    expect(report.htmlRelativePath).toContain('single.html')
    expect(report.checkedAt).toBe('2026-09-26T00:00:00.000Z')
  })

  it('有未捕获异常 / 加载失败 → fail，且错误原样带出', () => {
    const report = evaluate([sample(40, 'a'), sample(41, 'b')], {
      errors: ['Uncaught TypeError: x is not a function', '加载失败（-6 ERR_FILE_NOT_FOUND）']
    })
    expect(report.status).toBe('fail')
    expect(report.ok).toBe(false)
    expect(report.errors).toHaveLength(2)
    expect(report.errors[0]).toContain('Uncaught TypeError')
  })

  it('整屏黑 → fail（按采样最亮一帧判定，避免只有首帧黑就误判）', () => {
    const black = evaluate([sample(0.2, 'a'), sample(0.4, 'b')])
    expect(black.status).toBe('fail')
    expect(black.errors.join()).toContain('整屏黑')

    const oneFrameLit = evaluate([sample(0, 'a'), sample(GAME_PLAY_SMOKE_BLACK_LUMA + 1, 'b')])
    expect(oneFrameLit.ok).toBe(true)
  })

  it('一帧都没采到 → fail（而不是被当成黑屏）', () => {
    const report = evaluate([])
    expect(report.status).toBe('fail')
    expect(report.errors.join()).toContain('一帧都没采到')
    // 像素为 0 的采样视为无效帧
    expect(evaluate([sample(50, 'a', 0)]).errors.join()).toContain('一帧都没采到')
  })

  it('画面从头到尾没变 → warn（可能 rAF 卡死，也可能在等输入）', () => {
    const report = evaluate([sample(40, 'same'), sample(41, 'same'), sample(39, 'same')])
    expect(report.status).toBe('warn')
    expect(report.ok).toBe(true)
    expect(report.warnings.join()).toContain('画面静止')
    expect(report.metrics.distinctFrames).toBe(1)
  })

  it('单帧采样不做静止判定（没有可比的第二帧）', () => {
    const report = evaluate([sample(40, 'only')])
    expect(report.warnings).toEqual([])
    expect(report.status).toBe('pass')
  })

  it('错误优先于静止：两者同时命中时报 fail 且都保留', () => {
    const report = evaluate([sample(40, 'same'), sample(40, 'same')], {
      errors: ['Uncaught Error: boom']
    })
    expect(report.status).toBe('fail')
    expect(report.errors).toHaveLength(1)
    expect(report.warnings.join()).toContain('画面静止')
  })

  it('去重 + 去空：同一错误重复上报只留一条', () => {
    const report = evaluate([sample(40, 'a'), sample(41, 'b')], {
      errors: ['boom', ' boom ', '', '  '],
      warnings: ['static', 'static']
    })
    expect(report.errors).toEqual(['boom'])
    expect(report.warnings).toEqual(['static'])
  })

  it('亮度统计可用（min / max / 平均）', () => {
    const report = evaluate([sample(10, 'a'), sample(30, 'b'), sample(20, 'c')])
    expect(report.metrics.minLuma).toBe(10)
    expect(report.metrics.maxLuma).toBe(30)
    expect(report.metrics.averageLuma).toBeCloseTo(20, 5)
  })
})
