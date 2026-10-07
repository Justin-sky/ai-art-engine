import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 工作流市场服务的**响应形状与端到端流程**。
 *
 * ## 这个文件是为了一个真实事故而存在的
 *
 * 服务曾返回 `{ ok, catalog: { entries } }`，而 IPC 契约声明的是**顶层** `entries`。
 * 渲染层读 `result.entries` 得到 `undefined` → `?? []` → 界面显示「远端市场共 0 个工作流」，
 * 而主进程日志**同时**显示「entries=15」（日志打在返回之前）。
 *
 * 编译器当时拦不住，因为 `handle()` 是泛型、`ipcRenderer.invoke` 返回 `any`，
 * 服务与契约之间没有类型关联。现在服务端的返回类型**就是**契约类型，
 * 而下面的断言从**运行期**再钉一遍形状 —— 类型与测试各守一道。
 *
 * 用真实 HTTP 服务端 + 临时 userData：这一段的失败模式就发生在「取回数据 → 组装响应」
 * 之间，打桩会把要验的东西一起打掉。
 */

const servers: Server[] = []
const dirs: string[] = []
let userDataDir = ''
let source = ''

const INDEX = {
  schemaVersion: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  source: { repo: 'https://example.test', ref: 'main' },
  workflows: [
    {
      id: 'demo-flow',
      title: '演示工作流',
      summary: '一句话简介',
      category: 'film',
      version: '1.0.0',
      author: { name: '测试作者' },
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
  summary: '一句话简介',
  category: 'film',
  version: '1.0.0',
  author: { name: '测试作者' },
  license: 'CC-BY-4.0',
  cover: 'cover.png',
  requires: { nodeTypes: [], appMinVersion: '7.1.0' },
  plan: {
    title: '演示工作流',
    nodes: [{ key: 'n1', typeId: 'note.text', params: { text: 'hi' } }],
    edges: []
  }
}

vi.mock('electron', () => ({
  app: { getPath: () => userDataDir }
}))
vi.mock('../src/main/services/settingsService', () => ({
  settingsService: { get: () => ({ workflowMarket: { source } }) }
}))
vi.mock('../src/main/services/updateService', () => ({
  updateService: { getCurrentVersion: () => '7.1.3' }
}))

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

beforeEach(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'aae-service-'))
  dirs.push(userDataDir)
  const server = createServer((req, res) => {
    const url = req.url ?? '/'
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
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
  source = `http://127.0.0.1:${port}`
})

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  source = ''
  userDataDir = ''
})

describe('fetchWorkflowCatalog：响应形状（回归守卫）', () => {
  it('**entries 在响应顶层**，不在 catalog 里（曾因此让界面显示 0 条）', async () => {
    const { fetchWorkflowCatalog } = await import('../src/main/services/workflowMarketService')
    const result = await fetchWorkflowCatalog({ force: true })

    expect(result.ok).toBe(true)
    // 这一条断言就是那次事故的核心：渲染层读的是 result.entries
    expect(Array.isArray(result.entries), 'result.entries 必须是数组').toBe(true)
    expect(result.entries).toHaveLength(1)
    expect(result.entries?.[0]?.id).toBe('demo-flow')
    // 反向守卫：不得再出现多包一层的 catalog
    expect(result).not.toHaveProperty('catalog')
  })

  it('附带兼容性结论与安装状态字段（界面据此渲染）', async () => {
    const { fetchWorkflowCatalog } = await import('../src/main/services/workflowMarketService')
    const result = await fetchWorkflowCatalog({ force: true })
    const entry = result.entries![0]!
    expect(entry.missingNodeTypes).toEqual([])
    expect(entry.blockReason).toBeNull()
    expect(entry.installed).toBe(false)
    expect(entry.installedVersion).toBeNull()
    expect(entry.updatable).toBe(false)
    expect(entry.title).toBe('演示工作流')
    expect(entry.nodeCount).toBe(1)
  })

  it('失败时 reasonKey 在顶层，且没有 entries 字段被误读成空目录', async () => {
    source = 'http://127.0.0.1:1' // 必然连不上
    const { fetchWorkflowCatalog, resetWorkflowMarketCache } =
      await import('../src/main/services/workflowMarketService')
    resetWorkflowMarketCache()
    const result = await fetchWorkflowCatalog({ force: true })
    expect(result.ok).toBe(false)
    expect(result.reasonKey).toBe('network')
  })
})

