/**
 * 人声 / 伴奏分离（隔离对白、去 BGM 再混音）：
 * - 默认：内置 ffmpeg 中置 / 侧置声道提取（`vocal.wav` = 人声近似、`instrumental.wav` = 伴奏近似），
 *   产物落 `Cache/Separated/<stem>/`，可直接上时间线 voice / music 轨后再混音导出；
 * - 可选：配置环境变量 `AUDIO_SEPARATION_API_URL` 后改走第三方 AI 分离服务
 *   （POST 原始音频 → JSON `{ vocal, instrumental }` 可下载 URL，落盘同目录）。
 */
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { basename, extname, join } from 'path'
import {
  buildAudioSeparationFilter,
  buildAudioSeparationOutputName,
  parseThirdPartySeparationResponse,
  type AudioStemKind
} from '@shared/graph/audioSeparation'
import { findFfmpegBin } from './videoFrameService'
import { resolveFfmpegForSemantic } from './semanticTimeline/resolveFfmpeg'

function resolveAudioFfmpegBin(): string {
  try {
    return findFfmpegBin()
  } catch {
    return resolveFfmpegForSemantic()
  }
}

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

function findWavDataOffset(buf: Buffer): number {
  if (buf.length < 44) return -1
  let offset = 12
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    if (id === 'data') return offset + 8
    offset += 8 + size + (size % 2)
  }
  return 44
}

/**
 * 检测是否需要退回单声道频段陷波分离：
 * - 双声道同相 (L≈R)：`instrumental` 左声道相消为 ~0（`rmsInst < 0.03 * rmsVoc`）
 * - 单声道输入 (无 c1)：`pan` 把 c1 当 0，导致 `inst_L === voc_L`（未消掉任何中置人声且右声道反相）
 */
function needsMonoBandFallback(instAbs: string, vocAbs: string): boolean {
  try {
    if (!existsSync(instAbs) || !existsSync(vocAbs)) return false
    const instBuf = readFileSync(instAbs)
    const vocBuf = readFileSync(vocAbs)
    const instStart = findWavDataOffset(instBuf)
    const vocStart = findWavDataOffset(vocBuf)
    if (instStart < 0 || vocStart < 0) return false
    const maxBytes = Math.min(instBuf.length - instStart, vocBuf.length - vocStart)
    if (maxBytes < 64) return false
    // Step by multiples of 4 bytes (stereo 16-bit frame: L=0..1, R=2..3)
    const frameStep = Math.max(1, Math.floor(maxBytes / 4 / 3000)) * 4
    let vocSq = 0
    let instSq = 0
    let diffSq = 0
    let count = 0
    for (let rel = 0; rel + 4 <= maxBytes; rel += frameStep) {
      const vL = vocBuf.readInt16LE(vocStart + rel) / 32768
      const iL = instBuf.readInt16LE(instStart + rel) / 32768
      vocSq += vL * vL
      instSq += iL * iL
      const d = vL - iL
      diffSq += d * d
      count += 1
    }
    if (count === 0) return false
    const rmsVoc = Math.sqrt(vocSq / count)
    const rmsInst = Math.sqrt(instSq / count)
    const rmsDiff = Math.sqrt(diffSq / count)
    if (rmsVoc < 4e-4) return false
    return rmsInst < Math.max(4e-4, 0.03 * rmsVoc) || rmsDiff < 0.02 * rmsVoc
  } catch {
    return false
  }
}

async function runStemSeparationPass(
  bin: string,
  abs: string,
  outDir: string,
  monoFallback: boolean
): Promise<void> {
  const kinds: AudioStemKind[] = ['vocal', 'instrumental']
  for (const kind of kinds) {
    const outAbs = join(outDir, buildAudioSeparationOutputName(kind))
    try {
      await execFileAsync(
        bin,
        [
          '-y',
          '-i',
          abs,
          '-vn',
          '-af',
          buildAudioSeparationFilter(kind, monoFallback),
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
      throw new Error(
        `ffmpeg 分离 ${kind === 'vocal' ? '人声' : '伴奏'} 失败：${stderr.slice(0, 300)}`
      )
    }
  }
}

async function separateViaFfmpegCenter(params: {
  abs: string
  outDir: string
  outRel: string
}): Promise<AudioSeparationResult> {
  const bin = resolveAudioFfmpegBin()
  await runStemSeparationPass(bin, params.abs, params.outDir, false)
  // 单声道或双声道同相视频经 (L-R)/2 会相消为死寂静音；自动切换为语音频段陷波分离
  const instAbs = join(params.outDir, buildAudioSeparationOutputName('instrumental'))
  const vocAbs = join(params.outDir, buildAudioSeparationOutputName('vocal'))
  if (needsMonoBandFallback(instAbs, vocAbs)) {
    await runStemSeparationPass(bin, params.abs, params.outDir, true)
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
