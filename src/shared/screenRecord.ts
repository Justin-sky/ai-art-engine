/**
 * 应用界面录制：纯逻辑（无 Electron、无 fs），只做「怎么录、留哪些帧、怎么编码」。
 *
 * ## 为什么需要它
 *
 * 应用此前**没有任何屏幕/窗口录制能力**：`desktopCapturer` 零出现，`capturePage()` 只在
 * 试玩冒烟里给隐藏窗口截了几张静帧（不落盘、不成片）。而 AI 对话那边已经能写脚本、出旁白
 * （`generate_speech`）、出被讲解的音效（`generate_sound_effect`）、铺轨与导出 MP4
 * （`timeline_edit` / `timeline_export`）—— 缺的只有「应用界面本身那一段画面」。
 *
 * ## 两个必须由这里定死的口径
 *
 * 1. **空闲帧必须合并并封顶。** 对话驱动的录制里，模型与工具调用之间可能停顿几十秒；
 *    按固定帧率硬录会得到大段静止画面。这里按帧指纹判重：只有画面真的变了才留一帧；
 *    静止段在成片里最多显示 `maxHoldMs`（真正缩短时长），步骤 alignment 映到压缩轴。
 * 2. **步骤时间戳由录制侧记录**，不靠模型自报。旁白与字幕都按压缩轴对齐。
 */

/** 录制上限：宁可拒绝，也不要录到一半失败、或把磁盘写满 */
export const SCREEN_RECORD_LIMITS = {
  fpsMin: 1,
  fpsMax: 15,
  fpsDefault: 10,
  /** 单次录制最长时长：教学视频足够，编码时间可控 */
  maxSeconds: 180,
  /** 帧数上限（也就是空闲帧合并后允许写盘的最大帧数） */
  maxFrames: 2700,
  /**
   * 单段静止在成片里的最长显示时长（毫秒）。
   *
   * 对话驱动录制里工具间隙常 30–60s；若按墙钟留白，成片全是冻帧。
   * 编码时把每段「画面不变」的 hold **封顶**到此值（不是拆成多段仍加总），
   * 步骤 alignment 同步映射到压缩时间轴。
   */
  maxHoldMs: 2000
} as const

/**
 * 末帧最短停留（毫秒）：录制结束时最后那个画面至少显示这么久。
 *
 * 不给的话末帧只剩 1ms —— 最后一步的动作在成片里一闪而过甚至看不见。
 */
const DEFAULT_TAIL_HOLD_MS = 500

/** 一段录制里的一步（对应 HUD 上的一条标题） */
export interface ScreenRecordStepInput {
  /** 这一步在讲什么（显示在 HUD 标题条上，也用于字幕） */
  title: string
  /** 可选的一句字幕原文（没给就用 title） */
  caption?: string
  /** 可选：把注意力框到某个区域（HUD 画高亮框），坐标是窗口内容坐标 */
  focus?: ScreenRecordFocus
  /** 可选：合成光标要移动到的位置（`capturePage` 不含系统指针，所以指针要自己画） */
  cursor?: ScreenRecordCursor
}

/** 高亮框（窗口内容坐标，单位 CSS 像素） */
export interface ScreenRecordFocus {
  x: number
  y: number
  width: number
  height: number
}

/** 合成光标位置；`click` 为真时 HUD 画一次点击涟漪 */
export interface ScreenRecordCursor {
  x: number
  y: number
  click?: boolean
}

/** 录制侧记录的步骤时间戳（**权威对齐依据**，旁白与字幕都按它算） */
export interface ScreenRecordStepMark {
  index: number
  title: string
  caption: string
  atMs: number
}

/** HUD 需要的全部状态：主进程推给渲染层，录制期间常驻显示 */
export interface ScreenRecordHudState {
  recording: boolean
  /** 录制开始的墙钟时间（渲染层自己算已录时长，避免每帧推时间） */
  startedAtMs?: number
  stepIndex?: number
  title?: string
  caption?: string
  focus?: ScreenRecordFocus
  cursor?: ScreenRecordCursor
  /** 已录帧数，仅用于指示条上的小字（可缺省） */
  frames?: number
}

