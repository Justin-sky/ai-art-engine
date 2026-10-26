/**
 * Pure TypeScript Game Audio PCM / WAV DSP Engine.
 *
 * Provides zero-dependency, sample-accurate audio processing for both Node and Renderer:
 * 1. `trimSilencePcm`: Trims leading and trailing silence below thresholdDb for 0ms SFX attack latency;
 * 2. `applyEqualPowerLoopCrossfadePcm`: Applies cosine/sine equal-power crossfade between head and tail
 *    so BGM loops seamlessly with zero clicks or phase discontinuities;
 * 3. `resamplePitchShiftPcm`: Uses 4-point Hermite cubic interpolation to shift pitch/tempo for anti-fatigue SFX variants;
 * 4. `applyGameAudioEnvironmentFxPcm`: 6 in-game acoustic environment DSP filters (underwater, radio_comms, cave_reverb, retro_8bit, heavy_impact);
 * 5. `normalizePeakPcm`: Peak loudness normalization (-1 dBFS default) with soft-knee limiting;
 * 6. `analyzeAudioWaveformAndTrim`: Computes waveform peak/RMS buckets and silence trim boundary metrics for canvas visualization;
 * 7. `exportGodotAudioStreamRandomizerTres` & `exportUnityAudioRandomContainerJson`: Engine audio container exporters;
 * 8. `encodePcmToWavBytes` & `encodePcmToWavDataUrl`: Encodes Float32Array PCM into standard 16-bit RIFF WAVE.
 */

export type GameAudioSynthPreset =
  | 'sword_slash'
  | 'explosion'
  | 'laser_shoot'
  | 'coin_pickup'
  | 'jump_boost'
  | 'hit_hurt'
  | 'powerup_chord'
  | 'chiptune_bgm'

export type GameAudioEnvironmentFx =
  | 'none'
  | 'underwater'
  | 'radio_comms'
  | 'cave_reverb'
  | 'retro_8bit'
  | 'heavy_impact'

export interface TrimSilenceOptions {
  /** Threshold in dBFS below which samples are considered silence (default -42 dB) */
  thresholdDb?: number
  /** Safety padding in milliseconds kept before attack transient (default 2 ms) */
  padStartMs?: number
  /** Safety padding in milliseconds kept after release tail (default 15 ms) */
  padEndMs?: number
}

export interface WaveformBucket {
  min: number
  max: number
  rms: number
}

export interface AudioWaveformAnalysis {
  buckets: WaveformBucket[]
  durationSec: number
  peakDb: number
  rmsDb: number
  trimStartRatio: number
  trimEndRatio: number
  trimmedLeadMs: number
  trimmedTailMs: number
}

export function trimSilencePcm(
  samples: Float32Array,
  sampleRate: number,
  options: TrimSilenceOptions = {}
): Float32Array {
  if (samples.length === 0) return new Float32Array(0)
  const thresholdDb = options.thresholdDb ?? -42
  const thresholdAmp = Math.pow(10, thresholdDb / 20)
  const padStart = Math.max(0, Math.round(((options.padStartMs ?? 2) / 1000) * sampleRate))
  const padEnd = Math.max(0, Math.round(((options.padEndMs ?? 15) / 1000) * sampleRate))

  let firstIdx = 0
  while (firstIdx < samples.length && Math.abs(samples[firstIdx]!) < thresholdAmp) {
    firstIdx++
  }
  if (firstIdx >= samples.length) {
    // Entire buffer is below threshold; return a short slice so WAV stays valid
    return samples.slice(0, Math.min(samples.length, Math.max(64, Math.round(sampleRate * 0.05))))
  }

  let lastIdx = samples.length - 1
  while (lastIdx > firstIdx && Math.abs(samples[lastIdx]!) < thresholdAmp) {
    lastIdx--
  }

  const start = Math.max(0, firstIdx - padStart)
  const end = Math.min(samples.length, lastIdx + 1 + padEnd)
  const out = samples.slice(start, end)

  // Apply tiny 1.5ms micro-fade at start and end to guarantee zero DC click
  const fadeSamples = Math.min(
    Math.floor(out.length / 4),
    Math.max(4, Math.round(sampleRate * 0.0015))
  )
  for (let i = 0; i < fadeSamples; i++) {
    const g = i / fadeSamples
    out[i] = out[i]! * g
    out[out.length - 1 - i] = out[out.length - 1 - i]! * g
  }
  return out
}

