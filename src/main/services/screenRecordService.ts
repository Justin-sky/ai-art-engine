/**
 * 应用界面录制：把「界面上的操作过程」录成 MP4，供教学视频合成使用。
 *
 * ## 为什么是「自己画 HUD + 截自己的窗口」
 *
 * `webContents.capturePage()` 拍的是**该窗口渲染出来的页面**（与遮挡无关，也不含系统鼠标指针）。
 * 于是两件事同时成立：
 * - 不需要 `desktopCapturer`（那是「录整个桌面」，权限面与隐私面都大得多）；
 * - **指针与高亮必须由页面自己画** —— 录制 HUD 组件就是干这个的，它被一并拍进画面，
 *   后期不需要任何合成。
 *
 * ## 帧为什么不是「按帧率全写盘」
 *
 * 对话驱动的录制里，模型与工具调用之间常停顿十几秒；按 10fps 硬录 3 分钟 = 1800 张 PNG
 * （数百 MB），而且成片里大半是静止画面。这里的做法是：
 * 逐帧算**指纹**（`fingerprintOfBitmap`），只有画面真的变了才写盘；每帧显示多久由
 * `planFrameKeeps` 按时间戳算出，并把超过 `maxHoldMs` 的静止段**封顶**（真正缩短成片，
 * 不是拆帧加总）。展开为 CFR 图序后用 image2 编码。
 */
