/**
 * Native Node.js + single-pass FFmpeg `rgb24` visual forensics & transition analyzer.
 *
 * Ports `rea-video`'s `shots.py`, `features.py`, and `aspects/{framing,camera,lighting,grade}.py`
 * in 100% pure TypeScript with zero Python / OpenCV dependencies:
 * - Single FFmpeg rawvideo pass (`160x96` `rgb24`) capped at <= 900 frames (~38 MB max)
 * - Multi-cue transition classification (`cut`, `fade`, `dissolve`, `flash`, `mg_transition`)
 *   plus gradual fade/dissolve boundary discovery inside unsplit shots
 * - Immerkær 3x3 Laplacian high-frequency sensor noise (`noiseSigma`)
 * - 8x8 flat-block share (`flatRatio`, `flatLit`), 12-bit quantized `palette95`, Sobel `axisEdgeRatio`
 * - Thin lineart (`fineLight`, `fineDark`), vector fill ratio, letterbox detection, 24-bin `hsvHist`
 * - Rigid planar scale+translation Ken Burns solver (`kenburnsScore`, `zoomPerSec`, `panPxPerSec`, `panDirDeg`)
 * - Handheld jitter `signFlipRate`, static-background talking-head motion, stepped `dupRatio`
 * - CIE Lab / HSV `aspects` (`framing`, `camera`, `lighting`, `grade`)
 * - Composite `storyboard.jpg` contact sheet via pure-JS `jpeg-js`
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { decode as decodeJpeg, encode as encodeJpeg } from 'jpeg-js'
import {
  hsvBhattacharyyaDistance,
  makeTimeRange,
  type CameraAspectMeasured,
  type CameraMotionForensicKind,
  type FramingAspectMeasured,
  type GradeAspectMeasured,
  type LightingAspectMeasured,
  type MediaFacts,
  type ShotEvidence,
  type ShotForensicFeatures,
  type ShotTransition
} from '@shared/semanticTimeline'
import { resolveFfmpegForSemantic } from '../resolveFfmpeg'

const SAMPLE_W = 160
const SAMPLE_H = 96
const FRAME_BYTES = SAMPLE_W * SAMPLE_H * 3
const MAX_SAMPLED_FRAMES = 900

export interface SampledRgbTrack {
  width: number
  height: number
  sampleFps: number
  frames: Uint8Array[]
  lumaFrames: Float32Array[]
  frameMeanY: Float64Array
  frameStdY: Float64Array
  frameHsvHist: number[][]
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}

function r3(v: number): number {
  return Number(clamp(v, -1e6, 1e6).toFixed(3))
}

function computeLumaAndStats(
  rgb: Uint8Array,
  width: number,
  height: number
): { luma: Float32Array; meanY: number; stdY: number; hsvHist: number[] } {
  const n = width * height
  const luma = new Float32Array(n)
  let sumY = 0
  let sumY2 = 0
  const hist = new Array<number>(24).fill(0)

  for (let i = 0; i < n; i += 1) {
    const o = i * 3
    const r = rgb[o]!
    const g = rgb[o + 1]!
    const b = rgb[o + 2]!
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    luma[i] = y
    sumY += y
    sumY2 += y * y

    // 24-bin HSV histogram: 12 Hue + 6 Sat + 6 Val
    const maxC = Math.max(r, g, b)
    const minC = Math.min(r, g, b)
    const delta = maxC - minC
    const vNorm = maxC / 255
    const sNorm = maxC > 0 ? delta / maxC : 0
    let hDeg = 0
    if (delta > 0) {
      if (maxC === r) hDeg = ((g - b) / delta) % 6
      else if (maxC === g) hDeg = (b - r) / delta + 2
      else hDeg = (r - g) / delta + 4
      hDeg *= 60
      if (hDeg < 0) hDeg += 360
    }
    const hBin = Math.min(11, Math.floor(hDeg / 30))
    const sBin = Math.min(5, Math.floor(sNorm * 6))
    const vBin = Math.min(5, Math.floor(vNorm * 6))
    if (sNorm >= 0.12 && vNorm >= 0.1) {
      hist[hBin]! += 1
    }
    hist[12 + sBin]! += 0.5
    hist[18 + vBin]! += 0.5
  }

  const meanY = sumY / Math.max(1, n)
  const variance = Math.max(0, sumY2 / Math.max(1, n) - meanY * meanY)
  const histSum = hist.reduce((a, b) => a + b, 0) || 1
  return {
    luma,
    meanY,
    stdY: Math.sqrt(variance),
    hsvHist: hist.map((x) => Number((x / histSum).toFixed(4)))
  }
}

/** Decode low-resolution `rgb24` frames from video in a single streaming FFmpeg pass. */
export async function decodeSampledRgbTrack(
  videoAbs: string,
  facts: MediaFacts
): Promise<SampledRgbTrack | null> {
  const duration = Math.max(0.5, facts.durationSec || 1)
  const nativeFps = clamp(Math.round(facts.fps || 24), 4, 60)
  const maxAllowedFps = Math.max(2, Math.floor(MAX_SAMPLED_FRAMES / duration))
  const sampleFps = clamp(Math.min(nativeFps, duration <= 25 ? 12 : 8, maxAllowedFps), 2, 15)

  const ffmpeg = resolveFfmpegForSemantic()
  return new Promise((resolve) => {
    const frames: Uint8Array[] = []
    let carry: Buffer = Buffer.alloc(0)
    let settled = false

    const child = spawn(
      ffmpeg,
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        videoAbs,
        '-vf',
        `fps=${sampleFps},scale=${SAMPLE_W}:${SAMPLE_H}:flags=bilinear`,
        '-an',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'rgb24',
        'pipe:1'
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        try {
          child.kill()
        } catch {
          /* ignore */
        }
        resolve(null)
      }
    }, 90_000)

    child.stdout.on('data', (chunk: Buffer) => {
      if (frames.length >= MAX_SAMPLED_FRAMES) return
      const buf = carry.length > 0 ? Buffer.concat([carry, chunk]) : chunk
      let offset = 0
      while (offset + FRAME_BYTES <= buf.length && frames.length < MAX_SAMPLED_FRAMES) {
        const copy = new Uint8Array(FRAME_BYTES)
        buf.copy(copy, 0, offset, offset + FRAME_BYTES)
        frames.push(copy)
        offset += FRAME_BYTES
      }
      carry = offset < buf.length ? buf.subarray(offset) : Buffer.alloc(0)
    })

    child.on('error', () => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve(null)
      }
    })

    child.on('close', () => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (frames.length === 0) {
        resolve(null)
        return
      }
      const lumaFrames: Float32Array[] = new Array(frames.length)
      const frameMeanY = new Float64Array(frames.length)
      const frameStdY = new Float64Array(frames.length)
      const frameHsvHist: number[][] = new Array(frames.length)
      for (let i = 0; i < frames.length; i += 1) {
        const st = computeLumaAndStats(frames[i]!, SAMPLE_W, SAMPLE_H)
        lumaFrames[i] = st.luma
        frameMeanY[i] = st.meanY
        frameStdY[i] = st.stdY
        frameHsvHist[i] = st.hsvHist
      }
      resolve({
        width: SAMPLE_W,
        height: SAMPLE_H,
        sampleFps,
        frames,
        lumaFrames,
        frameMeanY,
        frameStdY,
        frameHsvHist
      })
    })
  })
}

