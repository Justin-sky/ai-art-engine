/**
 * 指令框（生成指令输入框）的焦点接管判定。
 *
 * 背景：指令框外面套着一层带内边距的编辑区，而画布上的节点卡在 pointerdown 时会把
 * 焦点/选区收过去。点在 textarea 盒子之外的那圈 padding 上时，浏览器不会把焦点给
 * textarea（那里不是它的命中区）——于是焦点留在画布上，**用户点进去后的第一下按键
 * 全被画布吃掉，第二下才正常**。
 *
 * 判定抽成纯函数的原因：这是「第一下按键丢失」这个 bug 的契约所在，
 * 放在组件里只能靠手测，没法在单测里钉住。
 */

export interface PointLike {
  clientX: number
  clientY: number
}

export interface RectLike {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * 该点是否落在元素盒子内（含内边距）。
 * 盒子内属于 textarea 自己的命中区，光标位置与拖选都交给浏览器原生处理。
 */
export function pointInRect(rect: RectLike, point: PointLike): boolean {
  return (
    point.clientX >= rect.left &&
    point.clientX <= rect.right &&
    point.clientY >= rect.top &&
    point.clientY <= rect.bottom
  )
}

/** 'native'：别拦，浏览器原生聚焦/选光标；'takeover'：拦掉默认行为并显式聚焦 */
export type FocusIntent = 'native' | 'takeover'

export function resolveEditorFocusIntent(input: {
  /** 当前已聚焦的元素是否已经是这个 textarea */
  alreadyFocused: boolean
  /** textarea 的视口矩形 */
  rect: RectLike
  /** mousedown 的坐标 */
  point: PointLike
}): FocusIntent {
  // 已经聚焦就不再动：否则会平白清掉用户已有的选区
  if (input.alreadyFocused) return 'native'
  // 盒子内交给浏览器：那里能正确定位光标，也保留「按住拖动选中文本」
  if (pointInRect(input.rect, input.point)) return 'native'
  // 盒子外（编辑区内边距）必须接管，否则第一下按键发给画布
  return 'takeover'
}
