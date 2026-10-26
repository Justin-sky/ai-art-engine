/**
 * 漫画页 → PNG 合成与实时所见即所得（WYSIWYG）Canvas 渲染引擎：
 * - 支持分镜格斜切多边形（cornerOffsets）、叠格白边衬底（zIndex Halo）、格内构图取景（Pan/Zoom/Rotate/Flip/Filter）
 * - 支持程序化漫画镜头特效：集中线（focus-lines）、平行速度线（speed-lines）、情绪暗角（vignette）、网点边框（halftone-frame）
 * - 支持 6 类漫画气泡（圆角、椭圆、爆炸呐喊、云朵心理、旁白方框、SFX 拟声词描边大字）
 * - 支持自由尾巴尖端指向（tailTipX/Y）与传统日漫竖排文字（vertical-rl）
 */
import {
  COMIC_BUBBLE_MAX_SCALE,
  COMIC_BUBBLE_MIN_SCALE,
  comicBubblePagePoint,
  comicBubbleTailTipPagePoint,
  comicPanelPolygon,
  comicPanelRects,
  computeComicPanelCropRect,
  normalizeComicPage,
  zOrderedPanels,
  type ComicBubbleShape,
  type ComicPage,
  type ComicPanel,
  type ComicPanelRect
} from '@shared/graph'

export interface ComicPageComposeOptions {
  page: ComicPage
  /** imageUrl → 可加载图片 URL（data:/http(s)/file）；缺省不加载任何图片（画占位） */
  resolveImage?: (imageUrl: string) => Promise<string>
  /** 页面底色兜底参数；缺省跟随 page.backgroundColor，页面也未设置时为透明 */
  background?: string
  panelFill?: string
  borderColor?: string
  bubbleFill?: string
  textColor?: string
}

export interface ComicPageComposeResult {
  dataUrl: string
  width: number
  height: number
  /** 每个分镜格从整页无气泡纯净画布上裁切出的独立 PNG dataUrl（供动态漫逐格运镜直接作为独立无字底图使用） */
  panelDataUrls?: Record<string, string>
  /** 每个台词气泡/拟声词独立渲染裁切出的透明背景 PNG dataUrl（供动态漫按配音开口时机逐个在 overlay 轨弹出） */
  bubbleDataUrls?: Record<string, string>
}

export interface ComicBubbleRenderedBounds {
  panelId: string
  bubbleId: string
  /** 气泡中心点页面像素坐标 */
  anchorX: number
  anchorY: number
  /** 气泡主体外框左上角与宽高（页面像素） */
  x: number
  y: number
  width: number
  height: number
  /** 气泡尾巴尖端页面像素坐标 */
  tailTipX: number
  tailTipY: number
  hasTail: boolean
}

export interface ComicPageRenderedLayout {
  width: number
  height: number
  panelRects: Map<string, ComicPanelRect>
  panelPolygons: Map<
    string,
    [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number }
    ]
  >
  bubbleBounds: Map<string, ComicBubbleRenderedBounds>
}

export function loadComicHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('COMIC_PAGE_SOURCE_LOAD_FAILED'))
    img.src = src
  })
}

/** 确定性伪随机生成器（按字符串哈希做种子，保证集中线/速度线在拖拽时不闪烁） */
function createSeededRandom(seedStr: string): () => number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return () => {
    h += 0x6d2b79f5
    let t = Math.imul(h ^ (h >>> 15), 1 | h)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pathRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  if (radius <= 0.5) {
    ctx.rect(x, y, w, h)
    ctx.closePath()
    return
  }
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function pathPolygon(
  ctx: CanvasRenderingContext2D,
  pts: ReadonlyArray<{ x: number; y: number }>
): void {
  if (!pts.length) return
  ctx.beginPath()
  ctx.moveTo(pts[0]!.x, pts[0]!.y)
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i]!.x, pts[i]!.y)
  }
  ctx.closePath()
}

/** 绘制分镜格路径（支持正交圆角或斜切四边形） */
function pathPanelShape(
  ctx: CanvasRenderingContext2D,
  rect: ComicPanelRect,
  panel: ComicPanel,
  borderRadius: number
): void {
  if (panel.cornerOffsets) {
    const poly = comicPanelPolygon(rect, panel)
    pathPolygon(ctx, poly)
  } else {
    pathRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, borderRadius)
  }
}

