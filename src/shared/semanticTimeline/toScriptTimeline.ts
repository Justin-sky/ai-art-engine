/**
 * 四轴语义时间线 → ScriptTimeline（镜头映射视频轨；台词映射字幕轨；纵向包装花字映射 overlay 轨）。
 */
import type { ScriptTimelineClip, ScriptTimelineDocument } from '../graph/scriptTimeline'
import {
  alignSubtitleWordsAndCues,
  hasInlineCueMarkup,
  syncTimelineCueAnchors
} from '../graph/timelineWordCue'
import type { SemanticTimeline, ShotEvidence, UtteranceEvidence } from './types'

export interface ToScriptTimelineInput {
  timeline: SemanticTimeline
  shots: ShotEvidence[]
  utterances?: UtteranceEvidence[]
  /** 源视频相对工程路径 */
  sourceRelativePath: string
  sourceAssetId?: string
}

export function semanticToScriptTimeline(input: ToScriptTimelineInput): ScriptTimelineDocument {
  const { timeline, shots, utterances = [], sourceRelativePath } = input
  const sourceId = `src.${timeline.source.assetId}`
  const clips: ScriptTimelineClip[] = []

  const activeShots = timeline.shots?.length
    ? timeline.shots.filter((s) => !s.removed)
    : shots.map((s) => ({
        id: s.id,
        range: s.range,
        sourceSegment: { start: s.range.start, end: s.range.end },
        layers: undefined
      }))

  for (const shot of activeShots) {
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
      sourceOffsetSec: shot.sourceSegment?.start ?? shot.range.start
    })

    for (const layer of shot.layers ?? []) {
      if (layer.kind === 'subtitle') continue
      const layerDur = Math.max(0.05, layer.end - layer.start)
      clips.push({
        id: `clip.layer.${shot.id}.${layer.id}`,
        track: 'overlay',
        sourceId,
        title: layer.text ? `[${layer.kind}] ${layer.text}` : `[${layer.kind}]`,
        ...(layer.text ? { text: layer.text } : {}),
        startSec: layer.start,
        durationSec: layerDur
      })
    }
  }

  const lines = timeline.dialogue?.length
    ? timeline.dialogue.map((d) => ({
        id: d.id,
        range: d.range,
        text: d.text,
        words: d.words
      }))
    : utterances

  for (const utt of lines) {
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
