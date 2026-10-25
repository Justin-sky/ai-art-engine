/**
 * B 站亿级鬼畜（《敢杀我的马？！》BV1yt4y1Q7SS / 人力 VOCALOID / VocalShifter 同款）
 * TD-PSOLA 原声拉长变调成歌声合成引擎：
 *
 * 声学原理：
 * 1) 为什么单纯用 FFmpeg `asetrate + atempo` 处理中文对白听起来像「慢放说话」而不是「唱歌」？
 *    因为中文是声调语言（四声急剧下滑/拐弯），`asetrate` 只是把整条下滑曲线平移了几个半音，声调依然在下滑！
 * 2) 本模块采用时域基音同步叠加法（TD-PSOLA, Time-Domain Pitch-Synchronous Overlap-Add）：
 *    - 逐帧（5ms）通过归一化自相关测定演员真实基音周期 T0(t)，自适应识别男女声中位调性中心（保护原始声道共振峰与音色辨识度）；
 *    - 自动剥离片段首尾静音空隙，确保句尾拉长 100% 落在最后一个实词的饱满元音核（Vowel Nucleus）上；
 *    - 清辅音与字头前 42ms 保留 22% 原始声调瞬态（保证中文字字清晰、绝不倒字），韵腹与韵尾 100% 锁定到五声音阶目标乐音频率（彻底抹平说话降调，变成固定音高歌声）；
 *    - 自动将每句台词编排为 2~4 个五声音阶旋律音符（如 Do-Mi-Sol-La~~~~），并将句尾元音核拉长 2.0x~3.0x，注入 65ms 滑音（Portamento）与 5.6Hz 自然歌唱颤音（Vibrato）！
 */
import { execFileSync } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clampClipFreezeTailSec,
  clampClipPitchSemitones,
  clampClipSpeed,
  isTimelineVoiceEffectId,
  type TimelineExportClip
} from '@shared/graph'
import { projectService } from './projectService'

const SINGING_SAMPLE_RATE = 44100

interface CachedSourcePcm {
  key: string
  samples: Float32Array
}

const sourcePcmMemoryCache = new Map<string, CachedSourcePcm>()

function getVocalsCacheDir(): string {
  const dir = projectService.isOpen()
    ? join(projectService.getRoot(), 'Cache', 'vocals')
    : join(tmpdir(), 'aiart-vocals')
  mkdirSync(dir, { recursive: true })
  return dir
}

function loadSourceMonoPcm(ffmpegBin: string, mediaPath: string): Float32Array | null {
  try {
    if (!existsSync(mediaPath)) return null
    const st = statSync(mediaPath)
    const cacheKey = `${mediaPath}:${st.mtimeMs}:${st.size}`
    const mem = sourcePcmMemoryCache.get(cacheKey)
    if (mem) return mem.samples

    const hash = createHash('md5').update(cacheKey).digest('hex').slice(0, 16)
    const cacheDir = getVocalsCacheDir()
    const cleanWavPath = join(cacheDir, `src-clean-${hash}.wav`)
    if (!existsSync(cleanWavPath)) {
      execFileSync(
        ffmpegBin,
        [
          '-y',
          '-i',
          mediaPath,
          '-vn',
          '-af',
          'highpass=f=155,lowpass=f=7600,afftdn=nr=12:nf=-28',
          '-ac',
          '1',
          '-ar',
          String(SINGING_SAMPLE_RATE),
          '-f',
          'wav',
          cleanWavPath
        ],
        { stdio: 'ignore', windowsHide: true, timeout: 60000 }
      )
    }
    if (!existsSync(cleanWavPath)) return null
    const buf = readFileSync(cleanWavPath)
    let offset = 12
    while (offset < buf.length - 8) {
      const id = buf.toString('ascii', offset, offset + 4)
      const size = buf.readUInt32LE(offset + 4)
      if (id === 'data') {
        const len = Math.min(Math.floor(size / 2), Math.floor((buf.length - offset - 8) / 2))
        const samples = new Float32Array(len)
        for (let i = 0; i < len; i++) {
          samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768
        }
        if (sourcePcmMemoryCache.size >= 4) {
          const oldestKey = sourcePcmMemoryCache.keys().next().value
          if (oldestKey) sourcePcmMemoryCache.delete(oldestKey)
        }
        sourcePcmMemoryCache.set(cacheKey, { key: cacheKey, samples })
        return samples
      }
      offset += 8 + size
    }
    return null
  } catch {
    return null
  }
}