function lumaMad(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i]! - b[i]!)
  return sum / Math.max(1, a.length)
}

function lumaBlendMad(mid: Float32Array, a: Float32Array, b: Float32Array, alpha = 0.5): number {
  let sum = 0
  const inv = 1 - alpha
  for (let i = 0; i < mid.length; i += 1) {
    sum += Math.abs(mid[i]! - (inv * a[i]! + alpha * b[i]!))
  }
  return sum / Math.max(1, mid.length)
}

/**
 * Refine shot boundaries with gradual transitions (`fade`, `dissolve`), suppress 1-frame flash false cuts,
 * and classify `transitionIn` for every shot.
 */
export function refineShotsWithVisualTrack(
  rawShots: ShotEvidence[],
  track: SampledRgbTrack,
  facts: MediaFacts,
  minShotSec = 0.45
): ShotEvidence[] {
  if (rawShots.length === 0 || track.frames.length < 3) return rawShots
  const fps = facts.fps || 30
  const n = track.frames.length
  const sFps = track.sampleFps

  // 1. Suppress 1-frame white-flash false cuts where before/after frames belong to the identical scene
  const filteredShots: ShotEvidence[] = [rawShots[0]!]
  for (let i = 1; i < rawShots.length; i += 1) {
    const prev = filteredShots[filteredShots.length - 1]!
    const cur = rawShots[i]!
    const cutIdx = clamp(Math.round(cur.range.start * sFps), 0, n - 1)
    const preIdx = clamp(cutIdx - 2, 0, n - 1)
    const postIdx = clamp(cutIdx + 2, 0, n - 1)
    const isBrightSpike =
      track.frameMeanY[cutIdx]! > 228 &&
      track.frameMeanY[preIdx]! < 195 &&
      track.frameMeanY[postIdx]! < 195
    const sameScene =
      hsvBhattacharyyaDistance(track.frameHsvHist[preIdx], track.frameHsvHist[postIdx]) < 0.14
    if (isBrightSpike && sameScene) {
      filteredShots[filteredShots.length - 1] = {
        ...prev,
        range: makeTimeRange(prev.range.start, cur.range.end, fps)
      }
      continue
    }
    filteredShots.push(cur)
  }

  // 2. Discover gradual Fade / Dissolve cuts inside long unsplit shots
  const splitExtra: Array<{ time: number; kind: ShotTransition }> = []
  const existingBoundaries = filteredShots.slice(1).map((s) => s.range.start)
  const nearExisting = (t: number, margin = 0.65): boolean =>
    existingBoundaries.some((b) => Math.abs(b - t) <= margin) ||
    splitExtra.some((b) => Math.abs(b.time - t) <= margin)

  const halfSpan = Math.max(2, Math.round(0.45 * sFps))
  for (let k = halfSpan; k < n - halfSpan; k += 1) {
    const t = k / sFps
    if (t < minShotSec || t > facts.durationSec - minShotSec || nearExisting(t)) continue

    // Check Fade trough (black or white uniform frame separating different scenes)
    const meanY = track.frameMeanY[k]!
    const stdY = track.frameStdY[k]!
    if ((meanY < 16 || meanY > 240) && stdY < 10) {
      const aIdx = clamp(k - halfSpan, 0, n - 1)
      const bIdx = clamp(k + halfSpan, 0, n - 1)
      if (
        ((meanY < 16 && track.frameMeanY[aIdx]! > 32 && track.frameMeanY[bIdx]! > 32) ||
          (meanY > 240 && track.frameMeanY[aIdx]! < 222 && track.frameMeanY[bIdx]! < 222)) &&
        hsvBhattacharyyaDistance(track.frameHsvHist[aIdx], track.frameHsvHist[bIdx]) >= 0.25
      ) {
        splitExtra.push({ time: Number(t.toFixed(3)), kind: 'fade' })
        continue
      }
    }

    // Check Dissolve midpoint (linear blend of A and B with significantly lower residual than either endpoint)
    const aIdx = k - halfSpan
    const bIdx = k + halfSpan
    const histDist = hsvBhattacharyyaDistance(track.frameHsvHist[aIdx], track.frameHsvHist[bIdx])
    if (histDist >= 0.42) {
      const errA = lumaMad(track.lumaFrames[k]!, track.lumaFrames[aIdx]!)
      const errB = lumaMad(track.lumaFrames[k]!, track.lumaFrames[bIdx]!)
      const minEndpointErr = Math.min(errA, errB)
      if (minEndpointErr >= 12) {
        const blendErr = lumaBlendMad(
          track.lumaFrames[k]!,
          track.lumaFrames[aIdx]!,
          track.lumaFrames[bIdx]!,
          0.5
        )
        if (blendErr < 0.58 * minEndpointErr) {
          splitExtra.push({ time: Number(t.toFixed(3)), kind: 'dissolve' })
        }
      }
    }
  }

  // Merge extra gradual cuts into the shot list
  const allBounds: Array<{ time: number; explicitKind?: ShotTransition; confidence: number }> =
    filteredShots.slice(1).map((s) => ({
      time: s.range.start,
      explicitKind: s.transitionIn,
      confidence: s.confidence
    }))
  for (const ex of splitExtra) {
    allBounds.push({ time: ex.time, explicitKind: ex.kind, confidence: 0.78 })
  }
  allBounds.sort((a, b) => a.time - b.time)

  const rebuilt: ShotEvidence[] = []
  let cursor = 0
  for (let idx = 0; idx <= allBounds.length; idx += 1) {
    const end = idx < allBounds.length ? allBounds[idx]!.time : facts.durationSec
    if (end - cursor < minShotSec && idx < allBounds.length) continue
    const prevBound = idx > 0 ? allBounds[idx - 1] : undefined
    rebuilt.push({
      id: `shot.${rebuilt.length + 1}`,
      range: makeTimeRange(cursor, end, fps),
      keyframes: {},
      confidence: prevBound?.confidence ?? rawShots[0]?.confidence ?? 0.85,
      transitionIn:
        idx === 0 ? 'cut' : classifyBoundaryTransition(cursor, prevBound?.explicitKind, track)
    })
    cursor = end
  }

  return rebuilt.length > 0 ? rebuilt : filteredShots
}

