/**
 * 成片时间线「智能粗剪」纯函数地基。
 *
 * 剪辑直觉：口播 / 配音类素材的语音之间常夹着大段静默——换气、停顿、口误后的沉默、
 * 录制尾部忘关麦的空转。粗剪要做的就是把静默挤掉，让成片节奏紧起来。而这一步的判定
 * 完全能由「转写时间戳」给出来，不必人肉拖拽。
 *
 * 拆成两步，各自可测、可单独复用：
 * 1) buildKeepRangesFromSpeech：配音轨片段 + 转写分段 → 轨道时间上的「保留区间」；
 * 2) planDeleteRanges + planRippleCut：保留区间 → 删除区间 → 全线前移（ripple）后的新片段。
 *
 * 边界刻意保守（宁可少剪，不可误剪）：
 * - 只动配音轨覆盖到的时间段；配音轨之外（空镜、纯音乐段）一律不碰；
 * - 配音片段内一句语音都识别不到时整段保留（可能本就是纯音乐 / 环境音，也可能是转写失败），
 *   只回一条 warning 让调用方决定；
 * - 阈值全部可配，默认值偏保守。
 *
 * 本模块只产出**结构化的计划**，不改动入参、不写盘；文案由调用方拼装。
 */

import type { ScriptTimelineClip } from './scriptTimeline'

/** 时间线区间（秒，半开区间 [startSec, endSec)） */
export interface TimelineTimeRange {
  startSec: number
  endSec: number
}

export interface TimelineRoughCutOptions {
  /** 每句语音前后各留的呼吸边距（秒） */
  paddingSec?: number
  /** 净静默达到该时长才剪掉（秒）；小于它的间隙会被并进语音段 */
  minSilenceSec?: number
}

export const TIMELINE_ROUGH_CUT_DEFAULTS = {
  paddingSec: 0.2,
  minSilenceSec: 0.8
} as const

/** 粗剪结构性问题码（面向 Agent；中文说明在主进程工具层拼） */
export type TimelineRoughCutWarningCode =
  /** 时间线上没有配音轨片段，无从判断语音位置 */
  | 'no-voice-clips'
  /** 该配音片段内没有落在它取段范围内的转写分段 */
  | 'clip-without-speech'
  /** 全部配音片段都没匹配到语音（转写为空 / 时间戳对不上） */
  | 'no-speech-detected'
  /** 按当前阈值没有任何可剪的静默 */
  | 'nothing-to-cut'

export interface TimelineRoughCutWarning {
  code: TimelineRoughCutWarningCode
  clipId?: string
}

export interface TimelineSpeechPlan {
  /** 保留区间（轨道时间，升序、已合并重叠） */
  keepRanges: TimelineTimeRange[]
  /** 配音轨覆盖区间（删除区间只可能落在这里面） */
  voiceRanges: TimelineTimeRange[]
  /** 语音净时长（不含边距） */
  speechSec: number
  warnings: TimelineRoughCutWarning[]
}

export interface TimelineRippleCutResult {
  clips: ScriptTimelineClip[]
  cuts: TimelineTimeRange[]
  /** 原内容结束时间（秒） */
  beforeSec: number
  /** 新内容结束时间（秒） */
  afterSec: number
  /** 实际剪掉的总时长（秒） */
  removedSec: number
  /** 被切成多段的片段数 */
  splitCount: number
  /** 被整段删掉的片段数 */
  droppedCount: number
}

export interface TimelineRoughCutPlan extends TimelineRippleCutResult {
  keepRanges: TimelineTimeRange[]
  voiceRanges: TimelineTimeRange[]
  speechSec: number
  warnings: TimelineRoughCutWarning[]
}

/** 极小的可忽略时长（秒）：低于它的残段不生成片段、不算切口 */
const EPSILON_SEC = 0.01

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : fallback
}

function readOption(
  options: TimelineRoughCutOptions | undefined,
  key: keyof TimelineRoughCutOptions
): number {
  return Math.max(0, finiteOr(options?.[key], TIMELINE_ROUGH_CUT_DEFAULTS[key]))
}