/**
 * 自动裁除切片窗口首尾的静音空隙，确保句尾元音拉长 100% 落在最后一个发声词的元音核上，绝不拉长静音呼吸声。
 */
function trimActiveSpeechSlice(rawSlice: Float32Array, sr: number): Float32Array {
  const winSamples = Math.floor(sr * 0.025)
  const numWins = Math.floor(rawSlice.length / winSamples)
  if (numWins < 6) return rawSlice

  const rmsList = new Float32Array(numWins)
  let peakRms = 0
  for (let w = 0; w < numWins; w++) {
    let sum = 0
    const base = w * winSamples
    for (let i = 0; i < winSamples; i++) {
      const s = rawSlice[base + i]!
      sum += s * s
    }
    const r = Math.sqrt(sum / winSamples)
    rmsList[w] = r
    if (r > peakRms) peakRms = r
  }
  if (peakRms < 0.01) return rawSlice

  const startThresh = Math.max(0.012, peakRms * 0.15)
  const endThresh = Math.max(0.014, peakRms * 0.18)
  let firstWin = 0
  while (firstWin < numWins - 1 && rmsList[firstWin]! < startThresh) {
    firstWin++
  }
  let lastWin = numWins - 1
  while (lastWin > firstWin + 2 && rmsList[lastWin]! < endThresh) {
    lastWin--
  }

  const preRoll = Math.floor(sr * 0.035)
  const postRoll = Math.floor(sr * 0.055)
  const s0 = Math.max(0, firstWin * winSamples - preRoll)
  const s1 = Math.min(rawSlice.length, (lastWin + 1) * winSamples + postRoll)
  if (s1 - s0 < Math.floor(sr * 0.16)) return rawSlice
  return rawSlice.subarray(s0, s1)
}

function detectPitchFrame(
  signal: Float32Array,
  centerIdx: number,
  sr: number
): { voiced: boolean; periodSamples: number; rms: number } {
  const minF0 = 90
  const maxF0 = 420
  const minLag = Math.floor(sr / maxF0)
  const maxLag = Math.ceil(sr / minF0)
  const winLen = maxLag * 2
  const start = Math.max(0, centerIdx - Math.floor(winLen / 2))
  if (start + winLen >= signal.length) {
    return { voiced: false, periodSamples: Math.round(sr / 180), rms: 0 }
  }

  let energy = 0
  let zeroCrossings = 0
  for (let i = 0; i < winLen; i++) {
    const s = signal[start + i]!
    energy += s * s
    if (i > 0 && signal[start + i - 1]! >= 0 !== s >= 0) {
      zeroCrossings++
    }
  }
  const rms = Math.sqrt(energy / winLen)
  const zcr = zeroCrossings / winLen
  if (rms < 0.013 || zcr > 0.21) {
    return { voiced: false, periodSamples: Math.round(sr / 180), rms }
  }

  let bestLag = Math.round(sr / 180)
  let bestCorr = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    let e1 = 0
    let e2 = 0
    for (let i = 0; i < maxLag; i++) {
      const a = signal[start + i]!
      const b = signal[start + i + lag]!
      sum += a * b
      e1 += a * a
      e2 += b * b
    }
    const corr = sum / (Math.sqrt(e1 * e2) + 1e-8)
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }

  return {
    voiced: bestCorr >= 0.55,
    periodSamples: bestLag,
    rms
  }
}

export interface VocalSingingNote {
  srcStartRatio: number
  srcEndRatio: number
  targetDurationSec: number
  semitoneOffset: number
  sustainVowel?: boolean
  vibratoSemitones?: number
}

/**
 * 构建单个片段的五声音阶歌唱音符序列（前段按拍走旋律音阶 + 尾字元音慢放拉长颤音）：
 */