function classifyBoundaryTransition(
  cutSec: number,
  explicitKind: ShotTransition | undefined,
  track: SampledRgbTrack
): ShotTransition {
  if (explicitKind && explicitKind !== 'cut') return explicitKind
  const n = track.frames.length
  const k = clamp(Math.round(cutSec * track.sampleFps), 0, n - 1)
  const win = Math.max(1, Math.round(0.25 * track.sampleFps))
  let minY = 255
  let maxY = 0
  let minStd = 255
  for (let i = Math.max(0, k - win); i <= Math.min(n - 1, k + win); i += 1) {
    minY = Math.min(minY, track.frameMeanY[i]!)
    maxY = Math.max(maxY, track.frameMeanY[i]!)
    minStd = Math.min(minStd, track.frameStdY[i]!)
  }
  if ((minY < 18 || maxY > 238) && minStd < 12) return 'fade'
  if (maxY > 232 && track.frameMeanY[Math.max(0, k - 2)]! < 190) return 'flash'
  const aIdx = Math.max(0, k - 2)
  const bIdx = Math.min(n - 1, k + 2)
  if (bIdx - aIdx >= 3) {
    const errA = lumaMad(track.lumaFrames[k]!, track.lumaFrames[aIdx]!)
    const errB = lumaMad(track.lumaFrames[k]!, track.lumaFrames[bIdx]!)
    const blend = lumaBlendMad(
      track.lumaFrames[k]!,
      track.lumaFrames[aIdx]!,
      track.lumaFrames[bIdx]!
    )
    if (Math.min(errA, errB) >= 10 && blend < 0.62 * Math.min(errA, errB)) {
      return 'dissolve'
    }
  }
  return 'cut'
}

// ─── CIE Lab & Spatial / Motion / Aspect Feature Extraction ───────────────────

function srgbChannelToLinear(c: number): number {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

function labF(t: number): number {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116
}

/** D65 sRGB (0..255) -> CIE Lab (`L` in 0..100, `a` & `b` in ~-128..127). */
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbChannelToLinear(r)
  const gl = srgbChannelToLinear(g)
  const bl = srgbChannelToLinear(b)
  const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.072175 * bl
  const z = (0.0193339 * rl + 0.119192 * gl + 0.9503041 * bl) / 1.08883
  const fx = labF(x)
  const fy = labF(y)
  const fz = labF(z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function detectLetterboxCrop(
  luma: Float32Array,
  w: number,
  h: number
): { top: number; bottom: number; share: number } {
  const isBarRow = (y: number): boolean => {
    let sum = 0
    let sum2 = 0
    const rowOff = y * w
    for (let x = 0; x < w; x += 1) {
      const v = luma[rowOff + x]!
      sum += v
      sum2 += v * v
    }
    const mean = sum / w
    const std = Math.sqrt(Math.max(0, sum2 / w - mean * mean))
    return (mean < 10 || mean > 246) && std < 4.5
  }
  let top = 0
  while (top < Math.floor(h * 0.28) && isBarRow(top)) top += 1
  let bottom = h
  while (bottom > Math.ceil(h * 0.72) && isBarRow(bottom - 1)) bottom -= 1
  const barRows = top + (h - bottom)
  return { top, bottom, share: barRows / h }
}

function sampleBilinear(luma: Float32Array, w: number, h: number, x: number, y: number): number {
  const cx = clamp(x, 0, w - 1.001)
  const cy = clamp(y, 0, h - 1.001)
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const fx = cx - x0
  const fy = cy - y0
  const i00 = y0 * w + x0
  const v00 = luma[i00]!
  const v10 = luma[i00 + 1]!
  const v01 = luma[i00 + w]!
  const v11 = luma[i00 + w + 1]!
  return (1 - fy) * ((1 - fx) * v00 + fx * v10) + fy * ((1 - fx) * v01 + fx * v11)
}

function warpResidualMad(
  src: Float32Array,
  dst: Float32Array,
  w: number,
  h: number,
  scale: number,
  tx: number,
  ty: number,
  stride: number
): number {
  const cx = w * 0.5
  const cy = h * 0.5
  const invS = 1 / Math.max(0.5, scale)
  const xMin = Math.floor(w * 0.14)
  const xMax = Math.ceil(w * 0.86)
  const yMin = Math.floor(h * 0.14)
  const yMax = Math.ceil(h * 0.86)
  let sum = 0
  let count = 0
  for (let y = yMin; y < yMax; y += stride) {
    const sy = cy + (y - cy) * invS - ty
    if (sy < 1 || sy >= h - 2) continue
    for (let x = xMin; x < xMax; x += stride) {
      const sx = cx + (x - cx) * invS - tx
      if (sx < 1 || sx >= w - 2) continue
      const pred = sampleBilinear(src, w, h, sx, sy)
      sum += Math.abs(dst[y * w + x]! - pred)
      count += 1
    }
  }
  return count >= 32 ? sum / count : 999
}

/** Fit rigid 2D Ken Burns `(scale, tx, ty)` between `fStart` and `fEnd`, cross-checked on `fMid`. */
function fitPlanarZoomPan(
  fStart: Float32Array,
  fMid: Float32Array,
  fEnd: Float32Array,
  w: number,
  h: number,
  dtSec: number
): {
  kenburnsScore: number
  zoomPerSec: number
  panPxPerSec: number
  panDirDeg: number
} {
  if (dtSec < 0.35) {
    return { kenburnsScore: 0, zoomPerSec: 0, panPxPerSec: 0, panDirDeg: 0 }
  }
  const rawEndErr = warpResidualMad(fStart, fEnd, w, h, 1.0, 0, 0, 2)
  const rawMidErr = warpResidualMad(fStart, fMid, w, h, 1.0, 0, 0, 2)
  const rawAvg = 0.5 * (rawEndErr + rawMidErr)
  if (rawAvg < 1.0) {
    return { kenburnsScore: 0, zoomPerSec: 0, panPxPerSec: 0, panDirDeg: 0 }
  }

  let bestS = 1.0
  let bestTx = 0
  let bestTy = 0
  let bestErr = rawEndErr

  const scales = [0.84, 0.9, 0.95, 0.98, 1.0, 1.02, 1.05, 1.1, 1.16, 1.24]
  const shiftsX = [-16, -9, -4, 0, 4, 9, 16]
  const shiftsY = [-10, -5, -2, 0, 2, 5, 10]

  for (const s of scales) {
    for (const tx of shiftsX) {
      for (const ty of shiftsY) {
        const err = warpResidualMad(fStart, fEnd, w, h, s, tx, ty, 4)
        if (err < bestErr) {
          bestErr = err
          bestS = s
          bestTx = tx
          bestTy = ty
        }
      }
    }
  }

  // Coordinate-descent refinement
  for (const [ds, dxy, stride] of [
    [0.012, 1.5, 3],
    [0.004, 0.5, 2]
  ] as const) {
    let improved = true
    let iter = 0
    while (improved && iter < 6) {
      improved = false
      iter += 1
      for (const cand of [
        [bestS + ds, bestTx, bestTy],
        [bestS - ds, bestTx, bestTy],
        [bestS, bestTx + dxy, bestTy],
        [bestS, bestTx - dxy, bestTy],
        [bestS, bestTx, bestTy + dxy],
        [bestS, bestTx, bestTy - dxy]
      ] as const) {
        if (cand[0] < 0.72 || cand[0] > 1.42) continue
        const err = warpResidualMad(fStart, fEnd, w, h, cand[0], cand[1], cand[2], stride)
        if (err + 0.01 < bestErr) {
          bestErr = err
          bestS = cand[0]
          bestTx = cand[1]
          bestTy = cand[2]
          improved = true
        }
      }
    }
  }

  // Cross-validate on midpoint frame with half transform
  const midS = 1 + (bestS - 1) * 0.5
  const midErr = warpResidualMad(fStart, fMid, w, h, midS, bestTx * 0.5, bestTy * 0.5, 2)
  const finalEndErr = warpResidualMad(fStart, fEnd, w, h, bestS, bestTx, bestTy, 2)
  const alignedAvg = 0.5 * (finalEndErr + midErr)

  // High score requires BOTH strong relative reduction over unaligned diff AND low absolute residual
  const relGain = clamp(1 - alignedAvg / Math.max(1.2, rawAvg), 0, 1)
  const absPenalty = alignedAvg > 4.2 ? clamp(1 - (alignedAvg - 4.2) / 8, 0.2, 1) : 1
  const kenburnsScore = r3(relGain * absPenalty)

  const zoomPerSec = r3((bestS - 1) / dtSec)
  const normDx = bestTx / w
  const normDy = bestTy / h
  const panPxPerSec = r3(Math.hypot(normDx, normDy) / dtSec)
  const panDirDeg = Math.round((Math.atan2(normDy, normDx) * 180) / Math.PI)

  return { kenburnsScore, zoomPerSec, panPxPerSec, panDirDeg }
}

function estimateStepShift(
  a: Float32Array,
  b: Float32Array,
  w: number,
  h: number
): [number, number] {
  let bestDx = 0
  let bestDy = 0
  let bestErr = Infinity
  const x0 = Math.floor(w * 0.2)
  const x1 = Math.ceil(w * 0.8)
  const y0 = Math.floor(h * 0.2)
  const y1 = Math.ceil(h * 0.8)
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) {
      let err = 0
      let count = 0
      for (let y = y0; y < y1; y += 4) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let x = x0; x < x1; x += 4) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          err += Math.abs(b[y * w + x]! - a[yy * w + xx]!)
          count += 1
        }
      }
      const mad = err / Math.max(1, count)
      if (mad < bestErr - 0.02 || (Math.abs(mad - bestErr) <= 0.02 && dx === 0 && dy === 0)) {
        bestErr = mad
        bestDx = dx
        bestDy = dy
      }
    }
  }
  return [bestDx, bestDy]
}