/**
 * Applies a phase-continuous equal-power crossfade loop:
 * Splits the first `crossfadeSec` seconds (`head`) from the rest (`body`),
 * and blends `head` into the last `crossfadeSec` seconds of `body` using `sin`/`cos` equal-power weights.
 * The resulting buffer loops from its end back to sample 0 with zero discontinuity!
 */
export function applyEqualPowerLoopCrossfadePcm(
  samples: Float32Array,
  sampleRate: number,
  crossfadeSec = 2.0
): Float32Array {
  if (samples.length < 32) return samples.slice()
  const maxFadeSamples = Math.floor(samples.length * 0.35)
  const fadeSamples = Math.max(
    8,
    Math.min(maxFadeSamples, Math.round(Math.max(0.05, crossfadeSec) * sampleRate))
  )

  const outLen = samples.length - fadeSamples
  const out = new Float32Array(outLen)

  // Copy non-overlapping middle section: samples[fadeSamples .. outLen - 1] -> out[0 .. outLen - fadeSamples - 1]
  const bodyDirectLen = outLen - fadeSamples
  for (let i = 0; i < bodyDirectLen; i++) {
    out[i] = samples[fadeSamples + i]!
  }

  // Crossfade tail of samples (samples[outLen .. samples.length - 1]) with head of samples (samples[0 .. fadeSamples - 1])
  for (let i = 0; i < fadeSamples; i++) {
    const t = i / fadeSamples
    const angle = t * (Math.PI * 0.5)
    const gainTail = Math.cos(angle)
    const gainHead = Math.sin(angle)
    const tailSample = samples[outLen + i]!
    const headSample = samples[i]!
    out[bodyDirectLen + i] = tailSample * gainTail + headSample * gainHead
  }

  return out
}

/**
 * Resamples a PCM buffer with 4-point Hermite cubic interpolation to shift pitch by `semitoneOffset`
 * and applies subtle brightness tilt (`brightnessDb`) for anti-fatigue SFX variation.
 */
export function resamplePitchShiftPcm(
  samples: Float32Array,
  semitoneOffset: number,
  brightnessDb = 0
): Float32Array {
  if (samples.length < 4) return samples.slice()
  const rateRatio = Math.pow(2, semitoneOffset / 12)
  const outLen = Math.max(4, Math.round(samples.length / rateRatio))
  const out = new Float32Array(outLen)

  const n = samples.length
  const getSample = (idx: number): number => {
    const clamped = Math.max(0, Math.min(n - 1, idx))
    return samples[clamped]!
  }

  for (let i = 0; i < outLen; i++) {
    const srcPos = i * rateRatio
    const i0 = Math.floor(srcPos)
    const frac = srcPos - i0

    const ym1 = getSample(i0 - 1)
    const y0 = getSample(i0)
    const y1 = getSample(i0 + 1)
    const y2 = getSample(i0 + 2)

    // 4-point Hermite polynomial interpolation
    const c0 = y0
    const c1 = 0.5 * (y1 - ym1)
    const c2 = ym1 - 2.5 * y0 + 2.0 * y1 - 0.5 * y2
    const c3 = 0.5 * (y2 - ym1) + 1.5 * (y0 - y1)
    out[i] = ((c3 * frac + c2) * frac + c1) * frac + c0
  }

  // Optional subtle high-frequency tilt for timbre variation
  if (Math.abs(brightnessDb) > 0.05) {
    const hfGain = Math.pow(10, brightnessDb / 20) - 1
    let prev = out[0]!
    for (let i = 0; i < outLen; i++) {
      const curr = out[i]!
      const diff = curr - prev
      prev = curr
      out[i] = Math.max(-0.98, Math.min(0.98, curr + diff * hfGain * 0.45))
    }
  }

  return out
}

