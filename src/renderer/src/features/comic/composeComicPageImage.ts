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
  normalizeComicPage,
  readingOrderPanels,
  zOrderedPanels,
  type ComicBubbleShape,
  type ComicPage,
  type ComicPanel,
  type ComicPanelRect,
  type ComicSpeechBubble
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
  /** 是否在气泡顶部绘制说话人角色名标签（默认 false，靠气泡尾巴区分说话人，保持出版漫纯正版面） */
  showSpeakerLabel?: boolean
  /** 是否跳过前景人物立绘破框叠加（用于切取 2.5D 动态漫纯净背景底图） */
  skipForegroundPopOut?: boolean
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

  // panX / panY (-1 ~ 1)：在可移动余量基础上支持自由偏移；
  // 当纵向发生 cover 裁切且未手动设置 imagePanY 时，默认向上三分之一人像黄金位微偏（+16% 余量），防止切掉角色额头与眼睛
  const panX = panel.imagePanX ?? 0
  const hasExplicitPanY = panel.imagePanY !== undefined && Math.abs(panel.imagePanY) > 1e-4
  const panY = panel.imagePanY ?? 0
  const slackX = Math.max(rect.width * 0.35, Math.abs(dw - rect.width) * 0.65)
  const slackY = Math.max(rect.height * 0.35, Math.abs(dh - rect.height) * 0.65)
  const portraitBiasY =
    !hasExplicitPanY && fit === 'cover' && dh > rect.height * 1.05 ? (dh - rect.height) * 0.16 : 0
  const cx = rect.x + rect.width / 2 + panX * slackX
  const cy = rect.y + rect.height / 2 + portraitBiasY + panY * slackY

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
    // 中心镂空渐变气氛网点边框：中心人物区域透亮无遮挡，越往四周边缘网点越密集粗大
    const cx = rect.x + (panel.effectFocusX ?? 0.5) * rect.width
    const cy = rect.y + (panel.effectFocusY ?? 0.5) * rect.height
    const rx = Math.max(1, rect.width * 0.5)
    const ry = Math.max(1, rect.height * 0.5)
    const innerClear = Math.max(0.24, 0.52 - intensity * 0.2)
    const step = Math.max(6, Math.round(Math.min(rect.width, rect.height) * 0.018))
    const maxDotR = step * (0.34 + intensity * 0.22)
    ctx.fillStyle = color === '#ffffff' ? 'rgba(255,255,255,0.78)' : 'rgba(15,15,20,0.72)'
    for (let y = rect.y; y < rect.y + rect.height; y += step) {
      const rowIdx = Math.round((y - rect.y) / step)
      const offsetX = rowIdx % 2 === 1 ? step * 0.5 : 0
      for (let x = rect.x + offsetX; x < rect.x + rect.width; x += step) {
        const distNorm = Math.hypot((x - cx) / rx, (y - cy) / ry)
        if (distNorm <= innerClear) continue
        const t = Math.min(1, (distNorm - innerClear) / Math.max(0.15, 1.18 - innerClear))
        const r = maxDotR * (t * t)
        if (r < 0.45) continue
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  ctx.restore()
}

/** 中日文漫画排版避头点（禁止出现在行首/列首的标点）与避尾点（禁止出现在行尾/列尾的前置括号引号） */
const CJK_NO_LINE_START = new Set([
  '！',
  '？',
  '。',
  '，',
  '、',
  '；',
  '：',
  '”',
  '’',
  '）',
  '」',
  '』',
  '】',
  '》',
  '〉',
  '…',
  '—',
  '～',
  '·',
  '!',
  '?',
  '.',
  ',',
  ':',
  ';',
  ')',
  ']',
  '}'
])
const CJK_NO_LINE_END = new Set(['“', '‘', '（', '「', '『', '【', '《', '〈', '(', '[', '{'])

function applyKinsokuToTokens(chars: string[]): string[] {
  const tokens: string[] = []
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!
    const next = chars[i + 1]
    // 成对破折号 ——、省略号 ……、双感叹/问号 ！！ ？！ 合并为不可拆分的排版原子
    if (
      (ch === '—' && next === '—') ||
      (ch === '…' && next === '…') ||
      ((ch === '！' || ch === '？' || ch === '!' || ch === '?') &&
        (next === '！' || next === '？' || next === '!' || next === '?'))
    ) {
      tokens.push(ch + next)
      i++
      continue
    }
    tokens.push(ch)
  }
  // 将避尾点与其后一个 token 绑定，将避头点与其前一个 token 绑定（当行长允许时）
  const merged: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]!
    const firstCh = tk[0]!
    if (
      CJK_NO_LINE_START.has(firstCh) &&
      merged.length > 0 &&
      merged[merged.length - 1]!.length <= 3
    ) {
      merged[merged.length - 1] += tk
    } else if (CJK_NO_LINE_END.has(tk[tk.length - 1]!) && i + 1 < tokens.length) {
      tokens[i + 1] = tk + tokens[i + 1]!
    } else {
      merged.push(tk)
    }
  }
  return merged
}

