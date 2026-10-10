/**
 * 掩码合成：逐帧掩码 PNG 经 alphamerge + overlay 合回原帧，掩码外像素保持不变。
 */
import { mkdirSync } from 'fs'
import { join } from 'path'
import { runFfmpeg } from '../ffmpegRunner'
import { resolveFfmpegForSemantic } from './resolveFfmpeg'

export interface MaskCompositeInput {
  /** 原镜头视频 */
  sourceVideoAbs: string
  /** 替换内容视频（与源同尺寸/时长更佳） */
  replaceVideoAbs: string
  /** 掩码 PNG 序列目录，文件名 mask_00001.png … */
  maskDirAbs: string
  outputAbs: string
  startSec?: number
  durationSec?: number
}

/**
 * 合成公式：out = replace * mask + source * (1-mask)
 * 实现：把 replace 与 mask alphamerge 成带 alpha 的流，再 overlay 到 source。
 */
export async function compositeMaskedReplace(input: MaskCompositeInput): Promise<void> {
  const ffmpeg = resolveFfmpegForSemantic()
  mkdirSync(join(input.outputAbs, '..'), { recursive: true })
  const maskPattern = join(input.maskDirAbs, 'mask_%05d.png').replace(/\\/g, '/')
  const args = ['-y']
  if (typeof input.startSec === 'number') {
    args.push('-ss', String(input.startSec))
  }
  args.push('-i', input.sourceVideoAbs)
  if (typeof input.startSec === 'number') {
    args.push('-ss', String(input.startSec))
  }
  args.push('-i', input.replaceVideoAbs)
  args.push('-framerate', '30', '-i', maskPattern)
  if (typeof input.durationSec === 'number') {
    args.push('-t', String(input.durationSec))
  }
  args.push(
    '-filter_complex',
    '[1:v][2:v]alphamerge[rep];[0:v][rep]overlay=format=auto[outv]',
    '-map',
    '[outv]',
    '-map',
    '0:a?',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'copy',
    input.outputAbs
  )
  await runFfmpeg(ffmpeg, args)
}

/** 未改镜头：按时间码直拷（优先 stream copy） */
export async function copyShotSegment(
  sourceAbs: string,
  startSec: number,
  durationSec: number,
  outputAbs: string
): Promise<'copy' | 'reencode'> {
  const ffmpeg = resolveFfmpegForSemantic()
  try {
    await runFfmpeg(ffmpeg, [
      '-y',
      '-ss',
      String(startSec),
      '-i',
      sourceAbs,
      '-t',
      String(durationSec),
      '-c',
      'copy',
      '-avoid_negative_ts',
      'make_zero',
      outputAbs
    ])
    return 'copy'
  } catch {
    await runFfmpeg(ffmpeg, [
      '-y',
      '-ss',
      String(startSec),
      '-i',
      sourceAbs,
      '-t',
      String(durationSec),
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      outputAbs
    ])
    return 'reencode'
  }
}
