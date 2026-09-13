/**
 * 转场窗口 ffmpeg 微渲染（编辑器预览用，需与导出保持同一套 xfade 语义）。
 *
 * 背景：编辑器转场窗口（[B.start, A.end] = overlap 秒）此前用 CSS 模拟，
 * 与导出成片的 xfade 存在视觉差异。本服务把单个重叠窗口交给 ffmpeg 渲染：
 *   A 输入 = A 在窗口内实际参与淡化的尾窗（长 d = 生效转场时长）
 *   B 输入 = B 头窗（长 overlap，淡化结束后继续播放直至 B 完全接管）
 *   xfade(transition=<type>, duration=d, offset=0)
 * 与 src/main/services/timelineExportService.ts#buildFilterGraph 的 addCrossSegment
 * 使用同一套几何 / 时长 / 类型映射，保证「预览 = 导出」。
 *
 * 输出是 video-only 的短视频（编码 ultrafast + 密集关键帧，便于拖动 seek），
 * 以 studio-media:// 协议 URL 返回给渲染层直接播放。
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type {
  TimelineExportClip,
  TimelineTransitionPreviewInput,
  TimelineTransitionPreviewResult
} from '@shared/graph'
import { projectService } from './projectService'
import { findFfmpegBin } from './videoFrameService'

// ── 与导出保持一致的 xfade 类型映射（值即 ffmpeg xfade transition 名） ──
const XFADE_MAP: Record<string, string> = {
  dissolve: 'dissolve',
  fade: 'fadeblack',
  fadeout: 'fadeblack',
  fadein: 'fadeblack',
  flash: 'fadewhite',
  slideleft: 'slideleft',
  slideright: 'slideright',
  slideup: 'slideup',
  slidedown: 'slidedown',
  wipeleft: 'wipeleft',
  wiperight: 'wiperight',
  wipeup: 'wipeup',
  wipedown: 'wipedown',
  circleopen: 'circleopen',
  circleclose: 'circleclose'
}

/** 片段在源文件内的取段起点（秒），与导出的 clipSourceOffsetSec 一致 */
function sourceOffsetSec(clip: { sourceOffsetSec?: number }): number {
  const n = Number(clip.sourceOffsetSec)
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.round(Math.min(3600, n) * 100) / 100
}

function mainClipEnd(clip: TimelineExportClip): number {
  return clip.startSec + Math.max(0.05, clip.durationSec)
}

/** 解析片段媒体绝对路径（与导出的 resolveClipPath 一致） */
function resolveMediaPath(clip: TimelineExportClip): string | null {
  if (clip.absPath && existsSync(clip.absPath)) return clip.absPath
  const rel = clip.relativePath?.trim()
  if (!rel || !projectService.isOpen()) return null
  try {
    const abs = join(projectService.getRoot(), rel)
    return existsSync(abs) ? abs : null
  } catch {
    return null
  }
}

function renderError(message: string): TimelineTransitionPreviewResult {
  return { ok: false, error: message }
}

// ── 输出临时目录：进程内 LRU（保留最近 N 个），启动时清理 >6h 的残留 ──
const MAX_CACHED_FILES = 48
let cachedFiles: string[] = []
let initialized = false

function previewDir(): string {
  return join(tmpdir(), 'aiart-transition-preview')
}