function buildMelodyNotesForClip(
  playDur: number,
  speed: number,
  pitchSemitones: number,
  phraseIndex: number
): VocalSingingNote[] {
  const shiftBias = Math.max(-4, Math.min(8, Math.round(pitchSemitones * 0.65)))
  const isAlreadySlowStretched = speed < 0.82

  // 1) 短促鬼畜复读卡点或已单独拆出的尾音拉长镜头（如 0.24s / 0.48s / 0.80s 慢放段）：
  if (playDur <= 0.72 || isAlreadySlowStretched) {
    const baseNote =
      Math.abs(pitchSemitones) >= 0.5
        ? Math.max(-3, Math.min(9, Math.round(pitchSemitones)))
        : ([4, 7, 2, 9, 4, 7][phraseIndex % 6] ?? 4)
    if (playDur <= 0.36) {
      return [
        {
          srcStartRatio: 0,
          srcEndRatio: 1,
          targetDurationSec: playDur,
          semitoneOffset: baseNote,
          sustainVowel: true,
          vibratoSemitones: 0.32
        }
      ]
    }
    // 两音阶上扬拖腔（如“农~村~~~的~呀~~~~~~” / “有~钱~~~的~~~~~~”）
    const d1 = Number((playDur * 0.38).toFixed(3))
    const d2 = Number(Math.max(0.08, playDur - d1).toFixed(3))
    return [
      {
        srcStartRatio: 0,
        srcEndRatio: 0.52,
        targetDurationSec: d1,
        semitoneOffset: Math.max(-3, baseNote - 2),
        sustainVowel: false,
        vibratoSemitones: 0.16
      },
      {
        srcStartRatio: 0.48,
        srcEndRatio: 1.0,
        targetDurationSec: d2,
        semitoneOffset: baseNote,
        sustainVowel: true,
        vibratoSemitones: 0.42
      }
    ]
  }

  // 2) 中等长度乐句（0.73s ~ 1.65s）：三音符五声音阶旋律 + 尾音拉长歌唱
  const THREE_NOTE_PATTERNS: ReadonlyArray<readonly [number, number, number]> = [
    [2, 4, 7], // Re -> Mi -> Sol~~~~
    [4, 7, 9], // Mi -> Sol -> La~~~~
    [4, 7, 4], // Mi -> Sol -> Mi~~~~
    [0, 4, 7], // Do -> Mi -> Sol~~~~
    [7, 4, 2], // Sol -> Mi -> Re~~~~
    [2, 7, 9] // Re -> Sol -> La~~~~
  ]
  if (playDur < 1.65) {
    const pat = THREE_NOTE_PATTERNS[phraseIndex % THREE_NOTE_PATTERNS.length]!
    const d1 = Number((playDur * 0.32).toFixed(3))
    const d2 = Number((playDur * 0.26).toFixed(3))
    const d3 = Number(Math.max(0.12, playDur - d1 - d2).toFixed(3))
    return [
      {
        srcStartRatio: 0.0,
        srcEndRatio: 0.4,
        targetDurationSec: d1,
        semitoneOffset: pat[0] + shiftBias,
        vibratoSemitones: 0.14
      },
      {
        srcStartRatio: 0.4,
        srcEndRatio: 0.7,
        targetDurationSec: d2,
        semitoneOffset: pat[1] + shiftBias,
        vibratoSemitones: 0.18
      },
      {
        srcStartRatio: 0.7,
        srcEndRatio: 1.0,
        targetDurationSec: d3,
        semitoneOffset: pat[2] + shiftBias,
        sustainVowel: true,
        vibratoSemitones: 0.42
      }
    ]
  }

  // 3) 完整长句（>= 1.65s）：四音符五声音阶起承转合旋律 + 句尾核心词拉长高歌
  const FOUR_NOTE_PATTERNS: ReadonlyArray<readonly [number, number, number, number]> = [
    [0, 4, 7, 9], // Do -> Mi -> Sol -> La~~~~
    [2, 4, 7, 4], // Re -> Mi -> Sol -> Mi~~~~
    [4, 7, 9, 7], // Mi -> Sol -> La -> Sol~~~~
    [0, 2, 4, 7], // Do -> Re -> Mi -> Sol~~~~
    [7, 4, 2, 4], // Sol -> Mi -> Re -> Mi~~~~
    [2, 4, 7, 9] // Re -> Mi -> Sol -> La~~~~
  ]
  const pat = FOUR_NOTE_PATTERNS[phraseIndex % FOUR_NOTE_PATTERNS.length]!
  const d1 = Number((playDur * 0.27).toFixed(3))
  const d2 = Number((playDur * 0.23).toFixed(3))
  const d3 = Number((playDur * 0.18).toFixed(3))
  const d4 = Number(Math.max(0.15, playDur - d1 - d2 - d3).toFixed(3))
  return [
    {
      srcStartRatio: 0.0,
      srcEndRatio: 0.34,
      targetDurationSec: d1,
      semitoneOffset: pat[0] + shiftBias,
      vibratoSemitones: 0.14
    },
    {
      srcStartRatio: 0.34,
      srcEndRatio: 0.6,
      targetDurationSec: d2,
      semitoneOffset: pat[1] + shiftBias,
      vibratoSemitones: 0.16
    },
    {
      srcStartRatio: 0.6,
      srcEndRatio: 0.78,
      targetDurationSec: d3,
      semitoneOffset: pat[2] + shiftBias,
      vibratoSemitones: 0.2
    },
    {
      srcStartRatio: 0.78,
      srcEndRatio: 1.0,
      targetDurationSec: d4,
      semitoneOffset: pat[3] + shiftBias,
      sustainVowel: true,
      vibratoSemitones: 0.44
    }
  ]
}

