import {
  applyChromaKey,
  computeVideoFrameTimestamps,
  normalizeAnim2dState,
  normalizeAnimKeyColor,
  normalizeAnimKeyThreshold,
  normalizeAnimStabilizeMode,
  normalizeAnimVideoRange,
  type AnimKeyColor,
  type AnimStabilizeMode
} from '@shared/graph'
import {
  applyAssetQcFringeFix,
  applyColorDistanceKey,
  applySpriteCellAutoKey,
  computeStabilizedCellPlacement,
  extractAlphaBounds,
  extractSpriteCorePivotX,
  hasNativeTransparentPixels,
  samplePerimeterBackgroundColor,
  type IconKeyColor,
  type SpriteBounds
} from '@shared/gameAssets'
import { resolveAssetFileUrl } from '../../media/assetUrlCache'

export interface ComposeVideoFrameSheetInput {
  /** 视频源 URL（studio-media:// / data:video / blob: / file:） */
  videoUrl?: string
  /** 视频工程相对路径（可用于回退 ffmpeg 抽帧或解析预览 URL） */
  videoRelativePath?: string
  /** 多张关键帧图片 dataUrl（用于「多帧散图拼合序列图」模式） */
  frameDataUrls?: string[]
  rows: number
  cols: number
  /** 视频抽帧起始时间占比（0~0.95，默认 0） */
  startRatio?: number
  /** 视频抽帧结束时间占比（0.05~1，默认 1） */
  endRatio?: number
  /** 背景键控透明模式（''|auto|black|white） */
  keyColor?: AnimKeyColor
  /** 键控容差阈值（5~180，默认 60） */
  keyThreshold?: number
  /** 逐帧原地防抖稳像（off|ground|center） */
  stabilize?: AnimStabilizeMode
  /** 是否在每格左上角绘制 #1..#N 帧序号（用于视频姿态引导重绘参考表） */
  drawFrameNumbers?: boolean
}

export interface ComposeVideoFrameSheetResult {
  dataUrl: string
  width: number
  height: number
  cellWidth: number
  cellHeight: number
  frameCount: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('VIDEO_SHEET_IMAGE_LOAD_FAILED'))
    img.src = src
  })
}

/**
 * 用 HTML5 <video> 在指定区间 [startRatio, endRatio] 均匀抽帧；
 * 若浏览器解码失败则回退主进程 ffmpeg extractVideoFrames。
 */
async function extractFramesFromVideoSource(input: {
  videoUrl?: string
  videoRelativePath?: string
  count: number
  startRatio: number
  endRatio: number
  maxCellSide: number
}): Promise<HTMLCanvasElement[]> {
  let playableUrl = input.videoUrl?.trim() || ''
  const rel = input.videoRelativePath?.trim() || ''
  if (!playableUrl && rel) {
    try {
      playableUrl = await resolveAssetFileUrl(rel)
    } catch {
      playableUrl = ''
    }
  }

  if (playableUrl && typeof document !== 'undefined') {
    try {
      const canvases = await extractViaHtmlVideo(
        playableUrl,
        input.count,
        input.startRatio,
        input.endRatio,
        input.maxCellSide
      )
      if (canvases.length > 0) return canvases
    } catch {
      /* 回退主进程 ffmpeg */
    }
  }

  if (rel && typeof window !== 'undefined' && window.studio?.extractVideoFrames) {
    // 若设置了裁剪区间，多抽一些帧再按比例切片
    const isTrimmed = input.startRatio > 0.01 || input.endRatio < 0.99
    const requestCount = isTrimmed ? Math.min(32, Math.max(input.count * 2, 12)) : input.count
    const urls = await window.studio.extractVideoFrames(rel, requestCount)
    if (urls.length > 0) {
      const sliced = isTrimmed
        ? pickRangeSubset(urls, input.count, input.startRatio, input.endRatio)
        : urls
      return await loadImagesToCanvases(sliced, input.maxCellSide)
    }
  }

  return []
}

