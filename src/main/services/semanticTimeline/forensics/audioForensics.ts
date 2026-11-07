/**
 * Pure TypeScript 16kHz PCM WAV multi-track audio forensics (`rea-video` `audio.py` equivalent).
 *
 * Computes directly from `evidence/stems/mixed.wav` with zero external DSP dependencies:
 * - Global RMS / Peak loudness (`dBFS`)
 * - Per-clip cut discontinuity (`perClipAudio.resetsAtCuts`) separating per-shot AI native audio
 *   from continuous post-mixed beds
 * - Voice activity (`speechRatio`), autocorrelation pitch (`f0MedianHz`, `pitchCv`, `genderHint`)
 * - Music onset autocorrelation `bpm`, 12-chroma Krumhansl-Schmuckler `key`, `beatSyncedCutRatio`, `ending`
 * - SFX transient events (`hit`, `whoosh`, `click`) and cut-sync tagging
 */
import { existsSync, readFileSync } from 'fs'
import type { AudioForensicAnalysis, UtteranceEvidence } from '@shared/semanticTimeline'

const PITCH_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
const KRUMHANSL_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KRUMHANSL_MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo
  return Math.max(lo, Math.min(hi, v))
}

function r2(v: number): number {
  return Number(clamp(v, -1e6, 1e6).toFixed(2))
}

export interface ParsedMonoWav {
  sampleRate: number
  samples: Float32Array
  durationSec: number
}

/** Parse RIFF PCM 16-bit WAV buffer into normalized mono `Float32Array` (`-1..1`). */
export function parsePcm16WavBuffer(buf: Buffer): ParsedMonoWav | null {
  if (buf.length < 44) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null
  }
  let offset = 12
  let sampleRate = 16000
  let channels = 1
  let bitsPerSample = 16
  let dataStart = -1
  let dataBytes = 0

  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4)
    const chunkSize = buf.readUInt32LE(offset + 4)
    const bodyOffset = offset + 8
    if (chunkId === 'fmt ' && bodyOffset + 16 <= buf.length) {
      const audioFormat = buf.readUInt16LE(bodyOffset)
      if (audioFormat !== 1) return null // PCM integer only
      channels = Math.max(1, buf.readUInt16LE(bodyOffset + 2))
      sampleRate = Math.max(4000, buf.readUInt32LE(bodyOffset + 4))
      bitsPerSample = buf.readUInt16LE(bodyOffset + 14)
    } else if (chunkId === 'data') {
      dataStart = bodyOffset
      dataBytes = Math.min(chunkSize, buf.length - bodyOffset)
      break
    }
    offset = bodyOffset + chunkSize + (chunkSize % 2)
  }

  if (dataStart < 0 || dataBytes <= 0 || bitsPerSample !== 16) return null
  const frameBytes = channels * 2
  const frameCount = Math.floor(dataBytes / frameBytes)
  if (frameCount <= 0) return null

  const samples = new Float32Array(frameCount)
  for (let i = 0; i < frameCount; i += 1) {
    let sum = 0
    const base = dataStart + i * frameBytes
    for (let ch = 0; ch < channels; ch += 1) {
      sum += buf.readInt16LE(base + ch * 2) / 32768
    }
    samples[i] = sum / channels
  }

  return {
    sampleRate,
    samples,
    durationSec: frameCount / sampleRate
  }
}

/** In-place iterative Cooley-Tukey Radix-2 FFT (`re` & `im` length must be power of 2). */
function fftRadix2(re: Float64Array, im: Float64Array): void {
  const n = re.length
  let j = 0
  for (let i = 1; i < n; i += 1) {
    let bit = n >> 1
    while (j & bit) {
      j ^= bit
      bit >>= 1
    }
    j ^= bit
    if (i < j) {
      const tr = re[i]!
      re[i] = re[j]!
      re[j] = tr
      const ti = im[i]!
      im[i] = im[j]!
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wlenRe = Math.cos(ang)
    const wlenIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wRe = 1
      let wIm = 0
      const half = len >> 1
      for (let k = 0; k < half; k += 1) {
        const uRe = re[i + k]!
        const uIm = im[i + k]!
        const vRe = re[i + k + half]! * wRe - im[i + k + half]! * wIm
        const vIm = re[i + k + half]! * wIm + im[i + k + half]! * wRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + half] = uRe - vRe
        im[i + k + half] = uIm - vIm
        const nextWRe = wRe * wlenRe - wIm * wlenIm
        wIm = wRe * wlenIm + wIm * wlenRe
        wRe = nextWRe
      }
    }
  }
}