function measureSpatialAndAspects(
  rgb: Uint8Array,
  luma: Float32Array,
  w: number,
  h: number
): {
  noiseSigma: number
  flatRatio: number
  flatLit: number
  darkShare: number
  darkStd: number
  palette95: number
  axisEdgeRatio: number
  fineDark: number
  fineLight: number
  vectorFill: number
  letterbox: number
  yTop: number
  yBot: number
  dominantHexPalette: string[]
  framing: FramingAspectMeasured
  lighting: LightingAspectMeasured
  grade: GradeAspectMeasured
} {
  const lb = detectLetterboxCrop(luma, w, h)
  const yTop = lb.top
  const yBot = Math.max(yTop + 16, lb.bottom)
  const activeH = yBot - yTop
  const activePixels = w * activeH

  // 1. Immerkær 3x3 Laplacian noise estimate (excluding clipped pixels & strong edges)
  let lapSum = 0
  let lapCount = 0
  let axisEdges = 0
  let strongEdges = 0
  let fineDarkCount = 0
  let fineLightCount = 0

  const edgeSalX = new Float64Array(w)
  const edgeSalY = new Float64Array(h)
  let skinPixels = 0
  let skinSumX = 0
  let skinSumY = 0

  for (let y = yTop + 1; y < yBot - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const idx = y * w + x
      const c = luma[idx]!
      const gx =
        -luma[idx - w - 1]! +
        luma[idx - w + 1]! -
        2 * luma[idx - 1]! +
        2 * luma[idx + 1]! -
        luma[idx + w - 1]! +
        luma[idx + w + 1]!
      const gy =
        -luma[idx - w - 1]! -
        2 * luma[idx - w]! -
        luma[idx - w + 1]! +
        luma[idx + w - 1]! +
        2 * luma[idx + w]! +
        luma[idx + w + 1]!
      const mag = Math.hypot(gx, gy)
      edgeSalX[x]! += mag
      edgeSalY[y]! += mag

      if (mag > 42) {
        strongEdges += 1
        const ax = Math.abs(gx)
        const ay = Math.abs(gy)
        if (ax < 0.18 * ay || ay < 0.18 * ax) axisEdges += 1
      } else if (c > 12 && c < 243) {
        const lap =
          luma[idx - w - 1]! -
          2 * luma[idx - w]! +
          luma[idx - w + 1]! -
          2 * luma[idx - 1]! +
          4 * c -
          2 * luma[idx + 1]! +
          luma[idx + w - 1]! -
          2 * luma[idx + w]! +
          luma[idx + w + 1]!
        lapSum += Math.abs(lap)
        lapCount += 1
      }

      const localMean = 0.25 * (luma[idx - w]! + luma[idx + w]! + luma[idx - 1]! + luma[idx + 1]!)
      if (c - localMean > 22 && localMean < 55) fineDarkCount += 1
      if (localMean - c > 22 && localMean > 175) fineLightCount += 1

      // Heuristic skin-tone detector in RGB/YCbCr for face/person framing hint
      const ro = idx * 3
      const r = rgb[ro]!
      const g = rgb[ro + 1]!
      const b = rgb[ro + 2]!
      if (r > 85 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 12) {
        const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
        const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
        if (cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173) {
          skinPixels += 1
          skinSumX += x
          skinSumY += y
        }
      }
    }
  }

  const noiseSigma = lapCount > 64 ? r3((Math.sqrt(Math.PI / 2) / 6) * (lapSum / lapCount)) : 0

  // 2. 8x8 flat blocks
  let flatBlocks = 0
  let flatLitBlocks = 0
  let totalBlocks = 0
  for (let by = yTop; by + 8 <= yBot; by += 8) {
    for (let bx = 0; bx + 8 <= w; bx += 8) {
      let s1 = 0
      let s2 = 0
      for (let dy = 0; dy < 8; dy += 1) {
        const off = (by + dy) * w + bx
        for (let dx = 0; dx < 8; dx += 1) {
          const v = luma[off + dx]!
          s1 += v
          s2 += v * v
        }
      }
      const m = s1 / 64
      const sd = Math.sqrt(Math.max(0, s2 / 64 - m * m))
      totalBlocks += 1
      if (sd < 1.25) {
        flatBlocks += 1
        if (m > 24) flatLitBlocks += 1
      }
    }
  }
  const flatRatio = r3(flatBlocks / Math.max(1, totalBlocks))
  const flatLit = r3(flatLitBlocks / Math.max(1, totalBlocks))
  const axisEdgeRatio = strongEdges >= 24 ? r3(axisEdges / strongEdges) : 0
  const fineDark = r3((fineDarkCount / Math.max(1, activePixels)) * 8)
  const fineLight = r3((fineLightCount / Math.max(1, activePixels)) * 8)

  // 3. 12-bit quantized palette95 + dominant hex colors + CIE Lab / HSV grade & lighting stats
  const bins = new Map<number, { count: number; rSum: number; gSum: number; bSum: number }>()
  const labLValues: number[] = []
  let sumSat = 0
  let sumBrightSat = 0
  let brightCount = 0
  let darkPixels = 0
  let darkSum = 0
  let darkSum2 = 0
  let sumLabL = 0
  let sumLabL2 = 0
  let sumLabB = 0
  let shadowBSum = 0
  let shadowCount = 0
  let highlightBSum = 0
  let highlightCount = 0
  const hueCounts = new Array<number>(12).fill(0)
  let satPixelCount = 0

  // Center subject box [25%..75%] vs outer border ring for lighting
  const sx0 = Math.floor(w * 0.25)
  const sx1 = Math.ceil(w * 0.75)
  const sy0 = Math.floor(yTop + activeH * 0.18)
  const sy1 = Math.ceil(yTop + activeH * 0.82)
  const sMidX = Math.floor((sx0 + sx1) * 0.5)
  const sMidY = Math.floor((sy0 + sy1) * 0.5)

  let leftY = 0
  let leftN = 0
  let rightY = 0
  let rightN = 0
  let topY = 0
  let topN = 0
  let botY = 0
  let botN = 0
  let subjY = 0
  let subjMidTone = 0
  let subjN = 0
  let subjWarmSum = 0
  let bgY = 0
  let bgN = 0
  let pointLights = 0

  for (let y = yTop; y < yBot; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x
      const o = idx * 3
      const r = rgb[o]!
      const g = rgb[o + 1]!
      const b = rgb[o + 2]!
      const yVal = luma[idx]!

      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
      const prev = bins.get(key)
      if (prev) {
        prev.count += 1
        prev.rSum += r
        prev.gSum += g
        prev.bSum += b
      } else {
        bins.set(key, { count: 1, rSum: r, gSum: g, bSum: b })
      }

      if (yVal < 24) {
        darkPixels += 1
        darkSum += yVal
        darkSum2 += yVal * yVal
      }

      const maxC = Math.max(r, g, b)
      const minC = Math.min(r, g, b)
      const delta = maxC - minC
      const sat = maxC > 0 ? delta / maxC : 0
      sumSat += sat
      if (maxC > 140) {
        brightCount += 1
        sumBrightSat += sat
      }
      if (sat > 0.2 && maxC > 45) {
        let hDeg = 0
        if (delta > 0) {
          if (maxC === r) hDeg = ((g - b) / delta) % 6
          else if (maxC === g) hDeg = (b - r) / delta + 2
          else hDeg = (r - g) / delta + 4
          hDeg = (hDeg * 60 + 360) % 360
        }
        hueCounts[Math.min(11, Math.floor(hDeg / 30))]! += 1
        satPixelCount += 1
      }

      const [labL, , labB] = rgbToLab(r, g, b)
      labLValues.push(labL)
      sumLabL += labL
      sumLabL2 += labL * labL
      sumLabB += labB
      if (labL < 32) {
        shadowBSum += labB
        shadowCount += 1
      } else if (labL > 72) {
        highlightBSum += labB
        highlightCount += 1
      }

      const inSubj = x >= sx0 && x < sx1 && y >= sy0 && y < sy1
      if (inSubj) {
        subjY += yVal
        subjN += 1
        subjWarmSum += labB
        if (x < sMidX) {
          leftY += yVal
          leftN += 1
        } else {
          rightY += yVal
          rightN += 1
        }
        if (y < sMidY) {
          topY += yVal
          topN += 1
        } else {
          botY += yVal
          botN += 1
        }
        if (yVal >= 65 && yVal <= 190) subjMidTone += 1
      } else {
        bgY += yVal
        bgN += 1
        if (yVal > 246) pointLights += 1
      }
    }
  }

  const sortedBins = [...bins.values()].sort((a, b) => b.count - a.count)
  let acc = 0
  let palette95 = 0
  const target95 = activePixels * 0.95
  for (const b of sortedBins) {
    acc += b.count
    palette95 += 1
    if (acc >= target95) break
  }

  const dominantHexPalette = sortedBins.slice(0, 5).map((b) => {
    const rr = Math.round(b.rSum / b.count)
    const gg = Math.round(b.gSum / b.count)
    const bb = Math.round(b.bSum / b.count)
    return `#${[rr, gg, bb].map((v) => clamp(v, 0, 255).toString(16).padStart(2, '0')).join('')}`
  })

  labLValues.sort((a, b) => a - b)
  const p5L = labLValues[Math.floor(labLValues.length * 0.05)] ?? 0
  const p95L = labLValues[Math.floor(labLValues.length * 0.95)] ?? 100
  const meanL = sumLabL / Math.max(1, activePixels)
  const stdL = Math.sqrt(Math.max(0, sumLabL2 / Math.max(1, activePixels) - meanL * meanL))

  const darkShare = r3(darkPixels / Math.max(1, activePixels))
  const darkMean = darkPixels > 0 ? darkSum / darkPixels : 0
  const darkStd =
    darkPixels > 0 ? r3(Math.sqrt(Math.max(0, darkSum2 / darkPixels - darkMean * darkMean))) : 0

  const vectorFill =
    noiseSigma < 0.75 && strongEdges > 40 ? r3(clamp(flatLit * 0.8 + (1 - noiseSigma), 0, 1)) : 0

  const hueBins =
    satPixelCount >= 30 ? hueCounts.filter((cnt) => cnt / satPixelCount >= 0.08).length : 0

  const grade: GradeAspectMeasured = {
    sat: r3(sumSat / Math.max(1, activePixels)),
    contrast: r3(stdL / 100),
    black: r3(p5L),
    white: r3(p95L),
    shadowB: shadowCount > 20 ? r3(shadowBSum / shadowCount) : 0,
    highlightB: highlightCount > 20 ? r3(highlightBSum / highlightCount) : 0,
    meanB: r3(sumLabB / Math.max(1, activePixels)),
    meanL: r3(meanL),
    brightShare: r3(brightCount / Math.max(1, activePixels)),
    darkShare,
    brightSat: brightCount > 10 ? r3(sumBrightSat / brightCount) : 0,
    hueBins
  }

  const lMean = leftY / Math.max(1, leftN)
  const rMean = rightY / Math.max(1, rightN)
  const tMean = topY / Math.max(1, topN)
  const bMean = botY / Math.max(1, botN)
  const ratio = r3(Math.max(lMean, rMean) / Math.max(8, Math.min(lMean, rMean)))

  const lighting: LightingAspectMeasured = {
    ratio,
    keySide: lMean >= rMean ? 'left' : 'right',
    topBottom: r3(tMean / Math.max(8, bMean)),
    transition: subjN > 0 ? r3(subjMidTone / subjN) : null,
    subjectLuma: r3(subjY / Math.max(1, subjN)),
    bgLuma: bgN > 0 ? r3(bgY / bgN) : null,
    darkShare,
    warmth: subjN > 0 ? r3(subjWarmSum / subjN) : 0,
    pointLights: Math.round(pointLights / 12)
  }

  // Framing estimation
  const skinShare = skinPixels / Math.max(1, activePixels)
  let centerX = 0.5
  let centerY = 0.5
  let area = 0.25
  let subjectKind: FramingAspectMeasured['subjectKind'] = 'focus'
  if (skinShare >= 0.025) {
    subjectKind = 'face'
    centerX = r3(skinSumX / skinPixels / w)
    centerY = r3(skinSumY / skinPixels / h)
    area = r3(clamp(skinShare * 2.8, 0.04, 0.85))
  } else {
    let totalSal = 0
    let weightedX = 0
    for (let x = 0; x < w; x += 1) {
      totalSal += edgeSalX[x]!
      weightedX += x * edgeSalX[x]!
    }
    let weightedY = 0
    let totalSalY = 0
    for (let y = yTop; y < yBot; y += 1) {
      totalSalY += edgeSalY[y]!
      weightedY += y * edgeSalY[y]!
    }
    if (totalSal > 100) {
      centerX = r3(weightedX / totalSal / w)
      centerY = r3(weightedY / Math.max(1, totalSalY) / h)
      area = flatRatio > 0.55 ? 0.65 : 0.28
    } else {
      subjectKind = 'frame'
      area = 0.75
    }
  }
  const shotSize: FramingAspectMeasured['shotSize'] =
    area >= 0.52
      ? subjectKind === 'face'
        ? 'ecu'
        : 'ls'
      : area >= 0.34
        ? subjectKind === 'face'
          ? 'cu'
          : 'fs'
        : area >= 0.18
          ? 'mcu'
          : area >= 0.09
            ? 'ms'
            : 'ls'

  const framing: FramingAspectMeasured = {
    subjectKind,
    centerX,
    centerY,
    area,
    shotSize,
    position: centerX < 0.38 ? 'left' : centerX > 0.62 ? 'right' : 'centred'
  }

  return {
    noiseSigma,
    flatRatio,
    flatLit,
    darkShare,
    darkStd,
    palette95,
    axisEdgeRatio,
    fineDark,
    fineLight,
    vectorFill,
    letterbox: r3(lb.share),
    yTop,
    yBot,
    dominantHexPalette,
    framing,
    lighting,
    grade
  }
}

