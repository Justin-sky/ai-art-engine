import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveWorkflowMarketSources, WORKFLOW_MARKET_SOURCES } from '../src/shared/workflowMarket'

/**
 * 数据源自动降级（主源不通 → 镜像）。
 *
 * 之所以要有这层：`raw.githubusercontent.com` 在部分网络下不可达，而「市场打不开」
 * 对用户来说和「市场是空的」没有区别。Gitee 镜像在同类网络下通常可用。
 *
 * 用真实 HTTP 服务端：这里的失败模式是「一个源连不上、另一个连得上」，
 * 打桩会把要验的东西一起打掉。
 */

const servers: Server[] = []
const dirs: string[] = []
let userDataDir = ''
/** 模拟设置里的 source：可填多个地址（换行分隔） */
let configuredSource = ''

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))
vi.mock('../src/main/services/settingsService', () => ({
  settingsService: { get: () => ({ workflowMarket: { source: configuredSource } }) }
}))
vi.mock('../src/main/services/updateService', () => ({
  updateService: { getCurrentVersion: () => '7.1.3' }
}))

const INDEX = {
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: { repo: 'https://example.test', ref: 'main' },
  workflows: [
    {
      id: 'demo-flow',
      title: '演示工作流',
      summary: '简介',
      category: 'film',
      version: '1.0.0',
      author: { name: '作者' },
      license: 'CC-BY-4.0',
      cover: 'cover.png',
      requires: { nodeTypes: [], appMinVersion: '7.1.0' },
      nodeCount: 1,
      edgeCount: 0
    }
  ]
}

const BUNDLE = {
  schemaVersion: 1,
  id: 'demo-flow',
  title: '演示工作流',
  summary: '简介',
  category: 'film',
  version: '1.0.0',
  author: { name: '作者' },
  license: 'CC-BY-4.0',
  cover: 'cover.png',
  requires: { nodeTypes: [], appMinVersion: '7.1.0' },
  plan: { title: '演示工作流', nodes: [{ key: 'n1', typeId: 'note.text' }], edges: [] }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

/** 起一个市场服务端；`mode='ok'` 正常，`mode='broken'` 只回 500（可用 setMode 中途切换） */
function startMarket(
  mode: 'ok' | 'broken'
): Promise<{ base: string; hits: string[]; setMode: (next: 'ok' | 'broken') => void }> {
  const hits: string[] = []
  let current = mode
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
    hits.push(url)
    if (current === 'broken') {
      res.writeHead(500)
      res.end('boom')
      return
    }
    if (url === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(INDEX))
      return
    }
    if (url === '/workflows/demo-flow/workflow.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(BUNDLE))
      return
    }
    if (url === '/workflows/demo-flow/cover.png') {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PNG)
      return
    }
    res.writeHead(404)
    res.end('nope')
  })
  servers.push(server)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      resolve({
        base: `http://127.0.0.1:${port}`,
        hits,
        setMode: (next: 'ok' | 'broken') => {
          current = next
        }
      })
    })
  })
}

/** 把某个源指向一个必然连不上的地址 */
const DEAD = 'http://127.0.0.1:1'

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'aae-fallback-'))
  dirs.push(userDataDir)
  configuredSource = ''
})

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  configuredSource = ''
  userDataDir = ''
})

describe('resolveWorkflowMarketSources：源解析（纯函数）', () => {
  it('留空 → 官方主源 + 镜像，主源在前', () => {
    const sources = resolveWorkflowMarketSources('')
    expect(sources).toEqual([...WORKFLOW_MARKET_SOURCES])
    expect(sources.length).toBeGreaterThanOrEqual(2)
    expect(sources[0]).toContain('raw.githubusercontent.com')
    expect(sources[1]).toContain('gitee.com')
  })

  it('填一个 → 只用那一个（不偷偷混入官方源）', () => {
    expect(resolveWorkflowMarketSources('https://my.test/market')).toEqual([
      'https://my.test/market'
    ])
  })

  it('填多个（换行 / 逗号 / 空格分隔）→ 按顺序全部保留', () => {
    expect(resolveWorkflowMarketSources('https://a.test\nhttps://b.test')).toEqual([
      'https://a.test',
      'https://b.test'
    ])
    expect(resolveWorkflowMarketSources('https://a.test, https://b.test')).toEqual([
      'https://a.test',
      'https://b.test'
    ])
    expect(resolveWorkflowMarketSources('https://a.test   https://b.test')).toEqual([
      'https://a.test',
      'https://b.test'
    ])
  })

  it('只有空白 / 逗号时视同留空', () => {
    expect(resolveWorkflowMarketSources('   \n , ')).toEqual([...WORKFLOW_MARKET_SOURCES])
  })
})