export function synthesizeVocalShifterSinging(
  srcMono: Float32Array,
  sr: number,
  notes: VocalSingingNote[]
): { left: Float32Array; right: Float32Array } {
  const totalOutSec = notes.reduce((acc, n) => acc + n.targetDurationSec, 0)
  const totalOutSamples = Math.max(1, Math.floor(totalOutSec * sr))
  const outMono = new Float32Array(totalOutSamples)

  const hop = Math.floor(sr * 0.005)
  const numFrames = Math.max(1, Math.ceil(srcMono.length / hop))
  const framePeriods = new Float32Array(numFrames)
  const frameVoiced = new Uint8Array(numFrames)
  const frameRms = new Float32Array(numFrames)

  const voicedPeriods: number[] = []
  let lastValidPeriod = Math.round(sr / 185)
  for (let f = 0; f < numFrames; f++) {
    const info = detectPitchFrame(srcMono, f * hop, sr)
    frameVoiced[f] = info.voiced ? 1 : 0
    frameRms[f] = info.rms
    if (info.voiced) {
      if (info.periodSamples > lastValidPeriod * 1.65) {
        framePeriods[f] = Math.round(info.periodSamples / 2)
      } else if (info.periodSamples < lastValidPeriod * 0.58) {
        framePeriods[f] = Math.round(info.periodSamples * 2)
      } else {
        framePeriods[f] = info.periodSamples
      }
      lastValidPeriod = framePeriods[f]!
      voicedPeriods.push(lastValidPeriod)
    } else {
      framePeriods[f] = lastValidPeriod
    }
  }

  voicedPeriods.sort((a, b) => a - b)
  const medianPeriod =
    voicedPeriods.length > 0
      ? voicedPeriods[Math.floor(voicedPeriods.length * 0.5)]!
      : Math.round(sr / 185)
  const rawMedianHz = sr / Math.max(60, medianPeriod)
  // 自适应匹配男声（F3=174.61Hz）与女声/高音（C4=261.63Hz）自然真声调性中心
  const baseKeyHz = rawMedianHz > 235 ? 261.63 : 174.61

  const findBestVowelCoreIdx = (sIdx: number, eIdx: number): number => {
    let bestF = Math.floor(((sIdx + eIdx) * 0.55) / hop)
    let bestScore = -1
    const fStart = Math.max(0, Math.floor(sIdx / hop))
    const fEnd = Math.min(numFrames - 1, Math.floor(eIdx / hop))
    for (let f = fStart; f <= fEnd; f++) {
      if (frameVoiced[f]) {
        const relPos = (f - fStart) / Math.max(1, fEnd - fStart)
        const posWeight = relPos >= 0.22 && relPos <= 0.88 ? 1.25 : 0.75
        const score = frameRms[f]! * posWeight
        if (score > bestScore) {
          bestScore = score
          bestF = f
        }
      }
    }
    const margin = Math.min(800, Math.floor(srcMono.length * 0.2))
    return Math.min(Math.max(0, srcMono.length - margin), Math.max(margin, bestF * hop))
  }

  let outWriteCursor = 0
  let currentTargetFreq = baseKeyHz

  for (const note of notes) {
    const srcStartIdx = Math.floor(note.srcStartRatio * srcMono.length)
    const srcEndIdx = Math.min(srcMono.length - 1, Math.floor(note.srcEndRatio * srcMono.length))
    const srcLen = Math.max(1, srcEndIdx - srcStartIdx)
    const noteOutSamples = Math.floor(note.targetDurationSec * sr)
    const noteOutStart = outWriteCursor
    const noteOutEnd = Math.min(totalOutSamples, noteOutStart + noteOutSamples)

    const targetNoteFreq = baseKeyHz * Math.pow(2, note.semitoneOffset / 12)
    const vibSemitones = note.vibratoSemitones ?? (note.sustainVowel ? 0.4 : 0.15)
    const vowelCoreIdx = findBestVowelCoreIdx(srcStartIdx, srcEndIdx)
    const srcDurSec = srcLen / sr
    const isLongStretch = Boolean(note.sustainVowel) || note.targetDurationSec > srcDurSec * 1.25

    while (outWriteCursor < noteOutEnd) {
      const localOutSamples = outWriteCursor - noteOutStart
      const localOutSec = localOutSamples / sr
      const progress = localOutSamples / Math.max(1, noteOutSamples)

      // 65ms 歌唱滑音（Portamento）
      currentTargetFreq += (targetNoteFreq - currentTargetFreq) * 0.14

      // 5.6Hz 自然歌唱颤音（Vibrato）
      const vibRamp = Math.min(1, Math.max(0, (localOutSec - 0.07) / 0.15))
      const vibFactor = Math.pow(
        2,
        (vibSemitones * vibRamp * Math.sin(2 * Math.PI * 5.6 * localOutSec)) / 12
      )

      let readIdx: number
      let inSustainedVowel = false
      if (isLongStretch) {
        const attackDurSec = Math.min(srcDurSec * 0.68, note.targetDurationSec * 0.42)
        if (localOutSec < attackDurSec) {
          const p = localOutSec / Math.max(0.01, attackDurSec)
          readIdx = Math.floor(srcStartIdx + p * (vowelCoreIdx - srcStartIdx))
        } else {
          inSustainedVowel = true
          const sustainSec = localOutSec - attackDurSec
          const scanRadius = Math.min(Math.floor(sr * 0.016), Math.floor(srcLen * 0.18))
          const scanOffset = Math.round(Math.sin(2 * Math.PI * 3.0 * sustainSec) * scanRadius)
          const margin = Math.min(600, Math.floor(srcMono.length * 0.15))
          readIdx = Math.min(
            Math.max(0, srcMono.length - margin),
            Math.max(margin, vowelCoreIdx + scanOffset)
          )
        }
      } else {
        readIdx = Math.floor(srcStartIdx + progress * srcLen)
      }

      const fIdx = Math.min(numFrames - 1, Math.max(0, Math.floor(readIdx / hop)))
      const srcPeriod = Math.max(45, Math.min(520, Math.round(framePeriods[fIdx]!)))
      const srcFreq = sr / srcPeriod
      const isVoiced = frameVoiced[fIdx] === 1 || inSustainedVowel

      // 字头前 42ms 保留 22% 原始声调包络确保咬字清晰，随后 100% 锁定到目标旋律音符
      const pitchLockStrength = inSustainedVowel
        ? 1.0
        : Math.min(1.0, 0.78 + (localOutSec / 0.042) * 0.22)
      const desiredFreq = isVoiced
        ? Math.pow(srcFreq, 1 - pitchLockStrength) *
          Math.pow(currentTargetFreq * vibFactor, pitchLockStrength)
        : srcFreq
      const targetPeriod = Math.max(45, Math.min(520, Math.round(sr / desiredFreq)))

      let peakIdx = readIdx
      if (isVoiced) {
        let maxVal = -1e9
        const searchHalf = Math.floor(srcPeriod * 0.55)
        const sLo = Math.max(0, readIdx - searchHalf)
        const sHi = Math.min(srcMono.length - 1, readIdx + searchHalf)
        for (let k = sLo; k <= sHi; k++) {
          if (srcMono[k]! > maxVal) {
            maxVal = srcMono[k]!
            peakIdx = k
          }
        }
      }

      const halfGrain = isVoiced ? srcPeriod : targetPeriod
      const tailFade = progress > 0.9 ? (1 - progress) / 0.1 : 1.0

      for (let g = -halfGrain; g < halfGrain; g++) {
        const srcPos = peakIdx + g
        const dstPos = outWriteCursor + g
        if (srcPos >= 0 && srcPos < srcMono.length && dstPos >= 0 && dstPos < totalOutSamples) {
          const w = 0.5 * (1 + Math.cos((Math.PI * g) / halfGrain))
          outMono[dstPos] += srcMono[srcPos]! * w * tailFade
        }
      }

      outWriteCursor += targetPeriod
    }
  }

  let peak = 0.01
  for (let i = 0; i < totalOutSamples; i++) {
    const a = Math.abs(outMono[i]!)
    if (a > peak) peak = a
  }
  const normGain = 0.88 / peak
  const left = new Float32Array(totalOutSamples)
  const right = new Float32Array(totalOutSamples)
  const haasDelay = Math.floor(0.018 * sr)

  for (let i = 0; i < totalOutSamples; i++) {
    const dry = Math.tanh(outMono[i]! * normGain * 1.22)
    const delayed = i >= haasDelay ? Math.tanh(outMono[i - haasDelay]! * normGain * 1.22) : 0
    left[i] = dry * 0.92 + delayed * 0.22
    right[i] = dry * 0.78 + delayed * 0.38
  }

  return { left, right }
}

