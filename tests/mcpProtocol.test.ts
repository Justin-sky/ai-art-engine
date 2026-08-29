import { describe, expect, it } from 'vitest'
import { createMcpProtocolHandler } from '../src/shared/mcpProtocol'

function makeHandler() {
  return createMcpProtocolHandler({
    serverInfo: { name: 'aiartengine', title: 'AiArtEngine', version: '4.1.1' },
    listTools: () => [
      { name: 'echo', title: 'Echo', description: '回显', inputSchema: { type: 'object' } }
    ],
    callTool: async (name, args) => {
      if (name === 'boom') return { error: '爆炸了' }
      if (name === 'throw') throw new Error('内部错误')
      return { result: { name, args } }
    }
  })
}

describe('MCP 协议消息处理（shared）', () => {
  it('initialize 回显受支持的协议版本并带 serverInfo', async () => {
    const handle = makeHandler()
    const res = await handle({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'cc' } }
    })
    const result = res?.result as { protocolVersion: string; serverInfo: { name: string } }
    expect(result.protocolVersion).toBe('2025-06-18')
    expect(result.serverInfo.name).toBe('aiartengine')
  })

  it('未知协议版本回退到默认版本', async () => {
    const handle = makeHandler()
    const res = await handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'initialize',
      params: { protocolVersion: '1999-01-01' }
    })
    expect((res?.result as { protocolVersion: string }).protocolVersion).toBe('2025-06-18')
  })

  it('tools/list 与 tools/call 成功路径', async () => {
    const handle = makeHandler()
    const list = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    expect((list?.result as { tools: unknown[] }).tools).toHaveLength(1)

    const call = await handle({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'echo', arguments: { a: 1 } }
    })
    const result = call?.result as { content: Array<{ text: string }>; isError?: boolean }
    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.content[0].text)).toEqual({ name: 'echo', args: { a: 1 } })
  })

  it('tools/call 业务失败标记 isError，抛错映射 -32603', async () => {
    const handle = makeHandler()
    const failed = await handle({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'boom' }
    })
    const failedResult = failed?.result as { isError: boolean; content: Array<{ text: string }> }
    expect(failedResult.isError).toBe(true)
    expect(failedResult.content[0].text).toContain('爆炸了')

    const thrown = await handle({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'throw' }
    })
    expect((thrown?.error as { code: number }).code).toBe(-32603)
  })

  it('通知返回 null（不产生应答）', async () => {
    const handle = makeHandler()
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull()
    expect(
      await handle({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'echo' } })
    ).toBeNull()
  })

  it('未知方法 -32601，缺 name 的 tools/call -32602', async () => {
    const handle = makeHandler()
    expect(((await handle({ jsonrpc: '2.0', id: 7, method: 'nope' }))?.error as { code: number }).code).toBe(-32601)
    expect(
      ((await handle({ jsonrpc: '2.0', id: 8, method: 'tools/call' }))?.error as { code: number }).code
    ).toBe(-32602)
  })
})
