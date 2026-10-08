import { createServer, get, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

/**
 * 回归：<userData>/mcp.json 是外部 MCP 客户端唯一的发现入口，它必须描述**真正在听的 socket**
 * ——端口取 `server.address()`（候选顺延后也是事实），pid 取持有该 socket 的进程。
 *
 * 实机复现过的故障：单实例锁的输家也会跑完 whenReady，另起一个端口并把 mcp.json 覆盖成自己的
 * pid + 端口，然后退出——文件指向死进程 + 没人监听的端口，客户端照它连必然失败。
 * 另一条同类路径：restartMcpServer 曾"先落盘再启动"，把**期望**端口先写进文件。
 */

const state = vi.hoisted(() => ({ userData: '', hasLock: true }))

// 主进程构建期的虚拟模块（electron.vite.config.ts 注入），vitest 下按空模板替身即可
vi.mock('virtual:aiart-headless-runner-template', () => ({ default: '' }))
vi.mock('virtual:aiart-approval-answerer-template', () => ({ default: '' }))
vi.mock('electron', () => ({
  ipcMain: { handle: () => undefined, removeHandler: () => undefined },
  app: {
    getPath: () => state.userData,
    getVersion: () => '7.3.0',
    getAppPath: () => process.cwd(),
    getName: () => 'aiartengine',
    isPackaged: false,
    on: () => undefined,
    whenReady: async () => undefined,
    hasSingleInstanceLock: () => state.hasLock,
    requestSingleInstanceLock: () => state.hasLock
  },
  shell: { showItemInFolder: () => undefined, openPath: async () => '' },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  dialog: {},
  clipboard: { writeText: () => undefined },
  BrowserWindow: class {
    static getAllWindows(): unknown[] {
      return []
    }
    webContents = { send: () => undefined }
    isDestroyed(): boolean {
      return false
    }
  }
}))

const mcp = await import('../src/main/services/mcpServerService')

const envPortBefore = process.env.AIAE_MCP_PORT
const tempDirs: string[] = []
const openServers: Server[] = []

function tempUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-publish-'))
  tempDirs.push(dir)
  state.userData = dir
  return dir
}

function listenOn(port: number, handler: () => void = () => undefined): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer((_req, res) => res.end('busy'))
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      openServers.push(server)
      handler()
      resolve(server)
    })
  })
}

/** 占一个系统分配的空闲端口（用完即放，供 startMcpServer 首选端口用） */
async function ephemeralPort(): Promise<number> {
  const server = await listenOn(0)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('拿不到空闲端口')
  const port = address.port
  await closeServer(server)
  return port
}

function closeServer(server: Server): Promise<void> {
  const index = openServers.indexOf(server)
  if (index >= 0) openServers.splice(index, 1)
  return new Promise((resolve) => server.close(() => resolve()))
}

/** /health 探活：只有真正在 127.0.0.1:port 上监听的工具服务会回 200 */
function healthOk(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = get(`http://127.0.0.1:${port}/health`, (res) => {
      res.resume()
      resolve(res.statusCode === 200)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(2000, () => {
      req.destroy()
      resolve(false)
    })
  })
}

function readConfig(dir: string): { port: number; token: string; pid: number; version: string } {
  return JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))
}

afterEach(async () => {
  // 服务是模块级单例：每个用例收尾都要停掉，否则端口/状态串到下一个用例
  mcp.stopMcpServer()
  for (const server of [...openServers]) await closeServer(server)
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  state.hasLock = true
  if (envPortBefore === undefined) delete process.env.AIAE_MCP_PORT
  else process.env.AIAE_MCP_PORT = envPortBefore
})

it('公布的是真正绑上的端口与持有它的 pid（首选端口被占时顺延也不写错）', async () => {
  const dir = tempUserData()
  const taken = await ephemeralPort()
  await listenOn(taken)
  process.env.AIAE_MCP_PORT = String(taken)

  await mcp.startMcpServer()

  const info = mcp.getMcpServerInfo()
  expect(info?.running).toBe(true)
  const config = readConfig(dir)
  expect(config.port).toBe(info?.port)
  // 首选端口被占：文件必须写顺延后的实际端口，而不是"打算用的"那个
  expect(config.port).not.toBe(taken)
  expect(config.pid).toBe(process.pid)
  expect(config.token).toBe(info?.token)
  expect(await healthOk(config.port)).toBe(true)
})

it('未持有单实例锁的进程既不起服务也不覆盖 mcp.json', async () => {
  const dir = tempUserData()
  // 在跑的实例写好的连接信息：本进程若覆盖它，客户端就会被指到一个即将退出的进程上
  const owner = { port: 43110, token: 'owner-token', pid: 4242, version: '7.3.0' }
  writeFileSync(join(dir, 'mcp.json'), JSON.stringify(owner, null, 2))
  const before = readFileSync(join(dir, 'mcp.json'))

  const wanted = await ephemeralPort()
  process.env.AIAE_MCP_PORT = String(wanted)
  state.hasLock = false

  await mcp.startMcpServer()

  expect(mcp.getMcpServerInfo()).toBeNull()
  expect(readFileSync(join(dir, 'mcp.json'))).toEqual(before)
  // 也不许抢端口：候选端口上空着才对，否则在跑的实例重启时会发现"端口莫名被占"
  expect(await healthOk(wanted)).toBe(false)
})

it('候选端口全被占用时不写 mcp.json（不公布没绑上的期望端口）', async () => {
  const dir = tempUserData()
  // 找一段连续空闲端口，整段占掉：候选端口 = [期望端口, 默认段...]
  let base = 0
  let squatters: Server[] = []
  for (const candidate of [43150, 43200, 43250, 43300, 43350]) {
    const servers: Server[] = []
    try {
      for (let offset = 0; offset < 10; offset++) servers.push(await listenOn(candidate + offset))
      base = candidate
      squatters = servers
      break
    } catch {
      for (const server of servers) await closeServer(server)
    }
  }
  expect(base).toBeGreaterThan(0)
  process.env.AIAE_MCP_PORT = String(base)

  await mcp.restartMcpServer({ port: base })

  expect(mcp.getMcpServerInfo()).toBeNull()
  expect(existsSync(join(dir, 'mcp.json'))).toBe(false)
  for (const server of squatters) await closeServer(server)
})

it('载荷端口来自 socket 的 address()：非 TCP 或未监听时宁可不写', () => {
  const listener = {
    address: () => ({ address: '127.0.0.1', family: 'IPv4', port: 43117 })
  } as unknown as Server
  expect(mcp.mcpConfigPayloadFor(listener, 'tok', 1234, '7.3.0')).toEqual({
    port: 43117,
    token: 'tok',
    pid: 1234,
    version: '7.3.0'
  })

  const closed = { address: () => null } as unknown as Server
  expect(mcp.mcpConfigPayloadFor(closed, 'tok', 1234, '7.3.0')).toBeNull()

  // unix socket：address() 返回路径字符串，没有可公布的 TCP 端口
  const unixLike = { address: () => '\\\\.\\pipe\\mcp' } as unknown as Server
  expect(mcp.mcpConfigPayloadFor(unixLike, 'tok', 1234, '7.3.0')).toBeNull()
})