function pickRangeSubset<T>(
  items: readonly T[],
  count: number,
  startRatio: number,
  endRatio: number
): T[] {
  if (!items.length) return []
  const n = Math.max(1, count)
  const startIdx = Math.max(0, Math.min(items.length - 1, Math.floor(items.length * startRatio)))
  const endIdx = Math.max(
    startIdx,
    Math.min(items.length - 1, Math.ceil(items.length * endRatio) - 1)
  )
  const span = Math.max(0, endIdx - startIdx)
  const out: T[] = []
  for (let i = 0; i < n; i++) {
    const idx =
      n === 1 ? Math.round((startIdx + endIdx) / 2) : Math.round(startIdx + (span * i) / (n - 1))
    out.push(items[Math.min(items.length - 1, Math.max(0, idx))]!)
  }
  return out
}

async function extractViaHtmlVideo(
  url: string,
  count: number,
  startRatio: number,
  endRatio: number,
  maxCellSide: number
): Promise<HTMLCanvasElement[]> {
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('VIDEO_METADATA_TIMEOUT')), 12_000)
    video.onloadedmetadata = () => {
      clearTimeout(timer)
      resolve()
    }
    video.onerror = () => {
      clearTimeout(timer)
      reject(new Error('VIDEO_LOAD_ERROR'))
    }
    video.src = url
  })

  const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0
  if (duration <= 0) throw new Error('VIDEO_ZERO_DURATION')

  const vw = video.videoWidth || 512
  const vh = video.videoHeight || 512
  const scale = Math.min(1, maxCellSide / Math.max(vw, vh))
  const cw = Math.max(16, Math.round(vw * scale))
  const ch = Math.max(16, Math.round(vh * scale))

  const timestamps = computeVideoFrameTimestamps(duration, count, { startRatio, endRatio })
  const out: HTMLCanvasElement[] = []

  for (const ts of timestamps) {
    await seekVideoTo(video, ts)
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    const ctx = c.getContext('2d')
    if (!ctx) continue
    ctx.drawImage(video, 0, 0, cw, ch)
    out.push(c)
  }

  video.removeAttribute('src')
  video.load()
  return out
}

function seekVideoTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve) => {
    const target = Math.max(0, Math.min(video.duration || 0, timeSec))
    if (Math.abs(video.currentTime - target) < 0.005 && video.readyState >= 2) {
      resolve()
      return
    }
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      video.removeEventListener('seeked', finish)
      resolve()
    }
    const timer = setTimeout(finish, 3000)
    video.addEventListener(
      'seeked',
      () => {
        clearTimeout(timer)
        finish()
      },
      { once: true }
    )
    try {
      video.currentTime = target
    } catch {
      clearTimeout(timer)
      finish()
    }
  })
}

async function loadImagesToCanvases(
  urls: readonly string[],
  maxCellSide: number
): Promise<HTMLCanvasElement[]> {
  const imgs: HTMLImageElement[] = []
  for (const url of urls) {
    if (!url?.trim()) continue
    try {
      imgs.push(await loadImage(url.trim()))
    } catch {
      /* 忽略坏帧 */
    }
  }
  if (!imgs.length) return []
  const firstW = imgs[0]!.naturalWidth || 512
  const firstH = imgs[0]!.naturalHeight || 512
  const scale = Math.min(1, maxCellSide / Math.max(firstW, firstH))
  const cw = Math.max(16, Math.round(firstW * scale))
  const ch = Math.max(16, Math.round(firstH * scale))

  return imgs.map((img) => {
    const c = document.createElement('canvas')
    c.width = cw
    c.height = ch
    const ctx = c.getContext('2d')
    if (ctx) {
      const iw = img.naturalWidth || cw
      const ih = img.naturalHeight || ch
      const fitScale = Math.min(cw / iw, ch / ih)
      const dw = Math.round(iw * fitScale)
      const dh = Math.round(ih * fitScale)
      const dx = Math.round((cw - dw) / 2)
      const dy = Math.round((ch - dh) / 2)
      ctx.drawImage(img, dx, dy, dw, dh)
    }
    return c
  })
}

/**
 * 将视频抽帧或多张散帧合成为标准 rows×cols 序列图（Sprite Sheet）：
 * 支持时间区间截取、逐帧背景键控透明 + 边缘反混合去白边、逐帧原地脚底/中心稳像。
 */
