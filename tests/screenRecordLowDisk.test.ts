import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 磁盘预检：可用空间不足时**直接拒绝**开始录制。
 *
 * 单独一个文件，因为要用模块级 `vi.mock('node:fs')` 把 `statfsSync` 换掉 ——
 * ESM 的命名空间是不可配置的，`vi.spyOn(fs, 'statfsSync')` 会直接抛
 * 「Cannot redefine property」（这也是它必须独立成文件、不能用局部 mock 的原因）。
 * 真实 fs 用 importOriginal 展开保留，`mkdtempSync` 之类照常工作。
 */
/** `vi.mock` 工厂是提升的，共享状态要用 vi.hoisted 声明（否则命中 TDZ） */
const fsState = vi.hoisted(() => ({ mkdtempCalls: 0 }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    statfsSync: () => ({ bavail: 1, bsize: 1 }) as never,
    mkdtempSync: (...args: Parameters<typeof actual.mkdtempSync>) => {
      fsState.mkdtempCalls += 1
      return actual.mkdtempSync(...args)
    }
  }
})

vi.mock('electron', () => ({ BrowserWindow: class {} }))
vi.mock('../src/main/broadcast', () => ({ broadcastToAllWindows: () => undefined }))
vi.mock('../src/main/services/ffmpegRunner', () => ({ runFfmpeg: async () => undefined }))
vi.mock('../src/main/services/ffmpegInstallService', () => ({ isFfmpegInstalling: () => false }))
vi.mock('../src/main/services/videoFrameService', () => ({
  findFfmpegBin: () => 'ffmpeg',
  probeDurationSec: async () => 2.5
}))
vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => true,
    getRoot: () => '/tmp',
    attachExternalGeneratedFile: () => ({ id: 'a', relativePath: 'a.mp4' })
  }
}))

const fakeWindow = {
  isDestroyed: () => false,
  getContentSize: () => [640, 360],
  webContents: { capturePage: async () => ({}) },
  once: () => undefined,
  removeListener: () => undefined
}

let service: typeof import('../src/main/services/screenRecordService') | null = null

beforeEach(async () => {
  vi.resetModules()
  const ref = await import('../src/main/mainWindowRef')
  ref.setMainWindowRef(fakeWindow as never)
  service = await import('../src/main/services/screenRecordService')
})

afterEach(() => {
  service?.abortScreenRecording()
  service = null
})

describe('录制磁盘预检', () => {
  it('可用空间不足时拒绝开始，并给出可执行的 lowDiskSpace 原因', async () => {
    const result = await service!.startScreenRecording({ fps: 10, maxSeconds: 180 })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('lowDiskSpace')
  })

  it('拒绝时不创建临时工作目录（根本没开始，也就没有目录要清）', async () => {
    // 用 mkdtempSync 的调用计数，而不是「数 tmp 目录个数」——
    // 全量套件并行时别的测试文件也在建/删自己的临时目录，数个数必然互相干扰
    fsState.mkdtempCalls = 0
    await service!.startScreenRecording({ fps: 10, maxSeconds: 180 })
    expect(fsState.mkdtempCalls).toBe(0)
  })
})
