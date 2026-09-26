import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  GAME_PLAY_JOB_LOG_MAX,
  appendGamePlayJobLog,
  findGamePlayAssetByProject,
  gamePlayAssetGenParams,
  gamePlayAssetName,
  gamePlayJobIdOf,
  gamePlayJobLogTail,
  normalizeGamePlayJobMode,
  resolveGamePlayProjectRelativeDir
} from '../src/shared/gamePlayJob'

/** 可控的 cook：测试要断言 building → done 两段状态，所以用 deferred 卡住中间态 */
const buildState = vi.hoisted(() => ({
  deferred: null as null | {
    resolve: (value: {
      html: string
      buildHtmlRelativePath: string
      bytes: number
      logs: string[]
    }) => void
    reject: (error: Error) => void
    calls: Array<{ projectRelativeDir: string }>
  }
}))

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => true,
    getRoot: () => projectRoot
  }
}))

let projectRoot = ''

vi.mock('../src/main/services/gamePlayBuildService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/services/gamePlayBuildService')>()
  return {
    ...actual,
    buildGamePlayProject: (input: {
      projectRelativeDir: string
      onLog?: (line: string) => void
    }) => {
      return new Promise((resolve, reject) => {
        buildState.deferred = {
          resolve,
          reject,
          calls: [{ projectRelativeDir: input.projectRelativeDir }]
        }
        input.onLog?.('npm install…')
      })
    }
  }
})

