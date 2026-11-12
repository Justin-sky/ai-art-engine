import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cloneGraphDocument,
  createNodeFromType,
  runGraph,
  type GraphDocument,
  type GraphNode,
  type GraphNodeParams,
  type GraphNodeRunState
} from '../src/shared/graph'
import { graphEditorHosts } from '../src/renderer/src/features/graph/model/graphEditorHosts'
import { graphRunHosts } from '../src/renderer/src/features/graph/model/graphRunHosts'
import {
  registerOpenGraphEditor,
  unregisterOpenGraphEditor
} from '../src/renderer/src/features/mcp/openGraphEditors'
import {
  buildDirectContentDoneState,
  handleGraphEdit,
  handleTaskRun,
  settleSessionMcpTasks
} from '../src/renderer/src/features/mcp/mcpTaskRunner'
import { mergeSubsetGraphIntoBase, useGraphTaskStore } from '../src/renderer/src/stores/graphTasks'
import { useProjectStore } from '../src/renderer/src/stores/project'
import { useWorkspaceStore } from '../src/renderer/src/stores/workspace'

const HARNESS_SRC = readFileSync(resolve('src/main/services/deepseekHarnessService.ts'), 'utf8')
const MCP_SERVER_SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')

interface MountedTestCanvas {
  hostId: string
  getDoc: () => GraphDocument
  runStates: Record<string, GraphNodeRunState>
  cleanup: () => void
}

function mountLiveCanvasForTest(assetId: string, initialDoc: GraphDocument): MountedTestCanvas {
  const hostId = `asset:${assetId}`
  let doc = cloneGraphDocument(initialDoc)
  const runStates: Record<string, GraphNodeRunState> = { ...(doc.runStates ?? {}) }
  const isRunning = ref(false)
  const runningTargetNodeId = ref<string | null>(null)
  const blockedNodeIds = ref<ReadonlySet<string>>(new Set())
  const activeRunNodeIds = ref<ReadonlySet<string>>(new Set())

  registerOpenGraphEditor(assetId)
  const offRun = graphRunHosts.register(hostId, {
    runStates,
    isRunning,
    runningTargetNodeId,
    blockedNodeIds,
    activeRunNodeIds,
    runToNode: async () => undefined,
    stopWorkflow: () => {
      isRunning.value = false
    },
    toggleNodeRun: () => undefined
  })
  const offEditor = graphEditorHosts.register(hostId, {
    getNode: (nodeId: string) => doc.nodes.find((n) => n.id === nodeId) ?? null,
    listNodes: () => doc.nodes,
    listEdges: () => doc.edges,
    getDocument: () => ({
      ...cloneGraphDocument(doc),
      runStates: { ...runStates }
    }),
    updateNode: (nodeId: string, params: Partial<GraphNodeParams>, title?: string) => {
      const target = doc.nodes.find((n) => n.id === nodeId)
      if (!target) return
      target.params = { ...target.params, ...params } as GraphNodeParams
      if (title !== undefined) target.title = title
    },
    patchNodeParamsLive: (nodeId: string, params: Partial<GraphNodeParams>) => {
      const target = doc.nodes.find((n) => n.id === nodeId)
      if (!target) return
      target.params = { ...target.params, ...params } as GraphNodeParams
    },
    setNodeAsset: () => undefined,
    applyExternalGraph: (nextDoc: GraphDocument) => {
      doc = cloneGraphDocument(nextDoc)
      for (const key of Object.keys(runStates)) {
        delete runStates[key]
      }
      Object.assign(runStates, nextDoc.runStates ?? {})
    },
    selectNode: () => undefined,
    flush: async () => {
      const project = useProjectStore()
      const asset = project.assets.find((a) => a.id === assetId)
      if (asset) {
        asset.genParams = {
          ...(asset.genParams ?? {}),
          graphJson: {
            ...cloneGraphDocument(doc),
            runStates: { ...runStates }
          }
        }
      }
    }
  })

  return {
    hostId,
    getDoc: () => doc,
    runStates,
    cleanup: () => {
      offEditor()
      offRun()
      unregisterOpenGraphEditor(assetId)
    }
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 15))
  }
  throw new Error('Timed out waiting for condition')
}

