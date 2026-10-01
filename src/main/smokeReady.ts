import { writeFileSync } from 'node:fs'
import { app } from 'electron'

const READY_FILE_ENV = 'AIART_SMOKE_READY_FILE'
/** 冒烟测试：写完就绪文件后让应用自行退出（置为 1 生效） */
const EXIT_AFTER_READY_ENV = 'AIART_SMOKE_EXIT_AFTER_READY'

let readyWritten = false
let runtimeStarted = false

/** 冒烟测试：标记主运行时（dsh 等）已成功拉起，写就绪文件时一并上报 */
export function markSmokeRuntimeStarted(): void {
  runtimeStarted = true
}

/**
 * 冒烟测试：仅当环境变量 AIART_SMOKE_READY_FILE 给出路径时生效。
 * 在首个窗口加载完成后写入就绪标记，供 CI 判定「应用真的起来了」而非仅仅没崩；
 * 正常启动（无该变量）时为空操作，不影响任何运行时行为。
 *
 * 另可加 AIART_SMOKE_EXIT_AFTER_READY=1，让应用写完标记后**自行优雅退出**。
 * CI 需要它：由外部 kill 只能终结进程，主进程若因故没被带走就会继续持有 userData
 * 的单实例锁，下一条腿（deb / dmg / zip）启动时抢不到锁、以 code 0 静默早退。
 * 顺带把优雅退出路径本身纳入冒烟范围——这正是安装包用户关窗时走的那条路。
 */
export function signalSmokeReady(stage: string): void {
  const file = process.env[READY_FILE_ENV]
  if (!file || readyWritten) return
  readyWritten = true
  const payload = { stage, pid: process.pid, runtimeStarted, at: new Date().toISOString() }
  try {
    writeFileSync(file, `${JSON.stringify(payload)}\n`, 'utf8')
  } catch (err) {
    console.error('[smoke] failed to write ready file', err)
  }
  if (process.env[EXIT_AFTER_READY_ENV] === '1') {
    app.quit()
  }
}