function estimateFramePitchHz(
  samples: Float32Array,
  start: number,
  len: number,
  sr: number
): number | null {
  let energy = 0
  for (let i = 0; i < len; i += 1) {
    const v = samples[start + i]!
    energy += v * v
  }
  if (energy / len < 1e-4) return null

  const minLag = Math.max(20, Math.floor(sr / 400))
  const maxLag = Math.min(len - 16, Math.ceil(sr / 75))
  if (maxLag <= minLag) return null

  const corrs = new Float64Array(maxLag + 1)
  let globalBestLag = -1
  let globalBestCorr = 0.38

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let num = 0
    let den0 = 0
    let den1 = 0
    const count = len - lag
    for (let i = 0; i < count; i += 2) {
      const a = samples[start + i]!
      const b = samples[start + i + lag]!
      num += a * b
      den0 += a * a
      den1 += b * b
    }
    const denom = Math.sqrt(den0 * den1)
    if (denom > 1e-7) {
      const corr = num / denom
      corrs[lag] = corr
      if (corr > globalBestCorr) {
        globalBestCorr = corr
        globalBestLag = lag
      }
    }
  }
  if (globalBestLag <= 0) return null

  // McLeod / Praat subharmonic guard: pick the first local peak within 88% of global max correlation
  const peakFloor = Math.max(0.38, globalBestCorr * 0.88)
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const c = corrs[lag]!
    if (c >= peakFloor && c >= corrs[lag - 1]! && c >= corrs[lag + 1]!) {
      return sr / lag
    }
  }
  return sr / globalBestLag
}

function estimateMusicalKey(chroma: Float64Array): string | undefined {
  const sum = chroma.reduce((a, b) => a + b, 0)
  if (sum <= 1e-6) return undefined
  let bestName: string | undefined
  let bestScore = -Infinity

  const corr = (profile: readonly number[], shift: number): number => {
    let mx = 0
    let my = 0
    for (let i = 0; i < 12; i += 1) {
      mx += chroma[(i + shift) % 12]!
      my += profile[i]!
    }
    mx /= 12
    my /= 12
    let num = 0
    let dx = 0
    let dy = 0
    for (let i = 0; i < 12; i += 1) {
      const a = chroma[(i + shift) % 12]! - mx
      const b = profile[i]! - my
      num += a * b
      dx += a * a
      dy += b * b
    }
    const den = Math.sqrt(dx * dy)
    return den > 1e-9 ? num / den : -1
  }

  for (let root = 0; root < 12; root += 1) {
    const maj = corr(KRUMHANSL_MAJOR, root)
    if (maj > bestScore) {
      bestScore = maj
      bestName = `${PITCH_NAMES[root]} major`
    }
    const min = corr(KRUMHANSL_MINOR, root)
    if (min > bestScore) {
      bestScore = min
      bestName = `${PITCH_NAMES[root]} minor`
    }
  }
  return bestScore >= 0.35 ? bestName : undefined
}

function downsampleWavIfNeeded(wav: ParsedMonoWav): ParsedMonoWav {
  if (wav.sampleRate <= 24000) return wav
  const factor = Math.max(2, Math.round(wav.sampleRate / 16000))
  const nextCount = Math.floor(wav.samples.length / factor)
  if (nextCount < 64) return wav
  const nextSamples = new Float32Array(nextCount)
  for (let i = 0; i < nextCount; i += 1) {
    let sum = 0
    const base = i * factor
    for (let k = 0; k < factor; k += 1) sum += wav.samples[base + k]!
    nextSamples[i] = sum / factor
  }
  const nextSr = wav.sampleRate / factor
  return {
    sampleRate: nextSr,
    samples: nextSamples,
    durationSec: nextCount / nextSr
  }
}

