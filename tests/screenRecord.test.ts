import { describe, expect, it } from 'vitest'
import {
  SCREEN_RECORD_LIMITS,
  buildAlignmentTable,
  buildImageSequenceArgs,
  fingerprintOfBitmap,
  mapWallMsToCompressed,
  normalizeScreenRecordOptions,
  planFrameKeeps,
  planFrameSequence,
  type CapturedFrame
} from '../src/shared/screenRecord'

/**
 * 界面录制的纯逻辑：参数上限、**空闲帧合并**、编码参数、步骤对齐。
 *
 * 空闲帧合并是这套东西成立的前提：对话驱动的录制里模型与工具调用之间常有十几秒停顿，
 * 按帧率硬录会得到几百 MB 的静止画面。这里的用例就是钉住「画面没变就不写盘、变了才写、
 * 每帧显示多久」这三件事。
 */

const frames = (...pairs: Array<[number, string]>): CapturedFrame[] =>
  pairs.map(([atMs, fingerprint]) => ({ atMs, fingerprint }))

describe('录制参数规范化', () => {
  it('缺省用默认帧率与最长时长', () => {
    const r = normalizeScreenRecordOptions()
    expect(r.ok).toBe(true)
    expect(r.options.fps).toBe(SCREEN_RECORD_LIMITS.fpsDefault)
    expect(r.options.maxSeconds).toBe(SCREEN_RECORD_LIMITS.maxSeconds)
    expect(r.adjusted).toEqual([])
  })

  it('超限**如实上报被夹紧**，不静默改小（用户要 30fps 就得知道实际是 15）', () => {
    const r = normalizeScreenRecordOptions({ fps: 30, maxSeconds: 9999 })
    expect(r.ok).toBe(true)
    expect(r.options.fps).toBe(SCREEN_RECORD_LIMITS.fpsMax)
    expect(r.options.maxSeconds).toBe(SCREEN_RECORD_LIMITS.maxSeconds)
    expect(r.adjusted).toEqual(['fps', 'maxSeconds'])
  })

  it('非法值直接拒绝，而不是悄悄换成默认值', () => {
    expect(normalizeScreenRecordOptions({ fps: 0 }).ok).toBe(false)
    expect(normalizeScreenRecordOptions({ fps: 0 }).reasonKey).toBe('fpsInvalid')
    expect(normalizeScreenRecordOptions({ maxSeconds: -5 }).reasonKey).toBe('durationInvalid')
  })
})

describe('空闲帧合并', () => {
  it('画面没变的帧全部丢掉，并如实计数', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [100, 'a'], [200, 'b'], [300, 'b'], [400, 'c']))
    expect(plan.droppedIdle).toBe(2)
    expect(plan.keeps.map((k) => k.index)).toEqual([0, 2, 4])
  })

  it('每帧显示多久 = 与下一个关键帧的时间差', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [200, 'b'], [500, 'c']))
    expect(plan.keeps.map((k) => [k.index, k.holdMs])).toEqual([
      [0, 200],
      [1, 300],
      [2, expect.any(Number)]
    ])
  })

  it('末帧有最短停留：否则最后一步在成片里一闪而过（1ms）', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [400, 'b']))
    const last = plan.keeps[plan.keeps.length - 1]!
    expect(last.index).toBe(1)
    expect(last.holdMs).toBeGreaterThanOrEqual(500)
  })

  it('长时间静止被封顶到 maxHoldMs（真正缩短成片，不是拆段加总）', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [20000, 'b']))
    const forFirst = plan.keeps.filter((k) => k.index === 0)
    expect(forFirst).toHaveLength(1)
    expect(forFirst[0]!.holdMs).toBe(SCREEN_RECORD_LIMITS.maxHoldMs)
    expect(forFirst[0]!.wallHoldMs).toBe(20000)
    // 成片总时长 = 封顶后的 hold 之和，远短于墙钟 20s+
    expect(plan.durationMs).toBeLessThanOrEqual(
      SCREEN_RECORD_LIMITS.maxHoldMs + SCREEN_RECORD_LIMITS.maxHoldMs
    )
    expect(plan.durationMs).toBeLessThan(5000)
  })

  it('全程只有一帧也不会算错', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [900, 'a']))
    expect(plan.droppedIdle).toBe(1)
    expect(plan.keeps).toHaveLength(1)
    expect(plan.keeps[0]!.index).toBe(0)
  })

  it('空输入不炸', () => {
    expect(planFrameKeeps([])).toEqual({ keeps: [], droppedIdle: 0, durationMs: 0 })
  })
})

