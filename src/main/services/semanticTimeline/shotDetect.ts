/**
 * ffmpeg 自适应切镜：select='gt(scene,T)' + showinfo 解析 pts_time。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdirSync } from 'fs'
import { join } from 'path'
import {
  adaptiveSceneThreshold,
  buildShotsFromCutPoints,
  parseSceneCutPtsTimes,
  singleShot,
  type MediaFacts,
  type ShotEvidence
} from '@shared/semanticTimeline'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'
import { runFfmpeg } from '../ffmpegRunner'

const execFileAsync = promisify(execFile)

export interface DetectShotsResult {
  shots: ShotEvidence[]
  cutPoints: number[]
  threshold: number
  method: 'scene' | 'fallback-single'
}

/** 场景切镜；失败或不切时回退为单镜头 */
export async function detectShots(
  fileAbs: string,
  facts: MediaFacts,
  options?: { threshold?: number; minShotSec?: number }
): Promise<DetectShotsResult> {
  const threshold = options?.threshold ?? adaptiveSceneThreshold(facts.durationSec)
  const ffmpeg = resolveFfmpegForSemantic()
  try {
    // ffmpeg 把 showinfo 打到 stderr；exit 0
    const { stderr } = await execFileAsync(
      ffmpeg,
      [
        '-hide_banner',
        '-i',
        fileAbs,
        '-vf',
        `select='gt(scene,${threshold})',showinfo`,
        '-an',
        '-f',
        'null',
        '-'
      ],
      {
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
        windowsHide: true
      }
    )
    const cutPoints = parseSceneCutPtsTimes(stderr || '')
    if (cutPoints.length === 0) {
      return {
        shots: singleShot(facts.durationSec, facts.fps),
        cutPoints: [],
        threshold,
        method: 'fallback-single'
      }
    }
    const shots = buildShotsFromCutPoints(cutPoints, facts.durationSec, facts.fps, {
      minShotSec: options?.minShotSec,
      confidence: 0.75
    })
    return { shots, cutPoints, threshold, method: 'scene' }
  } catch {
    return {
      shots: singleShot(facts.durationSec, facts.fps),
      cutPoints: [],
      threshold,
      method: 'fallback-single'
    }
  }
}

/** 为每个镜头抽取首/中/尾关键帧到 keyframesDir */
export async function extractShotKeyframes(
  fileAbs: string,
  shots: ShotEvidence[],
  keyframesDirAbs: string
): Promise<ShotEvidence[]> {
  mkdirSync(keyframesDirAbs, { recursive: true })
  const ffmpeg = resolveFfmpegForSemantic()
  const out: ShotEvidence[] = []
  for (const shot of shots) {
    const mid = (shot.range.start + shot.range.end) / 2
    const times = [
      { key: 'first' as const, t: shot.range.start + 0.01 },
      { key: 'middle' as const, t: mid },
      { key: 'last' as const, t: Math.max(shot.range.start, shot.range.end - 0.05) }
    ]
    const keyframes: ShotEvidence['keyframes'] = {}
    for (const { key, t } of times) {
      const rel = `${shot.id}.${key}.jpg`
      const abs = join(keyframesDirAbs, rel)
      try {
        await runFfmpeg(ffmpeg, [
          '-y',
          '-ss',
          String(Math.max(0, t)),
          '-i',
          fileAbs,
          '-frames:v',
          '1',
          '-q:v',
          '3',
          abs
        ])
        keyframes[key] = `evidence/keyframes/${rel}`
      } catch {
        /* 单帧失败不阻断 */
      }
    }
    out.push({ ...shot, keyframes })
  }
  return out
}
