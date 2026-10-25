/**
 * 词级时间戳强制对齐（Word-Anchored Semantic Timing）、内联语义锚点（`@{tag}text@{/tag}`）、
 * 爆款卡拉 OK 逐词胶囊字幕与 YOLO 人脸跟随字幕轨迹计算器。
 *
 * 设计目标（对标并超越 hypit-ai/hypit 的 `@hypit/whisperx` + `@hypit/narrative-temporal` + `@hypit/caption-fine`）：
 * 1. 台词内联锚点：支持在台词/字幕中直接书写 `@{trophy}奖杯@{/trophy}` 或 `@[trophy:奖杯]`，以及 `||` 短句切分符；
 * 2. 100% 词级时间覆盖：
 *    - 当 ASR（Whisper verbose_json）返回真实词级时间戳 `words[]` 时，自动与清洗后的台词做词级对齐；
 *    - 当 ASR 仅返回句级时间或用户手动修改了台词时，按中日韩字/英文音节与标点停顿权重自动插值生成毫秒级 `TimelineWordTiming[]`；
 * 3. 语义时间窗投影（Semantic Projection）：将 `@{tag}...@{/tag}` 自动投影为时间线上的精确时间窗 `[startSec, endSec]`，
 *    任何绑定了 `anchorCueTag: "tag"` 的 B-Roll 画中画、贴纸、动态组件（TierBoard 等）或音效（SFX）都会自动吸附到念出该词的毫秒时刻；
 * 4. YOLO 人脸追踪字幕：将多帧人物/人脸检测框序列平滑转换为字幕的 `keyframes` 跟随轨迹，并编译为 Web 预览与 FFmpeg `drawtext` 动态坐标表达式。
 */

import type { TimelineClipKeyframe, TimelineEaseType } from './timelineTween'
import { evaluateTimelineEase } from './timelineTween'
import type { TimelineWidgetConfig } from './timelineWidgets'
import {
  inferProceduralSfxIdForTag,
  TIMELINE_PROCEDURAL_SFX_PRESETS,
  type TimelineProceduralSfxId
} from './timelineProceduralSfx'

export * from './timelineProceduralSfx'

export type TimelineSubtitleKaraokeMode =
  'none' | 'karaoke-pill' | 'karaoke-pop' | 'karaoke-glow' | 'word-solo'

export const TIMELINE_SUBTITLE_KARAOKE_MODES: readonly TimelineSubtitleKaraokeMode[] = [
  'none',
  'karaoke-pill',
  'karaoke-pop',
  'karaoke-glow',
  'word-solo'
] as const

export type SubtitleKaraokeMode = TimelineSubtitleKaraokeMode
export const SUBTITLE_KARAOKE_MODES = TIMELINE_SUBTITLE_KARAOKE_MODES

export function isTimelineSubtitleKaraokeMode(v: unknown): v is TimelineSubtitleKaraokeMode {
  return typeof v === 'string' && (TIMELINE_SUBTITLE_KARAOKE_MODES as readonly string[]).includes(v)
}

/**
 * 单个词/字在所属字幕片段内的相对时间戳（`0 <= startSec <= endSec <= clip.durationSec`）。
 * 采用片段内相对时间，保证在时间线上拖动字幕片段时词级时间与锚点自动跟随平移。
 */
export interface TimelineWordTiming {
  text: string
  /** 相对于所属字幕片段起点的起始秒数（>= 0） */
  startSec: number
  /** 相对于所属字幕片段起点的结束秒数（>= startSec） */
  endSec: number
  confidence?: number
  /** 覆盖该词的内联语义锚点标签列表（如 `['hair-gel', 'trophy']`） */
  cueTags?: string[]
}

/** 投影到成片时间线绝对坐标上的语义锚点时间窗 */
export interface TimelineSemanticCueWindow {
  tag: string
  text: string
  /** 成片时间线上的绝对起始秒数 */
  startSec: number
  /** 成片时间线上的绝对结束秒数 */
  endSec: number
  /** 在所属字幕片段内的相对起始秒数 */
  clipOffsetStartSec: number
  /** 在所属字幕片段内的相对结束秒数 */
  clipOffsetEndSec: number
  /** 来源字幕片段 ID */
  clipId?: string
}

export interface ParsedInlineCueSpan {
  tag: string
  text: string
  /** 在 cleanText 中的起始字符索引（含） */
  cleanStartIndex: number
  /** 在 cleanText 中的结束字符索引（不含） */
  cleanEndIndex: number
}

export interface ParsedInlineCueResult {
  rawText: string
  /** 剥离所有 `@{tag}`、`@{/tag}`、`@[tag:...]` 与 `||` 后的纯展示字幕文本 */
  cleanText: string
  /** 解析出的所有内联锚点区间 */
  cues: ParsedInlineCueSpan[]
  /** 按 `||` 切分出的短句块（保留各自内部的 `@{tag}` 标记，便于拆分成多条短字幕） */
  phraseChunks: string[]
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * 判断文本是否包含内联语义标记（`@{tag}`、`@[tag:text]` 或 `||`）
 */
export function hasInlineCueMarkup(text: string | undefined | null): boolean {
  if (!text) return false
  return /@\{[a-zA-Z0-9_.-]+\}|@\[[a-zA-Z0-9_.-]+:[^\]]+\]|\|\|/.test(text)
}

/**
 * 解析台词中的内联语义锚点（支持嵌套 `@{tag}...@{/tag}`、简写 `@[tag:text]` 以及 `||` 短句分割）。
 *
 * 示例：
 *   `Bro has @{hair-gel}more || hair gel than @{trophy}trophies@{/trophy}@{/hair-gel} now.`
 *   -> cleanText: `"Bro has more hair gel than trophies now."`
 *   -> cues: `[{ tag: 'trophy', text: 'trophies', ... }, { tag: 'hair-gel', text: 'more hair gel than trophies', ... }]`
 */
export function parseInlineCueText(rawInput: string | undefined | null): ParsedInlineCueResult {
  const rawText = String(rawInput ?? '')
  if (!rawText.trim()) {
    return { rawText, cleanText: '', cues: [], phraseChunks: [] }
  }

  // 1. 先把简写 `@[tag:content]` 归一化展开为 `@{tag}content@{/tag}`
  const normalized = rawText.replace(
    /@\[([a-zA-Z0-9_.-]+):([^\]]+)\]/g,
    (_m, tag: string, content: string) => `@{${tag}}${content}{/${tag}}`.replace('{/', '@{/')
  )

  // 2. 按 `||` 切分短句，同时为跨 `||` 的未闭合 `@{tag}` 自动补齐闭合与重开标签
  const rawParts = normalized.split(/\s*\|\|\s*/)
  const phraseChunks: string[] = []
  if (rawParts.length > 1) {
    const activeStack: string[] = []
    for (const part of rawParts) {
      const trimmed = part.trim()
      if (!trimmed) continue
      const prefix = activeStack.map((t) => `@{${t}}`).join('')
      // 扫描本段内的开闭标签，更新 activeStack
      const tagRegex = /@\{(\/?)([a-zA-Z0-9_.-]+)\}/g
      let m: RegExpExecArray | null
      while ((m = tagRegex.exec(trimmed)) !== null) {
        const isClose = m[1] === '/'
        const tag = m[2]!
        if (!isClose) {
          activeStack.push(tag)
        } else {
          const idx = activeStack.lastIndexOf(tag)
          if (idx >= 0) activeStack.splice(idx, 1)
        }
      }
      const suffix = [...activeStack]
        .reverse()
        .map((t) => `@{/${t}}`)
        .join('')
      phraseChunks.push(`${prefix}${trimmed}${suffix}`)
    }
  } else {
    phraseChunks.push(normalized.trim())
  }

  // 3. 线性扫描提取 cleanText 与每个 @{tag}...@{/tag} 的精确字符区间
  const tokenRegex = /@\{(\/?)([a-zA-Z0-9_.-]+)\}|\s*\|\|\s*/g
  let cleanText = ''
  const openMap = new Map<string, number[]>()
  const cues: ParsedInlineCueSpan[] = []

  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tokenRegex.exec(normalized)) !== null) {
    const chunk = normalized.slice(lastIndex, match.index)
    if (chunk) {
      cleanText += chunk
    }
    const full = match[0]!
    if (full.includes('||')) {
      // `||` 两侧如果拼接后缺少空格且两侧是英文单词，补一个空格
      if (
        cleanText.length > 0 &&
        !/\s$/.test(cleanText) &&
        /[a-zA-Z0-9]$/.test(cleanText) &&
        /^[a-zA-Z0-9@]/.test(normalized.slice(tokenRegex.lastIndex))
      ) {
        cleanText += ' '
      }
    } else {
      const isClose = match[1] === '/'
      const tag = match[2]!
      if (!isClose) {
        const stack = openMap.get(tag) ?? []
        stack.push(cleanText.length)
        openMap.set(tag, stack)
      } else {
        const stack = openMap.get(tag)
        const startIdx = stack?.pop()
        if (startIdx != null) {
          const spanText = cleanText.slice(startIdx, cleanText.length).trim()
          if (spanText) {
            cues.push({
              tag,
              text: spanText,
              cleanStartIndex: startIdx,
              cleanEndIndex: cleanText.length
            })
          }
        }
      }
    }
    lastIndex = tokenRegex.lastIndex
  }
  if (lastIndex < normalized.length) {
    cleanText += normalized.slice(lastIndex)
  }

  // 未显式写 `@{/tag}` 的单点标签（如 `@{boom}爆炸`）：自动延伸到下一个词或句尾
  for (const [tag, stack] of openMap.entries()) {
    for (const startIdx of stack) {
      const tail = cleanText.slice(startIdx)
      const wordMatch = /^\s*(\S+)/.exec(tail)
      const endIdx = wordMatch ? startIdx + wordMatch[0]!.length : cleanText.length
      const spanText = cleanText.slice(startIdx, endIdx).trim()
      if (spanText) {
        cues.push({
          tag,
          text: spanText,
          cleanStartIndex: startIdx,
          cleanEndIndex: endIdx
        })
      }
    }
  }

  cues.sort((a, b) => a.cleanStartIndex - b.cleanStartIndex || a.cleanEndIndex - b.cleanEndIndex)

  return {
    rawText,
    cleanText: cleanText.trim(),
    cues,
    phraseChunks
  }
}

interface RawWordToken {
  text: string
  startIndex: number
  endIndex: number
  weight: number
}