/** Analyze a mono/stereo PCM WAV buffer for Axis-4 audio forensics. */
export function analyzePcmAudioForensics(
  rawWav: ParsedMonoWav,
  cutTimesSec: number[],
  utterances: UtteranceEvidence[] = []
): AudioForensicAnalysis {
  const wav = downsampleWavIfNeeded(rawWav)
  const { samples, sampleRate: sr, durationSec } = wav
  const n = samples.length
  if (n < sr * 0.15) {
    return {
      hasAudio: false,
      voice: { present: false, speechRatio: 0 },
      music: { present: false },
      sfx: { present: false, events: [] }
    }
  }

  let sumSq = 0
  let peak = 0
  for (let i = 0; i < n; i += 1) {
    const a = Math.abs(samples[i]!)
    sumSq += a * a
    if (a > peak) peak = a
  }
  const rms = Math.sqrt(sumSq / n)
  const rmsDbfs = r2(20 * Math.log10(Math.max(1e-5, rms)))
  const peakDbfs = r2(20 * Math.log10(Math.max(1e-5, peak)))

  if (rmsDbfs <= -56 && peakDbfs <= -45) {
    return {
      hasAudio: true,
      rmsDbfs,
      peakDbfs,
      voice: { present: false, speechRatio: 0 },
      music: { present: false },
      sfx: { present: false, events: [] }
    }
  }

  // 512-sample FFT @ 20ms hop (50 Hz envelope rate)
  const fftN = 512
  const hop = Math.max(64, Math.round(sr * 0.02))
  const envRate = sr / hop
  const frameCount = Math.max(1, Math.floor((n - fftN) / hop))
  const hann = new Float64Array(fftN)
  for (let i = 0; i < fftN; i += 1) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftN - 1)))
  }

  const frameDb = new Float64Array(frameCount)
  const lowEnergy = new Float64Array(frameCount)
  const voiceEnergy = new Float64Array(frameCount)
  const highEnergy = new Float64Array(frameCount)
  const onsetEnv = new Float64Array(frameCount)
  const centroidHz = new Float64Array(frameCount)
  const chroma = new Float64Array(12)

  const re = new Float64Array(fftN)
  const im = new Float64Array(fftN)
  const prevMag = new Float64Array(fftN >> 1)
  const binHz = sr / fftN

  for (let f = 0; f < frameCount; f += 1) {
    const start = f * hop
    let fSq = 0
    for (let i = 0; i < fftN; i += 1) {
      const s = samples[start + i] ?? 0
      fSq += s * s
      re[i] = s * hann[i]!
      im[i] = 0
    }
    frameDb[f] = 10 * Math.log10(Math.max(1e-10, fSq / fftN))
    fftRadix2(re, im)

    let flux = 0
    let low = 0
    let mid = 0
    let high = 0
    let magWeightedHz = 0
    let magSum = 0

    for (let k = 1; k < fftN >> 1; k += 1) {
      const mag = Math.hypot(re[k]!, im[k]!)
      const hz = k * binHz
      magWeightedHz += mag * hz
      magSum += mag
      const diff = mag - prevMag[k]!
      if (diff > 0) flux += diff
      prevMag[k] = mag

      if (hz >= 55 && hz < 250) low += mag
      else if (hz >= 250 && hz <= 3500) mid += mag
      else if (hz > 3500 && hz <= 7600) high += mag

      if (hz >= 110 && hz <= 1760) {
        const midi = 69 + 12 * Math.log2(hz / 440)
        const pc = ((Math.round(midi) % 12) + 12) % 12
        chroma[pc]! += mag
      }
    }

    onsetEnv[f] = flux
    lowEnergy[f] = low
    voiceEnergy[f] = mid
    highEnergy[f] = high
    centroidHz[f] = magSum > 1e-6 ? magWeightedHz / magSum : 0
  }

  // 1. Per-clip audio cut jump (`atCutsDb` vs `withinShotsDb`)
  const validCuts = cutTimesSec.filter((t) => t > 0.25 && t < durationSec - 0.25)
  let perClipAudio: AudioForensicAnalysis['perClipAudio']
  if (validCuts.length >= 1 && frameCount >= 20) {
    const step = Math.max(2, Math.round(0.08 * envRate))
    const cutJumps: number[] = []
    for (const ct of validCuts) {
      const idx = clamp(Math.round(ct * envRate), step, frameCount - 1 - step)
      const dbJump = Math.abs(frameDb[idx + step]! - frameDb[idx - step]!)
      const centJump = Math.abs(centroidHz[idx + step]! - centroidHz[idx - step]!) / 450
      cutJumps.push(dbJump + centJump)
    }
    const innerJumps: number[] = []
    const stride = Math.max(3, Math.floor(frameCount / 60))
    for (let idx = step; idx < frameCount - step; idx += stride) {
      const t = idx / envRate
      if (validCuts.some((ct) => Math.abs(ct - t) < 0.28)) continue
      const dbJump = Math.abs(frameDb[idx + step]! - frameDb[idx - step]!)
      const centJump = Math.abs(centroidHz[idx + step]! - centroidHz[idx - step]!) / 450
      innerJumps.push(dbJump + centJump)
    }
    if (cutJumps.length > 0 && innerJumps.length > 0) {
      const atCutsDb = r2(cutJumps.reduce((a, b) => a + b, 0) / cutJumps.length)
      const withinShotsDb = r2(
        Math.max(0.4, innerJumps.reduce((a, b) => a + b, 0) / innerJumps.length)
      )
      const ratio = r2(atCutsDb / withinShotsDb)
      perClipAudio = {
        atCutsDb,
        withinShotsDb,
        ratio,
        resetsAtCuts: validCuts.length >= 2 && atCutsDb >= 5.5 && ratio >= 1.9
      }
    }
  }

  // 2. Voice forensics (activity + f0 median + pitch CV)
  let voicedFrames = 0
  const pitches: number[] = []
  const pitchWin = Math.min(n, Math.round(sr * 0.04))
  for (let f = 0; f < frameCount; f += 2) {
    const isVoiceBandStrong =
      frameDb[f]! > rmsDbfs - 14 && voiceEnergy[f]! > (lowEnergy[f]! + highEnergy[f]!) * 0.65
    if (!isVoiceBandStrong) continue
    voicedFrames += 2
    const start = f * hop
    if (start + pitchWin <= n && pitches.length < 240) {
      const f0 = estimateFramePitchHz(samples, start, pitchWin, sr)
      if (f0) pitches.push(f0)
    }
  }

  const uttCoveredSec = utterances.reduce(
    (acc, u) => acc + Math.max(0, u.range.end - u.range.start),
    0
  )
  const dspSpeechRatio = clamp(voicedFrames / Math.max(1, frameCount), 0, 1)
  const speechRatio = r2(
    utterances.length > 0
      ? clamp(0.65 * (uttCoveredSec / Math.max(0.5, durationSec)) + 0.35 * dspSpeechRatio, 0, 1)
      : dspSpeechRatio
  )
  const voicePresent = utterances.length > 0 || (speechRatio >= 0.12 && pitches.length >= 5)

  let f0MedianHz: number | undefined
  let pitchCv: number | undefined
  let genderHint: AudioForensicAnalysis['voice']['genderHint']
  if (pitches.length >= 4) {
    const sorted = [...pitches].sort((a, b) => a - b)
    f0MedianHz = Math.round(sorted[Math.floor(sorted.length * 0.5)]!)
    const meanF0 = sorted.reduce((a, b) => a + b, 0) / sorted.length
    const stdF0 = Math.sqrt(
      sorted.reduce((acc, v) => acc + (v - meanF0) * (v - meanF0), 0) / sorted.length
    )
    pitchCv = Number((stdF0 / Math.max(1, f0MedianHz)).toFixed(3))
    genderHint = f0MedianHz < 165 ? 'male' : f0MedianHz >= 185 ? 'female' : 'unclear'
  }

  // 3. Music forensics (onset autocorrelation BPM, key, beat-synced cut %, ending)
  let onsetMean = 0
  for (let i = 0; i < frameCount; i += 1) onsetMean += onsetEnv[i]!
  onsetMean /= Math.max(1, frameCount)
  let onsetVar = 0
  for (let i = 0; i < frameCount; i += 1) {
    const d = onsetEnv[i]! - onsetMean
    onsetVar += d * d
  }
  const onsetStd = Math.sqrt(onsetVar / Math.max(1, frameCount))

  let bpm: number | undefined
  let bestBeatCorr = 0
  let bestBeatPhaseSec = 0
  if (durationSec >= 3.0 && onsetStd > 1e-4) {
    const minLag = Math.max(4, Math.round((envRate * 60) / 172))
    const maxLag = Math.min(frameCount >> 1, Math.round((envRate * 60) / 68))
    let bestLag = -1
    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let num = 0
      let d0 = 0
      let d1 = 0
      for (let i = 0; i + lag < frameCount; i += 1) {
        const a = onsetEnv[i]! - onsetMean
        const b = onsetEnv[i + lag]! - onsetMean
        num += a * b
        d0 += a * a
        d1 += b * b
      }
      const c = d0 * d1 > 1e-9 ? num / Math.sqrt(d0 * d1) : 0
      if (c > bestBeatCorr) {
        bestBeatCorr = c
        bestLag = lag
      }
    }
    if (bestLag > 0 && bestBeatCorr >= 0.14) {
      bpm = Math.round((60 * envRate) / bestLag)
      // Estimate dominant beat phase offset
      let bestPhaseSum = -1
      for (let p = 0; p < bestLag; p += 1) {
        let s = 0
        for (let k = p; k < frameCount; k += bestLag) s += onsetEnv[k]!
        if (s > bestPhaseSum) {
          bestPhaseSum = s
          bestBeatPhaseSec = p / envRate
        }
      }
    }
  }

  const key = estimateMusicalKey(chroma)
  // Check sustained harmonic/bass bed even during non-speech windows
  let musicBedFrames = 0
  for (let f = 0; f < frameCount; f += 1) {
    if (frameDb[f]! > rmsDbfs - 15 && lowEnergy[f]! > voiceEnergy[f]! * 0.22) {
      musicBedFrames += 1
    }
  }
  const musicPresent =
    Boolean(bpm && bestBeatCorr >= 0.18) ||
    Boolean(key && musicBedFrames / Math.max(1, frameCount) >= 0.35)

  let beatSyncedCutRatio: number | undefined
  if (musicPresent && bpm && validCuts.length >= 2) {
    const beatPeriod = 60 / bpm
    let synced = 0
    for (const ct of validCuts) {
      const phase = (((ct - bestBeatPhaseSec) % beatPeriod) + beatPeriod) % beatPeriod
      const dist = Math.min(phase, beatPeriod - phase)
      if (dist <= 0.11) synced += 1
    }
    beatSyncedCutRatio = r2(synced / validCuts.length)
  }

  let ending: AudioForensicAnalysis['music']['ending']
  if (musicPresent && frameCount >= 25) {
    const tailLen = Math.min(Math.floor(frameCount * 0.3), Math.round(1.2 * envRate))
    const preMean =
      frameDb
        .subarray(Math.max(0, frameCount - tailLen * 2), frameCount - tailLen)
        .reduce((a, b) => a + b, 0) / Math.max(1, tailLen)
    const lastFrames = frameDb.subarray(
      Math.max(0, frameCount - Math.max(3, Math.round(0.25 * envRate)))
    )
    const endMean = lastFrames.reduce((a, b) => a + b, 0) / Math.max(1, lastFrames.length)
    if (preMean - endMean >= 9.5) ending = 'fade_out'
    else if (endMean <= -42) ending = 'natural_end'
    else ending = 'hard_cut'
  }

  // 4. SFX transient spike detector
  const sfxEvents: AudioForensicAnalysis['sfx']['events'] = []
  if (onsetStd > 1e-4) {
    const thresh = onsetMean + 3.1 * onsetStd
    let lastPeakSec = -1
    for (let f = 2; f < frameCount - 2; f += 1) {
      const v = onsetEnv[f]!
      if (v < thresh || v < onsetEnv[f - 1]! || v < onsetEnv[f + 1]!) continue
      const t = r2(f / envRate)
      if (t - lastPeakSec < 0.28) continue
      lastPeakSec = t
      const kind =
        lowEnergy[f]! > voiceEnergy[f]! * 0.9
          ? 'hit'
          : highEnergy[f]! > voiceEnergy[f]! * 0.7
            ? 'click'
            : 'whoosh'
      const nearCut = validCuts.some((ct) => Math.abs(ct - t) <= 0.14)
      sfxEvents.push({
        time: t,
        kind,
        ...(nearCut ? { syncedTo: 'cut' as const } : {}),
        source: 'deterministic'
      })
      if (sfxEvents.length >= 24) break
    }
  }

  return {
    hasAudio: true,
    rmsDbfs,
    peakDbfs,
    ...(perClipAudio ? { perClipAudio } : {}),
    voice: {
      present: voicePresent,
      speechRatio,
      ...(f0MedianHz ? { f0MedianHz } : {}),
      ...(pitchCv !== undefined ? { pitchCv } : {}),
      ...(genderHint ? { genderHint } : {})
    },
    music: {
      present: musicPresent,
      ...(musicPresent && bpm ? { bpm } : {}),
      ...(musicPresent && key ? { key } : {}),
      ...(beatSyncedCutRatio !== undefined ? { beatSyncedCutRatio } : {}),
      ...(ending ? { ending } : {})
    },
    sfx: {
      present: sfxEvents.length > 0,
      events: sfxEvents
    }
  }
}

