import { describe, expect, it, vi } from 'vitest'
import {
  buildGamePlayJobBrief,
  buildGamePlayJobTask,
  parseGamePlayJobResult,
  validateGamePlayJobDelivery,
  gamePlayDshError
} from '../src/shared/gamePlayDshJob'
import {
  inlineDistToSingleHtml,
  listScaffoldFiles,
  resolveReusableGamePlayJob
} from '../src/main/services/gamePlayDshJobService'
import { writeNodeGamePlayScaffold } from '../src/main/services/gamePlayScaffold'
import { GAME_PLAY_JOB_ROOT } from '../src/shared/gamePlayDshJob'
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { executeGameHtmlGenNode, executeGamePlayAssetNode } from '../src/shared/graph/execute'
import type { GraphNode, NodeExecuteContext } from '../src/shared/graph/execute/types'
import { SAMPLE_GAME_HTML_2D } from '../src/shared/gamePlay'

describe('gamePlayDshJob contract', () => {
  it('builds brief and task with pelican-bike style layout', () => {
    const brief = buildGamePlayJobBrief({
      instruction: '弹球得分',
      preferredMode: '2d',
      projectAbs: 'F:/proj/Cache/GamePlayJobs/x/project',
      resultAbs: 'F:/proj/Cache/GamePlayJobs/x/result.json',
      briefAbs: 'F:/proj/Cache/GamePlayJobs/x/brief.md'
    })
    expect(brief).toMatch(/pure Node \+ esbuild/)
    expect(brief).toMatch(/index\.template\.html/)
    expect(brief).toMatch(/弹球得分/)
    expect(brief).toMatch(/Do NOT call npm install/)
    expect(brief).toMatch(/NO React/)
    expect(brief).not.toMatch(/Resume/)

    const resumeBrief = buildGamePlayJobBrief({
      instruction: '加计分板',
      preferredMode: '2d',
      projectAbs: 'F:/proj/Cache/GamePlayJobs/x/project',
      resultAbs: 'F:/proj/Cache/GamePlayJobs/x/result.json',
      briefAbs: 'F:/proj/Cache/GamePlayJobs/x/brief.md',
      resume: true
    })
    expect(resumeBrief).toMatch(/resume/i)
    expect(resumeBrief).toMatch(/CONTINUE/)

    const task = buildGamePlayJobTask({
      instruction: '弹球得分',
      preferredMode: '2d',
      projectAbs: 'F:/proj/Cache/GamePlayJobs/x/project',
      resultAbs: 'F:/proj/Cache/GamePlayJobs/x/result.json',
      briefAbs: 'F:/proj/Cache/GamePlayJobs/x/brief.md'
    })
    expect(task).toMatch(/result\.json/)
    expect(task).toMatch(/pelican-bike/)

    const resumeTask = buildGamePlayJobTask({
      instruction: '加计分板',
      preferredMode: '2d',
      projectAbs: 'F:/proj/Cache/GamePlayJobs/x/project',
      resultAbs: 'F:/proj/Cache/GamePlayJobs/x/result.json',
      briefAbs: 'F:/proj/Cache/GamePlayJobs/x/brief.md',
      resume: true
    })
    expect(resumeTask).toMatch(/CONTINUE/)
  })

  it('parses and validates result.json', () => {
    expect(parseGamePlayJobResult('{"ok":true,"gameMode":"3d"}')?.gameMode).toBe('3d')
    expect(
      validateGamePlayJobDelivery({
        result: { ok: true, gameMode: '2d' },
        projectIndexExists: true
      })
    ).toBeNull()
    expect(
      validateGamePlayJobDelivery({
        result: null,
        projectIndexExists: true
      })
    ).toBe(gamePlayDshError('RESULT'))
    expect(
      validateGamePlayJobDelivery({
        result: { ok: true },
        projectIndexExists: false
      })
    ).toBe(gamePlayDshError('NO_ENTRY'))
  })

  it('inlines dist scripts and styles into one html', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-dist-'))
    try {
      const assets = join(dir, 'assets')
      mkdirSync(assets)
      writeFileSync(join(assets, 'index.js'), 'console.log(1)', 'utf8')
      writeFileSync(join(assets, 'index.css'), 'body{margin:0}', 'utf8')
      writeFileSync(
        join(dir, 'index.html'),
        `<!DOCTYPE html><html><head>
<link rel="stylesheet" href="./assets/index.css">
</head><body>
<div id="root"></div>
<script type="module" src="./assets/index.js"></script>
</body></html>`,
        'utf8'
      )
      const html = inlineDistToSingleHtml(dir)
      expect(html).toContain('<style>')
      expect(html).toContain('body{margin:0}')
      expect(html).toContain('<script type="module">')
      expect(html).toContain('console.log(1)')
      expect(html).not.toMatch(/src="\.\/assets/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes node/esbuild scaffold with pelican-bike entry files', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-seed-'))
    try {
      const projectAbs = join(root, 'project')
      writeNodeGamePlayScaffold(projectAbs, '2d')
      const files = listScaffoldFiles(projectAbs)
      expect(files).toContain('package.json')
      expect(files).toContain('build.mjs')
      expect(files).toContain('index.template.html')
      expect(files).toContain('src/main.js')
      expect(files).not.toContain('vite.config.ts')
      expect(files).not.toContain('src/App.tsx')
      const pkg = JSON.parse(readFileSync(join(projectAbs, 'package.json'), 'utf8')) as {
        scripts: { build: string }
        dependencies: Record<string, string>
      }
      expect(pkg.scripts.build).toBe('node build.mjs')
      expect(pkg.dependencies.esbuild).toBeTruthy()
      expect(pkg.dependencies.react).toBeUndefined()
      const buildMjs = readFileSync(join(projectAbs, 'build.mjs'), 'utf8')
      expect(buildMjs).toContain('/*APP_JS*/')
      expect(buildMjs).toMatch(/from 'esbuild'/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('resolves reusable job dir only for valid GamePlayJobs project paths', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-reuse-'))
    try {
      const jobId = 'job-reuse-1'
      const projectAbs = join(root, GAME_PLAY_JOB_ROOT, jobId, 'project')
      writeNodeGamePlayScaffold(projectAbs, '2d')
      const rel = `${GAME_PLAY_JOB_ROOT}/${jobId}/project`
      const hit = resolveReusableGamePlayJob(root, rel)
      expect(hit?.jobId).toBe(jobId)
      expect(hit?.projectRelativeDir.replace(/\\/g, '/')).toBe(rel)
      expect(resolveReusableGamePlayJob(root, 'Cache/Other/x/project')).toBeNull()
      expect(resolveReusableGamePlayJob(root, `${GAME_PLAY_JOB_ROOT}/../evil/project`)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('game.htmlGen / asset.gamePlay execute', () => {
  function baseNode(partial: Partial<GraphNode> & { typeId: string }): GraphNode {
    return {
      id: 'n1',
      title: 't',
      x: 0,
      y: 0,
      width: 200,
      height: 120,
      params: {},
      ...partial
    } as GraphNode
  }

  it('htmlGen persists project dir via runGamePlayDshJob (no generateText)', async () => {
    const node = baseNode({
      typeId: 'game.htmlGen',
      params: {
        generateInstruction: '顶视收集小游戏',
        gamePlayMode: '2d'
      }
    })
    const runGamePlayDshJob = vi.fn(async () => ({
      projectRelativeDir: 'Cache/GamePlayJobs/abc/project',
      gameMode: '2d' as const
    }))
    const generateText = vi.fn()
    const ctx = {
      node,
      inputs: {},
      locale: 'zh-CN',
      runGamePlayDshJob,
      generateText
    } as unknown as NodeExecuteContext

    const out = await executeGameHtmlGenNode(ctx)
    expect(runGamePlayDshJob).toHaveBeenCalledTimes(1)
    expect(generateText).not.toHaveBeenCalled()
    expect(node.params.gamePlayProjectDir).toBe('Cache/GamePlayJobs/abc/project')
    expect(node.params.gamePlayHtml).toBe('')
    expect(out.out?.kind).toBe('project')
    expect(String((out.out as { relativePath?: string })?.relativePath ?? '')).toContain(
      'GamePlayJobs'
    )
  })

  it('gamePlay cook calls buildGamePlayProject when project dir present', async () => {
    const node = baseNode({
      typeId: 'asset.gamePlay',
      params: {
        gamePlayProjectDir: 'Cache/GamePlayJobs/abc/project',
        gamePlayMode: '2d'
      }
    })
    const buildGamePlayProject = vi.fn(async () => ({
      html: SAMPLE_GAME_HTML_2D,
      buildHtmlRelativePath: 'Cache/GamePlayJobs/abc/project/dist/single.html'
    }))
    const ctx = {
      node,
      inputs: {},
      locale: 'zh-CN',
      buildGamePlayProject
    } as unknown as NodeExecuteContext

    await executeGamePlayAssetNode(ctx)
    expect(buildGamePlayProject).toHaveBeenCalledWith(
      expect.objectContaining({ projectRelativeDir: 'Cache/GamePlayJobs/abc/project' })
    )
    expect(node.params.gamePlayHtml).toBe('')
    expect(node.params.text).toBe('')
    expect(node.params.gamePlayBuildHtmlPath).toContain('single.html')
    expect(node.params.gamePlayHtmlPath).toContain('single.html')
  })
})
