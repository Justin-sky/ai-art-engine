/**
 * 人声 / 伴奏分离（隔离对白、去 BGM 再混音）：
 * - 默认：内置 ffmpeg 中置 / 侧置声道提取（`vocal.wav` = 人声近似、`instrumental.wav` = 伴奏近似），
 *   产物落 `Cache/Separated/<stem>/`，可直接上时间线 voice / music 轨后再混音导出；
 * - 可选：配置环境变量 `AUDIO_SEPARATION_API_URL` 后改走第三方 AI 分离服务
 *   （POST 原始音频 → JSON `{ vocal, instrumental }` 可下载 URL，落盘同目录）。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import {
  buildAudioSeparationFilter,
  buildAudioSeparationOutputName,
  parseThirdPartySeparationResponse,
  type AudioStemKind
} from '@shared/graph/audioSeparation'
import { findFfmpegBin } from './videoFrameService'

const execFileAsync = promisify(execFile)

/** 第三方分离服务地址（可配置接入位）：配置后优先于内置中置声道分离 */
function thirdPartyApiUrl(): string | undefined {
  return process.env.AUDIO_SEPARATION_API_URL?.trim() || undefined
}

export interface AudioSeparationResult {
  vocalRelativePath: string
  instrumentalRelativePath: string
  /** 使用的分离方式 */
  provider: 'ffmpeg-center' | 'third-party'
}

export async function separateAudioStems(params: {
  projectRoot: string
  relativePath: string
}): Promise<AudioSeparationResult> {
  const rel = params.relativePath.trim().replace(/\\/g, '/')
  const abs = join(params.projectRoot, rel)
  if (!existsSync(abs)) {
    throw new Error('音频源文件不存在或已被移动')
  }
  const stem = basename(abs, extname(abs))
  const outDir = join(params.projectRoot, 'Cache', 'Separated', stem)
  mkdirSync(outDir, { recursive: true })
  const outRel = `Cache/Separated/${stem}`

  const apiUrl = thirdPartyApiUrl()
  if (apiUrl) {
    return separateViaThirdParty({ abs, apiUrl, outDir, outRel })
  }
  return separateViaFfmpegCenter({ abs, outDir, outRel })
}

async function separateViaFfmpegCenter(params: {
  abs: string
  outDir: string
  outRel: string
}): Promise<AudioSeparationResult> {
  const bin = findFfmpegBin()
  const kinds: AudioStemKind[] = ['vocal', 'instrumental']
  for (const kind of kinds) {
    const outAbs = join(params.outDir, buildAudioSeparationOutputName(kind))
    try {
      await execFileAsync(
        bin,
        [
          '-y',
          '-i',
          params.abs,
          '-vn',
          '-af',
          buildAudioSeparationFilter(kind),
          '-ac',
          '2',
          '-ar',
          '44100',
          '-c:a',
          'pcm_s16le',
          outAbs
        ],
        { timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }
      )
    } catch (err) {
      const stderr = err instanceof Error ? err.message : String(err)
      throw new Error(`ffmpeg 分离 ${kind === 'vocal' ? '人声' : '伴奏'} 失败：${stderr.slice(0, 300)}`)
    }
  }
  return {
    vocalRelativePath: `${params.outRel}/vocal.wav`,
    instrumentalRelativePath: `${params.outRel}/instrumental.wav`,
    provider: 'ffmpeg-center'
  }
}

async function separateViaThirdParty(params: {
  abs: string
  apiUrl: string
  outDir: string
  outRel: string
}): Promise<AudioSeparationResult> {
  let response: Response
  try {
    response = await fetch(params.apiUrl, {
      method: 'POST',
      body: await import('fs').then((m) => m.readFileSync(params.abs)),
      headers: { 'Content-Type': 'application/octet-stream' },
      signal: AbortSignal.timeout(10 * 60_000)
    })
  } catch (err) {
    throw new Error(`第三方分离服务不可用：${err instanceof Error ? err.message : String(err)}`)
  }
  if (!response.ok) {
    throw new Error(`第三方分离服务响应异常：HTTP ${response.status}`)
  }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new Error('第三方分离服务响应不是合法 JSON')
  }
  const { vocal, instrumental } = parseThirdPartySeparationResponse(body)
  if (!vocal || !instrumental) {
    throw new Error('第三方分离服务响应缺少 vocal / instrumental 字段')
  }
  await Promise.all([
    downloadStem(vocal, join(params.outDir, buildAudioSeparationOutputName('vocal'))),
    downloadStem(instrumental, join(params.outDir, buildAudioSeparationOutputName('instrumental')))
  ])
  return {
    vocalRelativePath: `${params.outRel}/vocal.wav`,
    instrumentalRelativePath: `${params.outRel}/instrumental.wav`,
    provider: 'third-party'
  }
}

async function downloadStem(source: string, outAbs: string): Promise<void> {
  if (source.startsWith('data:')) {
    const comma = source.indexOf(',')
    if (comma < 0) throw new Error('第三方分离结果 data URL 非法')
    writeFileSync(outAbs, Buffer.from(source.slice(comma + 1), 'base64'))
    return
  }
  const res = await fetch(source, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!res.ok) throw new Error(`下载分离产物失败：HTTP ${res.status}`)
  writeFileSync(outAbs, Buffer.from(await res.arrayBuffer()))
}
