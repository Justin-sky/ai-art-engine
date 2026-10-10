import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  ZOOM_STEP,
  anchoredScrollLeft,
  clampPxPerSec,
  nextPxPerSec,
  timeAtPointer
} from '../src/renderer/src/features/graph/model/semanticTimelineZoom'

/**
 * 语义时间线 dive 的滚轮缩放：交互本身渲染不了（组件无 jsdom），
 * 但缩放算术与「光标下时间不动」这两件事必须钉住 —— 错了就是"放大后画面甩走"。
 */
describe('semanticTimelineZoom', () => {
  it('clamp：越界收敛，非法值退回默认', () => {
    expect(clampPxPerSec(40)).toBe(40)
    expect(clampPxPerSec(1)).toBe(MIN_PX_PER_SEC)
    expect(clampPxPerSec(9999)).toBe(MAX_PX_PER_SEC)
    expect(clampPxPerSec(Number.NaN)).toBe(40)
    expect(clampPxPerSec(0)).toBe(40)
    expect(clampPxPerSec(-5)).toBe(40)
  })

  it('滚轮方向：向上滚（deltaY<0）放大，向下滚缩小', () => {
    expect(nextPxPerSec(40, -1)).toBeCloseTo(40 * ZOOM_STEP, 5)
    expect(nextPxPerSec(40, 1)).toBeCloseTo(40 / ZOOM_STEP, 5)
  })

  it('滚轮在边界处停住（返回原值，调用方据此跳过滚动修正）', () => {
    expect(nextPxPerSec(MAX_PX_PER_SEC, -1)).toBe(MAX_PX_PER_SEC)
    expect(nextPxPerSec(MIN_PX_PER_SEC, 1)).toBe(MIN_PX_PER_SEC)
    // 从越界值出发也先收敛再缩放
    expect(nextPxPerSec(9999, -1)).toBe(MAX_PX_PER_SEC)
  })

  it('timeAtPointer：滚动位置 + 指针偏移 → 时刻', () => {
    expect(timeAtPointer({ scrollLeft: 0, pointerX: 0, pxPerSec: 40 })).toBe(0)
    expect(timeAtPointer({ scrollLeft: 400, pointerX: 0, pxPerSec: 40 })).toBe(10)
    expect(timeAtPointer({ scrollLeft: 400, pointerX: 40, pxPerSec: 40 })).toBe(11)
    // 负滚动位置（回弹）不应给出负时刻
    expect(timeAtPointer({ scrollLeft: -50, pointerX: 0, pxPerSec: 40 })).toBe(0)
  })

  it('锚定：缩放后光标下的时刻不变', () => {
    const pxPerSec = 40
    const nextPx = 60
    const pointerX = 120
    const scrollLeft = 400
    const anchor = timeAtPointer({ scrollLeft, pointerX, pxPerSec })
    const nextScroll = anchoredScrollLeft({ timeAtPointer: anchor, pointerX, pxPerSec: nextPx })
    // 新的滚动位置下，同一指针偏移仍对应同一时刻
    expect(timeAtPointer({ scrollLeft: nextScroll, pointerX, pxPerSec: nextPx })).toBeCloseTo(
      anchor,
      6
    )
  })

  it('锚定：不会给出负的 scrollLeft（内容左端之外）', () => {
    expect(anchoredScrollLeft({ timeAtPointer: 0, pointerX: 200, pxPerSec: 40 })).toBe(0)
  })
})

describe('SemanticTimelineEditor 缩放接线（源码守卫）', () => {
  const source = readFileSync(
    join(process.cwd(), 'src/renderer/src/components/SemanticTimelineEditor.vue'),
    'utf8'
  )

  it('滚轮只在 Ctrl/⌘ 下缩放（普通滚轮留给纵向滚动）', () => {
    expect(source).toContain('@wheel="onWheel"')
    expect(source).toContain('if (!e.ctrlKey && !e.metaKey) return')
    expect(source).toContain('e.preventDefault()')
  })

  it('走抽出来的缩放算术，并按光标/视口中心锚定', () => {
    expect(source).toContain('nextPxPerSec(px.value, e.deltaY)')
    expect(source).toContain('timeAtPointer(')
    expect(source).toContain('anchoredScrollLeft(')
    expect(source).toContain('clampPxPerSec')
  })

  it('有可见的缩放控件与读数（不是只能靠滚轮猜）', () => {
    expect(source).toContain('class="stl-zoom-slider"')
    expect(source).toContain('class="stl-zoom-readout"')
    expect(source).toContain('zoomBy(')
    expect(source).toContain('resetZoom')
    expect(source).toContain(':min="MIN_PX_PER_SEC"')
    expect(source).toContain(':max="MAX_PX_PER_SEC"')
  })

  it('宽度随缩放变化（px 由内部状态驱动，而不是只读 props）', () => {
    expect(source).toContain('const widthPx = computed(() => duration.value * px.value)')
    expect(source).toContain('const px = computed(() => pxPerSecValue.value)')
  })
})