describe('目录：主源不通自动降级到镜像', () => {
  it('主源 500、镜像正常 → 返回镜像的条目并说明用了镜像', async () => {
    const broken = await startMarket('broken')
    const mirror = await startMarket('ok')
    configuredSource = `${broken.base}\n${mirror.base}`

    const { fetchWorkflowCatalog, resetWorkflowMarketCache } =
      await import('../src/main/services/workflowMarketService')
    resetWorkflowMarketCache()
    const result = await fetchWorkflowCatalog({ force: true })

    expect(result.ok).toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.source).toBe(mirror.base)
    expect(result.usedFallback).toBe(true)
    // 主源确实被试过（不是直接跳过）
    expect(broken.hits).toContain('/index.json')
  })

  it('主源正常时不碰镜像（不该无谓地多打一次请求）', async () => {
    const primary = await startMarket('ok')
    const mirror = await startMarket('ok')
    configuredSource = `${primary.base}\n${mirror.base}`

    const { fetchWorkflowCatalog, resetWorkflowMarketCache } =
      await import('../src/main/services/workflowMarketService')
    resetWorkflowMarketCache()
    const result = await fetchWorkflowCatalog({ force: true })

    expect(result.ok).toBe(true)
    expect(result.source).toBe(primary.base)
    expect(result.usedFallback).toBe(false)
    expect(mirror.hits).toEqual([])
  })

  it('全部源都不通 → ok:false，并带上每个源各自的原因', async () => {
    const a = await startMarket('broken')
    const b = await startMarket('broken')
    configuredSource = `${a.base}\n${b.base}`

    const { fetchWorkflowCatalog, resetWorkflowMarketCache } =
      await import('../src/main/services/workflowMarketService')
    resetWorkflowMarketCache()
    const result = await fetchWorkflowCatalog({ force: true })

    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('network')
    // 关键：不只说「网络失败」，要能看出是哪个源不通
    expect(result.attempted).toHaveLength(2)
    expect(result.attempted?.map((item) => item.source)).toEqual([a.base, b.base])
  })

  it('主源内容非法（结构崩坏）也视为该源失败，继续试镜像', async () => {
    const bad = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ nope: true }))
    })
    servers.push(bad)
    const badBase = await new Promise<string>((resolve) => {
      bad.listen(0, '127.0.0.1', () => {
        const address = bad.address()
        const port = typeof address === 'object' && address ? address.port : 0
        resolve(`http://127.0.0.1:${port}`)
      })
    })
    const mirror = await startMarket('ok')
    configuredSource = `${badBase}\n${mirror.base}`

    const { fetchWorkflowCatalog, resetWorkflowMarketCache } =
      await import('../src/main/services/workflowMarketService')
    resetWorkflowMarketCache()
    const result = await fetchWorkflowCatalog({ force: true })

    expect(result.ok).toBe(true)
    expect(result.source).toBe(mirror.base)
    expect(result.usedFallback).toBe(true)
  })
})

describe('安装 / 封面：与索引同源', () => {
  it('目录来自镜像后，安装也从镜像取（不会回头去打已挂的主源）', async () => {
    const broken = await startMarket('broken')
    const mirror = await startMarket('ok')
    configuredSource = `${broken.base}\n${mirror.base}`

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()

    // 先取目录 → 生效源落到镜像
    const catalog = await service.fetchWorkflowCatalog({ force: true })
    expect(catalog.source).toBe(mirror.base)

    const before = broken.hits.length
    const installed = await service.installWorkflow({ id: 'demo-flow' })
    expect(installed.ok).toBe(true)
    // 安装期间没有再打主源
    expect(broken.hits.length).toBe(before)

    const target = join(userDataDir, 'workflows', 'demo-flow')
    expect(existsSync(join(target, 'workflow.json'))).toBe(true)
    expect(existsSync(join(target, 'cover.png'))).toBe(true)
  })

  it('未安装的工作流，封面按源顺序降级取到', async () => {
    const broken = await startMarket('broken')
    const mirror = await startMarket('ok')
    configuredSource = `${broken.base}\n${mirror.base}`

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    const cover = await service.fetchWorkflowCover('demo-flow')
    expect(cover.ok).toBe(true)
    expect(cover.dataUrl?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('安装失败时把各源原因汇总（便于区分「都不通」与「仓库坏了」）', async () => {
    const a = await startMarket('broken')
    const b = await startMarket('broken')
    configuredSource = `${a.base}\n${b.base}`

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    const result = await service.installWorkflow({ id: 'demo-flow' })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('download')
    expect(result.error).toContain(a.base)
    expect(result.error).toContain(b.base)
  })

  it('**内容错误不换源重试**（镜像内容应当一致，换源只会把同一错误再撞一遍）', async () => {
    // 索引里有 demo-flow，但包里 id 写成了别的 —— 两个源都这样（内容应一致）
    const mismatched = createServer((req, res) => {
      const url = req.url ?? '/'
      if (url === '/index.json') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(INDEX))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ...BUNDLE, id: 'someone-else' }))
    })
    servers.push(mismatched)
    const base = await new Promise<string>((resolve) => {
      mismatched.listen(0, '127.0.0.1', () => {
        const address = mismatched.address()
        const port = typeof address === 'object' && address ? address.port : 0
        resolve(`http://127.0.0.1:${port}`)
      })
    })
    const mirror = await startMarket('ok')
    configuredSource = `${base}\n${mirror.base}`

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    const result = await service.installWorkflow({ id: 'demo-flow' })
    // 直接报 idMismatch，而不是悄悄用镜像的成功结果掩盖它
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('idMismatch')
    expect(mirror.hits.some((url) => url.includes('workflow.json'))).toBe(false)
  })

  it('死地址 + 正常镜像：目录能拿到（真实网络故障形态）', async () => {
    const mirror = await startMarket('ok')
    configuredSource = `${DEAD}\n${mirror.base}`

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    const result = await service.fetchWorkflowCatalog({ force: true })
    expect(result.ok).toBe(true)
    expect(result.source).toBe(mirror.base)
    expect(result.usedFallback).toBe(true)
  }, 30_000)
})