const CJK_CHAR_RE = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/
const TRAILING_PUNCT_RE = /^[，。！？；：、,.!?;:'")\]}》】”’]+/
const PAUSE_PUNCT_RE = /[，。！？；：,.!?;:]/

/**
 * 将清洗后的台词切分为自然的发音词元（CJK 单字/双字词元 + 英文整词 + 附着标点），
 * 并记录每个词元在 `cleanText` 中的字符起止位置与发音时长权重。
 */
export function tokenizeSubtitleWords(cleanText: string): RawWordToken[] {
  const tokens: RawWordToken[] = []
  const n = cleanText.length
  let i = 0
  while (i < n) {
    while (i < n && /\s/.test(cleanText[i]!)) i++
    if (i >= n) break

    const start = i
    const ch = cleanText[i]!
    if (CJK_CHAR_RE.test(ch)) {
      i++
      // 紧随其后的标点并入当前字，避免标点单独成为一个跳动胶囊
      const punctMatch = TRAILING_PUNCT_RE.exec(cleanText.slice(i))
      if (punctMatch) {
        i += punctMatch[0]!.length
      }
      const text = cleanText.slice(start, i)
      const hasPause = PAUSE_PUNCT_RE.test(text)
      tokens.push({
        text,
        startIndex: start,
        endIndex: i,
        weight: 1.0 + (hasPause ? 0.35 : 0)
      })
    } else {
      // 英文单词 / 数字 / 符号串
      while (i < n && !/\s/.test(cleanText[i]!) && !CJK_CHAR_RE.test(cleanText[i]!)) {
        i++
      }
      const text = cleanText.slice(start, i)
      const alphaLen = text.replace(/[^a-zA-Z0-9]/g, '').length
      const hasPause = PAUSE_PUNCT_RE.test(text)
      const baseWeight = Math.max(0.75, Math.min(2.6, Math.max(1, alphaLen) * 0.24))
      tokens.push({
        text,
        startIndex: start,
        endIndex: i,
        weight: baseWeight + (hasPause ? 0.35 : 0)
      })
    }
  }
  return tokens
}

/**
 * 将台词（可含 `@{tag}`）与时长/已有词级时间戳对齐，产出：
 * - `cleanText`: 纯净字幕文本
 * - `words`: 片段内相对时间戳的词级序列（带 `cueTags`）
 * - `cues`: 片段内相对时间戳的语义锚点窗口
 */
export function alignSubtitleWordsAndCues(input: {
  text: string
  durationSec: number
  /** 外部（如 Whisper ASR）提供的词级时间；既可为片段内相对秒数，也可为已减掉 offset 的秒数 */
  existingWords?: ReadonlyArray<{
    text: string
    startSec: number
    endSec: number
    confidence?: number
  }>
}): {
  cleanText: string
  words: TimelineWordTiming[]
  cues: Array<{ tag: string; text: string; startSec: number; endSec: number }>
} {
  const duration = Math.max(0.05, Number(input.durationSec) || 0.05)
  const parsed = parseInlineCueText(input.text)
  const cleanText = parsed.cleanText
  const tokens = tokenizeSubtitleWords(cleanText)
  if (tokens.length === 0) {
    return { cleanText, words: [], cues: [] }
  }

  const totalWeight = tokens.reduce((acc, t) => acc + t.weight, 0) || 1
  const existing = (input.existingWords ?? []).filter(
    (w) => w && typeof w.text === 'string' && w.text.trim().length > 0
  )

  // 判断外部 existingWords 是否与当前 cleanText 词元数量/内容匹配
  const canUseExistingDirectly =
    existing.length === tokens.length &&
    existing.every((w) => Number.isFinite(w.startSec) && Number.isFinite(w.endSec))

  let words: TimelineWordTiming[] = []
  if (canUseExistingDirectly) {
    // 归一化外部词时间到 [0, duration]
    const firstStart = existing[0]!.startSec
    const lastEnd = existing[existing.length - 1]!.endSec
    const shift = firstStart > duration + 0.05 || lastEnd > duration + 0.2 ? firstStart : 0
    words = tokens.map((tok, idx) => {
      const ext = existing[idx]!
      const s = clamp(round3(ext.startSec - shift), 0, duration)
      const e = clamp(round3(Math.max(s + 0.02, ext.endSec - shift)), s, duration)
      const activeTags = parsed.cues
        .filter((c) => tok.startIndex < c.cleanEndIndex && tok.endIndex > c.cleanStartIndex)
        .map((c) => c.tag)
      return {
        text: tok.text,
        startSec: s,
        endSec: e,
        ...(typeof ext.confidence === 'number' ? { confidence: ext.confidence } : {}),
        ...(activeTags.length ? { cueTags: activeTags } : {})
      }
    })
  } else {
    // 按音节与标点停顿权重精确插值（若提供了部分 existingWords 则以其首尾边界作为语音活跃区间）
    let speechStart = 0
    let speechEnd = duration
    if (existing.length > 0) {
      const minS = Math.min(...existing.map((w) => w.startSec))
      const maxE = Math.max(...existing.map((w) => w.endSec))
      if (minS >= 0 && maxE <= duration + 0.1 && maxE > minS + 0.05) {
        speechStart = clamp(minS, 0, duration * 0.3)
        speechEnd = clamp(maxE, speechStart + 0.05, duration)
      }
    }
    const activeSpan = Math.max(0.05, speechEnd - speechStart)
    let cursor = speechStart
    words = tokens.map((tok, idx) => {
      const slice = (tok.weight / totalWeight) * activeSpan
      const s = round3(cursor)
      const e =
        idx === tokens.length - 1 ? round3(speechEnd) : round3(Math.min(speechEnd, cursor + slice))
      cursor += slice
      const activeTags = parsed.cues
        .filter((c) => tok.startIndex < c.cleanEndIndex && tok.endIndex > c.cleanStartIndex)
        .map((c) => c.tag)
      return {
        text: tok.text,
        startSec: s,
        endSec: Math.max(s + 0.01, e),
        ...(activeTags.length ? { cueTags: activeTags } : {})
      }
    })
  }

  // 将每个 @{tag} 投影为精确的词级时间窗
  const cues: Array<{ tag: string; text: string; startSec: number; endSec: number }> = []
  for (const cue of parsed.cues) {
    const matchedWords = words.filter((_, idx) => {
      const tok = tokens[idx]!
      return tok.startIndex < cue.cleanEndIndex && tok.endIndex > cue.cleanStartIndex
    })
    if (matchedWords.length > 0) {
      cues.push({
        tag: cue.tag,
        text: cue.text,
        startSec: matchedWords[0]!.startSec,
        endSec: matchedWords[matchedWords.length - 1]!.endSec
      })
    }
  }

  return { cleanText, words, cues }
}

/**
 * 获取字幕片段的词级时间序列（若片段尚未缓存 `words` 或文本已变更，实时对齐计算）。
 */
export function getSubtitleClipWordTimings(clip: {
  text?: string
  title?: string
  rawCueText?: string
  durationSec: number
  words?: TimelineWordTiming[]
}): TimelineWordTiming[] {
  const raw = (clip.rawCueText || clip.text || clip.title || '').trim()
  if (!raw) return []
  const aligned = alignSubtitleWordsAndCues({
    text: raw,
    durationSec: clip.durationSec,
    existingWords: clip.words
  })
  return aligned.words
}

/**
 * 从时间线的所有字幕片段中提取绝对坐标下的 `@tag` 语义锚点时间窗列表。
 */
export function extractTimelineCueWindows(
  clips: ReadonlyArray<{
    id: string
    track: string
    startSec: number
    durationSec: number
    text?: string
    title?: string
    rawCueText?: string
    words?: TimelineWordTiming[]
  }>
): TimelineSemanticCueWindow[] {
  const windows: TimelineSemanticCueWindow[] = []
  for (const clip of clips) {
    if (clip.track !== 'subtitle') continue
    const raw = (clip.rawCueText || clip.text || clip.title || '').trim()
    if (!raw) continue
    const aligned = alignSubtitleWordsAndCues({
      text: raw,
      durationSec: clip.durationSec,
      existingWords: clip.words
    })
    for (const c of aligned.cues) {
      windows.push({
        tag: c.tag,
        text: c.text,
        startSec: round3(clip.startSec + c.startSec),
        endSec: round3(clip.startSec + c.endSec),
        clipOffsetStartSec: c.startSec,
        clipOffsetEndSec: c.endSec,
        clipId: clip.id
      })
    }
  }
  return windows.sort((a, b) => a.startSec - b.startSec)
}

export interface CueSyncableClip {
  id: string
  track: string
  startSec: number
  durationSec: number
  title?: string
  text?: string
  rawCueText?: string
  words?: TimelineWordTiming[]
  anchorCueTag?: string
  anchorOffsetSec?: number
  anchorMatchDuration?: boolean
  widgetConfig?: TimelineWidgetConfig
}

export interface SyncTimelineCueAnchorsResult<T extends CueSyncableClip> {
  clips: T[]
  cueWindows: TimelineSemanticCueWindow[]
  syncedClipCount: number
  syncedWidgetItemCount: number
}

/**
 * 扫描时间线字幕中的 `@{tag}` 内联语义锚点：
 * 1. 自动剥离字幕展示文本中的 `@{tag}` 标记（保留在 `rawCueText` 中），并刷新词级时间 `words`；
 * 2. 将所有设置了 `anchorCueTag` 的画中画（B-Roll / 贴纸 / 动态组件）或音效（SFX）片段自动吸附到对应词的发声时刻；
 * 3. 将动态组件 `widgetConfig.items` 中设置了 `cueTag` 的子项 `triggerSec` 自动同步为对应词相对于组件起点的偏移秒数。
 */
export function syncTimelineCueAnchors<T extends CueSyncableClip>(
  inputClips: ReadonlyArray<T>
): SyncTimelineCueAnchorsResult<T> {
  const normalizedClips: T[] = inputClips.map((clip) => {
    if (clip.track !== 'subtitle') return { ...clip }
    const rawSource = (clip.rawCueText || clip.text || clip.title || '').trim()
    if (!rawSource) return { ...clip }
    const hasMarkup = hasInlineCueMarkup(rawSource)
    const aligned = alignSubtitleWordsAndCues({
      text: rawSource,
      durationSec: clip.durationSec,
      existingWords: clip.words
    })
    return {
      ...clip,
      ...(hasMarkup ? { rawCueText: rawSource } : {}),
      text: aligned.cleanText || clip.text,
      title: (aligned.cleanText || clip.title || '').slice(0, 48),
      words: aligned.words
    }
  })

  const cueWindows = extractTimelineCueWindows(normalizedClips)
  const cuesByTag = new Map<string, TimelineSemanticCueWindow[]>()
  for (const win of cueWindows) {
    const list = cuesByTag.get(win.tag) ?? []
    list.push(win)
    cuesByTag.set(win.tag, list)
  }
  const findNearestCue = (
    tag: string,
    targetSec: number
  ): TimelineSemanticCueWindow | undefined => {
    const list = cuesByTag.get(tag)
    if (!list || list.length === 0) return undefined
    let best = list[0]!
    let bestDist = Math.abs(best.startSec - targetSec)
    for (let i = 1; i < list.length; i++) {
      const candidate = list[i]!
      const dist = Math.abs(candidate.startSec - targetSec)
      if (dist < bestDist) {
        best = candidate
        bestDist = dist
      }
    }
    return best
  }

  let syncedClipCount = 0
  let syncedWidgetItemCount = 0

  const finalClips = normalizedClips.map((clip) => {
    let next = clip
    const tag = clip.anchorCueTag?.trim()
    if (tag && clip.track !== 'subtitle') {
      const offset = Number.isFinite(clip.anchorOffsetSec) ? Number(clip.anchorOffsetSec) : 0
      const cue = findNearestCue(tag, clip.startSec - offset)
      if (cue) {
        const targetStart = Math.max(0, round3(cue.startSec + offset))
        const targetDur =
          clip.anchorMatchDuration === true
            ? Math.max(0.3, round3(cue.endSec - cue.startSec))
            : clip.durationSec
        if (
          Math.abs(targetStart - clip.startSec) > 0.001 ||
          Math.abs(targetDur - clip.durationSec) > 0.001
        ) {
          syncedClipCount++
        }
        next = {
          ...next,
          startSec: targetStart,
          durationSec: targetDur
        }
      }
    }

    if (next.widgetConfig && Array.isArray(next.widgetConfig.items)) {
      let widgetChanged = false
      const nextItems = next.widgetConfig.items.map((item) => {
        const itemTag = item.cueTag?.trim()
        if (!itemTag) return item
        const cue = findNearestCue(itemTag, next.startSec + (item.triggerSec ?? 0))
        if (!cue) return item
        const relTrigger = Math.max(0, round3(cue.startSec - next.startSec))
        if (Math.abs((item.triggerSec ?? 0) - relTrigger) > 0.001) {
          widgetChanged = true
          syncedWidgetItemCount++
        }
        return {
          ...item,
          triggerSec: relTrigger
        }
      })
      if (widgetChanged) {
        next = {
          ...next,
          widgetConfig: {
            ...next.widgetConfig,
            items: nextItems
          }
        }
      }
    }

    return next
  })

  return {
    clips: finalClips,
    cueWindows,
    syncedClipCount,
    syncedWidgetItemCount
  }
}

// ─── 多模态大模型（VLM）/ 人脸主体追踪字幕轨迹与动态坐标求值 ─────────────────────────

export interface SpeakerFaceFrameDetection {
  /** 相对于字幕片段起点的秒数（0 <= offsetSec <= clip.durationSec） */
  offsetSec: number
  /** 归一化说话人面部/核心主体框（0..1） */
  box: { x: number; y: number; w: number; h: number }
  /** 多模态视觉大模型直接建议的最佳字幕避障中心点（0..1，可选） */
  captionCenter?: { x: number; y: number }
  /** 识别到的主体描述（如 "主播面部"、"二次元角色"、"萌宠猫头"） */
  subject?: string
}

/**
 * 构建用于多模态视觉大模型（Gemini / Qwen-VL / 豆包视觉 / GPT-4o / Claude）的
 * 说话人面部与字幕避障轨迹定位 Prompt（单次请求输入多帧采样图，输出逐帧归一化坐标）。
 */
export function buildVlmSpeakerTrackingPrompts(
  sampleOffsetsSec: ReadonlyArray<number>,
  subtitleText?: string
): { system: string; prompt: string } {
  const system = [
    '你是专业短视频视觉导演与多模态空间定位专家（Visual Grounding）。',
    '用户会按时间顺序提供同一镜头中的多张采样画面帧。请识别每一帧中的【当前说话人头部/面部】（若为二次元动漫、拟人萌宠或特写商品镜头，则定位对应的角色头部或核心焦点主体），并同时给出最适合放置动态跟随字幕的中心坐标（优先位于说话人下巴下方/胸口上方或主体旁侧安全留白区，绝不能遮挡人物眼睛、嘴部或关键商品特写）。',
    '所有坐标均使用 [0, 1] 归一化浮点数（左上角为 0,0，右下角为 1,1）。',
    '只输出纯 JSON 数组，不要输出任何 Markdown 解释文字。格式示例：',
    '[{"frame":1,"x":0.36,"y":0.16,"w":0.26,"h":0.30,"captionX":0.49,"captionY":0.56,"subject":"主播面部"}]'
  ].join('\n')

  const frameDesc = sampleOffsetsSec
    .map((sec, idx) => `Frame #${idx + 1} (offset ${sec.toFixed(2)}s)`)
    .join(', ')
  const subHint = subtitleText?.trim() ? `\n当前台词内容：「${subtitleText.trim()}」` : ''
  const prompt = `共 ${sampleOffsetsSec.length} 张按时间顺序排列的视频采样帧：${frameDesc}。${subHint}\n请严格按顺序输出包含 ${sampleOffsetsSec.length} 个元素的 JSON 数组，每项包含 frame (1..${sampleOffsetsSec.length})、主体头部框 x/y/w/h (0..1) 以及推荐字幕中心点 captionX/captionY (0..1)。`
  return { system, prompt }
}

function normalizeCoordScale(val: number, scale: number): number {
  if (!Number.isFinite(val)) return 0.5
  return clamp(val / scale, 0, 1)
}

/**
 * 解析多模态视觉大模型返回的说话人/主体追踪 JSON 文本：
 * - 自动兼容 `[0, 1]` 归一化坐标、`[0, 100]` 百分比坐标、以及 Qwen-VL / Gemini 常见的 `[0, 1000]` 千分比坐标；
 * - 兼容 `{ x, y, w, h }`、`{ xmin, ymin, xmax, ymax }` 以及 `box_2d: [ymin, xmin, ymax, xmax]` 格式。
 */
export function parseVlmSpeakerTrackingResponse(
  rawText: string,
  sampleOffsetsSec: ReadonlyArray<number>
): SpeakerFaceFrameDetection[] {
  const trimmed = String(rawText ?? '').trim()
  if (!trimmed || !sampleOffsetsSec.length) return []

  const candidates: string[] = [trimmed]
  const arrStart = trimmed.indexOf('[')
  const arrEnd = trimmed.lastIndexOf(']')
  if (arrStart >= 0 && arrEnd > arrStart) {
    candidates.push(trimmed.slice(arrStart, arrEnd + 1))
  }
  const objStart = trimmed.indexOf('{')
  const objEnd = trimmed.lastIndexOf('}')
  if (objStart >= 0 && objEnd > objStart) {
    candidates.push(trimmed.slice(objStart, objEnd + 1))
  }

  let rawList: Record<string, unknown>[] = []
  for (const cand of candidates) {
    try {
      const parsed = JSON.parse(cand) as unknown
      if (Array.isArray(parsed)) {
        rawList = parsed.filter((item): item is Record<string, unknown> =>
          Boolean(item && typeof item === 'object' && !Array.isArray(item))
        )
        if (rawList.length) break
      } else if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        const inner = obj.frames ?? obj.detections ?? obj.items ?? obj.results
        if (Array.isArray(inner)) {
          rawList = inner.filter((item): item is Record<string, unknown> =>
            Boolean(item && typeof item === 'object' && !Array.isArray(item))
          )
          if (rawList.length) break
        } else if ('x' in obj || 'box_2d' in obj || 'bbox' in obj) {
          rawList = [obj]
          break
        }
      }
    } catch {
      // try next candidate
    }
  }

  if (!rawList.length) return []

  const detections: SpeakerFaceFrameDetection[] = []
  for (let i = 0; i < sampleOffsetsSec.length; i++) {
    const offsetSec = sampleOffsetsSec[i]!
    const item =
      rawList.find((r) => Number(r.frame ?? r.index) === i + 1) ??
      rawList[Math.min(i, rawList.length - 1)]
    if (!item) continue

    let x = Number(item.x ?? item.left ?? item.xmin)
    let y = Number(item.y ?? item.top ?? item.ymin)
    let w = Number(item.w ?? item.width)
    let h = Number(item.h ?? item.height)

    // 兼容 box_2d / bbox 数组格式
    const arrBox = Array.isArray(item.box_2d)
      ? item.box_2d
      : Array.isArray(item.bbox)
        ? item.bbox
        : null
    if (arrBox && arrBox.length >= 4) {
      const n0 = Number(arrBox[0])
      const n1 = Number(arrBox[1])
      const n2 = Number(arrBox[2])
      const n3 = Number(arrBox[3])
      if (
        Number.isFinite(n0) &&
        Number.isFinite(n1) &&
        Number.isFinite(n2) &&
        Number.isFinite(n3)
      ) {
        // Gemini box_2d 惯例为 [ymin, xmin, ymax, xmax]；若 n2 > n0 且 n3 > n1 则按 min/max 转 x,y,w,h
        if (item.box_2d && n2 > n0 && n3 > n1) {
          y = n0
          x = n1
          h = n2 - n0
          w = n3 - n1
        } else {
          x = n0
          y = n1
          w = n2 > n0 && n2 <= 1000 && !('w' in item) ? n2 - n0 : n2
          h = n3 > n1 && n3 <= 1000 && !('h' in item) ? n3 - n1 : n3
        }
      }
    } else if (!Number.isFinite(w) && Number.isFinite(Number(item.xmax)) && Number.isFinite(x)) {
      w = Number(item.xmax) - x
      h = Number(item.ymax) - y
    }

    const capRawX = Number(item.captionX ?? item.cx ?? (item.captionCenter as any)?.x)
    const capRawY = Number(item.captionY ?? item.cy ?? (item.captionCenter as any)?.y)

    const maxVal = Math.max(
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      Number.isFinite(w) ? w : 0,
      Number.isFinite(h) ? h : 0,
      Number.isFinite(capRawX) ? capRawX : 0,
      Number.isFinite(capRawY) ? capRawY : 0
    )
    const scale = maxVal > 100 ? 1000 : maxVal > 1.5 ? 100 : 1

    const normX = Number.isFinite(x) ? normalizeCoordScale(x, scale) : 0.35
    const normY = Number.isFinite(y) ? normalizeCoordScale(y, scale) : 0.2
    const normW = Number.isFinite(w) && w > 0 ? clamp(w / scale, 0.08, 0.9) : 0.28
    const normH = Number.isFinite(h) && h > 0 ? clamp(h / scale, 0.08, 0.9) : 0.32

    const captionCenter =
      Number.isFinite(capRawX) && Number.isFinite(capRawY)
        ? {
            x: clamp(normalizeCoordScale(capRawX, scale), 0.16, 0.84),
            y: clamp(normalizeCoordScale(capRawY, scale), 0.16, 0.88)
          }
        : undefined

    const subject =
      typeof item.subject === 'string' && item.subject.trim() ? item.subject.trim() : undefined

    detections.push({
      offsetSec: round3(offsetSec),
      box: {
        x: round3(normX),
        y: round3(normY),
        w: round3(normW),
        h: round3(normH)
      },
      ...(captionCenter ? { captionCenter } : {}),
      ...(subject ? { subject } : {})
    })
  }

  return detections
}