/**
 * Detect burned-in packaging overlays (subtitles, huazi, corner logos/titles) that stay pixel-frozen
 * (`temporalStd < 2.2` + high Sobel edge density) while the underlying shot has active motion.
 */
function detectFrozenOverlayBoxes(
  lumaFrames: Float32Array[],
  startIdx: number,
  endIdx: number,
  w: number,
  h: number,
  yTop: number,
  yBot: number
): NonNullable<ShotForensicFeatures['frozenOverlayBoxes']> {
  const frameCount = endIdx - startIdx + 1
  if (frameCount < 4) return []
  const activeH = yBot - yTop
  if (activeH < 24 || w < 32) return []

  const n = w * h
  const tempStd = new Float32Array(n)
  let movingPixels = 0
  const activePixels = w * activeH

  for (let y = yTop; y < yBot; y += 1) {
    const rowOff = y * w
    for (let x = 0; x < w; x += 1) {
      const idx = rowOff + x
      let sum = 0
      let sum2 = 0
      for (let k = startIdx; k <= endIdx; k += 1) {
        const v = lumaFrames[k]![idx]!
        sum += v
        sum2 += v * v
      }
      const mean = sum / frameCount
      const std = Math.sqrt(Math.max(0, sum2 / frameCount - mean * mean))
      tempStd[idx] = std
      if (std >= 3.8) movingPixels += 1
    }
  }

  // Require real background/subject movement so static slides or UI screens are not mislabeled as overlays
  if (movingPixels / Math.max(1, activePixels) < 0.12) return []

  const midLuma = lumaFrames[Math.floor((startIdx + endIdx) * 0.5)]!
  const tw = 8
  const th = 6
  const cols = Math.floor(w / tw)
  const rows = Math.floor(activeH / th)
  if (cols < 4 || rows < 4) return []

  const mask = new Uint8Array(cols * rows)
  for (let r = 0; r < rows; r += 1) {
    const py0 = yTop + r * th
    for (let c = 0; c < cols; c += 1) {
      const px0 = c * tw
      let stdSum = 0
      let edgeCount = 0
      let pixCount = 0
      for (let dy = 0; dy < th; dy += 1) {
        const py = py0 + dy
        if (py <= yTop || py >= yBot - 1) continue
        for (let dx = 0; dx < tw; dx += 1) {
          const px = px0 + dx
          if (px <= 0 || px >= w - 1) continue
          const idx = py * w + px
          stdSum += tempStd[idx]!
          pixCount += 1
          const gx =
            -midLuma[idx - w - 1]! +
            midLuma[idx - w + 1]! -
            2 * midLuma[idx - 1]! +
            2 * midLuma[idx + 1]! -
            midLuma[idx + w - 1]! +
            midLuma[idx + w + 1]!
          const gy =
            -midLuma[idx - w - 1]! -
            2 * midLuma[idx - w]! -
            midLuma[idx - w + 1]! +
            midLuma[idx + w - 1]! +
            2 * midLuma[idx + w]! +
            midLuma[idx + w + 1]!
          if (Math.hypot(gx, gy) > 45) edgeCount += 1
        }
      }
      if (pixCount === 0) continue
      const meanTileStd = stdSum / pixCount
      const edgeDensity = edgeCount / pixCount
      if (meanTileStd < 2.2 && edgeDensity >= 0.12) {
        mask[r * cols + c] = edgeDensity >= 0.24 ? 2 : 1
      }
    }
  }

  const visited = new Uint8Array(cols * rows)
  const boxes: NonNullable<ShotForensicFeatures['frozenOverlayBoxes']> = []
  const queue: number[] = []

  for (let i = 0; i < cols * rows; i += 1) {
    if (!mask[i] || visited[i]) continue
    visited[i] = 1
    queue.length = 0
    queue.push(i)
    let minC = i % cols
    let maxC = minC
    let minR = Math.floor(i / cols)
    let maxR = minR
    let tileCount = 0
    let strongTiles = 0

    while (queue.length > 0) {
      const cur = queue.pop()!
      const cr = Math.floor(cur / cols)
      const cc = cur % cols
      tileCount += 1
      if (mask[cur] === 2) strongTiles += 1
      if (cc < minC) minC = cc
      if (cc > maxC) maxC = cc
      if (cr < minR) minR = cr
      if (cr > maxR) maxR = cr

      for (const [dr, dc] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
        [0, -2],
        [0, 2]
      ] as const) {
        const nr = cr + dr
        const nc = cc + dc
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue
        const ni = nr * cols + nc
        if (mask[ni] && !visited[ni]) {
          visited[ni] = 1
          queue.push(ni)
        }
      }
    }

    if (tileCount < 2 && strongTiles === 0) continue
    const rawX = (minC * tw) / w
    const rawY = (yTop + minR * th) / h
    const rawW = ((maxC - minC + 1) * tw) / w
    const rawH = ((maxR - minR + 1) * th) / h
    if (rawW * rawH > 0.36) continue

    const padX = 0.015
    const padY = 0.012
    const x = r3(clamp(rawX - padX, 0, 0.98))
    const y = r3(clamp(rawY - padY, 0, 0.98))
    const bw = r3(clamp(rawW + padX * 2, 0.02, 1 - x))
    const bh = r3(clamp(rawH + padY * 2, 0.02, 1 - y))
    const cy = y + bh * 0.5
    const band: 'top' | 'middle' | 'bottom' = cy < 0.32 ? 'top' : cy > 0.68 ? 'bottom' : 'middle'
    boxes.push({ x, y, w: bw, h: bh, band })
  }

  return boxes.slice(0, 6)
}

