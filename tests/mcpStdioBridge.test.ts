/**
 * scripts/mcp-stdio-bridge.ts 的单元 + 集成测试。
 *
 * 拆分：
 * - 纯函数（parseExtraArgs / pickCommand / pickPort / genToken / defaultConfigPath / findOpenPort）
 * - StdioMcpBackend 行为：未 spawn 返回 -32603；正常 echo 子进程能匹配 id 响应；进程死回 -32603
 *
 * 直跑 .ts：vitest 原生支持，避免了 scripts/mcp-stdio-bridge.mjs 经 vite transform 时
 * 因 esbuild target 差异报 SyntaxError。
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  StdioMcpBackend,
  defaultConfigPath,
  findOpenPort,
  genToken,
  parseExtraArgs,
  pickCommand,
  pickPort,
  pickServerEnv,
  resolveExecutable
} from '../scripts/mcp-stdio-bridge'

describe('mcp-stdio-bridge 解析函数', () => {
  const savedEnv: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of [
      'AIAE_BLENDER_MCP_CMD',
      'AIAE_BLENDER_MCP_ARGS',
      'AIAE_BLENDER_MCP_PORT',
      'AIAE_BLENDER_MCP_TOKEN',
      'AIAE_BLENDER_MCP_SERVER_HOST',
      'AIAE_BLENDER_MCP_SERVER_PORT',
      'AIAE_BLENDER_MCP_SAFE_MODE'
    ]) {
      savedEnv[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it('parseExtraArgs 默认空数组', () => {
    expect(parseExtraArgs()).toEqual([])
  })

  it('parseExtraArgs 支持空格分隔', () => {
    process.env.AIAE_BLENDER_MCP_ARGS = '--port 9876 --debug'
    expect(parseExtraArgs()).toEqual(['--port', '9876', '--debug'])
  })

  it('parseExtraArgs 支持逗号分隔', () => {
    process.env.AIAE_BLENDER_MCP_ARGS = 'a,b,c'
    expect(parseExtraArgs()).toEqual(['a', 'b', 'c'])
  })

  it('parseExtraArgs 忽略多余空白', () => {
    process.env.AIAE_BLENDER_MCP_ARGS = '  --foo  ,  --bar  '
    expect(parseExtraArgs()).toEqual(['--foo', '--bar'])
  })

  it('pickCommand 默认 uvx blender-mcp', () => {
    expect(pickCommand()).toEqual(['uvx', 'blender-mcp'])
  })

  it('pickCommand 由 AIAE_BLENDER_MCP_CMD 覆盖', () => {
    process.env.AIAE_BLENDER_MCP_CMD = 'python  -m blender_mcp'
    expect(pickCommand()).toEqual(['python', '-m', 'blender_mcp'])
  })

  it('pickPort 默认 43120', () => {
    expect(pickPort()).toBe(43120)
  })

  it('pickPort 由 AIAE_BLENDER_MCP_PORT 覆盖', () => {
    process.env.AIAE_BLENDER_MCP_PORT = '43200'
    expect(pickPort()).toBe(43200)
  })

  it('pickPort 非法值回退默认', () => {
    process.env.AIAE_BLENDER_MCP_PORT = 'not-a-number'
    expect(pickPort()).toBe(43120)
  })

  it('genToken 默认生成 48 位 hex', () => {
    const token = genToken()
    expect(token).toMatch(/^[0-9a-f]{48}$/)
    expect(token).not.toBe(genToken())
  })

  it('genToken 由 AIAE_BLENDER_MCP_TOKEN 覆盖', () => {
    process.env.AIAE_BLENDER_MCP_TOKEN = 'fixed-token-abc'
    expect(genToken()).toBe('fixed-token-abc')
  })

  it('defaultConfigPath 落到 userData/aiartengine 下', () => {
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming'
    const path = defaultConfigPath()
    expect(path).toContain('aiartengine')
    expect(path.endsWith('mcp-blender.json')).toBe(true)
  })

  it('findOpenPort 返回 start 或其后首个空闲端口', async () => {
    const port = await findOpenPort(49000)
    expect(port).toBeGreaterThanOrEqual(49000)
    expect(port).toBeLessThan(49000 + 10)
  })

  it('pickServerEnv 默认 localhost:9876 + safe mode=1', () => {
    expect(pickServerEnv()).toEqual({
      BLENDER_HOST: 'localhost',
      BLENDER_PORT: '9876',
      BLENDER_MCP_SAFE_MODE: '1'
    })
  })

  it('pickServerEnv 由三个 env 覆盖', () => {
    process.env.AIAE_BLENDER_MCP_SERVER_HOST = '192.168.1.10'
    process.env.AIAE_BLENDER_MCP_SERVER_PORT = '9877'
    process.env.AIAE_BLENDER_MCP_SAFE_MODE = '0'
    expect(pickServerEnv()).toEqual({
      BLENDER_HOST: '192.168.1.10',
      BLENDER_PORT: '9877',
      BLENDER_MCP_SAFE_MODE: '0'
    })
  })

  it('pickServerEnv 非法端口/非法 safe mode 回退默认', () => {
    process.env.AIAE_BLENDER_MCP_SERVER_PORT = 'not-a-number'
    process.env.AIAE_BLENDER_MCP_SAFE_MODE = 'maybe'
    expect(pickServerEnv()).toEqual({
      BLENDER_HOST: 'localhost',
      BLENDER_PORT: '9876',
      BLENDER_MCP_SAFE_MODE: '1'
    })
  })

  it('pickServerEnv 空白 host 回退默认', () => {
    process.env.AIAE_BLENDER_MCP_SERVER_HOST = '   '
    expect(pickServerEnv().BLENDER_HOST).toBe('localhost')
  })

  it('pickServerEnv 端口超出 65535 时回退默认', () => {
    process.env.AIAE_BLENDER_MCP_SERVER_PORT = '99999'
    expect(pickServerEnv().BLENDER_PORT).toBe('9876')
  })

  it('resolveExecutable 已是绝对路径 → 原样返回（不再二次解析）', () => {
    // 已经是绝对路径就别再 which/where，干扰用户显式填的解析逻辑
    expect(resolveExecutable('/usr/local/bin/foo')).toBe('/usr/local/bin/foo')
    if (process.platform === 'win32') {
      expect(resolveExecutable('C:\\Users\\me\\.local\\bin\\uvx.exe')).toBe(
        'C:\\Users\\me\\.local\\bin\\uvx.exe'
      )
    }
  })

  it('resolveExecutable 含 / 或 \\ 的相对路径 → 原样返回', () => {
    expect(resolveExecutable('./node_modules/.bin/foo')).toBe('./node_modules/.bin/foo')
    expect(resolveExecutable('scripts\\tool.exe')).toBe('scripts\\tool.exe')
  })

  it('resolveExecutable 空字符串 / 全空白 → null', () => {
    expect(resolveExecutable('')).toBeNull()
    expect(resolveExecutable('   ')).toBeNull()
  })

  it('resolveExecutable PATH 上真实存在的命令 → 解析成绝对路径', () => {
    // 跨平台：node / python3 是任何 CI 环境都会有的命令
    const found = resolveExecutable(process.platform === 'win32' ? 'node.exe' : 'node')
    expect(found).toBeTruthy()
    // 绝对路径：Windows 含 drive letter，POSIX 以 / 开头
    if (process.platform === 'win32') {
      expect(found).toMatch(/^[a-zA-Z]:[\\/]/)
    } else {
      expect(found).toMatch(/^\//)
    }
  })

  it('resolveExecutable PATH 上找不到的命令 → null（不要抛）', () => {
    // 不能用 `null` / 空串作测试样例（部分 shell 会把它们当成合法 token）
    expect(resolveExecutable('__aiartengine_no_such_command_xyz_12345__')).toBeNull()
  })
})

/** echo stdio MCP server：每条 JSON-RPC 消息回 { id, result: { ok: true, echo: method } } */
const ECHO_SCRIPT = `
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && msg.id !== null) {
          process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { ok: true, echo: msg.method } }) + '\\n');
        }
      } catch {}
    }
  });
  process.stdin.on('end', () => process.exit(0));
`