export interface YoloFaceFrameLike {
  width: number
  height: number
  faces?: ReadonlyArray<{
    score: number
    box: { x: number; y: number; width: number; height: number }
  }>
}

export interface YoloDetectFrameLike {
  width: number
  height: number
  boxes?: ReadonlyArray<{
    label: string
    confidence: number
    x: number
    y: number
    width: number
    height: number
  }>
}

/**
 * 从本地 YOLO 人脸检测（`yoloFace`）与目标检测（`yoloDetect`）单帧结果中提取说话人/主体归一化检测框。
 * - 优先使用 `yoloFace` 检出的人脸框（评分 × 面积加权）；
 * - 若未检出正脸（如侧脸、远景、背影、萌宠），回退使用 `yoloDetect` 的 `person` 或高置信度前景主体框。
 */
export function extractSpeakerDetectionFromYoloFrame(
  offsetSec: number,
  faceResult?: YoloFaceFrameLike | null,
  detectResult?: YoloDetectFrameLike | null
): SpeakerFaceFrameDetection | null {
  if (
    faceResult &&
    faceResult.width > 0 &&
    faceResult.height > 0 &&
    Array.isArray(faceResult.faces) &&
    faceResult.faces.length > 0
  ) {
    const fw = faceResult.width
    const fh = faceResult.height
    const sortedFaces = [...faceResult.faces].sort((a, b) => {
      const areaA = Math.max(1, a.box.width * a.box.height)
      const areaB = Math.max(1, b.box.width * b.box.height)
      return b.score * Math.sqrt(areaB) - a.score * Math.sqrt(areaA)
    })
    const best = sortedFaces[0]!
    const nx = clamp(best.box.x / fw, 0, 0.92)
    const ny = clamp(best.box.y / fh, 0, 0.92)
    const nw = clamp(best.box.width / fw, 0.06, 0.9)
    const nh = clamp(best.box.height / fh, 0.06, 0.9)
    return {
      offsetSec: round3(offsetSec),
      box: {
        x: round3(nx),
        y: round3(ny),
        w: round3(nw),
        h: round3(nh)
      },
      subject: '人脸'
    }
  }

  if (
    detectResult &&
    detectResult.width > 0 &&
    detectResult.height > 0 &&
    Array.isArray(detectResult.boxes) &&
    detectResult.boxes.length > 0
  ) {
    const dw = detectResult.width
    const dh = detectResult.height
    const personBoxes = detectResult.boxes.filter((b) => String(b.label).toLowerCase() === 'person')
    const pool = personBoxes.length > 0 ? personBoxes : detectResult.boxes
    const sortedBoxes = [...pool].sort((a, b) => {
      const areaA = Math.max(1, a.width * a.height)
      const areaB = Math.max(1, b.width * b.height)
      return b.confidence * Math.sqrt(areaB) - a.confidence * Math.sqrt(areaA)
    })
    const best = sortedBoxes[0]!
    const nx = clamp(best.x / dw, 0, 0.92)
    const ny = clamp(best.y / dh, 0, 0.92)
    const nw = clamp(best.width / dw, 0.08, 0.92)
    const nh = clamp(best.height / dh, 0.08, 0.92)
    return {
      offsetSec: round3(offsetSec),
      box: {
        x: round3(nx),
        y: round3(ny),
        w: round3(nw),
        h: round3(nh)
      },
      subject: String(best.label).toLowerCase() === 'person' ? '人物主体' : best.label
    }
  }

  return null
}