const {
  getGamePlayJob,
  getGamePlayJobByProjectDir,
  listGamePlayJobs,
  prepareGamePlayProject,
  resetGamePlayJobsForTest,
  setGamePlayJobAsset,
  startGamePlayBuild
} = await import('../src/main/services/gamePlayJobService')

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('可玩 HTML 作业：契约（纯函数）', () => {
  it('只接受 <root>/<jobId>/project 形态的工程路径', () => {
    const ok = 'Cache/GamePlayJobs/job-1/project'
    expect(resolveGamePlayProjectRelativeDir(ok)).toBe(ok)
    expect(resolveGamePlayProjectRelativeDir(ok.replace(/\//g, '\\'))).toBe(ok)
    expect(resolveGamePlayProjectRelativeDir('  /Cache/GamePlayJobs/job-1/project  ')).toBe(ok)
    // 越权 / 非作业目录一律拒绝：入参来自模型，不能当任意路径读取器
    expect(resolveGamePlayProjectRelativeDir('Cache/GamePlayJobs/../evil/project')).toBeNull()
    expect(resolveGamePlayProjectRelativeDir('Cache/GamePlayJobs/job-1')).toBeNull()
    expect(resolveGamePlayProjectRelativeDir('Cache/Other/job-1/project')).toBeNull()
    expect(resolveGamePlayProjectRelativeDir('Cache/GamePlayJobs/a/b/project')).toBeNull()
    expect(resolveGamePlayProjectRelativeDir('')).toBeNull()
    expect(resolveGamePlayProjectRelativeDir(undefined)).toBeNull()
  })

  it('从工程路径取 jobId，并归一化模式', () => {
    expect(gamePlayJobIdOf('Cache/GamePlayJobs/job-9/project')).toBe('job-9')
    expect(gamePlayJobIdOf('Cache/GamePlayJobs/../x/project')).toBeNull()
    expect(normalizeGamePlayJobMode('3d')).toBe('3d')
    expect(normalizeGamePlayJobMode('2d')).toBe('2d')
    expect(normalizeGamePlayJobMode('auto')).toBe('auto')
    expect(normalizeGamePlayJobMode('4d')).toBe('auto')
    expect(normalizeGamePlayJobMode(undefined)).toBe('auto')
  })

  it('游戏资产名与 genParams：没给名字时用 jobId 兜底，路径统一写进 genParams', () => {
    expect(gamePlayAssetName('低多边形太空站', 'job-1', '可玩 HTML')).toBe('低多边形太空站')
    expect(gamePlayAssetName('  多  空格  ', 'job-1', '可玩 HTML')).toBe('多 空格')
    expect(gamePlayAssetName(undefined, 'abcdef12-3456', '可玩 HTML')).toBe('可玩 HTML abcdef12')
    expect(gamePlayAssetName('', 'j!o@b', 'Playable HTML')).toBe('Playable HTML job')
    expect(gamePlayAssetName(undefined, '', '可玩 HTML')).toBe('可玩 HTML')
    expect(gamePlayAssetName('x'.repeat(120), 'job-1', 'f')).toHaveLength(60)

    const genParams = gamePlayAssetGenParams({
      projectRelativeDir: 'Cache/GamePlayJobs/job-1/project',
      buildHtmlRelativePath: 'Cache/GamePlayJobs/job-1/project/dist/single.html',
      mode: '3d'
    })
    expect(genParams.gamePlayProjectDir).toBe('Cache/GamePlayJobs/job-1/project')
    expect(genParams.gamePlayBuildHtmlPath).toBe(
      'Cache/GamePlayJobs/job-1/project/dist/single.html'
    )
    expect(genParams.gamePlayMode).toBe('3d')
    // 整页 HTML 不许进资产参数（卡片预览与响应式图文档都会被拖垮）
    expect(genParams.gamePlayHtml).toBe('')
  })

  it('按工程目录找 gamePlay 资产：去重键忽略大小写与反斜杠，类型不符不算命中', () => {
    const assets = [
      {
        id: 'a1',
        type: 'image',
        genParams: { gamePlayProjectDir: 'Cache/GamePlayJobs/j1/project' }
      },
      {
        id: 'a2',
        type: 'gamePlay',
        genParams: { gamePlayProjectDir: 'Cache\\GamePlayJobs\\J1\\Project' }
      }
    ]
    expect(findGamePlayAssetByProject(assets, 'Cache/GamePlayJobs/j1/project')?.id).toBe('a2')
    expect(findGamePlayAssetByProject(assets, 'Cache/GamePlayJobs/j2/project')).toBeUndefined()
    expect(findGamePlayAssetByProject(assets, '')).toBeUndefined()
    expect(findGamePlayAssetByProject([], 'Cache/GamePlayJobs/j1/project')).toBeUndefined()
  })

  it('日志尾部截断且丢弃空行', () => {
    const logs: string[] = []
    appendGamePlayJobLog(logs, '  ')
    appendGamePlayJobLog(logs, ' first ')
    expect(logs).toEqual(['first'])

    for (let i = 0; i < GAME_PLAY_JOB_LOG_MAX + 20; i += 1) {
      appendGamePlayJobLog(logs, `line ${i}`)
    }
    // 超上限只丢最旧的，最新的一定在
    expect(logs).toHaveLength(GAME_PLAY_JOB_LOG_MAX)
    expect(logs.at(-1)).toBe(`line ${GAME_PLAY_JOB_LOG_MAX + 19}`)
    expect(gamePlayJobLogTail(logs)).toHaveLength(40)
    expect(gamePlayJobLogTail(logs)[0]).toBe(logs[logs.length - 40])
  })
})

describe('可玩 HTML 作业：服务', () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'gp-job-'))
    resetGamePlayJobsForTest()
    buildState.deferred = null
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
  })

  it('prepare 落脚手架并返回工程路径与文件清单', () => {
    const prepared = prepareGamePlayProject({ mode: '3d', title: '低多边形太空站' })
    expect(prepared.projectRelativeDir).toBe(`Cache/GamePlayJobs/${prepared.jobId}/project`)
    expect(existsSync(join(prepared.projectAbs, 'build.mjs'))).toBe(true)
    expect(existsSync(join(prepared.projectAbs, 'src', 'core', 'rng.js'))).toBe(true)
    expect(existsSync(join(prepared.projectAbs, 'src', 'assets', 'geometry', 'crystal.js'))).toBe(
      true
    )
    expect(prepared.files).toContain('src/main.js')
    const job = getGamePlayJob(prepared.jobId)
    expect(job?.status).toBe('ready')
    expect(job?.title).toBe('低多边形太空站')
  })

  it('2D prepare 不带 three 专属模块', () => {
    const prepared = prepareGamePlayProject({ mode: '2d' })
    expect(existsSync(join(prepared.projectAbs, 'src', 'assets', 'geometry', 'crystal.js'))).toBe(
      false
    )
    expect(existsSync(join(prepared.projectAbs, 'src', 'assets', 'texture', 'panel.js'))).toBe(true)
  })

  it('build 走 building → done，并带上产物路径与体积', async () => {
    const prepared = prepareGamePlayProject({ mode: '3d' })
    const started = startGamePlayBuild({ projectRelativeDir: prepared.projectRelativeDir })
    expect(started.status).toBe('building')
    await settle()
    expect(buildState.deferred?.calls[0]?.projectRelativeDir).toBe(prepared.projectRelativeDir)

    buildState.deferred?.resolve({
      html: '<html></html>',
      buildHtmlRelativePath: `${prepared.projectRelativeDir}/dist/single.html`,
      bytes: 2048,
      logs: []
    })
    await settle()

    const job = getGamePlayJob(started.jobId)
    expect(job?.status).toBe('done')
    expect(job?.bytes).toBe(2048)
    expect(job?.buildHtmlRelativePath).toBe(`${prepared.projectRelativeDir}/dist/single.html`)
    expect(job?.logs.join('\n')).toContain('build done')
  })

  it('build 失败落 error 与可读原因，且不吞日志', async () => {
    const prepared = prepareGamePlayProject({ mode: '2d' })
    const started = startGamePlayBuild({ projectRelativeDir: prepared.projectRelativeDir })
    await settle()
    buildState.deferred?.reject(new Error('GRAPH_GAMEPLAY_HTML_TOO_LARGE'))
    await settle()

    const job = getGamePlayJob(started.jobId)
    expect(job?.status).toBe('error')
    expect(job?.error).toBe('GRAPH_GAMEPLAY_HTML_TOO_LARGE')
    expect(job?.logs.join('\n')).toContain('build failed')
  })

  it('同一工程重复 build 复用同一条作业记录（对话里「再改一版」不刷屏）', async () => {
    const prepared = prepareGamePlayProject({ mode: '3d' })
    const first = startGamePlayBuild({ projectRelativeDir: prepared.projectRelativeDir })
    await settle()
    buildState.deferred?.resolve({
      html: '<html></html>',
      buildHtmlRelativePath: `${prepared.projectRelativeDir}/dist/single.html`,
      bytes: 1024,
      logs: []
    })
    await settle()

    const second = startGamePlayBuild({ projectRelativeDir: prepared.projectRelativeDir })
    expect(second.jobId).toBe(first.jobId)
    expect(listGamePlayJobs()).toHaveLength(1)
  })

  it('构建收尾回调 onSettled：成功与失败都要回调，且能回填资产 id', async () => {
    const prepared = prepareGamePlayProject({ mode: '3d', title: '太空站' })
    const settled: Array<{ status: string; title?: string }> = []
    startGamePlayBuild({
      projectRelativeDir: prepared.projectRelativeDir,
      onSettled: (job) => settled.push({ status: job.status, title: job.title })
    })
    await settle()
    buildState.deferred?.resolve({
      html: '<html></html>',
      buildHtmlRelativePath: `${prepared.projectRelativeDir}/dist/single.html`,
      bytes: 4096,
      logs: []
    })
    await settle()
    expect(settled).toEqual([{ status: 'done', title: '太空站' }])

    setGamePlayJobAsset(prepared.jobId, 'asset-1')
    expect(getGamePlayJob(prepared.jobId)?.assetId).toBe('asset-1')
    expect(getGamePlayJobByProjectDir(prepared.projectRelativeDir)?.assetId).toBe('asset-1')
    expect(getGamePlayJobByProjectDir('Cache/Other/x/project')).toBeNull()

    // 失败路径也要回调，MCP 层才能把活动收成 error
    const failSettled: string[] = []
    const second = startGamePlayBuild({
      projectRelativeDir: prepared.projectRelativeDir,
      onSettled: (job) => failSettled.push(job.status)
    })
    await settle()
    buildState.deferred?.reject(new Error('boom'))
    await settle()
    expect(failSettled).toEqual(['error'])
    expect(getGamePlayJob(second.jobId)?.error).toBe('boom')
  })

  it('拒绝非法工程路径与未知作业', () => {
    expect(() => startGamePlayBuild({ projectRelativeDir: 'Cache/Other/x/project' })).toThrow(
      /GRAPH_GAMEPLAY_BAD_PROJECT/
    )
    expect(() =>
      prepareGamePlayProject({ projectRelativeDir: 'Cache/GamePlayJobs/../evil/project' })
    ).toThrow(/GRAPH_GAMEPLAY_BAD_PROJECT/)
    expect(getGamePlayJob('nope')).toBeNull()
  })

  it('续写既有工程时不丢已写的 src/**', () => {
    const prepared = prepareGamePlayProject({ mode: '3d' })
    const again = prepareGamePlayProject({
      mode: '3d',
      projectRelativeDir: prepared.projectRelativeDir
    })
    expect(again.jobId).toBe(prepared.jobId)
    expect(again.projectRelativeDir).toBe(prepared.projectRelativeDir)
  })
})
