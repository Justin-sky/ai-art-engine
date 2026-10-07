import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 技能包的**安装 → 卸载**生命周期。
 *
 * ## 这个文件是为一个真实 bug 而存在的
 *
 * `listInstalledWorkflows()` 是读函数，却在里面"顺手"把与磁盘对账后的结果写回记账
 *（目录被手删的记录不再显示「已安装」）。而 `uninstallWorkflow` 的顺序是：
 *
 *   1. 删掉 `<userData>/workflows/<id>` 目录
 *   2. 调 `listInstalledWorkflows()` 取记录 → **对账发现目录没了 → 立刻写回 `[]`**
 *   3. `removeInstalledSkill(records.find(...))` → 记录已经是空 → 拿到 `undefined`
 *
 * 结果：卸载返回 `{ok:true}`、界面显示"已卸载"，**随工作流装上的技能包却留在 dsh 技能根里**
 * —— 用户以为卸载干净了，agent 那边还挂着一份说明书。
 *
 * 两条守卫分别钉住"行为正确"和"读函数不许写盘"（后者才是根因）。
 */

let userDataDir = ''
let source = ''
let server: Server | null = null

vi.mock('electron', () => ({ app: { getPath: () => userDataDir } }))
vi.mock('../src/main/services/settingsService', () => ({
  settingsService: { get: () => ({ workflowMarket: { source } }) }
}))
vi.mock('../src/main/services/updateService', () => ({
  updateService: { getCurrentVersion: () => '7.1.3' }
}))

const ID = 'demo-skill-flow'
const SKILL_NAME = `wf-${ID}`

const INDEX = {
  schemaVersion: 1,
  workflows: [
    {
      id: ID,
      title: '带技能的工作流',
      summary: '演示技能包安装',
      category: 'utility',
      version: '1.0.0',
      author: { name: 'tester' },
      license: 'MIT',
      cover: 'cover.png',
      requires: { nodeTypes: [], appMinVersion: '7.1.0' },
      nodeCount: 1,
      edgeCount: 0,
      skill: {
        name: SKILL_NAME,
        description: '演示技能',
        entry: 'SKILL.md',
        hasScripts: false,
        files: [
          { path: 'SKILL.md', sizeBytes: 100 },
          { path: 'references/ports.md', sizeBytes: 50 }
        ],
        sizeBytes: 150
      }
    }
  ]
}

const BUNDLE = {
  schemaVersion: 1,
  id: ID,
  title: '带技能的工作流',
  summary: '演示技能包安装',
  category: 'utility',
  version: '1.0.0',
  author: { name: 'tester' },
  license: 'MIT',
  cover: 'cover.png',
  requires: { nodeTypes: [], appMinVersion: '7.1.0' },
  plan: {
    title: 't',
    nodes: [{ key: 'n1', typeId: 'note.text', params: { text: 'hi' } }],
    edges: []
  }
}

const SKILL_MD = `---\nname: ${SKILL_NAME}\ndescription: 演示技能\nworkflow: ${ID}\n---\n\n# 演示\n\n正文。\n`
const PORTS_MD = '# ports\n'

const PNG = Buffer.from('89504e470d0a1a0a', 'hex')

beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'aae-skill-lifecycle-'))
  server = createServer((req, res) => {
    const url = req.url ?? ''
    const json = (body: unknown): void => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url === '/index.json') return json(INDEX)
    if (url === `/workflows/${ID}/workflow.json`) return json(BUNDLE)
    if (url === `/workflows/${ID}/cover.png`) {
      res.writeHead(200, { 'content-type': 'image/png' })
      return res.end(PNG)
    }
    if (url === `/workflows/${ID}/skill/SKILL.md`) {
      res.writeHead(200, { 'content-type': 'text/markdown' })
      return res.end(SKILL_MD)
    }
    if (url === `/workflows/${ID}/skill/references/ports.md`) {
      res.writeHead(200, { 'content-type': 'text/markdown' })
      return res.end(PORTS_MD)
    }
    res.writeHead(404)
    res.end('nope')
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server!.address()
  source = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
})

afterAll(() => {
  server?.close()
  rmSync(userDataDir, { recursive: true, force: true })
})

const service = (): Promise<typeof import('../src/main/services/workflowMarketService')> =>
  import('../src/main/services/workflowMarketService')

const recordPath = (): string => join(userDataDir, 'workflows', 'installed.json')
const skillDir = (): string => join(userDataDir, 'dsh-harness', 'skills', SKILL_NAME)

describe('技能包：安装 → 卸载', () => {
  it('安装把技能落到 dsh 技能根，并记账 skillName', async () => {
    const svc = await service()
    const catalog = await svc.fetchWorkflowCatalog({ force: true })
    const entry = (catalog.entries ?? []).find((item) => item.id === ID)
    expect(entry?.skill?.name).toBe(SKILL_NAME)

    const result = await svc.installWorkflow({ id: ID, skill: entry!.skill })
    expect(result.ok, JSON.stringify(result)).toBe(true)

    expect(existsSync(join(skillDir(), 'SKILL.md'))).toBe(true)
    expect(existsSync(join(skillDir(), 'references', 'ports.md'))).toBe(true)

    const records = JSON.parse(readFileSync(recordPath(), 'utf8')) as Array<Record<string, unknown>>
    expect(records.find((item) => item.id === ID)?.skillName).toBe(SKILL_NAME)
  }, 30_000)

  it('**读函数不许写盘**：对账只过滤，不改动记账文件', async () => {
    /*
      根因守卫。曾经 `listInstalledWorkflows` 在对账后 `writeRecords(reconciled)`，
      于是一个**读**动作会抹掉记录 —— `uninstallWorkflow` 先删目录再取记录时，
      `skillName` 就在取的那一刻被对账写没了。

      要触发它必须造出「目录已不在」的记录（那才是对账会动手的情形）；只是普通地
      列举一把，对账前后一致、根本不会写，这条守卫就永远不会红。
    */
    const svc = await service()
    const backup = readFileSync(recordPath(), 'utf8')
    try {
      const stale = [{ id: 'ghost-flow', version: '1.0.0', installedAt: 'x', source: 's' }]
      writeFileSync(recordPath(), `${JSON.stringify(stale, null, 2)}\n`, 'utf8')
      const before = readFileSync(recordPath(), 'utf8')

      const listed = svc.listInstalledWorkflows()
      // 对账仍然生效：目录不存在的记录不返回（界面不该显示「已安装」）
      expect(listed.some((item) => item.id === 'ghost-flow')).toBe(false)
      // 但读动作没有写盘
      expect(readFileSync(recordPath(), 'utf8')).toBe(before)
    } finally {
      writeFileSync(recordPath(), backup, 'utf8')
    }
  })

  it('卸载把技能目录一起删掉（曾经的 bug：返回 ok 但技能留在磁盘上）', async () => {
    const svc = await service()
    expect(existsSync(join(skillDir(), 'SKILL.md'))).toBe(true)

    const result = svc.uninstallWorkflow({ id: ID })
    expect(result.ok, JSON.stringify(result)).toBe(true)

    expect(existsSync(skillDir())).toBe(false)
    expect(existsSync(join(userDataDir, 'workflows', ID))).toBe(false)
    const records = JSON.parse(readFileSync(recordPath(), 'utf8')) as unknown[]
    expect(records).toEqual([])
  }, 30_000)
})
