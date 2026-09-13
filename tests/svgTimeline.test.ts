import { describe, expect, it } from 'vitest'
import {
  buildSvgAnimationSpec,
  detectSvgAnimationPeriod,
  evaluateSvgAnimationValue,
  interpolateSvgColors,
  interpolateSvgNumbers,
  isSvgTimelineActive,
  normalizeSvgRepeat,
  parseSvgBegin,
  parseSvgColor,
  parseSvgTime,
  resolveSvgAnimationValues
} from '../src/shared/media/svgTimeline'

/**
 * SVG 烘焙的逐帧导出能否复现，取决于时间轴求值：
 * 求值错一点，烘出来的每帧都会漂。这里按 SMIL 的时间语义逐条钉住。
 */
describe('svgTimeline 时间解析', () => {
  it('clock-value 支持 s / ms / min / h / 时钟格式', () => {
    expect(parseSvgTime('1s')).toBe(1)
    expect(parseSvgTime('500ms')).toBe(0.5)
    expect(parseSvgTime('0.5')).toBe(0.5)
    expect(parseSvgTime('2')).toBe(2)
    expect(parseSvgTime('2min')).toBe(120)
    expect(parseSvgTime('0.5h')).toBe(1800)
    expect(parseSvgTime('00:00:02')).toBe(2)
    expect(parseSvgTime('01:30')).toBe(90)
  })

  it('indefinite / 空值 / 事件型 begin 不可解析', () => {
    expect(parseSvgTime('indefinite')).toBeNull()
    expect(parseSvgTime('')).toBeNull()
    expect(parseSvgTime(null)).toBeNull()
    // 事件型 begin 在离屏求值里没有时间可依，按 0 处理
    expect(parseSvgBegin('click')).toBe(0)
    expect(parseSvgBegin('2s; 4s')).toBe(2)
    expect(parseSvgBegin('')).toBe(0)
  })

  it('repeatCount 归一化', () => {
    expect(normalizeSvgRepeat('indefinite')).toBe('indefinite')
    expect(normalizeSvgRepeat('3')).toBe(3)
    expect(normalizeSvgRepeat('0')).toBe(1)
    expect(normalizeSvgRepeat(null)).toBe(1)
  })
})

describe('svgTimeline 关键值推导', () => {
  it('values 优先，其次 from&to / from&by / by&to / 单项', () => {
    expect(resolveSvgAnimationValues({ values: '0;5;10' })).toEqual(['0', '5', '10'])
    expect(resolveSvgAnimationValues({ from: '0', to: '1' })).toEqual(['0', '1'])
    expect(resolveSvgAnimationValues({ from: '0', by: '10' })).toEqual(['0', '10'])
    // to & by：起点 = to - by
    expect(resolveSvgAnimationValues({ to: '10', by: '4' })).toEqual(['6', '10'])
    expect(resolveSvgAnimationValues({ to: 'x' })).toEqual(['x'])
    expect(resolveSvgAnimationValues({ from: 'x' })).toEqual(['x'])
    expect(resolveSvgAnimationValues({})).toBeNull()
  })

  it('dur="indefinite" 仍产出 spec，但不参与时间轴', () => {
    const spec = buildSvgAnimationSpec({ values: '0;1', dur: 'indefinite' })
    expect(spec).not.toBeNull()
    expect(spec!.dur).toBeNull()
    expect(evaluateSvgAnimationValue(spec!, 0.5)).toBeNull()
  })

  it('keyTimes 长度不匹配或非单调时退回等分', () => {
    expect(buildSvgAnimationSpec({ values: '0;1;2', keyTimes: '0;0.5' })!.keyTimes).toBeNull()
    expect(buildSvgAnimationSpec({ values: '0;1;2', keyTimes: '0;0.8;0.4' })!.keyTimes).toBeNull()
    expect(buildSvgAnimationSpec({ values: '0;1;2', keyTimes: '0;0.5;1' })!.keyTimes).toEqual([
      0, 0.5, 1
    ])
  })
})

