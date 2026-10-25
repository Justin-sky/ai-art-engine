/**
 * 语义层 → ScriptTimeline（生产层首期目标）。
 * 镜头直映射视频轨；话语 → 字幕；导演命令可写进 clip 元数据（title/note）。
 */
import type { ScriptTimelineClip, ScriptTimelineDocument } from '../graph/scriptTimeline'
import {
  alignSubtitleWordsAndCues,
  hasInlineCueMarkup,
  syncTimelineCueAnchors
} from '../graph/timelineWordCue'
import type { ProductionCommand } from './compiler'
import type { SemanticTimeline, ShotEvidence, UtteranceEvidence } from './types'

export interface ToScriptTimelineInput {
  timeline: SemanticTimeline
  shots: ShotEvidence[]
  utterances?: UtteranceEvidence[]
  commands?: ProductionCommand[]
  /** 源视频相对工程路径 */
  sourceRelativePath: string
  sourceAssetId?: string
}

export function semanticToScriptTimeline(input: ToScriptTimelineInput): ScriptTimelineDocument {
  const { timeline, shots, utterances = [], commands = [], sourceRelativePath } = input
  const sourceId = `src.${timeline.source.assetId}`
  const clips: ScriptTimelineClip[] = []

  for (const shot of shots) {
    const dur = Math.max(0.01, shot.range.end - shot.range.start)
    clips.push({
      id: `clip.${shot.id}`,
      track: 'video',
      sourceId,
      title: shot.id,
      relativePath: sourceRelativePath,
      assetId: input.sourceAssetId ?? timeline.source.assetId,
      startSec: shot.range.start,
      durationSec: dur,
      sourceOffsetSec: shot.range.start
    })
  }

  for (const utt of utterances) {
    const dur = Math.max(0.05, utt.range.end - utt.range.start)
    const relWords = utt.words?.map((w) => ({
      text: w.text,
      startSec: Math.max(0, w.start - utt.range.start),
      endSec: Math.max(0.01, Math.min(dur, w.end - utt.range.start)),
      ...(typeof w.confidence === 'number' ? { confidence: w.confidence } : {})
    }))
    const aligned = alignSubtitleWordsAndCues({
      text: utt.text,
      durationSec: dur,
      existingWords: relWords
    })
    const displayText = aligned.cleanText || utt.text
    clips.push({
      id: `clip.${utt.id}`,
      track: 'subtitle',
      sourceId,
      title: displayText.slice(0, 40),
      text: displayText,
      ...(hasInlineCueMarkup(utt.text) ? { rawCueText: utt.text } : {}),
      ...(aligned.words.length ? { words: aligned.words } : {}),
      startSec: utt.range.start,
      durationSec: dur
    })
  }

  // 数字运镜等命令：用 overlay 轨占位标记（执行器读 title 前缀）
  for (const cmd of commands) {
    if (
      !cmd.kind.startsWith('camera.') &&
      !cmd.kind.startsWith('light.') &&
      !cmd.kind.startsWith('grade.')
    ) {
      continue
    }
    clips.push({
      id: `clip.cmd.${cmd.kind}.${cmd.start}`,
      track: 'overlay',
      sourceId,
      title: `${cmd.kind}|${JSON.stringify(cmd.params)}`,
      startSec: cmd.start,
      durationSec: Math.max(0.05, cmd.end - cmd.start),
      opacity: 0
    })
  }

  const synced = syncTimelineCueAnchors(clips)

  return {
    clips: synced.clips,
    sources: [
      {
        id: sourceId,
        title: timeline.source.assetId,
        relativePath: sourceRelativePath,
        assetId: input.sourceAssetId ?? timeline.source.assetId,
        mediaKind: 'video'
      }
    ],
    settings: {
      durationSec: timeline.source.duration,
      exportWidth: timeline.source.width,
      exportHeight: timeline.source.height,
      exportFps: timeline.source.fps
    }
  }
}