function initPreviewDir(): void {
  if (initialized) return
  initialized = true
  try {
    const dir = previewDir()
    mkdirSync(dir, { recursive: true })
    const now = Date.now()
    for (const name of readdirSync(dir)) {
      if (!/^tp-.*\.mp4$/i.test(name)) continue
      const p = join(dir, name)
      try {
        if (now - statSync(p).mtimeMs > 6 * 3600_000) rmSync(p, { force: true })
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

function registerRenderedFile(filePath: string): void {
  try {
    cachedFiles = cachedFiles.filter((p) => p !== filePath)
    cachedFiles.push(filePath)
    while (cachedFiles.length > MAX_CACHED_FILES) {
      const old = cachedFiles.shift()
      if (old) rmSync(old, { force: true })
    }
  } catch {
    /* ignore */
  }
}

function studioMediaUrl(filePath: string): string {
  let mtime = 0
  try {
    mtime = statSync(filePath).mtimeMs
  } catch {
    /* ignore */
  }
  return `studio-media://local/?path=${encodeURIComponent(filePath)}&t=${mtime}`
}

// 幂等缓存：相同请求（同一对源 + 几何 + 分辨率）直接命中已渲染文件
const cacheHit = new Map<string, TimelineTransitionPreviewResult>()
const inflight = new Map<string, Promise<TimelineTransitionPreviewResult>>()
let ffmpegReadyCached: boolean | null = null

function probeFfmpeg(bin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['-version'], { windowsHide: true })
    let settled = false
    const done = (ok: boolean): void => {
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

function runFfmpeg(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true })
    let stderr = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (err) => reject(new Error(`ffmpeg launch failed: ${err.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(stderr.trim().slice(-500) || `ffmpeg exited with code ${code}`))
    })
  })
}

/** 计算与导出完全一致的生效转场（几何 overlap、实际时长 d、xfade 名） */
function resolveTransition(
  left: TimelineExportClip,
  right: TimelineExportClip
): { overlapSec: number; durSec: number; xfadeName: string } | null {
  const durA = Math.max(0.05, left.durationSec)
  const durB = Math.max(0.05, right.durationSec)
  const overlap = Math.max(0, mainClipEnd(left) - right.startSec)
  const inSec = Math.max(0, right.transitionInSec ?? 0)
  const xfadeName = XFADE_MAP[right.transitionType ?? ''] ?? null
  if (!(overlap > 0.001 && inSec > 0.001 && xfadeName)) return null
  const d = Math.min(overlap, inSec, durA, durB)
  if (d <= 0.001) return null
  return { overlapSec: overlap, durSec: d, xfadeName }
}

export async function renderTimelineTransitionPreview(
  input: TimelineTransitionPreviewInput
): Promise<TimelineTransitionPreviewResult> {
  try {
    const left = input.left
    const right = input.right
    const transition = resolveTransition(left, right)
    if (!transition) {
      return renderError('no-transition')
    }

    const bin = findFfmpegBin()
    if (ffmpegReadyCached === null) ffmpegReadyCached = await probeFfmpeg(bin)
    if (!ffmpegReadyCached) {
      return renderError('ffmpeg unavailable')
    }

    const width = Math.min(3840, Math.max(160, Math.round(input.width ?? 1280)))
    const height = Math.min(2160, Math.max(90, Math.round(input.height ?? 720)))
    const fps = Math.min(60, Math.max(1, Math.round(input.fps ?? 30)))
    const key = JSON.stringify([
      resolveMediaPath(left),
      sourceOffsetSec(left),
      left.startSec,
      left.durationSec,
      resolveMediaPath(right),
      sourceOffsetSec(right),
      right.startSec,
      right.durationSec,
      right.transitionType,
      right.transitionInSec,
      width,
      height,
      fps,
      transition.overlapSec,
      transition.durSec,
      transition.xfadeName
    ])
    const hit = cacheHit.get(key)
    if (hit) return hit
    const running = inflight.get(key)
    if (running) return running

    const task = (async (): Promise<TimelineTransitionPreviewResult> => {
      const leftPath = resolveMediaPath(left)
      const rightPath = resolveMediaPath(right)
      if (!leftPath || !rightPath) {
        return renderError('missing media file')
      }

      const durA = Math.max(0.05, left.durationSec)
      const durB = Math.max(0.05, right.durationSec)
      const { overlapSec: overlap, durSec: d, xfadeName } = transition
      // A 尾窗：钳制逻辑与导出 windowPlans 的 tailStart/tailDur 完全一致，
      // fade 只占前 d 秒，B 头窗则整段覆盖 [B.start, A.end]（淡化结束后继续播放）
      const tailStart = Math.min(durA, Math.max(0, durA - overlap))
      const aSegDur = Math.min(d, Math.max(0, durA - tailStart))
      const bSegDur = Math.min(overlap, durB)
      const aStart = sourceOffsetSec(left) + tailStart
      const bStart = sourceOffsetSec(right)

      const branch = (port: string, srcStart: number, segDur: number): string =>
        `[${port}]trim=${srcStart.toFixed(3)}:${(srcStart + segDur).toFixed(3)},` +
        `setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
      const outDur = Math.max(aSegDur, bSegDur)
      const filter =
        `${branch('0:v', aStart, aSegDur)}[a];` +
        `${branch('1:v', bStart, bSegDur)}[b];` +
        `[a][b]xfade=transition=${xfadeName}:duration=${d.toFixed(3)}:offset=0,format=yuv420p[vout]`

      initPreviewDir()
      const outPath = join(
        previewDir(),
        `tp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`
      )
      const args: string[] = [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        leftPath,
        '-i',
        rightPath,
        '-filter_complex',
        filter,
        '-map',
        '[vout]',
        '-an',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-crf',
        '20',
        '-pix_fmt',
        'yuv420p',
        '-r',
        String(fps),
        '-g',
        String(Math.max(6, Math.min(24, fps))),
        '-movflags',
        '+faststart',
        '-t',
        outDur.toFixed(3),
        outPath
      ]
      try {
        await runFfmpeg(bin, args)
      } catch (err) {
        try {
          rmSync(outPath, { force: true })
        } catch {
          /* ignore */
        }
        return renderError(err instanceof Error ? err.message : String(err))
      }

      registerRenderedFile(outPath)
      // 缓存 Map 与磁盘 LRU 同规模，防止无限增长
      if (cacheHit.size >= MAX_CACHED_FILES) {
        const firstKey = cacheHit.keys().next().value
        if (firstKey !== undefined) cacheHit.delete(firstKey)
      }
      const result: TimelineTransitionPreviewResult = {
        ok: true,
        url: studioMediaUrl(outPath),
        durationSec: Math.max(0.05, Math.round(outDur * 1000) / 1000)
      }
      cacheHit.set(key, result)
      return result
    })()

    inflight.set(key, task)
    try {
      return await task
    } finally {
      inflight.delete(key)
    }
  } catch (err) {
    return renderError(err instanceof Error ? err.message : String(err))
  }
}
