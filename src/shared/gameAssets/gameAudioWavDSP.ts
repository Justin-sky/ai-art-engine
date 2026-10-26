/**
 * Pure TypeScript Game Audio PCM / WAV DSP Engine.
 *
 * Provides zero-dependency, sample-accurate audio processing for both Node and Renderer:
 * 1. `trimSilencePcm`: Trims leading and trailing silence below thresholdDb for 0ms SFX attack latency;
 * 2. `applyEqualPowerLoopCrossfadePcm`: Applies cosine/sine equal-power crossfade between head and tail
 *    so BGM loops seamlessly with zero clicks or phase discontinuities;
 * 3. `resamplePitchShiftPcm`: Uses 4-point Hermite cubic interpolation to shift pitch/tempo for anti-fatigue SFX variants;
 * 4. `encodePcmToWavBytes` & `encodePcmToWavDataUrl`: Encodes Float32Array PCM into standard 16-bit RIFF WAVE.
 */

export interface TrimSilenceOptions {
  /** Threshold in dBFS below which samples are considered silence (default -42 dB) */
  thresholdDb?: number
  /** Safety padding in milliseconds kept before attack transient (default 2 ms) */
  padStartMs?: number
  /** Safety padding in milliseconds kept after release tail (default 15 ms) */
  padEndMs?: number
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