/** 绘制支持 Pan / Zoom / Rotation / FlipX / Fit / Filter 的分镜图片 */
function drawPanelImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: ComicPanelRect,
  panel: ComicPanel
): void {
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const fit = panel.imageFit ?? 'cover'
  const baseScale =
    fit === 'contain'
      ? Math.min(rect.width / sw, rect.height / sh)
      : Math.max(rect.width / sw, rect.height / sh)
  const zoom = Math.max(0.5, Math.min(4, panel.imageZoom ?? 1))
  const scale = baseScale * zoom
  const dw = sw * scale
  const dh = sh * scale

  // panX / panY (-1 ~ 1)：在可移动余量基础上支持自由偏移
  const panX = panel.imagePanX ?? 0
  const panY = panel.imagePanY ?? 0
  const slackX = Math.max(rect.width * 0.35, Math.abs(dw - rect.width) * 0.65)
  const slackY = Math.max(rect.height * 0.35, Math.abs(dh - rect.height) * 0.65)
  const cx = rect.x + rect.width / 2 + panX * slackX
  const cy = rect.y + rect.height / 2 + panY * slackY

  ctx.save()
  // 应用漫画滤镜
  const filter = panel.imageFilter ?? 'none'
  if (filter === 'manga-bw') {
    ctx.filter = 'grayscale(100%) contrast(145%) brightness(106%)'
  } else if (filter === 'halftone') {
    ctx.filter = 'grayscale(100%) contrast(128%) brightness(104%)'
  } else if (filter === 'sepia') {
    ctx.filter = 'sepia(82%) contrast(112%) brightness(98%)'
  } else if (filter === 'dramatic') {
    ctx.filter = 'contrast(138%) saturate(80%) brightness(92%)'
  }

  ctx.translate(cx, cy)
  if (panel.imageRotation) {
    ctx.rotate((panel.imageRotation * Math.PI) / 180)
  }
  if (panel.imageFlipX) {
    ctx.scale(-1, 1)
  }
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  ctx.restore()

  // 若开启网点纸滤镜（halftone），叠加程序化漫画网点纹理
  if (filter === 'halftone') {
    drawHalftoneOverlay(ctx, rect, 0.22)
  }
}

