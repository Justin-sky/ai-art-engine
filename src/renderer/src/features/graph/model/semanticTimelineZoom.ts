/**
 * 语义时间线编辑器的缩放数学（纯函数，便于钉住边界与「光标下时间不动」）。
 *
 * 抽出来的原因：这类交互的 bug 都藏在算术里（clamp 越界、缩放后内容从光标下跑掉、
 * 向上滚还缩小），而组件在 node 环境渲染不了，只有把算术独立才测得到。
 */

/** 缩放范围（秒 → 像素）：下界要能看全 40 秒级短视频，上界要能逐词级看细节 */
export const MIN_PX_PER_SEC = 8
export const MAX_PX_PER_SEC = 400

/** 滚轮/按钮每次的缩放倍率（滚一次约 15%） */
export const ZOOM_STEP = 1.15

export function clampPxPerSec(value: number, fallback = 40): number {
  const n = Number.isFinite(value) && value > 0 ? value : fallback
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, n))
}

/**
 * 滚轮 → 新的 px/s。
 *
 * 约定与常见工具一致：**向上滚（deltaY < 0）= 放大**；已经到边界时返回原值
 * （调用方据此跳过后续的滚动位置修正，免得白白抖动一次）。
 */
export function nextPxPerSec(current: number, deltaY: number, step = ZOOM_STEP): number {
  const from = clampPxPerSec(current)
  const zoomIn = deltaY < 0
  const raw = zoomIn ? from * step : from / step
  return clampPxPerSec(raw)
}

/** 指针位置对应的时间（秒）—— 缩放前后用它把同一时刻固定在光标下 */
export function timeAtPointer(input: {
  scrollLeft: number
  pointerX: number
  pxPerSec: number
}): number {
  const px = Math.max(1, input.pxPerSec)
  return Math.max(0, (input.scrollLeft + input.pointerX) / px)
}

/**
 * 缩放后要让「光标下的时间」仍然在光标下，滚动条该在哪。
 *
 * 不做这一步的话，放大时内容会整体向左甩（视线跑掉），放大到细节处基本没法用。
 */
export function anchoredScrollLeft(input: {
  timeAtPointer: number
  pointerX: number
  pxPerSec: number
}): number {
  return Math.max(0, input.timeAtPointer * input.pxPerSec - input.pointerX)
}