/**
 * 将多帧人物/人脸检测框序列转换为平滑的字幕跟随关键帧（锚定在说话人下巴/胸口上方，防止遮挡五官）。
 */
export function buildFaceTrackingKeyframesFromDetections(
  detections: ReadonlyArray<SpeakerFaceFrameDetection>,
  clipDurationSec: number
): TimelineClipKeyframe[] {
  const dur = Math.max(0.05, Number(clipDurationSec) || 0.05)
  if (!detections.length) return []

  const sorted = [...detections]
    .filter((d) => d && d.box && Number.isFinite(d.offsetSec))
    .sort((a, b) => a.offsetSec - b.offsetSec)
  if (!sorted.length) return []

  // 计算每帧理想字幕中心点 (cx, cy)：若多模态大模型已给出避障中心点 captionCenter 则融合采用，否则取人脸框下方约 0.08 处
  const rawPoints = sorted.map((d) => {
    const boxCx = clamp(d.box.x + d.box.w * 0.5, 0.18, 0.82)
    // 若检测框偏大（全身/半身 person 框），取框体中下部；若是紧凑人脸框（h <= 0.42），取下巴下方
    const boxTargetY =
      d.box.h <= 0.42 ? d.box.y + d.box.h + 0.07 : d.box.y + Math.min(0.48, d.box.h * 0.62)
    const boxCy = clamp(boxTargetY, 0.18, 0.86)
    const cx = d.captionCenter ? clamp(d.captionCenter.x * 0.65 + boxCx * 0.35, 0.18, 0.82) : boxCx
    const cy = d.captionCenter ? clamp(d.captionCenter.y * 0.65 + boxCy * 0.35, 0.18, 0.86) : boxCy
    return {
      offsetSec: clamp(round3(d.offsetSec), 0, dur),
      cx,
      cy
    }
  })

  // 3 点滑动平均滤波，消除单帧检测抖动
  const smoothed = rawPoints.map((pt, idx) => {
    const prev = rawPoints[Math.max(0, idx - 1)]!
    const next = rawPoints[Math.min(rawPoints.length - 1, idx + 1)]!
    const cx = round3(prev.cx * 0.25 + pt.cx * 0.5 + next.cx * 0.25)
    const cy = round3(prev.cy * 0.25 + pt.cy * 0.5 + next.cy * 0.25)
    return { offsetSec: pt.offsetSec, cx, cy }
  })

  // 若说话人在该句内几乎静止（如固定机位口播或静态分镜图），叠加自然的说话呼吸律动微位移，确保预览时能直观看到动态跟随轨迹
  const xs = smoothed.map((p) => p.cx)
  const ys = smoothed.map((p) => p.cy)
  const rangeX = Math.max(...xs) - Math.min(...xs)
  const rangeY = Math.max(...ys) - Math.min(...ys)
  const needsMicroMotion = smoothed.length >= 2 && rangeX < 0.025 && rangeY < 0.025

  // 字幕框归一化宽高（x, y 在 TimelineClipKeyframe 中表示左上角，width=0.6, height=0.12 时中心为 x+0.3, y+0.06）
  const boxW = 0.6
  const boxH = 0.12
  const ease: TimelineEaseType = 'inOutSine'
  return smoothed.map((pt, idx) => {
    const phase = (idx / Math.max(1, smoothed.length - 1)) * Math.PI + 0.35
    const driftX = needsMicroMotion ? Math.sin(phase) * 0.038 * (idx % 2 === 0 ? -1 : 1) : 0
    const driftY = needsMicroMotion ? Math.cos(phase) * 0.024 : 0
    const finalCx = clamp(pt.cx + driftX, 0.18, 0.82)
    const finalCy = clamp(pt.cy + driftY, 0.18, 0.86)
    return {
      offsetSec: pt.offsetSec,
      x: round3(clamp(finalCx - boxW / 2, 0.04, 0.96 - boxW)),
      y: round3(clamp(finalCy - boxH / 2, 0.06, 0.94 - boxH)),
      width: boxW,
      height: boxH,
      rotation: 0,
      opacity: 1,
      ease
    }
  })
}

export interface EvaluatedSubtitlePosition {
  hasCustomPosition: boolean
  /** 归一化中心 X（0..1，0.5 = 水平居中） */
  centerX: number
  /** 归一化中心 Y（0..1，0.85 = 靠近底部） */
  centerY: number
}

/**
 * 求值字幕片段在指定时间点 `playheadSec` 的归一化中心位置（支持 YOLO 人脸追踪 `keyframes` 或手动 `overlayX`/`overlayY`）。
 */
export function evaluateSubtitleClipPosition(
  clip: {
    startSec: number
    durationSec: number
    overlayX?: number
    overlayY?: number
    overlayWidth?: number
    overlayHeight?: number
    keyframes?: TimelineClipKeyframe[]
  },
  playheadSec: number
): EvaluatedSubtitlePosition {
  const kfs = clip.keyframes
  if (Array.isArray(kfs) && kfs.length > 0) {
    const localT = clamp(playheadSec - clip.startSec, 0, Math.max(0.05, clip.durationSec))
    const sorted = [...kfs].sort((a, b) => a.offsetSec - b.offsetSec)
    if (localT <= sorted[0]!.offsetSec || sorted.length === 1) {
      const k = sorted[0]!
      return {
        hasCustomPosition: true,
        centerX: clamp(k.x + (k.width || 0.6) / 2, 0.1, 0.9),
        centerY: clamp(k.y + (k.height || 0.12) / 2, 0.1, 0.92)
      }
    }
    const last = sorted[sorted.length - 1]!
    if (localT >= last.offsetSec) {
      return {
        hasCustomPosition: true,
        centerX: clamp(last.x + (last.width || 0.6) / 2, 0.1, 0.9),
        centerY: clamp(last.y + (last.height || 0.12) / 2, 0.1, 0.92)
      }
    }
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i]!
      const b = sorted[i + 1]!
      if (localT >= a.offsetSec && localT <= b.offsetSec) {
        const span = Math.max(0.001, b.offsetSec - a.offsetSec)
        const rawProgress = (localT - a.offsetSec) / span
        const p = evaluateTimelineEase(a.ease ?? 'inOutSine', rawProgress)
        const ax = a.x + (a.width || 0.6) / 2
        const ay = a.y + (a.height || 0.12) / 2
        const bx = b.x + (b.width || 0.6) / 2
        const by = b.y + (b.height || 0.12) / 2
        return {
          hasCustomPosition: true,
          centerX: clamp(ax + (bx - ax) * p, 0.1, 0.9),
          centerY: clamp(ay + (by - ay) * p, 0.1, 0.92)
        }
      }
    }
  }

  if (typeof clip.overlayX === 'number' && typeof clip.overlayY === 'number') {
    const w = typeof clip.overlayWidth === 'number' ? clip.overlayWidth : 0.6
    const h = typeof clip.overlayHeight === 'number' ? clip.overlayHeight : 0.12
    return {
      hasCustomPosition: true,
      centerX: clamp(clip.overlayX + w / 2, 0.1, 0.9),
      centerY: clamp(clip.overlayY + h / 2, 0.1, 0.92)
    }
  }

  return {
    hasCustomPosition: false,
    centerX: 0.5,
    centerY: 0.86
  }
}

export interface EvaluatedTrackingHudBox {
  x: number
  y: number
  w: number
  h: number
  label: string
  subtitleCenterX: number
  subtitleCenterY: number
}

/**
 * 求值当前播放头处的「主体追踪可视化框（HUD）」归一化坐标，供时间线预览画布实时渲染追踪框与避障连线。
 */