describe('安装 → 记账 → 读取 → 卸载 全流程', () => {
  it('安装后 entries[].installed 变为 true，且能读回 plan', async () => {
    const service = await import('../src/main/services/workflowMarketService')

    const before = await service.fetchWorkflowCatalog({ force: true })
    expect(before.entries![0]!.installed).toBe(false)

    const installed = await service.installWorkflow({ id: 'demo-flow' })
    expect(installed.ok).toBe(true)

    // 落盘位置与内容
    const target = join(userDataDir, 'workflows', 'demo-flow')
    expect(existsSync(join(target, 'workflow.json'))).toBe(true)
    expect(existsSync(join(target, 'cover.png'))).toBe(true)

    // 记账
    const records = service.listInstalledWorkflows()
    expect(records.map((item) => item.id)).toEqual(['demo-flow'])
    expect(records[0]!.version).toBe('1.0.0')

    // 目录视图随之更新
    service.resetWorkflowMarketCache()
    const after = await service.fetchWorkflowCatalog({ force: true })
    expect(after.entries![0]!.installed).toBe(true)
    expect(after.entries![0]!.installedVersion).toBe('1.0.0')
    expect(after.entries![0]!.updatable).toBe(false)

    // 读回 plan（「使用」用它物化）
    const bundle = service.readInstalledWorkflowPlan('demo-flow')
    expect(bundle.ok).toBe(true)
    expect(bundle.bundle?.id).toBe('demo-flow')
    expect(bundle.bundle?.title).toBe('演示工作流')
    expect(bundle.bundle?.plan).toMatchObject({ nodes: [{ key: 'n1' }] })

    // 卸载
    expect(service.uninstallWorkflow({ id: 'demo-flow' }).ok).toBe(true)
    expect(existsSync(target)).toBe(false)
    expect(service.listInstalledWorkflows()).toEqual([])
    expect(service.readInstalledWorkflowPlan('demo-flow')).toMatchObject({
      ok: false,
      reasonKey: 'notInstalled'
    })
  })

  it('目录被手删后不再显示「已安装」（记录与磁盘对账）', async () => {
    const service = await import('../src/main/services/workflowMarketService')
    await service.installWorkflow({ id: 'demo-flow' })
    expect(service.listInstalledWorkflows()).toHaveLength(1)

    rmSync(join(userDataDir, 'workflows', 'demo-flow'), { recursive: true, force: true })
    expect(service.listInstalledWorkflows()).toEqual([])
  })

  it('封面转成 data URL（渲染层 CSP 不允许 https 图片直连）', async () => {
    const service = await import('../src/main/services/workflowMarketService')
    const cover = await service.fetchWorkflowCover('demo-flow')
    expect(cover.ok).toBe(true)
    expect(cover.dataUrl?.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('id 不存在时读取给出明确原因键（而不是抛错）', async () => {
    const service = await import('../src/main/services/workflowMarketService')
    expect(service.readInstalledWorkflowPlan('nope')).toMatchObject({
      ok: false,
      reasonKey: 'notInstalled'
    })
  })

  it('安装记录文件落成 JSON 数组（可人工检查/迁移）', async () => {
    const service = await import('../src/main/services/workflowMarketService')
    await service.installWorkflow({ id: 'demo-flow' })
    const raw = JSON.parse(readFileSync(join(userDataDir, 'workflows', 'installed.json'), 'utf8'))
    expect(Array.isArray(raw)).toBe(true)
    expect(raw[0]).toMatchObject({ id: 'demo-flow', version: '1.0.0' })
    expect(typeof raw[0].installedAt).toBe('string')
  })
})

describe('listInstalledWorkflowDetails：供对话面板展示的已安装清单', () => {
  it('记账文件只有 id/版本，详情把标题 / 简介 / 规模补齐', async () => {
    const service = await import('../src/main/services/workflowMarketService')
    await service.installWorkflow({ id: 'demo-flow' })

    const details = service.listInstalledWorkflowDetails()
    expect(details).toHaveLength(1)
    expect(details[0]).toMatchObject({
      id: 'demo-flow',
      title: '演示工作流',
      summary: '一句话简介',
      version: '1.0.0',
      nodeCount: 1,
      edgeCount: 0,
      broken: false
    })
    // 记账文件里没有 title —— 这正是要读包内文件的原因
    const record = JSON.parse(
      readFileSync(join(userDataDir, 'workflows', 'installed.json'), 'utf8')
    )
    expect(record[0].title).toBeUndefined()
  })

  it('包被改坏时**不隐藏**它，而是标 broken（悄悄消失会让用户以为「我明明装过」）', async () => {
    const service = await import('../src/main/services/workflowMarketService')
    await service.installWorkflow({ id: 'demo-flow' })

    writeFileSync(join(userDataDir, 'workflows', 'demo-flow', 'workflow.json'), '{ 不是合法 JSON')

    const details = service.listInstalledWorkflowDetails()
    expect(details).toHaveLength(1)
    expect(details[0]).toMatchObject({ id: 'demo-flow', title: 'demo-flow', broken: true })
  })

  it('没有任何安装时返回空数组（不抛错）', async () => {
    const service = await import('../src/main/services/workflowMarketService')
    expect(service.listInstalledWorkflowDetails()).toEqual([])
  })
})