/** 校验并规范化一个区间；非法 / 空区间返回 null */
function normalizeRange(range: TimelineTimeRange): TimelineTimeRange | null {
  const startSec = finiteOr(range?.startSec, NaN)
  const endSec = finiteOr(range?.endSec, NaN)
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return null
  const from = Math.max(0, Math.min(startSec, endSec))
  const to = Math.max(startSec, endSec)
  if (to - from <= EPSILON_SEC) return null
  // 统一到 4 位小数：阈值比较与返回值都不受浮点噪声影响
  return { startSec: round4(from), endSec: round4(to) }
}

function normalizeRanges(ranges: TimelineTimeRange[]): TimelineTimeRange[] {
  const out: TimelineTimeRange[] = []
  for (const range of ranges ?? []) {
    const next = normalizeRange(range)
    if (next) out.push(next)
  }
  return out.sort((a, b) => a.startSec - b.startSec || a.endSec - b.endSec)
}

/** 合并重叠 / 相邻（间距 ≤ EPSILON）的区间，输入需已按 startSec 升序 */
function mergeRanges(ranges: TimelineTimeRange[]): TimelineTimeRange[] {
  const out: TimelineTimeRange[] = []
  for (const range of ranges) {
    const last = out[out.length - 1]
    if (last && range.startSec <= last.endSec + EPSILON_SEC) {
      last.endSec = Math.max(last.endSec, range.endSec)
      continue
    }
    out.push({ ...range })
  }
  return out
}

/**
 * 配音轨片段 + 转写分段 → 轨道时间上的保留区间。
 *
 * 转写分段的坐标是**源文件时间**，经片段的 `sourceOffsetSec` 平移到轨道时间：
 * 片段取段窗口之外的语音一律忽略（多段配音共用同一份转写时不会串味）。
 */
export function buildKeepRangesFromSpeech(
  voiceClips: Array<Pick<ScriptTimelineClip, 'id' | 'startSec' | 'durationSec' | 'sourceOffsetSec'>>,
  segments: TimelineTimeRange[],
  options?: TimelineRoughCutOptions
): TimelineSpeechPlan {
  const paddingSec = readOption(options, 'paddingSec')
  const warnings: TimelineRoughCutWarning[] = []
  const clips = (voiceClips ?? [])
    .filter(
      (clip) =>
        !!clip &&
        Number.isFinite(clip.startSec) &&
        Number.isFinite(clip.durationSec) &&
        clip.durationSec > 0
    )
    .map((clip) => ({
      id: String(clip.id),
      startSec: Math.max(0, clip.startSec),
      durationSec: clip.durationSec,
      sourceOffsetSec: Math.max(0, finiteOr(clip.sourceOffsetSec, 0))
    }))
    .sort((a, b) => a.startSec - b.startSec)
  if (!clips.length) {
    return {
      keepRanges: [],
      voiceRanges: [],
      speechSec: 0,
      warnings: [{ code: 'no-voice-clips' }]
    }
  }

  const speech = normalizeRanges(segments ?? [])
  const keep: TimelineTimeRange[] = []
  let speechSec = 0
  let matched = 0

  for (const clip of clips) {
    const clipStart = clip.startSec
    const clipEnd = clip.startSec + clip.durationSec
    const local: TimelineTimeRange[] = []
    for (const seg of speech) {
      // 源文件时间 → 片段内相对时间 → 轨道绝对时间
      const relStart = seg.startSec - clip.sourceOffsetSec
      const relEnd = seg.endSec - clip.sourceOffsetSec
      if (relEnd <= 0 || relStart >= clip.durationSec) continue
      const absStart = clipStart + Math.max(0, relStart)
      const absEnd = clipStart + Math.min(clip.durationSec, relEnd)
      const padded = normalizeRange({
        startSec: Math.max(clipStart, absStart - paddingSec),
        endSec: Math.min(clipEnd, absEnd + paddingSec)
      })
      if (!padded) continue
      local.push(padded)
      speechSec += absEnd - absStart
      matched += 1
    }
    if (!local.length) {
      // 该片段内没匹配到语音：可能本就是纯音乐 / 环境音，也可能是转写对不上——
      // 整段保留（宁可漏剪，绝不把一整条配音抹掉）
      warnings.push({ code: 'clip-without-speech', clipId: clip.id })
      keep.push({ startSec: clipStart, endSec: clipEnd })
      continue
    }
    keep.push(...local)
  }

  if (!matched) warnings.push({ code: 'no-speech-detected' })

  return {
    keepRanges: mergeRanges(keep),
    voiceRanges: mergeRanges(
      clips.map((clip) => ({ startSec: clip.startSec, endSec: clip.startSec + clip.durationSec }))
    ),
    speechSec: round4(speechSec),
    warnings
  }
}

