/**
 * 漫画页 → PNG 合成：把 comicPage 的分镜格（图/占位）与台词气泡按页面像素尺寸画到 canvas，
 * 返回 PNG data URL。只做绘制；布局几何复用 @shared/graph/comicPage 的 comicPanelRects / comicBubblePagePoint。
 */
import {
  COMIC_BUBBLE_MAX_SCALE,
  COMIC_BUBBLE_MIN_SCALE,
  comicBubblePagePoint,
  comicPanelRects,
  normalizeComicPage,
  type ComicBubbleTail,
  type ComicPage
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
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('COMIC_PAGE_SOURCE_LOAD_FAILED'))
    img.src = src
  })
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
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, rect: Rect): void {
  const sw = img.naturalWidth || 1
  const sh = img.naturalHeight || 1
  const scale = Math.max(rect.width / sw, rect.height / sh)
  const dw = sw * scale
  const dh = sh * scale
  ctx.drawImage(img, rect.x + (rect.width - dw) / 2, rect.y + (rect.height - dh) / 2, dw, dh)
}

/** 按字符折行（中文逐字可断；英文在字内断，台词场景可接受）。保留换行。 */
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

function truncateToFit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text
  let out = ''
  for (const ch of Array.from(text)) {
    if (ctx.measureText(out + ch + '…').width > maxWidth) break
    out += ch
  }
  return `${out}…`
}

function drawBubbleTail(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  tail: ComicBubbleTail,
  size: number,
  fill: string
): void {
  const onLeft = tail === 'tl' || tail === 'bl'
  const cx = onLeft ? x + size + 6 : x + w - size - 6
  const pointingUp = tail === 'tl' || tail === 'tr'
  const baseY = pointingUp ? y : y + h
  const tipY = pointingUp ? y - size : y + h + size
  ctx.fillStyle = fill
  ctx.beginPath()
  ctx.moveTo(cx - size, baseY)
  ctx.lineTo(cx + size, baseY)
  ctx.lineTo(cx, tipY)
  ctx.closePath()
  ctx.fill()
}

export async function composeComicPageImage(
  input: ComicPageComposeOptions
): Promise<ComicPageComposeResult> {
  const page = normalizeComicPage(input.page)
  // 页面自带的背景色优先；未设置时回退调用方参数，最后透明底
  const background =
    page.backgroundColor?.trim() || input.background?.trim() || 'transparent'
  const panelFill = input.panelFill ?? '#f2f2f2'
  const borderColor = input.borderColor ?? '#d8d8d8'
  const bubbleFill = input.bubbleFill ?? '#ffffff'
  const textColor = input.textColor ?? '#1a1a1a'

  const width = Math.max(1, Math.round(page.width))
  const height = Math.max(1, Math.round(page.height))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('COMIC_PAGE_CANVAS_UNAVAILABLE')

  // 默认透明底：不铺白底，只清空画布，页面留白处导出后为 alpha=0
  if (background === 'transparent') {
    ctx.clearRect(0, 0, width, height)
  } else {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, width, height)
  }

  const rects = comicPanelRects(page)

  // 预加载图片（并发，失败则画占位）
  const images = new Map<string, HTMLImageElement | null>()
  if (input.resolveImage) {
    await Promise.all(
      page.panels.map(async (panel) => {
        if (!panel.imageUrl || images.has(panel.imageUrl)) return
        images.set(panel.imageUrl, null)
        try {
          const src = await input.resolveImage!(panel.imageUrl)
          if (src) images.set(panel.imageUrl, await loadImage(src))
        } catch {
          /* 加载失败保持 null → 占位 */
        }
      })
    )
  }

  const fontPx = Math.max(10, Math.round(width * 0.016))
  const speakerPx = Math.max(9, Math.round(fontPx * 0.8))
  const lineHeight = Math.round(fontPx * 1.45)
  const padX = Math.round(fontPx * 0.7)
  const padY = Math.round(fontPx * 0.5)
  const maxBubbleWidth = Math.max(60, width * 0.3)

  for (const panel of page.panels) {
    const rect = rects.get(panel.id)
    if (!rect) continue

    // 面板：填充 + 描边 + 图片 / 占位标题（未设置时用默认占位灰）
    ctx.save()
    pathRoundRect(ctx, rect.x, rect.y, rect.width, rect.height, 6)
    ctx.fillStyle = panel.backgroundColor?.trim() || panelFill
    ctx.fill()
    ctx.strokeStyle = borderColor
    ctx.lineWidth = 1
    ctx.stroke()
    ctx.clip()
    const img = panel.imageUrl ? (images.get(panel.imageUrl) ?? null) : null
    if (img && img.naturalWidth > 0) {
      drawCover(ctx, img, rect)
    } else if (panel.title) {
      ctx.fillStyle = '#909090'
      ctx.font = `${fontPx}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(panel.title, rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width - padX * 2)
    }
    ctx.restore()

    // 气泡（scale 对字号、内边距、宽度上限整体等比缩放）
    for (const bubble of panel.bubbles) {
      const anchor = comicBubblePagePoint(page, panel.id, bubble.id)
      if (!anchor) continue

      const s = Math.min(
        COMIC_BUBBLE_MAX_SCALE,
        Math.max(COMIC_BUBBLE_MIN_SCALE, bubble.scale ?? 1)
      )
      const bFontPx = fontPx * s
      const bSpeakerPx = speakerPx * s
      const bLineHeight = lineHeight * s
      const bPadX = padX * s
      const bPadY = padY * s
      const bMaxWidth = maxBubbleWidth * s
      const bInner = bMaxWidth - bPadX * 2

      ctx.font = `${bFontPx}px sans-serif`
      const lines = wrapText(ctx, bubble.text, bInner)
      const speaker = bubble.speaker?.trim() || ''
      ctx.font = `600 ${bSpeakerPx}px sans-serif`
      const speakerText = speaker ? truncateToFit(ctx, speaker, bInner) : ''
      ctx.font = `${bFontPx}px sans-serif`
      const lineW = Math.max(0, ...lines.map((line) => ctx.measureText(line).width))
      const speakerW = speakerText ? ctx.measureText(speakerText).width : 0
      const bodyW = Math.min(bMaxWidth, Math.max(lineW, speakerW) + bPadX * 2)
      const speakerH = speakerText ? bSpeakerPx + 2 : 0
      const bodyH = bPadY * 2 + speakerH + lines.length * bLineHeight

      const x = anchor.x - bodyW / 2
      const y = anchor.y - bodyH / 2

      // 主体（先画，尾巴再覆盖接缝，形成连续气泡）
      pathRoundRect(ctx, x, y, bodyW, bodyH, Math.round(bFontPx * 0.4))
      ctx.fillStyle = bubbleFill
      ctx.fill()
      ctx.strokeStyle = borderColor
      ctx.lineWidth = 1
      ctx.stroke()

      drawBubbleTail(ctx, x, y, bodyW, bodyH, bubble.tail, Math.max(6, Math.round(bFontPx * 0.45)), bubbleFill)

      ctx.fillStyle = textColor
      ctx.textAlign = 'left'
      ctx.textBaseline = 'top'
      let cy = y + bPadY
      if (speakerText) {
        ctx.font = `600 ${bSpeakerPx}px sans-serif`
        ctx.fillText(speakerText, x + bPadX, cy)
        cy += speakerH
      }
      ctx.font = `${bFontPx}px sans-serif`
      for (const line of lines) {
        ctx.fillText(line, x + bPadX, cy)
        cy += bLineHeight
      }
    }
  }

  return { dataUrl: canvas.toDataURL('image/png'), width, height }
}