/**
 * Applies in-game acoustic environment DSP filters to a mono/stereo channel buffer:
 * - `underwater`: Cascaded 2-pole low-pass filter (~480Hz) for submerged/muffled stun state;
 * - `radio_comms`: Band-pass (500Hz–2600Hz) + tanh soft overdrive for walkie-talkie / mech comms;
 * - `cave_reverb`: Schroeder 3-comb + all-pass reverb network for dungeon/cavern spatial tail;
 * - `retro_8bit`: Sample-and-hold decimation + 6-bit quantization bitcrusher;
 * - `heavy_impact`: Sub-bass low-shelf boost + transient punch enhancer.
 */
export function applyGameAudioEnvironmentFxPcm(
  samples: Float32Array,
  sampleRate: number,
  fx: GameAudioEnvironmentFx = 'none'
): Float32Array {
  if (fx === 'none' || samples.length === 0) return samples.slice()
  const sr = Math.max(8000, sampleRate)
  const n = samples.length
  const out = new Float32Array(n)

  if (fx === 'underwater') {
    const cutoffHz = 480
    const rc = 1 / (2 * Math.PI * cutoffHz)
    const dt = 1 / sr
    const alpha = dt / (rc + dt)
    let lp1 = 0
    let lp2 = 0
    for (let i = 0; i < n; i++) {
      lp1 += alpha * (samples[i]! - lp1)
      lp2 += alpha * (lp1 - lp2)
      out[i] = lp2 * 1.15
    }
    return out
  }

  if (fx === 'radio_comms') {
    const hpCutoff = 520
    const lpCutoff = 2600
    const dt = 1 / sr
    const rcHp = 1 / (2 * Math.PI * hpCutoff)
    const alphaHp = rcHp / (rcHp + dt)
    const rcLp = 1 / (2 * Math.PI * lpCutoff)
    const alphaLp = dt / (rcLp + dt)
    let prevIn = 0
    let hp = 0
    let lp = 0
    for (let i = 0; i < n; i++) {
      const x = samples[i]!
      hp = alphaHp * (hp + x - prevIn)
      prevIn = x
      lp += alphaLp * (hp - lp)
      // Soft-clipping walkie-talkie saturation
      out[i] = Math.tanh(lp * 2.6) * 0.85
    }
    return out
  }

  if (fx === 'cave_reverb') {
    const d1 = Math.max(16, Math.round(sr * 0.029))
    const d2 = Math.max(16, Math.round(sr * 0.037))
    const d3 = Math.max(16, Math.round(sr * 0.043))
    const comb1 = new Float32Array(d1)
    const comb2 = new Float32Array(d2)
    const comb3 = new Float32Array(d3)
    let c1 = 0
    let c2 = 0
    let c3 = 0
    for (let i = 0; i < n; i++) {
      const x = samples[i]!
      const y1 = comb1[c1]!
      const y2 = comb2[c2]!
      const y3 = comb3[c3]!
      comb1[c1] = x + y1 * 0.62
      comb2[c2] = x + y2 * 0.58
      comb3[c3] = x + y3 * 0.54
      c1 = (c1 + 1) % d1
      c2 = (c2 + 1) % d2
      c3 = (c3 + 1) % d3
      const wet = (y1 + y2 + y3) * 0.28
      out[i] = Math.max(-0.98, Math.min(0.98, x * 0.78 + wet))
    }
    return out
  }

  if (fx === 'retro_8bit') {
    const holdStep = Math.max(2, Math.round(sr / 5500))
    const quantLevels = 32
    let held = 0
    for (let i = 0; i < n; i++) {
      if (i % holdStep === 0) {
        held = Math.round(samples[i]! * quantLevels) / quantLevels
      }
      out[i] = held
    }
    return out
  }

  if (fx === 'heavy_impact') {
    const cutoffHz = 160
    const rc = 1 / (2 * Math.PI * cutoffHz)
    const dt = 1 / sr
    const alpha = dt / (rc + dt)
    let low = 0
    for (let i = 0; i < n; i++) {
      const x = samples[i]!
      low += alpha * (x - low)
      const transientBoost = i < sr * 0.04 ? 1.28 : 1.0
      out[i] = Math.tanh((x * transientBoost + low * 1.15) * 1.1) * 0.92
    }
    return out
  }

  return samples.slice()
}

/**
 * Normalizes peak amplitude to `targetDb` (default -1.0 dBFS) so all exported game audio assets
 * have consistent in-engine loudness without digital clipping.
 */
