/**
 * L0 原样重建：按镜头时间码裁切再拼接。
 * 优先 stream copy；失败时回退重编码。
 */
import { createHash } from 'crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { shotsToTrimSpecs, type ShotEvidence } from '@shared/semanticTimeline'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'
import { runFfmpeg } from '../ffmpegRunner'

export interface RoundtripResult {
  ok: boolean
  outputPath: string
  method: 'copy' | 'reencode'
  segmentCount: number
  /** 输出文件 sha1（整文件） */
  outputSha1: string
  error?: string
}

async function fileSha1(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    const stream = createReadStream(path)
    stream.on('data', (c) => h.update(c))
    stream.on('error', reject)
    stream.on('end', () => resolve(h.digest('hex')))
  })
}

/**
 * 按镜头裁切拼回。workDir 下写 segments/ 与 list.txt。
 */
export async function rebuildVideoFromShots(
  sourceAbs: string,
  shots: ShotEvidence[],
  outputAbs: string,
  workDir: string
): Promise<RoundtripResult> {
  const specs = shotsToTrimSpecs(shots)
  if (specs.length === 0) {
    return {
      ok: false,
      outputPath: outputAbs,
      method: 'copy',
      segmentCount: 0,
      outputSha1: '',
      error: 'no shots'
    }
  }
  mkdirSync(workDir, { recursive: true })
  const segDir = join(workDir, 'segments')
  mkdirSync(segDir, { recursive: true })
  const ffmpeg = resolveFfmpegForSemantic()
  const listLines: string[] = []

  // 先尝试 stream copy 裁切
  let method: 'copy' | 'reencode' = 'copy'
  try {
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!
      const segPath = join(segDir, `seg_${String(i).padStart(3, '0')}.mp4`)
      await runFfmpeg(ffmpeg, [
        '-y',
        '-ss',
        String(spec.startSec),
        '-i',
        sourceAbs,
        '-t',
        String(spec.durationSec),
        '-c',
        'copy',
        '-avoid_negative_ts',
        'make_zero',
        segPath
      ])
      // concat demuxer 需要正斜杠 escape
      const escaped = segPath.replace(/\\/g, '/').replace(/'/g, "'\\''")
      listLines.push(`file '${escaped}'`)
    }
    const listPath = join(workDir, 'concat.txt')
    writeFileSync(listPath, listLines.join('\n'), 'utf8')
    await runFfmpeg(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      outputAbs
    ])
  } catch {
    method = 'reencode'
    listLines.length = 0
    for (let i = 0; i < specs.length; i++) {
      const spec = specs[i]!
      const segPath = join(segDir, `seg_re_${String(i).padStart(3, '0')}.mp4`)
      await runFfmpeg(ffmpeg, [
        '-y',
        '-ss',
        String(spec.startSec),
        '-i',
        sourceAbs,
        '-t',
        String(spec.durationSec),
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        segPath
      ])
      const escaped = segPath.replace(/\\/g, '/').replace(/'/g, "'\\''")
      listLines.push(`file '${escaped}'`)
    }
    const listPath = join(workDir, 'concat_re.txt')
    writeFileSync(listPath, listLines.join('\n'), 'utf8')
    await runFfmpeg(ffmpeg, [
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      listPath,
      '-c',
      'copy',
      outputAbs
    ])
  }

  if (!existsSync(outputAbs)) {
    return {
      ok: false,
      outputPath: outputAbs,
      method,
      segmentCount: specs.length,
      outputSha1: '',
      error: 'output missing'
    }
  }
  const outputSha1 = await fileSha1(outputAbs)
  return {
    ok: true,
    outputPath: outputAbs,
    method,
    segmentCount: specs.length,
    outputSha1
  }
}

/** 抽帧序列并算逐帧 sha1（用于 L0 严格比对；重编码路径可能不完全一致） */
export async function extractFrameHashes(
  videoAbs: string,
  workDir: string,
  maxFrames = 90
): Promise<string[]> {
  mkdirSync(workDir, { recursive: true })
  const pattern = join(workDir, 'f_%05d.png')
  const ffmpeg = resolveFfmpegForSemantic()
  await runFfmpeg(ffmpeg, [
    '-y',
    '-i',
    videoAbs,
    '-vf',
    `select=not(mod(n\\,1))`,
    '-frames:v',
    String(maxFrames),
    pattern
  ])
  const hashes: string[] = []
  for (let i = 1; i <= maxFrames; i++) {
    const p = join(workDir, `f_${String(i).padStart(5, '0')}.png`)
    if (!existsSync(p)) break
    hashes.push(createHash('sha1').update(readFileSync(p)).digest('hex'))
  }
  return hashes
}

export function frameHashMatchRatio(a: string[], b: string[]): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let hit = 0
  for (let i = 0; i < n; i++) if (a[i] === b[i]) hit++
  return hit / n
}