/** 录制参数（渲染层/工具传入，规范化后使用） */
export interface ScreenRecordOptions {
  fps: number
  maxSeconds: number
}

export interface ScreenRecordOptionsResult {
  ok: boolean
  options: ScreenRecordOptions
  /** 被夹紧的项（如实上报，不静默改小） */
  adjusted: string[]
  /** 不合法时给出的原因键（渲染层/工具拼文案） */
  reasonKey?: string
}

/**
 * 规范化录制参数：**不静默夹紧** —— 用户要 30fps 就得告诉他上限是 15，
 * 否则他会以为录的是 30fps（观感差异真实存在）。
 */
export function normalizeScreenRecordOptions(input?: {
  fps?: number
  maxSeconds?: number
}): ScreenRecordOptionsResult {
  const adjusted: string[] = []
  const rawFps = typeof input?.fps === 'number' && Number.isFinite(input.fps) ? input.fps : NaN
  const rawSeconds =
    typeof input?.maxSeconds === 'number' && Number.isFinite(input.maxSeconds)
      ? input.maxSeconds
      : NaN

  if (typeof input?.fps === 'number' && (!Number.isFinite(input.fps) || rawFps < 1)) {
    return {
      ok: false,
      options: { fps: SCREEN_RECORD_LIMITS.fpsDefault, maxSeconds: 0 },
      adjusted,
      reasonKey: 'fpsInvalid'
    }
  }
  if (
    typeof input?.maxSeconds === 'number' &&
    (!Number.isFinite(input.maxSeconds) || rawSeconds < 1)
  ) {
    return {
      ok: false,
      options: { fps: SCREEN_RECORD_LIMITS.fpsDefault, maxSeconds: 0 },
      adjusted,
      reasonKey: 'durationInvalid'
    }
  }

  let fps = Number.isFinite(rawFps) ? Math.round(rawFps) : SCREEN_RECORD_LIMITS.fpsDefault
  if (fps > SCREEN_RECORD_LIMITS.fpsMax) {
    adjusted.push('fps')
    fps = SCREEN_RECORD_LIMITS.fpsMax
  }
  if (fps < SCREEN_RECORD_LIMITS.fpsMin) {
    adjusted.push('fps')
    fps = SCREEN_RECORD_LIMITS.fpsMin
  }

  let maxSeconds = Number.isFinite(rawSeconds)
    ? Math.round(rawSeconds)
    : SCREEN_RECORD_LIMITS.maxSeconds
  if (maxSeconds > SCREEN_RECORD_LIMITS.maxSeconds) {
    adjusted.push('maxSeconds')
    maxSeconds = SCREEN_RECORD_LIMITS.maxSeconds
  }

  return { ok: true, options: { fps, maxSeconds }, adjusted }
}

/** 一帧的指纹与时间 */
export interface CapturedFrame {
  /** 采样时刻（毫秒，相对录制开始） */
  atMs: number
  /** 画面指纹（见 `fingerprintOfBitmap`） */
  fingerprint: string
}

/** 计划保留的一帧（成片时间轴已按 maxHoldMs 压缩） */
export interface PlannedFrameKeep {
  /** 在 `CapturedFrame[]` 里的下标 */
  index: number
  /** 成片时间轴上的起点（毫秒，已压缩） */
  atMs: number
  /** 这一帧在成片里显示多久（毫秒，≤ maxHoldMs） */
  holdMs: number
  /** 该关键帧在录制墙钟上的时刻（步骤 alignment 映射用） */
  wallAtMs: number
  /** 墙钟上本段原时长（压缩前） */
  wallHoldMs: number
}

export interface FrameKeepPlan {
  keeps: PlannedFrameKeep[]
  /** 因与上一帧相同而丢掉的帧数（如实上报，便于解释「为什么成片比录制短」） */
  droppedIdle: number
  /** 成片总时长（毫秒，空闲已封顶） */
  durationMs: number
}

/**
 * 由「每帧指纹」算出**要写盘的关键帧与各自显示时长**。
 *
 * 规则：第一帧必留；之后只在指纹变化时留新帧；墙钟显示时长 = 与下一关键帧的时间差。
 * **空闲封顶**：墙钟 hold 超过 `maxHoldMs` 时，成片只保留 maxHoldMs（真正缩短时长，
 * 不是拆成多段仍加总）。步骤时间戳用 `wallAtMs` 映射到压缩轴。
 * **末帧**给最短停留（`tailHoldMs`），否则最后一步在成片里几乎看不见。
 */
