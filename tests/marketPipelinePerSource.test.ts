import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MarketPipeline } from '../src/main/services/marketPipeline'

/**
 * 目录缓存的**按源隔离**。
 *
 * ## 这里修的是一个真实缺陷
 *
 * 早先所有源共用一个 `catalog.json`，而内存 memo 是按 URL 分的 —— 两者口径不一致造成：
 * 镜像成功写入缓存后，主源失败时读到的是**镜像的内容**并返回 `stale`，
 * 于是应用显示「离线」且**再也不会去试镜像**。
 *
 * 备用源恰好在自己最该生效的场景（主源不通）下失效 —— 而且症状是「看起来在工作」
 * （有内容、只是标了离线），最难察觉。
 */

const servers: Server[] = []
const dirs: string[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aae-persource-'))
  dirs.push(dir)
  return dir
}

/** 起一个只回索引的服务端；`ok=false` 时一律 500 */
function startServer(
  catalog: unknown,
  ok = true
): Promise<{ base: string; url: string; setOk: (value: boolean) => void }> {
  let healthy = ok
  const server = createServer((req, res) => {
    if (!healthy) {
      res.writeHead(500)
      res.end('boom')
      return
    }
    if ((req.url ?? '/') === '/index.json') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(catalog))
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
      const base = `http://127.0.0.1:${port}`
      resolve({ base, url: `${base}/index.json`, setOk: (v: boolean) => (healthy = v) })
    })
  })
}

/** 索引内容里带一个标记，用来分辨数据来自哪个源 */
function catalogFrom(marker: string, count = 1): unknown {
  return {
    schemaVersion: 1,
    workflows: Array.from({ length: count }, (_, index) => ({ id: `${marker}-${index}` }))
  }
}

const parse = (
  raw: unknown
): { ok: true; catalog: { ids: string[] } } | { ok: false; reasonKey: string } => {
  const obj = raw as { workflows?: Array<{ id?: string }> } | null
  if (!obj || !Array.isArray(obj.workflows)) return { ok: false, reasonKey: 'noWorkflows' }
  return { ok: true, catalog: { ids: obj.workflows.map((item) => item.id ?? '') } }
}

function pipelineAt(cacheDir: string): MarketPipeline {
  return new MarketPipeline({ kind: 'test-persource', cacheDir, timeoutMs: 3000 })
}

describe('每个源有独立的磁盘缓存', () => {
  it('两个源各自落一个缓存文件（不是共用一个 catalog.json）', async () => {
    const a = await startServer(catalogFrom('alpha'))
    const b = await startServer(catalogFrom('beta'))
    const cacheDir = tempDir()
    const pipeline = pipelineAt(cacheDir)

    await pipeline.fetchCatalog({ url: a.url, parse, force: true })
    await pipeline.fetchCatalog({ url: b.url, parse, force: true })

    const files = readdirSync(cacheDir).filter((name) => name.startsWith('catalog-'))
    expect(files).toHaveLength(2)
    // 旧的共享文件名不该再出现
    expect(files).not.toContain('catalog.json')
  })

  it('**镜像的缓存不会被当成主源的缓存**（这是备用源失效的根因）', async () => {
    const primary = await startServer(catalogFrom('primary'))
    const mirror = await startServer(catalogFrom('mirror'))
    const cacheDir = tempDir()
    const pipeline = pipelineAt(cacheDir)

    // 镜像先成功，写入它自己的缓存
    const fromMirror = await pipeline.fetchCatalog({ url: mirror.url, parse, force: true })
    expect(fromMirror.ok).toBe(true)
    expect(fromMirror.catalog?.ids).toEqual(['mirror-0'])

    // 主源此刻不通，且它**从未**成功过 → 不该拿到镜像的缓存，必须如实失败
    primary.setOk(false)
    const fromPrimary = await pipeline.fetchCatalog({ url: primary.url, parse, force: true })
    expect(fromPrimary.ok).toBe(false)
    expect(fromPrimary.reasonKey).toBe('network')
  })

  it('同一源重复失败时，回退的是**它自己**上次成功的缓存', async () => {
    const a = await startServer(catalogFrom('alpha', 3))
    const cacheDir = tempDir()
    const pipeline = pipelineAt(cacheDir)

    const first = await pipeline.fetchCatalog({ url: a.url, parse, force: true })
    expect(first.ok).toBe(true)
    expect(first.stale).toBeFalsy()

    a.setOk(false)
    const second = await pipeline.fetchCatalog({ url: a.url, parse, force: true })
    expect(second.ok).toBe(true)
    expect(second.stale).toBe(true) // 明确标为过期，而不是伪装成新鲜
    expect(second.catalog?.ids).toEqual(['alpha-0', 'alpha-1', 'alpha-2'])
  })

  it('缓存文件里记了它属于哪个源（便于人工排查）', async () => {
    const a = await startServer(catalogFrom('alpha'))
    const cacheDir = tempDir()
    await pipelineAt(cacheDir).fetchCatalog({ url: a.url, parse, force: true })
    const file = readdirSync(cacheDir).find((name) => name.startsWith('catalog-'))!
    const raw = JSON.parse(
      (await import('node:fs')).readFileSync(join(cacheDir, file), 'utf8') as string
    ) as { url?: string }
    expect(raw.url).toBe(a.url)
  })
})

describe('跨源选择：新鲜数据优于过期数据', () => {
  it('主源只有过期缓存、镜像新鲜 → 应当用镜像', async () => {
    // 这个判断在服务层（workflowMarketService），此处先固定管道层的语义：
    // 失败回退必须标 stale，成功不得标 stale —— 服务层据此区分。
    const a = await startServer(catalogFrom('alpha'))
    const cacheDir = tempDir()
    const pipeline = pipelineAt(cacheDir)

    const fresh = await pipeline.fetchCatalog({ url: a.url, parse, force: true })
    expect(fresh.stale).toBeFalsy()

    a.setOk(false)
    const stale = await pipeline.fetchCatalog({ url: a.url, parse, force: true })
    expect(stale.stale).toBe(true)
  })
})