/** 按字符折行（横排，内置中日文避头尾法则 + 椭圆气泡菱形均衡折行） */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  balance = false
): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    const rawChars = Array.from(paragraph)
    if (!rawChars.length) continue
    const totalW = ctx.measureText(paragraph).width
    // 若开启椭圆气泡均衡折行且需要拆成多行，把单行目标宽度收敛为均分宽度，消除“首行塞满、末行孤字”
    const estLines = Math.max(1, Math.ceil(totalW / Math.max(1, maxWidth)))
    const targetMaxW =
      balance && estLines >= 2
        ? Math.min(maxWidth, Math.max(maxWidth * 0.58, (totalW / estLines) * 1.14))
        : maxWidth
    const tokens = applyKinsokuToTokens(rawChars)
    let line = ''
    for (const tk of tokens) {
      if (line && ctx.measureText(line + tk).width > targetMaxW) {
        lines.push(line)
        line = tk
      } else {
        line += tk
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/** 竖排分列（从右向左逐列排布，内置避头尾与列长均衡） */
function wrapVerticalColumns(text: string, maxCharsPerCol: number): string[][] {
  const cols: string[][] = []
  const baseLimit = Math.max(2, maxCharsPerCol)
  for (const paragraph of text.split('\n')) {
    const chars = Array.from(paragraph)
    if (!chars.length) continue
    const numCols = Math.max(1, Math.ceil(chars.length / baseLimit))
    const balancedLimit =
      numCols >= 2 ? Math.min(baseLimit, Math.max(3, Math.ceil(chars.length / numCols))) : baseLimit
    let idx = 0
    while (idx < chars.length) {
      let end = Math.min(chars.length, idx + balancedLimit)
      // 避头点：若下一列首字是禁则标点且只剩 1~2 个标点，直接吸入当前列末尾
      while (
        end < chars.length &&
        CJK_NO_LINE_START.has(chars[end]!) &&
        end - idx < baseLimit + 2
      ) {
        end++
      }
      // 避尾点：若当前列末字是前置括号/引号，提前一字换列
      if (end < chars.length && end - idx > 1 && CJK_NO_LINE_END.has(chars[end - 1]!)) {
        end--
      }
      cols.push(chars.slice(idx, end))
      idx = end
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

/** 绘制气泡主体、连体双气泡桥接颈与指向角色嘴部的尾巴（先描边底层再填充顶层，彻底消除接缝黑线！） */
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
  strokeWidth: number,
  bubbleId = 'b',
  bridgeFrom: {
    x: number
    y: number
    w: number
    h: number
    shape: ComicBubbleShape
    cornerRadius: number
  } | null = null
): void {
  const cx = x + w / 2
  const cy = y + h / 2

  const traceBasicShape = (
    bx: number,
    by: number,
    bw: number,
    bh: number,
    bShape: ComicBubbleShape,
    bCornerRadius: number
  ): void => {
    const bcx = bx + bw / 2
    const bcy = by + bh / 2
    if (bShape === 'oval') {
      ctx.beginPath()
      ctx.ellipse(bcx, bcy, bw / 2, bh / 2, 0, 0, Math.PI * 2)
      ctx.closePath()
    } else if (bShape === 'narration') {
      pathRoundRect(ctx, bx, by, bw, bh, 0)
    } else {
      pathRoundRect(ctx, bx, by, bw, bh, bCornerRadius)
    }
  }

  const traceMainShape = (): void => {
    if (shape === 'oval' || shape === 'narration' || shape === 'rounded') {
      traceBasicShape(x, y, w, h, shape, cornerRadius)
    } else if (shape === 'shout') {
      // 爆炸呐喊框：确定性手绘长短错落芒刺 + 内凹张力弧线（告别呆板齿轮锯齿）
      const spikes = 22
      const rx = w / 2
      const ry = h / 2
      const rand = createSeededRandom(`shout:${bubbleId}`)
      const outerPts: Array<{ x: number; y: number; a: number }> = []
      for (let i = 0; i < spikes; i++) {
        const baseA = (i / spikes) * Math.PI * 2
        const jitterA = baseA + ((rand() - 0.5) * (Math.PI * 2)) / (spikes * 3.2)
        const isMajorSpike = i % 3 === 0
        const lenMult = isMajorSpike ? 1.22 + rand() * 0.08 : 1.1 + rand() * 0.1
        outerPts.push({
          a: jitterA,
          x: cx + Math.cos(jitterA) * rx * lenMult,
          y: cy + Math.sin(jitterA) * ry * lenMult
        })
      }
      ctx.beginPath()
      for (let i = 0; i < spikes; i++) {
        const p1 = outerPts[i]!
        const p2 = outerPts[(i + 1) % spikes]!
        let midA = (p1.a + p2.a) / 2
        if (p2.a < p1.a) midA += Math.PI
        const valleyMult = 0.85 + rand() * 0.06
        const vx = cx + Math.cos(midA) * rx * valleyMult
        const vy = cy + Math.sin(midA) * ry * valleyMult
        if (i === 0) ctx.moveTo(p1.x, p1.y)
        ctx.quadraticCurveTo(vx, vy, p2.x, p2.y)
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
    } else {
      pathRoundRect(ctx, x, y, w, h, cornerRadius)
    }
  }

  const traceBridge = (): boolean => {
    if (!bridgeFrom) return false
    const c1x = bridgeFrom.x + bridgeFrom.w / 2
    const c1y = bridgeFrom.y + bridgeFrom.h / 2
    const dx = cx - c1x
    const dy = cy - c1y
    const dist = Math.hypot(dx, dy)
    if (dist < 6) return false
    const ux = dx / dist
    const uy = dy / dist
    const nx = -uy
    const ny = ux
    const r1 =
      1 / Math.hypot(ux / Math.max(8, bridgeFrom.w / 2), uy / Math.max(8, bridgeFrom.h / 2))
    const r2 = 1 / Math.hypot(ux / Math.max(8, w / 2), uy / Math.max(8, h / 2))
    const a1x = c1x + ux * r1 * 0.68
    const a1y = c1y + uy * r1 * 0.68
    const a2x = cx - ux * r2 * 0.68
    const a2y = cy - uy * r2 * 0.68
    const rootHalfW = Math.max(6.5, Math.min(bridgeFrom.w, bridgeFrom.h, w, h) * 0.13)
    const waistHalfW = rootHalfW * 0.56
    const midX = (a1x + a2x) * 0.5
    const midY = (a1y + a2y) * 0.5
    ctx.beginPath()
    ctx.moveTo(a1x + nx * rootHalfW, a1y + ny * rootHalfW)
    ctx.quadraticCurveTo(
      midX + nx * waistHalfW,
      midY + ny * waistHalfW,
      a2x + nx * rootHalfW,
      a2y + ny * rootHalfW
    )
    ctx.lineTo(a2x - nx * rootHalfW, a2y - ny * rootHalfW)
    ctx.quadraticCurveTo(
      midX - nx * waistHalfW,
      midY - ny * waistHalfW,
      a1x - nx * rootHalfW,
      a1y - ny * rootHalfW
    )
    ctx.closePath()
    return true
  }

  const traceTail = (): void => {
    if (!tailTip || shape === 'narration' || shape === 'sfx' || shape === 'thought') return
    const dx = tailTip.x - cx
    const dy = tailTip.y - cy
    const dist = Math.hypot(dx, dy)
    if (dist < 4) return
    const nx = -dy / dist
    const ny = dx / dist
    const baseHalfW = Math.max(6, Math.min(w, h) * 0.13)
    // 尾巴根部插在气泡中心偏外侧，保证完全被气泡主体遮住接缝
    const rootX = cx + (dx / dist) * Math.min(w, h) * 0.22
    const rootY = cy + (dy / dist) * Math.min(w, h) * 0.22
    const pLeftX = rootX + nx * baseHalfW
    const pLeftY = rootY + ny * baseHalfW
    const pRightX = rootX - nx * baseHalfW
    const pRightY = rootY - ny * baseHalfW
    // 手绘二次贝塞尔微曲弧形尾巴：带轻微内收腰线与顺向弯折，更具漫画家手绘灵动感
    const bendSign = dx >= 0 ? 1 : -1
    const midX = (rootX + tailTip.x) * 0.52 + nx * baseHalfW * 0.22 * bendSign
    const midY = (rootY + tailTip.y) * 0.52 + ny * baseHalfW * 0.22 * bendSign
    const ctrlLeftX = midX + nx * baseHalfW * 0.28
    const ctrlLeftY = midY + ny * baseHalfW * 0.28
    const ctrlRightX = midX - nx * baseHalfW * 0.28
    const ctrlRightY = midY - ny * baseHalfW * 0.28
    ctx.beginPath()
    ctx.moveTo(pLeftX, pLeftY)
    ctx.quadraticCurveTo(ctrlLeftX, ctrlLeftY, tailTip.x, tailTip.y)
    ctx.quadraticCurveTo(ctrlRightX, ctrlRightY, pRightX, pRightY)
    ctx.closePath()
  }

  ctx.save()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  // 第 1 步：先画连体桥、尾巴与气泡主体的外描边（两遍 stroke 后再统一 fill，接口处无缝融合，并附带微立体纸张衬影防亮底融边）
  if (strokeWidth > 0) {
    ctx.save()
    ctx.shadowColor = 'rgba(15, 23, 42, 0.16)'
    ctx.shadowBlur = 6
    ctx.shadowOffsetX = 1
    ctx.shadowOffsetY = 2.5
    ctx.strokeStyle = stroke
    ctx.lineWidth = strokeWidth * 2
    if (traceBridge()) ctx.stroke()
    traceTail()
    ctx.stroke()
    traceMainShape()
    ctx.stroke()
    ctx.restore()
  }

  // 第 2 步：填充前序连体气泡内部、连体桥、尾巴与当前气泡内部，100% 遮盖内部重合描边线
  ctx.fillStyle = fill
  if (bridgeFrom) {
    traceBasicShape(
      bridgeFrom.x,
      bridgeFrom.y,
      bridgeFrom.w,
      bridgeFrom.h,
      bridgeFrom.shape,
      bridgeFrom.cornerRadius
    )
    ctx.fill()
    if (traceBridge()) ctx.fill()
  }
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

    // 人物「破框出格」立体渲染（Pop-Out Frame Breaking）：
    // 若分镜含有前景抠图立绘（foregroundImageUrl）且未关闭 popOutFrame，在分镜框线之上叠加绘制微放大前景立绘与白边衬底 Halo
    if (!options?.skipForegroundPopOut && panel.foregroundImageUrl && panel.popOutFrame !== false) {
      const fgImg = images.get(panel.foregroundImageUrl) ?? null
      if (fgImg && fgImg.naturalWidth > 0) {
        ctx.save()
        const bleedTop = rect.height * 0.16
        const bleedSide = rect.width * 0.1
        const bleedBottom = rect.height * 0.06
        const clipX = Math.max(0, rect.x - bleedSide)
        const clipY = Math.max(0, rect.y - bleedTop)
        const clipW = Math.min(width - clipX, rect.width + bleedSide * 2)
        const clipH = Math.min(height - clipY, rect.height + bleedTop + bleedBottom)
        ctx.beginPath()
        ctx.rect(clipX, clipY, clipW, clipH)
        ctx.clip()

        const depth = Math.max(0.1, Math.min(1, panel.parallaxDepth ?? 0.5))
        const popBoost = 1 + depth * 0.09
        const popPanel: ComicPanel = {
          ...panel,
          imageZoom: Math.min(4, (panel.imageZoom ?? 1) * popBoost),
          imagePanY: Math.max(-1, Math.min(1, (panel.imagePanY ?? 0) - 0.04))
        }
        ctx.shadowColor =
          background !== 'transparent' ? background : page.backgroundColor?.trim() || '#ffffff'
        ctx.shadowBlur = Math.max(3, pBorderWidth * 1.8)
        drawPanelImage(ctx, fgImg, rect, popPanel)
        ctx.restore()
      }
    }
  }

  // 第二阶段：绘制所有台词气泡与 SFX 拟声词（浮在分镜格之上，支持跨格破框显示、边缘防裁切夹取与同格防重叠）
  const VERTICAL_ROTATE_CHARS = new Set([
    '—',
    '–',
    '-',
    '―',
    '…',
    '‥',
    '～',
    '~',
    '（',
    '）',
    '(',
    ')',
    '「',
    '」',
    '『',
    '』',
    '【',
    '】',
    '《',
    '》',
    '〈',
    '〉',
    '[',
    ']',
    '{',
    '}',
    '：',
    '；'
  ])
  const VERTICAL_CORNER_CHARS = new Set(['。', '、', '，', '．'])

  for (const panel of orderedPanels) {
    const rect = rects.get(panel.id)
    if (!rect) continue
    const placedPanelBoxes: Array<{ x: number; y: number; w: number; h: number }> = []

    interface PreparedBubble {
      bubble: ComicSpeechBubble
      shape: ComicBubbleShape
      isVertical: boolean
      weight: string
      bFontPx: number
      bSpeakerPx: number
      bLineHeight: number
      bPadX: number
      bPadY: number
      fill: string
      stroke: string
      textColor: string
      strokeW: number
      bodyW: number
      bodyH: number
      lines: string[]
      verticalCols: string[][]
      speakerText: string
      speakerH: number
      x: number
      y: number
      centerX: number
      centerY: number
      tipX: number
      tipY: number
      hasCustomTip: boolean
      hasTail: boolean
      cornerRadius: number
      bridgeFrom: {
        x: number
        y: number
        w: number
        h: number
        shape: ComicBubbleShape
        cornerRadius: number
      } | null
    }

    const preparedBubbles: PreparedBubble[] = []

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

      const bFontPx = fontPx * s * (shape === 'sfx' ? 1.52 : 1)
      const bSpeakerPx = speakerPx * s
      const bLineHeight = lineHeight * s * (shape === 'sfx' ? 1.25 : 1)
      const bPadX =
        padX * s * (shape === 'oval' || shape === 'shout' || shape === 'thought' ? 1.25 : 1)
      const bPadY =
        padY * s * (shape === 'oval' || shape === 'shout' || shape === 'thought' ? 1.2 : 1)
      const bMaxWidth = Math.min(maxBubbleWidth * s, Math.max(96, rect.width * 0.88))
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

      // 正式出版漫画靠气泡尾巴指向角色嘴部区分说话人，默认不在气泡内印蓝紫色角色名标签
      const speaker = options?.showSpeakerLabel ? bubble.speaker?.trim() || '' : ''
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
        const shouldBalance = shape === 'oval' || shape === 'shout' || shape === 'thought'
        lines = wrapText(ctx, bubble.text, bInner, shouldBalance)
        ctx.font = `600 ${bSpeakerPx}px sans-serif`
        speakerText = speaker ? truncateToFit(ctx, speaker, bInner) : ''
        ctx.font = `${weight} ${bFontPx}px sans-serif`
        const lineW = Math.max(0, ...lines.map((line) => ctx.measureText(line).width))
        const speakerW = speakerText ? ctx.measureText(speakerText).width : 0
        bodyW = Math.min(bMaxWidth, Math.max(lineW, speakerW) + bPadX * 2)
        speakerH = speakerText ? bSpeakerPx + 4 : 0
        bodyH = bPadY * 2 + speakerH + lines.length * bLineHeight
      }
      ctx.restore()

      // 边缘防裁切自适应夹取：允许适度破出分格框线（10%），但绝不超出页面安全边界
      const pageMargin = Math.max(8, Math.min(18, Math.round((page.padding ?? 12) * 0.4)))
      const minPanelX = Math.max(pageMargin, rect.x - bodyW * 0.1)
      const maxPanelX = Math.min(
        Math.max(pageMargin, width - bodyW - pageMargin),
        rect.x + rect.width - bodyW * 0.9
      )
      const minPanelY = Math.max(pageMargin, rect.y - bodyH * 0.08)
      const maxPanelY = Math.min(
        Math.max(pageMargin, height - bodyH - pageMargin),
        rect.y + rect.height - bodyH * 0.92
      )

      let x = anchor.x - bodyW / 2
      let y = anchor.y - bodyH / 2
      if (maxPanelX >= minPanelX) {
        x = Math.min(maxPanelX, Math.max(minPanelX, x))
      } else {
        x = Math.min(Math.max(pageMargin, width - bodyW - pageMargin), Math.max(pageMargin, x))
      }
      if (maxPanelY >= minPanelY) {
        y = Math.min(maxPanelY, Math.max(minPanelY, y))
      } else {
        y = Math.min(Math.max(pageMargin, height - bodyH - pageMargin), Math.max(pageMargin, y))
      }

      // 同格多气泡防重叠：若与当前分格已放置的气泡发生明显重叠，自动向下或向上错开
      if (shape !== 'sfx' && placedPanelBoxes.length > 0) {
        for (const prev of placedPanelBoxes) {
          const overlapX = Math.min(x + bodyW, prev.x + prev.w) - Math.max(x, prev.x)
          const overlapY = Math.min(y + bodyH, prev.y + prev.h) - Math.max(y, prev.y)
          if (overlapX > Math.min(bodyW, prev.w) * 0.25 && overlapY > 4) {
            const pushedDown = prev.y + prev.h + 8
            const pushedUp = prev.y - bodyH - 8
            if (pushedDown + bodyH <= rect.y + rect.height - 4) {
              y = pushedDown
            } else if (pushedUp >= rect.y + 4) {
              y = pushedUp
            }
          }
        }
      }
      if (shape !== 'sfx') {
        placedPanelBoxes.push({ x, y, w: bodyW, h: bodyH })
      }
      const centerX = x + bodyW / 2
      const centerY = y + bodyH / 2

      // 计算气泡尾巴尖端坐标
      const rawTip = comicBubbleTailTipPagePoint(page, panel.id, bubble.id)
      const hasCustomTip = bubble.tailTipX !== undefined && bubble.tailTipY !== undefined
      let tipX = rawTip?.x ?? centerX
      let tipY = rawTip?.y ?? centerY + bodyH / 2 + 12
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
      const cornerRadius = Math.round(bFontPx * 0.45)

      // 连体双气泡检测：若同格前序气泡与当前气泡均为无旋转的 oval/rounded、同底色/描边、同说话人且间距紧凑，自动生成无痕连体桥接颈
      let bridgeFrom: PreparedBubble['bridgeFrom'] = null
      const prevPb = preparedBubbles[preparedBubbles.length - 1]
      if (
        prevPb &&
        (shape === 'oval' || shape === 'rounded') &&
        (prevPb.shape === 'oval' || prevPb.shape === 'rounded') &&
        !(bubble.rotation ?? 0) &&
        !(prevPb.bubble.rotation ?? 0) &&
        prevPb.fill === fill &&
        prevPb.stroke === stroke &&
        (prevPb.bubble.speaker?.trim() || '') === (bubble.speaker?.trim() || '')
      ) {
        const dx = centerX - prevPb.centerX
        const dy = centerY - prevPb.centerY
        const dist = Math.hypot(dx, dy)
        if (dist > 10) {
          const ux = dx / dist
          const uy = dy / dist
          const rPrev =
            1 / Math.hypot(ux / Math.max(8, prevPb.bodyW / 2), uy / Math.max(8, prevPb.bodyH / 2))
          const rCurr = 1 / Math.hypot(ux / Math.max(8, bodyW / 2), uy / Math.max(8, bodyH / 2))
          const edgeGap = dist - (rPrev + rCurr)
          if (edgeGap <= Math.min(prevPb.bodyH, bodyH) * 0.45) {
            bridgeFrom = {
              x: prevPb.x,
              y: prevPb.y,
              w: prevPb.bodyW,
              h: prevPb.bodyH,
              shape: prevPb.shape,
              cornerRadius: prevPb.cornerRadius
            }
            // 连体双气泡的首个气泡若未手动拖拽指定尾巴尖端，则收起默认尾巴，仅由第二个气泡伸出尾巴指向角色
            if (!prevPb.hasCustomTip) {
              prevPb.hasTail = false
              const prevBound = bubbleBounds.get(prevPb.bubble.id)
              if (prevBound) prevBound.hasTail = false
            }
          }
        }
      }

      bubbleBounds.set(bubble.id, {
        panelId: panel.id,
        bubbleId: bubble.id,
        anchorX: centerX,
        anchorY: centerY,
        x,
        y,
        width: bodyW,
        height: bodyH,
        tailTipX: tipX,
        tailTipY: tipY,
        hasTail
      })

      preparedBubbles.push({
        bubble,
        shape,
        isVertical,
        weight,
        bFontPx,
        bSpeakerPx,
        bLineHeight,
        bPadX,
        bPadY,
        fill,
        stroke,
        textColor,
        strokeW,
        bodyW,
        bodyH,
        lines,
        verticalCols,
        speakerText,
        speakerH,
        x,
        y,
        centerX,
        centerY,
        tipX,
        tipY,
        hasCustomTip,
        hasTail,
        cornerRadius,
        bridgeFrom
      })
    }

    // Pass 1：统一绘制同格所有非 SFX 气泡的外框、连体桥接颈与尾巴（确保连体桥接重填内部时绝不遮盖任何气泡文字）
    for (const pb of preparedBubbles) {
      if (pb.shape === 'sfx') continue
      ctx.save()
      if (pb.bubble.rotation) {
        ctx.translate(pb.centerX, pb.centerY)
        ctx.rotate((pb.bubble.rotation * Math.PI) / 180)
        ctx.translate(-pb.centerX, -pb.centerY)
      }
      drawBubbleBodyAndTail(
        ctx,
        pb.shape,
        pb.x,
        pb.y,
        pb.bodyW,
        pb.bodyH,
        pb.cornerRadius,
        pb.hasTail ? { x: pb.tipX, y: pb.tipY } : null,
        pb.fill,
        pb.stroke,
        pb.strokeW,
        pb.bubble.id,
        pb.bridgeFrom
      )
      ctx.restore()
    }

    // Pass 2：统一绘制所有气泡对白文本与 SFX 拟声词特效字
    for (const pb of preparedBubbles) {
      const {
        bubble,
        shape,
        isVertical,
        weight,
        bFontPx,
        bSpeakerPx,
        bLineHeight,
        bPadX,
        bPadY,
        fill,
        stroke,
        textColor,
        strokeW,
        bodyW,
        lines,
        verticalCols,
        speakerText,
        speakerH,
        x,
        y,
        centerX,
        centerY
      } = pb

      ctx.save()
      if (bubble.rotation || shape === 'sfx') {
        ctx.translate(centerX, centerY)
        if (bubble.rotation) {
          ctx.rotate((bubble.rotation * Math.PI) / 180)
        }
        // 为 SFX 拟声词施加动感斜切矩阵（手绘漫画冲击感）
        if (shape === 'sfx') {
          ctx.transform(1, -0.05, -0.14, 1, 0, 0)
        }
        ctx.translate(-centerX, -centerY)
      }

      // 构建 SFX 拟声词高燃渐变字芯（若采用默认红/橙色系则生成金黄→赤红渐变）
      const createSfxFillStyle = (topY: number, bottomY: number): string | CanvasGradient => {
        if (shape !== 'sfx') return textColor
        const lower = textColor.toLowerCase()
        const isDefaultCrimson =
          !bubble.textColor?.trim() ||
          lower === '#e11d48' ||
          lower === '#ef4444' ||
          lower === '#dc2626'
        const grad = ctx.createLinearGradient(0, topY, 0, Math.max(topY + 8, bottomY))
        if (isDefaultCrimson) {
          grad.addColorStop(0, '#fef08a')
          grad.addColorStop(0.45, '#f97316')
          grad.addColorStop(1, '#e11d48')
        } else {
          grad.addColorStop(0, '#ffffff')
          grad.addColorStop(0.3, textColor)
          grad.addColorStop(1, textColor)
        }
        return grad
      }

      const drawSfxOrNormalGlyph = (
        glyph: string,
        gx: number,
        gy: number,
        fillStyle: string | CanvasGradient
      ): void => {
        if (shape === 'sfx') {
          ctx.save()
          ctx.lineJoin = 'round'
          ctx.shadowColor = 'rgba(0, 0, 0, 0.36)'
          ctx.shadowBlur = 6
          ctx.shadowOffsetX = 2
          ctx.shadowOffsetY = 3
          ctx.strokeStyle = fill || '#ffffff'
          ctx.lineWidth = Math.max(5.5, strokeW * 3.8)
          ctx.strokeText(glyph, gx, gy)
          ctx.restore()

          ctx.lineJoin = 'round'
          ctx.strokeStyle = stroke || '#111111'
          ctx.lineWidth = Math.max(2.6, strokeW * 1.75)
          ctx.strokeText(glyph, gx, gy)
        }
        ctx.fillStyle = fillStyle
        ctx.fillText(glyph, gx, gy)
      }

      // 绘制文字（支持横排、竖排标点旋转及 SFX 三层描边渐变特效字）
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
            const fillStyle = createSfxFillStyle(cyChar, cyChar + bFontPx)
            if (VERTICAL_ROTATE_CHARS.has(ch)) {
              ctx.save()
              ctx.translate(cxCol, cyChar + bFontPx * 0.52)
              ctx.rotate(Math.PI / 2)
              ctx.textAlign = 'center'
              ctx.textBaseline = 'middle'
              drawSfxOrNormalGlyph(ch, 0, 0, fillStyle)
              ctx.restore()
            } else if (VERTICAL_CORNER_CHARS.has(ch)) {
              drawSfxOrNormalGlyph(ch, cxCol + bFontPx * 0.28, cyChar - bFontPx * 0.22, fillStyle)
            } else {
              drawSfxOrNormalGlyph(ch, cxCol, cyChar, fillStyle)
            }
            cyChar += charStep
          }
          cxCol -= colAdvance
        }
      } else {
        ctx.textAlign =
          shape === 'oval' || shape === 'shout' || shape === 'thought' ? 'center' : 'left'
        ctx.textBaseline = 'top'
        const tx =
          shape === 'oval' || shape === 'shout' || shape === 'thought' ? centerX : x + bPadX
        let cy = y + bPadY
        if (speakerText) {
          ctx.font = `700 ${bSpeakerPx}px sans-serif`
          ctx.fillStyle = '#4f46e5'
          ctx.fillText(speakerText, tx, cy)
          cy += speakerH
        }
        ctx.font = `${weight} ${bFontPx}px sans-serif`
        for (const line of lines) {
          const fillStyle = createSfxFillStyle(cy, cy + bFontPx)
          drawSfxOrNormalGlyph(line, tx, cy, fillStyle)
          cy += bLineHeight
        }
      }
      ctx.restore()
    }
  }

  // 页面顶部天头杂志式页眉刊头（Running Head）：严格收在顶部留白带内，绝不压首格顶边框
  if (page.title?.trim()) {
    ctx.save()
    const titleText = page.title.trim()
    const pad = page.padding ?? 0
    const bgHex = background.startsWith('#') ? background.slice(1) : ''
    let isDarkBg = false
    if (bgHex.length === 6) {
      const r = parseInt(bgHex.slice(0, 2), 16)
      const g = parseInt(bgHex.slice(2, 4), 16)
      const b = parseInt(bgHex.slice(4, 6), 16)
      if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
        isDarkBg = 0.299 * r + 0.587 * g + 0.114 * b < 128
      }
    }
    if (pad >= 18) {
      const titleFont = Math.max(10, Math.min(Math.round(fontPx * 0.8), Math.floor(pad * 0.55)))
      const cy = Math.max(titleFont * 0.6, Math.round(pad * 0.5))
      const tx = pad
      ctx.fillStyle = '#e11d48'
      ctx.fillRect(tx, Math.round(cy - titleFont * 0.46), 3.5, Math.round(titleFont * 0.92))
      ctx.font = `700 ${titleFont}px sans-serif`
      ctx.fillStyle = isDarkBg ? 'rgba(241, 245, 249, 0.92)' : 'rgba(30, 41, 59, 0.88)'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(titleText, tx + 9, cy)
    } else {
      const titleFont = Math.max(11, Math.round(fontPx * 0.82))
      ctx.font = `700 ${titleFont}px sans-serif`
      const tw = ctx.measureText(titleText).width
      const tx = 10
      const ty = 8
      const pillH = titleFont + 8
      pathRoundRect(ctx, tx, ty, tw + 20, pillH, 4)
      ctx.fillStyle = isDarkBg ? 'rgba(15, 23, 42, 0.88)' : 'rgba(255, 255, 255, 0.9)'
      ctx.fill()
      ctx.fillStyle = '#e11d48'
      ctx.fillRect(tx + 6, Math.round(ty + 4), 3, pillH - 8)
      ctx.fillStyle = isDarkBg ? '#f8fafc' : '#0f172a'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(titleText, tx + 13, ty + pillH / 2)
    }
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

  // 预加载图片（含分镜底图与前景破框透明立绘，并发，失败则画占位）
  const images = new Map<string, HTMLImageElement | null>()
  if (input.resolveImage) {
    const urls = new Set<string>()
    for (const panel of page.panels) {
      if (panel.imageUrl) urls.add(panel.imageUrl)
      if (panel.foregroundImageUrl) urls.add(panel.foregroundImageUrl)
    }
    await Promise.all(
      [...urls].map(async (url) => {
        if (images.has(url)) return
        images.set(url, null)
        try {
          const src = await input.resolveImage!(url)
          if (src) images.set(url, await loadComicHtmlImage(src))
        } catch {
          /* 加载失败保持 null → 占位 */
        }
      })
    )
  }

  // 1) 为每个分镜格按目标视频画幅比（横屏页 1280×720 16:9 / 竖屏条漫页 720×1280 9:16）独立全画幅渲染无气泡高清底图（panelDataUrls）：
  //    彻底避免从拼页网格中抠出窄竖条造成的二次裁切、分辨率折损与横屏视频左右黑边/毛玻璃割裂感
  const isVerticalPage = height > width * 1.08
  const pWidth = isVerticalPage ? 720 : 1280
  const pHeight = isVerticalPage ? 1280 : 720
  const panelDataUrls: Record<string, string> = {}
  const pCanvas = document.createElement('canvas')
  pCanvas.width = pWidth
  pCanvas.height = pHeight
  for (const panel of page.panels) {
    try {
      const singlePanelPage: ComicPage = {
        ...page,
        title: undefined,
        width: pWidth,
        height: pHeight,
        columns: 1,
        rows: 1,
        gutter: 0,
        padding: 0,
        borderWidth: 0,
        borderRadius: 0,
        panels: [
          {
            ...panel,
            row: 0,
            col: 0,
            rowSpan: 1,
            colSpan: 1,
            zIndex: 0,
            title: undefined,
            caption: undefined,
            borderWidth: 0,
            cornerOffsets: undefined,
            foregroundImageUrl: undefined,
            imageFit: 'cover',
            bubbles: []
          }
        ]
      }
      renderComicPageToCanvas(pCanvas, singlePanelPage, images, {
        background: input.background ?? page.backgroundColor ?? '#0f172a',
        panelFill: input.panelFill ?? '#0f172a',
        borderColor: input.borderColor,
        bubbleFill: input.bubbleFill,
        textColor: input.textColor,
        skipForegroundPopOut: true
      })
      const pUrl = pCanvas.toDataURL('image/png')
      if (pUrl) panelDataUrls[panel.id] = pUrl
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
              title: undefined,
              zIndex: 0,
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

export interface ComicStitchedStripComposeOptions {
  pages: ComicPage[]
  resolveImage?: (imageUrl: string) => Promise<string>
  /** 页间留白像素（默认 0 无缝衔接） */
  pageGapPx?: number
  /** 统一输出宽度（默认取第一页宽度，通常 1080） */
  targetWidth?: number
  /** 拼接画布底色（默认跟随第一页底色或 #ffffff） */
  backgroundColor?: string
}

/**
 * 将多张漫画页（例如 page1、page2、page3）按阅读顺序纵向拼接为一张完整的「整话长条漫 PNG（Webtoon Strip）」，
 * 供小红书 / 微信公众号 / 条漫平台一图流发布。
 */
export async function composeStitchedComicStripImage(
  input: ComicStitchedStripComposeOptions
): Promise<{ dataUrl: string; width: number; height: number; pageCount: number }> {
  const validPages = input.pages
    .map((p) => normalizeComicPage(p))
    .filter((p) => p.panels.length > 0)
  if (!validPages.length) {
    throw new Error('GRAPH_COMIC_PAGE_EMPTY')
  }

  const renderedPages: Array<{ img: HTMLImageElement; width: number; height: number }> = []
  for (const page of validPages) {
    const composed = await composeComicPageImage({
      page,
      resolveImage: input.resolveImage
    })
    if (!composed.dataUrl) continue
    const img = await loadComicHtmlImage(composed.dataUrl)
    renderedPages.push({ img, width: composed.width, height: composed.height })
  }
  if (!renderedPages.length) {
    throw new Error('COMIC_PAGE_COMPOSE_FAILED')
  }

  const outWidth = Math.max(240, Math.round(input.targetWidth || renderedPages[0]!.width || 1080))
  const gapPx = Math.max(0, Math.round(input.pageGapPx ?? 0))
  const scaledHeights = renderedPages.map((item) =>
    Math.max(1, Math.round((item.height * outWidth) / Math.max(1, item.width)))
  )
  const totalHeight =
    scaledHeights.reduce((acc, h) => acc + h, 0) + gapPx * Math.max(0, renderedPages.length - 1)

  const stripCanvas = document.createElement('canvas')
  stripCanvas.width = outWidth
  stripCanvas.height = totalHeight
  const ctx = stripCanvas.getContext('2d')
  if (!ctx) throw new Error('COMIC_PAGE_CANVAS_UNAVAILABLE')

  const bg = input.backgroundColor?.trim() || validPages[0]?.backgroundColor?.trim() || '#ffffff'
  if (bg !== 'transparent') {
    ctx.fillStyle = bg
    ctx.fillRect(0, 0, outWidth, totalHeight)
  }

  let curY = 0
  for (let i = 0; i < renderedPages.length; i++) {
    const item = renderedPages[i]!
    const drawH = scaledHeights[i]!
    ctx.drawImage(item.img, 0, curY, outWidth, drawH)
    curY += drawH + gapPx
  }

  return {
    dataUrl: stripCanvas.toDataURL('image/png'),
    width: outWidth,
    height: totalHeight,
    pageCount: renderedPages.length
  }
}

export interface ComicPanelCardItem {
  panelId: string
  index: number
  title: string
  dataUrl: string
  width: number
  height: number
}

/**
 * 将当前漫画页所有分镜格按阅读顺序（LTR/RTL）分别独立渲染为带对白气泡、镜头特效、旁白条与精致画框的高清分格图文卡片包，
 * 供小红书 / 微博 / B站动态 / Instagram 多图轮播一键发布。
 */
export async function composeComicPanelCardsPack(
  input: ComicPageComposeOptions
): Promise<ComicPanelCardItem[]> {
  const page = normalizeComicPage(input.page)
  const ordered = readingOrderPanels(page)
  if (!ordered.length) return []

  const images = new Map<string, HTMLImageElement | null>()
  if (input.resolveImage) {
    const urls = new Set<string>()
    for (const panel of ordered) {
      if (panel.imageUrl) urls.add(panel.imageUrl)
      if (panel.foregroundImageUrl) urls.add(panel.foregroundImageUrl)
    }
    await Promise.all(
      [...urls].map(async (url) => {
        if (images.has(url)) return
        images.set(url, null)
        try {
          const src = await input.resolveImage!(url)
          if (src) images.set(url, await loadComicHtmlImage(src))
        } catch {
          /* ignore */
        }
      })
    )
  }

  const rects = comicPanelRects(page)
  const out: ComicPanelCardItem[] = []
  const cardCanvas = document.createElement('canvas')

  for (let i = 0; i < ordered.length; i++) {
    const panel = ordered[i]!
    const rect = rects.get(panel.id)
    const ratio = rect && rect.height > 0 ? rect.width / rect.height : 1
    // 按分镜原宽高比输出高清独立卡片（短边至少 960px，长边封顶 1440px）
    let cardW = 1080
    let cardH = 1080
    if (ratio >= 1) {
      cardW = Math.min(1440, Math.max(1080, Math.round(960 * ratio)))
      cardH = Math.max(720, Math.round(cardW / ratio))
    } else {
      cardH = Math.min(1440, Math.max(1080, Math.round(960 / ratio)))
      cardW = Math.max(720, Math.round(cardH * ratio))
    }

    const cardPage: ComicPage = {
      ...page,
      title: undefined,
      width: cardW,
      height: cardH,
      columns: 1,
      rows: 1,
      gutter: 0,
      padding: 16,
      borderWidth: page.borderWidth ?? 3,
      borderRadius: page.borderRadius ?? 6,
      panels: [
        {
          ...panel,
          row: 0,
          col: 0,
          rowSpan: 1,
          colSpan: 1,
          zIndex: 0,
          cornerOffsets: undefined
        }
      ]
    }

    cardCanvas.width = cardW
    cardCanvas.height = cardH
    renderComicPageToCanvas(cardCanvas, cardPage, images, {
      background: input.background ?? page.backgroundColor ?? '#ffffff',
      panelFill: input.panelFill,
      borderColor: input.borderColor,
      bubbleFill: input.bubbleFill,
      textColor: input.textColor
    })
    const dataUrl = cardCanvas.toDataURL('image/png')
    if (dataUrl) {
      out.push({
        panelId: panel.id,
        index: i + 1,
        title: panel.title?.trim() || `panel-${i + 1}`,
        dataUrl,
        width: cardW,
        height: cardH
      })
    }
  }

  return out
}