function writeStereoWavFile(
  filePath: string,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array
): void {
  const numSamples = left.length
  const dataSize = numSamples * 4
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  let offset = 44
  for (let i = 0; i < numSamples; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, left[i]!)) * 32767), offset)
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, right[i]!)) * 32767), offset + 2)
    offset += 4
  }
  writeFileSync(filePath, buf)
}

/**
 * 为挂载了鬼畜变声/变调的台词片段合成 TD-PSOLA「原声拉长变调成歌声」WAV 文件。
 * 若源文件不存在（如单元测试虚拟路径），返回 null 以无缝回退至标准 FFmpeg 滤镜链。
 */
export function renderGuichuSingingClipWav(
  clip: TimelineExportClip & { path: string },
  phraseIndex: number,
  ffmpegBin = 'ffmpeg'
): string | null {
  try {
    if (clip.track !== 'video' && clip.track !== 'voice') return null
    const fx = isTimelineVoiceEffectId(clip.voiceEffect) ? clip.voiceEffect : 'none'
    const pitch = clampClipPitchSemitones(clip.pitchSemitones)
    const speed = clampClipSpeed(clip.speed)
    if (fx === 'none' && Math.abs(pitch) < 0.05 && speed >= 0.9) return null
    if (!existsSync(clip.path)) return null

    const dur = Math.max(0.08, clip.durationSec)
    const freezeTail =
      clip.track === 'video'
        ? Math.min(Math.max(0, dur - 0.05), clampClipFreezeTailSec(clip.freezeTailSec))
        : 0
    const playDur = Math.max(0.08, dur - freezeTail)
    const srcStart = Math.max(0, Number(clip.sourceOffsetSec) || 0)
    const srcWindowDur = Math.max(0.12, playDur * speed)

    const st = statSync(clip.path)
    const notes = buildMelodyNotesForClip(playDur, speed, pitch, phraseIndex)
    const cacheSeed = JSON.stringify({
      p: clip.path,
      m: st.mtimeMs,
      ss: srcStart.toFixed(3),
      sw: srcWindowDur.toFixed(3),
      pd: playDur.toFixed(3),
      fx,
      notes
    })
    const hash = createHash('md5').update(cacheSeed).digest('hex').slice(0, 16)
    const outWavPath = join(getVocalsCacheDir(), `psola-sing-${hash}.wav`)
    if (existsSync(outWavPath)) return outWavPath

    const fullPcm = loadSourceMonoPcm(ffmpegBin, clip.path)
    if (!fullPcm || fullPcm.length < 400) return null

    const s0 = Math.min(
      fullPcm.length - 200,
      Math.max(0, Math.floor(srcStart * SINGING_SAMPLE_RATE))
    )
    const s1 = Math.min(
      fullPcm.length,
      Math.max(s0 + 200, Math.floor((srcStart + srcWindowDur) * SINGING_SAMPLE_RATE))
    )
    const rawSlice = fullPcm.subarray(s0, s1)
    const activeSlice = trimActiveSpeechSlice(rawSlice, SINGING_SAMPLE_RATE)

    const { left, right } = synthesizeVocalShifterSinging(activeSlice, SINGING_SAMPLE_RATE, notes)
    writeStereoWavFile(outWavPath, SINGING_SAMPLE_RATE, left, right)
    return outWavPath
  } catch {
    return null
  }
}