export function planFrameKeeps(
  frames: CapturedFrame[],
  options?: { tailHoldMs?: number }
): FrameKeepPlan {
  if (!frames.length) return { keeps: [], droppedIdle: 0, durationMs: 0 }
  const tailHoldMs = Math.max(1, options?.tailHoldMs ?? DEFAULT_TAIL_HOLD_MS)
  const maxHold = SCREEN_RECORD_LIMITS.maxHoldMs

  const raw: Array<{ index: number; atMs: number }> = [{ index: 0, atMs: frames[0]!.atMs }]
  let droppedIdle = 0
  for (let i = 1; i < frames.length; i += 1) {
    const frame = frames[i]!
    if (frame.fingerprint === frames[raw[raw.length - 1]!.index]!.fingerprint) {
      droppedIdle += 1
      continue
    }
    raw.push({ index: i, atMs: frame.atMs })
  }

  const lastAtMs = frames[frames.length - 1]!.atMs
  const keeps: PlannedFrameKeep[] = []
  let compressedAt = 0
  for (let i = 0; i < raw.length; i += 1) {
    const current = raw[i]!
    const isLast = i + 1 >= raw.length
    const wallHold = isLast
      ? Math.max(tailHoldMs, lastAtMs - current.atMs)
      : Math.max(1, raw[i + 1]!.atMs - current.atMs)
    const holdMs = Math.min(wallHold, maxHold)
    keeps.push({
      index: current.index,
      atMs: compressedAt,
      holdMs,
      wallAtMs: current.atMs,
      wallHoldMs: wallHold
    })
    compressedAt += holdMs
  }
  return { keeps, droppedIdle, durationMs: compressedAt }
}

/** 墙钟毫秒 → 成片压缩时间轴毫秒 */
export function mapWallMsToCompressed(wallMs: number, keeps: PlannedFrameKeep[]): number {
  if (!keeps.length) return 0
  const t = Math.max(0, wallMs)
  for (const keep of keeps) {
    const wallEnd = keep.wallAtMs + keep.wallHoldMs
    if (t <= keep.wallAtMs) return keep.atMs
    if (t < wallEnd) {
      const into = t - keep.wallAtMs
      return keep.atMs + Math.min(into, keep.holdMs)
    }
  }
  const last = keeps[keeps.length - 1]!
  return last.atMs + last.holdMs
}

/**
 * 画面指纹：只看**稀疏采样**的少量像素，够判断「画面变没变」，且与分辨率无关。
 *
 * 逐像素比较在 1080p × 10fps 下太贵；这里按网格取点，用 FNV-1a 折成一个短串。
 */
export function fingerprintOfBitmap(
  bitmap: Uint8Array,
  width: number,
  height: number,
  grid = 16
): string {
  if (width <= 0 || height <= 0 || bitmap.length < 4) return 'empty'
  let hash = 0x811c9dc5
  const stepX = Math.max(1, Math.floor(width / grid))
  const stepY = Math.max(1, Math.floor(height / grid))
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const offset = (y * width + x) * 4
      // 只看亮度：BGRA 里 R/G/B 权重近似，省掉开方与浮点
      const b = bitmap[offset] ?? 0
      const g = bitmap[offset + 1] ?? 0
      const r = bitmap[offset + 2] ?? 0
      const luma = (r * 3 + g * 4 + b) >> 3
      hash ^= luma
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return (hash >>> 0).toString(16)
}

