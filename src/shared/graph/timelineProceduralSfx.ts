/**
 * 内置零成本程序化卡点音效合成器（Procedural Viral SFX Synthesizer）
 *
 * 针对爆款短视频中高频出现的 4 类卡点时刻（`@cueTag` 关键词弹窗、梯度榜卡片飞入、榜单揭晓、痛点暴击）：
 * - 纯 TypeScript 实时生成 16-bit 44.1kHz 单声道标准 WAV 字节流与 DataURL；
 * - 无需外部音频素材或付费 API，Web 60fps 预览与 FFmpeg MP4 导出均可 100% 离线即插即用。
 */

export type TimelineProceduralSfxId = 'pop' | 'whoosh' | 'ding' | 'boom'

export const TIMELINE_PROCEDURAL_SFX_PRESETS: ReadonlyArray<{
  id: TimelineProceduralSfxId
  labelZh: string
  labelEn: string
  durationSec: number
}> = [
  { id: 'pop', labelZh: '清脆气泡弹出 (Pop)', labelEn: 'Crisp Bubble Pop', durationSec: 0.18 },
  { id: 'whoosh', labelZh: '丝滑飞入划过 (Whoosh)', labelEn: 'Smooth Whoosh', durationSec: 0.28 },
  { id: 'ding', labelZh: '高光揭晓叮声 (Ding)', labelEn: 'Highlight Ding', durationSec: 0.42 },
  { id: 'boom', labelZh: '重低音暴击 (Boom)', labelEn: 'Sub-Bass Boom', durationSec: 0.45 }
]

export function isTimelineProceduralSfxId(val: unknown): val is TimelineProceduralSfxId {
  return val === 'pop' || val === 'whoosh' || val === 'ding' || val === 'boom'
}

/**
 * 根据标签名或场景语义自动推荐最匹配的卡点音效类型。
 */
export function inferProceduralSfxIdForTag(tag: string): TimelineProceduralSfxId {
  const t = tag.trim().toLowerCase()
  if (/boom|punch|hit|shock|alert|warn|danger|pain|暴击|痛点|警告/.test(t)) return 'boom'
  if (/tier_s|top1|rank1|win|best|star|ding|gold|神作|第一|冠军/.test(t)) return 'ding'
  if (/tier|rank|step|slide|fly|whoosh|swipe|梯度|排行|步骤/.test(t)) return 'whoosh'
  return 'pop'
}

/**
 * 合成指定预设的 16-bit PCM WAV 二进制 `Uint8Array`。
 */
export function synthesizeTimelineSfxWavBytes(
  sfxId: TimelineProceduralSfxId,
  sampleRate = 22050
): Uint8Array {
  const preset =
    TIMELINE_PROCEDURAL_SFX_PRESETS.find((p) => p.id === sfxId) ??
    TIMELINE_PROCEDURAL_SFX_PRESETS[0]!
  const numSamples = Math.max(64, Math.round(preset.durationSec * sampleRate))
  const samples = new Float32Array(numSamples)

  let phase = 0
  let phase2 = 0
  // 确定性伪随机种子，保证每次生成的 whoosh/boom 音色完全一致
  let rngState = 0x12345678
  const nextRand = (): number => {
    rngState = (rngState * 1664525 + 1013904223) >>> 0
    return (rngState / 0xffffffff) * 2 - 1
  }

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate
    const progress = i / numSamples
    let val = 0

    switch (sfxId) {
      case 'pop': {
        // 气泡上扬音：基频从 280Hz 快速滑升至 760Hz，带快速指数衰减包络
        const freq = 280 + 480 * Math.pow(progress, 0.55)
        phase += (2 * Math.PI * freq) / sampleRate
        const env = Math.sin(Math.min(1, progress * 12) * (Math.PI / 2)) * Math.exp(-progress * 6.5)
        val = (Math.sin(phase) * 0.85 + Math.sin(phase * 2) * 0.15) * env
        break
      }
      case 'whoosh': {
        // 飞入划过音：包络调制白噪 + 中低频扫频共振
        const sweepFreq = 180 + 520 * Math.sin(progress * Math.PI)
        phase += (2 * Math.PI * sweepFreq) / sampleRate
        const bellEnv = Math.sin(progress * Math.PI) * Math.pow(1 - progress, 0.4)
        const noise = nextRand()
        val = (noise * 0.48 + Math.sin(phase) * 0.52) * bellEnv * 0.85
        break
      }
      case 'ding': {
        // 清脆高光铃音：1318.5Hz (E6) + 2637Hz (E7) + 3955Hz 泛音金属共鸣
        const f1 = 1318.5
        const f2 = 2637.0
        phase += (2 * Math.PI * f1) / sampleRate
        phase2 += (2 * Math.PI * f2) / sampleRate
        const attack = Math.min(1, t / 0.006)
        const decay1 = Math.exp(-t * 7.5)
        const decay2 = Math.exp(-t * 14.0)
        val = attack * (Math.sin(phase) * 0.72 * decay1 + Math.sin(phase2) * 0.28 * decay2)
        break
      }
      case 'boom': {
        // 重低音暴击：135Hz -> 36Hz 下潜正弦 + 前 15ms 瞬态击打
        const freq = 36 + 99 * Math.exp(-t * 16)
        phase += (2 * Math.PI * freq) / sampleRate
        const bodyEnv = Math.min(1, t / 0.005) * Math.exp(-t * 5.2)
        const transient = t < 0.018 ? nextRand() * Math.exp(-t * 120) * 0.45 : 0
        val = Math.tanh((Math.sin(phase) * 0.92 * bodyEnv + transient) * 1.35)
        break
      }
    }

    samples[i] = Math.max(-1, Math.min(1, val))
  }

  const dataByteLen = numSamples * 2
  const totalLen = 44 + dataByteLen
  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)

  const writeAscii = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      buf[offset + i] = str.charCodeAt(i)
    }
  }

  // RIFF Header
  writeAscii(0, 'RIFF')
  view.setUint32(4, totalLen - 8, true)
  writeAscii(8, 'WAVE')
  // fmt chunk
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format = 1 (PCM)
  view.setUint16(22, 1, true) // channels = 1 (mono)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true) // bits per sample
  // data chunk
  writeAscii(36, 'data')
  view.setUint32(40, dataByteLen, true)

  for (let i = 0; i < numSamples; i++) {
    const s = samples[i]!
    const pcm =
      s < 0 ? Math.max(-32768, Math.round(s * 32768)) : Math.min(32767, Math.round(s * 32767))
    view.setInt16(44 + i * 2, pcm, true)
  }

  return buf
}