describe('svgTimeline 求值', () => {
  function spec(attrs: Parameters<typeof buildSvgAnimationSpec>[0]) {
    const built = buildSvgAnimationSpec(attrs)
    if (!built) throw new Error('spec not built')
    return built
  }

  it('线性插值按时间取中间值', () => {
    const s = spec({ values: '0;1', dur: '1s' })
    expect(evaluateSvgAnimationValue(s, 0)).toBe('0')
    expect(evaluateSvgAnimationValue(s, 0.5)).toBe('0.5')
    // 到达 dur 即活动区间结束、动画停止（无 fill="freeze"），保留文档原值
    expect(evaluateSvgAnimationValue(s, 1)).toBeNull()
  })

  it('begin 之前不产出值（保留文档原值）', () => {
    const s = spec({ values: '0;1', dur: '1s', begin: '1s' })
    expect(evaluateSvgAnimationValue(s, 0.5)).toBeNull()
    expect(evaluateSvgAnimationValue(s, 1.25)).toBe('0.25')
  })

  it('repeatCount 内按周期取模，结束后按 fill 决定冻结或还原', () => {
    const frozen = spec({ values: '0;1', dur: '1s', repeatCount: '2', fill: 'freeze' })
    expect(evaluateSvgAnimationValue(frozen, 1.5)).toBe('0.5')
    expect(evaluateSvgAnimationValue(frozen, 2.5)).toBe('1')

    const plain = spec({ values: '0;1', dur: '1s' })
    expect(evaluateSvgAnimationValue(plain, 1.5)).toBeNull()
  })

  it('indefinite 重复永不结束', () => {
    const s = spec({ values: '0;1', dur: '2s', repeatCount: 'indefinite' })
    expect(isSvgTimelineActive(s, 100)).toBe(true)
    expect(evaluateSvgAnimationValue(s, 101)).toBe('0.5')
  })

  it('discrete 取区间左端点', () => {
    const s = spec({ values: 'a;b;c', dur: '1s', calcMode: 'discrete' })
    expect(evaluateSvgAnimationValue(s, 0.1)).toBe('a')
    expect(evaluateSvgAnimationValue(s, 0.6)).toBe('b')
    expect(evaluateSvgAnimationValue(s, 0.95)).toBe('c')
  })

  it('keyTimes 控制关键点位置', () => {
    const s = spec({ values: '0;10;0', dur: '1s', keyTimes: '0;0.5;1' })
    expect(evaluateSvgAnimationValue(s, 0.25)).toBe('5')
    expect(evaluateSvgAnimationValue(s, 0.75)).toBe('5')
  })

  it('颜色按通道插值', () => {
    const s = spec({ values: '#000000;#ffffff', dur: '1s' })
    expect(s.kind).toBe('color')
    expect(evaluateSvgAnimationValue(s, 0.5)).toBe('#808080')
  })

  it('带单位与多数值的取值逐段插值', () => {
    const px = spec({ values: '0px;10px', dur: '1s' })
    expect(evaluateSvgAnimationValue(px, 0.5)).toBe('5px')

    const transform = spec({ values: '10 20;30 40', dur: '1s' })
    expect(evaluateSvgAnimationValue(transform, 0.5)).toBe('20 30')
  })

  it('结构相同的路径数据逐段插值（比离散更贴近原动画）', () => {
    const s = spec({ values: 'M0 0 L10 10;M0 0 L20 20', dur: '1s' })
    expect(s.kind).toBe('number')
    expect(evaluateSvgAnimationValue(s, 0.5)).toBe('M0 0 L15 15')
  })

  it('结构不同的值退回离散（取左端点）', () => {
    const s = spec({ values: 'translate(0, 0);rotate(45)', dur: '1s' })
    expect(s.kind).toBe('raw')
    expect(evaluateSvgAnimationValue(s, 0.9)).toBe('translate(0, 0)')
  })
})

describe('svgTimeline 周期与工具函数', () => {
  it('周期取各动画活动区间的最大值', () => {
    const short = buildSvgAnimationSpec({ values: '0;1', dur: '1s' })!
    const looped = buildSvgAnimationSpec({ values: '0;1', dur: '1s', repeatCount: '2' })!
    const infinite = buildSvgAnimationSpec({ values: '0;1', dur: '2s', repeatCount: 'indefinite' })!
    expect(detectSvgAnimationPeriod([short, looped, infinite])).toBe(2)
    expect(detectSvgAnimationPeriod([])).toBe(0)
  })

  it('数值插值要求同构，异构返回 null', () => {
    expect(interpolateSvgNumbers('10', '20', 0.5)).toBe('15')
    expect(interpolateSvgNumbers('10', '10 20', 0.5)).toBeNull()
  })

  it('颜色解析覆盖 hex / 简写 / rgba', () => {
    expect(parseSvgColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseSvgColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseSvgColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
    expect(parseSvgColor('not-a-color')).toBeNull()
    expect(interpolateSvgColors('#000000', '#ffffff', 0.25)).toBe('#404040')
  })
})
