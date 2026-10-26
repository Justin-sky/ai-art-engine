/**
 * 游戏音频工程化算子纯函数层（SFX 防听觉疲劳变体矩阵 + BGM 零接缝无限循环）。
 *
 * 面向所有游戏类型的音频后期管线：
 * 1. `planSfxVariantMatrix`：生成多组微音高（Semitone）、语速补偿与高频搁架滤波参数，消除高频触发音效
 *    （脚步、挥砍、射击、按钮点击、受击）的重复机械感；
 * 2. `buildSfxVariantFfmpegArgs`：生成带首尾静音自动裁切（0ms 触发延迟）与变体滤镜的 ffmpeg 参数；
 * 3. `buildSeamlessLoopBgmFfmpegArgs`：采用 `asplit + atrim(0..C) + atrim(C..end) + acrossfade` 相位连续环路算法，
 *    将单条 AI 生成 BGM 转化为首尾在原始 t=C 采样点严格闭合的无限循环音轨。
 */

export interface SfxVariantSpec {
  index: number
  variantId: string
  /** 半音偏移（-6 ~ +6） */
  semitoneOffset: number
  /** 采样率缩放比 2^(semitone/12) */
  pitchRatio: number
  /** 速度微调比（0.85 ~ 1.18） */
  tempoRatio: number
  /** 高频搁架增益 dB（模拟不同打击力度/明暗度，-3 ~ +3） */
  trebleGainDb: number
  /** 音量微扰 dB（-1.5 ~ +1.0） */
  volumeGainDb: number
}

export interface PlanSfxVariantsOptions {
  /** 变体数量（1~12，默认 4） */
  count?: number
  /** 最大半音偏移幅度（0.2~6，默认 1.8） */
  pitchSpreadSemitones?: number
  /** 速度微扰幅度（0~0.2，默认 0.06） */
  tempoSpread?: number
  /** 音色明暗微扰幅度 dB（0~4，默认 1.6） */
  timbreSpreadDb?: number
}

export interface SfxFfmpegBuildOptions {
  /** 是否自动裁切首尾静音以确保游戏内 0ms 瞬发响应（默认 true） */
  trimSilence?: boolean
  /** 首部静音阈值 dB（默认 -45） */
  startSilenceThresholdDb?: number
  /** 尾部静音阈值 dB（默认 -48） */
  tailSilenceThresholdDb?: number
  /** 基准采样率（默认 44100） */
  sampleRate?: number
}

export interface SeamlessLoopBgmOptions {
  /** 首尾交叉淡化时长（秒，0.5~10，默认 2.5） */
  crossfadeSec?: number
  /** 交叉淡化曲线类型（默认 qsin 等功率正弦曲线） */
  curve?: 'tri' | 'qsin' | 'esin' | 'hsin' | 'log'
  /** 是否附加响度限制器防爆音（默认 true） */
  limiter?: boolean
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n))
}

/**
 * 规划 N 组确定性的 SFX 变体参数矩阵。
 * 第 1 个变体保持最接近原声但经过静音裁切，其余变体在音高、速度、明暗度上对称展开。
 */
export function planSfxVariantMatrix(options?: PlanSfxVariantsOptions): SfxVariantSpec[] {
  const count = Math.max(1, Math.min(12, Math.round(options?.count ?? 4)))
  const pitchSpread = clamp(Number(options?.pitchSpreadSemitones ?? 1.8), 0.2, 6)
  const tempoSpread = clamp(Number(options?.tempoSpread ?? 0.06), 0, 0.2)
  const timbreSpread = clamp(Number(options?.timbreSpreadDb ?? 1.6), 0, 4)

  const specs: SfxVariantSpec[] = []
  for (let i = 0; i < count; i++) {
    const variantId = `v${String(i + 1).padStart(2, '0')}`
    if (count === 1) {
      specs.push({
        index: 0,
        variantId,
        semitoneOffset: 0,
        pitchRatio: 1,
        tempoRatio: 1,
        trebleGainDb: 0,
        volumeGainDb: 0
      })
      continue
    }

    // 归一化位置 t ∈ [-1, +1]
    const t = (2 * i) / (count - 1) - 1
    const semitoneOffset = Number((t * pitchSpread).toFixed(3))
    const pitchRatio = Number(Math.pow(2, semitoneOffset / 12).toFixed(5))
    // 交替微调语速与高频明暗度，避免单调线性关联
    const altSign = i % 2 === 0 ? 1 : -1
    const tempoRatio = Number((1 + t * tempoSpread * 0.5 + altSign * tempoSpread * 0.35).toFixed(4))
    const trebleGainDb = Number(
      (t * timbreSpread * 0.75 + altSign * timbreSpread * 0.25).toFixed(2)
    )
    const volumeGainDb = Number((-Math.abs(t) * 0.6).toFixed(2))

    specs.push({
      index: i,
      variantId,
      semitoneOffset,
      pitchRatio,
      tempoRatio,
      trebleGainDb,
      volumeGainDb
    })
  }

  return specs
}