export function evaluateTrackedSubjectBoxAtTime(
  clip: {
    startSec: number
    durationSec: number
    overlayX?: number
    overlayY?: number
    overlayWidth?: number
    overlayHeight?: number
    keyframes?: TimelineClipKeyframe[]
  },
  playheadSec: number,
  detections?: ReadonlyArray<SpeakerFaceFrameDetection>,
  engineLabel?: string
): EvaluatedTrackingHudBox | null {
  const pos = evaluateSubtitleClipPosition(clip, playheadSec)
  if (!pos.hasCustomPosition) return null

  const localT = clamp(playheadSec - clip.startSec, 0, Math.max(0.05, clip.durationSec))
  if (Array.isArray(detections) && detections.length > 0) {
    const sorted = [...detections].sort((a, b) => a.offsetSec - b.offsetSec)
    let box = sorted[0]!.box
    const label = engineLabel || sorted[0]!.subject || '追踪主体'
    if (localT >= sorted[sorted.length - 1]!.offsetSec) {
      box = sorted[sorted.length - 1]!.box
    } else {
      for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i]!
        const b = sorted[i + 1]!
        if (localT >= a.offsetSec && localT <= b.offsetSec) {
          const span = Math.max(0.001, b.offsetSec - a.offsetSec)
          const p = (localT - a.offsetSec) / span
          box = {
            x: a.box.x + (b.box.x - a.box.x) * p,
            y: a.box.y + (b.box.y - a.box.y) * p,
            w: a.box.w + (b.box.w - a.box.w) * p,
            h: a.box.h + (b.box.h - a.box.h) * p
          }
          break
        }
      }
    }
    return {
      x: round3(clamp(box.x, 0.02, 0.92)),
      y: round3(clamp(box.y, 0.02, 0.92)),
      w: round3(clamp(box.w, 0.08, 0.9)),
      h: round3(clamp(box.h, 0.08, 0.9)),
      label,
      subtitleCenterX: pos.centerX,
      subtitleCenterY: pos.centerY
    }
  }

  // 当仅持久化了 keyframes 时，根据字幕锚点反推上方说话人头部/上半身区域框
  const w = 0.28
  const h = 0.34
  const x = clamp(pos.centerX - w * 0.5, 0.04, 0.96 - w)
  const y = clamp(pos.centerY - h - 0.07, 0.04, 0.88 - h)
  return {
    x: round3(x),
    y: round3(y),
    w,
    h,
    label: engineLabel || '动态追踪主体',
    subtitleCenterX: pos.centerX,
    subtitleCenterY: pos.centerY
  }
}

/**
 * 为带人脸追踪关键帧（或自定义坐标）的字幕构建 FFmpeg `drawtext` 的 `x=...:y=...` 动态表达式。
 */
export function buildSubtitleKeyframeFfmpegXYExpr(
  clip: {
    startSec: number
    durationSec: number
    overlayX?: number
    overlayY?: number
    overlayWidth?: number
    overlayHeight?: number
    keyframes?: TimelineClipKeyframe[]
  },
  lineOffsetPx = 0
): { xExpr: string; yExpr: string } | null {
  const kfs = clip.keyframes
  if (Array.isArray(kfs) && kfs.length > 0) {
    const sorted = [...kfs].sort((a, b) => a.offsetSec - b.offsetSec)
    const centers = sorted.map((k) => ({
      t: round3(clip.startSec + k.offsetSec),
      cx: round3(clamp(k.x + (k.width || 0.6) / 2, 0.1, 0.9)),
      cy: round3(clamp(k.y + (k.height || 0.12) / 2, 0.1, 0.92))
    }))
    if (centers.length === 1) {
      const c = centers[0]!
      const yOff = lineOffsetPx !== 0 ? `${lineOffsetPx >= 0 ? '+' : ''}${lineOffsetPx}` : ''
      return {
        xExpr: `x=w*${c.cx}-text_w/2`,
        yExpr: `y=h*${c.cy}-text_h/2${yOff}`
      }
    }
    // 构造分段线性插值表达式（转义逗号供 FFmpeg filtergraph 使用）
    let xPiece = `${centers[centers.length - 1]!.cx}`
    let yPiece = `${centers[centers.length - 1]!.cy}`
    for (let i = centers.length - 2; i >= 0; i--) {
      const a = centers[i]!
      const b = centers[i + 1]!
      const dt = Math.max(0.01, round3(b.t - a.t))
      const prog = `min(1\\,max(0\\,(t-${a.t})/${dt}))`
      const xLerp = `(${a.cx}+(${round3(b.cx - a.cx)})*${prog})`
      const yLerp = `(${a.cy}+(${round3(b.cy - a.cy)})*${prog})`
      if (i === 0) {
        xPiece = `if(lte(t\\,${b.t})\\,${xLerp}\\,${xPiece})`
        yPiece = `if(lte(t\\,${b.t})\\,${yLerp}\\,${yPiece})`
      } else {
        xPiece = `if(lte(t\\,${b.t})\\,${xLerp}\\,${xPiece})`
        yPiece = `if(lte(t\\,${b.t})\\,${yLerp}\\,${yPiece})`
      }
    }
    const yOff = lineOffsetPx !== 0 ? `${lineOffsetPx >= 0 ? '+' : ''}${lineOffsetPx}` : ''
    return {
      xExpr: `x='w*(${xPiece})-text_w/2'`,
      yExpr: `y='h*(${yPiece})-text_h/2${yOff}'`
    }
  }

  if (typeof clip.overlayX === 'number' && typeof clip.overlayY === 'number') {
    const w = typeof clip.overlayWidth === 'number' ? clip.overlayWidth : 0.6
    const h = typeof clip.overlayHeight === 'number' ? clip.overlayHeight : 0.12
    const cx = round3(clamp(clip.overlayX + w / 2, 0.1, 0.9))
    const cy = round3(clamp(clip.overlayY + h / 2, 0.1, 0.92))
    const yOff = lineOffsetPx !== 0 ? `${lineOffsetPx >= 0 ? '+' : ''}${lineOffsetPx}` : ''
    return {
      xExpr: `x=w*${cx}-text_w/2`,
      yExpr: `y=h*${cy}-text_h/2${yOff}`
    }
  }

  return null
}

// ─── 1. 剧本 @{tag} 标签与 ASR 真实词级时间戳强制对齐合并器（Forced Alignment Merge） ───

/**
 * 将带有 `@{tag}关键词@{/tag}` 的原台词与语音识别（ASR）产出的纯文本真实词级时间戳 `asrWords` 强制对齐合并：
 * - 即使 ASR 识别文本缺失 `@{tag}` 标记，或标点符号/个别同音字有细微出入，也能将原台词中的 `@{tag}` 自动映射回
 *   ASR 的真实毫秒级 `words[]` 上，并重构保留 `@{tag}` 的 `rawCueText`！
 */
export interface AlignedSubtitleCueSpan {
  tag: string
  text: string
  cleanStartIndex?: number
  cleanEndIndex?: number
  startSec: number
  endSec: number
}

export interface AlignedSubtitleCueResult {
  cleanText: string
  words: TimelineWordTiming[]
  cues: AlignedSubtitleCueSpan[]
}

export function mergeInlineCuesWithAsrWords(
  taggedScriptTextOrInput:
    | string
    | {
        rawCueText: string
        asrWords: ReadonlyArray<{ text: string; startSec: number; endSec: number }>
        durationSec?: number
      },
  asrWordsArg?: ReadonlyArray<{ text: string; startSec: number; endSec: number }>,
  clipDurationSecArg?: number
): AlignedSubtitleCueResult & { rawCueText: string } {
  const taggedScriptText =
    typeof taggedScriptTextOrInput === 'string'
      ? taggedScriptTextOrInput
      : taggedScriptTextOrInput.rawCueText
  const asrWords =
    typeof taggedScriptTextOrInput === 'string'
      ? (asrWordsArg ?? [])
      : taggedScriptTextOrInput.asrWords
  const clipDurationSec =
    typeof taggedScriptTextOrInput === 'string'
      ? clipDurationSecArg
      : taggedScriptTextOrInput.durationSec

  const parsedScript = parseInlineCueText(taggedScriptText)
  const validAsr = (asrWords ?? [])
    .map((w) => ({
      text: String(w.text ?? '').trim(),
      startSec: Math.max(0, Number(w.startSec) || 0),
      endSec: Math.max(0, Number(w.endSec) || 0)
    }))
    .filter((w) => w.text.length > 0 && w.endSec >= w.startSec)

  const dur =
    typeof clipDurationSec === 'number' && clipDurationSec > 0
      ? clipDurationSec
      : validAsr.length
        ? Math.max(0.2, validAsr[validAsr.length - 1]!.endSec)
        : 2.0

  if (!validAsr.length) {
    const fallback = alignSubtitleWordsAndCues({
      text: taggedScriptText,
      durationSec: dur
    })
    return {
      ...fallback,
      rawCueText: taggedScriptText
    }
  }

  if (!parsedScript.cues.length) {
    const cleanText = validAsr.map((w) => w.text).join('')
    return {
      cleanText,
      rawCueText: cleanText,
      words: validAsr.map((w) => ({
        text: w.text,
        startSec: round3(w.startSec),
        endSec: round3(Math.max(w.startSec + 0.02, w.endSec))
      })),
      cues: []
    }
  }

  // 构建 ASR 词序列的字符区间映射表
  let asrCursor = 0
  const wordRanges = validAsr.map((w, idx) => {
    const startChar = asrCursor
    asrCursor += w.text.length
    return {
      idx,
      text: w.text,
      startChar,
      endChar: asrCursor,
      startSec: round3(w.startSec),
      endSec: round3(Math.max(w.startSec + 0.02, w.endSec)),
      cueTags: [] as string[]
    }
  })
  const fullAsrText = wordRanges.map((w) => w.text).join('')
  const scriptCleanLen = Math.max(1, parsedScript.cleanText.length)

  const alignedCues: AlignedSubtitleCueSpan[] = []
  for (const cue of parsedScript.cues) {
    const needle = cue.text.trim()
    if (!needle) continue
    // 1. 优先精确子串匹配
    let matchStart = fullAsrText.indexOf(needle)
    let matchEnd = matchStart >= 0 ? matchStart + needle.length : -1

    // 2. 若因同音字未精确命中，按原台词中的字符相对比例映射到 ASR 字符区间
    if (matchStart < 0) {
      const startRatio = clamp(cue.cleanStartIndex / scriptCleanLen, 0, 0.98)
      const endRatio = clamp(cue.cleanEndIndex / scriptCleanLen, startRatio + 0.05, 1)
      matchStart = Math.floor(startRatio * fullAsrText.length)
      matchEnd = Math.max(matchStart + 1, Math.ceil(endRatio * fullAsrText.length))
    }

    const hitWords = wordRanges.filter((wr) => wr.endChar > matchStart && wr.startChar < matchEnd)
    const targetWords = hitWords.length
      ? hitWords
      : [
          wordRanges[
            Math.min(
              wordRanges.length - 1,
              Math.floor((cue.cleanStartIndex / scriptCleanLen) * wordRanges.length)
            )
          ]!
        ]

    for (const tw of targetWords) {
      if (!tw.cueTags.includes(cue.tag)) tw.cueTags.push(cue.tag)
    }
    alignedCues.push({
      tag: cue.tag,
      text: targetWords.map((w) => w.text).join('') || cue.text,
      cleanStartIndex: targetWords[0]!.startChar,
      cleanEndIndex: targetWords[targetWords.length - 1]!.endChar,
      startSec: targetWords[0]!.startSec,
      endSec: targetWords[targetWords.length - 1]!.endSec
    })
  }

  // 重构带 @{tag} 的 rawCueText，使得后续编辑或锚点同步均能直接读取
  let reconstructedRaw = ''
  let i = 0
  while (i < wordRanges.length) {
    const tag = wordRanges[i]!.cueTags[0]
    if (!tag) {
      reconstructedRaw += wordRanges[i]!.text
      i++
    } else {
      let groupText = ''
      while (i < wordRanges.length && wordRanges[i]!.cueTags[0] === tag) {
        groupText += wordRanges[i]!.text
        i++
      }
      reconstructedRaw += `@{${tag}}${groupText}{/${tag}}`.replace(`{/${tag}}`, `@{/${tag}}`)
    }
  }

  return {
    cleanText: fullAsrText,
    rawCueText: reconstructedRaw || taggedScriptText,
    words: wordRanges.map((wr) => ({
      text: wr.text,
      startSec: wr.startSec,
      endSec: wr.endSec,
      ...(wr.cueTags.length ? { cueTags: wr.cueTags } : {})
    })),
    cues: alignedCues
  }
}

