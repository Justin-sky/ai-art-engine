/**
 * 人像编辑器舞台的视口变换数学（纯函数，带数值单测）。
 *
 * 画面栈的变换是 `translate(pan) rotate(θ) scale(zoom)`、`transform-origin` 取图片中心，
 * 因此「图片归一化坐标 ↔ 视口坐标」互为逆变换。之所以把它抽出来而不是留在组件里：
 * 这类公式错一次的表现是「画框落点整体偏掉」「拖分割线时线跟不上指针」，
 * 而源码文本断言锁不住公式本身 —— 第一版就把错误的分母（`naturalWidth`，原始像素）
 * 当成正确写法锁进了测试。
 *
 * 坐标口径：
 * - `layoutWidth / layoutHeight` 是图片**未变换**时的 CSS 布局尺寸（`offsetWidth/offsetHeight`），
 *   不是原始像素尺寸，也不是变换后的外接框尺寸；
 * - `centerX / centerY` 是图片的**视觉中心**（变换之后）在视口坐标系里的位置，
 *   即 `rect.left + rect.width / 2`（旋转 / 缩放都绕中心进行，所以外接框的中心就是它）；
 * - 归一化坐标 `0..1` 相对图片自身，允许超出（是否夹取由调用方决定）。
 */

export interface PortraitImagePoint {
  /** 0..1，相对图片宽 */
  x: number
  /** 0..1，相对图片高 */
  y: number
}

export interface PortraitViewport {
  /** 图片未变换时的布局宽度（CSS px） */
  layoutWidth: number
  /** 图片未变换时的布局高度（CSS px） */
  layoutHeight: number
  /** 图片视觉中心的视口 x（clientX 口径） */
  centerX: number
  /** 图片视觉中心的视口 y（clientY 口径） */
  centerY: number
  zoom: number
  /** 顺时针旋转角度 */
  rotationDeg: number
}

/** 图片归一化坐标 → 视口坐标 */
export function imageToViewportPoint(
  point: PortraitImagePoint,
  view: PortraitViewport
): { x: number; y: number } {
  const rad = (view.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localX = (point.x - 0.5) * view.layoutWidth * view.zoom
  const localY = (point.y - 0.5) * view.layoutHeight * view.zoom
  return {
    x: view.centerX + localX * cos - localY * sin,
    y: view.centerY + localX * sin + localY * cos
  }
}

/**
 * 视口坐标 → 图片归一化坐标。
 *
 * 逆变换分三步：先减掉图片视觉中心（含 pan），再反旋转，最后除以 zoom 得到未变换的
 * 布局像素偏移，除以**布局尺寸**（不是原始像素、也不是外接框）归一化。
 */
export function viewportPointToImage(
  viewportPoint: { x: number; y: number },
  view: PortraitViewport
): PortraitImagePoint {
  const rad = (view.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const scale = view.zoom > 0 ? view.zoom : 1
  const dx = viewportPoint.x - view.centerX
  const dy = viewportPoint.y - view.centerY
  const localX = (dx * cos + dy * sin) / scale
  const localY = (-dx * sin + dy * cos) / scale
  return {
    x: localX / view.layoutWidth + 0.5,
    y: localY / view.layoutHeight + 0.5
  }
}
