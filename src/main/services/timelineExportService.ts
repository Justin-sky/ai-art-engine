/**
 * 成片时间线导出：系统 ffmpeg 合成视频轨 + 配音/音乐 + 字幕烧录。
 */
import { spawn } from 'child_process'
import { dialog } from 'electron'
import {
  existsSync,
  mkdtempSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, basename, dirname, extname } from 'path'
import { PNG } from 'pngjs'
import {
  buildClipVisualFfmpegFilter,
  buildMainClipCameraFfmpegFilter,
  buildOverlayClipFfmpegFilterSteps,
  clampClipFreezeTailSec,
  clampClipSpeed,
  normalizeClipCropRect,
  normalizeClipLane,
  type ScriptTimelineScaleMode,
  type ScriptTimelineTrackKind,
  type TimelineExportClip,
  type TimelineExportInput,
  type TimelineExportResult,
  type TimelineMixGains
} from '@shared/graph'
import { IpcChannels } from '@shared/ipc'
import { fail, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { projectService } from './projectService'
import { buildPreviewFramePlan } from '@shared/graph/timelinePreview'
import { findFfmpegBin } from './videoFrameService'
import { runFfmpeg } from './ffmpegRunner'
import { broadcastToAllWindows } from '../broadcast'
import {
  buildSubtitleDrawtextMotion,
  subtitleMaxCharsForWidth,
  wrapSubtitleLines
} from '@shared/subtitleWrap'

// ── 时间线导出个性错误 ──
// 渲染端 ScriptTimelineEditor 按 code === 'TIMELINE_FFMPEG_MISSING' 分支；zh 文案保留 FFmpeg 关键字
const E_TIMELINE_FFMPEG_MISSING = defErrSimple(
  'TIMELINE_FFMPEG_MISSING',
  '无法启动 ffmpeg：未找到可执行文件。请安装 ffmpeg 并加入 PATH，或设置 FFMPEG_PATH。',
  'FFmpeg executable was not found; install it or configure the path in Settings'
)
// 起进程与失败文案已抽到 ./ffmpegRunner（界面录制也要跑 ffmpeg，同一件事不该有两份实现）
const E_TIMELINE_NO_EXPORTABLE_CLIPS = defErrSimple(
  'timeline.noExportableClips',
  '时间线上没有可导出的视频或音频片段',
  'The timeline has no exportable video or audio clips'
)
const E_TIMELINE_CANCELLED = defErrSimple('timeline.cancelled', '已取消', 'Cancelled')
const E_TIMELINE_NO_PREVIEW_FRAMES = defErrSimple(
  'timeline.noPreviewFrames',
  '没有可抽帧的时间点',
  'No timestamps to capture'
)
const E_TIMELINE_PREVIEW_FAILED = defErrSimple(
  'timeline.previewFailed',
  '抽帧失败：ffmpeg 没有产出画面（时间点可能落在成片内容之外）',
  'Frame capture failed: ffmpeg produced no picture'
)

/** 预览帧默认宽度：够看清构图与字幕，又不至于让 base64 响应过大 */
const PREVIEW_FRAME_WIDTH = 640
/** 预览帧 JPEG 质量（ffmpeg -q:v：数值越小质量越高、体积越大） */
const PREVIEW_JPEG_QUALITY = 4

function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%')
    .replace(/\n/g, ' ')
}

function findDrawtextFont(): string | null {
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Windows/Fonts/msyh.ttc',
          'C:/Windows/Fonts/msyhbd.ttc',
          'C:/Windows/Fonts/simhei.ttf',
          'C:/Windows/Fonts/simsun.ttc',
          'C:/Windows/Fonts/arial.ttf'
        ]
      : process.platform === 'darwin'
        ? [
            '/System/Library/Fonts/PingFang.ttc',
            '/System/Library/Fonts/Supplemental/Arial Unicode.ttf',
            '/Library/Fonts/Arial.ttf'
          ]
        : [
            '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
            '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
          ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** 片段在源文件内的取段起点（秒）；无打点选段时为 0（从源头部整段截取） */
function clipSourceOffsetSec(clip: { sourceOffsetSec?: number }): number {
  const n = Number(clip.sourceOffsetSec)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(Math.min(3600, n) * 100) / 100
}

/** 将变速倍率拆分为合法的 FFmpeg atempo 滤镜链（单级仅支持 0.5~2.0） */
export function buildAtempoChain(speed: number): string {
  let rem = clampClipSpeed(speed)
  if (Math.abs(rem - 1) <= 0.005) return ''
  const parts: string[] = []
  while (rem > 2.0 + 1e-4) {
    parts.push('atempo=2.000')
    rem /= 2.0
  }
  while (rem < 0.5 - 1e-4) {
    parts.push('atempo=0.500')
    rem /= 0.5
  }
  if (Math.abs(rem - 1) > 0.005 || parts.length === 0) {
    parts.push(`atempo=${Math.min(2, Math.max(0.5, rem)).toFixed(3)}`)
  }
  return parts.join(',')
}

/** 片段级调色、滤镜与画面特效滤镜链 */
function buildClipColorEqFilter(clip: TimelineExportClip): string {
  return buildClipVisualFfmpegFilter(clip) ?? ''
}

/** 片段级画面裁剪（归一化 0~1）滤镜片段 */
function buildClipCropFilter(clip: TimelineExportClip): string {
  const rect = normalizeClipCropRect(clip)
  if (!rect.isCropped) return ''
  return `crop=iw*${rect.width.toFixed(4)}:ih*${rect.height.toFixed(4)}:iw*${rect.x.toFixed(4)}:ih*${rect.y.toFixed(4)}`
}

/** 缓存媒体文件是否含音频轨（按路径+修改时间缓存，避免重复起进程探测） */
const audioStreamProbeCache = new Map<string, boolean>()

function isStillImagePath(filePath: string): boolean {
  return /\.(png|jpe?g|webp|bmp|svg)$/i.test(filePath.trim())
}

function isAnimatedGifPath(filePath: string): boolean {
  return /\.gif$/i.test(filePath.trim())
}

function isImageOrGifPath(filePath: string): boolean {
  return (
    isStillImagePath(filePath) || isAnimatedGifPath(filePath) || /\.svg$/i.test(filePath.trim())
  )
}

export function probeHasAudioStream(bin: string, filePath: string): Promise<boolean> {
  if (isImageOrGifPath(filePath)) return Promise.resolve(false)
  let cacheKey = filePath
  try {
    const st = statSync(filePath)
    cacheKey = `${filePath}:${st.mtimeMs}`
  } catch {
    /* ignore */
  }
  const cached = audioStreamProbeCache.get(cacheKey)
  if (cached !== undefined) return Promise.resolve(cached)

  return new Promise((resolve) => {
    const child = spawn(bin, ['-hide_banner', '-i', filePath], { windowsHide: true })
    let stderr = ''
    let settled = false
    const done = (hasAudio: boolean) => {
      if (settled) return
      settled = true
      audioStreamProbeCache.set(cacheKey, hasAudio)
      resolve(hasAudio)
    }
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', () => done(false))
    child.on('close', () => {
      done(/Stream #\d+:\d+.*:\s*Audio:/i.test(stderr))
    })
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      done(/Stream #\d+:\d+.*:\s*Audio:/i.test(stderr))
    }, 3000)
  })
}

async function probeAudioPathsForTimeline(
  bin: string,
  clips: TimelineExportClip[]
): Promise<Set<string>> {
  const uniquePaths = new Set<string>()
  for (const clip of clips) {
    if (clip.track === 'subtitle') continue
    const path = resolveClipPath(clip)
    if (path) uniquePaths.add(path)
  }
  const audioPaths = new Set<string>()
  await Promise.all(
    Array.from(uniquePaths).map(async (p) => {
      if (await probeHasAudioStream(bin, p)) {
        audioPaths.add(p)
      }
    })
  )
  return audioPaths
}

function parseHexRgb(
  hex: string | undefined,
  fallback: [number, number, number]
): [number, number, number] {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex ?? '').trim())
  if (!m) return fallback
  const n = parseInt(m[1]!, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function blendPixel(
  png: PNG,
  x: number,
  y: number,
  r: number,
  g: number,
  b: number,
  alpha: number
): void {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height || alpha <= 0) return
  const a = Math.min(1, Math.max(0, alpha))
  const idx = (png.width * y + x) << 2
  const dstA = png.data[idx + 3]! / 255
  const outA = a + dstA * (1 - a)
  if (outA <= 1e-4) return
  png.data[idx] = Math.round((r * a + png.data[idx]! * dstA * (1 - a)) / outA)
  png.data[idx + 1] = Math.round((g * a + png.data[idx + 1]! * dstA * (1 - a)) / outA)
  png.data[idx + 2] = Math.round((b * a + png.data[idx + 2]! * dstA * (1 - a)) / outA)
  png.data[idx + 3] = Math.round(outA * 255)
}