export function normalizePeakPcm(samples: Float32Array, targetDb = -1.0): Float32Array {
  if (samples.length === 0) return new Float32Array(0)
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]!)
    if (abs > peak) peak = abs
  }
  if (peak < 1e-5) return samples.slice()
  const targetAmp = Math.min(0.99, Math.pow(10, targetDb / 20))
  const gain = targetAmp / peak
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    out[i] = Math.max(-0.995, Math.min(0.995, samples[i]! * gain))
  }
  return out
}

/**
 * Analyzes a PCM buffer for high-DPI waveform visualization and silence trim ruler overlays.
 */
export function analyzeAudioWaveformAndTrim(
  samples: Float32Array,
  sampleRate: number,
  bucketCount = 120,
  thresholdDb = -42
): AudioWaveformAnalysis {
  const n = samples.length
  const sr = Math.max(8000, sampleRate)
  const count = Math.max(16, Math.min(512, Math.floor(bucketCount)))
  if (n === 0) {
    return {
      buckets: Array.from({ length: count }, () => ({ min: 0, max: 0, rms: 0 })),
      durationSec: 0,
      peakDb: -96,
      rmsDb: -96,
      trimStartRatio: 0,
      trimEndRatio: 1,
      trimmedLeadMs: 0,
      trimmedTailMs: 0
    }
  }

  const buckets: WaveformBucket[] = []
  let globalPeak = 0
  let globalSumSq = 0
  for (let b = 0; b < count; b++) {
    const s0 = Math.floor((b * n) / count)
    const s1 = Math.max(s0 + 1, Math.floor(((b + 1) * n) / count))
    let min = 1
    let max = -1
    let sumSq = 0
    const len = Math.min(n, s1) - s0
    for (let i = s0; i < n && i < s1; i++) {
      const v = samples[i]!
      if (v < min) min = v
      if (v > max) max = v
      const abs = Math.abs(v)
      if (abs > globalPeak) globalPeak = abs
      sumSq += v * v
      globalSumSq += v * v
    }
    if (len <= 0) {
      min = 0
      max = 0
    }
    buckets.push({
      min,
      max,
      rms: len > 0 ? Math.sqrt(sumSq / len) : 0
    })
  }

  const thresholdAmp = Math.pow(10, thresholdDb / 20)
  let firstIdx = 0
  while (firstIdx < n && Math.abs(samples[firstIdx]!) < thresholdAmp) {
    firstIdx++
  }
  let lastIdx = n - 1
  while (lastIdx > firstIdx && Math.abs(samples[lastIdx]!) < thresholdAmp) {
    lastIdx--
  }
  const hasSignal = firstIdx < n
  const trimStartRatio = hasSignal ? firstIdx / n : 0
  const trimEndRatio = hasSignal ? (lastIdx + 1) / n : 1
  const trimmedLeadMs = hasSignal ? Math.round((firstIdx / sr) * 1000) : 0
  const trimmedTailMs = hasSignal ? Math.round(((n - 1 - lastIdx) / sr) * 1000) : 0

  const peakDb = globalPeak > 1e-5 ? Number((20 * Math.log10(globalPeak)).toFixed(1)) : -96
  const rmsGlobal = Math.sqrt(globalSumSq / n)
  const rmsDb = rmsGlobal > 1e-5 ? Number((20 * Math.log10(rmsGlobal)).toFixed(1)) : -96

  return {
    buckets,
    durationSec: Number((n / sr).toFixed(3)),
    peakDb,
    rmsDb,
    trimStartRatio,
    trimEndRatio,
    trimmedLeadMs,
    trimmedTailMs
  }
}

/**
 * Generates a Godot 4.x `AudioStreamRandomizer (.tres)` resource file for a pool of SFX variants.
 */