/**
 * 把「关键帧 + 各自显示时长」摊成**逐输出帧的源帧下标序列**（CFR）。
 *
 * ## 为什么不是 concat 清单 + `-vsync vfr`
 *
 * 那是第一版做法，实测有两个坑（本机 ffmpeg 9.0.2 验证）：
 * 1. **`-vsync` 在 ffmpeg 9 已被移除** —— 直接报 `Unrecognized option 'vsync'`，整段录制编不出来；
 * 2. 改用 concat 的 `duration` 行让它自己走时间轴，**加 `-r` 变成 CFR 后时长会膨胀**
 *    （3 秒的料编出 3.9 秒：concat 要求末帧重复一次，那一次被当成一整帧时长展开）；
 *    再补 `-t` 截断又会把最后一段提前切掉（实测 2.04 秒）。
 *
 * 换成最无聊也最可预测的那条：把停留时长**展开成重复帧**（用硬链接，不占额外磁盘），
 * 走 image2 + `-framerate`。实测时长精确到 3.000000 秒，而且 `-framerate` / image2
 * 每个 ffmpeg 版本都有 —— 不依赖任何会被移除的选项。
 *
 * 用**累计目标帧数**而不是逐段四舍五入：逐段取整会让误差累积（100 步能偏出好几秒），
 * 累计口径下总误差不超过一帧。
 */
export function planFrameSequence(keeps: PlannedFrameKeep[], fps: number): number[] {
  const safeFps = Math.max(1, Math.round(fps))
  const order: number[] = []
  let emitted = 0
  for (const keep of keeps) {
    const targetFrames = Math.round(((keep.atMs + keep.holdMs) / 1000) * safeFps)
    const frames = Math.max(1, targetFrames - emitted)
    for (let i = 0; i < frames; i += 1) order.push(keep.index)
    emitted += frames
  }
  return order
}

/**
 * 帧序列 → H.264 MP4 的编码参数。
 *
 * `seqPatternPath` 形如 `<dir>/f-%04d.png`：image2 按序号读帧；`-framerate` 定输入帧率、
 * `-r` 定输出帧率（两者相同 → CFR，播放器与剪辑软件都友好）。
 */
export function buildImageSequenceArgs(input: {
  seqPatternPath: string
  outPath: string
  fps: number
}): string[] {
  const fps = String(Math.max(1, Math.round(input.fps)))
  return [
    '-y',
    '-framerate',
    fps,
    '-i',
    input.seqPatternPath,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-r',
    fps,
    '-movflags',
    '+faststart',
    input.outPath
  ]
}

/** 一步在成片里的时间区间（秒），给旁白与字幕对齐用 */
export interface StepAlignment {
  index: number
  title: string
  caption: string
  startSec: number
  endSec: number
}

/**
 * 步骤时间戳 → 对齐表（映射到成片压缩时间轴）。
 *
 * `keeps` 来自 `planFrameKeeps`：把墙钟 `step.atMs` 映到压缩轴，口播/字幕才跟得上裁掉的空闲。
 * 未传 keeps 时退回墙钟轴（兼容旧测试 / 无帧计划场景）。
 */
export function buildAlignmentTable(
  steps: ScreenRecordStepMark[],
  totalMs: number,
  keeps?: PlannedFrameKeep[]
): StepAlignment[] {
  const sorted = [...steps].sort((a, b) => a.atMs - b.atMs)
  const map = (wallMs: number): number =>
    keeps?.length ? mapWallMsToCompressed(wallMs, keeps) : wallMs
  const compressedTotal = keeps?.length
    ? keeps[keeps.length - 1]!.atMs + keeps[keeps.length - 1]!.holdMs
    : totalMs
  return sorted.map((step, i) => {
    const next = sorted[i + 1]
    const startMs = map(step.atMs)
    const endMs = next ? map(next.atMs) : Math.max(compressedTotal, startMs + 1000)
    return {
      index: step.index,
      title: step.title,
      caption: step.caption,
      startSec: Number((startMs / 1000).toFixed(3)),
      endSec: Number((Math.max(endMs, startMs + 50) / 1000).toFixed(3))
    }
  })
}

/** 录制结果：失败一律返回原因键（主进程不产出成品文案） */
export type ScreenRecordStopResult =
  | {
      ok: true
      /** 工程内相对路径 */
      relativePath: string
      assetId?: string
      durationSec: number
      /** 实际写盘的帧数（空闲合并之后） */
      frames: number
      droppedIdle: number
      steps: ScreenRecordStepMark[]
      alignment: StepAlignment[]
      warnings: string[]
    }
  | { ok: false; reasonKey: string; params?: Record<string, string | number> }