function drawThickLine(
  png: PNG,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  radius: number,
  rgb: [number, number, number],
  alpha = 1
): void {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - radius - 1))
  const maxX = Math.min(png.width - 1, Math.ceil(Math.max(x0, x1) + radius + 1))
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - radius - 1))
  const maxY = Math.min(png.height - 1, Math.ceil(Math.max(y0, y1) + radius + 1))
  const vx = x1 - x0
  const vy = y1 - y0
  const lenSq = vx * vx + vy * vy
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const t = lenSq > 1e-4 ? Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / lenSq)) : 0
      const px = x0 + t * vx
      const py = y0 + t * vy
      const dist = Math.hypot(x - px, y - py)
      if (dist <= radius + 1) {
        const cov = Math.max(0, Math.min(1, radius + 0.5 - dist))
        blendPixel(png, x, y, rgb[0], rgb[1], rgb[2], alpha * cov)
      }
    }
  }
}

function drawCircleRing(
  png: PNG,
  cx: number,
  cy: number,
  r: number,
  thickness: number,
  rgb: [number, number, number],
  alpha = 1,
  filled = false
): void {
  const halfT = thickness / 2
  const outer = r + halfT + 1
  const minX = Math.max(0, Math.floor(cx - outer))
  const maxX = Math.min(png.width - 1, Math.ceil(cx + outer))
  const minY = Math.max(0, Math.floor(cy - outer))
  const maxY = Math.min(png.height - 1, Math.ceil(cy + outer))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (filled) {
        if (d <= r + 0.5) {
          const cov = Math.max(0, Math.min(1, r + 0.5 - d))
          blendPixel(png, x, y, rgb[0], rgb[1], rgb[2], alpha * cov)
        }
      } else {
        const ringDist = Math.abs(d - r)
        if (ringDist <= halfT + 0.8) {
          const cov = Math.max(0, Math.min(1, halfT + 0.5 - ringDist))
          blendPixel(png, x, y, rgb[0], rgb[1], rgb[2], alpha * cov)
        }
      }
    }
  }
}

/**
 * 主进程纯 JS 矢量贴纸光栅化器（使用 pngjs 生成 32-bit RGBA PNG）：
 * 规避 Windows/macOS 标准 FFmpeg 缺少 librsvg 解码器导致 `.svg` 输入报 `no decoder found for: svg`。
 */
export function renderBuiltinStickerPngBuffer(stickerId: string, customColor?: string): Buffer {
  if (stickerId === 'viewfinder-frame') {
    const png = new PNG({ width: 640, height: 360 })
    const gold = parseHexRgb(customColor, [245, 158, 11])
    const dark: [number, number, number] = [15, 23, 42]
    const red: [number, number, number] = [239, 68, 68]
    const corners: Array<[number, number, number, number]> = [
      [24, 24, 1, 1],
      [616, 24, -1, 1],
      [616, 336, -1, -1],
      [24, 336, 1, -1]
    ]
    for (const [cx, cy, dx, dy] of corners) {
      drawThickLine(png, cx, cy, cx + dx * 68, cy, 5.5, dark, 0.72)
      drawThickLine(png, cx, cy, cx, cy + dy * 68, 5.5, dark, 0.72)
      drawThickLine(png, cx, cy, cx + dx * 68, cy, 3, gold, 0.96)
      drawThickLine(png, cx, cy, cx, cy + dy * 68, 3, gold, 0.96)
    }
    drawCircleRing(png, 320, 180, 30, 2.5, gold, 0.88, false)
    drawThickLine(png, 320, 136, 320, 156, 2, gold, 0.9)
    drawThickLine(png, 320, 204, 320, 224, 2, gold, 0.9)
    drawThickLine(png, 276, 180, 296, 180, 2, gold, 0.9)
    drawThickLine(png, 344, 180, 364, 180, 2, gold, 0.9)
    drawCircleRing(png, 320, 180, 3.5, 1, red, 0.95, true)
    drawCircleRing(png, 52, 48, 5, 1, red, 0.95, true)
    return PNG.sync.write(png)
  }

  if (stickerId === 'scroll-seal-frame') {
    const png = new PNG({ width: 640, height: 360 })
    const gold = parseHexRgb(customColor, [217, 119, 6])
    const dark: [number, number, number] = [28, 25, 23]
    const cinnabar: [number, number, number] = [185, 28, 28]
    const ivory: [number, number, number] = [254, 243, 199]
    const corners: Array<[number, number, number, number]> = [
      [22, 22, 1, 1],
      [618, 22, -1, 1],
      [618, 338, -1, -1],
      [22, 338, 1, -1]
    ]
    // 外层洒金双线回纹折角
    for (const [cx, cy, dx, dy] of corners) {
      drawThickLine(png, cx, cy, cx + dx * 72, cy, 4.5, dark, 0.65)
      drawThickLine(png, cx, cy, cx, cy + dy * 72, 4.5, dark, 0.65)
      drawThickLine(png, cx, cy, cx + dx * 72, cy, 2.4, gold, 0.96)
      drawThickLine(png, cx, cy, cx, cy + dy * 72, 2.4, gold, 0.96)
      // 内层回纹折角
      const ix = cx + dx * 10
      const iy = cy + dy * 10
      drawThickLine(png, ix, iy + dy * 26, ix + dx * 26, iy + dy * 26, 1.4, gold, 0.82)
      drawThickLine(png, ix + dx * 26, iy, ix + dx * 26, iy + dy * 26, 1.4, gold, 0.82)
    }
    // 内层细金线框
    drawThickLine(png, 32, 32, 608, 32, 0.9, gold, 0.45)
    drawThickLine(png, 608, 32, 608, 328, 0.9, gold, 0.45)
    drawThickLine(png, 608, 328, 32, 328, 0.9, gold, 0.45)
    drawThickLine(png, 32, 328, 32, 32, 0.9, gold, 0.45)
    // 左上角朱砂闲章（42..72 x 42..88）
    for (let y = 42; y <= 88; y++) {
      for (let x = 42; x <= 72; x++) {
        blendPixel(png, x, y, cinnabar[0], cinnabar[1], cinnabar[2], 0.92)
      }
    }
    drawThickLine(png, 42, 42, 72, 42, 1.2, ivory, 0.9)
    drawThickLine(png, 72, 42, 72, 88, 1.2, ivory, 0.9)
    drawThickLine(png, 72, 88, 42, 88, 1.2, ivory, 0.9)
    drawThickLine(png, 42, 88, 42, 42, 1.2, ivory, 0.9)
    // 印章内篆书笔意纹饰
    drawThickLine(png, 49, 53, 65, 53, 1.1, ivory, 0.86)
    drawThickLine(png, 57, 48, 57, 62, 1.1, ivory, 0.86)
    drawThickLine(png, 49, 70, 65, 70, 1.1, ivory, 0.86)
    drawThickLine(png, 52, 70, 52, 81, 1.1, ivory, 0.86)
    drawThickLine(png, 62, 70, 62, 81, 1.1, ivory, 0.86)
    drawThickLine(png, 49, 81, 65, 81, 1.1, ivory, 0.86)
    // 中心古典菱形星芒对焦游标
    drawThickLine(png, 320, 158, 327, 180, 1.2, gold, 0.72)
    drawThickLine(png, 327, 180, 320, 202, 1.2, gold, 0.72)
    drawThickLine(png, 320, 202, 313, 180, 1.2, gold, 0.72)
    drawThickLine(png, 313, 180, 320, 158, 1.2, gold, 0.72)
    drawThickLine(png, 288, 180, 306, 180, 1.2, gold, 0.62)
    drawThickLine(png, 334, 180, 352, 180, 1.2, gold, 0.62)
    return PNG.sync.write(png)
  }

  if (stickerId === 'museum-gilded-frame') {
    const png = new PNG({ width: 640, height: 360 })
    const gold = parseHexRgb(customColor, [234, 179, 8])
    const dark: [number, number, number] = [24, 24, 27]
    const burgundy: [number, number, number] = [69, 10, 10]
    const paleGold: [number, number, number] = [254, 240, 138]
    const corners: Array<[number, number, number, number]> = [
      [20, 20, 1, 1],
      [620, 20, -1, 1],
      [620, 340, -1, -1],
      [20, 340, 1, -1]
    ]
    for (const [cx, cy, dx, dy] of corners) {
      drawThickLine(png, cx, cy, cx + dx * 78, cy, 5, dark, 0.7)
      drawThickLine(png, cx, cy, cx, cy + dy * 78, 5, dark, 0.7)
      drawThickLine(png, cx, cy, cx + dx * 78, cy, 2.6, gold, 0.96)
      drawThickLine(png, cx, cy, cx, cy + dy * 78, 2.6, gold, 0.96)
      drawCircleRing(png, cx + dx * 10, cy + dy * 10, 6.5, 2, gold, 0.92, false)
    }
    drawThickLine(png, 30, 30, 610, 30, 1.1, gold, 0.52)
    drawThickLine(png, 610, 30, 610, 330, 1.1, gold, 0.52)
    drawThickLine(png, 610, 330, 30, 330, 1.1, gold, 0.52)
    drawThickLine(png, 30, 330, 30, 30, 1.1, gold, 0.52)
    // 左上角卢浮宫式紫红鎏金馆藏铭牌（42..168 x 40..64）
    for (let y = 40; y <= 64; y++) {
      for (let x = 42; x <= 168; x++) {
        blendPixel(png, x, y, burgundy[0], burgundy[1], burgundy[2], 0.88)
      }
    }
    drawThickLine(png, 42, 40, 168, 40, 1.2, gold, 0.92)
    drawThickLine(png, 168, 40, 168, 64, 1.2, gold, 0.92)
    drawThickLine(png, 168, 64, 42, 64, 1.2, gold, 0.92)
    drawThickLine(png, 42, 64, 42, 40, 1.2, gold, 0.92)
    drawThickLine(png, 56, 52, 154, 52, 1.2, paleGold, 0.8)
    // 中心古典黄金分割圆环对焦游标
    drawCircleRing(png, 320, 180, 22, 1.6, gold, 0.72, false)
    drawCircleRing(png, 320, 180, 2.5, 1, gold, 0.9, true)
    drawThickLine(png, 286, 180, 296, 180, 1.2, gold, 0.65)
    drawThickLine(png, 344, 180, 354, 180, 1.2, gold, 0.65)
    return PNG.sync.write(png)
  }

  const png = new PNG({ width: 256, height: 256 })
  const white: [number, number, number] = [255, 255, 255]
  switch (stickerId) {
    case 'focus-circle': {
      const col = parseHexRgb(customColor, [255, 46, 76])
      drawCircleRing(png, 128, 128, 96, 9, col, 0.95, false)
      drawCircleRing(png, 128, 128, 86, 4, [255, 159, 28], 0.85, false)
      break
    }
    case 'arrow-pointer': {
      const col = parseHexRgb(customColor, [255, 230, 0])
      drawThickLine(png, 42, 42, 194, 194, 18, [17, 19, 24], 0.85)
      drawThickLine(png, 194, 194, 194, 98, 18, [17, 19, 24], 0.85)
      drawThickLine(png, 194, 194, 98, 194, 18, [17, 19, 24], 0.85)
      drawThickLine(png, 42, 42, 194, 194, 12, col, 0.98)
      drawThickLine(png, 194, 194, 194, 98, 12, col, 0.98)
      drawThickLine(png, 194, 194, 98, 194, 12, col, 0.98)
      break
    }
    case 'check-correct': {
      const col = parseHexRgb(customColor, [16, 185, 129])
      drawCircleRing(png, 128, 128, 102, 1, col, 0.96, true)
      drawCircleRing(png, 128, 128, 102, 10, white, 0.98, false)
      drawThickLine(png, 78, 131, 113, 166, 14, white, 0.98)
      drawThickLine(png, 113, 166, 182, 93, 14, white, 0.98)
      break
    }
    case 'cross-warn': {
      const col = parseHexRgb(customColor, [239, 68, 68])
      drawCircleRing(png, 128, 128, 102, 1, col, 0.96, true)
      drawCircleRing(png, 128, 128, 102, 10, white, 0.98, false)
      drawThickLine(png, 88, 88, 168, 168, 14, white, 0.98)
      drawThickLine(png, 168, 88, 88, 168, 14, white, 0.98)
      break
    }
    case 'step-badge': {
      const col = parseHexRgb(customColor, [99, 102, 241])
      drawCircleRing(png, 128, 128, 100, 1, col, 0.96, true)
      drawCircleRing(png, 128, 128, 100, 11, [250, 204, 21], 0.98, false)
      drawThickLine(png, 128, 82, 128, 174, 14, white, 0.98)
      break
    }
    case 'badge-important':
    case 'callout-bubble': {
      const col = parseHexRgb(
        customColor,
        stickerId === 'badge-important' ? [255, 46, 76] : [56, 189, 248]
      )
      drawThickLine(png, 52, 128, 204, 128, 42, col, 0.94)
      drawThickLine(png, 56, 128, 200, 128, 34, white, 0.22)
      break
    }
    case 'sparkle-star':
    default: {
      const col = parseHexRgb(customColor, [250, 204, 21])
      drawThickLine(png, 128, 24, 128, 232, 14, col, 0.96)
      drawThickLine(png, 24, 128, 232, 128, 14, col, 0.96)
      drawThickLine(png, 68, 68, 188, 188, 8, white, 0.9)
      drawThickLine(png, 188, 68, 68, 188, 8, white, 0.9)
      drawCircleRing(png, 128, 128, 24, 1, white, 0.95, true)
      break
    }
  }
  return PNG.sync.write(png)
}

