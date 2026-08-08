/**
 * 片段重拍节点：源视频 + 时间戳区间 + 修改指令 → Seedance 2.5 时间戳级视频编辑。
 * Prompt 使用方舟 Seedance 约定「@视频1」与「00:05—00:09」时间戳指令。
 */

export type ReshootSegment = {
  /** 重拍区间起点（秒） */
  startSec?: number
  /** 重拍区间终点（秒） */
  endSec?: number
}

function isEnglishLocale(locale?: string): boolean {
  return locale === 'en-US' || (locale?.startsWith('en') ?? false)
}

function pickByLocale(locale: string | undefined, en: string, zh: string): string {
  return isEnglishLocale(locale) ? en : zh
}

function resolveOrDefault(
  raw: string | undefined,
  locale: string | undefined,
  fallback: (locale?: string) => string
): string {
  const trimmed = raw?.trim() ?? ''
  return trimmed || fallback(locale)
}

/** 秒 → 00:05 或 01:05:09 时间戳文本（Seedance 时间戳指令格式） */
export function formatReshootTimestamp(sec: number | undefined): string {
  if (!Number.isFinite(sec) || sec == null || sec < 0) return ''
  const total = Math.floor(sec)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** 有效重拍区间：起点 < 终点且均为非负有限秒数 */
export function isValidReshootSegment(segment: ReshootSegment): segment is ReshootSegment & {
  startSec: number
  endSec: number
} {
  const { startSec, endSec } = segment
  return (
    Number.isFinite(startSec) &&
    Number.isFinite(endSec) &&
    startSec != null &&
    endSec != null &&
    startSec >= 0 &&
    endSec > startSec
  )
}

export const DEFAULT_RESHOOT_SYSTEM_PROMPT_EN =
  'You are a professional video editor. Edit only the specified timestamp range of the reference video. Keep every other part of the source video intact: character identity, scene, motion, camera, sound, and pacing must remain unchanged outside the target segment. Preserve visual and audio continuity at the boundaries of the edited segment. No subtitles, watermarks, or extra UI.'

export const DEFAULT_RESHOOT_SYSTEM_PROMPT_ZH =
  '你是一名专业视频编辑。仅修改参考视频中指定的时间戳区间，其余片段必须保持原视频的人物、场景、动作、镜头、声音与节奏完全不变，并在编辑区间边界保持画面与音频的自然衔接。不要字幕、水印或多余 UI。'

export function defaultReshootSystemPrompt(locale?: string): string {
  return pickByLocale(locale, DEFAULT_RESHOOT_SYSTEM_PROMPT_EN, DEFAULT_RESHOOT_SYSTEM_PROMPT_ZH)
}

export function resolveReshootSystemPrompt(raw: string | undefined, locale?: string): string {
  return resolveOrDefault(raw, locale, defaultReshootSystemPrompt)
}

export function defaultReshootUserPrompt(
  instruction: string,
  segment: ReshootSegment,
  locale?: string
): string {
  const change = instruction.trim()
  if (isValidReshootSegment(segment)) {
    const range = `${formatReshootTimestamp(segment.startSec)}—${formatReshootTimestamp(segment.endSec)}`
    return pickByLocale(
      locale,
      `Edit @video 1: ${range}, ${change}. Keep the rest of the video exactly as the source.`,
      `编辑 @视频1：${range}，${change}。其余片段保持与原视频完全一致。`
    )
  }
  return pickByLocale(
    locale,
    `Edit @video 1: ${change}. Keep the rest of the video exactly as the source.`,
    `编辑 @视频1：${change}。其余片段保持与原视频完全一致。`
  )
}

/** 组装重拍用户提示词；无指令时给默认编辑指引，保证不丢参考视频语义 */
export function buildReshootPrompt(
  instruction: string,
  segment: ReshootSegment,
  locale?: string
): string {
  const trimmed = instruction.trim()
  if (trimmed) {
    return defaultReshootUserPrompt(trimmed, segment, locale)
  }
  return pickByLocale(
    locale,
    'Edit @video 1: refine the specified timestamp range as intended. Keep the rest of the video exactly as the source.',
    '编辑 @视频1：按照意图优化指定时间戳区间。其余片段保持与原视频完全一致。'
  )
}