function uint8ToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  }
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return typeof btoa === 'function' ? btoa(binary) : ''
}

const wavDataUrlCache = new Map<TimelineProceduralSfxId, string>()

/**
 * 获取指定内置卡点音效的 `data:audio/wav;base64,...` URL（带内存缓存，供渲染端预览直接播放）。
 */
export function synthesizeTimelineSfxWavDataUrl(sfxId: TimelineProceduralSfxId): string {
  const cached = wavDataUrlCache.get(sfxId)
  if (cached) return cached
  const bytes = synthesizeTimelineSfxWavBytes(sfxId)
  const url = `data:audio/wav;base64,${uint8ToBase64(bytes)}`
  wavDataUrlCache.set(sfxId, url)
  return url
}

/**
 * 从音频波形峰值包络（`peaks` 或 `rms` 数组）中自动检测鼓点/重拍瞬态时间戳（Onset Beat Detection）：
 * - 计算局部滑动均值能量与正向瞬态能量跳变（Spectral/Energy Flux）；
 * - 强制最小节拍间隔 `minIntervalSec`（默认 `0.34s`，约合 <= 176 BPM），滤除颤音与高频毛刺；
 * - 返回按时间升序排列的节拍秒数列表（如 `[0.42, 0.91, 1.4, ...]`）。
 */
export function detectAudioBeatTimestampsFromPeaks(
  peaks: ArrayLike<number>,
  durationSec: number,
  options?: {
    minIntervalSec?: number
    sensitivity?: number
    clipStartSec?: number
    sourceOffsetSec?: number
    clipDurationSec?: number
    speed?: number
  }
): number[] {
  const n = peaks?.length ?? 0
  const dur = Math.max(0.1, Number(durationSec) || 0.1)
  if (n < 4) return []

  const minInterval = Math.max(0.18, options?.minIntervalSec ?? 0.34)
  const sensitivity = Math.max(1.05, Math.min(2.5, options?.sensitivity ?? 1.32))
  const clipStart = Number(options?.clipStartSec) || 0
  const sourceOffset = Math.max(0, Number(options?.sourceOffsetSec) || 0)
  const speed = Number(options?.speed) > 0 ? Number(options?.speed) : 1
  const clipDur = Number(options?.clipDurationSec) > 0 ? Number(options?.clipDurationSec) : dur

  let maxVal = 0
  for (let i = 0; i < n; i++) {
    const v = Math.abs(Number(peaks[i]) || 0)
    if (v > maxVal) maxVal = v
  }
  if (maxVal < 1e-4) return []

  const norm = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    norm[i] = Math.abs(Number(peaks[i]) || 0) / maxVal
  }

  const windowRadius = Math.max(2, Math.round((n / dur) * 0.28))
  const beats: number[] = []
  let lastBeatSec = -999

  for (let i = 1; i < n - 1; i++) {
    const cur = norm[i]!
    const prev = norm[i - 1]!
    const next = norm[i + 1]!
    // 局部极大值且高于底噪
    if (cur < 0.22 || cur < prev || cur < next) continue

    let sum = 0
    let count = 0
    const w0 = Math.max(0, i - windowRadius)
    const w1 = Math.min(n - 1, i + windowRadius)
    for (let j = w0; j <= w1; j++) {
      sum += norm[j]!
      count++
    }
    const localMean = count > 0 ? sum / count : cur
    const rise = cur - prev
    if (cur >= localMean * sensitivity || (cur >= 0.45 && rise >= 0.18)) {
      const sourceSec = ((i + 0.5) / n) * dur
      if (sourceSec < sourceOffset - 0.01) continue
      const localClipSec = (sourceSec - sourceOffset) / speed
      if (localClipSec > clipDur + 0.01) continue
      const tSec = Math.round((clipStart + localClipSec) * 1000) / 1000
      if (tSec - lastBeatSec >= minInterval) {
        beats.push(tSec)
        lastBeatSec = tSec
      }
    }
  }

  return beats
}