function writeStickerPngFile(clip: TimelineExportClip): string | null {
  try {
    const rootDir = projectService.isOpen()
      ? join(projectService.getRoot(), 'Cache', 'stickers')
      : join(tmpdir(), 'aiart-stickers')
    mkdirSync(rootDir, { recursive: true })
    const rawId = (clip.stickerId && String(clip.stickerId).trim()) || 'viewfinder-frame'
    const safeId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const colorTag = (clip.stickerColor ?? '').replace(/[^a-zA-Z0-9]/g, '')
    const textTag = Buffer.from(String(clip.text ?? clip.title ?? ''), 'utf-8')
      .toString('hex')
      .slice(0, 16)
    const pngPath = join(rootDir, `${safeId}-${colorTag || 'def'}-${textTag || '0'}.png`)
    const dataUrl = clip.stickerPngDataUrl?.trim() ?? ''
    const prefix = 'data:image/png;base64,'
    if (dataUrl.startsWith(prefix) && dataUrl.length > prefix.length + 16) {
      writeFileSync(pngPath, Buffer.from(dataUrl.slice(prefix.length), 'base64'))
      return pngPath
    }
    writeFileSync(pngPath, renderBuiltinStickerPngBuffer(rawId, clip.stickerColor))
    return pngPath
  } catch {
    return null
  }
}

function resolveClipPath(clip: TimelineExportClip): string | null {
  if (clip.absPath && existsSync(clip.absPath)) {
    if (/\.svg$/i.test(clip.absPath.trim())) {
      return writeStickerPngFile(clip)
    }
    return clip.absPath
  }
  const rel = clip.relativePath?.trim()
  if (rel && projectService.isOpen()) {
    try {
      const abs = join(projectService.getRoot(), rel)
      if (existsSync(abs)) {
        if (/\.svg$/i.test(abs.trim())) {
          return writeStickerPngFile(clip)
        }
        return abs
      }
    } catch {
      /* fall through */
    }
  }
  if (clip.stickerId && typeof clip.stickerId === 'string' && clip.stickerId.trim()) {
    return writeStickerPngFile(clip)
  }
  return null
}

