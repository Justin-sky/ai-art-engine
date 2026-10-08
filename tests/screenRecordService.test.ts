import { existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 录制服务的**行为**测试（不再只是「源码里有这个字符串」）。
 *
 * 这一层以前只有源码守卫：审查时实测「整个 sampleFrame 删掉」「整段编码调用删掉」都能让
 * 守卫全绿。这里用仓库已有的 `vi.mock('electron')` 惯例，把 Electron / ffmpeg / 工程服务
 * 都换成可控替身，真跑 capture→stop 这条链，钉住四件审查发现的缺陷：
 *
 * - **自动停接力**：到上限自动收尾后，之后的 `stop` 必须交回那次结果，而不是「没有在录制」；
 * - **TOCTOU**：并发两次 start 只能有一段录制（否则定时器与临时目录永久泄漏）；
 * - **产物校验**：ffmpeg「退出码 0」但产物是空文件时，不能当成功登记；
 * - **空图**：页面不可见拿到空图时要跳过（并计数），不是把坏帧写进序列。
 */

const broadcast = vi.fn()
const runFfmpeg = vi.fn()
const probeDurationSec = vi.fn()
const attachExternalGeneratedFile = vi.fn()

vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('../src/main/broadcast', () => ({
  broadcastToAllWindows: (...args: unknown[]) => broadcast(...args)
}))
vi.mock('../src/main/services/ffmpegRunner', () => ({
  runFfmpeg: (...args: unknown[]) => runFfmpeg(...args)
}))
vi.mock('../src/main/services/ffmpegInstallService', () => ({
  isFfmpegInstalling: () => false
}))
vi.mock('../src/main/services/videoFrameService', () => ({
  findFfmpegBin: () => 'ffmpeg',
  probeDurationSec: (...args: unknown[]) => probeDurationSec(...args)
}))
vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => true,
    getRoot: () => tmpdir(),
    attachExternalGeneratedFile: (...args: unknown[]) => attachExternalGeneratedFile(...args)
  }
}))

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 等条件成立，而不是「睡固定毫秒」。
 *
 * 采样是真实定时器 + 真实异步抓帧，全量套件并行跑时 CPU 抢占会让固定 sleep 变脆
 * （单跑绿、全量红）；按条件等待才是在测行为，不是在测机器快慢。
 */
async function waitFor(predicate: () => boolean, timeoutMs = 8000, stepMs = 25): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true
    await sleep(stepMs)
  }
  return predicate()
}

/**
 * 可控的假图像：可切换空图；**按抓取次数**切画面，让空闲合并的判定与机器快慢无关
 * （用 sleep 凑「同一画面被采了好几次」在全量套件并行时会翻车）。
 */
const imageState = { empty: false, calls: 0, changeEvery: 6 }
function makeImage(): Record<string, unknown> {
  const bitmap = Buffer.alloc(640 * 360 * 4)
  // 每 changeEvery 次抓取换一个「画面」，中间那些采样指纹相同 → 必然被判为空闲帧
  const bucket = Math.floor(imageState.calls / imageState.changeEvery)
  bitmap[0] = bucket % 251
  const image: Record<string, unknown> = {
    isEmpty: () => imageState.empty,
    getSize: () => ({ width: 640, height: 360 }),
    toBitmap: () => bitmap,
    toPNG: () => Buffer.alloc(2048, 7),
    resize: () => image
  }
  return image
}

const windowState = { destroyed: false }
const closedListeners: Array<() => void> = []
const fakeWindow = {
  isDestroyed: () => windowState.destroyed,
  getContentSize: () => [640, 360],
  webContents: {
    capturePage: async () => {
      imageState.calls += 1
      return makeImage()
    }
  },
  once: (event: string, cb: () => void) => {
    if (event === 'closed') closedListeners.push(cb)
  },
  removeListener: (event: string, cb: () => void) => {
    if (event !== 'closed') return
    const at = closedListeners.indexOf(cb)
    if (at >= 0) closedListeners.splice(at, 1)
  }
}

async function loadService() {
  vi.resetModules()
  const ref = await import('../src/main/mainWindowRef')
  ref.setMainWindowRef(fakeWindow as never)
  const service = await import('../src/main/services/screenRecordService')
  currentService = service
  return service
}

/** 当前测试加载到的服务实例（`loadService` 每次 resetModules，收尾要对它做） */
let currentService: Awaited<ReturnType<typeof loadService>> | null = null

