/**
 * 字幕按画幅折行 + 专业淡入上滚表达式（纯函数，导出 burn-in 与单测共用）。
 */

/** 按最大字符数拆行；CJK 按字计，英文尽量在空格断 */
export function wrapSubtitleLines(text: string, maxCharsPerLine: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const limit = Math.max(4, Math.floor(maxCharsPerLine))
  if (normalized.length <= limit) return [normalized]
  const lines: string[] = []
  let i = 0
  while (i < normalized.length) {
    let end = Math.min(i + limit, normalized.length)
    if (end < normalized.length) {
      const slice = normalized.slice(i, end)
      const spaceAt = slice.lastIndexOf(' ')
      if (spaceAt > limit * 0.35) end = i + spaceAt
    }
    const line = normalized.slice(i, end).trim()
    if (line) lines.push(line)
    i = Math.max(end, i + 1)
    while (normalized[i] === ' ') i++
  }
  return lines
}

/** 按视频宽与字号估每行字数（CJK ≈ 1em） */
export function subtitleMaxCharsForWidth(width: number, fontSize: number): number {
  return Math.max(8, Math.floor((width * 0.86) / Math.max(12, fontSize)))
}

/** 淡入/淡出时长：随片段伸缩，避免短字幕刚显就消 */
export function subtitleFadeSec(durationSec: number): number {
  const dur = Math.max(0.05, durationSec)
  return Math.min(0.45, Math.max(0.14, dur * 0.16))
}

export type SubtitleDrawtextMotion = {
  /** drawtext 的 enable=… */
  enable: string
  /** drawtext 的 alpha='…' */
  alpha: string
  /** drawtext 的 y=…（自下而上滚入） */
  y: string
}

/**
 * 专业字幕动效：淡入 + 自下微上滚，尾段淡出。
 * 表达式供 ffmpeg drawtext 使用（逗号已按 filtergraph 规则转义）。
 */
export function buildSubtitleDrawtextMotion(input: {
  startSec: number
  endSec: number
  /** 静止时距底边的像素 */
  fromBottom: number
  /** 进场上滚距离（像素） */
  risePx: number
  fadeSec?: number
}): SubtitleDrawtextMotion {
  const start = Math.max(0, input.startSec)
  const end = Math.max(start + 0.05, input.endSec)
  const dur = end - start
  let fade = input.fadeSec ?? subtitleFadeSec(dur)
  fade = Math.min(fade, dur / 2.4)
  const s = start.toFixed(3)
  const e = end.toFixed(3)
  const f = fade.toFixed(3)
  const base = Math.round(input.fromBottom)
  const rise = Math.max(0, Math.round(input.risePx))
  // 进场：progress 0→1；离场只改 alpha，y 保持最终位（更像成片字幕）
  const progress = `min(1\\,max(0\\,(t-${s})/${f}))`
  return {
    enable: `enable='between(t\\,${s}\\,${e})'`,
    alpha: `alpha='if(lt(t\\,${s}+${f})\\,(t-${s})/${f}\\,if(gt(t\\,${e}-${f})\\,(${e}-t)/${f}\\,1))'`,
    y: `y=h-${base}-${rise}+${rise}*${progress}`
  }
}