export function buildFilterGraph(
  mainVideos: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  overlays: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  audios: Array<TimelineExportClip & { path: string; inputIndex: number }>,
  subs: TimelineExportClip[],
  baseVideoIndex: number,
  baseAudioIndex: number,
  rate: number,
  width: number,
  height: number,
  fps: number,
  subtitleFontSize: number,
  subtitleYOffset: number,
  subtitleColor: string,
  mix?: {
    mixGains?: TimelineMixGains
    mixMasterGain?: number
    mixBassGainDb?: number
    mixTrebleGainDb?: number
    mixCompression?: boolean
    mixAutoDucking?: boolean
    mixDuckingRatio?: number
    mixLoudnorm?: boolean
    /** 静音轨道：这些轨道的声音不混入成片 */
    mutedTracks?: ScriptTimelineTrackKind[]
  },
  watermark?: {
    inputIndex: number
    opacity: number
    scale: number
    position: 'br' | 'bl' | 'tr' | 'tl'
  },
  visualOptions?: {
    scaleMode?: ScriptTimelineScaleMode
    subtitleBorderColor?: string
    subtitleBorderWidth?: number
    subtitleBoxEnabled?: boolean
    subtitleBoxColor?: string
    subtitleBoxOpacity?: number
    subtitleMotion?: boolean | 'none' | 'fade'
  }
): { filter: string; mapVideo: string; mapAudio: string } {
  const filterParts: string[] = []
  filterParts.push(`[${baseVideoIndex}:v]format=yuv420p[base]`)
  const scaleMode: ScriptTimelineScaleMode = visualOptions?.scaleMode ?? 'contain'

  // ── 主视频轨：逐段拼接（每段独立裁剪，最后一次性 concat），杜绝链式 xfade 的累计漂移 ──
  // 片段时间线转场语义（与预览一致）：相邻片段 A(前) / B(后) 有重叠窗口
  // overlap = A.end − B.start（>0 才可能有转场）。B.transitionInSec 记录生效转场时长，
  // 预览在窗口内把 B 按 progress 叠加在 A 之上。导出同样在该窗口用 xfade 合成。
  const orderedMainVideos = [...mainVideos].sort((a, b) => a.startSec - b.startSec)
  let lastVideo = 'base'
  const mainClipEnd = (c: TimelineExportClip): number => c.startSec + Math.max(0.05, c.durationSec)

  if (orderedMainVideos.length) {
    const count = orderedMainVideos.length
    // 片段间可支持的转场（与 ffmpeg xfade 的类型一一对应；值即 xfade transition 名）
    const xfadeMap: Record<string, string> = {
      dissolve: 'dissolve',
      fade: 'fadeblack',
      fadeout: 'fadeblack',
      fadein: 'fadeblack',
      flash: 'fadewhite',
      fadegrays: 'fadegrays',
      hblur: 'hblur',
      distance: 'distance',
      smoothleft: 'smoothleft',
      smoothright: 'smoothright',
      smoothup: 'smoothup',
      smoothdown: 'smoothdown',
      slideleft: 'slideleft',
      slideright: 'slideright',
      slideup: 'slideup',
      slidedown: 'slidedown',
      wipeleft: 'wipeleft',
      wiperight: 'wiperight',
      wipeup: 'wipeup',
      wipedown: 'wipedown',
      wipetl: 'wipetl',
      wipetr: 'wipetr',
      wipebl: 'wipebl',
      wipebr: 'wipebr',
      circleopen: 'circleopen',
      circleclose: 'circleclose',
      rectcrop: 'rectcrop',
      radial: 'radial',
      zoomin: 'zoomin',
      pixelize: 'pixelize',
      horzopen: 'horzopen',
      horzclose: 'horzclose',
      vertopen: 'vertopen',
      vertclose: 'vertclose',
      hlslice: 'hlslice',
      hrslice: 'hrslice',
      vuslice: 'vuslice',
      vdslice: 'vdslice',
      squeezeh: 'squeezeh',
      squeezev: 'squeezev',
      diagtl: 'diagtl',
      diagbr: 'diagbr'
    }
    const xfadeTransitionName = (type: string | undefined): string | null =>
      xfadeMap[type ?? ''] ?? null

    // 逐对计算：几何重叠量 + 实际生效转场时长
    // （生效时长 = min(重叠量, B.transitionInSec, A/B 各自时长)，type 必须可 xfade）
    const overlapAfter: number[] = []
    const transDur: number[] = []
    for (let i = 0; i < count - 1; i++) {
      const left = orderedMainVideos[i]!
      const right = orderedMainVideos[i + 1]!
      const overlap = Math.max(0, mainClipEnd(left) - right.startSec)
      overlapAfter.push(overlap)
      const inSec = Math.max(0, right.transitionInSec ?? 0)
      const supported =
        overlap > 0.001 && inSec > 0.001 && xfadeTransitionName(right.transitionType) !== null
      transDur.push(
        supported
          ? Math.min(
              overlap,
              inSec,
              Math.max(0.05, left.durationSec),
              Math.max(0.05, right.durationSec)
            )
          : 0
      )
    }

    // 片段内容窗口规划：每个片段可能被切为 头窗(前向转场) / 主体 / 尾窗(后向转场)
    // 三部分互不重叠（主体跳过被转场占用的头尾），几何与片段自身时长严格对齐，杜绝漂移
    type MainWindow = { kind: 'head' | 'body' | 'tail'; start: number; dur: number; port: string }
    const windowPlans: Array<{ wins: MainWindow[] }> = []
    for (let i = 0; i < count; i++) {
      const clip = orderedMainVideos[i]!
      const dur = Math.max(0.05, clip.durationSec)
      const prev = i > 0 ? orderedMainVideos[i - 1]! : null
      const overlapPrev = prev ? Math.max(0, mainClipEnd(prev) - clip.startSec) : 0
      const dPrev = i > 0 ? transDur[i - 1]! : 0
      const overlapNext = i < count - 1 ? overlapAfter[i]! : 0
      const dNext = i < count - 1 ? transDur[i]! : 0

      const wins: MainWindow[] = []
      // 前向转场：本片段头部 [0, dPrev) 在交叉段中被播放
      if (i > 0 && dPrev > 0.001) {
        wins.push({ kind: 'head', start: 0, dur: dPrev, port: '' })
      }
      // 主体（独白部分）：跳过被前转场占用的头部与后转场占用的尾部
      const bodyStart =
        i === 0 ? 0 : overlapPrev > 0.001 ? (dPrev > 0.001 ? dPrev : overlapPrev) : 0
      const bodyEnd = dNext > 0.001 ? Math.max(0, dur - Math.min(overlapNext, dur)) : dur
      if (bodyEnd - bodyStart > 0.001) {
        wins.push({ kind: 'body', start: bodyStart, dur: bodyEnd - bodyStart, port: '' })
      }
      // 后向转场：本片段尾部在交叉段中继续播放到自身结束
      if (i < count - 1 && dNext > 0.001) {
        const tailStart = Math.min(dur, Math.max(0, dur - overlapNext))
        const tailDur = Math.min(dNext, Math.max(0, dur - tailStart))
        if (tailDur > 0.001) {
          wins.push({ kind: 'tail', start: tailStart, dur: tailDur, port: '' })
        }
      }
      windowPlans.push({ wins })
    }

    // 同一源文件可能被裁成多个窗口：先 split 显式分流，避免同输入流被多个 filter 隐式复用
    let srcIdx = 0
    for (let i = 0; i < count; i++) {
      const plan = windowPlans[i]!
      if (!plan.wins.length) continue
      if (plan.wins.length === 1) {
        plan.wins[0]!.port = `${orderedMainVideos[i]!.inputIndex}:v`
        continue
      }
      const ports: string[] = []
      for (let k = 0; k < plan.wins.length; k++) ports.push(`msrc${srcIdx++}`)
      filterParts.push(
        `[${orderedMainVideos[i]!.inputIndex}:v]split=${ports.length}${ports.map((p) => `[${p}]`).join('')}`
      )
      plan.wins.forEach((w, k) => {
        w.port = ports[k]!
      })
    }

    // 待拼接段（按时间先后顺序）：主体段 / 黑场段 / 转场 xfade 段
    const segments: string[] = []
    let segIdx = 0

    const windowPlan = (i: number, kind: MainWindow['kind']): MainWindow | undefined =>
      windowPlans[i]!.wins.find((w) => w.kind === kind)

    const normalizedVideo = (
      clip: TimelineExportClip,
      srcPort: string,
      winStartSec: number,
      winDurSec: number,
      label: string
    ): void => {
      const clipDur = Math.max(0.05, clip.durationSec)
      const speed = clampClipSpeed(clip.speed)
      const freezeTail = Math.min(
        Math.max(0, clipDur - 0.05),
        clampClipFreezeTailSec(clip.freezeTailSec)
      )
      const movingDur = Math.max(0.05, clipDur - freezeTail)
      const winMovingStart = Math.min(winStartSec, movingDur)
      const winMovingEnd = Math.min(winStartSec + winDurSec, movingDur)
      const winMovingDur = Math.max(0, winMovingEnd - winMovingStart)
      const winFreezeDur = Math.max(0, winDurSec - winMovingDur)

      const srcBase = clipSourceOffsetSec(clip)
      const srcStart =
        winMovingDur > 0.001
          ? srcBase + winMovingStart * speed
          : Math.max(0, srcBase + movingDur * speed - 0.05)
      const srcTrimDur = winMovingDur > 0.001 ? winMovingDur * speed : 0.05
      const ptsExpr =
        winMovingDur > 0.001 && Math.abs(speed - 1) > 0.005
          ? `setpts=(PTS-STARTPTS)/${speed.toFixed(3)}`
          : 'setpts=PTS-STARTPTS'
      const freezePadDur = winMovingDur > 0.001 ? winFreezeDur : Math.max(0, winDurSec - 0.05)
      const tpadOpt =
        freezePadDur > 0.001 ? `,tpad=stop_mode=clone:stop_duration=${freezePadDur.toFixed(3)}` : ''
      const cropExpr = buildClipCropFilter(clip)
      const cropOpt = cropExpr ? `,${cropExpr}` : ''
      const colorEq = buildClipColorEqFilter(clip)
      const eqOpt = colorEq ? `,${colorEq}` : ''

      if (scaleMode === 'blur') {
        const preLabel = `${label}pre`
        const bgLabel = `${label}bg`
        const fgLabel = `${label}fg`
        const bgBlurLabel = `${label}bgb`
        const fgFitLabel = `${label}fgf`
        filterParts.push(
          `[${srcPort}]trim=${srcStart.toFixed(3)}:${(srcStart + srcTrimDur).toFixed(3)},${ptsExpr}${tpadOpt}${cropOpt}${eqOpt},split=2[${bgLabel}][${fgLabel}]`
        )
        filterParts.push(
          `[${bgLabel}]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:2[${bgBlurLabel}]`
        )
        filterParts.push(
          `[${fgLabel}]scale=${width}:${height}:force_original_aspect_ratio=decrease[${fgFitLabel}]`
        )
        filterParts.push(
          `[${bgBlurLabel}][${fgFitLabel}]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${fps},format=yuv420p[${label}]`
        )
        void preLabel
        return
      }

      const baseScaleExpr =
        scaleMode === 'cover'
          ? `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`
          : `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`
      const camExpr = buildMainClipCameraFfmpegFilter(
        clip.cameraMotion,
        width,
        height,
        clipDur,
        winStartSec
      )
      const scaleExpr = camExpr ? `${baseScaleExpr},${camExpr}` : baseScaleExpr

      filterParts.push(
        `[${srcPort}]trim=${srcStart.toFixed(3)}:${(srcStart + srcTrimDur).toFixed(3)},${ptsExpr}${tpadOpt}${cropOpt}${eqOpt},${scaleExpr},setsar=1,fps=${fps},format=yuv420p[${label}]`
      )
    }

    /** 从规划窗口中裁一段 */
    const trimWindow = (i: number, kind: MainWindow['kind'], label: string): void => {
      const w = windowPlan(i, kind)
      if (!w) return
      const clip = orderedMainVideos[i]!
      normalizedVideo(clip, w.port, w.start, w.dur, label)
    }

    /** 相邻两段的重叠转场段：A 的尾窗 + B 的头窗各裁 overlap 窗口后做一次独立 xfade */
    const addCrossSegment = (boundary: number): void => {
      const right = orderedMainVideos[boundary + 1]!
      const tail = windowPlan(boundary, 'tail')
      const head = windowPlan(boundary + 1, 'head')
      if (!tail || !head) return
      const aLabel = `crossa${segIdx}`
      const bLabel = `crossb${segIdx}`
      const outLabel = `cross${segIdx++}`
      trimWindow(boundary, 'tail', aLabel)
      trimWindow(boundary + 1, 'head', bLabel)
      const name = xfadeTransitionName(right.transitionType) ?? 'dissolve'
      const dur = Math.min(tail.dur, head.dur)
      filterParts.push(
        `[${aLabel}][${bLabel}]xfade=transition=${name}:duration=${dur.toFixed(3)}:offset=0[${outLabel}]`
      )
      segments.push(outLabel)
    }

    /** 主体内容段 */
    const addContentSegment = (i: number): void => {
      const w = windowPlan(i, 'body')
      if (!w) return
      const label = `mainseg${segIdx++}`
      trimWindow(i, 'body', label)
      segments.push(label)
    }

    /** 片段之间的黑场（时间线上有间隙时按实际时长补齐，保证后续时间轴不错位） */
    const addBlackSegment = (segDur: number): void => {
      if (segDur <= 0.001) return
      const label = `blackseg${segIdx++}`
      filterParts.push(
        `color=c=black:s=${width}x${height}:r=${fps}:d=${segDur.toFixed(3)},format=yuv420p[${label}]`
      )
      segments.push(label)
    }

    // 按时间顺序输出各段：前段与后段的交叉段（或间隙黑场）→ 后段主体 → …… → 一次 concat
    for (let i = 0; i < count; i++) {
      const clip = orderedMainVideos[i]!
      const prev = i > 0 ? orderedMainVideos[i - 1]! : null
      const overlapPrev = prev ? Math.max(0, mainClipEnd(prev) - clip.startSec) : 0
      const dPrev = i > 0 ? transDur[i - 1]! : 0

      if (i > 0 && dPrev > 0.001) {
        addCrossSegment(i - 1)
      } else if (i > 0 && overlapPrev <= 0.001) {
        const gap = clip.startSec - mainClipEnd(prev!)
        if (gap > 0.001) addBlackSegment(gap)
      }
      addContentSegment(i)
    }

    if (segments.length) {
      const chainLabel =
        segments.length === 1
          ? segments[0]!
          : (() => {
              const label = 'mainconcat'
              filterParts.push(
                `${segments.map((s) => `[${s}]`).join('')}concat=n=${segments.length}:v=1:a=0[${label}]`
              )
              return label
            })()
      // concat 链从 0 起，整体平移到时间线真实起点后再叠到黑色底上
      const firstStart = Math.max(0, orderedMainVideos[0]!.startSec)
      const shiftedMain = 'mainshifted'
      filterParts.push(`[${chainLabel}]setpts=PTS+${firstStart.toFixed(3)}/TB[${shiftedMain}]`)
      filterParts.push(`[base][${shiftedMain}]overlay=0:0[mainbase]`)
      lastVideo = 'mainbase'
    }
  }

  const orderedOverlays = [...overlays].sort(
    (a, b) => normalizeClipLane(a.lane) - normalizeClipLane(b.lane) || a.startSec - b.startSec
  )
  for (const clip of orderedOverlays) {
    const dur = Math.max(0.05, clip.durationSec)
    const speed = clampClipSpeed(clip.speed)
    const freezeTail = Math.min(Math.max(0, dur - 0.05), clampClipFreezeTailSec(clip.freezeTailSec))
    const movingDur = Math.max(0.05, dur - freezeTail)
    const srcTrimDur = movingDur * speed
    const ptsExpr =
      Math.abs(speed - 1) > 0.005
        ? `setpts=(PTS-STARTPTS)/${speed.toFixed(3)}`
        : 'setpts=PTS-STARTPTS'
    const tpadOpt =
      freezeTail > 0.001 ? `,tpad=stop_mode=clone:stop_duration=${freezeTail.toFixed(3)}` : ''
    const cropExpr = buildClipCropFilter(clip)
    const cropOpt = cropExpr ? `,${cropExpr}` : ''
    const colorEq = buildClipColorEqFilter(clip)
    const eqOpt = colorEq ? `,${colorEq}` : ''

    const srcStart = clipSourceOffsetSec(clip)
    const srcTrimExpr =
      srcStart > 0
        ? `${srcStart}:${(srcStart + srcTrimDur).toFixed(3)}`
        : `0:${srcTrimDur.toFixed(3)}`
    const overlayBuilt = buildOverlayClipFfmpegFilterSteps({
      clip,
      inputIndex: clip.inputIndex,
      srcTrimExpr,
      ptsExpr,
      tpadOpt,
      cropOpt,
      eqOpt,
      width,
      height,
      fps,
      prevVideoLabel: lastVideo
    })
    filterParts.push(...overlayBuilt.steps)
    lastVideo = overlayBuilt.outVideoLabel
  }

  const font = findDrawtextFont()
  const fontOpt = font ? `:fontfile='${font.replace(/\\/g, '/').replace(/:/g, '\\:')}'` : ''

  const borderW =
    visualOptions?.subtitleBorderWidth != null && Number.isFinite(visualOptions.subtitleBorderWidth)
      ? Math.min(16, Math.max(0, Math.round(visualOptions.subtitleBorderWidth)))
      : 2
  const borderColor =
    visualOptions?.subtitleBorderColor &&
    /^#[0-9a-fA-F]{6}$/.test(visualOptions.subtitleBorderColor.trim())
      ? visualOptions.subtitleBorderColor.trim()
      : 'black'
  const boxEnabled = visualOptions?.subtitleBoxEnabled === true
  const boxColor =
    visualOptions?.subtitleBoxColor &&
    /^#[0-9a-fA-F]{6}$/.test(visualOptions.subtitleBoxColor.trim())
      ? visualOptions.subtitleBoxColor.trim()
      : 'black'
  const boxOpacity =
    visualOptions?.subtitleBoxOpacity != null && Number.isFinite(visualOptions.subtitleBoxOpacity)
      ? Math.min(1, Math.max(0.1, visualOptions.subtitleBoxOpacity))
      : 0.55
  const boxOpt = boxEnabled
    ? `:box=1:boxcolor=${boxColor}@${boxOpacity.toFixed(2)}:boxborderw=8`
    : ''
  const motionEnabled =
    visualOptions?.subtitleMotion !== false && visualOptions?.subtitleMotion !== 'none'

  for (const [i, sub] of subs.entries()) {
    const raw = (sub.text || sub.title).trim()
    if (!raw) continue
    const clipFontSize =
      sub.fontSize != null && Number.isFinite(sub.fontSize)
        ? Math.min(200, Math.max(12, Math.round(sub.fontSize)))
        : subtitleFontSize
    const clipColor =
      sub.textColor && /^#[0-9a-fA-F]{6}$/.test(sub.textColor.trim())
        ? sub.textColor.trim()
        : subtitleColor
    const maxChars = subtitleMaxCharsForWidth(width, clipFontSize)
    const lineHeight = Math.max(clipFontSize + 4, Math.round(clipFontSize * 1.28))
    const risePx = Math.max(12, Math.round(clipFontSize * 0.55))
    const lines = wrapSubtitleLines(raw, maxChars)
    if (!lines.length) continue
    const start = Math.max(0, sub.startSec)
    const end = start + Math.max(0.05, sub.durationSec)
    // 多行自下而上叠（多子轨 lane > 0 时自动向上偏移，避免同时间段双语/角色+注释字幕重叠）
    const laneOffsetPx = normalizeClipLane(sub.lane) * Math.round(lineHeight * 1.65)
    for (let li = 0; li < lines.length; li++) {
      const text = escapeDrawtext(lines[li]!)
      const fromBottom = subtitleYOffset + laneOffsetPx + (lines.length - 1 - li) * lineHeight
      const next = `sub${i}l${li}`
      if (motionEnabled) {
        const motion = buildSubtitleDrawtextMotion({
          startSec: start,
          endSec: end,
          fromBottom,
          risePx
        })
        filterParts.push(
          `[${lastVideo}]drawtext=text='${text}'${fontOpt}:fontsize=${clipFontSize}:fontcolor=${clipColor}:borderw=${borderW}:bordercolor=${borderColor}${boxOpt}:x=(w-text_w)/2:${motion.y}:${motion.alpha}:${motion.enable}[${next}]`
        )
      } else {
        filterParts.push(
          `[${lastVideo}]drawtext=text='${text}'${fontOpt}:fontsize=${clipFontSize}:fontcolor=${clipColor}:borderw=${borderW}:bordercolor=${borderColor}${boxOpt}:x=(w-text_w)/2:y=h-${fromBottom}-text_h:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'[${next}]`
        )
      }
      lastVideo = next
    }
  }

  if (watermark) {
    const targetW = Math.max(24, Math.round(width * Math.min(0.5, Math.max(0.05, watermark.scale))))
    const wmLabel = 'wm'
    const wmOvLabel = 'wmoverlay'
    const opacity = Math.min(1, Math.max(0.05, watermark.opacity))
    filterParts.push(
      `[${watermark.inputIndex}:v]scale=${targetW}:-1:force_original_aspect_ratio=decrease,format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[${wmLabel}]`
    )
    const margin = Math.max(12, Math.round(Math.min(width, height) * 0.03))
    const positionMap: Record<'br' | 'bl' | 'tr' | 'tl', string> = {
      br: `main_w-overlay_w-${margin}:main_h-overlay_h-${margin}`,
      bl: `${margin}:main_h-overlay_h-${margin}`,
      tr: `main_w-overlay_w-${margin}:${margin}`,
      tl: `${margin}:${margin}`
    }
    filterParts.push(
      `[${lastVideo}][${wmLabel}]overlay=${positionMap[watermark.position]}[${wmOvLabel}]`
    )
    lastVideo = wmOvLabel
  }

  // 计算配音闪避区间：当启用 mixAutoDucking 且配音轨未静音时，收集所有配音活跃区间
  const voiceIntervals: Array<[number, number]> = []
  if (mix?.mixAutoDucking && !mix?.mutedTracks?.includes('voice')) {
    const rawVoiceRanges = audios
      .filter((c) => c.track === 'voice' && (c.volume ?? 1) > 0.01)
      .map(
        (c) =>
          [Math.max(0, c.startSec - 0.08), c.startSec + Math.max(0.05, c.durationSec) + 0.12] as [
            number,
            number
          ]
      )
      .sort((a, b) => a[0] - b[0])
    for (const [s, e] of rawVoiceRanges) {
      const last = voiceIntervals[voiceIntervals.length - 1]
      if (last && s <= last[1] + 0.15) {
        last[1] = Math.max(last[1], e)
      } else {
        voiceIntervals.push([s, e])
      }
    }
  }
  const duckRatio =
    mix?.mixDuckingRatio != null && Number.isFinite(mix.mixDuckingRatio)
      ? Math.min(0.8, Math.max(0.05, mix.mixDuckingRatio))
      : 0.25
  const stemDuckRatio = Math.min(0.85, Math.max(0.38, duckRatio * 1.68))
  const duckEnableExpr =
    voiceIntervals.length > 0
      ? voiceIntervals.map(([s, e]) => `between(t\\,${s.toFixed(2)}\\,${e.toFixed(2)})`).join('+')
      : ''

  const audioMixInputs: string[] = [`[${baseAudioIndex}:a]`]
  for (const clip of audios) {
    const startMs = Math.max(0, Math.round(clip.startSec * 1000))
    const dur = Math.max(0.05, clip.durationSec)
    const freezeTail =
      clip.track === 'video' || clip.track === 'overlay'
        ? Math.min(Math.max(0, dur - 0.05), clampClipFreezeTailSec(clip.freezeTailSec))
        : 0
    const playDur = Math.max(0.05, dur - freezeTail)
    const speed = clampClipSpeed(clip.speed)
    const srcStart = clipSourceOffsetSec(clip)
    const srcDur = Number((playDur * speed).toFixed(3))
    const atempoChain = buildAtempoChain(speed)

    const clipVolume = Number.isFinite(clip.volume) ? Math.min(1, Math.max(0, clip.volume!)) : 1
    const trackGain = Number.isFinite(mix?.mixGains?.[clip.track])
      ? Math.min(2, Math.max(0, mix!.mixGains![clip.track]!))
      : 1
    // 轨道静音优先级最高：高于片段音量与混音器轨道增益
    const volume = mix?.mutedTracks?.includes(clip.track) ? 0 : Math.min(2, clipVolume * trackGain)
    const fadeIn = Number.isFinite(clip.fadeInSec)
      ? Math.min(playDur, Math.max(0, clip.fadeInSec!))
      : 0
    const fadeOut = Number.isFinite(clip.fadeOutSec)
      ? Math.min(playDur, Math.max(0, clip.fadeOutSec!))
      : 0
    const aLabel = `a${clip.inputIndex}`
    const chain = [
      `atrim=${srcStart > 0 ? `${srcStart}:${(srcStart + srcDur).toFixed(3)}` : `0:${srcDur}`}`,
      'asetpts=PTS-STARTPTS',
      atempoChain,
      Math.abs(volume - 1) > 0.001 ? `volume=${volume.toFixed(3)}` : '',
      fadeIn > 0 ? `afade=t=in:st=0:d=${fadeIn.toFixed(3)}` : '',
      fadeOut > 0
        ? `afade=t=out:st=${Math.max(0, playDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`
        : '',
      `adelay=${startMs}|${startMs}`,
      clip.track === 'music' && duckEnableExpr
        ? `volume=${duckRatio.toFixed(3)}:enable='${duckEnableExpr}'`
        : (clip.track === 'video' || clip.track === 'sfx') && duckEnableExpr
          ? `volume=${stemDuckRatio.toFixed(3)}:enable='${duckEnableExpr}'`
          : ''
    ]
      .filter(Boolean)
      .join(',')
    filterParts.push(`[${clip.inputIndex}:a]${chain}[${aLabel}]`)
    audioMixInputs.push(`[${aLabel}]`)
  }

  filterParts.push(
    `${audioMixInputs.join('')}amix=inputs=${audioMixInputs.length}:duration=longest:dropout_transition=0:normalize=0[amixout]`
  )

  // 混音器后处理：主输出增益 → 基础 EQ（低频 / 高频）→ 可选动态压缩 → 可选响度标准化
  const masterGain = Number.isFinite(mix?.mixMasterGain)
    ? Math.min(2, Math.max(0, mix!.mixMasterGain!))
    : 1
  const bassDb = Number.isFinite(mix?.mixBassGainDb)
    ? Math.min(12, Math.max(-12, mix!.mixBassGainDb!))
    : 0
  const trebleDb = Number.isFinite(mix?.mixTrebleGainDb)
    ? Math.min(12, Math.max(-12, mix!.mixTrebleGainDb!))
    : 0
  const postChain: string[] = []
  if (Math.abs(masterGain - 1) > 0.001) {
    postChain.push(`volume=${masterGain.toFixed(3)}`)
  }
  if (Math.abs(bassDb) > 0.01) {
    postChain.push(`equalizer=f=120:t=q:w=1:g=${bassDb.toFixed(2)}`)
  }
  if (Math.abs(trebleDb) > 0.01) {
    postChain.push(`equalizer=f=8000:t=q:w=1:g=${trebleDb.toFixed(2)}`)
  }
  if (mix?.mixCompression) {
    postChain.push(`acompressor=threshold=0.2:ratio=2:attack=20:release=250:makeup=1`)
  }
  if (mix?.mixLoudnorm) {
    postChain.push(`loudnorm=I=-16:TP=-1.5:LRA=11`)
  }
  if (postChain.length) {
    const postLabel = 'amixpost'
    filterParts.push(`[amixout]${postChain.join(',')}[${postLabel}]`)
    filterParts.push(`[${postLabel}]anull[aout]`)
  } else {
    filterParts.push(`[amixout]anull[aout]`)
  }

  if (rate !== 1) {
    const clamped = clampClipSpeed(rate)
    const rateAtempo = buildAtempoChain(clamped) || `atempo=${Math.min(2, Math.max(0.5, clamped))}`
    filterParts.push(`[${lastVideo}]setpts=PTS/${clamped}[vout]`)
    filterParts.push(`[aout]${rateAtempo}[aouts]`)
    return { filter: filterParts.join(';'), mapVideo: '[vout]', mapAudio: '[aouts]' }
  }
  return { filter: filterParts.join(';'), mapVideo: `[${lastVideo}]`, mapAudio: '[aout]' }
}