/** Read `mixed.wav` from disk and compute full Axis-4 audio forensic profile. */
export function analyzeMixedWavFile(
  mixedWavAbs: string,
  cutTimesSec: number[],
  utterances: UtteranceEvidence[] = []
): AudioForensicAnalysis | undefined {
  if (!existsSync(mixedWavAbs)) return undefined
  try {
    const buf = readFileSync(mixedWavAbs)
    const parsed = parsePcm16WavBuffer(buf)
    if (!parsed) return undefined
    return analyzePcmAudioForensics(parsed, cutTimesSec, utterances)
  } catch {
    return undefined
  }
}

/**
 * Refine mixed-audio forensic measurements using separated `vocals` and `accompaniment` WAV stems
 * so voice pitch (`f0MedianHz`, `pitchCv`) is unpolluted by BGM bass/drums, and music `bpm`/`key`
 * is unpolluted by loud speech formants.
 */
export function refineAudioAnalysisWithStems(
  base: AudioForensicAnalysis,
  options: {
    vocalsWavAbs?: string
    accompanimentWavAbs?: string
    cutTimesSec?: number[]
    utterances?: UtteranceEvidence[]
  }
): AudioForensicAnalysis {
  if (!base.hasAudio) return base
  const cuts = options.cutTimesSec ?? []
  const utts = options.utterances ?? []

  let nextVoice = base.voice
  if (options.vocalsWavAbs && existsSync(options.vocalsWavAbs)) {
    const vocAnalysis = analyzeMixedWavFile(options.vocalsWavAbs, cuts, utts)
    if (vocAnalysis?.hasAudio && (vocAnalysis.voice.present || utts.length > 0)) {
      nextVoice = {
        ...base.voice,
        present: vocAnalysis.voice.present || base.voice.present,
        speechRatio: vocAnalysis.voice.speechRatio || base.voice.speechRatio,
        ...(vocAnalysis.voice.f0MedianHz ? { f0MedianHz: vocAnalysis.voice.f0MedianHz } : {}),
        ...(vocAnalysis.voice.pitchCv !== undefined ? { pitchCv: vocAnalysis.voice.pitchCv } : {}),
        ...(vocAnalysis.voice.genderHint ? { genderHint: vocAnalysis.voice.genderHint } : {})
      }
    }
  }

  let nextMusic = base.music
  if (options.accompanimentWavAbs && existsSync(options.accompanimentWavAbs)) {
    const accAnalysis = analyzeMixedWavFile(options.accompanimentWavAbs, cuts, [])
    if (accAnalysis?.hasAudio) {
      if ((accAnalysis.rmsDbfs ?? -90) <= -48 && !accAnalysis.music.present) {
        nextMusic = { present: false }
      } else if (accAnalysis.music.present) {
        nextMusic = {
          ...base.music,
          present: true,
          ...(accAnalysis.music.bpm ? { bpm: accAnalysis.music.bpm } : {}),
          ...(accAnalysis.music.key ? { key: accAnalysis.music.key } : {}),
          ...(accAnalysis.music.beatSyncedCutRatio !== undefined
            ? { beatSyncedCutRatio: accAnalysis.music.beatSyncedCutRatio }
            : {}),
          ...(accAnalysis.music.ending ? { ending: accAnalysis.music.ending } : {})
        }
      }
    }
  }

  return {
    ...base,
    voice: nextVoice,
    music: nextMusic
  }
}