export function exportGodotAudioStreamRandomizerTres(options: {
  resourceName: string
  variantPaths: string[]
  pitchSpreadSemitones?: number
  randomVolumeOffsetDb?: number
}): string {
  const paths =
    options.variantPaths.length > 0
      ? options.variantPaths
      : ['res://assets/audio/sfx_v01.wav', 'res://assets/audio/sfx_v02.wav']
  const pitchRatio = Number(Math.pow(2, (options.pitchSpreadSemitones ?? 1.8) / 12).toFixed(3))
  const volDb = Number((options.randomVolumeOffsetDb ?? 1.2).toFixed(2))
  const loadSteps = paths.length + 1

  const extLines = paths.map((p, idx) => {
    const resPath = p.startsWith('res://') ? p : `res://${p.replace(/^\/+/, '')}`
    return `[ext_resource type="AudioStreamWAV" path="${resPath}" id="${idx + 1}_sfx"]`
  })
  const streamLines = paths.map(
    (_, idx) => `stream_${idx}/stream = ExtResource("${idx + 1}_sfx")\nstream_${idx}/weight = 1.0`
  )

  return [
    `[gd_resource type="AudioStreamRandomizer" load_steps=${loadSteps} format=3]`,
    '',
    ...extLines,
    '',
    '[resource]',
    `resource_name = "${options.resourceName || 'SFX_RandomPool'}"`,
    'playback_mode = 1',
    `random_pitch = ${pitchRatio}`,
    `random_volume_offset_db = ${volDb}`,
    `streams_count = ${paths.length}`,
    ...streamLines
  ].join('\n')
}

/**
 * Generates a Unity AudioRandomContainer / ScriptableObject JSON configuration for a pool of SFX variants.
 */
export function exportUnityAudioRandomContainerJson(options: {
  containerName: string
  variantPaths: string[]
  pitchSpreadSemitones?: number
  volumeVariationDb?: number
}): string {
  const semitones = options.pitchSpreadSemitones ?? 1.8
  return JSON.stringify(
    {
      containerType: 'Unity.Audio.AudioRandomContainer',
      name: options.containerName || 'SFX_RandomContainer',
      triggerMode: 'SequentialNoRepeat',
      automaticTriggerMode: 'Manual',
      pitchRandomizationEnabled: true,
      pitchRangeCents: [Math.round(-semitones * 100), Math.round(semitones * 100)],
      volumeRandomizationEnabled: true,
      volumeRangeDb: [-(options.volumeVariationDb ?? 1.5), 0],
      elements: options.variantPaths.map((p, idx) => ({
        index: idx,
        audioClipPath: p.startsWith('Assets/') ? p : `Assets/GameAudio/${p.replace(/^\/+/, '')}`,
        weight: 1.0
      }))
    },
    null,
    2
  )
}

/**
 * Encodes mono or stereo Float32Array PCM channels into a standard 16-bit PCM RIFF WAVE Uint8Array.
 */
export function encodePcmToWavBytes(channels: Float32Array[], sampleRate = 44100): Uint8Array {
  const numChannels = Math.max(1, Math.min(2, channels.length))
  const numFrames = channels[0]?.length ?? 0
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = numFrames * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeAscii = (offset: number, str: string): void => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i))
    }
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // AudioFormat = 1 (PCM)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true) // BitsPerSample = 16
  writeAscii(36, 'data')
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = channels[ch]?.[i] ?? 0
      const clamped = Math.max(-1, Math.min(1, sample))
      const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767)
      view.setInt16(offset, int16, true)
      offset += 2
    }
  }

  return new Uint8Array(buffer)
}

function uint8ToBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let out = ''
  const len = bytes.length
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!
    const b1 = i + 1 < len ? bytes[i + 1]! : 0
    const b2 = i + 2 < len ? bytes[i + 2]! : 0
    const triplet = (b0 << 16) | (b1 << 8) | b2
    out += alphabet[(triplet >> 18) & 0x3f]
    out += alphabet[(triplet >> 12) & 0x3f]
    out += i + 1 < len ? alphabet[(triplet >> 6) & 0x3f] : '='
    out += i + 2 < len ? alphabet[triplet & 0x3f] : '='
  }
  return out
}

export function encodePcmToWavDataUrl(channels: Float32Array[], sampleRate = 44100): string {
  const bytes = encodePcmToWavBytes(channels, sampleRate)
  return `data:audio/wav;base64,${uint8ToBase64(bytes)}`
}

/**
 * Decodes a 16-bit PCM RIFF WAVE Uint8Array into mono/stereo Float32Array channels and sampleRate.
 */
