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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  StdioMcpBackend,
  defaultConfigPath,
  findOpenPort,
  genToken,
  parseExtraArgs,
  pickCommand,
  pickPort
} from '../scripts/mcp-stdio-bridge'

describe('mcp-stdio-bridge 解析函数', () => {
  const savedEnv: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of [
      'AIAE_BLENDER_MCP_CMD',
      'AIAE_BLENDER_MCP_ARGS',
      'AIAE_BLENDER_MCP_PORT',
      'AIAE_BLENDER_MCP_TOKEN'
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

describe('StdioMcpBackend', () => {
  it('未 spawn 时 request 返回 -32603', async () => {
    const backend = new StdioMcpBackend({
      command: 'node',
      args: ['-e', 'process.stdin.pipe(process.stdout)']
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
    const backend = new StdioMcpBackend({ command: 'node', args: ['-e', ECHO_SCRIPT] })
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
    const backend = new StdioMcpBackend({ command: 'node', args: ['-e', ECHO_SCRIPT] })
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
})
