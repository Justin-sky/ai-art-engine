import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { effectScope, shallowRef, nextTick } from 'vue'
import type { DockviewApi } from 'dockview-vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetInfo, ProjectConfig } from '../src/shared/domain'
import { useEditorPanelOpener } from '../src/renderer/src/editor/workbench/useEditorPanelOpener'
import {
  getRememberedCanvasForWorkspace,
  normalizeWorkspaceRootKey,
  resolveDefaultCanvasForWorkspace
} from '../src/renderer/src/features/graph/model/lastWorkspaceCanvas'
import { useProjectStore } from '../src/renderer/src/stores/project'
import { useWorkspaceStore } from '../src/renderer/src/stores/workspace'

const STUDIO_VIEW_SRC = readFileSync(resolve('src/renderer/src/views/StudioView.vue'), 'utf8')

function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear() {
      map.clear()
    },
    getItem(key: string) {
      return map.get(key) ?? null
    },
    key(index: number) {
      return [...map.keys()][index] ?? null
    },
    removeItem(key: string) {
      map.delete(key)
    },
    setItem(key: string, value: string) {
      map.set(key, String(value))
    }
  }
}

function makeConfig(name = 'Demo Workspace'): ProjectConfig {
  return {
    id: `proj-${name}`,
    name,
    version: 2,
    resolution: { w: 1920, h: 1080 },
    fps: 24,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-12T00:00:00.000Z'
  }
}