/** Extract deterministic `ShotForensicFeatures` for every shot in `shots` from `track`. */
export function extractAllShotForensics(
  shots: ShotEvidence[],
  track: SampledRgbTrack
): ShotEvidence[] {
  const n = track.frames.length
  if (n === 0) return shots
  const sFps = track.sampleFps
  const w = track.width
  const h = track.height

  return shots.map((shot) => {
    const startIdx = clamp(Math.ceil(shot.range.start * sFps), 0, n - 1)
    const endIdx = clamp(Math.floor((shot.range.end - 0.02) * sFps), startIdx, n - 1)
    const midIdx = Math.floor((startIdx + endIdx) * 0.5)

    // Spatial measurements on representative middle frame
    const spatial = measureSpatialAndAspects(track.frames[midIdx]!, track.lumaFrames[midIdx]!, w, h)

    // Temporal frame diffs, duplicate cadence, border-vs-center motion & handheld jitter
    const count = endIdx - startIdx + 1
    let diffSum = 0
    let dupCount = 0
    let borderDiffSum = 0
    let centerDiffSum = 0
    const shifts: Array<[number, number]> = []

    for (let k = startIdx + 1; k <= endIdx; k += 1) {
      const a = track.lumaFrames[k - 1]!
      const b = track.lumaFrames[k]!
      const d = lumaMad(a, b)
      diffSum += d
      if (d < 0.72) dupCount += 1

      // Border vs center diff
      let bSum = 0
      let bN = 0
      let cSum = 0
      let cN = 0
      for (let y = 0; y < h; y += 2) {
        const inCenterY = y >= h * 0.2 && y < h * 0.85
        for (let x = 0; x < w; x += 2) {
          const v = Math.abs(b[y * w + x]! - a[y * w + x]!)
          if (inCenterY && x >= w * 0.22 && x < w * 0.78) {
            cSum += v
            cN += 1
          } else {
            bSum += v
            bN += 1
          }
        }
      }
      borderDiffSum += bSum / Math.max(1, bN)
      centerDiffSum += cSum / Math.max(1, cN)
      shifts.push(estimateStepShift(a, b, w, h))
    }

    const pairs = Math.max(0, count - 1)
    const meanFrameDiff = pairs > 0 ? r3(diffSum / pairs) : 0
    const dupRatio = pairs > 0 ? r3(dupCount / pairs) : 1
    const borderDiff = pairs > 0 ? borderDiffSum / pairs : 0
    const centerDiff = pairs > 0 ? centerDiffSum / pairs : 0

    let signFlips = 0
    let activeShiftPairs = 0
    for (let i = 1; i < shifts.length; i += 1) {
      const [dx0, dy0] = shifts[i - 1]!
      const [dx1, dy1] = shifts[i]!
      if (dx0 !== 0 || dy0 !== 0 || dx1 !== 0 || dy1 !== 0) {
        activeShiftPairs += 1
        if (dx0 * dx1 < 0 || dy0 * dy1 < 0) signFlips += 1
      }
    }
    const signFlipRate = activeShiftPairs >= 3 ? r3(signFlips / activeShiftPairs) : 0

    // Fit global Ken Burns planar zoom/pan across inner 80% of shot duration
    const kbStartIdx = clamp(startIdx + Math.floor(count * 0.1), startIdx, endIdx)
    const kbEndIdx = clamp(endIdx - Math.floor(count * 0.1), kbStartIdx, endIdx)
    const kbMidIdx = Math.floor((kbStartIdx + kbEndIdx) * 0.5)
    const kbDt = (kbEndIdx - kbStartIdx) / sFps
    const kb = fitPlanarZoomPan(
      track.lumaFrames[kbStartIdx]!,
      track.lumaFrames[kbMidIdx]!,
      track.lumaFrames[kbEndIdx]!,
      w,
      h,
      kbDt
    )

    let cameraMotionKind: CameraMotionForensicKind = 'smooth_move'
    if (meanFrameDiff < 0.75 || (dupRatio >= 0.92 && meanFrameDiff < 1.35)) {
      cameraMotionKind = 'static'
    } else if (
      kb.kenburnsScore >= 0.82 &&
      (Math.abs(kb.zoomPerSec) >= 0.012 || kb.panPxPerSec >= 0.018)
    ) {
      cameraMotionKind = 'planar_zoom_pan'
    } else if (borderDiff < 1.15 && centerDiff >= 2.2) {
      cameraMotionKind = 'static_with_subject_motion'
    } else if (signFlipRate >= 0.3 && borderDiff >= 1.4) {
      cameraMotionKind = 'handheld_like'
    } else if (borderDiff < 1.0) {
      cameraMotionKind = 'static'
    }

    const cameraAspect: CameraAspectMeasured = {
      support:
        cameraMotionKind === 'handheld_like'
          ? 'handheld'
          : cameraMotionKind === 'static' || cameraMotionKind === 'static_with_subject_motion'
            ? 'fixed'
            : 'moving',
      move:
        kb.zoomPerSec >= 0.015
          ? 'push_in'
          : kb.zoomPerSec <= -0.015
            ? 'pull_out'
            : kb.panPxPerSec >= 0.02
              ? 'pan_track'
              : 'static',
      shake: signFlipRate
    }

    const frozenOverlayBoxes = detectFrozenOverlayBoxes(
      track.lumaFrames,
      startIdx,
      endIdx,
      w,
      h,
      spatial.yTop,
      spatial.yBot
    )

    const forensics: ShotForensicFeatures = {
      noiseSigma: spatial.noiseSigma,
      flatRatio: spatial.flatRatio,
      flatLit: spatial.flatLit,
      darkShare: spatial.darkShare,
      darkStd: spatial.darkStd,
      palette95: spatial.palette95,
      axisEdgeRatio: spatial.axisEdgeRatio,
      fineDark: spatial.fineDark,
      fineLight: spatial.fineLight,
      vectorFill: spatial.vectorFill,
      letterbox: spatial.letterbox,
      dominantHexPalette: spatial.dominantHexPalette,
      hsvHist: track.frameHsvHist[midIdx],
      meanFrameDiff,
      dupRatio,
      cameraMotionKind,
      kenburnsScore: kb.kenburnsScore,
      zoomPerSec: kb.zoomPerSec,
      panPxPerSec: kb.panPxPerSec,
      panDirDeg: kb.panDirDeg,
      signFlipRate,
      ...(frozenOverlayBoxes.length ? { frozenOverlayBoxes } : {}),
      aspects: {
        framing: spatial.framing,
        camera: cameraAspect,
        lighting: spatial.lighting,
        grade: spatial.grade
      }
    }

    return {
      ...shot,
      forensics
    }
  })
}