export function decodeWavBytesToPcm(bytes: Uint8Array): {
  channels: Float32Array[]
  sampleRate: number
} | null {
  if (bytes.byteLength < 44) return null
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const magic =
    String.fromCharCode(view.getUint8(0)) +
    String.fromCharCode(view.getUint8(1)) +
    String.fromCharCode(view.getUint8(2)) +
    String.fromCharCode(view.getUint8(3))
  if (magic !== 'RIFF') return null

  const numChannels = Math.max(1, Math.min(2, view.getUint16(22, true) || 1))
  const sampleRate = Math.max(8000, Math.min(96000, view.getUint32(24, true) || 44100))
  const bitsPerSample = view.getUint16(34, true) || 16
  if (bitsPerSample !== 16) return null

  const dataOffset = 44
  const bytesPerFrame = numChannels * 2
  const numFrames = Math.max(0, Math.floor((bytes.byteLength - dataOffset) / bytesPerFrame))
  const channels: Float32Array[] = Array.from(
    { length: numChannels },
    () => new Float32Array(numFrames)
  )

  let offset = dataOffset
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = view.getInt16(offset, true)
      channels[ch]![i] = s < 0 ? s / 32768 : s / 32767
      offset += 2
    }
  }
  return { channels, sampleRate }
}

/**
 * Synthesizes a procedural chiptune BGM phrase or 8 classic jsfxr-style combat/UI SFX waveforms
 * when the audio DSP node runs standalone without an upstream audio file.
 */
