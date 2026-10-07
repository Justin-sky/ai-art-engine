import { describe, expect, it } from 'vitest'
import {
  EXTERNAL_MCP_DEFAULT_TIMEOUT_MS,
  EXTERNAL_MCP_MAX_TIMEOUT_MS,
  EXTERNAL_MCP_MIN_TIMEOUT_MS,
  createDefaultExternalMcpServer,
  deriveExternalMcpId,
  externalMcpIdFromPath,
  externalMcpPath,
  externalMcpToolPrefix,
  externalMcpUnusableReason,
  isExternalMcpServerUsable,
  isValidExternalMcpId,
  isUsableHttpUrl,
  namespaceExternalMcpTool,
  normalizeExternalMcpServer,
  normalizeExternalMcpServers,
  stripExternalMcpToolPrefix,
  type ExternalMcpServer
} from '../src/shared/externalMcp'
import { normalizeToolList, parseMcpHttpBody } from '../src/main/services/externalMcpClient'
import { EXTERNAL_MCP_REASON, ExternalMcpError } from '../src/main/services/externalMcpClient'

/**
 * 第三方 MCP 服务的配置模型与协议解析（纯函数）。
 *
 * 这块的风险集中在**标识**上：id 同时是端点路径（`/mcp/ext/<id>`）与工具名前缀。
 * 放一个非法值进来 = 埋一个不可达或可穿越的端点；两条同 id 的配置 = 后加的那条
 * 永远收不到请求，而界面上看着是两张正常的卡片。所以断言重点在 id 与去重。
 */
function server(over: Partial<ExternalMcpServer> = {}): ExternalMcpServer {
  return { ...createDefaultExternalMcpServer('http'), id: 'demo', name: 'Demo', ...over }
}

describe('id：端点路径与工具前缀的安全基础', () => {
  it('只接受小写字母 / 数字 / 连字符，且不以连字符开头结尾', () => {
    expect(isValidExternalMcpId('demo')).toBe(true)
    expect(isValidExternalMcpId('a')).toBe(true)
    expect(isValidExternalMcpId('my-server-2')).toBe(true)
    expect(isValidExternalMcpId('')).toBe(false)
    expect(isValidExternalMcpId('-lead')).toBe(false)
    expect(isValidExternalMcpId('trail-')).toBe(false)
    expect(isValidExternalMcpId('Upper')).toBe(false)
    expect(isValidExternalMcpId('has space')).toBe(false)
    expect(isValidExternalMcpId('a/b')).toBe(false)
    expect(isValidExternalMcpId('../etc')).toBe(false)
    // 33 位超长（上限 32）
    expect(isValidExternalMcpId('a'.repeat(33))).toBe(false)
    expect(isValidExternalMcpId('a'.repeat(32))).toBe(true)
  })

  it('externalMcpPath 对非法 id 直接抛错（不拼出可穿越的路径）', () => {
    expect(externalMcpPath('demo')).toBe('/mcp/ext/demo')
    expect(() => externalMcpPath('../etc')).toThrow()
    expect(() => externalMcpPath('a/b')).toThrow()
  })

  it('externalMcpIdFromPath 只认本前缀，非法后缀返回 null', () => {
    expect(externalMcpIdFromPath('/mcp/ext/demo')).toBe('demo')
    expect(externalMcpIdFromPath('/mcp')).toBeNull()
    expect(externalMcpIdFromPath('/mcp/blender')).toBeNull()
    expect(externalMcpIdFromPath('/mcp/ext/../secret')).toBeNull()
    expect(externalMcpIdFromPath('/mcp/ext/')).toBeNull()
  })

  it('deriveExternalMcpId 从展示名 / 地址推导，且与已有 id 去重', () => {
    expect(deriveExternalMcpId('Maps', [])).toBe('maps')
    expect(deriveExternalMcpId('My Cool Server', [])).toBe('my-cool-server')
    expect(deriveExternalMcpId('https://api.example.com/mcp', [])).toBe('https-api-example-com-mcp')
    // 中文取不到 ASCII：回落到 mcp，而不是产出空 id
    expect(deriveExternalMcpId('高德地图', [])).toBe('mcp')
    expect(deriveExternalMcpId('', [])).toBe('mcp')
  })

  it('deriveExternalMcpId 去重时加数字后缀，并保持长度合法', () => {
    expect(deriveExternalMcpId('maps', ['maps'])).toBe('maps-2')
    expect(deriveExternalMcpId('maps', ['maps', 'maps-2'])).toBe('maps-3')
    // 截断后仍要合法（不能以连字符结尾）
    const long = 'a'.repeat(32)
    const derived = deriveExternalMcpId(long, [long])
    expect(isValidExternalMcpId(derived)).toBe(true)
    expect(derived).not.toBe(long)
  })
})