// ─── 2. 导出级像素一致的行内圆角胶囊 / 弹跳发光字幕 SVG 快照渲染器 ───────────────────────

function escapeSvgText(raw: string): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function estimateTokenVisualUnits(text: string): number {
  let units = 0
  for (const ch of text) {
    units += /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? 1.02 : 0.58
  }
  return Math.max(0.55, units)
}

export interface KaraokeSubtitleSvgOptions {
  mode?: TimelineSubtitleKaraokeMode
  karaokeMode?: TimelineSubtitleKaraokeMode
  clip?: {
    text?: string
    title?: string
    rawCueText?: string
    durationSec: number
    words?: TimelineWordTiming[]
    fontSize?: number
    textColor?: string
    subtitleHighlightColor?: string
    subtitleHighlightBgColor?: string
  }
  localTimeSec?: number
  fontSize?: number
  textColor?: string
  highlightColor?: string
  highlightBgColor?: string
  borderColor?: string
  borderWidth?: number
  boxEnabled?: boolean
  boxColor?: string
  boxOpacity?: number
  canvasWidth?: number
  canvasHeight?: number
}

/**
 * 构建指定激活词索引 `activeWordIndex`（或 `options.clip` + `options.localTimeSec`）下的高分透明背景行内卡拉 OK 字幕 SVG：
 * - `karaoke-pill`：行内圆角胶囊底框（`rx="13"`）+ 高亮字色 + 微放大；
 * - `karaoke-pop`：当前词 1.18x 弹跳放大 + 高亮描边阴影；
 * - `karaoke-glow`：当前词霓虹外发光滤镜；
 * - `word-solo`：单字/词居中大字胶囊暴击。
 */