// ─── Composite Storyboard Contact Sheet (`evidence/storyboard.jpg`) ───────────

/**
 * Render a clean composite storyboard contact sheet from extracted shot keyframes
 * using pure-JS `jpeg-js`. Returns relative path inside `Semantic/<id>/` (`evidence/storyboard.jpg`)
 * or undefined when no keyframes can be decoded.
 */
export function renderStoryboardContactSheet(
  semanticDirAbs: string,
  shots: ShotEvidence[],
  videoAspect: { width: number; height: number }
): string | undefined {
  const usable = shots
    .slice(0, 32)
    .map((s) => {
      const rel = s.keyframes?.middle ?? s.keyframes?.first ?? s.keyframes?.last
      const abs = rel ? join(semanticDirAbs, ...rel.split('/')) : ''
      return { shot: s, abs }
    })
    .filter((x) => x.abs && existsSync(x.abs))

  if (usable.length === 0) return undefined

  const portrait = (videoAspect.height || 1080) > (videoAspect.width || 1920)
  const tileW = portrait ? 160 : 240
  const tileH = portrait ? 284 : 135
  const pad = 8
  const cols = Math.min(portrait ? 5 : 4, usable.length)
  const rows = Math.ceil(usable.length / cols)
  const canvasW = cols * tileW + (cols + 1) * pad
  const canvasH = rows * tileH + (rows + 1) * pad
  const rgba = new Uint8Array(canvasW * canvasH * 4)

  // Fill dark neutral background (#14161a)
  for (let i = 0; i < canvasW * canvasH; i += 1) {
    const o = i * 4
    rgba[o] = 20
    rgba[o + 1] = 22
    rgba[o + 2] = 26
    rgba[o + 3] = 255
  }

  let renderedCount = 0
  usable.forEach((item, index) => {
    try {
      const bytes = readFileSync(item.abs)
      const decoded = decodeJpeg(bytes, {
        useTArray: true,
        maxMemoryUsageInMB: 512
      })
      if (!decoded?.data || decoded.width <= 0 || decoded.height <= 0) return
      const col = index % cols
      const row = Math.floor(index / cols)
      const ox = pad + col * (tileW + pad)
      const oy = pad + row * (tileH + pad)

      for (let ty = 0; ty < tileH; ty += 1) {
        const sy = Math.min(decoded.height - 1, Math.floor((ty * decoded.height) / tileH))
        for (let tx = 0; tx < tileW; tx += 1) {
          const sx = Math.min(decoded.width - 1, Math.floor((tx * decoded.width) / tileW))
          const srcOff = (sy * decoded.width + sx) * 4
          const dstOff = ((oy + ty) * canvasW + (ox + tx)) * 4
          rgba[dstOff] = decoded.data[srcOff]!
          rgba[dstOff + 1] = decoded.data[srcOff + 1]!
          rgba[dstOff + 2] = decoded.data[srcOff + 2]!
          rgba[dstOff + 3] = 255
        }
      }
      renderedCount += 1
    } catch {
      /* skip corrupt frame */
    }
  })

  if (renderedCount === 0) return undefined

  const outRel = 'evidence/storyboard.jpg'
  const outAbs = join(semanticDirAbs, ...outRel.split('/'))
  mkdirSync(dirname(outAbs), { recursive: true })
  const encoded = encodeJpeg({ data: rgba, width: canvasW, height: canvasH }, 82)
  writeFileSync(outAbs, encoded.data)
  return outRel
}