describe('工具名命名空间：避免与内建 72 个工具撞名', () => {
  it('加前缀与剥前缀是互逆的', () => {
    const namespaced = namespaceExternalMcpTool('maps', 'geocode')
    expect(namespaced).toBe('maps__geocode')
    expect(stripExternalMcpToolPrefix('maps', namespaced)).toBe('geocode')
  })

  it('重复加前缀不会累加（幂等）', () => {
    const once = namespaceExternalMcpTool('maps', 'geocode')
    expect(namespaceExternalMcpTool('maps', once)).toBe(once)
  })

  it('剥前缀时按服务隔离：别的服务的前缀不算自己的', () => {
    expect(stripExternalMcpToolPrefix('maps', 'other__geocode')).toBeNull()
    expect(stripExternalMcpToolPrefix('maps', 'geocode')).toBeNull()
  })

  it('前缀用双下划线：只含 MCP 工具名允许的字符', () => {
    expect(externalMcpToolPrefix('my-server')).toBe('my-server__')
    expect(/^[a-zA-Z0-9_-]+$/.test(externalMcpToolPrefix('my-server'))).toBe(true)
  })

  it('前缀不会把合法工具名变成非法（MCP 工具名限 128 字符）', () => {
    const longName = 't'.repeat(100)
    const namespaced = namespaceExternalMcpTool('server-id', longName)
    expect(namespaced.length).toBeLessThanOrEqual(128)
  })
})

