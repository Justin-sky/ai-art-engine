import { writeFileSync } from 'node:fs'

const READY_FILE_ENV = 'AIART_SMOKE_READY_FILE'

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
}