import {
  copyFileSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { IpcChannels } from '@shared/ipc'
import {
  SCREEN_RECORD_LIMITS,
  buildAlignmentTable,
  buildImageSequenceArgs,
  fingerprintOfBitmap,
  normalizeScreenRecordOptions,
  planFrameKeeps,
  planFrameSequence,
  type CapturedFrame,
  type ScreenRecordHudState,
  type ScreenRecordOptions,
  type ScreenRecordStepInput,
  type ScreenRecordStepMark,
  type ScreenRecordStopResult
} from '@shared/screenRecord'
import { getMainWindowRef } from '../mainWindowRef'
import { broadcastToAllWindows } from '../broadcast'
import { findFfmpegBin, probeDurationSec } from './videoFrameService'
import { isFfmpegInstalling } from './ffmpegInstallService'
import { runFfmpeg } from './ffmpegRunner'
import { projectService } from './projectService'

/** 临时目录可用字节；探测不到返回 null（老 Node / 异常文件系统），此时跳过预检而不是拒绝录制 */
function readFreeBytes(dir: string): number | null {
  try {
    const stat = statfsSync(dir)
    return Number(stat.bavail) * Number(stat.bsize)
  } catch {
    return null
  }
}

/** 一帧采样结果：指纹用于判重，`file` 只在**首次出现该画面**时写盘 */
interface SampledFrame extends CapturedFrame {
  file?: string
}

interface ActiveRecording {
  options: ScreenRecordOptions
  startedAtMs: number
  workDir: string
  target: BrowserWindow
  /** 开始时固定下来的内容尺寸：窗口被拖动后仍按同尺寸裁切，避免编码时尺寸不一致 */
  captureWidth: number
  captureHeight: number
  frames: SampledFrame[]
  steps: ScreenRecordStepMark[]
  timer: ReturnType<typeof setTimeout> | null
  stopping: boolean
  /** 到点自动停（时长上限）时用的是同一套收尾逻辑 */
  autoStopReason: string | null
  /** 已写盘字节数：到 `maxTempBytes` 就收尾，别等到磁盘满 */
  writtenBytes: number
  droppedCaptures: number
  droppedWrites: number
  /** 窗口关闭时收尾用的监听器（正常结束后要摘掉，否则会留着调用 stop） */
  onTargetClosed: (() => void) | null
}

let active: ActiveRecording | null = null

/**
 * 「正在启动」占位标志。
 *
 * `startScreenRecording` 里有 `await`（探测 ffmpeg），而 `active` 是在 await 之后才赋值的；
 * 两个并发的 start（同一轮里并行发两个 MCP 调用、或 agent + 渲染层同时触发）都会通过
 * `if (active)` 检查，于是两段录制同时跑、后者覆盖前者，前者的定时器与临时目录永久泄漏。
 * 这里同步占位把那个窗口关掉。
 */
let starting = false

/**
 * 最近一次录制结果（含自动收尾那一次）。
 *
 * 自动停（到时长/字节上限）是在采样回调里触发的，它的返回值没人接 —— agent 随后调
 * `screen_record_stop` 只会得到「当前没有在录制」，拿不到 relativePath/alignment，
 * `tutorial_compose` 就接不上。这里把结果留一份，`status` / `stop` 都能取到。
 */
let lastResult: ScreenRecordStopResult | null = null

/** 自动收尾时的通知钩子：MCP 层注册，用来出对话预览卡（服务层不 import 上层） */
let finishListener: ((result: ScreenRecordStopResult) => void) | null = null

export function setScreenRecordFinishListener(
  listener: ((result: ScreenRecordStopResult) => void) | null
): void {
  finishListener = listener
}

/** 取走最近一次结果（取走即清空，避免同一段录屏被反复合成） */
export function takeLastScreenRecordResult(): ScreenRecordStopResult | null {
  const result = lastResult
  lastResult = null
  return result
}

function hudStateOf(
  recording: ActiveRecording | null,
  evt: Partial<ScreenRecordHudState> = {}
): ScreenRecordHudState {
  if (!recording) return { recording: false }
  const last = recording.steps[recording.steps.length - 1]
  return {
    recording: true,
    startedAtMs: recording.startedAtMs,
    frames: recording.frames.length,
    ...(last ? { stepIndex: last.index, title: last.title, caption: last.caption } : {}),
    ...evt
  }
}

function pushHud(state: ScreenRecordHudState): void {
  broadcastToAllWindows(IpcChannels.SCREEN_RECORD_HUD, state)
}

/** 采样一帧：固定 rect → 尺寸恒定；指纹相同就不写盘 */
async function sampleFrame(recording: ActiveRecording): Promise<void> {
  const { target } = recording
  if (recording.stopping) return
  // 窗口没了就**收尾**，不是静默停摆：以前这里直接 return，定时器链断掉、
  // active 永远不为空（start 一直回「已在录制」、HUD 不灭、临时目录留到退出）
  if (target.isDestroyed()) {
    void stopScreenRecording()
    return
  }
  const atMs = Date.now() - recording.startedAtMs
  try {
    let image = await target.webContents.capturePage({
      x: 0,
      y: 0,
      width: recording.captureWidth,
      height: recording.captureHeight
    })
    // 页面不可见（最小化 / 锁屏 / 合成器抖动）时可能拿到空图：空图写盘就是一张坏帧
    if (image.isEmpty()) {
      recording.droppedCaptures += 1
    } else {
      const size = image.getSize()
      if (size.width !== recording.captureWidth || size.height !== recording.captureHeight) {
        // 尺寸变了（窗口被拖动 / 换到不同缩放的显示器）：拉回固定尺寸，保证序列同尺寸
        image = image.resize({
          width: recording.captureWidth,
          height: recording.captureHeight,
          quality: 'good'
        })
      }
      const bitmap = image.toBitmap()
      const fingerprint = fingerprintOfBitmap(
        new Uint8Array(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength),
        recording.captureWidth,
        recording.captureHeight
      )
      const previous = recording.frames[recording.frames.length - 1]
      const frame: SampledFrame = { atMs, fingerprint }
      if (!previous || previous.fingerprint !== fingerprint) {
        const file = join(recording.workDir, `frame-${recording.frames.length}.png`)
        try {
          const png = image.toPNG()
          writeFileSync(file, png)
          frame.file = file
          recording.writtenBytes += png.byteLength
        } catch {
          // 写失败要计数：以前静默吞掉，产出少几帧而调用方毫不知情
          recording.droppedWrites += 1
        }
      }
      recording.frames.push(frame)
    }
  } catch {
    // 单帧抓取失败不该中断整段录制（窗口最小化、合成器抖动等都可能失败）；缺失的帧由时间戳补上
    recording.droppedCaptures += 1
  }

  const overBytes = recording.writtenBytes >= SCREEN_RECORD_LIMITS.maxTempBytes
  const overSeconds = atMs >= recording.options.maxSeconds * 1000
  const overFrames = recording.frames.length >= SCREEN_RECORD_LIMITS.maxFrames
  if (overBytes || overSeconds || overFrames) {
    recording.autoStopReason = overBytes ? 'maxBytes' : overSeconds ? 'maxSeconds' : 'maxFrames'
    // 结果留一份给之后可能到来的 stop/status（否则 agent 拿不到 relativePath/alignment）
    void stopScreenRecording()
    return
  }
  if (!recording.stopping) scheduleNext(recording)
}

/** 用「抓完再排下一次」而不是 setInterval：抓取本身耗时，固定间隔会堆叠出并发抓取 */
function scheduleNext(recording: ActiveRecording): void {
  const interval = Math.max(1, Math.round(1000 / recording.options.fps))
  recording.timer = setTimeout(() => {
    void sampleFrame(recording)
  }, interval)
}

export interface StartScreenRecordingResult {
  ok: boolean
  reasonKey?: string
  fps?: number
  maxSeconds?: number
  adjusted?: string[]
}

export async function startScreenRecording(input?: {
  fps?: number
  maxSeconds?: number
}): Promise<StartScreenRecordingResult> {
  // 同步占位：下面有 await，只查 active 会让两个并发 start 都通过（见 starting 的注释）
  if (active || starting) return { ok: false, reasonKey: 'alreadyRecording' }
  starting = true
  try {
    const normalized = normalizeScreenRecordOptions(input)
    if (!normalized.ok) return { ok: false, reasonKey: normalized.reasonKey ?? 'badOptions' }

    // 先确认工程与 ffmpeg：录完才发现编不了码，等于白录一遍
    if (!projectService.isOpen()) return { ok: false, reasonKey: 'projectNotOpen' }
    if (isFfmpegInstalling()) return { ok: false, reasonKey: 'ffmpegInstalling' }
    const bin = findFfmpegBin()
    try {
      await runFfmpeg(bin, ['-version'], undefined, { timeoutMs: 20_000 })
    } catch {
      return { ok: false, reasonKey: 'ffmpegMissing' }
    }

    const target = getMainWindowRef()
    if (!target) return { ok: false, reasonKey: 'noTargetWindow' }

    const [width, height] = target.getContentSize()
    if (!width || !height) return { ok: false, reasonKey: 'noTargetWindow' }

    // 磁盘预检：最坏情况要写 maxTempBytes，剩不下就现在拒绝，而不是录到一半写失败
    const freeBytes = readFreeBytes(tmpdir())
    if (freeBytes !== null && freeBytes < SCREEN_RECORD_LIMITS.maxTempBytes / 2) {
      return {
        ok: false,
        reasonKey: 'lowDiskSpace',
        adjusted: [],
        fps: normalized.options.fps,
        maxSeconds: normalized.options.maxSeconds
      }
    }

    const workDir = mkdtempSync(join(tmpdir(), 'aae-screen-record-'))
    const recording: ActiveRecording = {
      options: normalized.options,
      startedAtMs: Date.now(),
      workDir,
      target,
      captureWidth: width,
      captureHeight: height,
      frames: [],
      steps: [],
      timer: null,
      stopping: false,
      autoStopReason: null,
      writtenBytes: 0,
      droppedCaptures: 0,
      droppedWrites: 0,
      onTargetClosed: null
    }
    // 窗口中途被关掉也要把已录的编出来（否则 HUD 不灭、active 不清、临时目录留到退出）
    recording.onTargetClosed = (): void => {
      if (active === recording) void stopScreenRecording()
    }
    target.once('closed', recording.onTargetClosed)
    active = recording
    pushHud(hudStateOf(active))
    scheduleNext(active)
    return {
      ok: true,
      fps: normalized.options.fps,
      maxSeconds: normalized.options.maxSeconds,
      adjusted: normalized.adjusted
    }
  } finally {
    // active 已就位（或在上面早返回），现在解除占位：顺序不能反，否则中间有一个空窗
    starting = false
  }
}

export interface StepScreenRecordingResult {
  ok: boolean
  reasonKey?: string
  index?: number
}

export function stepScreenRecording(input: ScreenRecordStepInput): StepScreenRecordingResult {
  if (!active) {
    // 正在启动（await ffmpeg 探测）时不要说「没在录」，那会把 agent 引向错误的重试动作
    return { ok: false, reasonKey: starting ? 'startingRecording' : 'notRecording' }
  }
  const title = (input?.title ?? '').trim()
  if (!title) return { ok: false, reasonKey: 'stepTitleRequired' }
  const mark: ScreenRecordStepMark = {
    index: active.steps.length,
    title,
    caption: (input?.caption ?? title).trim(),
    atMs: Date.now() - active.startedAtMs
  }
  active.steps.push(mark)
  pushHud(
    hudStateOf(active, {
      title: mark.title,
      caption: mark.caption,
      stepIndex: mark.index,
      ...(input.focus ? { focus: input.focus } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {})
    })
  )
  return { ok: true, index: mark.index }
}

/**
 * 不新增步骤，只刷新当前 HUD 的 focus/cursor（点运行后按钮换成停止、布局位移时用）。
 */
export function patchScreenRecordingHud(input: {
  focus?: ScreenRecordStepInput['focus']
  cursor?: ScreenRecordStepInput['cursor']
  title?: string
  caption?: string
}): { ok: boolean; reasonKey?: string } {
  if (!active) return { ok: false, reasonKey: 'notRecording' }
  const last = active.steps[active.steps.length - 1]
  pushHud(
    hudStateOf(active, {
      ...(last ? { stepIndex: last.index, title: last.title, caption: last.caption } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.caption ? { caption: input.caption } : {}),
      ...(input.focus ? { focus: input.focus } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {})
    })
  )
  return { ok: true }
}

export function screenRecordingStatus(): {
  recording: boolean
  starting: boolean
  startedAtMs?: number
  frames: number
  steps: ScreenRecordStepMark[]
  /** 最近一次录制（含自动收尾）的结果是否还在手上 */
  hasPendingResult: boolean
} {
  if (!active) {
    return {
      recording: false,
      starting,
      frames: 0,
      steps: [],
      hasPendingResult: lastResult !== null
    }
  }
  return {
    recording: true,
    starting: false,
    startedAtMs: active.startedAtMs,
    frames: active.frames.length,
    steps: [...active.steps],
    hasPendingResult: lastResult !== null
  }
}

export async function stopScreenRecording(): Promise<ScreenRecordStopResult> {
  const recording = active
  if (!recording) {
    // 自动收尾已经跑完：把那次结果交出去，而不是回一句「没有在录制」让 agent 卡住
    const pending = takeLastScreenRecordResult()
    if (pending) return pending
    return { ok: false, reasonKey: starting ? 'startingRecording' : 'notRecording' }
  }
  if (recording.stopping) {
    // 正在编码（stopping=true）：如实说是「收尾中」，不要和「什么都没录」混为一谈
    return { ok: false, reasonKey: 'stopping' }
  }
  recording.stopping = true
  if (recording.timer) clearTimeout(recording.timer)
  recording.timer = null
  if (recording.onTargetClosed) {
    // 摘掉窗口关闭监听：留着的话，本段结束后窗口被关会再触发一次 stop
    try {
      recording.target.removeListener('closed', recording.onTargetClosed)
    } catch {
      /* 窗口可能已经没了 */
    }
    recording.onTargetClosed = null
  }

  try {
    const sampled = recording.frames.filter((frame) => frame.file)
    if (!sampled.length) {
      pushHud({ recording: false })
      return { ok: false, reasonKey: 'emptyRecording' }
    }

    const plan = planFrameKeeps(recording.frames)
    const withFile = plan.keeps.filter((keep) => recording.frames[keep.index]?.file)
    if (!withFile.length) {
      pushHud({ recording: false })
      return { ok: false, reasonKey: 'emptyRecording' }
    }
    // 缺文件的关键帧跳过后再压一次时间轴，保证编码与 alignment 同源
    let packedAt = 0
    const firstWall = recording.frames[0]!.atMs
    const packed = withFile.map((keep) => {
      const row = {
        ...keep,
        atMs: packedAt,
        wallAtMs: Math.max(0, keep.wallAtMs - firstWall)
      }
      packedAt += keep.holdMs
      return row
    })

    /**
     * 把停留时长展开成重复帧（CFR 输入）。
     *
     * 重复帧用**硬链接**而不是复制：同一张 PNG 出现 10 次只占一份磁盘，而 image2 + `-framerate`
     * 是唯一在 ffmpeg 9 上实测时长精确的写法（concat + `-vsync` 的坑见 `planFrameSequence` 注释）。
     * 硬链接失败（跨卷等）时退回复制 —— 只是多占点磁盘，结果不变。
     */
    const seqDir = join(recording.workDir, 'seq')
    mkdirSync(seqDir, { recursive: true })
    const order = planFrameSequence(packed, recording.options.fps)
    order.forEach((sourceIndex, i) => {
      const source = recording.frames[sourceIndex]!.file!
      const dest = join(seqDir, `f-${String(i + 1).padStart(4, '0')}.png`)
      try {
        linkSync(source, dest)
      } catch {
        copyFileSync(source, dest)
      }
    })

    const outPath = join(recording.workDir, 'recording.mp4')
    // 编码阶段：HUD 从「● 录制中」切成「编码中 x%」——此前这段时间指示还在装作在录、计时还在走
    pushHud({ recording: false, phase: 'encoding', progress: 0 })
    const totalEncodeSec = Math.max(0.1, order.length / recording.options.fps)
    let lastProgressPush = 0
    await runFfmpeg(
      findFfmpegBin(),
      buildImageSequenceArgs({
        seqPatternPath: join(seqDir, 'f-%04d.png'),
        outPath,
        fps: recording.options.fps
      }),
      (sec) => {
        const now = Date.now()
        if (now - lastProgressPush < 500) return
        lastProgressPush = now
        pushHud({
          recording: false,
          phase: 'encoding',
          progress: Math.max(0, Math.min(1, Number((sec / totalEncodeSec).toFixed(3))))
        })
      },
      { timeoutMs: SCREEN_RECORD_LIMITS.encodeTimeoutMs }
    )

    // 产物校验：以前「ffmpeg 退出码 0」就直接登记，坏文件/空文件也照样当成功
    let sizeBytes = 0
    try {
      sizeBytes = statSync(outPath).size
    } catch {
      sizeBytes = 0
    }
    const probedSec = await probeDurationSec(outPath).catch(() => null)
    if (sizeBytes < 1024 || (probedSec !== null && probedSec < 0.2)) {
      throw new Error(`编码产物不可用（size=${sizeBytes}B, duration=${probedSec ?? '未知'}s）`) // cjk-ok（面向 Agent 的编码失败诊断，不进界面文案表）
    }

    // 成片时长以**实际帧数**为准（CFR）：这与展开出来的帧序列严格一致
    const durationSec = Number((order.length / recording.options.fps).toFixed(3))
    const stepsForAlign = recording.steps.map((step) => ({
      ...step,
      atMs: Math.max(0, step.atMs - firstWall)
    }))

    // 与对话 generate_video 同一口径：落 Cache/Videos，不自动进资产库。
    // 对话流靠 relativePath 出预览卡；用户点「保存到资产库」再入库，避免资产库与对话卡重复。
    const saved = projectService.attachExternalGeneratedFile({
      type: 'video',
      sourceFilePath: outPath,
      // 文件名标识用时间戳保证可区分；不进界面文案表
      name: `recording-${new Date(recording.startedAtMs).toISOString().slice(0, 19).replace(/[:T]/g, '')}`
    })

    const warnings: string[] = []
    if (recording.autoStopReason === 'maxSeconds') warnings.push('autoStoppedMaxSeconds')
    if (recording.autoStopReason === 'maxFrames') warnings.push('autoStoppedMaxFrames')
    if (recording.autoStopReason === 'maxBytes') warnings.push('autoStoppedMaxBytes')
    if (recording.droppedCaptures > 0) warnings.push('droppedCaptures')
    if (recording.droppedWrites > 0) warnings.push('droppedWrites')

    const result: ScreenRecordStopResult = {
      ok: true,
      relativePath: saved.relativePath,
      assetId: saved.id,
      durationSec,
      // 写盘的 PNG 数（空闲帧合并之后的唯一画面数），不是 concat 条目数
      frames: sampled.length,
      droppedIdle: plan.droppedIdle,
      droppedCaptures: recording.droppedCaptures,
      droppedWrites: recording.droppedWrites,
      steps: [...recording.steps],
      alignment: buildAlignmentTable(stepsForAlign, packedAt, packed),
      warnings
    }

    pushHud({ recording: false })
    // 自动收尾时没人接返回值：留一份给之后的 stop/status，并通知 MCP 层出预览卡
    lastResult = result
    if (recording.autoStopReason) {
      try {
        finishListener?.(result)
      } catch {
        /* 通知失败不影响交付物 */
      }
    }
    return result
  } catch (err) {
    pushHud({ recording: false })
    return {
      ok: false,
      reasonKey: 'encodeFailed',
      params: {
        detail: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300)
      }
    }
  } finally {
    active = null
    try {
      rmSync(recording.workDir, { recursive: true, force: true })
    } catch {
      /* 临时目录清理失败不影响交付物 */
    }
  }
}

/** 应用退出前收尾：不留定时器，也不留临时目录 */
export function abortScreenRecording(): void {
  const recording = active
  if (!recording) return
  if (recording.timer) clearTimeout(recording.timer)
  active = null
  try {
    rmSync(recording.workDir, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

/** 供测试与调试：当前是否有录制在跑 */
export function isScreenRecording(): boolean {
  return active !== null
}