describe('画面指纹', () => {
  const bitmap = (fill: number, size = 4): Uint8Array => new Uint8Array(size * size * 4).fill(fill)

  it('同样的画面 → 同样的指纹；不同画面 → 不同指纹', () => {
    const a = fingerprintOfBitmap(bitmap(10), 4, 4)
    const b = fingerprintOfBitmap(bitmap(10), 4, 4)
    const c = fingerprintOfBitmap(bitmap(200), 4, 4)
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('尺寸非法时返回固定标记而不是抛错（录到一半炸掉更糟）', () => {
    expect(fingerprintOfBitmap(new Uint8Array(0), 0, 0)).toBe('empty')
  })
})

describe('帧序列展开与编码参数', () => {
  it('停留时长被摊成重复帧：每段至少一帧，顺序与源帧一致', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [1000, 'b']))
    const order = planFrameSequence(plan.keeps, 10)
    // 第一帧停留 1 秒 → 10 帧；第二帧（末帧）默认停 500ms → 5 帧
    expect(order.slice(0, 10).every((i) => i === 0)).toBe(true)
    expect(order.slice(10).every((i) => i === 1)).toBe(true)
    expect(order).toHaveLength(15)
  })

  it('用 image2 + `-framerate`，**不再用 `-vsync`**（ffmpeg 9 已移除该选项）', () => {
    const args = buildImageSequenceArgs({
      seqPatternPath: 'seq/f-%04d.png',
      outPath: 'out.mp4',
      fps: 10
    })
    expect(args).not.toContain('-vsync')
    expect(args).not.toContain('concat')
    expect(args[args.indexOf('-framerate') + 1]).toBe('10')
    expect(args[args.indexOf('-i') + 1]).toBe('seq/f-%04d.png')
    // 与时间线导出同一套编码口径
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264')
    expect(args[args.indexOf('-pix_fmt') + 1]).toBe('yuv420p')
    // 输入输出帧率一致 → CFR，播放器与剪辑软件都友好
    expect(args[args.indexOf('-r') + 1]).toBe('10')
    expect(args[args.length - 1]).toBe('out.mp4')
  })

  it('帧率非法时不产出 0 帧率的命令', () => {
    const args = buildImageSequenceArgs({ seqPatternPath: 'p-%04d.png', outPath: 'o.mp4', fps: 0 })
    expect(args[args.indexOf('-framerate') + 1]).toBe('1')
  })
})

describe('步骤对齐表', () => {
  const steps = [
    { index: 0, title: '第一步', caption: '打开节点图', atMs: 0 },
    { index: 1, title: '第二步', caption: '加音效节点', atMs: 5000 }
  ]

  it('无 keeps 时按墙钟轴（兼容）', () => {
    const table = buildAlignmentTable(steps, 12000)
    expect(table).toEqual([
      { index: 0, title: '第一步', caption: '打开节点图', startSec: 0, endSec: 5 },
      { index: 1, title: '第二步', caption: '加音效节点', startSec: 5, endSec: 12 }
    ])
  })

  it('有 keeps 时映射到压缩轴：中间 30s 空闲不拉长口播窗', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [30000, 'b'], [31000, 'c']))
    // a 显示封顶 2s，b 显示 1s，c 末帧 ≥0.5s
    expect(plan.keeps[0]!.holdMs).toBe(SCREEN_RECORD_LIMITS.maxHoldMs)
    const table = buildAlignmentTable(
      [
        { index: 0, title: 's0', caption: 'c0', atMs: 0 },
        { index: 1, title: 's1', caption: 'c1', atMs: 30000 }
      ],
      plan.durationMs,
      plan.keeps
    )
    expect(table[0]!.startSec).toBe(0)
    expect(table[1]!.startSec).toBeCloseTo(SCREEN_RECORD_LIMITS.maxHoldMs / 1000, 3)
    expect(table[1]!.endSec).toBeLessThan(5)
  })

  it('mapWallMsToCompressed：空闲中后段钳到段末', () => {
    const plan = planFrameKeeps(frames([0, 'a'], [20000, 'b']))
    expect(mapWallMsToCompressed(0, plan.keeps)).toBe(0)
    expect(mapWallMsToCompressed(1000, plan.keeps)).toBe(1000)
    expect(mapWallMsToCompressed(15000, plan.keeps)).toBe(SCREEN_RECORD_LIMITS.maxHoldMs)
  })

  it('末步给下限，免得算出零长度区间让字幕一闪而过', () => {
    const table = buildAlignmentTable(
      [{ index: 0, title: 'only', caption: 'only', atMs: 3000 }],
      3000
    )
    expect(table[0]!.endSec - table[0]!.startSec).toBeGreaterThan(0)
  })

  it('乱序传入也按时间排好（Agent 可能先记后一步）', () => {
    const table = buildAlignmentTable([steps[1]!, steps[0]!], 12000)
    expect(table.map((s) => s.index)).toEqual([0, 1])
  })
})