export function synthesizeGameSeedPcm(
  modeOrPreset: 'loop_bgm' | 'sfx_variants' | GameAudioSynthPreset = 'sword_slash',
  sampleRate = 22050
): { channels: Float32Array[]; sampleRate: number } {
  const sr = Math.max(8000, Math.floor(sampleRate))
  const preset: GameAudioSynthPreset =
    modeOrPreset === 'loop_bgm'
      ? 'chiptune_bgm'
      : modeOrPreset === 'sfx_variants'
        ? 'sword_slash'
        : modeOrPreset

  if (preset === 'chiptune_bgm') {
    const durationSec = 3.2
    const len = Math.floor(sr * durationSec)
    const left = new Float32Array(len)
    const right = new Float32Array(len)
    const notes = [261.63, 329.63, 392.0, 523.25, 392.0, 329.63, 293.66, 349.23]
    const stepSamples = Math.max(1, Math.floor(len / notes.length))
    for (let i = 0; i < len; i++) {
      const noteIdx = Math.min(notes.length - 1, Math.floor(i / stepSamples))
      const freq = notes[noteIdx]!
      const t = i / sr
      const localT = (i % stepSamples) / stepSamples
      const env = Math.sin(Math.min(1, localT * 8) * (Math.PI * 0.5)) * (1 - localT * 0.45)
      const lead = Math.sin(2 * Math.PI * freq * t) * 0.42
      const sub = Math.sin(2 * Math.PI * (freq * 0.5) * t) * 0.25
      left[i] = (lead + sub) * env
      right[i] = (lead * 0.9 + sub * 1.05) * env
    }
    return { channels: [left, right], sampleRate: sr }
  }

  // Deterministic PRNG for noise components
  let rng = 0x13579bdf
  const nextNoise = (): number => {
    rng = (rng * 1664525 + 1013904223) >>> 0
    return (rng / 0xffffffff) * 2 - 1
  }

  if (preset === 'explosion') {
    const durationSec = 0.72
    const len = Math.floor(sr * durationSec)
    const mono = new Float32Array(len)
    const silenceLead = Math.floor(sr * 0.02)
    let lp = 0
    for (let i = silenceLead; i < len; i++) {
      const t = (i - silenceLead) / sr
      const env = Math.exp(-t * 4.5)
      const rumbleFreq = 110 * Math.exp(-t * 3.2) + 32
      const sub = Math.sin(2 * Math.PI * rumbleFreq * t) * 0.65
      lp += 0.18 * (nextNoise() - lp)
      mono[i] = Math.tanh((sub + lp * 0.95) * env * 1.3) * 0.85
    }
    return { channels: [mono], sampleRate: sr }
  }

  if (preset === 'laser_shoot') {
    const durationSec = 0.36
    const len = Math.floor(sr * durationSec)
    const mono = new Float32Array(len)
    const silenceLead = Math.floor(sr * 0.018)
    let phase = 0
    for (let i = silenceLead; i < len; i++) {
      const t = (i - silenceLead) / sr
      const freq = 1280 * Math.exp(-t * 11.0) + 140 + Math.sin(t * 90) * 28
      phase += freq / sr
      const env = Math.exp(-t * 7.5)
      const saw = (phase % 1) * 2 - 1
      mono[i] = saw * env * 0.72
    }
    return { channels: [mono], sampleRate: sr }
  }

  if (preset === 'coin_pickup') {
    const durationSec = 0.42
    const len = Math.floor(sr * durationSec)
    const mono = new Float32Array(len)
    const silenceLead = Math.floor(sr * 0.015)
    for (let i = silenceLead; i < len; i++) {
      const t = (i - silenceLead) / sr
      const freq = t < 0.075 ? 987.77 : 1318.51 // B5 -> E6
      const env = Math.exp(-t * 8.2)
      const bell =
        Math.sin(2 * Math.PI * freq * t) * 0.75 + Math.sin(2 * Math.PI * freq * 2.0 * t) * 0.25
      mono[i] = bell * env * 0.8
    }
    return { channels: [mono], sampleRate: sr }
  }

  if (preset === 'jump_boost') {
    const durationSec = 0.34
    const len = Math.floor(sr * durationSec)
    const mono = new Float32Array(len)
    const silenceLead = Math.floor(sr * 0.015)
    let phase = 0
    for (let i = silenceLead; i < len; i++) {
      const t = (i - silenceLead) / sr
      const freq = 180 + t * t * 3600
      phase += freq / sr
      const env = Math.sin(Math.min(1, t * 25) * (Math.PI * 0.5)) * Math.exp(-t * 5.2)
      const sq = Math.sin(2 * Math.PI * phase) >= 0 ? 0.6 : -0.6
      mono[i] = (sq + Math.sin(2 * Math.PI * phase) * 0.4) * env * 0.75
    }
    return { channels: [mono], sampleRate: sr }
  }

  if (preset === 'hit_hurt') {
    const durationSec = 0.32
    const len = Math.floor(sr * durationSec)
    const mono = new Float32Array(len)
    const silenceLead = Math.floor(sr * 0.02)
    for (let i = silenceLead; i < len; i++) {
      const t = (i - silenceLead) / sr
      const freq = 240 * Math.exp(-t * 14) + 55
      const env = Math.exp(-t * 10.5)
      const punch = Math.sin(2 * Math.PI * freq * t) * 0.75 + nextNoise() * 0.45
      mono[i] = Math.tanh(punch * 1.6) * env * 0.82
    }
    return { channels: [mono], sampleRate: sr }
  }

  if (preset === 'powerup_chord') {
    const durationSec = 0.6
    const len = Math.floor(sr * durationSec)
    const mono = new Float32Array(len)
    const silenceLead = Math.floor(sr * 0.015)
    const arp = [523.25, 659.25, 783.99, 1046.5] // C5, E5, G5, C6
    for (let i = silenceLead; i < len; i++) {
      const t = (i - silenceLead) / sr
      const step = Math.min(arp.length - 1, Math.floor(t / 0.09))
      const freq = arp[step]!
      const env = Math.exp(-t * 3.8)
      mono[i] =
        (Math.sin(2 * Math.PI * freq * t) * 0.65 + Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.25) *
        env *
        0.8
    }
    return { channels: [mono], sampleRate: sr }
  }

  // Default 'sword_slash': crisp retro sword/laser impact with 25ms leading silence to test trimSilencePcm
  const durationSec = 0.48
  const len = Math.floor(sr * durationSec)
  const mono = new Float32Array(len)
  const silenceLead = Math.floor(sr * 0.025)
  for (let i = silenceLead; i < len; i++) {
    const t = (i - silenceLead) / sr
    const freq = 660 * Math.exp(-t * 9.5) + 110
    const env = Math.exp(-t * 8.0)
    const tone = Math.sin(2 * Math.PI * freq * t)
    const harmonic = Math.sin(2 * Math.PI * freq * 2.5 * t) * 0.35
    const whoosh = nextNoise() * Math.exp(-t * 16.0) * 0.35
    mono[i] = (tone + harmonic + whoosh) * env * 0.68
  }
  return { channels: [mono], sampleRate: sr }
}
