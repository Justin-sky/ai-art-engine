/**
 * 转写 → 字幕轨片段：把语音识别返回的分段时间戳按配音片段的轨道位置对齐，生成字幕片段。
 *
 * 放在共享层是为了两条链路共用同一份口径：编辑器里的「转写生成字幕」按钮，
 * 以及 MCP 的 `timeline_edit`（Agent 让字幕跟着配音重新对齐）。文案一律由调用方拼。
 */
import type { TranscribeAudioSegment } from '../modelProvider'
import type { ScriptTimelineClip, ScriptTimelineTrackKind } from './scriptTimeline'

export type SubtitleClipIdFactory = (index: number) => string

/** 时间线总长的硬上限（与编辑器一致，用于钳制字幕起点） */
export const MAX_TIMELINE_SEC = 3600

function clampSec(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/**
 * 将一段转写结果对齐到配音片段时间轴，生成字幕轨片段。
 *
 * - 转写时间戳是**源文件时间**：先减去配音片段的 `sourceOffsetSec` 才是片段内相对时间，
 *   片段只取了源文件中段时字幕才不会整体平移（缺省 0 = 整段，与旧行为一致）；
 * - 只保留有文本、时长足够的片段；越界（超出配音片段或 3600s）自动裁剪；
 * - 时间戳缺失（start === end，如纯文本兜底）时整段对齐配音片段时长。
 */
export function buildSubtitleClipsFromTranscription(
  voice: Pick<ScriptTimelineClip, 'startSec' | 'durationSec'> & { sourceOffsetSec?: number },
  segments: TranscribeAudioSegment[],
  makeId: SubtitleClipIdFactory
): ScriptTimelineClip[] {
  const voiceStart = clampSec(voice.startSec, 0, MAX_TIMELINE_SEC)
  const voiceDuration = clampSec(voice.durationSec, 0, MAX_TIMELINE_SEC)
  const voiceEnd = voiceStart + voiceDuration
  const sourceOffset = Math.max(0, Number(voice.sourceOffsetSec) || 0)
  const MIN_DURATION = 0.1

  const clips: ScriptTimelineClip[] = []
  let index = 0
  for (const seg of segments) {
    const text = String(seg.text ?? '').trim()
    if (!text) continue

    const segStart = clampSec(seg.startSec, 0, MAX_TIMELINE_SEC)
    // 无时间戳（start === end，如 plain json 兜底）时整段对齐配音片段时长
    const segEnd =
      seg.endSec <= seg.startSec ? voiceDuration : clampSec(seg.endSec, segStart, MAX_TIMELINE_SEC)
    // 源文件时间 → 片段内相对时间 → 轨道绝对时间
    const relStart = Math.max(0, segStart - sourceOffset)
    const relEnd = Math.max(0, segEnd - sourceOffset)
    const start = voiceStart + relStart
    const end = voiceStart + relEnd
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