describe('跨源选择：新鲜数据优于过期数据', () => {
  it('主源只剩过期缓存、镜像新鲜 → 用镜像（不能因为主源"有缓存"就停手）', async () => {
    const primary = await startMarket('ok')
    const mirror = await startMarket('ok')
    configuredSource = `${primary.base}\n${mirror.base}`

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()

    // 先让主源成功一次，留下它自己的磁盘缓存
    const first = await service.fetchWorkflowCatalog({ force: true })
    expect(first.source).toBe(primary.base)
    expect(first.stale).toBeFalsy()

    // 主源转为故障（它的缓存还在）；镜像仍新鲜
    primary.setMode('broken')
    service.resetWorkflowMarketCache()
    const second = await service.fetchWorkflowCatalog({ force: true })

    // 关键：不能拿主源的过期缓存了事，应当用镜像的新鲜数据
    expect(second.ok).toBe(true)
    expect(second.source).toBe(mirror.base)
    expect(second.usedFallback).toBe(true)
    expect(second.stale).toBeFalsy()
  }, 30_000)

  it('唯一的源故障且只有过期缓存 → 给出过期数据并标 stale（离线仍可看）', async () => {
    const primary = await startMarket('ok')
    configuredSource = primary.base

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    await service.fetchWorkflowCatalog({ force: true })

    primary.setMode('broken')
    service.resetWorkflowMarketCache()
    const offline = await service.fetchWorkflowCatalog({ force: true })

    expect(offline.ok).toBe(true)
    expect(offline.stale).toBe(true)
    expect(offline.entries).toHaveLength(1)
  }, 30_000)
})

describe('记住上次成功的源（跨重启不撞死源）', () => {
  it('成功后写入 preferred-source.json，供下次启动优先使用', async () => {
    const mirror = await startMarket('ok')
    configuredSource = `${DEAD}\n${mirror.base}`

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    const result = await service.fetchWorkflowCatalog({ force: true })
    expect(result.source).toBe(mirror.base)

    const preferred = JSON.parse(
      readFileSync(join(userDataDir, 'workflow-market', 'preferred-source.json'), 'utf8')
    ) as { source?: string }
    expect(preferred.source).toBe(mirror.base)
  }, 30_000)

  it('**不改写用户配置的源**：记住的是派生事实，存在缓存目录而非设置里', async () => {
    const mirror = await startMarket('ok')
    configuredSource = mirror.base

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    await service.fetchWorkflowCatalog({ force: true })

    expect(configuredSource).toBe(mirror.base)
    expect(existsSync(join(userDataDir, 'workflow-market', 'preferred-source.json'))).toBe(true)
  }, 30_000)
})

describe('每次打开都强制刷新（用户要求）', () => {
  it('force 绕过 TTL 重新打网络；不 force 则命中缓存', async () => {
    const market = await startMarket('ok')
    configuredSource = market.base

    const service = await import('../src/main/services/workflowMarketService')
    service.resetWorkflowMarketCache()
    const indexHits = (): number => market.hits.filter((url) => url === '/index.json').length

    await service.fetchWorkflowCatalog({ force: true })
    expect(indexHits()).toBe(1)

    // 不 force：命中 TTL 缓存，不再打网络
    await service.fetchWorkflowCatalog()
    expect(indexHits()).toBe(1)

    // force：重新打网络 —— 这正是「每次打开市场都刷新」依赖的行为
    await service.fetchWorkflowCatalog({ force: true })
    expect(indexHits()).toBe(2)
  }, 30_000)
})