/**
 * 构建单条 SFX 变体渲染的 ffmpeg 命令行参数数组。
 */
export function buildSfxVariantFfmpegArgs(
  inputPath: string,
  outputPath: string,
  variant: SfxVariantSpec,
  options?: SfxFfmpegBuildOptions
): string[] {
  const sampleRate = Math.max(8000, Math.round(options?.sampleRate ?? 44100))
  const trimSilence = options?.trimSilence !== false
  const startDb = clamp(Number(options?.startSilenceThresholdDb ?? -45), -70, -15)
  const tailDb = clamp(Number(options?.tailSilenceThresholdDb ?? -48), -75, -15)

  const filters: string[] = []
  if (trimSilence) {
    filters.push(
      `silenceremove=start_periods=1:start_duration=0.003:start_threshold=${startDb}dB`,
      'areverse',
      `silenceremove=start_periods=1:start_duration=0.015:start_threshold=${tailDb}dB`,
      'areverse'
    )
  }

  // asetrate 改变音高与速度，随后用 atempo 调整到目标速度比，最后重采样回标准采样率
  const targetRate = Math.max(4000, Math.round(sampleRate * variant.pitchRatio))
  const atempoCompensation = clamp(variant.tempoRatio / variant.pitchRatio, 0.5, 2.0)
  filters.push(
    `asetrate=${targetRate}`,
    `aresample=${sampleRate}`,
    `atempo=${atempoCompensation.toFixed(4)}`
  )

  if (Math.abs(variant.trebleGainDb) >= 0.05) {
    filters.push(`treble=g=${variant.trebleGainDb.toFixed(2)}:f=3200`)
  }
  if (Math.abs(variant.volumeGainDb) >= 0.05) {
    filters.push(`volume=${variant.volumeGainDb.toFixed(2)}dB`)
  }
  filters.push('alimiter=limit=0.96:level=disabled')

  return ['-y', '-i', inputPath, '-vn', '-af', filters.join(','), outputPath]
}

/**
 * 构建 BGM 无缝循环处理的 ffmpeg 命令行参数数组。
 *
 * 原理：
 * 将原始音频在 t = C（crossfadeSec）处切分为 head=[0..C] 与 body=[C..L]，
 * 再将 body 的尾部与 head 做时长为 C 的等功率交叉淡化。
 * 输出音轨起点为原音频 t=C，终点亦为原音频 t=C，循环回绕点天然相位连续。
 */
export function buildSeamlessLoopBgmFfmpegArgs(
  inputPath: string,
  outputPath: string,
  options?: SeamlessLoopBgmOptions
): string[] {
  const crossfadeSec = Number(clamp(Number(options?.crossfadeSec ?? 2.5), 0.5, 10).toFixed(2))
  const curve = options?.curve ?? 'qsin'
  const limiter = options?.limiter !== false

  const postFilter = limiter ? ',alimiter=limit=0.96:level=disabled' : ''
  const filterComplex = [
    '[0:a]asplit=2[head_raw][body_raw]',
    `[head_raw]atrim=0:${crossfadeSec},asetpts=PTS-STARTPTS[head]`,
    `[body_raw]atrim=start=${crossfadeSec},asetpts=PTS-STARTPTS[body]`,
    `[body][head]acrossfade=d=${crossfadeSec}:c1=${curve}:c2=${curve}${postFilter}[out]`
  ].join(';')

  return [
    '-y',
    '-i',
    inputPath,
    '-vn',
    '-filter_complex',
    filterComplex,
    '-map',
    '[out]',
    outputPath
  ]
}