/**
 * 准备输入参数与滤镜图（导出 MP4 与抽帧预览共用同一条流水线）。
 *
 * 两条链路拿到同一份 filter：预览看到的画面与导出严格一致，
 * 不会出现「预览好看、导出难看」的口径差——转场预览微渲染遵循的也是这条约定。
 */
export function prepareTimelinePipeline(
  input: TimelineExportInput,
  options?: { audioPaths?: ReadonlySet<string> }
): {
  args: string[]
  filter: string
  mapVideo: string
  mapAudio: string
  duration: number
  rate: number
  width: number
  height: number
  fps: number
  videoBitrateKbps: number
} {
  const duration = Math.max(1, input.durationSec)
  const rate = input.playbackRate && input.playbackRate > 0 ? input.playbackRate : 1
  const width = Math.min(7680, Math.max(320, Math.round(input.width ?? 1280)))
  const height = Math.min(4320, Math.max(180, Math.round(input.height ?? 720)))
  const fps = Math.min(60, Math.max(1, Math.round(input.fps ?? 30)))
  const videoBitrateKbps = Math.min(
    200000,
    Math.max(500, Math.round(input.videoBitrateKbps ?? 5000))
  )
  const subtitleFontSize = Math.min(200, Math.max(12, Math.round(input.subtitleFontSize ?? 36)))
  const subtitleYOffset = Math.min(1000, Math.max(0, Math.round(input.subtitleYOffset ?? 80)))
  const subtitleColor =
    input.subtitleColor && /^#[0-9a-fA-F]{6}$/.test(input.subtitleColor.trim())
      ? input.subtitleColor.trim()
      : 'white'

  const mainVideoClips = input.clips.filter((c) => c.track === 'video')
  const overlayClips = input.clips.filter((c) => c.track === 'overlay')
  const voiceMusicClips = input.clips.filter(
    (c) => c.track === 'voice' || c.track === 'music' || c.track === 'sfx'
  )
  const subs = input.clips.filter(
    (c) => c.track === 'subtitle' && (c.text?.trim() || c.title.trim())
  )

  const args: string[] = ['-y', '-hide_banner', '-loglevel', 'error']
  let inputIndex = 0

  args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:d=${duration}:r=${fps}`)
  const baseVideoIndex = inputIndex++
  args.push('-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100:d=${duration}`)
  const baseAudioIndex = inputIndex++

  const pushVisualInputArgs = (clip: TimelineExportClip, path: string): void => {
    const clipInputDur = Math.max(
      1,
      Math.ceil(
        clipSourceOffsetSec(clip) +
          Math.max(0.05, clip.durationSec) * clampClipSpeed(clip.speed ?? 1) +
          1
      )
    )
    if (isStillImagePath(path)) {
      args.push('-loop', '1', '-t', String(clipInputDur), '-i', path)
    } else if (isAnimatedGifPath(path)) {
      args.push('-ignore_loop', '0', '-t', String(clipInputDur), '-i', path)
    } else {
      args.push('-i', path)
    }
  }

  const mainVideos: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of mainVideoClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    pushVisualInputArgs(clip, path)
    mainVideos.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  const audioOnlyInputs: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of voiceMusicClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    args.push('-i', path)
    audioOnlyInputs.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  const overlays: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const clip of overlayClips) {
    const path = resolveClipPath(clip)
    if (!path) continue
    pushVisualInputArgs(clip, path)
    overlays.push({ ...clip, path, inputIndex: inputIndex++ })
  }

  let watermarkInputIndex: number | undefined
  const watermarkSrc = input.watermarkSrc?.trim()
  if (watermarkSrc && existsSync(watermarkSrc)) {
    args.push('-i', watermarkSrc)
    watermarkInputIndex = inputIndex++
  }

  if (!mainVideos.length && !overlays.length && !audioOnlyInputs.length) {
    throw fail(E_TIMELINE_NO_EXPORTABLE_CLIPS)
  }

  const hasAudioForPath = (path: string): boolean => {
    if (isImageOrGifPath(path)) return false
    return options?.audioPaths ? options.audioPaths.has(path) : true
  }

  const mainVideoAudios = mainVideos.filter(
    (c) => !input.mutedTracks?.includes('video') && (c.volume ?? 1) > 0 && hasAudioForPath(c.path)
  )
  const overlayAudios = overlays.filter(
    (c) => !input.mutedTracks?.includes('overlay') && (c.volume ?? 1) > 0 && hasAudioForPath(c.path)
  )
  const validAudioOnly = audioOnlyInputs.filter((c) => hasAudioForPath(c.path))

  const audios = [...mainVideoAudios, ...validAudioOnly, ...overlayAudios]
  const { filter, mapVideo, mapAudio } = buildFilterGraph(
    mainVideos,
    overlays,
    audios,
    subs,
    baseVideoIndex,
    baseAudioIndex,
    rate,
    width,
    height,
    fps,
    subtitleFontSize,
    subtitleYOffset,
    subtitleColor,
    {
      mixGains: input.mixGains,
      mixMasterGain: input.mixMasterGain,
      mixBassGainDb: input.mixBassGainDb,
      mixTrebleGainDb: input.mixTrebleGainDb,
      mixCompression: input.mixCompression,
      mixAutoDucking: input.mixAutoDucking,
      mixDuckingRatio: input.mixDuckingRatio,
      mixLoudnorm: input.mixLoudnorm,
      mutedTracks: input.mutedTracks
    },
    watermarkInputIndex === undefined
      ? undefined
      : {
          inputIndex: watermarkInputIndex,
          opacity: input.watermarkOpacity ?? 0.8,
          scale: input.watermarkScale ?? 0.1,
          position:
            input.watermarkPosition === 'bl' ||
            input.watermarkPosition === 'tr' ||
            input.watermarkPosition === 'tl'
              ? input.watermarkPosition
              : 'br'
        },
    {
      scaleMode: input.scaleMode,
      subtitleBorderColor: input.subtitleBorderColor,
      subtitleBorderWidth: input.subtitleBorderWidth,
      subtitleBoxEnabled: input.subtitleBoxEnabled,
      subtitleBoxColor: input.subtitleBoxColor,
      subtitleBoxOpacity: input.subtitleBoxOpacity,
      subtitleMotion: input.subtitleMotion
    }
  )

  return { args, filter, mapVideo, mapAudio, duration, rate, width, height, fps, videoBitrateKbps }
}