function leftoverWorkDirs(): string[] {
  try {
    // 只认本服务的工作目录：`aae-screen-record-` + mkdtemp 的 6 位随机后缀。
    // 宽松前缀会连 `aae-screen-record-encode-…`（另一个测试文件的目录）一起数进来，
    // 全量并行时就是互相干扰的假红。
    return readdirSync(tmpdir()).filter((name) => /^aae-screen-record-[A-Za-z0-9]{6}$/.test(name))
  } catch {
    return []
  }
}

/**
 * 清掉本套件遗留的临时工作目录。
 *
 * 一个用例断言失败会跳过它自己的收尾，残留目录就会让**后面的用例**跟着红（串扰）。
 * 这些是本套件自己造出来的垃圾，开跑前清干净，`leftoverWorkDirs()` 才是在说当前用例的事。
 */
function cleanStaleWorkDirs(): void {
  for (const name of leftoverWorkDirs()) {
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true })
    } catch {
      /* 被占用就算了 */
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  imageState.empty = false
  imageState.calls = 0
  windowState.destroyed = false
  closedListeners.length = 0
  cleanStaleWorkDirs()
  // 默认：ffmpeg 探测与编码都成功，并且在 args 末尾写出一个「非空产物」
  runFfmpeg.mockImplementation(async (_bin: string, args: string[]) => {
    const out = args[args.length - 1]
    if (typeof out === 'string' && out.endsWith('.mp4')) {
      const { writeFileSync } = await import('node:fs')
      writeFileSync(out, Buffer.alloc(4096, 1))
    }
  })
  probeDurationSec.mockResolvedValue(2.5)
  attachExternalGeneratedFile.mockReturnValue({
    id: 'asset-1',
    relativePath: 'Cache/Videos/rec.mp4'
  })
})

afterEach(() => {
  // 收尾必须对**当前那个实例**做：重新 import 会清掉模块级状态（拿到了新实例），
  // 而上一段录制的定时器与临时目录留给了旧实例 —— 后面的用例就会莫名看到残留目录
  currentService?.abortScreenRecording()
  currentService = null
})