export function buildKaraokeSubtitleSvgMarkup(
  wordsOrOpts: ReadonlyArray<TimelineWordTiming> | KaraokeSubtitleSvgOptions,
  activeWordIndexArg?: number,
  optionsArg?: KaraokeSubtitleSvgOptions
): string {
  const isArrayCall = Array.isArray(wordsOrOpts)
  const options: KaraokeSubtitleSvgOptions = isArrayCall
    ? (optionsArg ?? { mode: 'karaoke-pill' })
    : (wordsOrOpts as KaraokeSubtitleSvgOptions)
  const words: ReadonlyArray<TimelineWordTiming> = isArrayCall
    ? (wordsOrOpts as ReadonlyArray<TimelineWordTiming>)
    : options.clip
      ? getSubtitleClipWordTimings(options.clip)
      : []
  const activeWordIndex = isArrayCall
    ? (activeWordIndexArg ?? 0)
    : (() => {
        const t = options.localTimeSec ?? 0
        const idx = words.findIndex((w) => t >= w.startSec && t < w.endSec + 0.02)
        return idx >= 0 ? idx : 0
      })()

  const cw = options.canvasWidth ?? 960
  const ch = options.canvasHeight ?? 220
  const fontSize = Math.max(24, Math.min(120, options.fontSize ?? options.clip?.fontSize ?? 48))
  const textColor = options.textColor || options.clip?.textColor || '#ffffff'
  const highlightColor = options.highlightColor || options.clip?.subtitleHighlightColor || '#facc15'
  const highlightBg =
    options.highlightBgColor || options.clip?.subtitleHighlightBgColor || '#ff3b5c'
  const borderColor = options.borderColor || '#000000'
  const borderWidth = Math.max(2, (options.borderWidth ?? 3) * 1.6)
  const mode: TimelineSubtitleKaraokeMode = options.mode || options.karaokeMode || 'karaoke-pill'

  if (!words.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" width="${cw}" height="${ch}"></svg>`
  }

  if (mode === 'word-solo') {
    const active = words[Math.max(0, Math.min(words.length - 1, activeWordIndex))]!
    const soloFont = Math.round(fontSize * 1.32)
    const boxW = Math.min(
      cw - 40,
      Math.round(estimateTokenVisualUnits(active.text) * soloFont + 44)
    )
    const boxH = Math.round(soloFont * 1.42)
    const bx = Math.round((cw - boxW) / 2)
    const by = Math.round((ch - boxH) / 2)
    const textY = Math.round(ch / 2 + soloFont * 0.35)
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" width="${cw}" height="${ch}">
      <rect x="${bx}" y="${by}" width="${boxW}" height="${boxH}" rx="18" fill="${highlightBg}" fill-opacity="0.95" />
      <text x="${cw / 2}" y="${textY}" text-anchor="middle" fill="${highlightColor}" stroke="${borderColor}" stroke-width="${borderWidth}" paint-order="stroke fill" font-family="system-ui, -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif" font-size="${soloFont}" font-weight="900">${escapeSvgText(active.text)}</text>
    </svg>`
  }

  const tokenMetrics = words.map((w, idx) => {
    const isActive = idx === activeWordIndex
    const hasCueTag = Boolean(w.cueTags && w.cueTags.length > 0)
    const scale = isActive
      ? mode === 'karaoke-pop' || hasCueTag
        ? 1.18
        : 1.08
      : hasCueTag
        ? 1.05
        : 1.0
    const tokenFontSize = Math.round(fontSize * scale)
    const widthPx = Math.round(
      estimateTokenVisualUnits(w.text) * tokenFontSize +
        (isActive && mode === 'karaoke-pill' ? 20 : hasCueTag ? 10 : 4)
    )
    return {
      text: w.text,
      isActive,
      hasCueTag,
      tokenFontSize,
      widthPx
    }
  })

  // 智能双行均衡折行：当单行总宽超过画布安全区（cw - 80）或词内包含换行时，自动拆分为均衡双行
  const maxSafeLineWidth = Math.max(240, cw - 80)
  const totalSingleLineWidth = tokenMetrics.reduce((acc, m) => acc + m.widthPx, 0)
  type TokenMetricItem = (typeof tokenMetrics)[number]
  const lines: TokenMetricItem[][] = []

  if (totalSingleLineWidth <= maxSafeLineWidth || tokenMetrics.length <= 1) {
    lines.push(tokenMetrics)
  } else {
    // 寻找最接近总宽 50% 的均衡折行切分点
    const halfWidth = totalSingleLineWidth / 2
    let bestSplitIdx = 1
    let bestDiff = Number.POSITIVE_INFINITY
    let runningW = 0
    for (let i = 0; i < tokenMetrics.length - 1; i++) {
      runningW += tokenMetrics[i]!.widthPx
      const diff = Math.abs(runningW - halfWidth)
      if (diff < bestDiff) {
        bestDiff = diff
        bestSplitIdx = i + 1
      }
    }
    lines.push(tokenMetrics.slice(0, bestSplitIdx))
    lines.push(tokenMetrics.slice(bestSplitIdx))
  }

  const lineGap = Math.round(fontSize * 1.42)
  const firstLineCenterY =
    lines.length === 1 ? Math.round(ch / 2) : Math.round(ch / 2 - lineGap * 0.48)

  let rectsSvg = ''
  let textsSvg = ''

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const lineTokens = lines[lineIdx]!
    const lineTotalW = lineTokens.reduce((acc, m) => acc + m.widthPx, 0)
    let cursorX = Math.max(20, Math.round((cw - lineTotalW) / 2))
    const centerY = firstLineCenterY + lineIdx * lineGap

    for (const m of lineTokens) {
      const cx = Math.round(cursorX + m.widthPx / 2)
      const baselineY = Math.round(centerY + m.tokenFontSize * 0.35)
      if (m.isActive && mode === 'karaoke-pill') {
        const pillH = Math.round(m.tokenFontSize * 1.34)
        const pillY = Math.round(centerY - pillH / 2)
        rectsSvg += `<rect x="${cursorX + 2}" y="${pillY}" width="${Math.max(16, m.widthPx - 4)}" height="${pillH}" rx="13" fill="${highlightBg}" />`
      } else if (m.hasCueTag) {
        // @cueTag 重点词常驻底部强调金条
        const barW = Math.max(14, m.widthPx - 10)
        const barX = Math.round(cx - barW / 2)
        const barY = Math.round(baselineY + 6)
        rectsSvg += `<rect x="${barX}" y="${barY}" width="${barW}" height="4" rx="2" fill="${highlightColor}" fill-opacity="0.9" />`
      }
      const fillCol = m.isActive
        ? mode === 'karaoke-pill'
          ? '#ffffff'
          : highlightColor
        : m.hasCueTag
          ? highlightColor
          : textColor
      const filterAttr = m.isActive && mode === 'karaoke-glow' ? ' filter="url(#kw-glow)"' : ''
      textsSvg += `<text x="${cx}" y="${baselineY}" text-anchor="middle" fill="${fillCol}" stroke="${borderColor}" stroke-width="${borderWidth}" paint-order="stroke fill" font-family="system-ui, -apple-system, 'Microsoft YaHei', 'PingFang SC', sans-serif" font-size="${m.tokenFontSize}" font-weight="${m.isActive || m.hasCueTag ? '900' : '800'}"${filterAttr}>${escapeSvgText(m.text)}</text>`
      cursorX += m.widthPx
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cw} ${ch}" width="${cw}" height="${ch}">
    <defs>
      <filter id="kw-glow" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="0" dy="0" stdDeviation="6" flood-color="${highlightBg}" flood-opacity="0.95" />
      </filter>
    </defs>
    ${rectsSvg}
    ${textsSvg}
  </svg>`
}

export function buildKaraokeSubtitleSvgDataUrl(
  wordsOrOpts: ReadonlyArray<TimelineWordTiming> | KaraokeSubtitleSvgOptions,
  activeWordIndex?: number,
  options?: KaraokeSubtitleSvgOptions
): string {
  const svg = buildKaraokeSubtitleSvgMarkup(wordsOrOpts, activeWordIndex, options)
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export interface SubtitleKaraokeTimeSlice {
  startOffsetSec: number
  endOffsetSec: number
  sampleLocalSec: number
  activeWordIndex: number
}

/**
 * 将字幕片段按词级时间切分为逐词状态切片（供导出前 Canvas 预光栅化圆角胶囊 PNG 序列）。
 */
export function computeSubtitleKaraokeTimeSlices(clip: {
  text?: string
  title?: string
  rawCueText?: string
  durationSec: number
  words?: TimelineWordTiming[]
}): SubtitleKaraokeTimeSlice[] {
  const words = getSubtitleClipWordTimings(clip)
  if (!words.length) return []
  return words.map((w, idx) => {
    const startOffsetSec = w.startSec
    const endOffsetSec = Math.max(w.startSec + 0.03, w.endSec)
    return {
      startOffsetSec,
      endOffsetSec,
      sampleLocalSec: round3((startOffsetSec + endOffsetSec) * 0.5),
      activeWordIndex: idx
    }
  })
}

// ─── 3. 一键自动配齐卡点音效（Auto Cue & Widget Pop SFX）与关键词主镜顿挫推镜 ──────────

export interface AutoCueSfxClipSpec {
  id: string
  track: 'sfx'
  sourceId: string
  title: string
  sfxPresetId: TimelineProceduralSfxId
  startSec: number
  durationSec: number
  volume: number
  anchorCueTag?: string
}

/**
 * 扫描时间线上的所有 `@cueTag` 词级锚点以及 `widgetConfig.items` 弹出时间点，
 * 自动生成尚未铺设音效的内置卡点音效片段（`pop` / `whoosh` / `ding` / `boom`）。
 */
export function buildAutoCueSfxClips<T extends CueSyncableClip & { sfxPresetId?: string }>(
  inputClips: ReadonlyArray<T>,
  createId: (index: number) => string = (idx) => `sfx-auto-${idx}`
): { clips: Array<T | AutoCueSfxClipSpec>; addedClips: AutoCueSfxClipSpec[]; addedCount: number } {
  const synced = syncTimelineCueAnchors(inputClips)
  const existingSfxTimes = synced.clips.filter((c) => c.track === 'sfx').map((c) => c.startSec)

  const hasSfxNear = (timeSec: number): boolean =>
    existingSfxTimes.some((t) => Math.abs(t - timeSec) < 0.14)

  const added: AutoCueSfxClipSpec[] = []
  let seqIdx = 0

  // 1. 为所有 @cueTag 词级锚点生成卡点音效
  for (const win of synced.cueWindows) {
    if (hasSfxNear(win.startSec)) continue
    const sfxId = inferProceduralSfxIdForTag(win.tag)
    const preset =
      TIMELINE_PROCEDURAL_SFX_PRESETS.find((p) => p.id === sfxId) ??
      TIMELINE_PROCEDURAL_SFX_PRESETS[0]!
    existingSfxTimes.push(win.startSec)
    added.push({
      id: createId(seqIdx++),
      track: 'sfx',
      sourceId: `procedural-sfx:${sfxId}:${win.tag}`,
      title: `${preset.labelZh.split(' ')[0]} @${win.tag}`,
      sfxPresetId: sfxId,
      startSec: win.startSec,
      durationSec: preset.durationSec,
      volume: 0.85,
      anchorCueTag: win.tag
    })
  }

  // 2. 为所有动态图表组件（TierBoard / RankingList 等）子项飞入时刻生成卡点音效
  for (const clip of synced.clips) {
    if (clip.track !== 'overlay' || !clip.widgetConfig?.items?.length) continue
    for (const item of clip.widgetConfig.items) {
      const globalTriggerSec = round3(clip.startSec + (item.triggerSec ?? 0))
      if (hasSfxNear(globalTriggerSec)) continue
      const sfxId: TimelineProceduralSfxId =
        item.tier === 'S'
          ? 'ding'
          : clip.widgetConfig.kind === 'tier-board' || clip.widgetConfig.kind === 'ranking-list'
            ? 'whoosh'
            : 'pop'
      const preset =
        TIMELINE_PROCEDURAL_SFX_PRESETS.find((p) => p.id === sfxId) ??
        TIMELINE_PROCEDURAL_SFX_PRESETS[0]!
      existingSfxTimes.push(globalTriggerSec)
      added.push({
        id: createId(seqIdx++),
        track: 'sfx',
        sourceId: `procedural-sfx:${sfxId}:${item.id}`,
        title: `${preset.labelZh.split(' ')[0]} · ${item.label.slice(0, 8)}`,
        sfxPresetId: sfxId,
        startSec: globalTriggerSec,
        durationSec: preset.durationSec,
        volume: 0.8,
        ...(item.cueTag ? { anchorCueTag: item.cueTag } : {})
      })
    }
  }

  const sortedAdded = added.sort((a, b) => a.startSec - b.startSec)
  return {
    clips: [...synced.clips, ...sortedAdded],
    addedClips: sortedAdded,
    addedCount: sortedAdded.length
  }
}

export interface CuePunchZoomOptions {
  /** 是否在长镜头（>2.2s）内按 @cueTag 暴击时间窗自动切分出独立的推镜子片段，结束后自动回弹正常景别 */
  splitAtCueWindow?: boolean
  /** 切分后收尾保持时长（默认 0.35s） */
  holdAfterCueSec?: number
  /** 自定义生成新子片段 ID 的回调 */
  createClipId?: (baseId: string, subIndex: number) => string
}

/**
 * 为命中 `@cueTag` 关键词的主视频轨（`video`）片段自动注入「暴击顿挫推镜（Beat Punch-In Zoom）」：
 * - 当台词念到 `@{tag}关键词@{/tag}` 所在的视频片段时，自动开启 `cameraMotion: 'impactPush'` 并叠加中心微裁切推近；
 * - 若开启 `options.splitAtCueWindow = true`，且视频片段较长（> 2.2s），会自动围绕 `[cue.startSec, cue.endSec + holdAfterCueSec]`
 *   将主视频无损切分为「前段正常景别 + 暴击词窗口顿挫推镜 + 后段回弹正常景别」，精准对齐每个重音词。
 */
export function applyCuePunchZoomToVideoClips<
  T extends CueSyncableClip & {
    cameraMotion?: string
    cropX?: number
    cropY?: number
    cropWidth?: number
    cropHeight?: number
    sourceOffsetSec?: number
    speed?: number
  }
>(
  inputClips: ReadonlyArray<T>,
  zoomScale = 1.14,
  options?: CuePunchZoomOptions
): {
  clips: T[]
  punchedVideoCount: number
  updatedVideoClipCount: number
  splitSubClipCount: number
} {
  const cueWindows = extractTimelineCueWindows(inputClips)
  if (!cueWindows.length) {
    return {
      clips: inputClips.map((c) => ({ ...c })),
      punchedVideoCount: 0,
      updatedVideoClipCount: 0,
      splitSubClipCount: 0
    }
  }

  const safeScale = clamp(zoomScale, 1.05, 1.35)
  const cropW = round3(1 / safeScale)
  const cropH = round3(1 / safeScale)
  const cropX = round3((1 - cropW) / 2)
  const cropY = round3((1 - cropH) / 2)
  const holdAfterSec = clamp(options?.holdAfterCueSec ?? 0.35, 0.1, 1.2)
  const splitEnabled = Boolean(options?.splitAtCueWindow)
  const makeId =
    options?.createClipId ?? ((baseId: string, subIndex: number) => `${baseId}-punch-${subIndex}`)

  let punchedVideoCount = 0
  let splitSubClipCount = 0
  const nextClips: T[] = []

  for (const clip of inputClips) {
    if (clip.track !== 'video') {
      nextClips.push({ ...clip })
      continue
    }
    const clipStart = clip.startSec
    const clipEnd = clip.startSec + clip.durationSec
    const overlappingCues = cueWindows
      .filter((w) => w.endSec > clipStart + 0.02 && w.startSec < clipEnd - 0.02)
      .sort((a, b) => a.startSec - b.startSec)

    if (!overlappingCues.length) {
      nextClips.push({ ...clip })
      continue
    }

    const firstCue = overlappingCues[0]!
    const punchStart = round3(Math.max(clipStart, firstCue.startSec))
    const punchEnd = round3(
      Math.min(clipEnd, Math.max(punchStart + 0.45, firstCue.endSec + holdAfterSec))
    )

    const canSplit =
      splitEnabled &&
      clip.durationSec >= 2.2 &&
      punchEnd - punchStart < clip.durationSec - 0.35 &&
      (punchStart - clipStart >= 0.25 || clipEnd - punchEnd >= 0.25)

    if (!canSplit) {
      punchedVideoCount++
      nextClips.push({
        ...clip,
        cameraMotion:
          clip.cameraMotion && clip.cameraMotion !== 'none'
            ? clip.cameraMotion
            : ('impactPush' as any),
        cropX: clip.cropX ?? cropX,
        cropY: clip.cropY ?? cropY,
        cropWidth: clip.cropWidth ?? cropW,
        cropHeight: clip.cropHeight ?? cropH
      })
      continue
    }

    // 按 [clipStart, punchStart], [punchStart, punchEnd], [punchEnd, clipEnd] 拆分为子片段，保持 sourceOffsetSec 严密连续
    const baseOffset = Number(clip.sourceOffsetSec ?? 0)
    const speed = Number(clip.speed ?? 1) > 0 ? Number(clip.speed ?? 1) : 1
    let subIdx = 1

    if (punchStart - clipStart >= 0.2) {
      const preDur = round3(punchStart - clipStart)
      nextClips.push({
        ...clip,
        id: makeId(clip.id, subIdx++),
        startSec: round3(clipStart),
        durationSec: preDur,
        sourceOffsetSec: round3(baseOffset)
      })
      splitSubClipCount++
    }

    const actualPunchStart = punchStart - clipStart >= 0.2 ? punchStart : clipStart
    const actualPunchEnd = clipEnd - punchEnd >= 0.2 ? punchEnd : clipEnd
    const punchDur = round3(Math.max(0.25, actualPunchEnd - actualPunchStart))
    const punchSourceOffset = round3(baseOffset + (actualPunchStart - clipStart) * speed)

    punchedVideoCount++
    nextClips.push({
      ...clip,
      id: clip.id,
      startSec: round3(actualPunchStart),
      durationSec: punchDur,
      sourceOffsetSec: punchSourceOffset,
      cameraMotion:
        clip.cameraMotion && clip.cameraMotion !== 'none'
          ? clip.cameraMotion
          : ('impactPush' as any),
      cropX: clip.cropX ?? cropX,
      cropY: clip.cropY ?? cropY,
      cropWidth: clip.cropWidth ?? cropW,
      cropHeight: clip.cropHeight ?? cropH
    })

    if (clipEnd - actualPunchEnd >= 0.2) {
      const postDur = round3(clipEnd - actualPunchEnd)
      const postSourceOffset = round3(baseOffset + (actualPunchEnd - clipStart) * speed)
      nextClips.push({
        ...clip,
        id: makeId(clip.id, subIdx++),
        startSec: round3(actualPunchEnd),
        durationSec: postDur,
        sourceOffsetSec: postSourceOffset
      })
      splitSubClipCount++
    }
  }

  return {
    clips: nextClips,
    punchedVideoCount,
    updatedVideoClipCount: punchedVideoCount,
    splitSubClipCount
  }
}

// ─── 4. 多模态 VLM 9:16 竖屏智能主体居中重构图（Smart Auto-Reframe） ──────────────

export interface SmartReframeCropResult {
  cropX: number
  cropY: number
  cropWidth: number
  cropHeight: number
  subjectCenterX: number
  subjectCenterY: number
}

/**
 * 根据多模态视觉大模型（VLM）检测到的多帧说话人/核心主体框序列，
 * 计算从源画幅（如 16:9 横屏）智能重构图到目标画幅（如 9:16 竖屏）的最佳主体居中裁切窗口。
 */
export function computeSmartReframeCropFromDetections(
  detections: ReadonlyArray<SpeakerFaceFrameDetection>,
  sourceAspect = 16 / 9,
  targetAspect = 9 / 16
): SmartReframeCropResult {
  const safeSrc = Number.isFinite(sourceAspect) && sourceAspect > 0.1 ? sourceAspect : 16 / 9
  const safeDst = Number.isFinite(targetAspect) && targetAspect > 0.1 ? targetAspect : 9 / 16

  // 计算主体加权中心点
  let sumX = 0
  let sumY = 0
  let count = 0
  for (const det of detections) {
    const cx = clamp(det.box.x + det.box.w / 2, 0.05, 0.95)
    const cy = clamp(det.box.y + det.box.h / 2, 0.05, 0.95)
    sumX += cx
    sumY += cy
    count++
  }
  const subjectCenterX = count > 0 ? round3(sumX / count) : 0.5
  const subjectCenterY = count > 0 ? round3(sumY / count) : 0.42

  let cropWidth = 1
  let cropHeight = 1
  if (safeDst < safeSrc) {
    // 横转竖（如 16:9 -> 9:16）：保持高度 1.0，水平方向收窄并锚定说话人中心
    cropWidth = round3(clamp(safeDst / safeSrc, 0.25, 1))
    cropHeight = 1
  } else if (safeDst > safeSrc) {
    // 竖转横：保持宽度 1.0，垂直方向收窄并锚定说话人头部偏上区域
    cropWidth = 1
    cropHeight = round3(clamp(safeSrc / safeDst, 0.25, 1))
  }

  const cropX = round3(clamp(subjectCenterX - cropWidth / 2, 0, Math.max(0, 1 - cropWidth)))
  const cropY = round3(clamp(subjectCenterY - cropHeight * 0.42, 0, Math.max(0, 1 - cropHeight)))

  return {
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    subjectCenterX,
    subjectCenterY
  }
}

// ─── 5. AI 一键爆款包装（自动识别金句/数字/转折词并注入 @cueTag + 词级对齐） ──────────

interface ViralKeywordRule {
  pattern: RegExp
  tag: 'boom' | 'ding' | 'whoosh' | 'pop'
}

const DEFAULT_VIRAL_KEYWORD_RULES: ReadonlyArray<ViralKeywordRule> = [
  // 1. 强冲击/反转/极限词 -> boom
  {
    pattern:
      /(天花板|王炸|颠覆|彻底|暴涨|翻倍|直接封神|封神|吊打|碾压|绝了|太猛了|史诗级|真相|千万别|绝对不能|警告|崩溃|炸裂)/g,
    tag: 'boom'
  },
  // 2. 数据/百分比/金额/排名/S级 -> ding
  {
    pattern:
      /(第[一二三123]名?|TOP\s*\d+|S级|\d+(?:\.\d+)?(?:%|倍|万|亿|元|块|秒|分钟|小时|天)|100%|零成本|免费|核心秘诀|隐藏技巧|唯一|重点)/gi,
    tag: 'ding'
  },
  // 3. 转折/节奏切换词 -> whoosh
  {
    pattern: /(但是|然而|结果|没想到|突然|一瞬间|接下来|首先|最后|关键来了|注意看|立刻|马上)/g,
    tag: 'whoosh'
  }
]

/**
 * 对单条无标签纯文本字幕自动注入爆款 `@cueTag` 标记（每条字幕最多注入 2 个核心重点词，避免过度凌乱）：
 * - 若原文本已包含 `@{tag}` 则保持原样；
 * - 优先匹配强冲击词（`boom`）、数字/排名/干货词（`ding`）、转折词（`whoosh`）；
 * - 若均未命中但句子长度适中，自动为句尾核心词或引号内词汇加上 `@{pop}`。
 */
export function autoAnnotateSingleSubtitleCueText(
  rawText: string,
  maxTagsPerLine = 2
): {
  cueText: string
  injectedTags: string[]
} {
  const trimmed = String(rawText ?? '').trim()
  if (!trimmed) return { cueText: '', injectedTags: [] }
  if (/\{\s*[a-zA-Z0-9_-]+\s*\}/.test(trimmed) && trimmed.includes('@{')) {
    return { cueText: trimmed, injectedTags: [] }
  }

  let working = trimmed
  const injectedTags: string[] = []

  // 优先匹配引号「...」或“...”中的重点短语
  const quoteMatch = working.match(/[「“"]([^」”"\s]{2,8})[」”"]/)
  if (quoteMatch && quoteMatch[1] && injectedTags.length < maxTagsPerLine) {
    const phrase = quoteMatch[1]
    working = working.replace(quoteMatch[0], `@{ding}${phrase}@{/ding}`)
    injectedTags.push('ding')
  }

  for (const rule of DEFAULT_VIRAL_KEYWORD_RULES) {
    if (injectedTags.length >= maxTagsPerLine) break
    rule.pattern.lastIndex = 0
    working = working.replace(rule.pattern, (match, _g1, offset, fullStr) => {
      if (injectedTags.length >= maxTagsPerLine) return match
      // 避免在已注入的 @{...} 内部重复包裹
      const prefix = String(fullStr).slice(0, Number(offset))
      const openCount = (prefix.match(/@\{[a-zA-Z0-9_-]+\}/g) || []).length
      const closeCount = (prefix.match(/@\{\/[a-zA-Z0-9_-]+\}/g) || []).length
      if (openCount > closeCount) return match
      injectedTags.push(rule.tag)
      return `@{${rule.tag}}${match}@{/${rule.tag}}`
    })
  }

  // 若仍未命中任何规则，且文本长度 >= 4，提取末尾 2~4 字核心词加上 @{pop}
  if (injectedTags.length === 0 && working.length >= 4) {
    const tailMatch = working.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,4})([！!？?。.~～]*)$/)
    if (tailMatch && tailMatch[1]) {
      const core = tailMatch[1]
      const punct = tailMatch[2] ?? ''
      const head = working.slice(0, working.length - tailMatch[0].length)
      working = `${head}@{pop}${core}@{/pop}${punct}`
      injectedTags.push('pop')
    }
  }

  return { cueText: working, injectedTags }
}

