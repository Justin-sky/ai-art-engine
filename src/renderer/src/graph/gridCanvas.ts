import type { GraphViewport } from '@shared/graph'
import { GRAPH_LAYOUT_GRID_STEP } from '@shared/graph'

export { GRAPH_LAYOUT_GRID_STEP as GRID_STEP }

const MIN_GRID_SCREEN = 12

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

/** 按视口计算屏幕网格步长与相位（随缩放 LOD） */
export function computeGraphGridMetrics(viewport: GraphViewport): {
  stepScreen: number
  majorStep: number
  offsetX: number
  offsetY: number
  majorOffsetX: number
  majorOffsetY: number
} {
  let stepScene = GRAPH_LAYOUT_GRID_STEP
  let stepScreen = stepScene * viewport.zoom
  while (stepScreen < MIN_GRID_SCREEN) {
    stepScene *= 2
    stepScreen = stepScene * viewport.zoom
  }
  const majorStep = stepScreen * 5
  return {
    stepScreen,
    majorStep,
    offsetX: modulo(viewport.x, stepScreen),
    offsetY: modulo(viewport.y, stepScreen),
    majorOffsetX: modulo(viewport.x, majorStep),
    majorOffsetY: modulo(viewport.y, majorStep)
  }
}

export type GraphGridLayerEls = {
  minor: HTMLElement
  major: HTMLElement
}

type GridStyleCache = {
  stepScreen: number
  majorStep: number
  offsetX: number
  offsetY: number
  majorOffsetX: number
  majorOffsetY: number
}

const gridStyleCache = new WeakMap<HTMLElement, GridStyleCache>()

/**
 * 网格层四周固定 overscan（CSS `inset: -GRID_LAYER_INSET`）。
 * 相位对齐时用它补偿元素原点：屏幕线位置 = -INSET + translate + k*step，
 * 令其 ≡ modulo(viewport, step)，即 translate = modulo(viewport + INSET, step)。
 * INSET 需大于最大可能 majorStep 相位溢出（缩放上限下约 400px）。
 */
export const GRID_LAYER_INSET = 480

/**
 * 双层网格：`backgroundSize` 仅在 LOD/缩放步长变化时写（paint，无 layout）；
 * 相位统一用 translate3d（composite）。不再每帧写 left/top，避免缩放时逐帧 reflow。
 */
export function applyGraphGridStyle(els: GraphGridLayerEls, viewport: GraphViewport): void {
  const m = computeGraphGridMetrics(viewport)
  const cacheRoot = els.minor
  const prev = gridStyleCache.get(cacheRoot)

  if (!prev || prev.stepScreen !== m.stepScreen) {
    els.minor.style.backgroundSize = `${m.stepScreen}px ${m.stepScreen}px, ${m.stepScreen}px ${m.stepScreen}px`
  }
  if (!prev || prev.majorStep !== m.majorStep) {
    els.major.style.backgroundSize = `${m.majorStep}px ${m.majorStep}px, ${m.majorStep}px ${m.majorStep}px`
  }

  const minorX = modulo(viewport.x + GRID_LAYER_INSET, m.stepScreen)
  const minorY = modulo(viewport.y + GRID_LAYER_INSET, m.stepScreen)
  const majorX = modulo(viewport.x + GRID_LAYER_INSET, m.majorStep)
  const majorY = modulo(viewport.y + GRID_LAYER_INSET, m.majorStep)

  if (!prev || prev.offsetX !== minorX || prev.offsetY !== minorY) {
    els.minor.style.transform = `translate3d(${minorX}px, ${minorY}px, 0)`
  }
  if (!prev || prev.majorOffsetX !== majorX || prev.majorOffsetY !== majorY) {
    els.major.style.transform = `translate3d(${majorX}px, ${majorY}px, 0)`
  }

  gridStyleCache.set(cacheRoot, {
    stepScreen: m.stepScreen,
    majorStep: m.majorStep,
    offsetX: minorX,
    offsetY: minorY,
    majorOffsetX: majorX,
    majorOffsetY: majorY
  })
}