describe('录制服务：行为', () => {
  it('capture→stop 正常收尾：登记资产、按指纹丢空闲帧、清理临时目录', async () => {
    const service = await loadService()
    const started = await service.startScreenRecording({ fps: 15, maxSeconds: 180 })
    expect(started.ok).toBe(true)

    // 第 6 次抓取才换画面（前 5 次同一画面 → 必然被判为空闲帧），所以按条件等到第 2 张图即可
    await waitFor(() => service.screenRecordingStatus().frames >= 2)
    const status = service.screenRecordingStatus()
    expect(status.recording).toBe(true)
    expect(status.frames).toBeGreaterThan(0)

    const result = await service.stopScreenRecording()
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.relativePath).toBe('Cache/Videos/rec.mp4')
    expect(result.assetId).toBe('asset-1')
    expect(result.frames).toBeGreaterThanOrEqual(1)
    // 同一画面被采了多次，只有第一次写盘 —— 空闲合并真的在起作用（与机器快慢无关）
    expect(result.droppedIdle).toBeGreaterThan(0)
    expect(result.alignment.length).toBe(0) // 这一段没调过 step
    expect(attachExternalGeneratedFile).toHaveBeenCalledTimes(1)
    expect(leftoverWorkDirs()).toHaveLength(0)
  })

  it('自动停之后 stop 交回那次结果（而不是「当前没有在录制」）', async () => {
    const service = await loadService()
    const seen: Array<boolean> = []
    service.setScreenRecordFinishListener((r) => seen.push(r.ok))

    const started = await service.startScreenRecording({ fps: 15, maxSeconds: 1 })
    expect(started.ok).toBe(true)
    // 越过 1 秒上限后自动收尾（按条件等，不睡固定时间）
    await waitFor(() => !service.screenRecordingStatus().recording, 10_000)

    expect(service.screenRecordingStatus().recording).toBe(false)
    expect(service.screenRecordingStatus().hasPendingResult).toBe(true)
    expect(seen).toEqual([true]) // 自动收尾也通知了（MCP 层据此出预览卡）

    const result = await service.stopScreenRecording()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings).toContain('autoStoppedMaxSeconds')
      expect(result.relativePath).toBe('Cache/Videos/rec.mp4')
    }
    // 取走即清空，避免同一段录屏被反复合成
    expect(service.screenRecordingStatus().hasPendingResult).toBe(false)
  })

  it('并发 start 只有一段录制成真（TOCTOU：另一个必须被拒）', async () => {
    const service = await loadService()
    // 让 ffmpeg 探测慢下来，制造出「两个 start 同时越过 active 检查」的窗口
    runFfmpeg.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === '-version') {
        await sleep(80)
        return
      }
      const out = args[args.length - 1]
      if (typeof out === 'string' && out.endsWith('.mp4')) {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(out, Buffer.alloc(4096, 1))
      }
    })

    const [a, b] = await Promise.all([
      service.startScreenRecording({ fps: 10, maxSeconds: 180 }),
      service.startScreenRecording({ fps: 10, maxSeconds: 180 })
    ])
    const okCount = [a, b].filter((r) => r.ok).length
    const rejected = [a, b].filter((r) => !r.ok)
    expect(okCount).toBe(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.reasonKey).toBe('alreadyRecording')

    // 只应留下一份临时工作目录（另一份从未创建 → 不会泄漏）
    expect(leftoverWorkDirs().length).toBeLessThanOrEqual(1)
    // 采样是「抓完再排下一次」：等第一帧真的落下来再收尾
    await waitFor(() => service.screenRecordingStatus().frames >= 1)
    const result = await service.stopScreenRecording()
    expect(result.ok).toBe(true)
  })

  it('正在启动时 stop/step 报「启动中」，不要误导成「没在录制」', async () => {
    const service = await loadService()
    runFfmpeg.mockImplementation(async (_bin: string, args: string[]) => {
      if (args[0] === '-version') {
        await sleep(120)
      }
    })
    const pending = service.startScreenRecording({ fps: 10, maxSeconds: 180 })
    const stepResult = service.stepScreenRecording({ title: '开场' })
    expect(stepResult.ok).toBe(false)
    expect(stepResult.reasonKey).toBe('startingRecording')
    const stopResult = await service.stopScreenRecording()
    expect(stopResult.ok).toBe(false)
    if (!stopResult.ok) expect(stopResult.reasonKey).toBe('startingRecording')
    // start 完成后必须收尾，否则这段录制会一直占着定时器与临时目录
    await pending
    const done = await service.stopScreenRecording()
    expect(done.ok).toBe(false) // 一帧都没采到（start 刚返回就停了）
  })

  it('产物校验：ffmpeg 退出码 0 但产物是空文件时必须失败，不能当成功登记', async () => {
    const service = await loadService()
    runFfmpeg.mockImplementation(async (_bin: string, args: string[]) => {
      // -version 正常通过；编码**不写任何文件**
      void args
    })
    await service.startScreenRecording({ fps: 15, maxSeconds: 180 })
    await waitFor(() => service.screenRecordingStatus().frames >= 1)
    const result = await service.stopScreenRecording()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reasonKey).toBe('encodeFailed')
      expect(String(result.params?.detail)).toContain('编码产物不可用')
    }
    expect(attachExternalGeneratedFile).not.toHaveBeenCalled()
    expect(leftoverWorkDirs()).toHaveLength(0) // 失败也要清干净
  })

  it('空图：页面不可见时不把坏帧写进序列，全部为空则如实回 emptyRecording', async () => {
    const service = await loadService()
    imageState.empty = true
    await service.startScreenRecording({ fps: 15, maxSeconds: 180 })
    // 空图不写帧，所以不能等 frames；等抓取尝试真的发生过（dropped 计数不暴露，
    // 用「采样循环跑过至少一轮」的等价信号：HUD 推过状态即可）
    await sleep(250)
    const result = await service.stopScreenRecording()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reasonKey).toBe('emptyRecording')
    expect(attachExternalGeneratedFile).not.toHaveBeenCalled()
    expect(leftoverWorkDirs()).toHaveLength(0)
  })

  it('目标窗口被关掉：自动收尾并留下结果（不再静默停摆到重启）', async () => {
    const service = await loadService()
    await service.startScreenRecording({ fps: 15, maxSeconds: 180 })
    // 先等至少一帧落下来：一帧都没有就关窗口，收尾只能回 emptyRecording（那是正确行为，不是本条要测的）
    await waitFor(() => service.screenRecordingStatus().frames >= 1)
    await waitFor(() => closedListeners.length > 0)
    expect(closedListeners.length).toBeGreaterThan(0)
    // 模拟窗口关闭：服务注册的 closed 监听应触发收尾
    windowState.destroyed = true
    for (const cb of [...closedListeners]) cb()
    await waitFor(() => !service.screenRecordingStatus().recording)
    expect(service.screenRecordingStatus().recording).toBe(false)
    expect(service.screenRecordingStatus().hasPendingResult).toBe(true)
    const result = await service.stopScreenRecording()
    expect(result.ok).toBe(true)
  })
})