describe('normalizeExternalMcpServer：脏数据一律挡在外面', () => {
  it('id 非法直接丢弃（返回 null），不产出半条配置', () => {
    expect(normalizeExternalMcpServer({ id: 'Bad Id' })).toBeNull()
    expect(normalizeExternalMcpServer({ id: '' })).toBeNull()
    expect(normalizeExternalMcpServer({})).toBeNull()
    expect(normalizeExternalMcpServer(null)).toBeNull()
    expect(normalizeExternalMcpServer('nope')).toBeNull()
  })

  it('缺 name 时回落到 id（卡片标题不会空）', () => {
    expect(normalizeExternalMcpServer({ id: 'demo' })?.name).toBe('demo')
    expect(normalizeExternalMcpServer({ id: 'demo', name: '  ' })?.name).toBe('demo')
  })

  it('transport 只认 stdio，其余一律 http（未知值不当成第三种）', () => {
    expect(normalizeExternalMcpServer({ id: 'd', transport: 'stdio' })?.transport).toBe('stdio')
    expect(normalizeExternalMcpServer({ id: 'd', transport: 'grpc' })?.transport).toBe('http')
    expect(normalizeExternalMcpServer({ id: 'd' })?.transport).toBe('http')
  })

  it('默认启用（用户刚添加完就该生效）', () => {
    expect(normalizeExternalMcpServer({ id: 'd' })?.enabled).toBe(true)
    expect(normalizeExternalMcpServer({ id: 'd', enabled: false })?.enabled).toBe(false)
    expect(normalizeExternalMcpServer({ id: 'd', enabled: 'yes' })?.enabled).toBe(true)
  })

  it('超时钳到 [1s, 2h]，非法值回落默认', () => {
    expect(normalizeExternalMcpServer({ id: 'd' })?.timeoutMs).toBe(EXTERNAL_MCP_DEFAULT_TIMEOUT_MS)
    expect(normalizeExternalMcpServer({ id: 'd', timeoutMs: 5 })?.timeoutMs).toBe(
      EXTERNAL_MCP_MIN_TIMEOUT_MS
    )
    expect(normalizeExternalMcpServer({ id: 'd', timeoutMs: 99_999_999 })?.timeoutMs).toBe(
      EXTERNAL_MCP_MAX_TIMEOUT_MS
    )
    expect(normalizeExternalMcpServer({ id: 'd', timeoutMs: 'soon' })?.timeoutMs).toBe(
      EXTERNAL_MCP_DEFAULT_TIMEOUT_MS
    )
    expect(normalizeExternalMcpServer({ id: 'd', timeoutMs: 1500.7 })?.timeoutMs).toBe(1500)
  })

  it('headers / env 只保留字符串值，丢掉空键', () => {
    const parsed = normalizeExternalMcpServer({
      id: 'd',
      headers: { Authorization: ' Bearer x ', '': 'dropped', n: 1 },
      env: { API_KEY: 'k', bad: 2 }
    })
    expect(parsed?.headers).toEqual({ Authorization: 'Bearer x' })
    expect(parsed?.env).toEqual({ API_KEY: 'k' })
    // 非对象（脏 settings.json）不炸
    expect(normalizeExternalMcpServer({ id: 'd', headers: 'oops' })?.headers).toEqual({})
    expect(normalizeExternalMcpServer({ id: 'd', headers: ['a'] })?.headers).toEqual({})
  })

  it('args 只收字符串并去掉空项', () => {
    expect(normalizeExternalMcpServer({ id: 'd', args: ['-y', '', '  ', 'pkg'] })?.args).toEqual([
      '-y',
      'pkg'
    ])
    expect(normalizeExternalMcpServer({ id: 'd', args: 'nope' })?.args).toEqual([])
  })

  it('id 归一化为小写并去空白', () => {
    expect(normalizeExternalMcpServer({ id: '  Demo  ' })?.id).toBe('demo')
  })
})

describe('normalizeExternalMcpServers：列表去重与丢弃', () => {
  it('丢弃非法条目，保留合法的', () => {
    const list = normalizeExternalMcpServers([
      { id: 'ok' },
      { id: 'BAD ID' },
      null,
      'nope',
      { id: 'ok2' }
    ])
    expect(list.map((s) => s.id)).toEqual(['ok', 'ok2'])
  })

  it('**按 id 去重且首个生效**（重复 id 会让后加的那条永远收不到请求）', () => {
    const list = normalizeExternalMcpServers([
      { id: 'dup', name: 'First' },
      { id: 'dup', name: 'Second' }
    ])
    expect(list).toHaveLength(1)
    expect(list[0]?.name).toBe('First')
  })

  it('非数组返回空列表（旧 settings.json 没有这一段）', () => {
    expect(normalizeExternalMcpServers(undefined)).toEqual([])
    expect(normalizeExternalMcpServers({})).toEqual([])
    expect(normalizeExternalMcpServers('x')).toEqual([])
  })

  it('归一化是幂等的（反复读写不会漂移）', () => {
    const once = normalizeExternalMcpServers([{ id: 'a', url: 'https://x/mcp' }])
    const twice = normalizeExternalMcpServers(once)
    expect(twice).toEqual(once)
  })
})