/**
 * 批量扫描时间线上的字幕片段，自动注入爆款 `@cueTag` 重点词、生成逐词时间戳并开启卡拉 OK 胶囊高亮模式。
 */
export function autoAnnotateSubtitleCueTags<
  T extends CueSyncableClip & {
    subtitleKaraokeMode?: TimelineSubtitleKaraokeMode
  }
>(
  inputClips: ReadonlyArray<T>,
  llmAnnotatedMap?: ReadonlyMap<string, string>
): {
  clips: T[]
  annotatedSubtitleCount: number
  injectedTagCount: number
} {
  let annotatedSubtitleCount = 0
  let injectedTagCount = 0

  const nextClips = inputClips.map((clip) => {
    if (clip.track !== 'subtitle') return { ...clip }
    const baseRaw = String(clip.rawCueText || clip.text || clip.title || '').trim()
    if (!baseRaw) return { ...clip }

    const llmOverride = llmAnnotatedMap?.get(clip.id)
    const { cueText, injectedTags } = llmOverride
      ? {
          cueText: llmOverride,
          injectedTags: (llmOverride.match(/@\{([a-zA-Z0-9_-]+)\}/g) || []).map((m) =>
            m.slice(2, -1)
          )
        }
      : autoAnnotateSingleSubtitleCueText(baseRaw)

    const aligned = alignSubtitleWordsAndCues({
      text: cueText,
      durationSec: clip.durationSec,
      existingWords: clip.words
    })
    if (injectedTags.length > 0 || cueText !== baseRaw) {
      annotatedSubtitleCount++
      injectedTagCount += injectedTags.length
    }

    return {
      ...clip,
      rawCueText: cueText,
      text: aligned.cleanText,
      words: aligned.words,
      subtitleKaraokeMode:
        clip.subtitleKaraokeMode && clip.subtitleKaraokeMode !== 'none'
          ? clip.subtitleKaraokeMode
          : 'karaoke-pill'
    }
  })

  return {
    clips: nextClips,
    annotatedSubtitleCount,
    injectedTagCount
  }
}

/**
 * 构建用于文本大模型的「AI 爆款字幕重点词与音效卡点标注」Prompt。
 */
export function buildViralPackagingPrompts(
  subtitles: ReadonlyArray<{ id: string; text: string }>
): { system: string; prompt: string } {
  const system = [
    '你是顶级短视频爆款编导（精通抖音/Reels/Hypit 节奏包装）。',
    '请在不增删、不篡改任何原始台词文字的前提下，为每条字幕中最具情绪张力、数据反差、核心卖点或转折的 1~2 个关键词包裹上音效与视觉暴击标签：',
    '- `@{boom}关键词@{/boom}`：用于炸裂结论、颠覆认知、最高级、警告或痛点词；',
    '- `@{ding}关键词@{/ding}`：用于核心数字、百分比、金额、排名、S级或干货秘诀；',
    '- `@{whoosh}关键词@{/whoosh}`：用于转折词、节奏切换词；',
    '- `@{pop}关键词@{/pop}`：用于趣味重点名词或句尾重音词。',
    '只输出纯 JSON 数组，格式为：[{"id":"sub-1","cueText":"这绝对是今年@{boom}王炸@{/boom}级的@{ding}免费工具@{/ding}！"}]'
  ].join('\n')

  const lines = subtitles.map((s) => JSON.stringify({ id: s.id, text: s.text })).join('\n')
  const prompt = `请为以下 ${subtitles.length} 条字幕标注爆款 @cueTag 标签（保持原文一字不差，仅插入标签），输出纯 JSON 数组：\n${lines}`
  return { system, prompt }
}

/**
 * 解析大模型返回的爆款字幕 `@cueTag` 标注 JSON，并校验去标签后纯文本与原文字幕一致（防止幻觉改字）。
 */
export function parseViralPackagingResponse(
  rawResponse: string,
  originalSubtitles: ReadonlyArray<{ id: string; text: string }>
): Map<string, string> {
  const result = new Map<string, string>()
  const trimmed = String(rawResponse ?? '').trim()
  if (!trimmed) return result

  const start = trimmed.indexOf('[')
  const end = trimmed.lastIndexOf(']')
  const jsonCandidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed

  try {
    const parsed = JSON.parse(jsonCandidate) as unknown
    if (!Array.isArray(parsed)) return result
    const origMap = new Map(
      originalSubtitles.map((s) => [s.id, parseInlineCueText(s.text).cleanText.trim()])
    )

    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const id = String(rec.id ?? '').trim()
      const cueText = String(rec.cueText ?? rec.text ?? '').trim()
      if (!id || !cueText || !cueText.includes('@{')) continue
      const expectedClean = origMap.get(id)
      const actualClean = parseInlineCueText(cueText).cleanText.trim()
      if (expectedClean && actualClean === expectedClean) {
        result.set(id, cueText)
      }
    }
  } catch {
    // fallback handled by caller
  }
  return result
}
