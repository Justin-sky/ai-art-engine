import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { VideoJobRecord } from '../src/shared/videoJob'

/**
 * 「世界已生成、但下载失败」后的补取闭环。
 *
 * 这条测试锁的是**真实故障路径**（不是判定函数本身）：
 * 上游下载连着失败 → 任务判死，但 `resourceId`（World.id）必须已经落盘；
 * 重新打开工程 → `resumePending` 凭它重新轮询一次，把产物取回来，
 * **不重新生成**（也就不再花一次积分）。
 */
const h = vi.hoisted(() => ({
  state: {
    jobs: new Map<string, VideoJobRecord>(),
    files: new Set<string>(),
    attached: [] as Array<{ type: string; sourceFilePath: string; name: string }>,
    /** 模拟「上游已经生成完，只等我们下回来」：每次轮询都返回同一批直链 */
    pollCompleted: true,
    downloadShouldFail: true,
    providers: [{ id: 'p1' }] as unknown[],
    /** 工程配置里的缓存根（媒体目录是它下面的 Models / Videos …） */
    cacheOutputDir: 'Cache',
    /** 临时工程根：需要真实文件的用例（补取附加产物）会把它换成真目录 */
    root: 'C:/proj'
  }
}))

vi.mock('../src/main/repositories/videoJobRepository', () => ({
  videoJobRepository: {
    write: (_root: string, job: VideoJobRecord) => {
      h.state.jobs.set(job.localJobId, job)
      return job
    },
    get: (_root: string, id: string) => h.state.jobs.get(id) ?? null,
    list: () => [...h.state.jobs.values()],
    listActive: () =>
      [...h.state.jobs.values()].filter(
        (job) => job.status === 'submitted' || job.status === 'running'
      ),
    patch: (_root: string, id: string, patch: Partial<VideoJobRecord>) => {
      const current = h.state.jobs.get(id)
      if (!current) return null
      const next = { ...current, ...patch }
      h.state.jobs.set(id, next)
      return next
    },
    pruneTerminal: () => undefined
  }
}))

