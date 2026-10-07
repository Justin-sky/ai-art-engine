import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MarketPipeline,
  clearCatalogMemo,
  sha256OfBytes
} from '../src/main/services/marketPipeline'

/**
 * 远端市场通用管道。
 *
 * 重点在两处**容易悄悄坏掉**的行为：
 * 1. **离线回退**：网络挂了要回退磁盘缓存并标记 stale，而不是把市场清空成空白
 * 2. **原子落盘**：任何一步失败都不能在目标位置留下半成品（用户不该看到「装了一半」）
 *
 * 用真实 HTTP 服务端 + 真实文件系统：这两个行为都发生在网络与磁盘的交互处，
 * 打桩会把要验证的东西一起打掉。
 */

const servers: Server[] = []
const dirs: string[] = []

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  clearCatalogMemo()
})

/** 起一个可控的静态服务端；`fail` 为 true 时一律回 500 */
function startServer(
  files: Record<string, string | Buffer>
): Promise<{ port: number; setFail: (v: boolean) => void }> {
  let fail = false
  const server = createServer((req, res) => {
    if (fail) {
      res.writeHead(500)
      res.end('boom')
      return
    }
    const key = (req.url ?? '/').replace(/^\//, '')
    const body = files[key]
    if (body === undefined) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(body)
  })
  servers.push(server)
  return new Promise((resolvePromise) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolvePromise({
        port: typeof address === 'object' && address ? address.port : 0,
        setFail: (value: boolean) => {
          fail = value
        }
      })
    })
  })
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aae-market-'))
  dirs.push(dir)
  return dir
}

function pipelineAt(cacheDir: string): MarketPipeline {
  return new MarketPipeline({ kind: 'test-market', cacheDir, timeoutMs: 3000 })
}

const CATALOG = JSON.stringify({ schemaVersion: 1, workflows: [{ id: 'a' }] })
const parseCatalog = (
  raw: unknown
): { ok: true; catalog: { count: number } } | { ok: false; reasonKey: string } => {
  const obj = raw as { workflows?: unknown[] } | null
  if (!obj || !Array.isArray(obj.workflows)) return { ok: false, reasonKey: 'noWorkflows' }
  return { ok: true, catalog: { count: obj.workflows.length } }
}

describe('fetchCatalog：缓存、离线回退与失败语义', () => {
  it('首次拉取成功并落磁盘缓存', async () => {
    const { port } = await startServer({ 'index.json': CATALOG })
    const cacheDir = tempDir()
    const result = await pipelineAt(cacheDir).fetchCatalog({
      url: `http://127.0.0.1:${port}/index.json`,
      parse: parseCatalog
    })
    expect(result.ok).toBe(true)
    expect(result.catalog).toEqual({ count: 1 })
    expect(result.stale).toBeFalsy()
    // 缓存文件**按源**命名（`catalog-<指纹>.json`）—— 共用一个文件会让镜像的缓存被当成主源的
    const cached = readdirSync(cacheDir).filter((name) => name.startsWith('catalog-'))
    expect(cached).toHaveLength(1)
    expect(existsSync(join(cacheDir, cached[0]!))).toBe(true)
  })

  it('**网络失败时回退磁盘缓存并标记 stale**（不清空市场）', async () => {
    const { port, setFail } = await startServer({ 'index.json': CATALOG })
    const cacheDir = tempDir()
    const url = `http://127.0.0.1:${port}/index.json`
    const pipeline = pipelineAt(cacheDir)
    // 先成功一次，制造缓存
    await pipeline.fetchCatalog({ url, parse: parseCatalog })
    // 再断网
    setFail(true)
    clearCatalogMemo()
    const result = await pipeline.fetchCatalog({ url, parse: parseCatalog, force: true })
    expect(result.ok).toBe(true)
    expect(result.stale).toBe(true)
    expect(result.catalog).toEqual({ count: 1 })
    // 错误原文要带上，便于界面显示为什么是离线的
    expect(result.error).toBeTruthy()
  })

  it('没有缓存时网络失败 → ok:false + network 原因键', async () => {
    const { port, setFail } = await startServer({ 'index.json': CATALOG })
    setFail(true)
    const result = await pipelineAt(tempDir()).fetchCatalog({
      url: `http://127.0.0.1:${port}/index.json`,
      parse: parseCatalog
    })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('network')
  })

  it('**索引本身不合法时不回退旧缓存**（否则会掩盖「仓库发坏了」）', async () => {
    const cacheDir = tempDir()
    const good = await startServer({ 'index.json': CATALOG })
    const url = `http://127.0.0.1:${good.port}/index.json`
    await pipelineAt(cacheDir).fetchCatalog({ url, parse: parseCatalog })

    // 服务端换成结构崩坏的内容
    const bad = await startServer({ 'index.json': JSON.stringify({ nope: true }) })
    clearCatalogMemo()
    const result = await pipelineAt(cacheDir).fetchCatalog({
      url: `http://127.0.0.1:${bad.port}/index.json`,
      parse: parseCatalog,
      force: true
    })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('noWorkflows')
  })

  it('TTL 内命中内存缓存（不重复请求）', async () => {
    let hits = 0
    const server = createServer((_req, res) => {
      hits += 1
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(CATALOG)
    })
    servers.push(server)
    const port = await new Promise<number>((r) =>
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        r(typeof address === 'object' && address ? address.port : 0)
      })
    )
    const pipeline = pipelineAt(tempDir())
    const url = `http://127.0.0.1:${port}/index.json`
    await pipeline.fetchCatalog({ url, parse: parseCatalog })
    await pipeline.fetchCatalog({ url, parse: parseCatalog })
    expect(hits).toBe(1)
    // force 应当绕过缓存
    await pipeline.fetchCatalog({ url, parse: parseCatalog, force: true })
    expect(hits).toBe(2)
  })

  it('回 HTML（网关错误页）时报错而不是把 HTML 当 JSON', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>502 Bad Gateway</html>')
    })
    servers.push(server)
    const port = await new Promise<number>((r) =>
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        r(typeof address === 'object' && address ? address.port : 0)
      })
    )
    const result = await pipelineAt(tempDir()).fetchCatalog({
      url: `http://127.0.0.1:${port}/index.json`,
      parse: parseCatalog
    })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('network')
  })
})

