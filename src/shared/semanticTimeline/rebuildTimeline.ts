/**
 * 语义重建的输出时间轴（纯函数，主进程拼接与单测共用）。
 *
 * 原片时间（分析 / 台词 / 配音都用它） → 成片时间（删镜后会前移）的映射：
 * 每段在成片里占 `durationSec`，段内 `sourceStartSec..sourceEndSec` 线性对应。
 */

export interface LayoutSegmentInput {
  key: string
  durationSec: number
  sourceStartSec?: number
  sourceEndSec?: number
}

export type LaidOutSegment<T extends LayoutSegmentInput = LayoutSegmentInput> = T & {
  outStartSec: number
  outEndSec: number
}

export function layoutSegments<T extends LayoutSegmentInput>(segments: T[]): LaidOutSegment<T>[] {
  let cursor = 0
  return segments.map((seg) => {
    const duration = Math.max(0.04, Number(seg.durationSec) || 0)
    const out = { ...seg, durationSec: duration, outStartSec: cursor, outEndSec: cursor + duration }
    cursor += duration
    return out
  })
}

export interface SourceCue {
  sourceStartSec: number
  sourceEndSec: number
  text: string
}

export interface OutputCue {
  startSec: number
  endSec: number
  text: string
}

/**
 * 把原片时间的字幕映射到成片时间：跨段的句子按段切开；落在被删镜头里的句子丢掉。
 * 没有原片入出点的段（整片生成）按"成片时间 = 原片时间"处理。
 */
export function mapCuesToOutput(cues: SourceCue[], laid: LaidOutSegment[]): OutputCue[] {
  const out: OutputCue[] = []
  const hasSourceTimes = laid.some((s) => s.sourceStartSec != null && s.sourceEndSec != null)
  for (const cue of cues) {
    if (!cue.text?.trim() || !(cue.sourceEndSec > cue.sourceStartSec)) continue
    if (!hasSourceTimes) {
      out.push({ startSec: cue.sourceStartSec, endSec: cue.sourceEndSec, text: cue.text })
      continue
    }
    for (const seg of laid) {
      if (seg.sourceStartSec == null || seg.sourceEndSec == null) continue
      const a = Math.max(cue.sourceStartSec, seg.sourceStartSec)
      const b = Math.min(cue.sourceEndSec, seg.sourceEndSec)
      if (b - a < 0.05) continue
      const scale = seg.durationSec / Math.max(0.001, seg.sourceEndSec - seg.sourceStartSec)
      out.push({
        startSec: seg.outStartSec + (a - seg.sourceStartSec) * scale,
        endSec: seg.outStartSec + (b - seg.sourceStartSec) * scale,
        text: cue.text
      })
    }
  }
  return out.sort((x, y) => x.startSec - y.startSec)
}

/** ffmpeg `volume` 的静音表达式：这些时间段里音量为 0（时间段外为 1） */
export function muteVolumeExpression(ranges: Array<{ start: number; end: number }>): string {
  const valid = ranges.filter((r) => r.end > r.start)
  if (valid.length === 0) return '1'
  const terms = valid.map((r) => `between(t,${r.start.toFixed(3)},${r.end.toFixed(3)})`).join('+')
  return `if(${terms},0,1)`
}

/**
 * 配音句子对齐到原台词时长：比原句长时加速（上限 2 倍，再长就截断）；短的不拉伸（留白自然）。
 */
export function dubTempo(dubSec: number, slotSec: number): number {
  if (!(dubSec > 0) || !(slotSec > 0)) return 1
  const ratio = dubSec / slotSec
  if (ratio <= 1.05) return 1
  return Math.min(2, Number(ratio.toFixed(3)))
}
