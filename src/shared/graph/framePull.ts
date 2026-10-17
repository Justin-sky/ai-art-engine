/**
 * 逐帧拉片与区间 AI 重生成替换（video.framePull）共享纯函数与类型契约。
 *
 * 核心能力：
 * 1. 智能混合胶片条采样（关键帧 + 自适应均匀采样，解决长视频仅 1~2 个 I 帧或回退抽取数百帧卡死的问题）
 * 2. 连续帧区间 `[inFrame, outFrame]` 归一化与时间码换算（帧精确）
 * 3. 首尾帧锚定重拍提示词构建（自动融合区间内的拉片批注与边界衔接约束）
 * 4. FFmpeg 局部片段无缝替换回原视频的 3 段式拼接清单构建（前段直通 + 重拍段对齐 + 后段直通）
 */

import type { SemanticRebuildSegment } from '../semanticTimeline'
import { formatReshootTimestamp } from './reshoot'

/** 区间重生成锚定模式 */
export type FramePullConditioningMode = 'first_last' | 'first_only' | 'video_ref'

/** 重生成片段替换回原视频时的时长对齐策略 */
export type FramePullFitMode = 'stretch' | 'trim'

/** 胶片条采样模式 */
export type FramePullFilmstripMode = 'keyframe' | 'hybrid' | 'uniform' | 'frame' | ''

/** 单次区间 AI 重生成并替换回原视频的历史记录 */
export interface FramePullSpliceRecord {
  id: string
  inFrame: number
  outFrame: number
  inSec: number
  outSec: number
  instruction: string
  conditioningMode: FramePullConditioningMode
  fitMode: FramePullFitMode
  keepAudio: boolean
  clipRelativePath: string
  outputRelativePath: string
  model?: string
  createdAt: string
}

/** 归一化后的连续帧区间 */
export interface NormalizedFramePullRange {
  valid: boolean
  inFrame: number
  outFrame: number
  frameCount: number
  inSec: number
  outSec: number
  segmentDurationSec: number
  fps: number
  totalFrames: number
}

function isEnglishLocale(locale?: string): boolean {
  return locale === 'en-US' || (locale?.startsWith('en') ?? false)
}

function pickByLocale(locale: string | undefined, en: string, zh: string): string {
  return isEnglishLocale(locale) ? en : zh
}

/**
 * 从拉片帧 ID（形如 `pull:24:1710000000000`）解析帧号。
 */
export function parsePulledFrameIndex(id: string | undefined): number | null {
  if (!id) return null
  const match = /^pull:(\d+):/.exec(id.trim())
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n >= 0 ? n : null
}

/**
 * 归一化连续帧区间 `[inFrame, outFrame]` 并换算对应秒数区间 `[inSec, outSec]`。
 */
