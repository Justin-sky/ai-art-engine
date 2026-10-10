/**
 * 从视频抽音轨；人声分离若工程侧已有结果则写入 stems，否则保留混合原声并注明。
 */
import { mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { AudioStems } from '@shared/semanticTimeline'
import { runFfmpeg } from '../ffmpegRunner'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'

export async function extractMixedAudio(videoAbs: string, outWavAbs: string): Promise<boolean> {
  const ffmpeg = resolveFfmpegForSemantic()
  mkdirSync(join(outWavAbs, '..'), { recursive: true })
  try {
    await runFfmpeg(ffmpeg, [
      '-y',
      '-i',
      videoAbs,
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '16000',
      '-ac',
      '1',
      outWavAbs
    ])
    return existsSync(outWavAbs)
  } catch {
    return false
  }
}

/**
 * 组装 AudioStems。若调用方已通过工程 separateAudio 得到人声/伴奏相对路径，传入即可；
 * 否则 marked separated=false，保留混合原声。
 */
export function buildAudioStems(options: {
  mixedRel?: string
  vocalsRel?: string | null
  accompanimentRel?: string | null
  note?: string
}): AudioStems {
  const separated = !!(options.vocalsRel && options.accompanimentRel)
  return {
    mixed: options.mixedRel ?? null,
    vocals: options.vocalsRel ?? null,
    accompaniment: options.accompanimentRel ?? null,
    separated,
    note: options.note ?? (separated ? undefined : '人声未分离或分离失败，保留混合原声') // cjk-ok
  }
}
