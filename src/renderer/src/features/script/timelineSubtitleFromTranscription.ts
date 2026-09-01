/**
 * 配音转字幕：把语音识别（音频转写）返回的分段时间戳，
 * 按配音片段的轨道起点偏移，生成对齐的字幕轨片段。
 */
import type {
  ScriptTimelineClip,
  ScriptTimelineTrackKind
} from '@shared/graph/scriptTimeline'
import type { TranscribeAudioSegment } from '@shared/modelProvider'

export type SubtitleClipIdFactory = (index: number) => string

/** 时间线总长的硬上限（与编辑器一致，用于钳制字幕起点） */
export const MAX_TIMELINE_SEC = 3600

function clampSec(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 将一段转写结果对齐到配音片段时间轴，生成字幕轨片段。
 * 只保留有文本、时长足够短的片段；越界（超出配音片段或 3600s）自动裁剪。
 */
export function buildSubtitleClipsFromTranscription(
  voice: Pick<ScriptTimelineClip, 'startSec' | 'durationSec'>,
  segments: TranscribeAudioSegment[],
  makeId: SubtitleClipIdFactory
): ScriptTimelineClip[] {
  const voiceStart = clampSec(voice.startSec, 0, MAX_TIMELINE_SEC)
  const voiceDuration = clampSec(voice.durationSec, 0, MAX_TIMELINE_SEC)
  const voiceEnd = voiceStart + voiceDuration
  const MIN_DURATION = 0.1

  const clips: ScriptTimelineClip[] = []
  let index = 0
  for (const seg of segments) {
    const text = String(seg.text ?? '').trim()
    if (!text) continue

    const segStart = clampSec(seg.startSec, 0, MAX_TIMELINE_SEC)
    // 无时间戳（start === end，如 plain json 兜底）时整段对齐配音片段时长
    const segEnd =
      seg.endSec <= seg.startSec
        ? voiceDuration
        : clampSec(seg.endSec, segStart, MAX_TIMELINE_SEC)
    // 相对配音片段的时间 → 轨道绝对时间
    const start = voiceStart + segStart
    const end = voiceStart + segEnd
    const trimmedStart = clampSec(start, 0, MAX_TIMELINE_SEC)
    const trimmedEnd = clampSec(end, trimmedStart, voiceEnd)
    const duration = trimmedEnd - trimmedStart
    if (duration < MIN_DURATION) continue

    clips.push({
      id: makeId(index++),
      track: 'subtitle' as ScriptTimelineTrackKind,
      sourceId: `subtitle:transcribe:${Math.floor(start * 1000)}`,
      title: text,
      text,
      startSec: trimmedStart,
      durationSec: duration
    })
  }
  return clips
}