export function normalizeFramePullRange(input: {
  inFrame?: number | null
  outFrame?: number | null
  totalFrames?: number | null
  fps?: number | null
  durationSec?: number | null
}): NormalizedFramePullRange {
  const safeFps =
    Number.isFinite(input.fps) && Number(input.fps) > 0 ? Math.round(Number(input.fps)) : 24
  const safeDuration =
    Number.isFinite(input.durationSec) && Number(input.durationSec) > 0
      ? Number(input.durationSec)
      : 0
  const maxFramesFromDuration =
    safeDuration > 0 ? Math.max(1, Math.round(safeDuration * safeFps)) : 0
  const safeTotalFrames =
    Number.isFinite(input.totalFrames) && Number(input.totalFrames) > 0
      ? Math.round(Number(input.totalFrames))
      : maxFramesFromDuration
  const maxFrameIndex = safeTotalFrames > 0 ? Math.max(0, safeTotalFrames - 1) : 999999

  const rawIn = input.inFrame
  const rawOut = input.outFrame
  if (
    rawIn == null ||
    rawOut == null ||
    !Number.isFinite(rawIn) ||
    !Number.isFinite(rawOut) ||
    rawIn < 0 ||
    rawOut < 0
  ) {
    return {
      valid: false,
      inFrame: 0,
      outFrame: 0,
      frameCount: 0,
      inSec: 0,
      outSec: 0,
      segmentDurationSec: 0,
      fps: safeFps,
      totalFrames: safeTotalFrames
    }
  }

  const clampedA = Math.max(0, Math.min(maxFrameIndex, Math.round(rawIn)))
  const clampedB = Math.max(0, Math.min(maxFrameIndex, Math.round(rawOut)))
  const inFrame = Math.min(clampedA, clampedB)
  const outFrame = Math.max(clampedA, clampedB)
  const frameCount = outFrame - inFrame + 1

  const rawInSec = inFrame / safeFps
  // 出点包含 outFrame 本帧时长：(outFrame + 1) / safeFps
  const rawOutSec = (outFrame + 1) / safeFps
  const inSec = Number(Math.max(0, rawInSec).toFixed(3))
  const cappedOutSec = safeDuration > 0 ? Math.min(safeDuration, rawOutSec) : rawOutSec
  const outSec = Number(Math.max(inSec + 1 / safeFps, cappedOutSec).toFixed(3))
  const segmentDurationSec = Number(Math.max(1 / safeFps, outSec - inSec).toFixed(3))

  return {
    valid: frameCount >= 2 && outSec > inSec,
    inFrame,
    outFrame,
    frameCount,
    inSec,
    outSec,
    segmentDurationSec,
    fps: safeFps,
    totalFrames: safeTotalFrames
  }
}

/**
 * 智能胶片条采样时间点计算：
 * - 解决传统模式「只有 1~2 个 I 帧导致无法框选」或「无 ffprobe 时抽取数百帧卡死并撑爆工程 JSON」的缺陷；
 * - 当关键帧过少（< minThumbs）时自动融合均匀采样点（hybrid），保证胶片条密度均匀、可精确框选；
 * - 当总帧数超过 maxThumbs 时按步长均匀降采样（uniform），兼顾流畅度与帧级定位。
 */
export function computeAdaptiveFilmstripTimes(input: {
  durationSec: number
  fps: number
  keyframeTimes?: number[] | null
  minThumbs?: number
  maxThumbs?: number
}): { times: number[]; frames: number[]; mode: 'keyframe' | 'hybrid' | 'uniform' } {
  const durationSec = Math.max(0, Number(input.durationSec) || 0)
  const fps = Math.max(1, Math.round(Number(input.fps) || 24))
  const maxThumbs = Math.max(8, Math.min(72, Math.round(input.maxThumbs ?? 36)))
  const minThumbs = Math.max(6, Math.min(maxThumbs, Math.round(input.minThumbs ?? 18)))

  if (durationSec <= 0) {
    return { times: [0], frames: [0], mode: 'uniform' }
  }

  const totalFrames = Math.max(1, Math.round(durationSec * fps))
  const targetCount = Math.min(totalFrames, maxThumbs)
  const validKeyframes = (input.keyframeTimes ?? [])
    .filter((t) => Number.isFinite(t) && t >= 0 && t <= durationSec)
    .map((t) => Math.min(durationSec, Math.max(0, t)))
    .sort((a, b) => a - b)

  const frameSet = new Set<number>()
  let mode: 'keyframe' | 'hybrid' | 'uniform' = 'uniform'

  if (validKeyframes.length >= Math.min(minThumbs, totalFrames)) {
    mode = 'keyframe'
    const step = validKeyframes.length > maxThumbs ? validKeyframes.length / maxThumbs : 1
    for (let i = 0; i < Math.min(validKeyframes.length, maxThumbs); i += 1) {
      const t = validKeyframes[Math.min(validKeyframes.length - 1, Math.floor(i * step))]!
      frameSet.add(Math.min(totalFrames - 1, Math.max(0, Math.round(t * fps))))
    }
  } else {
    mode = validKeyframes.length > 0 ? 'hybrid' : 'uniform'
    for (const t of validKeyframes) {
      frameSet.add(Math.min(totalFrames - 1, Math.max(0, Math.round(t * fps))))
    }
    if (targetCount <= 1) {
      frameSet.add(0)
    } else {
      for (let i = 0; i < targetCount; i += 1) {
        const f = Math.round((i / (targetCount - 1)) * (totalFrames - 1))
        frameSet.add(Math.min(totalFrames - 1, Math.max(0, f)))
      }
    }
  }

  // 始终确保首帧与尾帧在胶片条中，方便首尾区间框选
  frameSet.add(0)
  if (totalFrames > 1) {
    frameSet.add(totalFrames - 1)
  }

  let frames = [...frameSet].sort((a, b) => a - b)
  if (frames.length > maxThumbs) {
    const first = frames[0]!
    const last = frames[frames.length - 1]!
    const inner = frames.slice(1, -1)
    const keepInnerCount = Math.max(0, maxThumbs - 2)
    const pickedInner: number[] = []
    for (let i = 0; i < keepInnerCount && i < inner.length; i += 1) {
      const idx = Math.min(
        inner.length - 1,
        Math.floor((i / Math.max(1, keepInnerCount)) * inner.length)
      )
      pickedInner.push(inner[idx]!)
    }
    frames = [first, ...pickedInner, last]
  }
  const times = frames.map((f) => Number(Math.min(durationSec, f / fps).toFixed(4)))
  return { times, frames, mode }
}