/** 把子进程实际收到的三个 env 回给测试进程（echo server） */
const ENV_PROBE_SCRIPT = `
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf('\\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.id === undefined || msg.id === null) continue;
        process.stdout.write(JSON.stringify({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            BLENDER_HOST: process.env.BLENDER_HOST || null,
            BLENDER_PORT: process.env.BLENDER_PORT || null,
            BLENDER_MCP_SAFE_MODE: process.env.BLENDER_MCP_SAFE_MODE || null
          }
        }) + '\\n');
      } catch {}
    }
  });
  process.stdin.on('end', () => process.exit(0));
`

describe('StdioMcpBackend', () => {
  // 重构后构造必须传 configPath + infoBase；用 tmpdir 给每个测试一个独立路径，避免污染
  function tmpConfigPath(): string {
    return join(
      tmpdir(),
      `mcp-blender-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
    )
  }
  const TEST_INFO_BASE = {
    port: 0,
    token: '',
    command: '',
    args: [] as string[],
    addonInstallHint: ''
  }

  it('未 spawn 时 request 返回 -32603', async () => {
    const backend = new StdioMcpBackend({
      command: 'node',
      args: ['-e', 'process.stdin.pipe(process.stdout)'],
      configPath: tmpConfigPath(),
      infoBase: TEST_INFO_BASE
    })
    expect(backend.running).toBe(false)
    const res = (await backend.request({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list'
    })) as { error?: { code: number; message: string } }
    expect(res.error?.code).toBe(-32603)
    expect(res.error?.message).toContain('blender-mcp 未运行')
  })

  it('正常 spawn + request 拿到 echo 响应', async () => {
    const backend = new StdioMcpBackend({
      command: 'node',
      args: ['-e', ECHO_SCRIPT],
      configPath: tmpConfigPath(),
      infoBase: TEST_INFO_BASE
    })
    expect(backend.spawn()).toBe(true)
    const res = (await Promise.race([
      backend.request({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      new Promise((r) => setTimeout(() => r({ timeout: true }), 5000))
    ])) as { timeout?: boolean }
    expect(res).not.toEqual({ timeout: true })
    expect(res).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true, echo: 'initialize' }
    })
    await backend.stop()
  })

  it('子进程死亡后 request 返回 -32603', async () => {
    const backend = new StdioMcpBackend({
      command: 'node',
      args: ['-e', ECHO_SCRIPT],
      configPath: tmpConfigPath(),
      infoBase: TEST_INFO_BASE
    })
    expect(backend.spawn()).toBe(true)
    await backend.stop()
    expect(backend.running).toBe(false)
    const res = (await backend.request({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    })) as { error?: { code: number; message: string } }
    expect(res.error?.code).toBe(-32603)
  })

  it('spawn 时把 BLENDER_HOST/PORT/SAFE_MODE 透传到子进程', async () => {
    // 隔离测试进程已存在的同名 env，避免污染断言
    const savedHost = process.env.BLENDER_HOST
    const savedPort = process.env.BLENDER_PORT
    const savedSafe = process.env.BLENDER_MCP_SAFE_MODE
    delete process.env.BLENDER_HOST
    delete process.env.BLENDER_PORT
    delete process.env.BLENDER_MCP_SAFE_MODE
    const backend = new StdioMcpBackend({
      command: 'node',
      args: ['-e', ENV_PROBE_SCRIPT],
      configPath: tmpConfigPath(),
      infoBase: TEST_INFO_BASE
    })
    expect(backend.spawn()).toBe(true)
    const res = (await Promise.race([
      backend.request({ jsonrpc: '2.0', id: 99, method: 'probe-env' }),
      new Promise((r) => setTimeout(() => r({ timeout: true }), 5000))
    ])) as
      | { timeout?: boolean }
      | {
          result?: {
            BLENDER_HOST?: string | null
            BLENDER_PORT?: string | null
            BLENDER_MCP_SAFE_MODE?: string | null
          }
        }
    expect(res).not.toEqual({ timeout: true })
    expect(res).toMatchObject({
      result: {
        BLENDER_HOST: 'localhost',
        BLENDER_PORT: '9876',
        BLENDER_MCP_SAFE_MODE: '1'
      }
    })
    await backend.stop()
    if (savedHost === undefined) delete process.env.BLENDER_HOST
    else process.env.BLENDER_HOST = savedHost
    if (savedPort === undefined) delete process.env.BLENDER_PORT
    else process.env.BLENDER_PORT = savedPort
    if (savedSafe === undefined) delete process.env.BLENDER_MCP_SAFE_MODE
    else process.env.BLENDER_MCP_SAFE_MODE = savedSafe
  })

  it('spawn 不存在的命令 → mcp-blender.json 终态 spawned=false + lastError 非空', async () => {
    const configPath = tmpConfigPath()
    const backend = new StdioMcpBackend({
      // 命令绝对路径用随机目录保证 ENOENT；并绕过 PATH 解析（bash 找不到这玩意）
      command:
        process.platform === 'win32'
          ? 'C:\\__no_such_command_for_aiartengine_test__\\xyz.exe'
          : '/tmp/__no_such_command_for_aiartengine_test__/xyz',
      args: [],
      configPath,
      infoBase: { ...TEST_INFO_BASE, port: 0, token: 't', command: 'fake', args: [] }
    })
    expect(backend.spawn()).toBe(true) // spawn 不抛，仅异步 emit 'error'
    // 给 on('error') 触发 + flushSnapshot 跑一拍
    await new Promise((r) => setTimeout(r, 200))
    expect(backend.running).toBe(false)
    // 主进程读 mcp-blender.json 看到的就是这个终态值（race-free 因为 backend 是唯一写入者）
    const text = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(text) as { blenderSpawned: boolean; lastError: string | null }
    expect(parsed.blenderSpawned).toBe(false)
    expect(parsed.lastError).toBeTruthy()
    // ENOENT 错误信息应包含 'ENOENT'（Node 标准错误码）
    expect(parsed.lastError).toMatch(/ENOENT/)
  })

  it("spawn 成功后 on('exit') 触发 → 覆盖写 spawned=false + lastError 含 code/signal", async () => {
    const configPath = tmpConfigPath()
    const backend = new StdioMcpBackend({
      command: 'node',
      // 立刻退出的脚本
      args: ['-e', 'process.exit(7)'],
      configPath,
      infoBase: { ...TEST_INFO_BASE, port: 0, token: 't', command: 'node', args: ['-e'] }
    })
    expect(backend.spawn()).toBe(true)
    await new Promise((r) => setTimeout(r, 200))
    expect(backend.running).toBe(false)
    const text = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(text) as { blenderSpawned: boolean; lastError: string | null }
    expect(parsed.blenderSpawned).toBe(false)
    expect(parsed.lastError).toMatch(/退出 code=7/)
  })

  it('PATH 找不到的命令 → spawn() 直接返回 false + lastError 含 actionable 提示', () => {
    const configPath = tmpConfigPath()
    // 用一个肯定不会存在的命令名（不是绝对路径，所以会走 PATH 解析）
    const missing = '__aiartengine_no_such_command_xyz_99999__'
    const backend = new StdioMcpBackend({
      command: missing,
      args: [],
      configPath,
      infoBase: { ...TEST_INFO_BASE, port: 0, token: 't', command: missing, args: [] }
    })
    // 路径解析失败 → spawn() 不调用子进程 spawn，直接返回 false
    expect(backend.spawn()).toBe(false)
    expect(backend.running).toBe(false)
    // mcp-blender.json 写入 spawned=false + lastError 含 actionable 提示
    const text = readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(text) as {
      blenderSpawned: boolean
      lastError: string | null
      resolvedCommand: string | null
    }
    expect(parsed.blenderSpawned).toBe(false)
    expect(parsed.resolvedCommand).toBeNull()
    expect(parsed.lastError).toBeTruthy()
    // 友好提示要包含 actionable hint，比裸 ENOENT 强
    expect(parsed.lastError).toContain('PATH')
    expect(parsed.lastError).toContain('ENOENT')
  })
})
