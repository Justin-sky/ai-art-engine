import { afterEach, describe, expect, it, vi } from 'vitest'
import axios, { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios'
import http from 'node:http'
import net from 'node:net'
import {
  clearProxyTransportCachesForTests,
  createResilientAxiosAdapter,
  isBypassedLocalOrNoProxyHost,
  parseChromiumProxyDirective,
  parseWindowsRegInternetSettings,
  resolveProxyCandidatesForUrl
} from '../src/main/services/systemProxyTransport'
import { createProviderInstance, pickActiveProvider } from '../src/shared/modelProvider'

describe('主进程系统代理传输层（systemProxyTransport）与生图跨通道容灾', () => {
  const servers: http.Server[] = []

  afterEach(async () => {
    clearProxyTransportCachesForTests()
    vi.restoreAllMocks()
    await Promise.all(
      servers.splice(0).map(
        (srv) =>
          new Promise<void>((resolve) => {
            srv.closeAllConnections?.()
            srv.close(() => resolve())
          })
      )
    )
  })

  it('1. 正确解析 Chromium PAC 指令、Windows 注册表 Internet Settings 以及本地/内网免代理规则', () => {
    expect(parseChromiumProxyDirective('PROXY 127.0.0.1:7890; DIRECT')).toEqual([
      { kind: 'http', proxyUrl: 'http://127.0.0.1:7890' },
      { kind: 'direct' }
    ])
    expect(parseChromiumProxyDirective('SOCKS5 127.0.0.1:7891; HTTPS gw.corp:443')).toEqual([
      { kind: 'socks', proxyUrl: 'socks5://127.0.0.1:7891' },
      { kind: 'https', proxyUrl: 'https://gw.corp:443' }
    ])

    const winSimple = parseWindowsRegInternetSettings(`
HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings
    ProxyEnable    REG_DWORD    0x1
    ProxyServer    REG_SZ    127.0.0.1:7890
    ProxyOverride    REG_SZ    localhost;127.*;10.*;<local>
`)
    expect(winSimple).toEqual({
      enabled: true,
      httpProxy: 'http://127.0.0.1:7890',
      httpsProxy: 'http://127.0.0.1:7890',
      proxyOverride: 'localhost;127.*;10.*;<local>'
    })

    const winDisabled = parseWindowsRegInternetSettings(`
    ProxyEnable    REG_DWORD    0x0
    ProxyServer    REG_SZ    127.0.0.1:7890
`)
    expect(winDisabled).toEqual({ enabled: false })

    expect(isBypassedLocalOrNoProxyHost('127.0.0.1')).toBe(true)
    expect(isBypassedLocalOrNoProxyHost('localhost')).toBe(true)
    expect(isBypassedLocalOrNoProxyHost('192.168.31.10')).toBe(true)
    expect(isBypassedLocalOrNoProxyHost('intranet-box', '<local>')).toBe(true)
    expect(isBypassedLocalOrNoProxyHost('api.corp.internal', '*.corp.internal')).toBe(true)
    expect(isBypassedLocalOrNoProxyHost('api.openai.com', 'localhost;127.*;<local>')).toBe(false)
  })

  it('2. 真实代理隧道：Windows 系统代理开启（127.0.0.1:port）但无 HTTPS_PROXY 环境变量时，HTTPS CONNECT 与 HTTP 请求自动经系统代理转发', async () => {
    // (a) 上游模拟服务端（环回端口，由代理转发到达）
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ ok: true, path: req.url }))
    })
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()))
    servers.push(upstream)
    const upstreamPort = (upstream.address() as net.AddressInfo).port

    // (b) 本地系统代理（同时支持 HTTP 转发与 HTTPS CONNECT 隧道）
    let seenConnectTarget = ''
    let seenHttpForwardUrl = ''
    const proxyServer = http.createServer((req, res) => {
      seenHttpForwardUrl = req.url ?? ''
      const parsed = new URL(req.url ?? 'http://example.invalid/')
      const pReq = http.request(
        {
          host: '127.0.0.1',
          port: upstreamPort,
          path: parsed.pathname + parsed.search,
          method: req.method,
          headers: req.headers
        },
        (pRes) => {
          res.writeHead(pRes.statusCode ?? 200, pRes.headers)
          pRes.pipe(res)
        }
      )
      req.pipe(pReq)
    })
    proxyServer.on('connect', (req, clientSocket) => {
      seenConnectTarget = req.url ?? ''
      clientSocket.write('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n')
      clientSocket.destroy()
    })
    await new Promise<void>((r) => proxyServer.listen(0, '127.0.0.1', () => r()))
    servers.push(proxyServer)
    const proxyPort = (proxyServer.address() as net.AddressInfo).port

    const candidates = await resolveProxyCandidatesForUrl(
      'https://api.openai.com/v1/images/generations',
      {
        env: {},
        platform: 'win32',
        windowsProxyReader: async () => ({
          enabled: true,
          httpProxy: `http://127.0.0.1:${proxyPort}`,
          httpsProxy: `http://127.0.0.1:${proxyPort}`
        })
      }
    )
    expect(candidates).toEqual([
      { kind: 'http', proxyUrl: `http://127.0.0.1:${proxyPort}` },
      { kind: 'direct' }
    ])

    const baseHttp = axios.getAdapter('http')
    const adapter = createResilientAxiosAdapter(baseHttp, {
      env: {},
      platform: 'win32',
      retryDelaysMs: [],
      fallbackFetchAdapter: null,
      windowsProxyReader: async () => ({
        enabled: true,
        httpProxy: `http://127.0.0.1:${proxyPort}`,
        httpsProxy: `http://127.0.0.1:${proxyPort}`
      })
    })

    // HTTP 远端主机名请求直接经由系统代理成功拿到 200 JSON 响应（无需触碰外网）
    const httpClient = axios.create({
      baseURL: 'http://remote-gateway.example.invalid/v1',
      adapter,
      timeout: 3000
    })
    const okResp = await httpClient.post('/images/generations', { prompt: 'hello' })
    expect(okResp.data).toEqual({ ok: true, path: '/v1/images/generations' })
    expect(seenHttpForwardUrl).toBe('http://remote-gateway.example.invalid/v1/images/generations')

    // HTTPS 远端主机名请求自动发起 CONNECT <host>:443 隧道握手
    const httpsOnlyProxyAdapter = createResilientAxiosAdapter(baseHttp, {
      env: {},
      chromiumResolveProxy: async () => `PROXY 127.0.0.1:${proxyPort}`,
      retryDelaysMs: [],
      fallbackFetchAdapter: null
    })
    const httpsClient = axios.create({
      baseURL: 'https://remote-openai.example.invalid/v1',
      adapter: httpsOnlyProxyAdapter,
      timeout: 1500
    })
    await expect(httpsClient.post('/images/generations', { prompt: 'hello' })).rejects.toThrow()
    expect(seenConnectTarget).toBe('remote-openai.example.invalid:443')
  })

  it('3. 死代理免疫 + TLS 握手 ECONNRESET 自动重试：代理端口关闭时自动退回直连，且瞬时断连自动换新连接恢复', async () => {
    // 找一个已关闭的空闲端口模拟 Clash 已退出但注册表残留 ProxyEnable=1
    const tempSrv = http.createServer()
    await new Promise<void>((r) => tempSrv.listen(0, '127.0.0.1', () => r()))
    const deadProxyPort = (tempSrv.address() as net.AddressInfo).port
    await new Promise<void>((r) => tempSrv.close(() => r()))

    const calls: Array<{ hasProxyAgent: boolean; keepAlive: boolean }> = []
    let directAttempt = 0
    const fakeBaseAdapter: AxiosAdapter = async (cfg) => {
      const httpsAgent = cfg.httpsAgent as http.Agent | undefined
      const symbols = httpsAgent ? Object.getOwnPropertySymbols(httpsAgent).map(String) : []
      const hasProxyAgent =
        symbols.some((s) => s.includes('ProxyConfig')) ||
        httpsAgent?.constructor?.name === 'FallbackHttpsConnectProxyAgent'
      const keepAlive = Boolean((httpsAgent as { keepAlive?: boolean } | undefined)?.keepAlive)
      calls.push({ hasProxyAgent, keepAlive })

      if (hasProxyAgent) {
        throw new AxiosError(`connect ECONNREFUSED 127.0.0.1:${deadProxyPort}`, 'ECONNREFUSED', cfg)
      }
      directAttempt += 1
      if (directAttempt < 3) {
        throw new AxiosError(
          'Client network socket disconnected before secure TLS connection was established',
          'ECONNRESET',
          cfg
        )
      }
      return {
        data: { data: [{ b64_json: 'QUJD' }] },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: cfg
      } satisfies AxiosResponse
    }

    const adapter = createResilientAxiosAdapter(fakeBaseAdapter, {
      env: {},
      platform: 'win32',
      retryDelaysMs: [5, 5],
      fallbackFetchAdapter: null,
      windowsProxyReader: async () => ({
        enabled: true,
        httpProxy: `http://127.0.0.1:${deadProxyPort}`,
        httpsProxy: `http://127.0.0.1:${deadProxyPort}`
      })
    })

    const client = axios.create({
      baseURL: 'https://origingateway.com/v1',
      adapter
    })
    const resp = await client.post('/images/generations', { prompt: 'cyberpunk' })
    expect(resp.status).toBe(200)
    // 第 1 次试死代理被拒 → 立即切直连（第 2 次 keepAlive=true 遇 ECONNRESET → 第 3 次 keepAlive=false 遇 ECONNRESET → 第 4 次 keepAlive=false 成功）
    expect(calls).toEqual([
      { hasProxyAgent: true, keepAlive: true },
      { hasProxyAgent: false, keepAlive: true },
      { hasProxyAgent: false, keepAlive: false },
      { hasProxyAgent: false, keepAlive: false }
    ])
  })

  it('4. pickActiveProvider 按模型归属匹配提供商，且 facade.generateImage 在首选通道 ECONNRESET 时自动切换同名备用网关', async () => {
    const pCustom = createProviderInstance('custom', {
      id: 'p-custom',
      label: '自定义网关',
      apiKey: 'sk-custom',
      baseUrl: 'https://origingateway.com/v1',
      modalities: {
        image: {
          selectedModelIds: ['gpt-image-2.5-sunburst'],
          defaultModelId: 'gpt-image-2.5-sunburst'
        }
      }
    })
    const pOpenAi = createProviderInstance('openai', {
      id: 'p-openai',
      label: 'OpenAI',
      apiKey: 'sk-oa',
      baseUrl: 'https://api.openai.com/v1',
      modalities: {
        image: {
          selectedModelIds: ['gpt-image-2.6-flare'],
          defaultModelId: 'gpt-image-2.6-flare'
        }
      }
    })
    const pNewApi = createProviderInstance('newapi', {
      id: 'p-newapi',
      label: 'NewAPI',
      apiKey: 'sk-newapi',
      baseUrl: 'https://origingateway.com/v1',
      modalities: {
        image: {
          selectedModelIds: ['gpt-image-2.6-flare'],
          defaultModelId: 'gpt-image-2.6-flare'
        }
      }
    })

    const providers = [pCustom, pOpenAi, pNewApi]
    // 未传 providerInstanceId 但指定了 gpt-image-2.6-flare 时，精准命中拥有该模型的 pOpenAi 而非列表首项 pCustom
    const picked = pickActiveProvider(providers, 'image', undefined, 'gpt-image-2.6-flare')
    expect(picked?.provider.id).toBe('p-openai')
    expect(picked?.modelId).toBe('gpt-image-2.6-flare')

    const { settingsService } = await import('../src/main/services/settingsService')
    const registry = await import('../src/main/services/modelProviders/registry')
    const { modelProviderFacade } = await import('../src/main/services/modelProviders/facade')

    vi.spyOn(settingsService, 'get').mockReturnValue({
      models: { providers }
    } as ReturnType<typeof settingsService.get>)

    const attemptedProviders: string[] = []
    vi.spyOn(registry, 'getProviderAdapter').mockImplementation((kind) => ({
      kind,
      assertAuth: async () => undefined,
      fetchCatalog: async () => [],
      generateText: async () => ({ text: '', model: '' }),
      submitVideo: async () => ({ jobId: '', pollingUrl: '', model: '' }),
      pollVideo: async () => ({ status: 'succeeded' }),
      generateSpeech: async () => ({ audio: Buffer.alloc(0), mimeType: 'audio/mp3', model: '' }),
      generateImage: async (prov, modelId) => {
        attemptedProviders.push(`${prov.id}::${modelId}`)
        if (prov.id === 'p-openai') {
          throw new Error(
            '图片生成失败: code=ECONNRESET | Client network socket disconnected before secure TLS connection was established（provider: api.openai.com · /images/generations）'
          )
        }
        return {
          images: ['data:image/png;base64,QUJD'],
          model: modelId
        }
      }
    }))

    const out = await modelProviderFacade.generateImage({
      prompt: 'cyberpunk neon street',
      model: 'gpt-image-2.6-flare'
    })
    expect(attemptedProviders).toEqual([
      'p-openai::gpt-image-2.6-flare',
      'p-newapi::gpt-image-2.6-flare'
    ])
    expect(out.images).toEqual(['data:image/png;base64,QUJD'])
    expect(out.referenceNotes?.some((n) => n.includes('NewAPI'))).toBe(true)

    // 内容安全拦截属于确定性提示词违规，严禁盲目跨通道重试烧钱
    attemptedProviders.length = 0
    vi.spyOn(registry, 'getProviderAdapter').mockImplementation((kind) => ({
      kind,
      assertAuth: async () => undefined,
      fetchCatalog: async () => [],
      generateText: async () => ({ text: '', model: '' }),
      submitVideo: async () => ({ jobId: '', pollingUrl: '', model: '' }),
      pollVideo: async () => ({ status: 'succeeded' }),
      generateSpeech: async () => ({ audio: Buffer.alloc(0), mimeType: 'audio/mp3', model: '' }),
      generateImage: async (prov, modelId) => {
        attemptedProviders.push(`${prov.id}::${modelId}`)
        throw new Error('图片生成失败: content_policy_violation: safety system rejected prompt')
      }
    }))

    await expect(
      modelProviderFacade.generateImage({
        prompt: 'blocked prompt',
        model: 'gpt-image-2.6-flare'
      })
    ).rejects.toThrow(/content_policy_violation/)
    expect(attemptedProviders).toEqual(['p-openai::gpt-image-2.6-flare'])
  })
})