describe('可用性判定', () => {
  it('http 需要合法的 http/https 地址', () => {
    expect(isUsableHttpUrl('https://x.com/mcp')).toBe(true)
    expect(isUsableHttpUrl('http://127.0.0.1:3000/mcp')).toBe(true)
    expect(isUsableHttpUrl('')).toBe(false)
    expect(isUsableHttpUrl('x.com/mcp')).toBe(false)
    expect(isUsableHttpUrl('ftp://x.com')).toBe(false)
    expect(isUsableHttpUrl('file:///etc/passwd')).toBe(false)
  })

  it('stdio 需要命令', () => {
    expect(isExternalMcpServerUsable(server({ transport: 'http', url: 'https://x/mcp' }))).toBe(
      true
    )
    expect(isExternalMcpServerUsable(server({ transport: 'http', url: '' }))).toBe(false)
    expect(isExternalMcpServerUsable(server({ transport: 'stdio', command: 'npx' }))).toBe(true)
    expect(isExternalMcpServerUsable(server({ transport: 'stdio', command: '' }))).toBe(false)
  })

  it('不可用时给出可翻译的原因键（不是一句话文案）', () => {
    expect(externalMcpUnusableReason(server({ transport: 'http', url: '' }))).toBe('missingUrl')
    expect(externalMcpUnusableReason(server({ transport: 'http', url: 'nope' }))).toBe('invalidUrl')
    expect(externalMcpUnusableReason(server({ transport: 'stdio', command: '' }))).toBe(
      'missingCommand'
    )
    expect(
      externalMcpUnusableReason(server({ transport: 'http', url: 'https://x/mcp' }))
    ).toBeNull()
  })
})

describe('parseMcpHttpBody：两种应答体都要认', () => {
  it('直接回 JSON', () => {
    expect(
      parseMcpHttpBody('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}', 'application/json')
    ).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } })
  })

  it('回 SSE 单帧', () => {
    const body = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n\n'
    expect(parseMcpHttpBody(body, 'text/event-stream; charset=utf-8')).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true }
    })
  })

  it('SSE 多帧时取最后一帧（最后一条才是本次应答）', () => {
    const body = 'data: {"id":1,"result":"old"}\n\ndata: {"id":2,"result":"new"}\n\n'
    expect(parseMcpHttpBody(body, 'text/event-stream')).toEqual({ id: 2, result: 'new' })
  })

  it('空响应 / 没有 data 帧 → 带可翻译原因键抛错（不是静默返回 undefined）', () => {
    // 主进程不产出成品文案：message 就是原因键，渲染层用 locale 出人话
    expect(() => parseMcpHttpBody('   ', 'application/json')).toThrow(/emptyResponse/)
    expect(() => parseMcpHttpBody('event: ping\n\n', 'text/event-stream')).toThrow(/noSseData/)
  })

  it('网关回的 HTML 错误页归类成 badJson（而不是把 HTML 当 JSON 崩掉）', () => {
    expect(() => parseMcpHttpBody('<html>502</html>', 'text/html')).toThrow(/badJson/)
  })

  it('原因键随错误带出，UI 据此翻译', () => {
    try {
      parseMcpHttpBody('', 'application/json')
      expect.unreachable('应当抛错')
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalMcpError)
      expect((err as ExternalMcpError).reasonKey).toBe(EXTERNAL_MCP_REASON.emptyResponse)
    }
  })
})

describe('normalizeToolList：工具清单形状兼容', () => {
  it('取 name，缺 description / schema 也能用', () => {
    const tools = normalizeToolList({
      tools: [
        { name: 'geocode', description: '地址转坐标', inputSchema: { type: 'object' } },
        { name: 'reverse', title: '逆地理' },
        { description: '没有名字' },
        null,
        'nope'
      ]
    })
    expect(tools.map((t) => t.name)).toEqual(['geocode', 'reverse'])
    expect(tools[0]?.description).toBe('地址转坐标')
    // 缺 schema 时补一个合法的空对象 schema，否则客户端工具校验会失败
    expect(tools[1]?.inputSchema).toEqual({ type: 'object', properties: {} })
  })

  it('没有 tools 字段返回空数组（不抛错）', () => {
    expect(normalizeToolList({})).toEqual([])
    expect(normalizeToolList(null)).toEqual([])
    expect(normalizeToolList({ tools: 'nope' })).toEqual([])
  })
})
