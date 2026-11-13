import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  prepareLooseToolArguments,
  repairMalformedToolJsonString
} from '../src/main/agent/piModelResolver'
import { applySmartNodePatch, type GraphNode } from '../src/shared/graph'
import { projectService } from '../src/main/services/projectService'
import {
  resolveOrEnsureCanvasAsset,
  syncActiveCanvasFromWorkspaceContext
} from '../src/main/services/mcpServerService'
import { resolveActiveWorkspaceTargets } from '../src/renderer/src/editor/control/surfaceRegistry'
import { buildActiveWorkspaceContext } from '../src/renderer/src/features/mcp/buildActiveWorkspaceContext'
import { useProjectStore } from '../src/renderer/src/stores/project'
import { useWorkspaceStore } from '../src/renderer/src/stores/workspace'

const PERSONA_SRC = readFileSync(resolve('src/main/agent/piPersona.ts'), 'utf8')
const MCP_RUNNER_SRC = readFileSync(
  resolve('src/renderer/src/features/mcp/mcpTaskRunner.ts'),
  'utf8'
)

describe('asset.gameSystem canvas creation when .md file is open & malformed/truncated tool JSON protection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('repairs 6.5KB+ graph_edit asset.gameSystem JSON with unescaped inner quotes, commas, and raw newlines', async () => {
    const padding = 'SLG王城争夺阶段规则说明与建筑解锁配表还原分析。'.repeat(260) // > 6400 chars
    const brokenRaw =
      `{"ops": [{"op": "node_upsert", "nodeId": "gdd_slg", "typeId": "asset.gameSystem", "title": "王城争夺策划案", "params": {"prompt": "${padding}` +
      `仅显式声明 "unlock_stage", "build_type_client" 的 8 座建筑走覆盖逻辑，状态枚举为 "1备战 2争夺城市 3争夺核心城 4争夺中心城"，示例配置 {"id": "301"} 结束。\n第二段补充说明", "gameSystemArchetype": "slg_conquest"}}]}`

    // Confirm raw string fails native JSON.parse around char ~6400+ just like Screenshot 1
    expect(() => JSON.parse(brokenRaw)).toThrow()

    const repaired = repairMalformedToolJsonString(brokenRaw)
    const parsed = JSON.parse(repaired) as {
      ops: Array<{
        op: string
        nodeId: string
        typeId: string
        params: { prompt: string; gameSystemArchetype: string }
      }>
    }
    expect(parsed.ops).toHaveLength(1)
    expect(parsed.ops[0]?.typeId).toBe('asset.gameSystem')
    expect(parsed.ops[0]?.params.gameSystemArchetype).toBe('slg_conquest')
    expect(parsed.ops[0]?.params.prompt).toContain('"unlock_stage", "build_type_client"')
    expect(parsed.ops[0]?.params.prompt).toContain('"1备战 2争夺城市 3争夺核心城 4争夺中心城"')
    expect(parsed.ops[0]?.params.prompt).toContain('{"id": "301"}')

    const looseArgs = prepareLooseToolArguments(brokenRaw)
    expect(Array.isArray(looseArgs.ops)).toBe(true)
  })

  it('enforces lightweight two-step node creation so giant GDD calls never stall silently', () => {
    expect(PERSONA_SRC).toContain('Two-Step Lightweight Canvas-First Rule (CRITICAL)')
    expect(PERSONA_SRC).not.toContain('gameSystemSpecJson }` —')
  })

  it('normalizes legacy gameSystemSpec / gameSystemSpecJson into params.text in smartPatch', () => {
    const node: GraphNode = {
      id: 'gdd_1',
      typeId: 'asset.gameSystem',
      category: 'asset',
      title: 'GDD',
      x: 0,
      y: 0,
      params: {}
    }
    const res = applySmartNodePatch(node, {
      params: {
        prompt: 'SLG王城争夺',
        gameSystemSpecJson: '# 一、系统概述\n阶段2默认解锁高级王城'
      }
    })
    expect(res.params.text).toContain('# 一、系统概述')
    expect((res.params as Record<string, unknown>).gameSystemSpecJson).toBeUndefined()
  })

  it('handles .md workspace file viewer cleanly: creates new canvas when none is open, and refocuses background canvas tab when hidden behind .md tab', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()

    const screenplayAsset = {
      id: 'sp-doc-1',
      name: '策划草稿.md',
      type: 'screenplay' as const,
      relativePath: 'Assets/sp-doc-1.md',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      genParams: {}
    }
    const bgCanvas = {
      id: 'canvas-bg-1',
      name: '系统画布',
      type: 'canvas' as const,
      relativePath: 'Assets/canvas-bg-1.canvas.asset.json',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 1,
      genParams: {
        graphJson: {
          nodes: [],
          edges: [],
          viewport: { x: 0, y: 0, zoom: 1 }
        }
      }
    }
    project.assets = [screenplayAsset, bgCanvas]

    const listAssetsSpy = vi
      .spyOn(projectService, 'listAssets')
      .mockImplementation(() => [...project.assets])
    const createAssetSpy = vi.spyOn(projectService, 'createAsset').mockImplementation(() => {
      const created = {
        id: 'canvas-created-from-md',
        name: '新建画布',
        type: 'canvas' as const,
        relativePath: 'Assets/canvas-created-from-md.canvas.asset.json',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        version: 1,
        genParams: {
          graphJson: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
        }
      }
      project.assets.push(created)
      return created
    })

    try {
      // Scenario A: Only a .md file (and/or non-graph screenplay) is open in workspace, NO canvas open
      const openedMdId = workspace.openWorkspaceFile({
        absPath: 'F:/demo/docs/slg_spec.md',
        fileName: 'slg_spec.md',
        ext: '.md',
        kind: 'markdown',
        content: '# SLG 王城争夺'
      })
      workspace.openScreenplayEditor(screenplayAsset.id)
      workspace.activeDiveRootKey = `file-editor-${openedMdId}`

      const targetsOnlyMd = resolveActiveWorkspaceTargets()
      expect(targetsOnlyMd.defaultGraphAssetId).toBe('')

      const ctxOnlyMd = buildActiveWorkspaceContext()
      expect(ctxOnlyMd).toContain('Left Window Active File Viewer: "slg_spec.md"')
      expect(ctxOnlyMd).toContain('Left Window Active Editor: None')
      expect(ctxOnlyMd).not.toContain('Active canvas asset:')

      syncActiveCanvasFromWorkspaceContext(ctxOnlyMd)
      const createdCanvas = resolveOrEnsureCanvasAsset('', {
        autoCreateCanvas: true,
        preferUiActiveCanvas: true
      })
      expect(createdCanvas?.id).toBe('canvas-created-from-md')
      expect(createAssetSpy).toHaveBeenCalledTimes(1)

      // Scenario B: Background canvas `canvas-bg-1` is open, then user switches to `.md` file tab (`file-editor-<id>`)
      workspace.openCanvasEditor(bgCanvas.id)
      workspace.activeDiveRootKey = `file-editor-${openedMdId}`

      const targetsMdOverCanvas = resolveActiveWorkspaceTargets()
      expect(targetsMdOverCanvas.defaultGraphAssetId).toBe(bgCanvas.id)

      const ctxMdOverCanvas = buildActiveWorkspaceContext()
      expect(ctxMdOverCanvas).toContain('Left Window Active File Viewer: "slg_spec.md"')
      expect(ctxMdOverCanvas).toContain(
        `Active canvas asset: "系统画布" (assetId: "${bgCanvas.id}", type: canvas)`
      )

      // Scenario C: No Studio project.json open at all (Global Workspace / external .md repo) -> falls back to draft:<uuid> canvas!
      listAssetsSpy.mockImplementation(() => {
        throw new Error('未打开工程')
      })
      createAssetSpy.mockImplementation(() => {
        throw new Error('未打开工程')
      })
      syncActiveCanvasFromWorkspaceContext(ctxOnlyMd)
      const draftCanvas = resolveOrEnsureCanvasAsset('', {
        autoCreateCanvas: true,
        preferUiActiveCanvas: true
      })
      expect(draftCanvas?.id).toMatch(/^draft:/)

      // Verify mcpTaskRunner re-focuses Dockview editor when activeDiveRootKey !== targetEditorRootKey
      // and falls back to useDraftStore().createDraft when !project.isOpen
      expect(MCP_RUNNER_SRC).toContain('workspace.activeDiveRootKey !== targetEditorRootKey')
      expect(MCP_RUNNER_SRC).toContain("useDraftStore().createDraft(\n          'canvas'")
    } finally {
      syncActiveCanvasFromWorkspaceContext(undefined)
      listAssetsSpy.mockRestore()
      createAssetSpy.mockRestore()
    }
  })
})