async function encodeTimeline(
  bin: string,
  input: TimelineExportInput,
  outPath: string,
  onProgress?: (ratio: number) => void
): Promise<void> {
  onProgress?.(0.04)
  const audioPaths = await probeAudioPathsForTimeline(bin, input.clips)
  onProgress?.(0.08)
  const pipeline = prepareTimelinePipeline(input, { audioPaths })
  pipeline.args.push(
    '-stats',
    '-filter_complex',
    pipeline.filter,
    '-map',
    pipeline.mapVideo,
    '-map',
    pipeline.mapAudio,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-b:v',
    `${pipeline.videoBitrateKbps}k`,
    '-movflags',
    '+faststart',
    '-t',
    String(pipeline.duration / pipeline.rate),
    outPath
  )

  const totalSec = Math.max(0.1, pipeline.duration / pipeline.rate)
  await runFfmpeg(bin, pipeline.args, (sec) => {
    const rawRatio = Math.min(1, Math.max(0, sec / totalSec))
    onProgress?.(Math.min(0.98, 0.08 + rawRatio * 0.9))
  })
}

function probeFfmpeg(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-version'], { windowsHide: true })
    let settled = false
    const done = (ok: boolean) => {
      if (settled) return
      settled = true
      resolve(ok)
    }
    child.on('error', () => done(false))
    child.on('close', (code) => done(code === 0))
    setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      done(false)
    }, 4000)
  })
}

