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
 * `planFrameKeeps` 按时间戳算出，编码用 concat + `-vsync vfr`（不是定帧率重采样，
 * 否则丢掉的帧会被又补回来）。
 */
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
import { findFfmpegBin } from './videoFrameService'
import { isFfmpegInstalling } from './ffmpegInstallService'
import { runFfmpeg } from './ffmpegRunner'
import { projectService } from './projectService'

/** 录制产物落在资产库目录（而不是 Cache）：教学视频是**交付物**，用户要能在资产库里找到它 */
const RECORDING_OUTPUT_DIR = 'Assets/Recordings'

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
}

let active: ActiveRecording | null = null

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
  if (target.isDestroyed() || recording.stopping) return
  const atMs = Date.now() - recording.startedAtMs
  try {
    const image = await target.webContents.capturePage({
      x: 0,
      y: 0,
      width: recording.captureWidth,
      height: recording.captureHeight
    })
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
      writeFileSync(file, image.toPNG())
      frame.file = file
    }
    recording.frames.push(frame)
  } catch {
    // 单帧抓取失败不该中断整段录制（窗口最小化、合成器抖动等都可能失败）；缺失的帧由时间戳补上
  }

  if (
    recording.frames.length >= SCREEN_RECORD_LIMITS.maxFrames ||
    atMs >= recording.options.maxSeconds * 1000
  ) {
    recording.autoStopReason =
      atMs >= recording.options.maxSeconds * 1000 ? 'maxSeconds' : 'maxFrames'
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
  if (active) return { ok: false, reasonKey: 'alreadyRecording' }

  const normalized = normalizeScreenRecordOptions(input)
  if (!normalized.ok) return { ok: false, reasonKey: normalized.reasonKey ?? 'badOptions' }

  // 先确认工程与 ffmpeg：录完才发现编不了码，等于白录一遍
  if (!projectService.isOpen()) return { ok: false, reasonKey: 'projectNotOpen' }
  if (isFfmpegInstalling()) return { ok: false, reasonKey: 'ffmpegInstalling' }
  const bin = findFfmpegBin()
  try {
    await runFfmpeg(bin, ['-version'])
  } catch {
    return { ok: false, reasonKey: 'ffmpegMissing' }
  }

  const target = getMainWindowRef()
  if (!target) return { ok: false, reasonKey: 'noTargetWindow' }

  const [width, height] = target.getContentSize()
  if (!width || !height) return { ok: false, reasonKey: 'noTargetWindow' }

  const workDir = mkdtempSync(join(tmpdir(), 'aae-screen-record-'))
  active = {
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
    autoStopReason: null
  }
  pushHud(hudStateOf(active))
  scheduleNext(active)
  return {
    ok: true,
    fps: normalized.options.fps,
    maxSeconds: normalized.options.maxSeconds,
    adjusted: normalized.adjusted
  }
}

export interface StepScreenRecordingResult {
  ok: boolean
  reasonKey?: string
  index?: number
}

export function stepScreenRecording(input: ScreenRecordStepInput): StepScreenRecordingResult {
  if (!active) return { ok: false, reasonKey: 'notRecording' }
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

export function screenRecordingStatus(): {
  recording: boolean
  startedAtMs?: number
  frames: number
  steps: ScreenRecordStepMark[]
} {
  if (!active) return { recording: false, frames: 0, steps: [] }
  return {
    recording: true,
    startedAtMs: active.startedAtMs,
    frames: active.frames.length,
    steps: [...active.steps]
  }
}

export async function stopScreenRecording(): Promise<ScreenRecordStopResult> {
  const recording = active
  if (!recording) return { ok: false, reasonKey: 'notRecording' }
  if (recording.stopping) return { ok: false, reasonKey: 'notRecording' }
  recording.stopping = true
  if (recording.timer) clearTimeout(recording.timer)
  recording.timer = null

  try {
    const sampled = recording.frames.filter((frame) => frame.file)
    if (!sampled.length) {
      pushHud({ recording: false })
      return { ok: false, reasonKey: 'emptyRecording' }
    }

    const plan = planFrameKeeps(recording.frames)
    const kept = plan.keeps.filter((keep) => recording.frames[keep.index]?.file)
    if (!kept.length) {
      pushHud({ recording: false })
      return { ok: false, reasonKey: 'emptyRecording' }
    }

    /**
     * 把停留时长展开成重复帧（CFR 输入）。
     *
     * 重复帧用**硬链接**而不是复制：同一张 PNG 出现 10 次只占一份磁盘，而 image2 + `-framerate`
     * 是唯一在 ffmpeg 9 上实测时长精确的写法（concat + `-vsync` 的坑见 `planFrameSequence` 注释）。
     * 硬链接失败（跨卷等）时退回复制 —— 只是多占点磁盘，结果不变。
     */
    const seqDir = join(recording.workDir, 'seq')
    mkdirSync(seqDir, { recursive: true })
    const order = planFrameSequence(kept, recording.options.fps)
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
    await runFfmpeg(
      findFfmpegBin(),
      buildImageSequenceArgs({
        seqPatternPath: join(seqDir, 'f-%04d.png'),
        outPath,
        fps: recording.options.fps
      })
    )

    // 成片时长以**实际帧数**为准（CFR）：这与展开出来的帧序列严格一致
    const durationSec = Number((order.length / recording.options.fps).toFixed(3))
    const totalMs = recording.frames[recording.frames.length - 1]!.atMs
    const firstMs = recording.frames[0]!.atMs

    const asset = projectService.attachExternalGeneratedFile({
      type: 'video',
      sourceFilePath: outPath,
      // 资产名是**文件与资产库里的标识**，不进界面文案表；用时间戳保证可区分
      name: `recording-${new Date(recording.startedAtMs).toISOString().slice(0, 19).replace(/[:T]/g, '')}`,
      outputDir: RECORDING_OUTPUT_DIR
    })
    broadcastToAllWindows(IpcChannels.ASSET_UPDATED, asset)

    const warnings: string[] = []
    if (recording.autoStopReason === 'maxSeconds') warnings.push('autoStoppedMaxSeconds')
    if (recording.autoStopReason === 'maxFrames') warnings.push('autoStoppedMaxFrames')

    pushHud({ recording: false })
    return {
      ok: true,
      relativePath: asset.relativePath,
      assetId: asset.id,
      durationSec,
      // 写盘的 PNG 数（空闲帧合并之后的唯一画面数），不是 concat 条目数
      frames: sampled.length,
      droppedIdle: plan.droppedIdle,
      steps: [...recording.steps],
      alignment: buildAlignmentTable(recording.steps, totalMs - firstMs),
      warnings
    }
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
