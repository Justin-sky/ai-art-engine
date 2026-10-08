import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 单实例守卫：**没抢到锁的进程不许继续启动**。
 *
 * 实测故障：抢锁失败的第二个实例照样跑完 whenReady（`app.quit()` 不会中断模块执行），
 * 于是它创建窗口（一闪）、写共享 userData，并启动自己的 MCP 服务 —— 抢占下一个空闲端口后
 * 把 `<userData>/mcp.json` 覆写成「自己的 pid + 那个端口」随即退出，文件从此指向
 * 一个没人监听的地址（外部 MCP 客户端照它连必然失败）。两个异常（端口不符、pid 不是监听者）
 * 都出自这一条路径。
 *
 * 入口点没法在 vitest 里真跑（它拉 Electron 主进程全家桶），所以这里做**结构断言**：
 * 断言守卫是 whenReady 回调的**第一条语句**，且 IPC / MCP / 建窗都在它之后。
 */
const INDEX = readFileSync(resolve(__dirname, '../src/main/index.ts'), 'utf8')

/** 取 `app.whenReady().then(async () => {` 起的回调体（花括号配对） */
function whenReadyBody(source: string): string {
  const at = source.indexOf('app.whenReady().then(')
  expect(at, '找不到 app.whenReady()').toBeGreaterThan(-1)
  const open = source.indexOf('{', at)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    const c = source[i]
    if (c === '{') depth += 1
    else if (c === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open + 1, i)
    }
  }
  return source.slice(open)
}

describe('单实例启动守卫', () => {
  const body = whenReadyBody(INDEX)

  it('whenReady 的第一步就是「没锁就 return」', () => {
    const firstStatement = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/*'))
    expect(firstStatement[0]).toBe('if (!hasSingleInstanceLock) return')
  })

  it('IPC / MCP / 建窗都在守卫之后（也就是被挡住）', () => {
    const guardAt = body.indexOf('if (!hasSingleInstanceLock) return')
    for (const later of ['registerIpcHandlers()', 'startMcpServer()', 'createWindow()']) {
      expect(body, `缺少 ${later}`).toContain(later)
      expect(body.indexOf(later), `${later} 出现在守卫之前`).toBeGreaterThan(guardAt)
    }
  })

  it('锁本身仍然是在 ready 之前申请的（否则守卫读不到值）', () => {
    const lockAt = INDEX.indexOf('app.requestSingleInstanceLock()')
    expect(lockAt, '找不到 requestSingleInstanceLock').toBeGreaterThan(-1)
    expect(lockAt).toBeLessThan(INDEX.indexOf('app.whenReady()'))
  })
})
