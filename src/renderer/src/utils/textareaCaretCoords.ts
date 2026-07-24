/** Styles copied onto the mirror div so wrapping matches the textarea. */
const MIRROR_STYLE_PROPS = [
  'direction',
  'box-sizing',
  'width',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'border-style',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'font-style',
  'font-variant',
  'font-weight',
  'font-stretch',
  'font-size',
  'font-size-adjust',
  'line-height',
  'font-family',
  'text-align',
  'text-transform',
  'text-indent',
  'text-decoration',
  'letter-spacing',
  'word-spacing',
  'tab-size',
  '-moz-tab-size',
  'word-break',
  'overflow-wrap',
  'white-space'
] as const

export type TextareaCaretCoords = {
  top: number
  left: number
  height: number
}

export type TextareaCaretClientRect = {
  top: number
  left: number
  height: number
  bottom: number
}

function readLineHeight(computed: CSSStyleDeclaration): number {
  const raw = computed.lineHeight
  const fontSize = Number.parseFloat(computed.fontSize) || 12
  if (!raw || raw === 'normal') return fontSize * 1.2
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return fontSize * 1.2
  // 少数环境仍返回无单位倍数（如 "1.55"），需乘以 fontSize
  if (!raw.endsWith('px') && !raw.endsWith('pt') && parsed > 0 && parsed < 8) {
    return parsed * fontSize
  }
  return parsed
}

function fillMirrorContent(
  div: HTMLDivElement,
  element: HTMLTextAreaElement | HTMLInputElement,
  position: number
): HTMLSpanElement {
  div.textContent = element.value.slice(0, position)
  if (element.nodeName === 'INPUT') {
    div.textContent = (div.textContent || '').replace(/\s/g, '\u00a0')
  }

  const span = document.createElement('span')
  // 后方文本参与换行，避免光标落在行尾时测偏
  span.textContent = element.value.slice(position) || '.'
  div.appendChild(span)
  return span
}

/**
 * Pixel offsets of a caret within a textarea/input (relative to the element box,
 * including content above the current scrollTop).
 *
 * Mirror-div technique (textarea-caret-position). Do not copy element height /
 * overflow — a fixed height clips long text and makes offsetTop wrong.
 */
export function getTextareaCaretCoords(
  element: HTMLTextAreaElement | HTMLInputElement,
  position: number
): TextareaCaretCoords {
  const div = document.createElement('div')
  document.body.appendChild(div)

  const style = div.style
  const computed = window.getComputedStyle(element)

  style.whiteSpace = 'pre-wrap'
  if (element.nodeName !== 'INPUT') {
    style.wordWrap = 'break-word'
  } else {
    style.whiteSpace = 'nowrap'
  }

  style.position = 'absolute'
  style.visibility = 'hidden'
  style.top = '0'
  style.left = '-9999px'
  // 必须可随全文增高，否则长文场景 span.offsetTop 会被裁切算错
  style.height = 'auto'
  style.minHeight = '0'
  style.maxHeight = 'none'
  style.overflow = 'hidden'
  style.overflowX = 'hidden'
  style.overflowY = 'hidden'

  for (const prop of MIRROR_STYLE_PROPS) {
    style.setProperty(prop, computed.getPropertyValue(prop))
  }

  // clientWidth = 内容区（不含滚动条），与换行宽度一致
  style.width = `${element.clientWidth}px`

  const span = fillMirrorContent(div, element, position)
  const height = readLineHeight(computed)

  const borderTop = Number.parseFloat(computed.borderTopWidth) || 0
  const borderLeft = Number.parseFloat(computed.borderLeftWidth) || 0

  const coordinates = {
    top: span.offsetTop + borderTop,
    left: span.offsetLeft + borderLeft,
    height
  }

  document.body.removeChild(div)
  return coordinates
}

/**
 * 光标的视口坐标（用于 position:fixed 菜单）。
 * 用无裁切镜像测布局坐标，再按 textarea 的视口缩放换算（兼容画布 translate/scale）。
 * 旧实现把等高镜像挂在父级再 scrollTop，长文上下部光标容易漂。
 */
export function getTextareaCaretClientRect(
  element: HTMLTextAreaElement | HTMLInputElement,
  position: number
): TextareaCaretClientRect {
  const coords = getTextareaCaretCoords(element, position)
  const rect = element.getBoundingClientRect()
  const scaleX = element.offsetWidth > 0 ? rect.width / element.offsetWidth : 1
  const scaleY = element.offsetHeight > 0 ? rect.height / element.offsetHeight : 1
  const top = rect.top + (coords.top - element.scrollTop) * scaleY
  const left = rect.left + (coords.left - element.scrollLeft) * scaleX
  const height = Math.max(coords.height * scaleY, 14)
  return { top, left, height, bottom: top + height }
}