function makeCanvasAsset(
  id: string,
  name: string,
  updatedAt: string,
  createdAt = '2026-11-01T00:00:00.000Z'
): AssetInfo {
  return {
    id,
    name,
    type: 'canvas',
    relativePath: `Assets/${id}.canvas.asset.json`,
    createdAt,
    updatedAt,
    version: 1,
    genParams: {
      canvasKind: 'free',
      graphJson: { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
    }
  }
}

describe('打开工作空间时默认打开上一次画布', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('localStorage', createMemoryStorage())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('1. 再次打开工作空间时自动恢复上次打开或切换聚焦的画布（兼容 Windows 路径斜杠与盘符大小写差异）', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()

    const canvasA = makeCanvasAsset('canvas-a', '战斗画布', '2026-11-10T10:00:00.000Z') // cjk-ok
    const canvasB = makeCanvasAsset('canvas-b', '经济画布', '2026-11-12T12:00:00.000Z') // cjk-ok

    // 首次打开无历史记录：回退打开 updatedAt 最新的 canvas-b
    project.loadFromResult({
      rootPath: 'F:\\Projects\\SLG_Demo\\',
      config: makeConfig('SLG'),
      assets: [canvasA, canvasB]
    })
    expect(workspace.openCanvasEditorIds).toEqual(['canvas-b'])

    // 用户打开了 canvas-b 后又打开 canvas-a，随后在标签栏切回 canvas-a
    workspace.openCanvasEditor('canvas-a')
    workspace.openCanvasEditor('canvas-b')
    workspace.noteActiveCanvas('canvas-a')
    expect(getRememberedCanvasForWorkspace('f:/Projects/SLG_Demo')).toBe('canvas-a')
    expect(normalizeWorkspaceRootKey('F:\\Projects\\SLG_Demo\\')).toBe(
      normalizeWorkspaceRootKey('f:/Projects/SLG_Demo')
    )

    // 关闭工作空间后重新以不同斜杠/盘符写法打开：默认直接打开上一次聚焦的 canvas-a
    project.reset()
    expect(workspace.openCanvasEditorIds).toEqual([])

    project.loadFromResult({
      rootPath: 'f:/Projects/SLG_Demo',
      config: makeConfig('SLG'),
      assets: [canvasA, canvasB]
    })
    expect(workspace.openCanvasEditorIds).toEqual(['canvas-a'])
  })

  it('2. 若上次记住的画布已被删除则自动回退至最近更新画布，且无画布时不虚构打开项', () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()

    const c1 = makeCanvasAsset('canvas-old', '旧画布', '2026-11-05T08:00:00.000Z') // cjk-ok
    const c2 = makeCanvasAsset('canvas-mid', '中画布', '2026-11-09T08:00:00.000Z') // cjk-ok
    const c3 = makeCanvasAsset('canvas-deleted', '待删画布', '2026-11-12T08:00:00.000Z') // cjk-ok

    project.loadFromResult({
      rootPath: 'F:/Workspaces/Novel',
      config: makeConfig('Novel'),
      assets: [c1, c2, c3]
    })
    expect(workspace.openCanvasEditorIds).toEqual(['canvas-deleted'])

    // 删除当前记住的画布后重新打开工作空间：清理失效记录并回退到剩余最新的 canvas-mid
    project.removeAssetLocal('canvas-deleted')
    expect(getRememberedCanvasForWorkspace('F:/Workspaces/Novel')).toBeNull()

    project.loadFromResult({
      rootPath: 'F:/Workspaces/Novel',
      config: makeConfig('Novel'),
      assets: [c1, c2]
    })
    expect(workspace.openCanvasEditorIds).toEqual(['canvas-mid'])

    // 仅含非画布资产的工作空间：不强行塞入无效画布 ID
    const imageAsset: AssetInfo = {
      id: 'img-1',
      name: 'poster.png',
      type: 'image',
      relativePath: 'Assets/poster.png',
      createdAt: '2026-11-12T00:00:00.000Z',
      updatedAt: '2026-11-12T00:00:00.000Z',
      version: 1
    }
    expect(resolveDefaultCanvasForWorkspace('F:/Workspaces/EmptyCanvas', [imageAsset])).toBeNull()
    project.loadFromResult({
      rootPath: 'F:/Workspaces/EmptyCanvas',
      config: makeConfig('EmptyCanvas'),
      assets: [imageAsset]
    })
    expect(workspace.openCanvasEditorIds).toEqual([])
  })

  it('3. Dockview 首次挂载 (openPending) 与跨工作空间热切换均自动挂载并激活目标画布面板', async () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()

    const ws1Canvas = makeCanvasAsset('ws1-canvas-last', '主画布1', '2026-11-11T00:00:00.000Z') // cjk-ok
    const ws2Canvas = makeCanvasAsset('ws2-canvas-last', '主画布2', '2026-11-12T00:00:00.000Z') // cjk-ok

    // 模拟从首页点击「打开工作空间」：先 loadFromResult，再挂载 StudioView Dockview
    project.loadFromResult({
      rootPath: 'F:/Workspaces/WS1',
      config: makeConfig('WS1'),
      assets: [ws1Canvas]
    })
    expect(workspace.openCanvasEditorIds).toEqual(['ws1-canvas-last'])

    const panels = new Map<string, { id: string; api: { setActive: ReturnType<typeof vi.fn> } }>()
    const mockApi = {
      get panels() {
        return [...panels.values()]
      },
      getPanel: (id: string) => panels.get(id),
      addPanel: vi.fn((opts: { id: string }) => {
        const panel = {
          id: opts.id,
          api: { setActive: vi.fn() }
        }
        panels.set(opts.id, panel)
        return panel
      }),
      removePanel: vi.fn((panel: { id: string }) => {
        panels.delete(panel.id)
      })
    } as unknown as DockviewApi

    const dockApi = shallowRef<DockviewApi | null>(mockApi)
    const scope = effectScope()
    const opener = scope.run(() =>
      useEditorPanelOpener({
        dockApi,
        centerReferenceId: () => 'workspace',
        title: (_kind, id) => id
      })
    )!

    try {
      // 模拟 StudioView onReady 触发 openPending()
      opener.openPending()
      expect(panels.has('canvas-editor-ws1-canvas-last')).toBe(true)
      expect(panels.get('canvas-editor-ws1-canvas-last')?.api.setActive).toHaveBeenCalledTimes(1)
      expect(workspace.activeDiveRootKey).toBe('canvas-editor-ws1-canvas-last')

      // 模拟在已打开 StudioView 状态下从顶栏切换到第二个工作空间 WS2
      project.loadFromResult({
        rootPath: 'F:/Workspaces/WS2',
        config: makeConfig('WS2'),
        assets: [ws2Canvas]
      })
      await nextTick()

      expect(panels.has('canvas-editor-ws1-canvas-last')).toBe(false)
      expect(panels.has('canvas-editor-ws2-canvas-last')).toBe(true)
      expect(panels.get('canvas-editor-ws2-canvas-last')?.api.setActive).toHaveBeenCalledTimes(1)
      expect(workspace.activeDiveRootKey).toBe('canvas-editor-ws2-canvas-last')
    } finally {
      scope.stop()
    }

    // 确保 StudioView 恢复壳层布局时 removeDocumentEditorPanels 不会清空刚入队的画布会话态
    const removeFnMatch = STUDIO_VIEW_SRC.match(/function removeDocumentEditorPanels\([\s\S]*?\n\}/)
    expect(removeFnMatch?.[0]).toBeTruthy()
    expect(removeFnMatch?.[0]).not.toContain('workspace.resetSession()')
  })
})