/** 区间差集：from 去掉 remove 覆盖的部分，结果升序、互不重叠 */
export function subtractRanges(
  from: TimelineTimeRange[],
  remove: TimelineTimeRange[]
): TimelineTimeRange[] {
  const sources = normalizeRanges(from)
  const drops = normalizeRanges(remove)
  if (!sources.length) return []
  if (!drops.length) return mergeRanges(sources)

  const out: TimelineTimeRange[] = []
  for (const source of sources) {
    let cursor = source.startSec
    for (const drop of drops) {
      if (drop.endSec <= cursor) continue
      if (drop.startSec >= source.endSec) break
      if (drop.startSec > cursor) {
        out.push({ startSec: cursor, endSec: Math.min(drop.startSec, source.endSec) })
      }
      cursor = Math.max(cursor, drop.endSec)
      if (cursor >= source.endSec) break
    }
    if (cursor < source.endSec) {
      out.push({ startSec: cursor, endSec: source.endSec })
    }
  }
  return out.filter((range) => range.endSec - range.startSec > EPSILON_SEC)
}

/**
 * 配音覆盖区 − 保留区间 = 待剪静默；短于 `minSilenceSec` 的间隙不剪（避免切碎）。
 */
export function planDeleteRanges(
  voiceRanges: TimelineTimeRange[],
  keepRanges: TimelineTimeRange[],
  minSilenceSec?: number
): TimelineTimeRange[] {
  const threshold = Math.max(
    EPSILON_SEC,
    finiteOr(minSilenceSec, TIMELINE_ROUGH_CUT_DEFAULTS.minSilenceSec)
  )
  const gaps = subtractRanges(voiceRanges, keepRanges)
  return gaps.filter((gap) => gap.endSec - gap.startSec >= threshold)
}

/** 时刻 `timeSec` 之前被剪掉的总时长（ripple 前移量） */
function removedBefore(cuts: TimelineTimeRange[], timeSec: number): number {
  let removed = 0
  for (const cut of cuts) {
    if (cut.endSec <= timeSec) {
      removed += cut.endSec - cut.startSec
      continue
    }
    if (cut.startSec < timeSec) {
      removed += timeSec - cut.startSec
    }
    break
  }
  return removed
}

/** 拆分片段 id：首段沿用原 id（下游引用不断），后续段加 `~n` 后缀（确定性、可测） */
export function splitClipId(baseId: string, index: number): string {
  return index === 0 ? baseId : `${baseId}~${index + 1}`
}

/**
 * 删除区间 → 全线前移（ripple）后的新片段数组。
 *
 * - 与删除区间相交的片段被**切分**：保留子段各自带正确的 `sourceOffsetSec`
 *   （取段起点随子段在源文件里的位置平移），所以画面 / 声音取的是同一段内容；
 * - 转场与淡入淡出只保留在片段真正的首 / 尾：切分产生的中间子段清空这些字段，
 *   否则会在剪辑点冒出莫名其妙的转场；
 * - 片段顺序保持原样，便于调用方做 diff 与 undo 快照。
 */
