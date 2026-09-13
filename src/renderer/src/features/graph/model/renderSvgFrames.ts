/**
 * SVG 烘焙 → 逐帧位图（渲染层）。
 *
 * 链路：解析 SVG → 探测动画周期 → 每个采样时刻求值并烘焙成一份静态 SVG
 * （属性写入值、动画元素全部移除）→ data URI 交给 `<img>` → canvas 栅格化成 PNG。
 *
 * 为什么必须「烘焙」而不是让浏览器播：`<img>` 里的 SMIL 动画无法 seek，
 * 序列化出去的动画文档会从 0 重播，拿不到目标时刻的画面（见 `@shared/media/svgTimeline`）。
 *
 * 已知限制：
 * - `<animateMotion>`（路径运动）需要 path 求长，暂不参与求值，保留原始位置；
 * - SVG 内的外链资源（`<image href="...">`、Web Font）在 data URI 下不会加载；
 * - 输出 PNG 因此不含字体替换，`<text>` 依赖本机字体。
 */
import {
  buildSvgAnimationSpec,
  detectSvgAnimationPeriod,
  evaluateSvgAnimationValue,
  type SvgAnimationAttrs,
  type SvgAnimationSpec
} from '@shared/media/svgTimeline'
import { normalizeSvgAnimState, SVG_ANIM_SIZE_MAX, type SvgAnimState } from '@shared/graph/svgAnim'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const ANIMATION_SELECTOR = 'animate, animateTransform, animateMotion, set'
/** SVG 无 width/height/viewBox 时的 CSS 默认对象尺寸 */
const DEFAULT_SVG_SIZE = { width: 300, height: 150 }

interface CollectedAnimation {
  /** 求值规则；null = 该动画不支持（如 animateMotion），烘焙时保留原值 */
  spec: SvgAnimationSpec | null
  attributeName: string
  /** animateTransform 的变换类型（translate / rotate / scale / skewX / skewY） */
  transformType: string
  isTransform: boolean
}

interface FrameSize {
  width: number
  height: number
  /** 原始用户坐标系，用于让 `<img>` 等比缩放内容 */
  viewBox: string
}

export interface SvgFrameRenderResult {
  frameUrls: string[]
  width: number
  height: number
  frameCount: number
  /** 实际取样时长（秒） */
  durationSec: number
  /** 由帧数与时长推得的帧率（静态 SVG 为 0） */
  fps: number
  /** 是否检测到可求值的动画；静态 SVG 只出一帧 */
  animated: boolean
}

export interface SvgFrameRenderInput {
  svgText: string
  state?: Partial<SvgAnimState>
  signal?: AbortSignal
}

function parseLength(raw: string | null): number | null {
  const text = (raw ?? '').trim()
  if (!text || text.endsWith('%')) return null
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))([a-z]*)$/i.exec(text)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value) || value <= 0) return null
  // 只认 px 与无单位：em / pt / % 依赖 CSS 视口，离屏栅格化口径不可靠
  const unit = (match[2] ?? '').toLowerCase()
  if (unit !== '' && unit !== 'px') return null
  return value
}

function parseViewBox(raw: string | null): { width: number; height: number } | null {
  const nums = (raw ?? '')
    .trim()
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n))
  if (nums.length !== 4) return null
  const width = nums[2]!
  const height = nums[3]!
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

function parseSvgDocument(svgText: string): Document {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('renderSvgFrames: invalid svg markup')
  }
  const root = doc.documentElement
  if (!root || root.localName !== 'svg') {
    throw new Error('renderSvgFrames: root element is not <svg>')
  }
  return doc
}

function resolveBaseSize(root: Element): { width: number; height: number } {
  const box = parseViewBox(root.getAttribute('viewBox'))
  const width = parseLength(root.getAttribute('width'))
  const height = parseLength(root.getAttribute('height'))
  if (width && height) return { width, height }
  if (box) {
    if (width) return { width, height: (width * box.height) / box.width }
    if (height) return { width: (height * box.width) / box.height, height }
    return { width: box.width, height: box.height }
  }
  return { ...DEFAULT_SVG_SIZE }
}

function resolveFrameSize(base: { width: number; height: number }, state: SvgAnimState): FrameSize {
  const ratio = base.width / base.height
  let width = state.width > 0 ? state.width : base.width
  let height = state.height > 0 ? state.height : base.height
  if (state.width > 0 && state.height <= 0) height = width / ratio
  else if (state.height > 0 && state.width <= 0) width = height * ratio

  const scale = Math.min(1, SVG_ANIM_SIZE_MAX / Math.max(width, height))
  width = Math.max(1, Math.round(width * scale))
  height = Math.max(1, Math.round(height * scale))
  return { width, height, viewBox: `0 0 ${base.width} ${base.height}` }
}