describe('install：原子落盘，失败不留残留', () => {
  const files = {
    'wf/workflow.json': JSON.stringify({ id: 'a', plan: { nodes: [] } }),
    'wf/cover.png': Buffer.from([0x89, 0x50, 0x4e, 0x47])
  }

  it('成功：文件落到目标目录', async () => {
    const { port } = await startServer(files)
    const root = tempDir()
    const target = join(root, 'installed', 'a')
    const result = await pipelineAt(join(root, 'cache')).install({
      targetDir: target,
      files: [
        { path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` },
        { path: 'cover.png', url: `http://127.0.0.1:${port}/wf/cover.png` }
      ],
      verify: () => ({ ok: true })
    })
    expect(result.ok).toBe(true)
    expect(existsSync(join(target, 'workflow.json'))).toBe(true)
    expect(existsSync(join(target, 'cover.png'))).toBe(true)
  })

  it('**校验失败时不留下目标目录**（用户看不到装了一半）', async () => {
    const { port } = await startServer(files)
    const root = tempDir()
    const target = join(root, 'installed', 'a')
    const result = await pipelineAt(join(root, 'cache')).install({
      targetDir: target,
      files: [{ path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` }],
      verify: () => ({ ok: false, reasonKey: 'badBundle' })
    })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('badBundle')
    expect(existsSync(target)).toBe(false)
    // 临时目录也要清干净
    expect(
      existsSync(join(root, 'cache', 'tmp')) ? readdirSafe(join(root, 'cache', 'tmp')) : []
    ).toEqual([])
  })

  it('下载失败时不留下目标目录', async () => {
    const { port, setFail } = await startServer(files)
    setFail(true)
    const root = tempDir()
    const target = join(root, 'installed', 'a')
    const result = await pipelineAt(join(root, 'cache')).install({
      targetDir: target,
      files: [{ path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` }],
      verify: () => ({ ok: true })
    })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('download')
    expect(existsSync(target)).toBe(false)
  })

  it('**更新时旧版本不被破坏**：新内容校验失败 → 旧的仍在', async () => {
    const { port } = await startServer(files)
    const root = tempDir()
    const target = join(root, 'installed', 'a')
    const pipeline = pipelineAt(join(root, 'cache'))
    await pipeline.install({
      targetDir: target,
      files: [{ path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` }],
      verify: () => ({ ok: true })
    })
    writeFileSync(join(target, 'marker.txt'), 'old-version')

    const failed = await pipeline.install({
      targetDir: target,
      files: [{ path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` }],
      verify: () => ({ ok: false, reasonKey: 'badBundle' })
    })
    expect(failed.ok).toBe(false)
    // 旧版本必须完好：这是「先挪走再换」的意义
    expect(readFileSync(join(target, 'marker.txt'), 'utf8')).toBe('old-version')
  })

  it('更新成功后旧内容被替换（不留 .old 残留）', async () => {
    const { port } = await startServer(files)
    const root = tempDir()
    const target = join(root, 'installed', 'a')
    const pipeline = pipelineAt(join(root, 'cache'))
    await pipeline.install({
      targetDir: target,
      files: [{ path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` }],
      verify: () => ({ ok: true })
    })
    writeFileSync(join(target, 'marker.txt'), 'old-version')
    const again = await pipeline.install({
      targetDir: target,
      files: [{ path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` }],
      verify: () => ({ ok: true })
    })
    expect(again.ok).toBe(true)
    expect(existsSync(join(target, 'marker.txt'))).toBe(false)
    expect(existsSync(`${target}.old`)).toBe(false)
  })
})

describe('uninstall 与哈希', () => {
  it('卸载整目录删除', async () => {
    const root = tempDir()
    const target = join(root, 'installed', 'a')
    const pipeline = pipelineAt(join(root, 'cache'))
    const { port } = await startServer({ 'wf/workflow.json': '{}' })
    await pipeline.install({
      targetDir: target,
      files: [{ path: 'workflow.json', url: `http://127.0.0.1:${port}/wf/workflow.json` }],
      verify: () => ({ ok: true })
    })
    expect(existsSync(target)).toBe(true)
    expect(pipeline.uninstall(target).ok).toBe(true)
    expect(existsSync(target)).toBe(false)
    // 重复卸载不报错（幂等）
    expect(pipeline.uninstall(target).ok).toBe(true)
  })

  it('sha256OfBytes 稳定且区分内容', () => {
    const a = new TextEncoder().encode('{"a":1}')
    const b = new TextEncoder().encode('{"a":2}')
    expect(sha256OfBytes(a)).toBe(sha256OfBytes(a))
    expect(sha256OfBytes(a)).not.toBe(sha256OfBytes(b))
    expect(sha256OfBytes(a)).toHaveLength(64)
  })
})

/** 目录列表（不存在时返回空数组） */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