/**
 * 将主视频轨切点（相邻镜头交界处）或叠加层/音效起点自动吸附到最近的 BGM 鼓点时间戳：
 * - 主视频轨：保持总时长与首尾锚定不变，把每个相邻镜头的切点吸附到 `maxSnapDeltaSec` 内的最近鼓点，
 *   同时联动修正前一段的 `durationSec` 与后一段的 `startSec`/`durationSec`（无缝不断轨）；
 * - 画中画/音效轨：若未绑定 `@cueTag` 且起点距离鼓点在 `maxSnapDeltaSec` 内，自动微调对齐到鼓点。
 */
export function snapClipsToAudioBeats<
  T extends {
    id?: string
    track: string
    startSec: number
    durationSec: number
    anchorCueTag?: string
    transitionInSec?: number
  }
>(
  inputClips: ReadonlyArray<T>,
  beatTimestampsSec: ReadonlyArray<number>,
  maxSnapDeltaSec = 0.22
): { clips: T[]; snappedCutCount: number; snappedClipCount: number } {
  if (!beatTimestampsSec.length) {
    return { clips: inputClips.map((c) => ({ ...c })), snappedCutCount: 0, snappedClipCount: 0 }
  }

  const sortedBeats = [...beatTimestampsSec]
    .filter((b) => Number.isFinite(b) && b >= 0)
    .sort((a, b) => a - b)
  if (!sortedBeats.length) {
    return { clips: inputClips.map((c) => ({ ...c })), snappedCutCount: 0, snappedClipCount: 0 }
  }

  const findNearestBeat = (targetSec: number): number | null => {
    let best: number | null = null
    let bestDist = maxSnapDeltaSec + 1e-6
    for (const b of sortedBeats) {
      const d = Math.abs(b - targetSec)
      if (d <= bestDist) {
        bestDist = d
        best = b
      }
    }
    return best
  }

  const cloned = inputClips.map((c) => ({ ...c }))
  const videoIndices = cloned
    .map((c, idx) => ({ c, idx }))
    .filter((x) => x.c.track === 'video')
    .sort((a, b) => a.c.startSec - b.c.startSec)

  let snappedCutCount = 0

  for (let i = 0; i < videoIndices.length - 1; i++) {
    const left = videoIndices[i]!.c
    const right = videoIndices[i + 1]!.c
    // 若存在转场负重叠则跳过硬切点吸附，避免破坏转场重叠窗口
    if ((right.transitionInSec ?? 0) > 0.02) continue
    const cutSec = right.startSec
    const leftEnd = left.startSec + left.durationSec
    if (Math.abs(leftEnd - cutSec) > 0.08) continue

    const beat = findNearestBeat(cutSec)
    if (beat === null || Math.abs(beat - cutSec) < 0.008) continue

    const newLeftDur = Math.round((beat - left.startSec) * 1000) / 1000
    const rightEnd = right.startSec + right.durationSec
    const newRightDur = Math.round((rightEnd - beat) * 1000) / 1000
    if (newLeftDur < 0.25 || newRightDur < 0.25) continue

    left.durationSec = newLeftDur
    right.startSec = Math.round(beat * 1000) / 1000
    right.durationSec = newRightDur
    snappedCutCount++
  }

  for (const clip of cloned) {
    if ((clip.track === 'overlay' || clip.track === 'sfx') && !clip.anchorCueTag) {
      const beat = findNearestBeat(clip.startSec)
      if (beat !== null && Math.abs(beat - clip.startSec) >= 0.008) {
        clip.startSec = Math.round(beat * 1000) / 1000
        snappedCutCount++
      }
    }
  }

  return { clips: cloned, snappedCutCount, snappedClipCount: snappedCutCount }
}