function collectAnimations(doc: Document): CollectedAnimation[] {
  const nodes = Array.from(doc.querySelectorAll(ANIMATION_SELECTOR))
  return nodes.map((el) => {
    const tag = el.localName
    if (tag === 'animateMotion') {
      return { spec: null, attributeName: '', transformType: '', isTransform: false }
    }
    const attrs: SvgAnimationAttrs = {
      values: el.getAttribute('values'),
      from: el.getAttribute('from'),
      to: el.getAttribute('to'),
      by: el.getAttribute('by'),
      dur: el.getAttribute('dur'),
      begin: el.getAttribute('begin'),
      repeatCount: el.getAttribute('repeatCount'),
      fill: el.getAttribute('fill'),
      calcMode: el.getAttribute('calcMode'),
      keyTimes: el.getAttribute('keyTimes')
    }
    return {
      spec: buildSvgAnimationSpec(attrs),
      attributeName: (el.getAttribute('attributeName') ?? '').trim(),
      transformType: (el.getAttribute('type') ?? 'translate').trim() || 'translate',
      isTransform: tag === 'animateTransform'
    }
  })
}

/**
 * 把某一时刻烘焙成静态 SVG 文本：写入求值结果、移除全部动画元素。
 * 克隆文档后按相同文档顺序重新取动画元素，逐个对上 spec。
 */
function bakeSvgFrame(
  source: Document,
  animations: CollectedAnimation[],
  timeSec: number,
  size: FrameSize
): string {
  const clone = source.cloneNode(true) as Document
  const nodes = Array.from(clone.querySelectorAll(ANIMATION_SELECTOR))
  // 同一元素上的多个 animateTransform 按文档顺序拼接成一个 transform
  const transformByTarget = new Map<Element, string[]>()

  for (let index = 0; index < animations.length; index += 1) {
    const meta = animations[index]!
    const el = nodes[index]
    if (!el || !meta.spec) continue
    const value = evaluateSvgAnimationValue(meta.spec, timeSec)
    if (value === null) continue
    const target = el.parentElement
    if (!target) continue
    if (meta.isTransform) {
      const list = transformByTarget.get(target) ?? []
      list.push(`${meta.transformType}(${value})`)
      transformByTarget.set(target, list)
      continue
    }
    if (meta.attributeName) target.setAttribute(meta.attributeName, value)
  }
  for (const [target, list] of transformByTarget) {
    target.setAttribute('transform', list.join(' '))
  }

  // 静态化：留下动画元素会让 <img> 从 0 重播，帧就不可复现了
  for (const el of Array.from(clone.querySelectorAll(ANIMATION_SELECTOR))) el.remove()

  const root = clone.documentElement
  root.setAttribute('width', String(size.width))
  root.setAttribute('height', String(size.height))
  if (!root.getAttribute('viewBox')) root.setAttribute('viewBox', size.viewBox)

  let text = new XMLSerializer().serializeToString(clone)
  if (!text.includes('xmlns=')) {
    text = text.replace('<svg', `<svg xmlns="${SVG_NAMESPACE}"`)
  }
  return text
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('renderSvgFrames: svg rasterize failed'))
    image.src = url
  })
}

async function rasterizeFrame(
  ctx: CanvasRenderingContext2D,
  svgText: string,
  size: FrameSize,
  background: SvgAnimState['background']
): Promise<string> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`
  const image = await loadImage(url)
  ctx.clearRect(0, 0, size.width, size.height)
  if (background === 'white' || background === 'black') {
    ctx.fillStyle = background === 'white' ? '#ffffff' : '#000000'
    ctx.fillRect(0, 0, size.width, size.height)
  }
  ctx.drawImage(image, 0, 0, size.width, size.height)
  return ctx.canvas.toDataURL('image/png')
}

/**
 * 逐帧烘焙 SVG 动效。静态 SVG（无可求值动画）只返回一帧，调用方据此不产出 GIF。
 */
export async function renderSvgFrames(input: SvgFrameRenderInput): Promise<SvgFrameRenderResult> {
  const state = normalizeSvgAnimState(input.state)
  const svgText = input.svgText?.trim()
  if (!svgText) throw new Error('renderSvgFrames: empty svg text')

  const doc = parseSvgDocument(svgText)
  const base = resolveBaseSize(doc.documentElement)
  const size = resolveFrameSize(base, state)

  const animations = collectAnimations(doc)
  const specs = animations
    .map((item) => item.spec)
    .filter((spec): spec is SvgAnimationSpec => spec !== null)
  const period = detectSvgAnimationPeriod(specs)
  const animated = period > 0
  const durationSec = animated ? (state.durationSec > 0 ? state.durationSec : period) : 0
  const frameCount = animated ? state.frames : 1
  const fps = durationSec > 0 ? frameCount / durationSec : 0

  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('renderSvgFrames: canvas 2d context unavailable')

  const frameUrls: string[] = []
  for (let index = 0; index < frameCount; index += 1) {
    if (input.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // 取样不含终点：首尾同姿态会让循环看起来卡一帧
    const time = durationSec > 0 ? (index * durationSec) / frameCount : 0
    const baked = bakeSvgFrame(doc, animations, time, size)
    frameUrls.push(await rasterizeFrame(ctx, baked, size, state.background))
  }

  return {
    frameUrls,
    width: size.width,
    height: size.height,
    frameCount,
    durationSec,
    fps,
    animated
  }
}