export function planRippleCut(
  clips: ScriptTimelineClip[],
  deleteRanges: TimelineTimeRange[],
  makeClipId: (baseId: string, index: number) => string = splitClipId
): TimelineRippleCutResult {
  const cuts = mergeRanges(normalizeRanges(deleteRanges))
  const beforeSec = round4(contentEnd(clips))
  if (!cuts.length) {
    return {
      clips: [...(clips ?? [])],
      cuts: [],
      beforeSec,
      afterSec: beforeSec,
      removedSec: 0,
      splitCount: 0,
      droppedCount: 0
    }
  }

  const out: ScriptTimelineClip[] = []
  let splitCount = 0
  let droppedCount = 0

  for (const clip of clips ?? []) {
    if (!clip || !Number.isFinite(clip.startSec) || !Number.isFinite(clip.durationSec)) continue
    const clipStart = clip.startSec
    const clipEnd = clip.startSec + clip.durationSec
    const keepParts =
      clip.durationSec <= 0
        ? []
        : subtractRanges([{ startSec: clipStart, endSec: clipEnd }], cuts)

    if (!keepParts.length) {
      droppedCount += 1
      continue
    }
    if (keepParts.length > 1) splitCount += 1

    keepParts.forEach((part, index) => {
      const isFirst = index === 0
      const isLast = index === keepParts.length - 1
      // 取段起点随子段平移：画面 / 声音取到的仍是源文件里对应的那段
      const sourceOffset = finiteOr(clip.sourceOffsetSec, 0) + (part.startSec - clipStart)
      const next: ScriptTimelineClip = {
        ...clip,
        id: keepParts.length === 1 ? clip.id : makeClipId(clip.id, index),
        startSec: round4(Math.max(0, part.startSec - removedBefore(cuts, part.startSec))),
        durationSec: round4(part.endSec - part.startSec)
      }
      if (clip.sourceOffsetSec != null || sourceOffset > 0) {
        next.sourceOffsetSec = round4(sourceOffset)
      }
      // 转场 / 淡入淡出只留在片段真正的首尾
      if (!isFirst) {
        delete next.transitionInSec
        delete next.fadeInSec
      }
      if (!isLast) {
        delete next.transitionOutSec
        delete next.fadeOutSec
      }
      out.push(next)
    })
  }

  const afterSec = round4(contentEnd(out))
  return {
    clips: out,
    cuts,
    beforeSec,
    afterSec,
    removedSec: round4(beforeSec - afterSec),
    splitCount,
    droppedCount
  }
}

/** 内容结束时间（秒）：所有片段起止的最大值 */
export function contentEnd(clips: ScriptTimelineClip[]): number {
  let max = 0
  for (const clip of clips ?? []) {
    if (!clip || !Number.isFinite(clip.startSec) || !Number.isFinite(clip.durationSec)) continue
    max = Math.max(max, clip.startSec + clip.durationSec)
  }
  return max
}

/**
 * 一步到位：转写分段 + 全量片段 → 粗剪计划（dry-run 与落盘共用同一份结果）。
 * 只读配音轨（`track === 'voice'`）作为语音位置依据；其余轨按同一映射整体前移。
 */
export function planTimelineRoughCut(input: {
  clips: ScriptTimelineClip[]
  segments: TimelineTimeRange[]
  options?: TimelineRoughCutOptions
}): TimelineRoughCutPlan {
  const voiceClips = (input.clips ?? []).filter((clip) => clip?.track === 'voice')
  const speech = buildKeepRangesFromSpeech(voiceClips, input.segments ?? [], input.options)
  const cutRanges = planDeleteRanges(
    speech.voiceRanges,
    speech.keepRanges,
    input.options?.minSilenceSec
  )
  const ripple = planRippleCut(input.clips ?? [], cutRanges)
  const warnings = [...speech.warnings]
  if (!cutRanges.length && !warnings.some((item) => item.code === 'no-speech-detected')) {
    warnings.push({ code: 'nothing-to-cut' })
  }
  return {
    ...ripple,
    keepRanges: speech.keepRanges,
    voiceRanges: speech.voiceRanges,
    speechSec: speech.speechSec,
    warnings
  }
}