/** 叠加日漫网点纸（Screentone Dots）效果 */
function drawHalftoneOverlay(
  ctx: CanvasRenderingContext2D,
  rect: ComicPanelRect,
  opacity: number
): void {
  ctx.save()
  ctx.fillStyle = `rgba(15, 15, 20, ${opacity})`
  const step = Math.max(6, Math.round(Math.min(rect.width, rect.height) * 0.018))
  const r = Math.max(1.2, step * 0.24)
  for (let y = rect.y; y < rect.y + rect.height; y += step) {
    const rowIdx = Math.round((y - rect.y) / step)
    const offsetX = rowIdx % 2 === 1 ? step * 0.5 : 0
    for (let x = rect.x + offsetX; x < rect.x + rect.width; x += step) {
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** 绘制分镜格漫画镜头特效（集中线 / 平行速度线 / 暗角 / 网点边框） */
function drawPanelEffect(
  ctx: CanvasRenderingContext2D,
  rect: ComicPanelRect,
  panel: ComicPanel
): void {
  const type = panel.effectType
  if (!type || type === 'none') return
  const intensity = Math.max(0.1, Math.min(1, panel.effectIntensity ?? 0.6))
  const color = panel.effectColor?.trim() || '#111111'
  const rand = createSeededRandom(`${panel.id}:${type}`)

  ctx.save()
  if (type === 'focus-lines') {
    // 集中线：从四周向焦点放射锥形黑/白锋线，中间留出椭圆安全区
    const fx = rect.x + (panel.effectFocusX ?? 0.5) * rect.width
    const fy = rect.y + (panel.effectFocusY ?? 0.5) * rect.height
    const maxR = Math.hypot(rect.width, rect.height) * 0.85
    const innerR = Math.min(rect.width, rect.height) * (0.46 - intensity * 0.22)
    const count = Math.round(64 + intensity * 96)
    ctx.fillStyle = color
    for (let i = 0; i < count; i++) {
      const baseAngle = (i / count) * Math.PI * 2
      const angle = baseAngle + (rand() - 0.5) * (Math.PI / count)
      const r0 = innerR * (0.82 + rand() * 0.42)
      const halfSpread = (((0.6 + rand() * 1.4) * Math.PI) / 180) * (0.65 + intensity * 0.7)
      const xTip = fx + Math.cos(angle) * r0
      const yTip = fy + Math.sin(angle) * r0
      const x1 = fx + Math.cos(angle - halfSpread) * maxR
      const y1 = fy + Math.sin(angle - halfSpread) * maxR
      const x2 = fx + Math.cos(angle + halfSpread) * maxR
      const y2 = fy + Math.sin(angle + halfSpread) * maxR
      ctx.beginPath()
      ctx.moveTo(xTip, yTip)
      ctx.lineTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.closePath()
      ctx.fill()
    }
  } else if (type === 'speed-lines') {
    // 平行速度线：沿指定角度贯穿分镜的疾驰锋线
    const deg = panel.effectAngle ?? 0
    const rad = (deg * Math.PI) / 180
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const diag = Math.hypot(rect.width, rect.height)
    const count = Math.round(28 + intensity * 60)
    ctx.translate(cx, cy)
    ctx.rotate(rad)
    ctx.fillStyle = color
    for (let i = 0; i < count; i++) {
      const yPos = (rand() - 0.5) * diag
      // 越靠近边缘线条越密集/长，中间稍留透气感
      const edgeWeight = Math.abs(yPos) / (diag * 0.5)
      if (rand() > edgeWeight + intensity * 0.45) continue
      const len = diag * (0.35 + rand() * 0.65)
      const startX = (rand() - 0.5) * diag * 0.5 - len / 2
      const thickness = (0.8 + rand() * 2.6) * (0.6 + intensity * 0.6)
      ctx.beginPath()
      ctx.moveTo(startX, yPos)
      ctx.lineTo(startX + len * 0.5, yPos - thickness / 2)
      ctx.lineTo(startX + len, yPos)
      ctx.lineTo(startX + len * 0.5, yPos + thickness / 2)
      ctx.closePath()
      ctx.fill()
    }
  } else if (type === 'vignette') {
    const cx = rect.x + rect.width / 2
    const cy = rect.y + rect.height / 2
    const rOuter = Math.hypot(rect.width, rect.height) * 0.55
    const rInner = Math.min(rect.width, rect.height) * (0.35 - intensity * 0.15)
    const grad = ctx.createRadialGradient(cx, cy, Math.max(4, rInner), cx, cy, rOuter)
    grad.addColorStop(0, 'rgba(0,0,0,0)')
    grad.addColorStop(
      1,
      color === '#ffffff'
        ? `rgba(255,255,255,${intensity * 0.85})`
        : `rgba(0,0,0,${intensity * 0.78})`
    )
    ctx.fillStyle = grad
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
  } else if (type === 'halftone-frame') {
    drawHalftoneOverlay(ctx, rect, intensity * 0.35)
  }
  ctx.restore()
}

/** 按字符折行（横排） */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    for (const ch of Array.from(paragraph)) {
      if (line && ctx.measureText(line + ch).width > maxWidth) {
        lines.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/** 竖排分列（从右向左逐列排布，每列最大字数 maxCharsPerCol） */
function wrapVerticalColumns(text: string, maxCharsPerCol: number): string[][] {
  const cols: string[][] = []
  const limit = Math.max(2, maxCharsPerCol)
  for (const paragraph of text.split('\n')) {
    const chars = Array.from(paragraph)
    if (!chars.length) continue
    for (let i = 0; i < chars.length; i += limit) {
      cols.push(chars.slice(i, i + limit))
    }
  }
  return cols.length ? cols : [['']]
}

function truncateToFit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let out = ''
  for (const ch of Array.from(text)) {
    if (ctx.measureText(out + ch + '…').width > maxWidth) break
    out += ch
  }
  return `${out}…`
}

/** 绘制气泡主体与指向角色嘴部的尾巴（先描边底层再填充顶层，彻底消除尾巴与气泡接缝黑线！） */
function drawBubbleBodyAndTail(
  ctx: CanvasRenderingContext2D,
  shape: ComicBubbleShape,
  x: number,
  y: number,
  w: number,
  h: number,
  cornerRadius: number,
  tailTip: { x: number; y: number } | null,
  fill: string,
  stroke: string,
  strokeWidth: number
): void {
  const cx = x + w / 2
  const cy = y + h / 2

  const traceMainShape = (): void => {
    if (shape === 'oval') {
      ctx.beginPath()
      ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.closePath()
    } else if (shape === 'shout') {
      // 爆炸呐喊框：放射锯齿尖刺椭圆
      const spikes = 20
      const rx = w / 2
      const ry = h / 2
      ctx.beginPath()
      for (let i = 0; i < spikes * 2; i++) {
        const angle = (i / (spikes * 2)) * Math.PI * 2
        const isOuter = i % 2 === 0
        const mult = isOuter ? 1.18 : 0.92
        const px = cx + Math.cos(angle) * rx * mult
        const py = cy + Math.sin(angle) * ry * mult
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
    } else if (shape === 'thought') {
      // 云朵心理框：扇贝波浪边椭圆
      const bumps = 14
      const rx = w / 2
      const ry = h / 2
      ctx.beginPath()
      for (let i = 0; i < bumps; i++) {
        const a1 = (i / bumps) * Math.PI * 2
        const a2 = ((i + 1) / bumps) * Math.PI * 2
        const aMid = (a1 + a2) / 2
        const x1 = cx + Math.cos(a1) * rx * 0.92
        const y1 = cy + Math.sin(a1) * ry * 0.92
        const xCtrl = cx + Math.cos(aMid) * rx * 1.16
        const yCtrl = cy + Math.sin(aMid) * ry * 1.16
        const x2 = cx + Math.cos(a2) * rx * 0.92
        const y2 = cy + Math.sin(a2) * ry * 0.92
        if (i === 0) ctx.moveTo(x1, y1)
        ctx.quadraticCurveTo(xCtrl, yCtrl, x2, y2)
      }
      ctx.closePath()
    } else if (shape === 'narration') {
      pathRoundRect(ctx, x, y, w, h, 0)
    } else {
      pathRoundRect(ctx, x, y, w, h, cornerRadius)
    }
  }

  const traceTail = (): void => {
    if (!tailTip || shape === 'narration' || shape === 'sfx' || shape === 'thought') return
    const dx = tailTip.x - cx
    const dy = tailTip.y - cy
    const dist = Math.hypot(dx, dy)
    if (dist < 4) return
    const nx = -dy / dist
    const ny = dx / dist
    const baseHalfW = Math.max(6, Math.min(w, h) * 0.14)
    // 尾巴根部插在气泡中心偏外侧，保证完全被气泡主体遮住接缝
    const rootX = cx + (dx / dist) * Math.min(w, h) * 0.22
    const rootY = cy + (dy / dist) * Math.min(w, h) * 0.22
    ctx.beginPath()
    ctx.moveTo(rootX + nx * baseHalfW, rootY + ny * baseHalfW)
    ctx.lineTo(tailTip.x, tailTip.y)
    ctx.lineTo(rootX - nx * baseHalfW, rootY - ny * baseHalfW)
    ctx.closePath()
  }

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // 第 1 步：先画尾巴与气泡主体的外描边（两遍 stroke 后再统一 fill，接口处无缝融合！）
  if (strokeWidth > 0) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = strokeWidth * 2
    traceTail()
    ctx.stroke()
    traceMainShape()
    ctx.stroke()
  }

  // 第 2 步：填充尾巴与主体内部，遮盖内部重合描边线
  ctx.fillStyle = fill
  traceTail()
  ctx.fill()
  traceMainShape()
  ctx.fill()

  // 云朵心理框：画 3 个递减的小云泡指向角色
  if (shape === 'thought' && tailTip) {
    const startX = cx + (tailTip.x - cx) * 0.55
    const startY = cy + (tailTip.y - cy) * 0.55
    const radii = [
      Math.max(4, Math.min(w, h) * 0.085),
      Math.max(3, Math.min(w, h) * 0.058),
      Math.max(2, Math.min(w, h) * 0.036)
    ]
    const ts = [0, 0.5, 0.9]
    for (let i = 0; i < 3; i++) {
      const bx = startX + (tailTip.x - startX) * ts[i]!
      const by = startY + (tailTip.y - startY) * ts[i]!
      ctx.beginPath()
      ctx.arc(bx, by, radii[i]!, 0, Math.PI * 2)
      if (strokeWidth > 0) {
        ctx.strokeStyle = stroke
        ctx.lineWidth = strokeWidth * 1.6
        ctx.stroke()
      }
      ctx.fillStyle = fill
      ctx.fill()
    }
  }

  // 旁白框：追加内层细线框营造漫画书旁白质感
  if (shape === 'narration' && strokeWidth > 0 && w > 24 && h > 24) {
    ctx.strokeStyle = stroke
    ctx.lineWidth = Math.max(1, strokeWidth * 0.5)
    ctx.strokeRect(x + 4, y + 4, w - 8, h - 8)
  }

  ctx.restore()
}

/**
 * 同步将漫画页渲染到目标 Canvas，并返回所有分镜格与气泡的精确像素包围盒（供交互画布 1:1 命中与叠加控制框）。
 */
export function renderComicPageToCanvas(
  canvas: HTMLCanvasElement,
  rawPage: ComicPage,
  images: ReadonlyMap<string, HTMLImageElement | null>,
  options?: Omit<ComicPageComposeOptions, 'page' | 'resolveImage'>
): ComicPageRenderedLayout {
  const page = normalizeComicPage(rawPage)
  const background = page.backgroundColor?.trim() || options?.background?.trim() || 'transparent'
  const panelFill = options?.panelFill ?? '#f2f2f2'
  const globalBorderColor = page.borderColor?.trim() || options?.borderColor || '#d8d8d8'
  const globalBorderWidth = page.borderWidth ?? 1
  const globalBorderRadius = page.borderRadius ?? 6
  const defaultBubbleFill = options?.bubbleFill ?? '#ffffff'
  const defaultTextColor = options?.textColor ?? '#1a1a1a'

  const width = Math.max(1, Math.round(page.width))
  const height = Math.max(1, Math.round(page.height))
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('COMIC_PAGE_CANVAS_UNAVAILABLE')

  if (background === 'transparent') {
    ctx.clearRect(0, 0, width, height)
  } else {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }

  const rects = comicPanelRects(page)
  const panelPolygons = new Map<
    string,
    [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number }
    ]
  >()
  const bubbleBounds = new Map<string, ComicBubbleRenderedBounds>()

  const fontPx = Math.max(10, Math.round(width * 0.016))
  const speakerPx = Math.max(9, Math.round(fontPx * 0.8))
  const lineHeight = Math.round(fontPx * 1.45)
  const padX = Math.round(fontPx * 0.75)
  const padY = Math.round(fontPx * 0.55)
  const maxBubbleWidth = Math.max(60, width * 0.3)

  const orderedPanels = zOrderedPanels(page)

  // 第一阶段：按 zIndex 顺序绘制所有分镜格（含叠格留白 Halo、图片构图、漫画特效、框线、旁白条）
  for (const panel of orderedPanels) {
    const rect = rects.get(panel.id)
    if (!rect) continue
    panelPolygons.set(panel.id, comicPanelPolygon(rect, panel))

    const pBorderWidth = panel.borderWidth ?? globalBorderWidth
    const pBorderColor = panel.borderColor?.trim() || globalBorderColor

    ctx.save()
    // 若为上层叠格（zIndex > 0），先画一圈白色漫画留白衬边（Halo）与微投影，实现正宗画中画破框感
    if ((panel.zIndex ?? 0) > 0) {
      ctx.save()
      pathPanelShape(ctx, rect, panel, globalBorderRadius)
      ctx.shadowColor = 'rgba(0, 0, 0, 0.22)'
      ctx.shadowBlur = 14
      ctx.strokeStyle = page.backgroundColor?.trim() || '#ffffff'
      ctx.lineWidth = Math.max(10, pBorderWidth * 3.5)
      ctx.lineJoin = 'round'
      ctx.stroke()
      ctx.restore()
    }

    // 填充底色并裁剪分镜多边形
    pathPanelShape(ctx, rect, panel, globalBorderRadius)
    ctx.fillStyle = panel.backgroundColor?.trim() || panelFill
    ctx.fill()
    ctx.clip()

    const img = panel.imageUrl ? (images.get(panel.imageUrl) ?? null) : null
    if (img && img.naturalWidth > 0) {
      drawPanelImage(ctx, img, rect, panel)
    } else if (panel.title) {
      ctx.fillStyle = '#909090'
      ctx.font = `600 ${fontPx}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(
        panel.title,
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
        rect.width - padX * 2
      )
    }

    // 格内漫画镜头氛围特效（速度线/集中线/暗角）
    drawPanelEffect(ctx, rect, panel)

    // 分镜底部旁白字幕条（caption）
    if (panel.caption?.trim()) {
      const capFont = Math.max(11, Math.round(fontPx * 0.92))
      const capPad = Math.round(capFont * 0.55)
      ctx.font = `600 ${capFont}px sans-serif`
      const capLines = wrapText(ctx, panel.caption.trim(), rect.width - capPad * 2)
      const capH = capLines.length * Math.round(capFont * 1.35) + capPad * 1.6
      const capY = rect.y + rect.height - capH
      ctx.fillStyle = 'rgba(15, 17, 22, 0.82)'
      ctx.fillRect(rect.x, capY, rect.width, capH)
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      let ty = capY + capPad * 0.8
      for (const line of capLines) {
        ctx.fillText(line, rect.x + capPad, ty)
        ty += Math.round(capFont * 1.35)
      }
    }
    ctx.restore()

    // 在 clip 之外绘制锐利的分镜框线，防止描边被自身裁掉一半
    if (pBorderWidth > 0) {
      ctx.save()
      pathPanelShape(ctx, rect, panel, globalBorderRadius)
      ctx.strokeStyle = pBorderColor
      ctx.lineWidth = pBorderWidth
      ctx.lineJoin = 'miter'
      ctx.stroke()
      ctx.restore()
    }
  }

  // 第二阶段：绘制所有台词气泡与 SFX 拟声词（浮在分镜格之上，支持跨格破框显示）
  for (const panel of orderedPanels) {
    const rect = rects.get(panel.id)
    if (!rect) continue

    for (const bubble of panel.bubbles) {
      const anchor = comicBubblePagePoint(page, panel.id, bubble.id)
      if (!anchor) continue

      const s = Math.min(
        COMIC_BUBBLE_MAX_SCALE,
        Math.max(COMIC_BUBBLE_MIN_SCALE, bubble.scale ?? 1)
      )
      const shape: ComicBubbleShape = bubble.shape ?? 'rounded'
      const isVertical = bubble.writingMode === 'vertical-rl'
      const weight =
        bubble.fontWeight === 'black'
          ? '900'
          : bubble.fontWeight === 'bold' || shape === 'shout' || shape === 'sfx'
            ? '700'
            : '500'

      const bFontPx = fontPx * s * (shape === 'sfx' ? 1.45 : 1)
      const bSpeakerPx = speakerPx * s
      const bLineHeight = lineHeight * s * (shape === 'sfx' ? 1.25 : 1)
      const bPadX =
        padX * s * (shape === 'oval' || shape === 'shout' || shape === 'thought' ? 1.25 : 1)
      const bPadY =
        padY * s * (shape === 'oval' || shape === 'shout' || shape === 'thought' ? 1.2 : 1)
      const bMaxWidth = maxBubbleWidth * s
      const bInner = Math.max(24, bMaxWidth - bPadX * 2)

      const fill = bubble.backgroundColor?.trim() || defaultBubbleFill
      const stroke =
        bubble.borderColor?.trim() ||
        (page.borderColor?.trim() ? page.borderColor.trim() : (options?.borderColor ?? '#222222'))
      const textColor = bubble.textColor?.trim() || (shape === 'sfx' ? '#e11d48' : defaultTextColor)
      const strokeW =
        bubble.strokeWidth !== undefined
          ? bubble.strokeWidth
          : page.borderWidth !== undefined
            ? Math.max(1.5, page.borderWidth * 0.65)
            : 1.5

      ctx.save()
      ctx.font = `${weight} ${bFontPx}px sans-serif`

      let bodyW = 0
      let bodyH = 0
      let lines: string[] = []
      let verticalCols: string[][] = []
      let speakerText = ''
      let speakerH = 0

      const speaker = bubble.speaker?.trim() || ''
      if (isVertical) {
        const maxCharsPerCol = Math.max(3, Math.min(12, Math.floor((rect.height * 0.42) / bFontPx)))
        verticalCols = wrapVerticalColumns(bubble.text, maxCharsPerCol)
        const maxColLen = Math.max(1, ...verticalCols.map((c) => c.length))
        const colAdvance = bFontPx * 1.32
        speakerText = speaker
        const speakerColW = speakerText ? bSpeakerPx * 1.35 + 4 : 0
        bodyW = Math.max(bFontPx * 2.2, verticalCols.length * colAdvance + speakerColW + bPadX * 2)
        bodyH = Math.max(bFontPx * 2.4, maxColLen * (bFontPx * 1.18) + bPadY * 2)
      } else {
        lines = wrapText(ctx, bubble.text, bInner)
        ctx.font = `600 ${bSpeakerPx}px sans-serif`
        speakerText = speaker ? truncateToFit(ctx, speaker, bInner) : ''
        ctx.font = `${weight} ${bFontPx}px sans-serif`
        const lineW = Math.max(0, ...lines.map((line) => ctx.measureText(line).width))
        const speakerW = speakerText ? ctx.measureText(speakerText).width : 0
        bodyW = Math.min(bMaxWidth, Math.max(lineW, speakerW) + bPadX * 2)
        speakerH = speakerText ? bSpeakerPx + 4 : 0
        bodyH = bPadY * 2 + speakerH + lines.length * bLineHeight
      }

      const x = anchor.x - bodyW / 2
      const y = anchor.y - bodyH / 2

      // 计算气泡尾巴尖端坐标
      const rawTip = comicBubbleTailTipPagePoint(page, panel.id, bubble.id)
      const hasCustomTip = bubble.tailTipX !== undefined && bubble.tailTipY !== undefined
      let tipX = rawTip?.x ?? anchor.x
      let tipY = rawTip?.y ?? anchor.y + bodyH / 2 + 12
      if (!hasCustomTip) {
        const tailSize = Math.max(8, Math.round(bFontPx * 0.55))
        const onLeft = bubble.tail === 'tl' || bubble.tail === 'bl'
        const pointingUp = bubble.tail === 'tl' || bubble.tail === 'tr'
        tipX = onLeft
          ? x + Math.min(bodyW * 0.28, tailSize + 10)
          : x + bodyW - Math.min(bodyW * 0.28, tailSize + 10)
        tipY = pointingUp ? y - tailSize : y + bodyH + tailSize
      }

      const hasTail = shape !== 'narration' && shape !== 'sfx'
      bubbleBounds.set(bubble.id, {
        panelId: panel.id,
        bubbleId: bubble.id,
        anchorX: anchor.x,
        anchorY: anchor.y,
        x,
        y,
        width: bodyW,
        height: bodyH,
        tailTipX: tipX,
        tailTipY: tipY,
        hasTail
      })

      if (bubble.rotation) {
        ctx.translate(anchor.x, anchor.y)
        ctx.rotate((bubble.rotation * Math.PI) / 180)
        ctx.translate(-anchor.x, -anchor.y)
      }

      if (shape !== 'sfx') {
        drawBubbleBodyAndTail(
          ctx,
          shape,
          x,
          y,
          bodyW,
          bodyH,
          Math.round(bFontPx * 0.45),
          hasTail ? { x: tipX, y: tipY } : null,
          fill,
          stroke,
          strokeW
        )
      }

      // 绘制文字（支持横排、竖排及 SFX 粗描边特效字）
      if (isVertical) {
        const colAdvance = bFontPx * 1.32
        const charStep = bFontPx * 1.18
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'
        // 从右向左排布各列
        let cxCol = x + bodyW - bPadX - bFontPx * 0.5
        if (speakerText) {
          ctx.font = `700 ${bSpeakerPx}px sans-serif`
          ctx.fillStyle = stroke === '#d8d8d8' ? '#4f46e5' : textColor
          let sy = y + bPadY
          for (const ch of Array.from(speakerText).slice(0, 6)) {
            ctx.fillText(ch, cxCol, sy)
            sy += bSpeakerPx * 1.15
          }
          cxCol -= bSpeakerPx * 1.35 + 4
        }
        ctx.font = `${weight} ${bFontPx}px sans-serif`
        for (const col of verticalCols) {
          let cyChar = y + bPadY
          for (const ch of col) {
            if (shape === 'sfx') {
              ctx.lineJoin = 'round'
              ctx.strokeStyle = fill || '#ffffff'
              ctx.lineWidth = Math.max(4, strokeW * 3.2)
              ctx.strokeText(ch, cxCol, cyChar)
              ctx.strokeStyle = stroke || '#111111'
              ctx.lineWidth = Math.max(2, strokeW * 1.4)
              ctx.strokeText(ch, cxCol, cyChar)
            }
            ctx.fillStyle = textColor
            ctx.fillText(ch, cxCol, cyChar)
            cyChar += charStep
          }
          cxCol -= colAdvance
        }
      } else {
        ctx.textAlign =
          shape === 'oval' || shape === 'shout' || shape === 'thought' ? 'center' : 'left'
        ctx.textBaseline = 'top'
        const tx =
          shape === 'oval' || shape === 'shout' || shape === 'thought' ? anchor.x : x + bPadX
        let cy = y + bPadY
        if (speakerText) {
          ctx.font = `700 ${bSpeakerPx}px sans-serif`
          ctx.fillStyle = '#4f46e5'
          ctx.fillText(speakerText, tx, cy)
          cy += speakerH
        }
        ctx.font = `${weight} ${bFontPx}px sans-serif`
        for (const line of lines) {
          if (shape === 'sfx') {
            ctx.lineJoin = 'round'
            ctx.strokeStyle = fill || '#ffffff'
            ctx.lineWidth = Math.max(4, strokeW * 3.2)
            ctx.strokeText(line, tx, cy)
            ctx.strokeStyle = stroke || '#111111'
            ctx.lineWidth = Math.max(2, strokeW * 1.4)
            ctx.strokeText(line, tx, cy)
          }
          ctx.fillStyle = textColor
          ctx.fillText(line, tx, cy)
          cy += bLineHeight
        }
      }
      ctx.restore()
    }
  }

  // 页面左上角标题徽章
  if (page.title?.trim()) {
    ctx.save()
    const titleFont = Math.max(12, Math.round(fontPx * 0.95))
    ctx.font = `700 ${titleFont}px sans-serif`
    const tw = ctx.measureText(page.title.trim()).width
    const tx = Math.max(10, page.padding ? page.padding : 10)
    const ty = Math.max(8, page.padding ? Math.max(6, page.padding - titleFont - 10) : 8)
    pathRoundRect(ctx, tx, ty, tw + 16, titleFont + 8, 4)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)'
    ctx.fill()
    ctx.fillStyle = '#111111'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(page.title.trim(), tx + 8, ty + (titleFont + 8) / 2)
    ctx.restore()
  }

  return { width, height, panelRects: rects, panelPolygons, bubbleBounds }
}

export async function composeComicPageImage(
  input: ComicPageComposeOptions
): Promise<ComicPageComposeResult> {
  const page = normalizeComicPage(input.page)
  const width = Math.max(1, Math.round(page.width))
  const height = Math.max(1, Math.round(page.height))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  // 预加载图片（并发，失败则画占位）
  const images = new Map<string, HTMLImageElement | null>()
  if (input.resolveImage) {
    await Promise.all(
      page.panels.map(async (panel) => {
        if (!panel.imageUrl || images.has(panel.imageUrl)) return
        images.set(panel.imageUrl, null)
        try {
          const src = await input.resolveImage!(panel.imageUrl)
          if (src) images.set(panel.imageUrl, await loadComicHtmlImage(src))
        } catch {
          /* 加载失败保持 null → 占位 */
        }
      })
    )
  }

  // 1) 先渲染无气泡纯净分镜页，切出每个分镜格的纯净无字底图（panelDataUrls），避免动态漫镜头一开始就出现所有气泡
  const cleanPage: ComicPage = {
    ...page,
    title: undefined,
    panels: page.panels.map((p) => ({ ...p, bubbles: [] }))
  }
  renderComicPageToCanvas(canvas, cleanPage, images, {
    background: input.background,
    panelFill: input.panelFill,
    borderColor: input.borderColor,
    bubbleFill: input.bubbleFill,
    textColor: input.textColor
  })

  const panelDataUrls: Record<string, string> = {}
  for (const panel of page.panels) {
    const crop = computeComicPanelCropRect(page, panel.id, 0.025)
    if (!crop) continue
    const sx = Math.max(0, Math.round(crop.cropX * width))
    const sy = Math.max(0, Math.round(crop.cropY * height))
    const sw = Math.max(2, Math.min(width - sx, Math.round(crop.cropWidth * width)))
    const sh = Math.max(2, Math.min(height - sy, Math.round(crop.cropHeight * height)))
    try {
      const pCanvas = document.createElement('canvas')
      pCanvas.width = sw
      pCanvas.height = sh
      const pCtx = pCanvas.getContext('2d')
      if (pCtx) {
        pCtx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
        const pUrl = pCanvas.toDataURL('image/png')
        if (pUrl) panelDataUrls[panel.id] = pUrl
      }
    } catch {
      /* ignore single panel slice error */
    }
  }

  // 2) 为每个气泡独立渲染透明背景图层并紧密裁切（bubbleDataUrls），供动态漫按角色开口时机逐个弹出
  const bubbleDataUrls: Record<string, string> = {}
  const emptyImages = new Map<string, HTMLImageElement | null>()
  for (const panel of page.panels) {
    for (const bubble of panel.bubbles) {
      if (!bubble.text?.trim()) continue
      try {
        const singleBubblePage: ComicPage = {
          ...page,
          title: undefined,
          backgroundColor: 'transparent',
          borderWidth: 0,
          panels: [
            {
              ...panel,
              imageUrl: undefined,
              backgroundColor: 'transparent',
              borderWidth: 0,
              effectType: 'none',
              caption: undefined,
              bubbles: [bubble]
            }
          ]
        }
        const bLayout = renderComicPageToCanvas(canvas, singleBubblePage, emptyImages, {
          background: 'transparent',
          panelFill: 'transparent',
          borderColor: input.borderColor,
          bubbleFill: input.bubbleFill,
          textColor: input.textColor
        })
        const bounds = bLayout.bubbleBounds.get(bubble.id)
        if (!bounds) continue
        const pad = Math.max(24, Math.round(Math.max(bounds.width, bounds.height) * 0.26))
        const minX = Math.min(bounds.x, bounds.hasTail ? bounds.tailTipX : bounds.x)
        const minY = Math.min(bounds.y, bounds.hasTail ? bounds.tailTipY : bounds.y)
        const maxX = Math.max(
          bounds.x + bounds.width,
          bounds.hasTail ? bounds.tailTipX : bounds.x + bounds.width
        )
        const maxY = Math.max(
          bounds.y + bounds.height,
          bounds.hasTail ? bounds.tailTipY : bounds.y + bounds.height
        )
        const bx = Math.max(0, Math.floor(minX - pad))
        const by = Math.max(0, Math.floor(minY - pad))
        const bw = Math.max(8, Math.min(width - bx, Math.ceil(maxX - minX + pad * 2)))
        const bh = Math.max(8, Math.min(height - by, Math.ceil(maxY - minY + pad * 2)))
        const bCanvas = document.createElement('canvas')
        bCanvas.width = bw
        bCanvas.height = bh
        const bCtx = bCanvas.getContext('2d')
        if (bCtx) {
          bCtx.drawImage(canvas, bx, by, bw, bh, 0, 0, bw, bh)
          const bUrl = bCanvas.toDataURL('image/png')
          if (bUrl) bubbleDataUrls[bubble.id] = bUrl
        }
      } catch {
        /* ignore single bubble slice error */
      }
    }
  }

  // 3) 最终渲染包含全部面板、特效、台词气泡与标题徽章的完整漫画页（用于开场全景镜头与整页导出）
  renderComicPageToCanvas(canvas, page, images, {
    background: input.background,
    panelFill: input.panelFill,
    borderColor: input.borderColor,
    bubbleFill: input.bubbleFill,
    textColor: input.textColor
  })

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    panelDataUrls,
    bubbleDataUrls
  }
}