/**
 * Stitch per-shot `[First | Middle | Last]` 3-frame horizontal temporal triptych strips
 * (`evidence/keyframes/<shotId>.strip.jpg`) via pure-JS `jpeg-js` so VLM perceives camera
 * movement, action progression, and frozen overlays in a single image slot.
 */
export function renderShotTriptychStrips(
  semanticDirAbs: string,
  shots: ShotEvidence[],
  videoAspect: { width: number; height: number } = { width: 1080, height: 1920 }
): ShotEvidence[] {
  const aspectW = Math.max(1, videoAspect.width || 1080)
  const aspectH = Math.max(1, videoAspect.height || 1920)
  const portrait = aspectH >= aspectW
  const panelH = portrait ? 320 : 216
  const panelW = Math.max(120, Math.min(420, Math.round((panelH * aspectW) / aspectH)))
  const gap = 4
  const pad = 4
  const canvasW = panelW * 3 + gap * 2 + pad * 2
  const canvasH = panelH + pad * 2

  return shots.map((shot) => {
    const firstRel = shot.keyframes?.first
    const midRel = shot.keyframes?.middle ?? firstRel
    const lastRel = shot.keyframes?.last ?? midRel
    const distinctPaths = new Set([firstRel, midRel, lastRel].filter(Boolean))
    if (distinctPaths.size < 2) return shot

    const panelRels = [
      firstRel ?? midRel ?? lastRel,
      midRel ?? firstRel ?? lastRel,
      lastRel ?? midRel ?? firstRel
    ]
    if (panelRels.some((r) => !r)) return shot

    const panelAbsList = panelRels.map((r) => join(semanticDirAbs, ...r!.split('/')))
    if (panelAbsList.some((abs) => !existsSync(abs))) return shot

    try {
      const rgba = new Uint8Array(canvasW * canvasH * 4)
      for (let i = 0; i < canvasW * canvasH; i += 1) {
        const o = i * 4
        rgba[o] = 18
        rgba[o + 1] = 20
        rgba[o + 2] = 24
        rgba[o + 3] = 255
      }

      const markerColors: ReadonlyArray<[number, number, number]> = [
        [72, 199, 142], // green = start
        [92, 148, 255], // blue = middle
        [255, 169, 77] // amber = end
      ]

      for (let p = 0; p < 3; p += 1) {
        const decoded = decodeJpeg(readFileSync(panelAbsList[p]!), {
          useTArray: true,
          maxMemoryUsageInMB: 256
        })
        if (!decoded?.data || decoded.width <= 0 || decoded.height <= 0) return shot
        const ox = pad + p * (panelW + gap)
        const oy = pad
        for (let ty = 0; ty < panelH; ty += 1) {
          const sy = Math.min(decoded.height - 1, Math.floor((ty * decoded.height) / panelH))
          for (let tx = 0; tx < panelW; tx += 1) {
            const sx = Math.min(decoded.width - 1, Math.floor((tx * decoded.width) / panelW))
            const srcOff = (sy * decoded.width + sx) * 4
            const dstOff = ((oy + ty) * canvasW + (ox + tx)) * 4
            rgba[dstOff] = decoded.data[srcOff]!
            rgba[dstOff + 1] = decoded.data[srcOff + 1]!
            rgba[dstOff + 2] = decoded.data[srcOff + 2]!
            rgba[dstOff + 3] = 255
          }
        }
        // Subtle 4px top progress bar indicator per panel (Start / Mid / End)
        const [mr, mg, mb] = markerColors[p]!
        const barW = Math.min(panelW, 28)
        for (let by = 0; by < 4; by += 1) {
          for (let bx = 0; bx < barW; bx += 1) {
            const dstOff = ((oy + by) * canvasW + (ox + bx)) * 4
            rgba[dstOff] = mr
            rgba[dstOff + 1] = mg
            rgba[dstOff + 2] = mb
            rgba[dstOff + 3] = 255
          }
        }
      }

      const outRel = `evidence/keyframes/${shot.id}.strip.jpg`
      const outAbs = join(semanticDirAbs, ...outRel.split('/'))
      mkdirSync(dirname(outAbs), { recursive: true })
      const encoded = encodeJpeg({ data: rgba, width: canvasW, height: canvasH }, 82)
      writeFileSync(outAbs, encoded.data)
      return {
        ...shot,
        keyframes: {
          ...shot.keyframes,
          strip: outRel
        }
      }
    } catch {
      return shot
    }
  })
}