/** 抽帧预览的单帧：timeSec 是它在成片时间线上的位置 */
export type TimelinePreviewFrame = { timeSec: number; dataUrl: string }

export type TimelinePreviewResult =
  { ok: true; frames: TimelinePreviewFrame[]; width: number } | { ok: false; error: string }

/**
 * 抽帧预览：用导出同一条滤镜图，在指定时间点各取一帧（JPEG）。
 *
 * - 与「先导出 MP4 再抽帧」的区别：不落中间视频、不编码整片，只解码到最晚的那个时间点；
 * - 与逐帧 `-ss` 重跑的区别：一次解码、多路输出（split + trim），抽 6 帧不是跑 6 遍；
 * - 输出 JPEG 而不是 PNG：单帧体积小一个量级，回给 Agent 的响应不至于撑爆。
 *
 * 时间点靠后时要解码到那个位置，长片会慢——调用方（`timeline_preview`）负责提示。
 */
export async function renderTimelineFrames(
  input: TimelineExportInput,
  timestamps: number[],
  options?: { width?: number; quality?: number }
): Promise<TimelinePreviewResult> {
  try {
    if (!projectService.isOpen()) {
      return { ok: false, error: fail(MAIN_ERRORS.noProject).message }
    }
    if (!timestamps.length) {
      return { ok: false, error: fail(E_TIMELINE_NO_PREVIEW_FRAMES).message }
    }

    const bin = findFfmpegBin()
    if (!(await probeFfmpeg(bin))) {
      return { ok: false, error: fail(E_TIMELINE_FFMPEG_MISSING).message }
    }

    const audioPaths = await probeAudioPathsForTimeline(bin, input.clips)
    const pipeline = prepareTimelinePipeline(input, { audioPaths })
    const frameWidth = Math.min(
      1280,
      Math.max(160, Math.round(options?.width ?? PREVIEW_FRAME_WIDTH))
    )
    const quality = Math.min(12, Math.max(2, Math.round(options?.quality ?? PREVIEW_JPEG_QUALITY)))

    const framePlan = buildPreviewFramePlan({
      mapVideo: pipeline.mapVideo,
      timestamps,
      width: frameWidth
    })

    const workDir = mkdtempSync(join(tmpdir(), 'aiart-preview-'))
    try {
      const args = [
        ...pipeline.args,
        '-filter_complex',
        `${pipeline.filter};${framePlan.filterParts.join(';')}`
      ]
      const files = framePlan.outputs.map((_, index) => join(workDir, `frame-${index}.jpg`))
      framePlan.outputs.forEach((output, index) => {
        // -update 1：单文件名输出单帧，明确让 image2 muxer 覆盖同一个文件而不是去找序号
        args.push(
          '-map',
          `[${output.label}]`,
          '-frames:v',
          '1',
          '-update',
          '1',
          '-q:v',
          String(quality),
          files[index]
        )
      })
      // 滤镜图里的音频链末端 pad 必须有人接：未连接的 filter 输出会让 ffmpeg 直接报错。
      // 接到 null muxer 并用 -t 收在最晚的抽帧点上——音频只解码到那一刻，不拖慢抽帧。
      args.push(
        '-map',
        pipeline.mapAudio,
        '-t',
        Math.max(...timestamps).toFixed(3),
        '-f',
        'null',
        '-'
      )

      await runFfmpeg(bin, args)

      const frames: TimelinePreviewFrame[] = []
      files.forEach((file, index) => {
        if (!existsSync(file)) return
        const buf = readFileSync(file)
        if (!buf.length) return
        frames.push({
          timeSec: framePlan.outputs[index].timeSec,
          dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}`
        })
      })
      if (!frames.length) {
        return { ok: false, error: fail(E_TIMELINE_PREVIEW_FAILED).message }
      }
      return { ok: true, frames, width: frameWidth }
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function exportScriptTimeline(
  input: TimelineExportInput
): Promise<TimelineExportResult> {
  try {
    if (!projectService.isOpen()) {
      return { ok: false, error: fail(MAIN_ERRORS.noProject).message }
    }

    const bin = findFfmpegBin()
    const hasFfmpeg = await probeFfmpeg(bin)
    if (!hasFfmpeg) {
      // code = TIMELINE_FFMPEG_MISSING；消息含 FFmpeg 关键字，渲染端正则兜底仍可命中
      return { ok: false, error: fail(E_TIMELINE_FFMPEG_MISSING).message }
    }

    // 目标路径：Agent / 无界面链路直接给绝对路径（不弹对话框），界面上仍走「另存为」
    let outPath: string
    const targetPath = input.targetPath?.trim()
    if (targetPath) {
      outPath = extname(targetPath) ? targetPath : `${targetPath}.mp4`
      try {
        mkdirSync(dirname(outPath), { recursive: true })
      } catch {
        /* 父目录创建失败由后续写入报错暴露 */
      }
    } else {
      const save = await dialog.showSaveDialog({
        title: '导出成片',
        defaultPath: input.defaultFileName || 'timeline-export.mp4',
        filters: [
          { name: 'MP4', extensions: ['mp4'] },
          { name: 'All Files', extensions: ['*'] }
        ],
        properties: ['createDirectory', 'showOverwriteConfirmation']
      })
      if (save.canceled || !save.filePath) {
        return { ok: false, canceled: true, error: fail(E_TIMELINE_CANCELLED).message }
      }
      outPath = save.filePath
      if (!extname(outPath)) outPath = `${outPath}.mp4`
    }

    broadcastToAllWindows(IpcChannels.TIMELINE_EXPORT_PROGRESS, { progress: 0.02 })

    const workDir = mkdtempSync(join(tmpdir(), 'aiart-timeline-'))
    const tempOut = join(workDir, 'export.mp4')

    try {
      await encodeTimeline(bin, input, tempOut, (ratio) => {
        broadcastToAllWindows(IpcChannels.TIMELINE_EXPORT_PROGRESS, {
          progress: Math.max(0.05, Math.min(0.95, ratio))
        })
      })
      copyFileSync(tempOut, outPath)
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }

    let assetId: string | undefined
    try {
      const asset = projectService.attachExternalGeneratedFile({
        type: 'video',
        sourceFilePath: outPath,
        name: basename(outPath, extname(outPath)) || 'Timeline Export'
      })
      assetId = asset.id
      broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
    } catch {
      /* 另存为成功即可 */
    }

    broadcastToAllWindows(IpcChannels.TIMELINE_EXPORT_PROGRESS, { progress: 1 })
    return { ok: true, filePath: outPath, assetId, engine: 'ffmpeg' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message }
  }
}
