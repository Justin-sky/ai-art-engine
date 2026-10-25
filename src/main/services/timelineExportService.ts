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
import { join, basename, dirname, extname, resolve, relative, isAbsolute } from 'path'
import { PNG } from 'pngjs'
import {
  buildClipVisualFfmpegFilter,
  buildMainClipCameraFfmpegFilter,
  buildOverlayClipFfmpegFilterSteps,
  buildSubtitleKeyframeFfmpegXYExpr,
  clampClipFreezeTailSec,
  clampClipPitchSemitones,
  clampClipSpeed,
  computeTimelineWidgetTimeSlices,
  evaluateSubtitleClipPosition,
  getSubtitleClipWordTimings,
  isTimelineVoiceEffectId,
  normalizeClipCropRect,
  normalizeClipLane,
  syncTimelineCueAnchors,
  synthesizeTimelineSfxWavBytes,
  TIER_LEVEL_COLORS,
  TIER_LEVELS,
  type ScriptTimelineScaleMode,
  type ScriptTimelineTrackKind,
  type TimelineExportClip,
  type TimelineExportInput,
  type TimelineExportResult,
  type TimelineMixGains,
  type TimelineProceduralSfxId,
  type TimelineSubtitleKaraokeMode,
  type TimelineVoiceEffectId,
  type TimelineWidgetConfig
} from '@shared/graph'
import { IpcChannels } from '@shared/ipc'
import { fail, defErrSimple } from '@shared/errors/appError'
import { MAIN_ERRORS } from '../errors/messages'
import { projectService } from './projectService'
import { buildPreviewFramePlan } from '@shared/graph/timelinePreview'
import { findFfmpegBin } from './videoFrameService'
import { runFfmpeg } from './ffmpegRunner'
import { renderGuichuSingingClipWav } from './vocalSingingService'
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
export function buildAtempoChain(speed: number, allowWideRange = false): string {
  const raw = Number(speed)
  let rem = allowWideRange
    ? Number.isFinite(raw) && raw > 0
      ? Math.min(16, Math.max(0.0625, raw))
      : 1
    : clampClipSpeed(speed)
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

/**
 * 构建片段级半音变调（Pitch Shift）与鬼畜变声特效（Voice Effect）滤镜链：
 * - 利用 `aresample=44100,asetrate=44100*2^(s/12),aresample=44100` 实现零外部依赖的精确半音移调；
 * - 通过 `atempo = speed / 2^(s/12)` 精确抵消 `asetrate` 引起的时长变化，确保变调后片段时长严格保持 `playDur`，不破坏节拍网格！
 */
export function buildClipPitchAndVoiceFilter(
  speed: number,
  pitchSemitones?: number,
  voiceEffect?: TimelineVoiceEffectId
): string {
  const safeSpeed = clampClipSpeed(speed)
  let semitones = clampClipPitchSemitones(pitchSemitones)
  const effect = isTimelineVoiceEffectId(voiceEffect) ? voiceEffect : 'none'
  if (Math.abs(semitones) < 0.05) {
    if (effect === 'chipmunk') semitones = 4
    else if (effect === 'demon') semitones = -4
    else if (effect === 'autotune-chorus' || effect === 'echo' || effect === 'robot') semitones = 3
    else if (effect === 'megaphone') semitones = 2
  }

  const parts: string[] = []
  if (Math.abs(semitones) >= 0.05) {
    const pitchRatio = Math.pow(2, semitones / 12)
    const targetRate = Math.max(8000, Math.min(192000, Math.round(44100 * pitchRatio)))
    const compensatedTempo = safeSpeed / pitchRatio
    parts.push('aresample=44100', `asetrate=${targetRate}`, 'aresample=44100')
    const tempoChain = buildAtempoChain(compensatedTempo, true)
    if (tempoChain) parts.push(tempoChain)
  } else {
    const tempoChain = buildAtempoChain(safeSpeed)
    if (tempoChain) parts.push(tempoChain)
  }

  // 《敢杀我的马》（BV1yt4y1Q7SS）同款干声提纯与共振峰补偿（Formant Compensation）：
  // 1) 切除原片 <185Hz 浑浊低频轰鸣与 >7200Hz 底噪，衰减 320Hz 盒音，防止原片自带 BGM 与鬼畜伴奏打架；
  // 2) 当 asetrate 移调时，反向补偿声道共振峰（升调时补 420Hz 胸腔厚度并压 950Hz 鼻音尖刺，告别劣质花栗鼠感）；
  // 3) 提升 2600Hz 咬字穿透力，配合快速瞬态压缩（acompressor）让每个字像打击乐一样清脆贴耳。
  const hasVocalFxOrPitch = effect !== 'none' || Math.abs(semitones) >= 0.05
  if (hasVocalFxOrPitch) {
    parts.push(
      'highpass=f=185',
      'lowpass=f=7200',
      'afftdn=nr=12:nf=-28',
      'equalizer=f=320:t=q:w=1.3:g=-4'
    )
    if (semitones >= 1.5 && effect !== 'chipmunk') {
      const warmthGain = Math.min(5, Math.round(semitones * 0.7))
      const nasalCut = -Math.min(5, Math.round(semitones * 0.65))
      parts.push(
        `equalizer=f=420:t=q:w=1.1:g=${warmthGain}`,
        `equalizer=f=950:t=q:w=1.3:g=${nasalCut}`
      )
    } else if (semitones <= -1.5 && effect !== 'demon') {
      parts.push('equalizer=f=450:t=q:w=1.2:g=-3', 'equalizer=f=1800:t=q:w=1.1:g=3')
    }
    // 当原声被慢放拉长（speed < 0.85）作为歌唱拖腔时，自动注入自然歌唱颤音（Vibrato），让拉长的元音变成悠扬唱腔
    if (safeSpeed < 0.85) {
      parts.push('vibrato=f=5.6:d=0.18')
    }
  }

  // 计算当前半音对应的合成器共鸣周期（以 A3=220Hz 为基准音阶）
  const noteFreqHz = 220 * Math.pow(2, semitones / 12)
  const combDelay1Ms = Math.max(1.5, Math.min(12, 1000 / noteFreqHz))
  const combDelay2Ms = Math.min(24, combDelay1Ms * 2)
  const d1 = combDelay1Ms.toFixed(2)
  const d2 = combDelay2Ms.toFixed(2)

  if (effect === 'chipmunk') {
    parts.push(
      'aecho=0.72:0.75:20|119:0.24|0.18',
      'equalizer=f=2800:t=q:w=1.2:g=4',
      'acompressor=threshold=0.14:ratio=4:attack=4:release=55:makeup=1.35',
      'extrastereo=m=1.3',
      'volume=1.25'
    )
  } else if (effect === 'demon') {
    parts.push(
      'aecho=0.72:0.75:24|238:0.26|0.18',
      'equalizer=f=125:t=q:w=0.9:g=6',
      'equalizer=f=2400:t=q:w=1.2:g=4',
      'acompressor=threshold=0.14:ratio=4:attack=4:release=55:makeup=1.4',
      'volume=1.3'
    )
  } else if (effect === 'robot') {
    // 清澈人力 VOCALOID 电音合成器（带音高谐振周期与立体声加宽，无破音失真）
    parts.push(
      `aecho=0.70:0.72:${d1}|${d2}|22:0.30|0.18|0.14`,
      'flanger=delay=1.4:depth=2.0:regen=28:width=72:speed=2.2',
      'equalizer=f=2700:t=q:w=1.1:g=4.5',
      'acompressor=threshold=0.12:ratio=4.5:attack=4:release=50:makeup=1.45',
      'extrastereo=m=1.35',
      'volume=1.28'
    )
  } else if (effect === 'autotune-chorus') {
    // 《敢杀我的马》同款清澈主唱双声道加厚(20ms Haas)，干脆利落不拖泥带水、不掩盖下一句台词
    parts.push(
      'aecho=0.78:0.80:20:0.18',
      'equalizer=f=2600:t=q:w=1.1:g=4.5',
      'acompressor=threshold=0.12:ratio=4.5:attack=4:release=50:makeup=1.42',
      'extrastereo=m=1.35',
      'volume=1.26'
    )
  } else if (effect === 'echo') {
    // 当原声慢放拉长变唱歌（safeSpeed < 0.85）时，使用平滑双声道合唱共鸣（避免 238ms/476ms 延迟与拉长元音自身叠音打架）；
    // 常规语速下使用 126BPM 半拍(238ms) + 一拍(476ms) 尾音卡点伴唱回声
    parts.push(
      safeSpeed < 0.85 ? 'aecho=0.78:0.80:22:0.20' : 'aecho=0.70:0.74:238|476:0.36|0.22',
      'equalizer=f=2600:t=q:w=1.1:g=4',
      'acompressor=threshold=0.12:ratio=4:attack=4:release=55:makeup=1.4',
      'extrastereo=m=1.45',
      'volume=1.28'
    )
  } else if (effect === 'megaphone') {
    parts.push(
      'highpass=f=320',
      'lowpass=f=4200',
      'equalizer=f=1800:t=q:w=1.0:g=6',
      'aecho=0.72:0.75:18|119:0.24|0.16',
      'acompressor=threshold=0.12:ratio=5:attack=4:release=50:makeup=1.45',
      'volume=1.32'
    )
  } else if (Math.abs(semitones) >= 0.5) {
    parts.push(
      'equalizer=f=2600:t=q:w=1.1:g=4',
      'acompressor=threshold=0.14:ratio=4:attack=4:release=55:makeup=1.35',
      'extrastereo=m=1.25',
      'volume=1.22'
    )
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
  if (/procedural-(pop|whoosh|ding|boom)\.wav$/i.test(filePath.trim())) {
    return Promise.resolve(true)
  }
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
  const normId = stickerId
    .replace(/^vfx:\/\//i, '')
    .replace(/^vfx-/i, '')
    .trim()

  if (
    normId === 'comic-boom' ||
    normId === 'neon-slash-combo' ||
    normId === 'electric-lightning' ||
    normId === 'fire-burst' ||
    normId === 'laser-beam' ||
    normId === 'shockwave-ring' ||
    normId === 'speed-lines'
  ) {
    const png = new PNG({ width: 640, height: 360 })
    const cx = 320
    const cy = 180
    if (normId === 'comic-boom') {
      // 漫威式冲击星芒 + 双层爆裂光环
      const rays = 16
      for (let i = 0; i < rays; i++) {
        const ang = (i * Math.PI * 2) / rays
        const rIn = i % 2 === 0 ? 48 : 68
        const rOut = i % 2 === 0 ? 270 : 195
        const col: [number, number, number] = i % 2 === 0 ? [250, 204, 21] : [244, 63, 94]
        drawThickLine(
          png,
          cx + Math.cos(ang) * rIn,
          cy + Math.sin(ang) * rIn,
          cx + Math.cos(ang) * rOut,
          cy + Math.sin(ang) * rOut,
          i % 2 === 0 ? 11 : 7,
          col,
          0.92
        )
      }
      drawCircleRing(png, cx, cy, 118, 12, [244, 63, 94], 0.94, false)
      drawCircleRing(png, cx, cy, 82, 10, [250, 204, 21], 0.96, false)
      drawCircleRing(png, cx, cy, 38, 1, [255, 255, 255], 0.88, true)
      return PNG.sync.write(png)
    }

    if (normId === 'neon-slash-combo') {
      // 霓虹双色交叉连斩刀光
      const slashes: Array<[number, number, number, number, [number, number, number]]> = [
        [36, 316, 604, 44, [34, 211, 238]],
        [52, 48, 588, 312, [232, 121, 249]],
        [18, 195, 622, 145, [250, 204, 21]]
      ]
      for (const [x0, y0, x1, y1, col] of slashes) {
        drawThickLine(png, x0, y0, x1, y1, 16, col, 0.42)
        drawThickLine(png, x0, y0, x1, y1, 8, col, 0.92)
        drawThickLine(png, x0, y0, x1, y1, 3.2, [255, 255, 255], 0.98)
      }
      drawCircleRing(png, cx, cy, 56, 5, [34, 211, 238], 0.85, false)
      return PNG.sync.write(png)
    }

    if (normId === 'electric-lightning') {
      // 高压雷霆折线电弧
      const bolts: Array<Array<[number, number]>> = [
        [
          [40, 30],
          [160, 110],
          [130, 155],
          [290, 210],
          [260, 260],
          [430, 330]
        ],
        [
          [600, 28],
          [470, 105],
          [505, 150],
          [340, 220],
          [380, 265],
          [210, 335]
        ],
        [
          [80, 180],
          [220, 150],
          [320, 195],
          [440, 160],
          [570, 190]
        ]
      ]
      for (let b = 0; b < bolts.length; b++) {
        const pts = bolts[b]!
        const outerCol: [number, number, number] = b % 2 === 0 ? [56, 189, 248] : [192, 132, 252]
        for (let i = 0; i < pts.length - 1; i++) {
          const [x0, y0] = pts[i]!
          const [x1, y1] = pts[i + 1]!
          drawThickLine(png, x0, y0, x1, y1, 12, outerCol, 0.48)
          drawThickLine(png, x0, y0, x1, y1, 5.5, outerCol, 0.95)
          drawThickLine(png, x0, y0, x1, y1, 2.2, [255, 255, 255], 0.98)
        }
      }
      return PNG.sync.write(png)
    }

    if (normId === 'fire-burst') {
      // 烈焰爆燃双环与放射火舌
      drawCircleRing(png, cx, cy, 136, 18, [239, 68, 68], 0.78, false)
      drawCircleRing(png, cx, cy, 98, 14, [249, 115, 22], 0.9, false)
      drawCircleRing(png, cx, cy, 62, 10, [250, 204, 21], 0.96, false)
      for (let i = 0; i < 20; i++) {
        const ang = (i * Math.PI * 2) / 20
        drawThickLine(
          png,
          cx + Math.cos(ang) * 58,
          cy + Math.sin(ang) * 58,
          cx + Math.cos(ang) * (i % 2 === 0 ? 220 : 165),
          cy + Math.sin(ang) * (i % 2 === 0 ? 220 : 165),
          i % 2 === 0 ? 9 : 5,
          i % 2 === 0 ? [249, 115, 22] : [250, 204, 21],
          0.88
        )
      }
      return PNG.sync.write(png)
    }

    if (normId === 'laser-beam') {
      // 高能等离子贯穿激光炮
      drawThickLine(png, 10, cy, 630, cy, 34, [236, 72, 153], 0.38)
      drawThickLine(png, 10, cy, 630, cy, 18, [34, 211, 238], 0.88)
      drawThickLine(png, 10, cy, 630, cy, 7, [255, 255, 255], 0.98)
      drawCircleRing(png, 110, cy, 52, 8, [236, 72, 153], 0.92, false)
      drawCircleRing(png, 110, cy, 26, 1, [255, 255, 255], 0.96, true)
      return PNG.sync.write(png)
    }

    // shockwave-ring / speed-lines：高能冲击波环 + 动漫集中速度线
    drawCircleRing(png, cx, cy, 152, 10, [34, 211, 238], 0.88, false)
    drawCircleRing(png, cx, cy, 112, 6, [232, 121, 249], 0.85, false)
    for (let i = 0; i < 28; i++) {
      const ang = (i * Math.PI * 2) / 28
      const rIn = i % 2 === 0 ? 118 : 142
      const rOut = 340
      drawThickLine(
        png,
        cx + Math.cos(ang) * rIn,
        cy + Math.sin(ang) * rIn,
        cx + Math.cos(ang) * rOut,
        cy + Math.sin(ang) * rOut,
        i % 2 === 0 ? 4.5 : 2.5,
        i % 3 === 0 ? [250, 204, 21] : [255, 255, 255],
        0.86
      )
    }
    return PNG.sync.write(png)
  }

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

function drawFilledRect(
  png: PNG,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: [number, number, number],
  alpha = 1
): void {
  const minX = Math.max(0, Math.floor(x0))
  const maxX = Math.min(png.width - 1, Math.ceil(x0 + w))
  const minY = Math.max(0, Math.floor(y0))
  const maxY = Math.min(png.height - 1, Math.ceil(y0 + h))
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      blendPixel(png, x, y, rgb[0], rgb[1], rgb[2], alpha)
    }
  }
}

/**
 * 主进程纯 JS 动态信息图组件（TierBoard 梯度榜 / 排行榜 / PK 计分板 / 步骤揭示卡 / 数据弹窗）光栅化器：
 * 当无界面 / 单测 / MCP 直接调用导出且未提供渲染端预光栅化的 `widgetStateSnapshots` 时，
 * 用 pngjs 绘制高对比度 32-bit RGBA PNG 图层（文字由后续 drawtext 或内置色块呈现）。
 */
export function renderTimelineWidgetPngBuffer(
  config: TimelineWidgetConfig,
  localTimeSec = 9999
): Buffer {
  const png = new PNG({ width: 640, height: 280 })
  const bgDark: [number, number, number] = [12, 18, 30]
  const rowBg: [number, number, number] = [24, 34, 52]
  const cardBg: [number, number, number] = [38, 52, 78]
  const accent = parseHexRgb(config.accentColor, [245, 158, 11])
  const white: [number, number, number] = [248, 250, 252]

  // 外框底板与描边
  drawFilledRect(png, 4, 4, 632, 272, bgDark, 0.88)
  drawThickLine(png, 4, 4, 636, 4, 2, accent, 0.95)
  drawThickLine(png, 636, 4, 636, 276, 2, accent, 0.95)
  drawThickLine(png, 636, 276, 4, 276, 2, accent, 0.95)
  drawThickLine(png, 4, 276, 4, 4, 2, accent, 0.95)

  const activeItems = config.items.filter((it) => (it.triggerSec ?? 0) <= localTimeSec + 0.01)

  if (config.kind === 'tier-board') {
    const headerH = 24
    const rowH = Math.floor((272 - headerH - 8) / TIER_LEVELS.length)
    TIER_LEVELS.forEach((lvl, idx) => {
      const y = headerH + idx * rowH
      const tierRgb = parseHexRgb(TIER_LEVEL_COLORS[lvl], [239, 68, 68])
      drawFilledRect(png, 12, y + 2, 54, rowH - 4, tierRgb, 0.96)
      drawFilledRect(png, 70, y + 2, 556, rowH - 4, rowBg, 0.82)
      const rowItems = activeItems.filter((it) => (it.tier ?? 'S') === lvl)
      rowItems.forEach((it, itemIdx) => {
        const ix = 76 + itemIdx * 134
        if (ix + 126 > 624) return
        const badgeRgb = parseHexRgb(it.color, tierRgb)
        drawFilledRect(png, ix, y + 6, 126, rowH - 12, cardBg, 0.95)
        drawCircleRing(png, ix + 14, y + Math.round(rowH / 2), 6, 1, badgeRgb, 0.98, true)
        drawThickLine(
          png,
          ix + 28,
          y + Math.round(rowH / 2),
          ix + 112,
          y + Math.round(rowH / 2),
          3,
          white,
          0.9
        )
      })
    })
    return PNG.sync.write(png)
  }

  if (config.kind === 'vs-scoreboard') {
    drawFilledRect(png, 16, 16, 280, 48, [2, 132, 199], 0.95)
    drawCircleRing(png, 320, 40, 22, 1, accent, 0.98, true)
    drawFilledRect(png, 344, 16, 280, 48, [225, 29, 72], 0.95)
    const leftItems = activeItems.filter((it) => it.side !== 'right')
    const rightItems = activeItems.filter((it) => it.side === 'right')
    leftItems.slice(0, 4).forEach((it, idx) => {
      const y = 76 + idx * 46
      const col = parseHexRgb(it.color, [56, 189, 248])
      drawFilledRect(png, 16, y, 280, 38, cardBg, 0.92)
      drawThickLine(png, 16, y, 16, y + 38, 3, col, 0.96)
    })
    rightItems.slice(0, 4).forEach((it, idx) => {
      const y = 76 + idx * 46
      const col = parseHexRgb(it.color, [239, 68, 68])
      drawFilledRect(png, 344, y, 280, 38, cardBg, 0.92)
      drawThickLine(png, 344, y, 344, y + 38, 3, col, 0.96)
    })
    return PNG.sync.write(png)
  }

  // ranking-list / step-reveal / stat-callout
  const slots = config.items.slice(0, 5)
  const rowH = Math.floor(236 / Math.max(1, slots.length))
  slots.forEach((it, idx) => {
    const y = 32 + idx * rowH
    const active = (it.triggerSec ?? 0) <= localTimeSec + 0.01
    const col = parseHexRgb(it.color, accent)
    drawFilledRect(png, 16, y + 4, 608, rowH - 8, active ? cardBg : rowBg, active ? 0.95 : 0.45)
    drawFilledRect(png, 22, y + 8, 42, rowH - 16, active ? col : [71, 85, 105], 0.95)
  })
  return PNG.sync.write(png)
}

function writeWidgetSlicePngFile(
  clip: TimelineExportClip,
  sliceIndex: number,
  sampleLocalSec: number,
  snapshotDataUrl?: string
): string | null {
  try {
    const rootDir = projectService.isOpen()
      ? join(projectService.getRoot(), 'Cache', 'widgets')
      : join(tmpdir(), 'aiart-widgets')
    mkdirSync(rootDir, { recursive: true })
    const kind = clip.widgetConfig?.kind ?? 'tier-board'
    const hashSeed = JSON.stringify({
      t: clip.title,
      cfg: clip.widgetConfig,
      s: sliceIndex,
      sec: sampleLocalSec
    })
    const hashTag = Buffer.from(hashSeed, 'utf-8').toString('hex').slice(-12)
    const pngPath = join(rootDir, `wg-${kind}-${sliceIndex}-${hashTag}.png`)
    const prefix = 'data:image/png;base64,'
    if (
      snapshotDataUrl &&
      snapshotDataUrl.startsWith(prefix) &&
      snapshotDataUrl.length > prefix.length + 16
    ) {
      writeFileSync(pngPath, Buffer.from(snapshotDataUrl.slice(prefix.length), 'base64'))
      return pngPath
    }
    if (clip.widgetConfig) {
      writeFileSync(pngPath, renderTimelineWidgetPngBuffer(clip.widgetConfig, sampleLocalSec))
      return pngPath
    }
    return null
  } catch {
    return null
  }
}

/**
 * 将带有 `widgetConfig` 的动态组件画中画片段按状态跳变时间窗展开为多段独立 PNG 画中画片段。
 */
export function expandOverlayClipsForWidgets(clips: TimelineExportClip[]): TimelineExportClip[] {
  const out: TimelineExportClip[] = []
  for (const clip of clips) {
    if (!clip.widgetConfig) {
      out.push(clip)
      continue
    }
    const snapshots = clip.widgetStateSnapshots
    if (Array.isArray(snapshots) && snapshots.length > 0) {
      snapshots.forEach((snap, idx) => {
        const dur = Math.max(0.05, snap.endOffsetSec - snap.startOffsetSec)
        const absPath = writeWidgetSlicePngFile(
          clip,
          idx,
          snap.startOffsetSec + dur * 0.5,
          snap.pngDataUrl
        )
        if (!absPath) return
        out.push({
          ...clip,
          absPath,
          startSec: Number((clip.startSec + snap.startOffsetSec).toFixed(3)),
          durationSec: Number(dur.toFixed(3)),
          tweenIn: idx === 0 ? clip.tweenIn : 'none',
          tweenOut: idx === snapshots.length - 1 ? clip.tweenOut : 'none',
          widgetConfig: undefined,
          widgetStateSnapshots: undefined
        })
      })
      continue
    }

    const slices = computeTimelineWidgetTimeSlices(clip.widgetConfig, clip.durationSec)
    slices.forEach((slice, idx) => {
      const dur = Math.max(0.05, slice.endOffsetSec - slice.startOffsetSec)
      const absPath = writeWidgetSlicePngFile(clip, idx, slice.sampleLocalSec)
      if (!absPath) return
      out.push({
        ...clip,
        absPath,
        startSec: Number((clip.startSec + slice.startOffsetSec).toFixed(3)),
        durationSec: Number(dur.toFixed(3)),
        tweenIn: idx === 0 ? clip.tweenIn : 'none',
        tweenOut: idx === slices.length - 1 ? clip.tweenOut : 'none',
        widgetConfig: undefined,
        widgetStateSnapshots: undefined
      })
    })
  }
  return out
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

function writeProceduralSfxWavFile(sfxPresetId: TimelineProceduralSfxId): string | null {
  try {
    const rootDir = projectService.isOpen()
      ? join(projectService.getRoot(), 'Cache', 'sfx')
      : join(tmpdir(), 'aiart-sfx')
    mkdirSync(rootDir, { recursive: true })
    const safeId = (String(sfxPresetId).replace(/[^a-zA-Z0-9_-]/g, '_') ||
      'pop') as TimelineProceduralSfxId
    const wavPath = join(rootDir, `procedural-${safeId}.wav`)
    if (!existsSync(wavPath)) {
      writeFileSync(wavPath, Buffer.from(synthesizeTimelineSfxWavBytes(safeId)))
    }
    return wavPath
  } catch {
    return null
  }
}

function writeSubtitleSnapshotPngFile(
  clip: TimelineExportClip,
  sliceIndex: number,
  pngDataUrl: string
): string | null {
  try {
    const prefix = 'data:image/png;base64,'
    if (!pngDataUrl.startsWith(prefix) || pngDataUrl.length <= prefix.length + 16) return null
    const rootDir = projectService.isOpen()
      ? join(projectService.getRoot(), 'Cache', 'subtitles')
      : join(tmpdir(), 'aiart-subtitles')
    mkdirSync(rootDir, { recursive: true })
    const hashSeed = JSON.stringify({
      t: clip.text || clip.title,
      s: sliceIndex,
      start: clip.startSec
    })
    const hashTag = Buffer.from(hashSeed, 'utf-8').toString('hex').slice(-12)
    const pngPath = join(rootDir, `sk-${sliceIndex}-${hashTag}.png`)
    writeFileSync(pngPath, Buffer.from(pngDataUrl.slice(prefix.length), 'base64'))
    return pngPath
  } catch {
    return null
  }
}

/**
 * 逐词卡拉 OK 胶囊字幕展开为独立 `-loop 1 -i <png>` 画中画输入的上限；
 * 超出上限的字幕自动回退给 `buildFilterGraph` 原生 `drawtext` 卡拉 OK 引擎（写入 `-filter_complex_script`），
 * 防止长视频产生成百上千个 `-i` 输入导致 FFmpeg 内存暴涨或 Windows 命令行超长。
 */
export const MAX_SUBTITLE_KARAOKE_OVERLAY_SNAPSHOTS = 32

/**
 * 将渲染端预光栅化的逐词卡拉 OK 胶囊字幕帧（`subtitleStateSnapshots`）展开为透明画中画 PNG 片段，
 * 确保导出 MP4 的内联圆角胶囊、词级弹跳放大、发光描边与 Web 60fps 预览像素级一致。
 */
export function expandSubtitleKaraokeSnapshotsToOverlays(
  subs: TimelineExportClip[],
  subtitleYOffset: number,
  height: number
): { remainingSubs: TimelineExportClip[]; subtitleOverlayClips: TimelineExportClip[] } {
  const remainingSubs: TimelineExportClip[] = []
  const subtitleOverlayClips: TimelineExportClip[] = []
  const defaultCenterY = Math.min(
    0.94,
    Math.max(0.06, Number((1 - (subtitleYOffset + 56) / Math.max(240, height)).toFixed(4)))
  )
  for (const sub of subs) {
    const snapshots = sub.subtitleStateSnapshots
    if (
      !Array.isArray(snapshots) ||
      snapshots.length === 0 ||
      subtitleOverlayClips.length + snapshots.length > MAX_SUBTITLE_KARAOKE_OVERLAY_SNAPSHOTS
    ) {
      remainingSubs.push(sub)
      continue
    }
    let wroteAny = false
    snapshots.forEach((snap, idx) => {
      const dur = Math.max(0.04, snap.endOffsetSec - snap.startOffsetSec)
      const absPath = writeSubtitleSnapshotPngFile(sub, idx, snap.pngDataUrl)
      if (!absPath) return
      wroteAny = true
      const sampleGlobalSec = sub.startSec + snap.startOffsetSec + dur * 0.5
      const pos = evaluateSubtitleClipPosition(sub, sampleGlobalSec)
      const laneOffsetNorm = normalizeClipLane(sub.lane) * 0.08
      const overlayW = 0.86
      const overlayH = 0.2
      const centerX = pos.hasCustomPosition ? pos.centerX : 0.5
      const centerY = pos.hasCustomPosition
        ? pos.centerY - laneOffsetNorm
        : defaultCenterY - laneOffsetNorm
      subtitleOverlayClips.push({
        track: 'overlay',
        title: `${sub.title}#kw${idx}`,
        absPath,
        startSec: Number((sub.startSec + snap.startOffsetSec).toFixed(3)),
        durationSec: Number(dur.toFixed(3)),
        lane: 90 + normalizeClipLane(sub.lane),
        overlayX: Number(Math.max(0, Math.min(1 - overlayW, centerX - overlayW * 0.5)).toFixed(4)),
        overlayY: Number(Math.max(0, Math.min(1 - overlayH, centerY - overlayH * 0.5)).toFixed(4)),
        overlayWidth: overlayW,
        overlayHeight: overlayH,
        tweenIn: 'none',
        tweenOut: 'none'
      })
    })
    if (!wroteAny) {
      remainingSubs.push(sub)
    }
  }
  return { remainingSubs, subtitleOverlayClips }
}

function resolveClipPath(clip: TimelineExportClip): string | null {
  const vfxCandidate =
    (clip.relativePath && /^vfx:\/\//i.test(clip.relativePath.trim())
      ? clip.relativePath.trim()
      : null) ||
    (clip.absPath && /^vfx:\/\//i.test(clip.absPath.trim()) ? clip.absPath.trim() : null)
  if (vfxCandidate) {
    const vfxStickerId = vfxCandidate.replace(/^vfx:\/\//i, '').trim() || 'comic-boom'
    return writeStickerPngFile({ ...clip, stickerId: vfxStickerId })
  }
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
  if (clip.sfxPresetId && typeof clip.sfxPresetId === 'string' && clip.sfxPresetId.trim()) {
    return writeProceduralSfxWavFile(clip.sfxPresetId.trim() as TimelineProceduralSfxId)
  }
  if (clip.widgetConfig) {
    return writeWidgetSlicePngFile(clip, 0, clip.durationSec * 0.5, clip.stickerPngDataUrl)
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
    subtitleKaraokeMode?: TimelineSubtitleKaraokeMode
    subtitleHighlightColor?: string
    subtitleHighlightBgColor?: string
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

      const appendSpatialGuichuFx = (baseLabel: string, finalLabel: string): void => {
        const fx = clip.visualEffect ?? 'none'
        const intensity = Math.max(0.2, Math.min(1, (clip.effectIntensity ?? 80) / 100))
        if (fx === 'guichu-pingpong') {
          filterParts.push(
            `[${baseLabel}]split=2[${finalLabel}_fw][${finalLabel}_rv];` +
              `[${finalLabel}_rv]reverse,hflip[${finalLabel}_rev];` +
              `[${finalLabel}_fw][${finalLabel}_rev]concat=n=2:v=1:a=0,setpts=0.5*(PTS-STARTPTS),fps=${fps},tpad=stop_mode=clone:stop_duration=0.08,trim=0:${winDurSec.toFixed(3)},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'beat-flip') {
          filterParts.push(
            `[${baseLabel}]split=2[${finalLabel}_n][${finalLabel}_f0];` +
              `[${finalLabel}_f0]hflip,hue=h=28:s=1.25[${finalLabel}_flp];` +
              `[${finalLabel}_n][${finalLabel}_flp]overlay=x='if(gt(sin(2*PI*t*6),0),0,W*2)':y=0,setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'split-2h') {
          const w2 = Math.max(2, Math.floor(width / 2))
          filterParts.push(
            `[${baseLabel}]crop=iw*0.56:ih:iw*0.22:0,scale=${w2}:${height},setsar=1,split=2[${finalLabel}_l][${finalLabel}_r0];` +
              `[${finalLabel}_r0]hflip[${finalLabel}_r];` +
              `[${finalLabel}_l][${finalLabel}_r]hstack=inputs=2,scale=${width}:${height},drawbox=x=iw*0.497:y=0:w=iw*0.006:h=ih:color=#22d3ee:t=fill,setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'split-3v') {
          const w3 = Math.max(2, Math.floor(width / 3))
          filterParts.push(
            `[${baseLabel}]crop=iw*0.46:ih:iw*0.27:0,scale=${w3}:${height},setsar=1,split=3[${finalLabel}_c1][${finalLabel}_c20][${finalLabel}_c30];` +
              `[${finalLabel}_c20]hflip,hue=h=35[${finalLabel}_c2];` +
              `[${finalLabel}_c30]hue=h=-35[${finalLabel}_c3];` +
              `[${finalLabel}_c1][${finalLabel}_c2][${finalLabel}_c3]hstack=inputs=3,scale=${width}:${height},` +
              `drawbox=x=iw*0.331:y=0:w=iw*0.005:h=ih:color=#f43f5e:t=fill,` +
              `drawbox=x=iw*0.664:y=0:w=iw*0.005:h=ih:color=#22d3ee:t=fill,setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'split-4grid') {
          const w2 = Math.max(2, Math.floor(width / 2))
          const h2 = Math.max(2, Math.floor(height / 2))
          filterParts.push(
            `[${baseLabel}]scale=${w2}:${h2},setsar=1,split=4[${finalLabel}_q1][${finalLabel}_q20][${finalLabel}_q30][${finalLabel}_q40];` +
              `[${finalLabel}_q20]hflip,hue=h=36[${finalLabel}_q2];` +
              `[${finalLabel}_q30]hflip,hue=h=-36[${finalLabel}_q3];` +
              `[${finalLabel}_q40]rgbashift=rh=6:bh=-6[${finalLabel}_q4];` +
              `[${finalLabel}_q1][${finalLabel}_q2][${finalLabel}_q3][${finalLabel}_q4]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0,scale=${width}:${height},` +
              `drawbox=x=iw*0.497:y=0:w=iw*0.006:h=ih:color=#facc15:t=fill,` +
              `drawbox=x=0:y=ih*0.497:w=iw:h=ih*0.006:color=#facc15:t=fill,setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'split-9grid') {
          const w3 = Math.max(2, Math.floor(width / 3))
          const h3 = Math.max(2, Math.floor(height / 3))
          filterParts.push(
            `[${baseLabel}]scale=${w3}:${h3},setsar=1,split=9[${finalLabel}_g1][${finalLabel}_g20][${finalLabel}_g3][${finalLabel}_g40][${finalLabel}_g50][${finalLabel}_g60][${finalLabel}_g7][${finalLabel}_g80][${finalLabel}_g9];` +
              `[${finalLabel}_g20]hflip,hue=h=40[${finalLabel}_g2];` +
              `[${finalLabel}_g40]hflip,hue=h=-40[${finalLabel}_g4];` +
              `[${finalLabel}_g50]rgbashift=rh=6:bh=-6[${finalLabel}_g5];` +
              `[${finalLabel}_g60]hflip,hue=h=80[${finalLabel}_g6];` +
              `[${finalLabel}_g80]hflip,hue=h=-80[${finalLabel}_g8];` +
              `[${finalLabel}_g1][${finalLabel}_g2][${finalLabel}_g3][${finalLabel}_g4][${finalLabel}_g5][${finalLabel}_g6][${finalLabel}_g7][${finalLabel}_g8][${finalLabel}_g9]` +
              `xstack=inputs=9:layout=0_0|w0_0|w0+w1_0|0_h0|w0_h0|w0+w1_h0|0_h0+h3|w0_h0+h3|w0+w1_h0+h3,scale=${width}:${height},` +
              `drawbox=x=iw*0.331:y=0:w=iw*0.005:h=ih:color=#e879f9:t=fill,` +
              `drawbox=x=iw*0.664:y=0:w=iw*0.005:h=ih:color=#22d3ee:t=fill,` +
              `drawbox=x=0:y=ih*0.331:w=iw:h=ih*0.005:color=#e879f9:t=fill,` +
              `drawbox=x=0:y=ih*0.664:w=iw:h=ih*0.005:color=#22d3ee:t=fill,setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'soul-out') {
          const gw = Math.max(width + 4, Math.round(width * (1 + 0.28 * intensity)))
          const gh = Math.max(height + 4, Math.round(height * (1 + 0.28 * intensity)))
          const alpha = (0.48 * intensity).toFixed(2)
          filterParts.push(
            `[${baseLabel}]split=2[${finalLabel}_b][${finalLabel}_g0];` +
              `[${finalLabel}_g0]scale=${gw}:${gh},crop=${width}:${height},rgbashift=rh=12:bh=-12,format=rgba,colorchannelmixer=aa=${alpha}[${finalLabel}_g];` +
              `[${finalLabel}_b][${finalLabel}_g]overlay=0:0:format=auto,setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'earthquake' || fx === 'camera-shake' || fx === 'deep-fry') {
          const overscan = fx === 'earthquake' || fx === 'deep-fry' ? 0.14 : 0.09
          const sw = Math.max(width + 4, Math.round(width * (1 + overscan * intensity)))
          const sh = Math.max(height + 4, Math.round(height * (1 + overscan * intensity)))
          const freqX = fx === 'camera-shake' ? 13 : 19
          const freqY = fx === 'camera-shake' ? 17 : 25
          filterParts.push(
            `[${baseLabel}]scale=${sw}:${sh},crop=${width}:${height}:x='(iw-ow)/2+((iw-ow)*0.46)*sin(2*PI*t*${freqX})':y='(ih-oh)/2+((ih-oh)*0.46)*cos(2*PI*t*${freqY})',setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
        if (fx === 'rgb-glitch' || fx === 'bad-tv') {
          const sw = Math.max(width + 4, Math.round(width * (1 + 0.07 * intensity)))
          const sh = Math.max(height + 4, Math.round(height * (1 + 0.04 * intensity)))
          filterParts.push(
            `[${baseLabel}]scale=${sw}:${sh},crop=${width}:${height}:x='(iw-ow)/2+((iw-ow)*0.48)*sin(2*PI*t*25)':y='(ih-oh)/2+((ih-oh)*0.35)*cos(2*PI*t*17)',setsar=1,format=yuv420p[${finalLabel}]`
          )
          return
        }
      }

      const needsSpatialFx =
        clip.visualEffect === 'guichu-pingpong' ||
        clip.visualEffect === 'beat-flip' ||
        clip.visualEffect === 'split-2h' ||
        clip.visualEffect === 'split-3v' ||
        clip.visualEffect === 'split-4grid' ||
        clip.visualEffect === 'split-9grid' ||
        clip.visualEffect === 'soul-out' ||
        clip.visualEffect === 'earthquake' ||
        clip.visualEffect === 'camera-shake' ||
        clip.visualEffect === 'deep-fry' ||
        clip.visualEffect === 'rgb-glitch' ||
        clip.visualEffect === 'bad-tv'
      const stageOutLabel = needsSpatialFx ? `${label}raw` : label

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
          `[${bgBlurLabel}][${fgFitLabel}]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=0.08,trim=0:${winDurSec.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[${stageOutLabel}]`
        )
        void preLabel
        if (needsSpatialFx) appendSpatialGuichuFx(stageOutLabel, label)
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
        `[${srcPort}]trim=${srcStart.toFixed(3)}:${(srcStart + srcTrimDur).toFixed(3)},${ptsExpr}${tpadOpt}${cropOpt}${eqOpt},${scaleExpr},setsar=1,fps=${fps},tpad=stop_mode=clone:stop_duration=0.08,trim=0:${winDurSec.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[${stageOutLabel}]`
      )
      if (needsSpatialFx) appendSpatialGuichuFx(stageOutLabel, label)
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
  const globalKaraokeMode: TimelineSubtitleKaraokeMode =
    visualOptions?.subtitleKaraokeMode ?? 'none'
  const globalHighlightColor =
    visualOptions?.subtitleHighlightColor &&
    /^#[0-9a-fA-F]{6}$/.test(visualOptions.subtitleHighlightColor.trim())
      ? visualOptions.subtitleHighlightColor.trim()
      : '#facc15'
  const globalHighlightBg =
    visualOptions?.subtitleHighlightBgColor &&
    /^#[0-9a-fA-F]{6}$/.test(visualOptions.subtitleHighlightBgColor.trim())
      ? visualOptions.subtitleHighlightBgColor.trim()
      : '#ff2e4c'

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
    const karaokeMode: TimelineSubtitleKaraokeMode = sub.subtitleKaraokeMode ?? globalKaraokeMode
    const highlightColor =
      sub.subtitleHighlightColor && /^#[0-9a-fA-F]{6}$/.test(sub.subtitleHighlightColor.trim())
        ? sub.subtitleHighlightColor.trim()
        : karaokeMode === 'karaoke-pill' &&
            !visualOptions?.subtitleHighlightColor &&
            !sub.subtitleHighlightColor
          ? '#ffffff'
          : globalHighlightColor
    const highlightBg =
      sub.subtitleHighlightBgColor && /^#[0-9a-fA-F]{6}$/.test(sub.subtitleHighlightBgColor.trim())
        ? sub.subtitleHighlightBgColor.trim()
        : globalHighlightBg

    const maxChars = subtitleMaxCharsForWidth(width, clipFontSize)
    const lineHeight = Math.max(clipFontSize + 4, Math.round(clipFontSize * 1.28))
    const risePx = Math.max(12, Math.round(clipFontSize * 0.55))
    const start = Math.max(0, sub.startSec)
    const end = start + Math.max(0.05, sub.durationSec)
    const laneOffsetPx = normalizeClipLane(sub.lane) * Math.round(lineHeight * 1.65)

    // word-solo 模式：逐词独立居中大字跳动显示（不叠底句）
    if (karaokeMode === 'word-solo') {
      const words = getSubtitleClipWordTimings(sub)
      if (words.length > 0) {
        const soloSize = Math.min(220, Math.round(clipFontSize * 1.26))
        const soloBoxOpt = `:box=1:boxcolor=${highlightBg}@0.92:boxborderw=10`
        const customXY = buildSubtitleKeyframeFfmpegXYExpr(sub, 0)
        const xExpr = customXY ? customXY.xExpr : 'x=(w-text_w)/2'
        const yExpr = customXY ? customXY.yExpr : `y=h-${subtitleYOffset + laneOffsetPx}-text_h`
        for (const [wi, w] of words.entries()) {
          const wText = escapeDrawtext(w.text)
          if (!wText) continue
          const ws = Math.max(start, start + w.startSec)
          const we = Math.min(end, Math.max(ws + 0.03, start + w.endSec))
          const next = `sub${i}w${wi}`
          filterParts.push(
            `[${lastVideo}]drawtext=text='${wText}'${fontOpt}:fontsize=${soloSize}:fontcolor=${highlightColor}:borderw=${borderW}:bordercolor=${borderColor}${soloBoxOpt}:${xExpr}:${yExpr}:enable='between(t\\,${ws.toFixed(3)}\\,${we.toFixed(3)})'[${next}]`
          )
          lastVideo = next
        }
        continue
      }
    }

    const lines = wrapSubtitleLines(raw, maxChars)
    if (!lines.length) continue
    // 多行自下而上叠（多子轨 lane > 0 时自动向上偏移，避免同时间段双语/角色+注释字幕重叠）
    for (let li = 0; li < lines.length; li++) {
      const text = escapeDrawtext(lines[li]!)
      const fromBottom = subtitleYOffset + laneOffsetPx + (lines.length - 1 - li) * lineHeight
      const lineOffsetFromCenterPx = (li - (lines.length - 1) / 2) * lineHeight
      const customXY = buildSubtitleKeyframeFfmpegXYExpr(sub, Math.round(lineOffsetFromCenterPx))
      const next = `sub${i}l${li}`
      if (customXY) {
        filterParts.push(
          `[${lastVideo}]drawtext=text='${text}'${fontOpt}:fontsize=${clipFontSize}:fontcolor=${clipColor}:borderw=${borderW}:bordercolor=${borderColor}${boxOpt}:${customXY.xExpr}:${customXY.yExpr}:enable='between(t\\,${start.toFixed(3)}\\,${end.toFixed(3)})'[${next}]`
        )
      } else if (motionEnabled) {
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

    // karaoke-pill / karaoke-pop / karaoke-glow 模式：在对应字幕行内的发声词水平位置原位叠加高亮胶囊徽章
    if (
      karaokeMode === 'karaoke-pill' ||
      karaokeMode === 'karaoke-pop' ||
      karaokeMode === 'karaoke-glow'
    ) {
      const words = getSubtitleClipWordTimings(sub)
      const badgeSize =
        karaokeMode === 'karaoke-pop'
          ? Math.min(200, Math.round(clipFontSize * 1.16))
          : Math.min(200, Math.round(clipFontSize * 1.06))
      const badgeBox =
        karaokeMode === 'karaoke-pill'
          ? `:box=1:boxcolor=${highlightBg}@0.95:boxborderw=8`
          : karaokeMode === 'karaoke-glow'
            ? `:box=1:boxcolor=${highlightColor}@0.28:boxborderw=7`
            : `:box=1:boxcolor=black@0.45:boxborderw=6`

      const visualWidthUnits = (str: string): number => {
        let u = 0
        for (const ch of str) {
          u += /[\u3000-\u9fff\uff00-\uffef]/.test(ch) ? 1.0 : 0.56
        }
        return u
      }
      const lineTotalUnits = lines.map((ln) => Math.max(0.5, visualWidthUnits(ln)))
      let curLineIdx = 0
      let cursorInLineUnits = 0

      for (const [wi, w] of words.entries()) {
        const wText = escapeDrawtext(w.text)
        const wUnits = Math.max(0.5, visualWidthUnits(w.text))
        while (
          curLineIdx < lines.length - 1 &&
          cursorInLineUnits + wUnits * 0.5 > lineTotalUnits[curLineIdx]! + 0.25
        ) {
          curLineIdx++
          cursorInLineUnits = 0
        }
        const totalU = lineTotalUnits[curLineIdx] ?? wUnits
        const wordCenterU = cursorInLineUnits + wUnits * 0.5
        cursorInLineUnits += wUnits
        if (!wText) continue

        const inlineOffsetPx = Math.round((wordCenterU - totalU * 0.5) * clipFontSize * 0.96)
        const offsetSign =
          inlineOffsetPx > 0 ? `+${inlineOffsetPx}` : inlineOffsetPx < 0 ? `${inlineOffsetPx}` : ''
        const lineFromBottom =
          subtitleYOffset + laneOffsetPx + (lines.length - 1 - curLineIdx) * lineHeight
        const lineOffsetFromCenterPx = (curLineIdx - (lines.length - 1) / 2) * lineHeight
        const customXY = buildSubtitleKeyframeFfmpegXYExpr(sub, Math.round(lineOffsetFromCenterPx))
        const xExpr = customXY ? `${customXY.xExpr}${offsetSign}` : `x=(w-text_w)/2${offsetSign}`
        const yExpr = customXY ? customXY.yExpr : `y=h-${lineFromBottom}-text_h`
        const ws = Math.max(start, start + w.startSec)
        const we = Math.min(end, Math.max(ws + 0.03, start + w.endSec))
        const next = `sub${i}kw${wi}`
        filterParts.push(
          `[${lastVideo}]drawtext=text='${wText}'${fontOpt}:fontsize=${badgeSize}:fontcolor=${highlightColor}:borderw=${borderW}:bordercolor=${borderColor}${badgeBox}:${xExpr}:${yExpr}:enable='between(t\\,${ws.toFixed(3)}\\,${we.toFixed(3)})'[${next}]`
        )
        lastVideo = next
      }
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
    const isPreSynthesizedSinging = /psola-sing-[0-9a-f]+\.wav$/i.test(clip.path)
    const pitchAndVoiceChain = isPreSynthesizedSinging
      ? 'equalizer=f=2600:t=q:w=1.1:g=3.5,aecho=0.78:0.80:20:0.18,acompressor=threshold=0.12:ratio=4:attack=4:release=50:makeup=1.32,volume=1.28'
      : buildClipPitchAndVoiceFilter(speed, clip.pitchSemitones, clip.voiceEffect)

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
      pitchAndVoiceChain,
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

  // 同步字幕内联 @{tag} 语义锚点到绑定了 anchorCueTag / widgetConfig.cueTag 的图层与音效
  const syncedInputClips = syncTimelineCueAnchors(
    input.clips.map((c, idx) => ({ ...c, id: `exp-${idx}` }))
  ).clips

  const rawSubs = syncedInputClips.filter(
    (c) => c.track === 'subtitle' && (c.text?.trim() || c.title.trim())
  )
  const { remainingSubs: subs, subtitleOverlayClips } = expandSubtitleKaraokeSnapshotsToOverlays(
    rawSubs,
    subtitleYOffset,
    height
  )
  const mainVideoClips = syncedInputClips.filter((c) => c.track === 'video')
  const overlayClips = [
    ...expandOverlayClipsForWidgets(syncedInputClips.filter((c) => c.track === 'overlay')),
    ...subtitleOverlayClips
  ]
  const voiceMusicClips = syncedInputClips.filter(
    (c) => c.track === 'voice' || c.track === 'music' || c.track === 'sfx'
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
    if (clip.loop === true || clip.track === 'music') {
      const clipInputDur = Math.max(
        1,
        Math.ceil(
          clipSourceOffsetSec(clip) +
            Math.max(0.05, clip.durationSec) * clampClipSpeed(clip.speed ?? 1) +
            1
        )
      )
      args.push('-stream_loop', '-1', '-t', String(clipInputDur), '-i', path)
    } else {
      args.push('-i', path)
    }
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
  const validAudioOnly = audioOnlyInputs.filter((c) => hasAudioForPath(c.path))
  const hasPrimarySpeechOrVideoAudio =
    mainVideoAudios.length > 0 || validAudioOnly.some((c) => c.track === 'voice')
  const overlayAudios = overlays.filter((c) => {
    if (input.mutedTracks?.includes('overlay') || !hasAudioForPath(c.path)) return false
    const defaultOverlayVol = hasPrimarySpeechOrVideoAudio ? 0 : 1
    return (c.volume ?? defaultOverlayVol) > 0
  })

  const rawAudios = [...mainVideoAudios, ...validAudioOnly, ...overlayAudios]
  const AUTO_SINGING_LEAD_PITCHES = [2, 3, -2, 4, 2, 3, 5, 2] as const
  let singingClipIdx = 0
  const audios: Array<TimelineExportClip & { path: string; inputIndex: number }> = []
  for (const c of rawAudios) {
    const isVocalTrack = c.track === 'video' || c.track === 'voice'
    const fx = isTimelineVoiceEffectId(c.voiceEffect) ? c.voiceEffect : 'none'
    if (!isVocalTrack || fx === 'none') {
      audios.push(c)
      continue
    }
    const origSpeed = clampClipSpeed(c.speed)
    const dur = Math.max(0.05, c.durationSec)
    const freezeTail =
      c.track === 'video'
        ? Math.min(Math.max(0, dur - 0.05), clampClipFreezeTailSec(c.freezeTailSec))
        : 0
    const playDur = Math.max(0.05, dur - freezeTail)
    const rawPitch = clampClipPitchSemitones(c.pitchSemitones)
    const leadPitch =
      Math.abs(rawPitch) >= 0.05
        ? rawPitch
        : AUTO_SINGING_LEAD_PITCHES[singingClipIdx % AUTO_SINGING_LEAD_PITCHES.length]!
    singingClipIdx++

    let ffBin = 'ffmpeg'
    try {
      ffBin = findFfmpegBin() ?? 'ffmpeg'
    } catch {
      ffBin = 'ffmpeg'
    }
    const psolaWav =
      fx === 'autotune-chorus' || fx === 'echo' || fx === 'robot' || fx === 'chipmunk'
        ? renderGuichuSingingClipWav({ ...c, pitchSemitones: leadPitch }, singingClipIdx - 1, ffBin)
        : null
    if (psolaWav) {
      args.push('-i', psolaWav)
      audios.push({
        ...c,
        path: psolaWav,
        inputIndex: inputIndex++,
        sourceOffsetSec: 0,
        speed: 1,
        pitchSemitones: 0,
        fadeInSec: Math.max(c.fadeInSec ?? 0, 0.02),
        fadeOutSec: Math.max(c.fadeOutSec ?? 0, 0.03)
      })
      continue
    }

    // 当整句台词片段（playDur >= 1.15s 且未手动慢放 speed >= 0.85）挂载了鬼畜歌唱音效时（无本地源文件回退分支），
    // 自动拆解为「前半句节奏起唱（52% 时长，音高 leadPitch）+ 后半句核心词 2.0x 慢放拉长颤音歌唱（48% 时长，音高转音 tailPitch）」，
    // 确保即便 AI 或用户只放了一个整句镜头、甚至忘了填 pitchSemitones，导出成片依然具备《敢杀我的马》同款原声拉长变唱歌效果！
    if (
      origSpeed >= 0.85 &&
      playDur >= 1.15 &&
      (fx === 'autotune-chorus' || fx === 'echo' || fx === 'robot')
    ) {
      const dur1 = Number((playDur * 0.52).toFixed(3))
      const dur2 = Number((dur - dur1).toFixed(3))
      const srcStart = clipSourceOffsetSec(c)
      const srcWindow = playDur * origSpeed
      const tailSrcStart = Number((srcStart + srcWindow * 0.44).toFixed(3))
      const tailPitch = Math.max(-3, Math.min(5, leadPitch + (leadPitch >= 4 ? -2 : 2)))
      args.push('-i', c.path)
      const tailInputIndex = inputIndex++
      audios.push({
        ...c,
        durationSec: dur1,
        sourceOffsetSec: srcStart,
        speed: clampClipSpeed(origSpeed * 0.92),
        pitchSemitones: leadPitch,
        fadeOutSec: 0.04,
        freezeTailSec: 0
      })
      audios.push({
        ...c,
        inputIndex: tailInputIndex,
        startSec: Number((c.startSec + dur1).toFixed(3)),
        durationSec: dur2,
        sourceOffsetSec: tailSrcStart,
        speed: clampClipSpeed(origSpeed * 0.5),
        pitchSemitones: tailPitch,
        voiceEffect: 'echo',
        fadeInSec: 0.04
      })
    } else {
      audios.push({
        ...c,
        pitchSemitones: leadPitch
      })
    }
  }
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
      subtitleMotion: input.subtitleMotion,
      subtitleKaraokeMode: input.subtitleKaraokeMode,
      subtitleHighlightColor: input.subtitleHighlightColor,
      subtitleHighlightBgColor: input.subtitleHighlightBgColor
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
      const rootAbs = resolve(projectService.getRoot())
      const outAbs = resolve(outPath)
      const relFromRoot = relative(rootAbs, outAbs).replace(/\\/g, '/')
      const isInsideProject =
        Boolean(relFromRoot) && !relFromRoot.startsWith('..') && !isAbsolute(relFromRoot)
      // 若导出目标已在工程 Output/ 或 Cache/ 目录下，不再额外调用 attachExternalGeneratedFile
      // 往 Cache/Videos/ 复制第二份相同 MP4（否则一轮对话结束扫盘会在 Output/ 和 Cache/Videos/ 扫出两个相同视频卡）
      if (!isInsideProject || relFromRoot === 'Assets' || relFromRoot.startsWith('Assets/')) {
        const asset = projectService.attachExternalGeneratedFile({
          type: 'video',
          sourceFilePath: outPath,
          name: basename(outPath, extname(outPath)) || 'Timeline Export',
          ...(relFromRoot === 'Assets' || relFromRoot.startsWith('Assets/')
            ? { outputDir: dirname(relFromRoot) === '.' ? 'Assets' : dirname(relFromRoot) }
            : {})
        })
        assetId = asset.id
        broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)
      }
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
