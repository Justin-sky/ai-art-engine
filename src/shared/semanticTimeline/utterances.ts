/**
 * 转写结果 → UtteranceEvidence（含词级降级标记）
 */
import { makeTimeRange, utteranceId } from './ids'
import type { UtteranceEvidence, WordTiming } from './types'

export interface TranscribeLikeSegment {
  startSec: number
  endSec: number
  text: string
  words?: Array<{ text: string; startSec: number; endSec: number; confidence?: number }>
}

export function segmentsToUtterances(
  segments: TranscribeLikeSegment[],
  fps: number,
  granularity: 'word' | 'sentence'
): UtteranceEvidence[] {
  return segments.map((seg, index) => {
    const words: WordTiming[] | undefined = seg.words?.map((w) => ({
      text: w.text,
      start: w.startSec,
      end: w.endSec,
      confidence: w.confidence
    }))
    const hasWords = (words?.length ?? 0) > 0
    return {
      id: utteranceId(index, seg.startSec),
      range: makeTimeRange(seg.startSec, seg.endSec, fps),
      text: seg.text,
      words: hasWords ? words : undefined,
      granularity: hasWords ? 'word' : granularity,
      confidence: hasWords ? 0.85 : 0.7
    }
  })
}