export async function composeVideoFrameSheet(
  input: ComposeVideoFrameSheetInput
): Promise<ComposeVideoFrameSheetResult> {
  const { rows, cols } = normalizeAnim2dState({ rows: input.rows, cols: input.cols })
  const totalCells = rows * cols
  const { startRatio, endRatio } = normalizeAnimVideoRange(input.startRatio, input.endRatio)
  const keyColor = normalizeAnimKeyColor(input.keyColor)
  const keyThreshold = normalizeAnimKeyThreshold(input.keyThreshold)
  const stabilize = normalizeAnimStabilizeMode(input.stabilize)
  // 根据网格规模控制单格最大分辨率，保证整张序列图不超 3072px
  const maxCellSide = Math.max(256, Math.min(768, Math.floor(3072 / Math.max(rows, cols))))

  let rawCanvases: HTMLCanvasElement[] = []
  if (input.frameDataUrls && input.frameDataUrls.length > 0) {
    rawCanvases = await loadImagesToCanvases(input.frameDataUrls, maxCellSide)
  } else {
    rawCanvases = await extractFramesFromVideoSource({
      videoUrl: input.videoUrl,
      videoRelativePath: input.videoRelativePath,
      count: totalCells,
      startRatio,
      endRatio,
      maxCellSide
    })
  }

  if (!rawCanvases.length) {
    throw new Error('VIDEO_FRAME_SHEET_EMPTY')
  }

  // 若输入帧数与 rows×cols 不一致，按均匀重采样对齐到 totalCells 帧
  const cells: HTMLCanvasElement[] = []
  for (let i = 0; i < totalCells; i++) {
    const srcIdx =
      totalCells === 1
        ? 0
        : Math.min(
            rawCanvases.length - 1,
            Math.round((i * (rawCanvases.length - 1)) / (totalCells - 1))
          )
    const src = rawCanvases[srcIdx]!
    const clone = document.createElement('canvas')
    clone.width = src.width
    clone.height = src.height
    const cctx = clone.getContext('2d')
    if (cctx) cctx.drawImage(src, 0, 0)
    cells.push(clone)
  }

  const cellWidth = cells[0]!.width
  const cellHeight = cells[0]!.height

  // 第 1 遍：逐格背景键控 + 去白边，并收集各格主体框与躯干水平主轴
  const cellMeta: Array<{
    imageData: ImageData
    cornerBg: IconKeyColor | null
    bounds: SpriteBounds | null
    pivotX: number | null
  }> = []

  for (let i = 0; i < cells.length; i++) {
    const cellCanvas = cells[i]!
    const ctx = cellCanvas.getContext('2d')
    if (!ctx) {
      cellMeta.push({
        imageData: new ImageData(cellWidth, cellHeight),
        cornerBg: null,
        bounds: null,
        pivotX: null
      })
      continue
    }
    const imageData = ctx.getImageData(0, 0, cellWidth, cellHeight)
    const cornerBg = samplePerimeterBackgroundColor(imageData.data, cellWidth, cellHeight)

    if (keyColor && !hasNativeTransparentPixels(imageData.data, cellWidth, cellHeight)) {
      if (keyColor === 'auto') {
        const res = applySpriteCellAutoKey(imageData.data, cellWidth, cellHeight, {
          background: cornerBg,
          distance: keyThreshold,
          feather: 34
        })
        if (res.keyedPixels > 0) {
          applyAssetQcFringeFix({ data: imageData.data, width: cellWidth, height: cellHeight })
          ctx.putImageData(imageData, 0, 0)
        }
      } else {
        applyChromaKey(imageData.data, keyColor, {
          threshold: keyThreshold,
          feather: 48
        })
        applyAssetQcFringeFix({ data: imageData.data, width: cellWidth, height: cellHeight })
        ctx.putImageData(imageData, 0, 0)
      }
    }

    let bounds: SpriteBounds | null = null
    let pivotX: number | null = null
    if (stabilize === 'ground' || stabilize === 'center') {
      bounds = extractAlphaBounds(imageData.data, cellWidth, cellHeight, {
        alphaMin: 12
      })
      // 若未开透明键控（整张图不透明），用四周聚簇背景色临时掩膜定位角色主体框与躯干主轴
      if (
        (!bounds || (bounds.width === cellWidth && bounds.height === cellHeight)) &&
        !keyColor &&
        cornerBg
      ) {
        const probeData = new Uint8ClampedArray(imageData.data)
        applyColorDistanceKey(probeData, cornerBg, { distance: keyThreshold, feather: 24 })
        bounds = extractAlphaBounds(probeData, cellWidth, cellHeight, { alphaMin: 16 })
        pivotX = extractSpriteCorePivotX(probeData, cellWidth, cellHeight, bounds, { alphaMin: 16 })
      } else {
        pivotX = extractSpriteCorePivotX(imageData.data, cellWidth, cellHeight, bounds, {
          alphaMin: 12
        })
      }
    }

    cellMeta.push({ imageData, cornerBg, bounds, pivotX })
  }

  const validHeights = cellMeta
    .map((m) => m.bounds?.height ?? 0)
    .filter((h) => h >= cellHeight * 0.18 && h < cellHeight)
  let referenceHeightPx: number | null = null
  if (validHeights.length >= 2) {
    const sorted = [...validHeights].sort((a, b) => a - b)
    referenceHeightPx = sorted[Math.floor(sorted.length / 2)]!
  }

  // 第 2 遍：按躯干主轴 + 跨帧中位身高原地稳像并绘制帧序号
  for (let i = 0; i < cells.length; i++) {
    const cellCanvas = cells[i]!
    const ctx = cellCanvas.getContext('2d')
    const meta = cellMeta[i]
    if (!ctx || !meta) continue
    const { imageData, cornerBg, bounds, pivotX } = meta

    if ((stabilize === 'ground' || stabilize === 'center') && bounds) {
      if (
        bounds.width > 4 &&
        bounds.height > 4 &&
        (bounds.width < cellWidth || bounds.height < cellHeight)
      ) {
        const placement = computeStabilizedCellPlacement({
          cellWidth,
          cellHeight,
          bounds,
          pivotX,
          mode: stabilize,
          referenceHeightPx: stabilize === 'ground' ? referenceHeightPx : null
        })
        if (
          placement.dstX !== bounds.x ||
          placement.dstY !== bounds.y ||
          placement.dstW !== bounds.width ||
          placement.dstH !== bounds.height
        ) {
          const temp = document.createElement('canvas')
          temp.width = cellWidth
          temp.height = cellHeight
          const tempCtx = temp.getContext('2d')
          if (tempCtx) {
            tempCtx.putImageData(imageData, 0, 0)
            if (keyColor) {
              ctx.clearRect(0, 0, cellWidth, cellHeight)
            } else if (cornerBg) {
              ctx.fillStyle = `rgb(${cornerBg.r}, ${cornerBg.g}, ${cornerBg.b})`
              ctx.fillRect(0, 0, cellWidth, cellHeight)
            } else {
              ctx.clearRect(0, 0, cellWidth, cellHeight)
            }
            ctx.imageSmoothingEnabled = placement.scale !== 1
            ctx.drawImage(
              temp,
              bounds.x,
              bounds.y,
              bounds.width,
              bounds.height,
              placement.dstX,
              placement.dstY,
              placement.dstW,
              placement.dstH
            )
          }
        }
      }
    }

    if (input.drawFrameNumbers) {
      const badgeH = Math.max(18, Math.round(cellHeight * 0.08))
      const fontSize = Math.max(11, Math.round(badgeH * 0.68))
      const label = `#${i + 1}`
      ctx.save()
      ctx.font = `bold ${fontSize}px sans-serif`
      const textW = ctx.measureText(label).width
      const padX = 6
      ctx.fillStyle = 'rgba(0, 0, 0, 0.72)'
      ctx.fillRect(4, 4, textW + padX * 2, badgeH)
      ctx.fillStyle = '#ffffff'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, 4 + padX, 4 + badgeH / 2)
      ctx.restore()
    }
  }

  const sheetWidth = cols * cellWidth
  const sheetHeight = rows * cellHeight
  const sheetCanvas = document.createElement('canvas')
  sheetCanvas.width = sheetWidth
  sheetCanvas.height = sheetHeight
  const sheetCtx = sheetCanvas.getContext('2d')
  if (!sheetCtx) throw new Error('VIDEO_FRAME_SHEET_CANVAS_UNAVAILABLE')
  sheetCtx.imageSmoothingEnabled = false
  sheetCtx.clearRect(0, 0, sheetWidth, sheetHeight)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = cells[r * cols + c]
      if (!cell) continue
      sheetCtx.drawImage(cell, c * cellWidth, r * cellHeight, cellWidth, cellHeight)
    }
  }

  return {
    dataUrl: sheetCanvas.toDataURL('image/png'),
    width: sheetWidth,
    height: sheetHeight,
    cellWidth,
    cellHeight,
    frameCount: totalCells
  }
}
