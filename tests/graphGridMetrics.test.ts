import { describe, expect, it } from 'vitest'
import { applyGraphGridStyle, computeGraphGridMetrics } from '../src/renderer/src/graph/gridCanvas'

function createStyleStub(): {
  el: HTMLElement
  writes: Record<string, number>
} {
  const values: Record<string, string> = {}
  const writes: Record<string, number> = {}
  const style = new Proxy(values, {
    set(target, property, value) {
      const key = String(property)
      writes[key] = (writes[key] ?? 0) + 1
      target[key] = String(value)
      return true
    }
  })
  return {
    el: { style: style as unknown as CSSStyleDeclaration } as HTMLElement,
    writes
  }
}

describe('computeGraphGridMetrics', () => {
  it('keeps base step when zoomed enough', () => {
    const m = computeGraphGridMetrics({ x: 0, y: 0, zoom: 1 })
    expect(m.stepScreen).toBe(40)
    expect(m.majorStep).toBe(200)
  })

  it('doubles scene step when screen step would be too dense', () => {
    const m = computeGraphGridMetrics({ x: 0, y: 0, zoom: 0.2 })
    expect(m.stepScreen).toBeGreaterThanOrEqual(12)
    expect(m.stepScreen % 1).toBeCloseTo(0, 10)
  })

  it('offsets follow viewport pan phase', () => {
    const m = computeGraphGridMetrics({ x: 25, y: -10, zoom: 1 })
    expect(m.offsetX).toBe(25)
    expect(m.offsetY).toBe(30)
  })
})

const GRID_LAYER_INSET = 480

function parseTranslate(transform: string): [number, number] {
  const match = transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)
  if (!match) throw new Error(`unexpected transform: ${transform}`)
  return [Number(match[1]), Number(match[2])]
}

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

describe('applyGraphGridStyle', () => {
  it('moves the phase with translate3d and never touches layout props while panning', () => {
    const minor = createStyleStub()
    const major = createStyleStub()
    applyGraphGridStyle({ minor: minor.el, major: major.el }, { x: 25, y: 10, zoom: 1 })

    const minorSizeWrites = minor.writes.backgroundSize
    const majorSizeWrites = major.writes.backgroundSize
    applyGraphGridStyle({ minor: minor.el, major: major.el }, { x: 30, y: 12, zoom: 1 })

    // step 40 unchanged → 相位靠 translate；step 40 整除 inset，minor 相位等于 modulo(viewport,step)
    expect(minor.el.style.transform).toBe('translate3d(30px, 12px, 0)')
    expect(minor.writes.backgroundSize).toBe(minorSizeWrites)
    expect(major.writes.backgroundSize).toBe(majorSizeWrites)
    // 关键：平移绝不写 left/top/backgroundPosition（避免 reflow）
    expect(minor.writes.left).toBeUndefined()
    expect(minor.writes.top).toBeUndefined()
    expect(minor.writes.backgroundPosition).toBeUndefined()
    expect(major.writes.left).toBeUndefined()
    expect(major.writes.top).toBeUndefined()
  })

  it('rewrites backgroundSize on zoom but never left/top, so zooming causes no reflow', () => {
    const minor = createStyleStub()
    const major = createStyleStub()
    applyGraphGridStyle({ minor: minor.el, major: major.el }, { x: 0, y: 0, zoom: 1 })
    applyGraphGridStyle({ minor: minor.el, major: major.el }, { x: 0, y: 0, zoom: 1.5 })

    expect(minor.writes.backgroundSize).toBeGreaterThanOrEqual(2)
    expect(minor.writes.left).toBeUndefined()
    expect(minor.writes.top).toBeUndefined()
    expect(major.writes.left).toBeUndefined()
    expect(major.writes.top).toBeUndefined()
  })

  it('aligns minor and major grid lines to the same world phase across the fixed inset', () => {
    const minor = createStyleStub()
    const major = createStyleStub()
    const viewport = { x: 137, y: -53, zoom: 1 }
    applyGraphGridStyle({ minor: minor.el, major: major.el }, viewport)

    const [minorX, minorY] = parseTranslate(minor.el.style.transform)
    const [majorX, majorY] = parseTranslate(major.el.style.transform)

    // 屏幕线位置 = -INSET + translate + k*step，应对齐世界相位 modulo(viewport, step)
    expect(positiveMod(-GRID_LAYER_INSET + minorX, 40)).toBeCloseTo(positiveMod(viewport.x, 40))
    expect(positiveMod(-GRID_LAYER_INSET + minorY, 40)).toBeCloseTo(positiveMod(viewport.y, 40))
    expect(positiveMod(-GRID_LAYER_INSET + majorX, 200)).toBeCloseTo(positiveMod(viewport.x, 200))
    expect(positiveMod(-GRID_LAYER_INSET + majorY, 200)).toBeCloseTo(positiveMod(viewport.y, 200))
  })
})
