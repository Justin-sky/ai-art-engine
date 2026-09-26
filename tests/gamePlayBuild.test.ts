import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildGamePlayProject,
  inlineDistToSingleHtml,
  listScaffoldFiles
} from '../src/main/services/gamePlayBuildService'
import { writeNodeGamePlayScaffold } from '../src/main/services/gamePlayScaffold'
import { GAME_PLAY_PROJECT_ROOT } from '../src/shared/gamePlayJob'
import { executeGamePlayAssetNode } from '../src/shared/graph/execute'
import type { GraphNode, NodeExecuteContext } from '../src/shared/graph/execute/types'
import { SAMPLE_GAME_HTML_2D } from '../src/shared/gamePlay'

/** 构建服务只依赖「当前工程根」，测试里用一个临时目录喂它 */
let projectRoot = ''

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => true,
    getRoot: () => projectRoot
  }
}))

/**
 * 构建（cook）服务 + 兼容层的 `asset.gamePlay` 节点执行。
 *
 * 游戏**生成**已改由 AI 对话面板驱动（MCP gameplay_*），`game.htmlGen` 节点与其
 * brief/result.json 作业契约一起下线；这里守住的是「宿主只跑 npm + build」这条路径。
 */
describe('可玩 HTML 构建服务', () => {
  it('内联 dist 里的相对 script / style 为单文件', () => {
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

  it('dist 不存在时报 BUILD_NO_DIST', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gp-nodist-'))
    try {
      expect(() => inlineDistToSingleHtml(dir)).toThrow(/GRAPH_GAMEPLAY_BUILD_NO_DIST/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('拒绝非法工程路径与缺少 package.json / build.mjs 的目录', async () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-build-'))
    try {
      projectRoot = root
      await expect(buildGamePlayProject({ projectRelativeDir: '../evil' })).rejects.toThrow(
        /GRAPH_GAMEPLAY_BAD_PROJECT/
      )
      await expect(
        buildGamePlayProject({ projectRelativeDir: 'Cache/GamePlayJobs/x/project' })
      ).rejects.toThrow(/GRAPH_GAMEPLAY_BAD_PROJECT/)

      const projectAbs = join(root, ...`${GAME_PLAY_PROJECT_ROOT}/x/project`.split('/'))
      mkdirSync(projectAbs, { recursive: true })
      writeFileSync(join(projectAbs, 'package.json'), '{"name":"x"}', 'utf8')
      await expect(
        buildGamePlayProject({ projectRelativeDir: `${GAME_PLAY_PROJECT_ROOT}/x/project` })
      ).rejects.toThrow(/GRAPH_GAMEPLAY_BAD_PROJECT/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('脚手架文件清单可枚举（供工具回给 agent）', () => {
    const root = mkdtempSync(join(tmpdir(), 'gp-list-'))
    try {
      const projectAbs = join(root, 'project')
      writeNodeGamePlayScaffold(projectAbs, '2d')
      const files = listScaffoldFiles(projectAbs)
      expect(files).toContain('package.json')
      expect(files).toContain('build.mjs')
      expect(files).toContain('src/main.js')
      expect(files.every((file) => !file.includes('\\'))).toBe(true)
      const pkg = JSON.parse(readFileSync(join(projectAbs, 'package.json'), 'utf8')) as {
        scripts: { build: string }
        dependencies: Record<string, string>
      }
      expect(pkg.scripts.build).toBe('node build.mjs')
      expect(pkg.dependencies.esbuild).toBeTruthy()
      expect(pkg.dependencies.react).toBeUndefined()
      expect(existsSync(join(projectAbs, 'src', 'core', 'rng.js'))).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('asset.gamePlay 节点（兼容层）', () => {
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

  it('有工程目录时 cook：调 buildGamePlayProject 并写回路径', async () => {
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
