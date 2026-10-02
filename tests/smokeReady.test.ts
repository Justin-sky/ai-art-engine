import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 冒烟就绪钩子的契约（src/main/smokeReady.ts）。
 *
 * 这个模块只有 CI 会用，但它承载两条关键行为：
 * - 没有 AIART_SMOKE_READY_FILE 时必须是空操作，绝不能影响正常启动；
 * - 有 AIART_SMOKE_EXIT_AFTER_READY=1 时，写完标记要**让应用自行优雅退出**。
 *   后者是 release 流水线的关键：由外部 kill 只能终结进程，主进程若因故没被带走
 *   会继续持有 userData 单实例锁，后续 dmg / zip / deb 冒烟启动同一应用时抢不到锁，
 *   表现为「exited early (code 0)」静默早退（v6.8.0 连续四轮 release 就卡在这里）。
 *
 * readyWritten 是模块级状态，所以每个用例都要 resetModules 后重新 import。
 */

const quit = vi.fn()

vi.mock('electron', () => ({
  app: {
    quit: () => quit()
  }
}))

const READY_ENV = 'AIART_SMOKE_READY_FILE'
const EXIT_ENV = 'AIART_SMOKE_EXIT_AFTER_READY'

let dir = ''
let readyFile = ''

async function loadModule() {
  vi.resetModules()
  return await import('../src/main/smokeReady')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'smoke-ready-'))
  readyFile = join(dir, 'ready.json')
  quit.mockClear()
  delete process.env[READY_ENV]
  delete process.env[EXIT_ENV]
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  delete process.env[READY_ENV]
  delete process.env[EXIT_ENV]
})

describe('smokeReady', () => {
  it('未设就绪文件路径时是空操作：不写文件、不退出', async () => {
    const { signalSmokeReady } = await loadModule()
    process.env[EXIT_ENV] = '1'
    signalSmokeReady('renderer-loaded')
    expect(existsSync(readyFile)).toBe(false)
    expect(quit).not.toHaveBeenCalled()
  })

  it('设了就绪文件但未要求退出：写标记且不退出（保持原有语义）', async () => {
    const { signalSmokeReady } = await loadModule()
    process.env[READY_ENV] = readyFile
    signalSmokeReady('window-ready-to-show')

    const payload = JSON.parse(readFileSync(readyFile, 'utf8'))
    expect(payload.stage).toBe('window-ready-to-show')
    expect(typeof payload.pid).toBe('number')
    expect(typeof payload.at).toBe('string')
    expect(quit).not.toHaveBeenCalled()
  })

  it('要求退出时：写完标记后调用 app.quit() 自行优雅退出', async () => {
    const { signalSmokeReady } = await loadModule()
    process.env[READY_ENV] = readyFile
    process.env[EXIT_ENV] = '1'
    signalSmokeReady('renderer-loaded')

    expect(JSON.parse(readFileSync(readyFile, 'utf8')).stage).toBe('renderer-loaded')
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('幂等：同一次运行只写一次标记、只退出一次', async () => {
    const { signalSmokeReady } = await loadModule()
    process.env[READY_ENV] = readyFile
    process.env[EXIT_ENV] = '1'
    signalSmokeReady('renderer-loaded')
    signalSmokeReady('window-ready-to-show')

    expect(JSON.parse(readFileSync(readyFile, 'utf8')).stage).toBe('renderer-loaded')
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('只有精确的 "1" 才触发退出，避免 =0 / =false 被误读成开启', async () => {
    const { signalSmokeReady } = await loadModule()
    process.env[READY_ENV] = readyFile
    process.env[EXIT_ENV] = '0'
    signalSmokeReady('renderer-loaded')
    expect(existsSync(readyFile)).toBe(true)
    expect(quit).not.toHaveBeenCalled()
  })

  it('退出请求本身要留日志：Rosetta 腿靠它区分「退得慢」与「根本没退」', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const { signalSmokeReady } = await loadModule()
      process.env[READY_ENV] = readyFile
      process.env[EXIT_ENV] = '1'
      signalSmokeReady('renderer-loaded')
      expect(log.mock.calls.flat().join(' ')).toContain('exit-after-ready')
      expect(quit).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  it('退出请求后每 10s 打一次等待点，便于看出收尾被拖了多久', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const { signalSmokeReady } = await loadModule()
      process.env[READY_ENV] = readyFile
      process.env[EXIT_ENV] = '1'
      signalSmokeReady('renderer-loaded')
      expect(log.mock.calls.flat().join(' ')).not.toContain('still pending')

      vi.advanceTimersByTime(20_000)
      const text = log.mock.calls.flat().join(' ')
      expect(text).toContain('still pending after 10s')
      expect(text).toContain('still pending after 20s')
    } finally {
      log.mockRestore()
      vi.useRealTimers()
    }
  })

  it('markSmokeRuntimeStarted 的上报会写进标记（供 CI 判定运行体是否拉起）', async () => {
    const { markSmokeRuntimeStarted, signalSmokeReady } = await loadModule()
    process.env[READY_ENV] = readyFile
    markSmokeRuntimeStarted()
    signalSmokeReady('renderer-loaded')
    expect(JSON.parse(readFileSync(readyFile, 'utf8')).runtimeStarted).toBe(true)
  })
})