describe('会话结束与直接写入正文时的画布节点运行态收敛（防假死 running 与防旧快照覆盖）', () => {
  const cleanups: Array<() => void> = []

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    while (cleanups.length > 0) {
      cleanups.pop()?.()
    }
    useGraphTaskStore().clearForProjectSwitch()
    vi.restoreAllMocks()
  })

  it('1. graph_edit 直接写入 params.text 成稿时立即取消同节点在途生成任务，标记为 done 且不被延迟返回的慢速 LLM 覆盖', async () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()
    project.projectPath = 'F:/demo-battle'

    const gddNode = createNodeFromType('asset.gameSystem', { x: 120, y: 120 }, { id: 'gdd_battle' })
    gddNode.title = '战斗系统策划案 (GDD v1.0)' // cjk-ok
    gddNode.params.prompt = '整理逆向战斗系统策划案' // cjk-ok

    const initialGraph: GraphDocument = {
      nodes: [gddNode],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    project.assets = [
      {
        id: 'canvas-battle',
        name: '战斗画布', // cjk-ok
        type: 'canvas',
        relativePath: 'Assets/canvas-battle.canvas.asset.json',
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
        version: 1,
        genParams: { graphJson: cloneGraphDocument(initialGraph) }
      }
    ]
    workspace.openCanvasEditor('canvas-battle')

    const mounted = mountLiveCanvasForTest('canvas-battle', initialGraph)
    cleanups.push(mounted.cleanup)

    let resolveSlowLlm!: (val: { text: string }) => void
    const slowLlmPromise = new Promise<{ text: string }>((res) => {
      resolveSlowLlm = res
    })

    const reports: Array<Record<string, unknown>> = []
    const prevStudio = (globalThis as { window?: { studio?: unknown } }).window?.studio
    const mockStudio = {
      ...(prevStudio && typeof prevStudio === 'object' ? prevStudio : {}),
      generateText: vi.fn(() => slowLlmPromise),
      reportMcpTask: vi.fn((payload: Record<string, unknown>) => {
        reports.push(payload)
      }),
      reportMcpGraphEdit: vi.fn(),
      updateAsset: vi.fn(async (input: { id: string; genParams?: Record<string, unknown> }) => {
        const target = project.assets.find((a) => a.id === input.id)
        if (target && input.genParams) {
          target.genParams = input.genParams
        }
        return target ?? null
      })
    }
    vi.stubGlobal('window', {
      ...(typeof window !== 'undefined' ? window : {}),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      studio: mockStudio
    })

    // Step 1: Agent 发起 task_run，慢速 LLM 卡在后台使节点处于 running 状态
    await handleTaskRun({
      mcpTaskId: 'mcp-run-battle-1',
      assetId: 'canvas-battle',
      nodeIds: ['gdd_battle'],
      sessionId: 'sess-battle'
    })

    const taskStore = useGraphTaskStore()
    await waitUntil(() => mounted.runStates.gdd_battle?.status === 'running')
    expect(taskStore.runningCount).toBe(1)

    // Step 2: Agent 将已逆向核实的完整 GDD 正文直接写入 params.text
    const verifiedGdd = [
      '## 1. 文档范围与证据等级',
      '',
      '**目标**：依据 DECOMPILED 工程重建共用战斗内核、客户端战斗表现和回放/结算校验流程。',
      '',
      '## 2. 编队与初始化规则',
      '- 主将槽位 1 个 + 副将槽位 2 个，技能冷却按帧同步结算。'
    ].join('\n') // cjk-ok

    await handleGraphEdit({
      requestId: 'req-edit-direct-gdd',
      assetId: 'canvas-battle',
      ops: [
        {
          op: 'node_update',
          nodeId: 'gdd_battle',
          params: {
            text: verifiedGdd
          }
        }
      ]
    })

    // 在途任务立即收敛为完成，画布节点不再卡在 running，且输出端口立即可用
    expect(taskStore.runningCount).toBe(0)
    expect(mounted.runStates.gdd_battle?.status).toBe('done')
    expect(mounted.runStates.gdd_battle?.outputs?.out).toMatchObject({
      kind: 'text',
      text: verifiedGdd
    })
    expect(mounted.runStates.gdd_battle?.outputs?.['out-all']).toMatchObject({
      kind: 'texts'
    })
    expect(mounted.getDoc().nodes[0]?.params.text).toBe(verifiedGdd)

    // Step 3: 即使后台慢速 LLM 稍后才返回泛化文本，也绝不能覆盖已保存的 DECOMPILED 正文或污染状态
    resolveSlowLlm({ text: '# 泛化编造的错误策划案\n完全覆盖了逆向结果' }) // cjk-ok
    await new Promise((r) => setTimeout(r, 80))

    expect(mounted.getDoc().nodes[0]?.params.text).toBe(verifiedGdd)
    expect(mounted.runStates.gdd_battle?.status).toBe('done')
    expect(taskStore.runningCount).toBe(0)
  })

  it('2. 会话正常结束时 settleSessionMcpTasks 定向收敛该会话遗留任务（保留已有正文为 done、清理未完成转圈），且不影响并行会话与一句话游戏脱钩运行', async () => {
    const project = useProjectStore()
    const workspace = useWorkspaceStore()
    project.projectPath = 'F:/demo-parallel'

    const populatedGdd = createNodeFromType('asset.gameSystem', { x: 0, y: 0 }, { id: 'gdd_a' })
    populatedGdd.title = '已写入正文的策划案' // cjk-ok
    populatedGdd.params.text =
      '## 1. 核心机制\n依据反编译配置表确认：阶段 2 默认解锁高级王城，核心要塞为阶段 3，中心城为阶段 4。' // cjk-ok

    const unfinishedText = createNodeFromType('asset.novel', { x: 360, y: 0 }, { id: 'novel_a' })
    unfinishedText.title = '未完成章节' // cjk-ok
    unfinishedText.params.prompt = '生成第一章' // cjk-ok

    const otherSessionNode = createNodeFromType('asset.novel', { x: 0, y: 0 }, { id: 'novel_b' })
    otherSessionNode.params.prompt = '并行会话 B 生成' // cjk-ok

    const detachedGameNode = createNodeFromType('asset.novel', { x: 0, y: 0 }, { id: 'game_node' })
    detachedGameNode.params.prompt = '一句话游戏后台自动运行' // cjk-ok

    const graphA: GraphDocument = {
      nodes: [populatedGdd, unfinishedText],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const graphB: GraphDocument = {
      nodes: [otherSessionNode],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const graphGame: GraphDocument = {
      nodes: [detachedGameNode],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }

    project.assets = [
      {
        id: 'canvas-sess-a',
        name: '会话A画布', // cjk-ok
        type: 'canvas',
        relativePath: 'Assets/a.canvas.asset.json',
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
        version: 1,
        genParams: { graphJson: cloneGraphDocument(graphA) }
      },
      {
        id: 'canvas-sess-b',
        name: '会话B画布', // cjk-ok
        type: 'canvas',
        relativePath: 'Assets/b.canvas.asset.json',
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
        version: 1,
        genParams: { graphJson: cloneGraphDocument(graphB) }
      },
      {
        id: 'canvas-detached-game',
        name: '一句话游戏子图', // cjk-ok
        type: 'subgraph',
        relativePath: 'Assets/game.subgraph.asset.json',
        createdAt: '2026-11-12T00:00:00.000Z',
        updatedAt: '2026-11-12T00:00:00.000Z',
        version: 1,
        genParams: { graphJson: cloneGraphDocument(graphGame) }
      }
    ]
    workspace.openCanvasEditor('canvas-sess-a')
    workspace.openCanvasEditor('canvas-sess-b')
    workspace.openAssetEditor('canvas-detached-game')

    const mountedA = mountLiveCanvasForTest('canvas-sess-a', graphA)
    const mountedB = mountLiveCanvasForTest('canvas-sess-b', graphB)
    const mountedGame = mountLiveCanvasForTest('canvas-detached-game', graphGame)
    cleanups.push(mountedA.cleanup, mountedB.cleanup, mountedGame.cleanup)

    const neverResolves = new Promise<{ text: string }>(() => undefined)
    vi.stubGlobal('window', {
      ...(typeof window !== 'undefined' ? window : {}),
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      studio: {
        generateText: vi.fn(() => neverResolves),
        reportMcpTask: vi.fn(),
        updateAsset: vi.fn(async () => null)
      }
    })

    await handleTaskRun({
      mcpTaskId: 'mcp-sess-a-run',
      assetId: 'canvas-sess-a',
      nodeIds: ['gdd_a', 'novel_a'],
      sessionId: 'sess-alpha'
    })
    await handleTaskRun({
      mcpTaskId: 'mcp-sess-b-run',
      assetId: 'canvas-sess-b',
      nodeIds: ['novel_b'],
      sessionId: 'sess-beta'
    })
    await handleTaskRun({
      mcpTaskId: 'mcp-sess-a-detached-game',
      assetId: 'canvas-detached-game',
      nodeIds: ['game_node'],
      sessionId: 'sess-alpha',
      keepAliveAfterSessionEnd: true
    })

    const taskStore = useGraphTaskStore()
    await waitUntil(() => taskStore.runningCount === 3)
    // 模拟 gdd_a 在会话结束时仍处于未收尾状态，但其节点本身已带有完整正文
    mountedA.runStates.gdd_a = { status: 'running' }

    const settled = settleSessionMcpTasks('sess-alpha', 'SESSION_ENDED')
    expect(settled).toBe(1)

    // 会话 A 的普通遗留 task_run 已停止；会话 B 与 keepAliveAfterSessionEnd 游戏运行继续保持活跃
    expect(taskStore.runningCount).toBe(2)
    expect(mountedA.runStates.gdd_a?.status).toBe('done')
    expect(mountedA.getDoc().nodes.find((n) => n.id === 'gdd_a')?.params.text).toContain(
      '阶段 2 默认解锁高级王城'
    )
    expect(mountedA.runStates.novel_a).toBeUndefined()
    expect(['pending', 'running']).toContain(mountedB.runStates.novel_b?.status)
    expect(['pending', 'running']).toContain(mountedGame.runStates.game_node?.status)
  })

  it('3. mergeSubsetGraphIntoBase 对 GRAPH_CANCELLED 节点绝不用旧快照覆盖实时画布上的新参数', () => {
    const liveNode: GraphNode = {
      id: 'gdd_1',
      typeId: 'asset.gameSystem',
      category: 'asset',
      title: 'GDD',
      x: 0,
      y: 0,
      params: { text: '## 最新保存的逆向策划案正文（不可被取消的任务覆盖）' } // cjk-ok
    }
    const doneSibling: GraphNode = {
      id: 'txt_2',
      typeId: 'text.plain',
      category: 'input',
      title: 'Note',
      x: 200,
      y: 0,
      params: { text: 'old' }
    }
    const base: GraphDocument = {
      nodes: [liveNode, doneSibling],
      edges: []
    }
    const staleSubset: GraphDocument = {
      nodes: [
        { ...liveNode, params: { text: '' } },
        { ...doneSibling, params: { text: 'updated-by-done-node' } }
      ],
      edges: []
    }
    const merged = mergeSubsetGraphIntoBase(base, staleSubset, ['gdd_1', 'txt_2'], {
      gdd_1: { status: 'error', error: 'GRAPH_CANCELLED' },
      txt_2: { status: 'done', outputs: { out: { kind: 'text', text: 'updated-by-done-node' } } }
    })

    expect(merged.nodes.find((n) => n.id === 'gdd_1')?.params.text).toBe(
      '## 最新保存的逆向策划案正文（不可被取消的任务覆盖）'
    )
    expect(merged.nodes.find((n) => n.id === 'txt_2')?.params.text).toBe('updated-by-done-node')
  })

  it('4. 200 字以上的结构化 GDD 成稿在 executeGameSystemNode 中直接快速落盘，且主进程 finishTurn 定向收敛孤儿画布运行', async () => {
    const gddNode = createNodeFromType('asset.gameSystem', { x: 0, y: 0 }, { id: 'gdd_fast' })
    const conciseVerifiedGdd = [
      '# 战斗系统策划案 (GDD v1.0)',
      '## 1. 文档范围与证据等级',
      '依据反编译工程核实客户端战斗状态机、帧同步输入队列、技能释放与 Buff 结算顺序，区分已证实逻辑与待服务端确认项。',
      '## 2. 技能与 Buff 结算',
      '每帧按固定优先级处理：控制免疫判定 -> 位移与碰撞帧 -> 伤害护盾抵扣 -> 回合末持续效果衰减与战报回放校验。',
      '## 3. 验收测试矩阵',
      '覆盖同帧双端回放一致性、断线重连快照恢复、多段连击护盾溢出边界与结算校验码对齐，确保客户端表现与共享战斗内核完全一致。'
    ].join('\n') // cjk-ok
    expect(conciseVerifiedGdd.length).toBeGreaterThanOrEqual(200)
    expect(conciseVerifiedGdd.length).toBeLessThan(600)
    gddNode.params.text = conciseVerifiedGdd

    const generateTextSpy = vi.fn(async () => ({ text: 'SHOULD_NOT_BE_CALLED' }))
    const runRes = await runGraph(
      { nodes: [gddNode], edges: [] },
      { targetNodeIds: ['gdd_fast'], generateText: generateTextSpy }
    )
    expect(runRes.ok).toBe(true)
    expect(generateTextSpy).not.toHaveBeenCalled()
    expect(runRes.states.gdd_fast?.status).toBe('done')
    expect(buildDirectContentDoneState(gddNode)?.status).toBe('done')

    // 主进程 finishTurn 与一句话游戏脱钩保护契约校验
    expect(HARNESS_SRC).toContain(
      "abortActiveMcpCanvasRuns('会话已结束', finishedSessionId, { skipDetached: true })"
    )
    expect(HARNESS_SRC).toContain('DO NOT call `task_run`')
    expect(MCP_SERVER_SRC).toContain('keepAliveAfterSessionEnd: true')
  })
})