/**
 * 收集落在 `[inFrame, outFrame]` 区间内的拉片批注（按帧号升序）。
 */
export function collectRangeFrameNotes(input: {
  frames: Array<{ id?: string }>
  frameNotes?: Record<string, string> | null
  inFrame: number
  outFrame: number
}): Array<{ frame: number; note: string }> {
  const notes = input.frameNotes ?? {}
  const collected: Array<{ frame: number; note: string }> = []
  const lo = Math.min(input.inFrame, input.outFrame)
  const hi = Math.max(input.inFrame, input.outFrame)

  for (const item of input.frames) {
    const id = item.id ?? ''
    const frameIdx = parsePulledFrameIndex(id)
    if (frameIdx == null || frameIdx < lo || frameIdx > hi) continue
    const text = (notes[id] ?? '').trim()
    if (!text) continue
    collected.push({ frame: frameIdx, note: text })
  }

  return collected.sort((a, b) => a.frame - b.frame)
}

/**
 * 把全部拉片批注整理为结构化文本报告（供 out-notes 或复制使用）。
 */
export function formatFramePullNotesReport(input: {
  frames: Array<{ id?: string }>
  frameNotes?: Record<string, string> | null
  fps?: number | null
}): string {
  const notes = input.frameNotes ?? {}
  const safeFps =
    Number.isFinite(input.fps) && Number(input.fps) > 0 ? Math.round(Number(input.fps)) : 24
  const rows: Array<{ frame: number; text: string }> = []
  for (const item of input.frames) {
    const id = item.id ?? ''
    const frameIdx = parsePulledFrameIndex(id)
    if (frameIdx == null) continue
    const text = (notes[id] ?? '').trim()
    if (!text) continue
    rows.push({ frame: frameIdx, text })
  }
  rows.sort((a, b) => a.frame - b.frame)
  return rows
    .map((r) => {
      const ts = formatReshootTimestamp(r.frame / safeFps)
      return `[F${r.frame} | ${ts}] ${r.text}`
    })
    .join('\n')
}

export const DEFAULT_FRAME_PULL_RESHOOT_SYSTEM_PROMPT_ZH =
  '你是一名专业影视精修与分镜重拍导演。请严格根据提供的首尾锚定帧（或原视频参考区间）与修改指令生成替换片段。必须保持人物身份、服装道具、场景光影、透视机位与镜头运动在区间入点（首帧）和出点（尾帧）处完全无缝衔接，严禁出现跳切、画风突变、多余字幕、水印或 UI。' // cjk-ok