vi.mock('../src/main/services/projectService', () => ({
  // videoJobService 在模块加载时就把「取任务记录」的能力注册给 projectService
  // （用来打断两者的循环依赖），所以 mock 里也必须提供这个导出
  setWorldMetaJobResolver: () => undefined,
  projectService: {
    isOpen: () => true,
    getRoot: () => h.state.root,
    getConfig: () => ({ cacheOutputDir: h.state.cacheOutputDir }),
    listAssets: () => [],
    updateAsset: () => undefined,
    attachExternalGeneratedFile: (params: {
      type: string
      sourceFilePath: string
      name: string
      outputDir?: string
    }) => {
      const fileName = params.sourceFilePath.split(/[\\/]/).pop() ?? 'output.glb'
      h.state.attached.push({
        type: params.type,
        sourceFilePath: params.sourceFilePath,
        name: params.name
      })
      // 真实注册器把产物放进目标目录并返回相对工程根的路径
      const dir = params.outputDir?.trim() || 'Cache/Models'
      return {
        id: `asset-${h.state.attached.length}`,
        type: params.type,
        name: params.name,
        relativePath: `${dir}/${fileName}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }
  }
}))

vi.mock('../src/main/services/settingsService', () => ({
  settingsService: { get: () => ({ models: { providers: h.state.providers } }) }
}))

vi.mock('../src/main/services/objectStorageUploadService', () => ({
  deleteUploads: vi.fn(async () => undefined)
}))

// 广播要走 electron 的 BrowserWindow，测试环境里没有窗口；单独挡掉
vi.mock('../src/main/broadcast', () => ({
  broadcastToAllWindows: vi.fn()
}))

vi.mock('../src/main/services/modelProviders', () => ({
  modelProviderFacade: {
    pollWorld: async () => {
      if (!h.state.pollCompleted) return { status: 'failed', progress: 100, error: 'poll boom' }
      return {
        status: 'completed',
        progress: 100,
        downloadUrl: 'https://cdn.example.com/world.glb',
        resourceId: 'world-42',
        extraDownloads: [
          { kind: 'splats', url: 'https://cdn.example.com/world.spz' },
          { kind: 'pano', url: 'https://cdn.example.com/world.pano.png' }
        ]
      }
    },
    pollVideo: async () => ({ status: 'failed', progress: 100, error: 'poll boom' }),
    pollModel3d: async () => ({ status: 'failed', progress: 100, error: 'poll boom' }),
    pollSpatialWorldExport: async () => ({ status: 'failed', progress: 100, error: 'poll boom' }),
    downloadVideoToFile: async (_provider: unknown, _url: string, dest: string) => {
      if (h.state.downloadShouldFail) throw new Error('502 from CDN')
      h.state.files.add(dest)
    }
  }
}))

const { videoJobService, shouldRecoverJob } = await import('../src/main/services/videoJobService')

/**
 * 拦住真实计时器（补取退避 15s×n、下载重试间隔 5s，测试里等不起），
 * 并把每次被安排的定时器收进队列，由 `run()` 逐个放行。
 * 放行时反复让出事件循环直到终态 —— pollOnce 是 fire-and-forget，
 * 链路里还夹着动态 import 与下载重试的 sleep，光跑微任务队列不够。
 */
function capturePoll(): { run: () => Promise<void>; count: () => number } {
  const queue: Array<() => void> = []
  let count = 0
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void) => {
    count += 1
    queue.push(fn)
    return 0 as unknown as ReturnType<typeof setTimeout>
  }) as unknown as typeof setTimeout)
  return {
    count: () => count,
    run: async () => {
      for (let i = 0; i < 10 && queue.length; i++) {
        const fn = queue.shift()
        fn?.()
        await settle()
      }
    }
  }
}

/** 让出事件循环直到没有活跃任务（轮询链里含动态 import，微任务不够） */
async function settle(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function seedJob(patch: Partial<VideoJobRecord> = {}): VideoJobRecord {
  const job: VideoJobRecord = {
    version: 1,
    kind: 'spatialWorld',
    localJobId: 'job-1',
    providerJobId: 'op-1',
    pollingUrl: 'op-1',
    providerInstanceId: 'p1',
    model: 'marble-1.1',
    prompt: 'a quiet alley',
    status: 'failed',
    progress: 100,
    source: 'graph',
    error: 'spatial world finished but download failed: 502 from CDN',
    createdAt: new Date().toISOString(),
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch
  }
  h.state.jobs.set(job.localJobId, job)
  return job
}

/** 真临时目录：补取附加产物要先判「主产物是否已在磁盘上」 */
function withRealProjectRoot(): { root: string; mainRel: string } {
  const root = mkdtempSync(join(tmpdir(), 'aae-job-'))
  const mainRel = 'Cache/Models/world.glb'
  mkdirSync(join(root, 'Cache', 'Models'), { recursive: true })
  writeFileSync(join(root, mainRel), 'GLB')
  h.state.root = root
  h.state.cacheOutputDir = 'Cache'
  return { root, mainRel }
}

beforeEach(() => {
  h.state.jobs.clear()
  h.state.files.clear()
  h.state.attached.length = 0
  h.state.pollCompleted = true
  h.state.downloadShouldFail = true
  h.state.providers = [{ id: 'p1' }]
  h.state.root = 'C:/proj'
  h.state.cacheOutputDir = 'Cache'
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('download failure keeps the world id on disk', () => {
  it('persists resourceId before downloading, and keeps it when the download dies', async () => {
    const poll = capturePoll()
    seedJob({ status: 'running', resourceId: undefined, error: undefined })
    videoJobService.resumePending()
    await poll.run()

    const after = h.state.jobs.get('job-1')!
    expect(after.status).toBe('failed')
    // 关键：世界 id 还在，下次还能重新取回产物
    expect(after.resourceId).toBe('world-42')
    expect(after.providerJobId).toBe('op-1')
    expect(shouldRecoverJob(after)).toBe(true)
    expect(h.state.attached).toHaveLength(0)
    expect(h.state.files.size).toBe(0)
  })
})

describe('reopening the project tops the artifact back up', () => {
  it('re-polls by resourceId and lands the artifact without regenerating', async () => {
    const poll = capturePoll()
    seedJob({ resourceId: 'world-42' })
    h.state.downloadShouldFail = false

    videoJobService.resumePending()
    const retried = h.state.jobs.get('job-1')!
    expect(retried.status).toBe('submitted')
    expect(retried.recoveryAttempts).toBe(1)

    await poll.run()
    const settled = h.state.jobs.get('job-1')!
    expect(settled.status).toBe('succeeded')
    expect(settled.resourceId).toBe('world-42')
    expect(settled.relativePath).toBe('Cache/Models/output.glb')
    // 主产物 + 两项附加产物都下了，泼溅 / 全景与主产物同目录同名
    expect(h.state.files.size).toBe(3)
    expect(settled.extras?.map((item) => item.relativePath)).toEqual([
      'Cache/Models/output.spz',
      'Cache/Models/output.png'
    ])
  })

  it('does not touch a job that never produced an upstream resource', async () => {
    const poll = capturePoll()
    seedJob({ resourceId: undefined })
    videoJobService.resumePending()
    expect(poll.count()).toBe(0)
    expect(h.state.jobs.get('job-1')!.status).toBe('failed')
  })

  it('stops after the retry budget is spent', async () => {
    const poll = capturePoll()
    seedJob({ resourceId: 'world-42', recoveryAttempts: 3 })
    videoJobService.resumePending()
    expect(poll.count()).toBe(0)
  })

  it('keeps re-polling an in-flight job (status still active) — the existing resume path', async () => {
    const poll = capturePoll()
    seedJob({ status: 'running', resourceId: undefined, error: undefined })
    videoJobService.resumePending()
    expect(poll.count()).toBe(1)
    // 这是「续轮询」而不是「补取」，不动 recoveryAttempts
    expect(h.state.jobs.get('job-1')!.recoveryAttempts).toBeUndefined()
  })

  /**
   * 第二种真实故障：主产物下回来了、SPZ 泼溅没下来（附加产物逐项容错，任务仍是成功态）。
   * 打开工程时应只补缺的那一项，**不重下主产物**（它已经在磁盘上）。
   */
  it('tops up only the missing extra when the main artifact is already on disk', async () => {
    const poll = capturePoll()
    const { root, mainRel } = withRealProjectRoot()
    h.state.downloadShouldFail = false
    seedJob({
      status: 'succeeded',
      resourceId: 'world-42',
      assetId: 'asset-1',
      relativePath: mainRel,
      error: undefined,
      extras: [
        { kind: 'splats', url: 'https://cdn.example.com/world.spz' },
        { kind: 'pano', url: 'https://cdn.example.com/world.pano.png' }
      ]
    })

    videoJobService.resumePending()
    expect(poll.count()).toBe(1)
    await poll.run()

    const settled = h.state.jobs.get('job-1')!
    expect(settled.status).toBe('succeeded')
    // 主产物没重下（磁盘上那份原样重新登记），只补了 SPZ 与全景；
    // 全景按直链后缀落成 .png（原来失败时连文件都没有）
    expect(h.state.attached[0]?.sourceFilePath).toBe(join(root, mainRel))
    expect([...h.state.files].sort()).toEqual([
      join(root, 'Cache', 'Models', 'world.png'),
      join(root, 'Cache', 'Models', 'world.spz')
    ])
    expect(settled.extras?.map((item) => item.relativePath)).toEqual([
      'Cache/Models/world.spz',
      'Cache/Models/world.png'
    ])
    rmSync(root, { recursive: true, force: true })
  })
})
