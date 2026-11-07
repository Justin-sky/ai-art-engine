/**
 * Local zero-API-cost FFmpeg renderer for `still_motion` (Ken Burns) & `static_hold` units (`K1..Kk`),
 * plus synchronized `Original | Remake` side-by-side `compare.mp4` generator (`rea-video` `remake.py` equivalent).
 */
import { existsSync, mkdirSync } from 'fs'
import { dirname } from 'path'
import type { SemanticRebuildLocalMotionClip } from '@shared/semanticTimeline'
import { runFfmpeg } from '../ffmpegRunner'
import { probeMediaFacts } from './mediaFacts'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}

function even(n: number): number {
  const v = Math.max(2, Math.round(n))
  return v % 2 === 0 ? v : v + 1
}

export interface RenderLocalMotionInput {
  anchorImageAbs: string
  outputMp4Abs: string
  durationSec: number
  width: number
  height: number
  fps: number
  mode: SemanticRebuildLocalMotionClip['mode']
  zoomPerSec?: number
  panPxPerSec?: number
  panDirDeg?: number
}

/**
 * Render a `static_hold` or smooth upscaled `ken_burns` clip locally via FFmpeg
 * without calling any paid cloud video generation model.
 */
export async function renderLocalMotionClip(input: RenderLocalMotionInput): Promise<void> {
  if (!existsSync(input.anchorImageAbs)) {
    throw new Error(`local motion anchor image missing: ${input.anchorImageAbs}`)
  }
  mkdirSync(dirname(input.outputMp4Abs), { recursive: true })
  const ffmpeg = resolveFfmpegForSemantic()
  const w = even(input.width || 1080)
  const h = even(input.height || 1920)
  const fps = clamp(Math.round(input.fps || 30), 8, 60)
  const dur = Math.max(0.25, input.durationSec)

  if (input.mode === 'static_hold') {
    const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
    await runFfmpeg(ffmpeg, [
      '-y',
      '-loop',
      '1',
      '-t',
      dur.toFixed(3),
      '-i',
      input.anchorImageAbs,
      '-vf',
      vf,
      '-an',
      '-c:v',
      'libx264',
      '-preset',
      'fast',
      '-crf',
      '18',
      input.outputMp4Abs
    ])
    return
  }

  // Smooth Ken Burns: upscale anchor frame first so `zoompan` steps sub-pixel cleanly
  const maxUpscaleEdge = 3200
  const upScaleFactor = Math.min(2, maxUpscaleEdge / Math.max(w, h))
  const upW = even(w * Math.max(1.25, upScaleFactor))
  const upH = even(h * Math.max(1.25, upScaleFactor))
  const totalFrames = Math.max(2, Math.round(dur * fps))

  const zoomDelta = clamp((input.zoomPerSec ?? 0.03) * dur, -0.32, 0.42)
  const rad = ((input.panDirDeg ?? 0) * Math.PI) / 180
  const panTotal = clamp((input.panPxPerSec ?? 0) * dur, 0, 0.22)
  const panX = clamp(Math.cos(rad) * panTotal, -0.18, 0.18)
  const panY = clamp(Math.sin(rad) * panTotal, -0.18, 0.18)

  const panMargin = 2.1 * Math.max(Math.abs(panX), Math.abs(panY), 0.02)
  const z0 = zoomDelta >= 0 ? 1 + panMargin : 1 + panMargin + Math.abs(zoomDelta)
  const z1 = zoomDelta >= 0 ? z0 + zoomDelta : 1 + panMargin
  const zDiff = z1 - z0

  const zExpr = `${z0.toFixed(4)}+(${zDiff.toFixed(4)})*on/${totalFrames}`
  const xExpr = `iw/2-(iw/zoom)/2+(${(-panX * 0.5).toFixed(4)})*iw*(2*on/${totalFrames}-1)`
  const yExpr = `ih/2-(ih/zoom)/2+(${(-panY * 0.5).toFixed(4)})*ih*(2*on/${totalFrames}-1)`

  const vf = [
    `scale=${upW}:${upH}:force_original_aspect_ratio=increase`,
    `crop=${upW}:${upH}`,
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=${totalFrames}:s=${w}x${h}:fps=${fps}`,
    'setsar=1,format=yuv420p'
  ].join(',')

  await runFfmpeg(ffmpeg, [
    '-y',
    '-i',
    input.anchorImageAbs,
    '-vf',
    vf,
    '-t',
    dur.toFixed(3),
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '18',
    input.outputMp4Abs
  ])
}

export interface RenderCompareVideoInput {
  sourceAbs: string
  remakeAbs: string
  outputCompareAbs: string
  width: number
  height: number
  fps: number
}

/**
 * Render a synchronized side-by-side `Original (Left) | Remake (Right)` MP4 (`compare.mp4`).
 */
export async function renderSideBySideCompareVideo(
  input: RenderCompareVideoInput
): Promise<boolean> {
  if (!existsSync(input.sourceAbs) || !existsSync(input.remakeAbs)) return false
  mkdirSync(dirname(input.outputCompareAbs), { recursive: true })
  const ffmpeg = resolveFfmpegForSemantic()

  const portrait = (input.height || 1920) >= (input.width || 1080)
  const panelW = portrait ? 540 : 960
  const panelH = even(
    Math.round((panelW * (input.height || 1080)) / Math.max(1, input.width || 1920))
  )
  const fps = clamp(Math.round(input.fps || 30), 12, 60)

  let targetDur = 0
  try {
    const remakeFacts = await probeMediaFacts(input.remakeAbs)
    targetDur = remakeFacts.durationSec
  } catch {
    /* fallback to shortest */
  }

  const normPanel = (idx: number, tag: string): string =>
    `[${idx}:v]fps=${fps},scale=${panelW}:${panelH}:force_original_aspect_ratio=decrease,pad=${panelW}:${panelH}:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration=3[${tag}]`

  const filterComplex = [
    normPanel(0, 'orig'),
    normPanel(1, 'remk'),
    '[orig][remk]hstack=inputs=2,format=yuv420p[vout]'
  ].join(';')

  const args: string[] = [
    '-y',
    '-i',
    input.sourceAbs,
    '-i',
    input.remakeAbs,
    '-filter_complex',
    filterComplex,
    '-map',
    '[vout]',
    '-map',
    '1:a?',
    ...(targetDur > 0.1 ? ['-t', targetDur.toFixed(3)] : ['-shortest']),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    input.outputCompareAbs
  ]

  try {
    await runFfmpeg(ffmpeg, args)
    return existsSync(input.outputCompareAbs)
  } catch {
    return false
  }
}