export const DEFAULT_FRAME_PULL_RESHOOT_SYSTEM_PROMPT_EN =
  'You are a professional film finishing and shot-repair director. Generate a replacement video segment strictly following the boundary anchor frames (or reference video segment) and reshoot instructions. Preserve character identity, wardrobe, lighting, camera perspective, and motion continuity so the segment splices seamlessly at both the In-frame and Out-frame without jump cuts, style drift, subtitles, watermarks, or extra UI.'

export function resolveFramePullReshootSystemPrompt(
  raw: string | undefined,
  locale?: string
): string {
  const trimmed = raw?.trim() ?? ''
  if (trimmed) return trimmed
  return pickByLocale(
    locale,
    DEFAULT_FRAME_PULL_RESHOOT_SYSTEM_PROMPT_EN,
    DEFAULT_FRAME_PULL_RESHOOT_SYSTEM_PROMPT_ZH
  )
}

/**
 * 构建拉片区间重生成的提示词：融合用户重拍指令、区间帧号/时间码、区间内拉片批注与锚定衔接要求。
 */
export function buildFramePullReshootPrompt(input: {
  instruction: string
  inFrame: number
  outFrame: number
  inSec: number
  outSec: number
  conditioningMode?: FramePullConditioningMode
  rangeNotes?: Array<{ frame: number; note: string }>
  locale?: string
}): string {
  const mode = input.conditioningMode ?? 'first_last'
  const trimmed = input.instruction.trim()
  const startTs = formatReshootTimestamp(input.inSec) || `${input.inSec.toFixed(2)}s`
  const endTs = formatReshootTimestamp(input.outSec) || `${input.outSec.toFixed(2)}s`
  const durSec = Math.max(0.2, input.outSec - input.inSec).toFixed(2)
  const notes = input.rangeNotes ?? []

  const notesClauseZh =
    notes.length > 0
      ? ` 逐帧批注要求：${notes.map((n) => `[帧${n.frame}] ${n.note}`).join('；')}。` // cjk-ok
      : ''
  const notesClauseEn =
    notes.length > 0
      ? ` Frame notes: ${notes.map((n) => `[F${n.frame}] ${n.note}`).join('; ')}.`
      : ''

  if (mode === 'video_ref') {
    const coreZh = trimmed || '按首尾锚点自然优化该区间内的动作与画面表现' // cjk-ok
    const coreEn = trimmed || 'refine the motion and visual performance within this segment'
    return pickByLocale(
      input.locale,
      `Edit @video 1 segment ${startTs}—${endTs} (Frames F${input.inFrame}–F${input.outFrame}, ${durSec}s): ${coreEn}.${notesClauseEn} Keep character identity, lighting, camera movement, and boundary frames strictly continuous with the original video.`,
      `重拍 @视频1 区间 ${startTs}—${endTs}（第 ${input.inFrame}～${input.outFrame} 帧，共 ${durSec} 秒）：${coreZh}。${notesClauseZh}严格保持人物身份、光影、运镜以及入出点边界画面与原视频无缝衔接。` // cjk-ok
    )
  }

  if (mode === 'first_only') {
    const coreZh = trimmed || '从首帧自然延续镜头运动与主体动作' // cjk-ok
    const coreEn =
      trimmed || 'continue the camera motion and subject action naturally from the start frame'
    return pickByLocale(
      input.locale,
      `Segment reshoot (Frames F${input.inFrame}–F${input.outFrame}, ${durSec}s): Starting strictly from the provided first frame (F${input.inFrame}), ${coreEn}.${notesClauseEn} Maintain consistent character identity, environment lighting, and camera lens style.`,
      `局部片段重拍（第 ${input.inFrame}～${input.outFrame} 帧，时长 ${durSec} 秒）：严格从提供的入点首帧（第 ${input.inFrame} 帧）平滑起幅，${coreZh}。${notesClauseZh}保持人物外观、环境光影与镜头景别一致。` // cjk-ok
    )
  }

  const coreZh = trimmed || '在首帧与尾帧之间生成自然连贯的过渡动作与镜头运动' // cjk-ok
  const coreEn =
    trimmed ||
    'generate smooth, natural transitional motion and camera movement between the first and last frames'
  return pickByLocale(
    input.locale,
    `First-to-Last Frame Anchored Segment Reshoot (Frames F${input.inFrame}–F${input.outFrame}, ${durSec}s): Transition smoothly from the exact In-frame (F${input.inFrame}) to the exact Out-frame (F${input.outFrame}). ${coreEn}.${notesClauseEn} Ensure zero jump-cut at both boundaries.`,
    `首尾帧锚定局部重拍（第 ${input.inFrame}～${input.outFrame} 帧，时长 ${durSec} 秒）：严格从入点首帧（第 ${input.inFrame} 帧）自然过渡并精准落幅到出点尾帧（第 ${input.outFrame} 帧），${coreZh}。${notesClauseZh}确保入出点两端零跳切无缝衔接。` // cjk-ok
  )
}

/**
 * 为视频生成模型推荐合适的生成时长（秒，整数 2~10s）。
 */
export function recommendVideoGenerationDuration(segmentDurationSec: number): number {
  if (!Number.isFinite(segmentDurationSec) || segmentDurationSec <= 0) return 5
  const rounded = Math.ceil(segmentDurationSec)
  return Math.max(2, Math.min(10, rounded < 4 ? 5 : rounded))
}

/**
 * 构建将重生成视频片段无缝替换回原视频的 3 段式拼接列表：
 * - head: `[0, inSec)` 原片直通（当 `inSec >= 0.04` 时存在）
 * - reshoot: `[inSec, outSec]` 新生成片段（按 `fitMode` 变速或裁切对齐到 `outSec - inSec`）
 * - tail: `(outSec, sourceDurationSec]` 原片直通（当尾部剩余 `>= 0.04` 时存在）
 */
export function buildFramePullSpliceSegments(input: {
  sourceDurationSec: number
  inSec: number
  outSec: number
  generatedClipRelativePath: string
  fitMode?: FramePullFitMode
}): SemanticRebuildSegment[] {
  const totalSec = Math.max(0, Number(input.sourceDurationSec) || 0)
  const inSec = Math.max(0, Number(input.inSec) || 0)
  const outSec = Math.max(
    inSec + 0.04,
    totalSec > 0 ? Math.min(totalSec, Number(input.outSec) || 0) : Number(input.outSec) || 0
  )
  const segDur = Number(Math.max(0.04, outSec - inSec).toFixed(3))
  const clipPath = input.generatedClipRelativePath.trim()
  const fitMode = input.fitMode ?? 'stretch'

  const segments: SemanticRebuildSegment[] = []

  if (inSec >= 0.04) {
    segments.push({
      key: 'head',
      kind: 'source',
      durationSec: Number(inSec.toFixed(3)),
      sourceStartSec: 0,
      sourceEndSec: Number(inSec.toFixed(3))
    })
  }

  segments.push({
    key: 'reshoot',
    kind: 'generate',
    durationSec: segDur,
    relativePath: clipPath,
    sourceStartSec: Number(inSec.toFixed(3)),
    sourceEndSec: Number(outSec.toFixed(3)),
    fitMode
  })

  if (totalSec - outSec >= 0.04) {
    segments.push({
      key: 'tail',
      kind: 'source',
      durationSec: Number((totalSec - outSec).toFixed(3)),
      sourceStartSec: Number(outSec.toFixed(3)),
      sourceEndSec: Number(totalSec.toFixed(3))
    })
  }

  return segments
}
