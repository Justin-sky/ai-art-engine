import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyGraphEditOps, createDefaultScopedGraph } from '../src/shared/graph'

const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const RUNNER = read('src/renderer/src/features/mcp/mcpTaskRunner.ts')
const MCP = read('src/main/services/mcpServerService.ts')

function graphEditBody(): string {
  const at = RUNNER.indexOf('async function handleGraphEdit')
  expect(at, '应当能找到 handleGraphEdit').toBeGreaterThan(0)
  const end = RUNNER.indexOf('\n/**', at)
  return stripComments(RUNNER.slice(at, end))
}

describe('graph_edit 实时画布编辑与自动打开', () => {
  it('函数体里不再有那句拒绝提示', () => {
    expect(graphEditBody()).not.toContain('为避免互相覆盖请先关闭编辑器')
  })

  it('精修路径仍拒绝（依赖已落盘状态）', () => {
    expect(RUNNER).toContain('请先关闭编辑器再远程精修')
  })

  it('改为以实时文档为基准并同步刷新画布', () => {
    const body = graphEditBody()
    expect(body).toContain('graphEditorHosts.getLiveAssetDocument(effectiveAssetId)')
    expect(body).toContain('graphEditorHosts.applyExternalGraph(')
    expect(body).toContain('liveResult.graph')
    expect(body).toContain("liveResult.applied.includes('自动布局')")
    expect(body).toContain('fitView: true')
    expect(body).toContain('selectNodeIds')
    expect(body).toContain('graphEditorHosts.selectNode')
    expect(body).toContain('await graphEditorHosts.flush(hostId)')
  })

  it('先判断编辑器是否打开，再取 store 副本', () => {
    const body = graphEditBody()
    const openCheck = body.indexOf('isGraphEditorOpen(effectiveAssetId)')
    const storeCopy = body.indexOf('graphJson')
    expect(openCheck).toBeGreaterThan(-1)
    expect(openCheck, '编辑器分支必须早于读 store 副本').toBeLessThan(storeCopy)
  })

  it('取不到实时图时给出可重试的错误，而不是静默失败', () => {
    const body = graphEditBody()
    expect(body).toMatch(/if \(!live(?:Target)?\) \{/)
    expect(body).toContain('取不到实时图')
  })

  it('编辑器关闭时的原路径保持不变（仍写 store 副本）', () => {
    const body = graphEditBody()
    expect(body).toContain('const result = applyGraphEditOps(graphJson, graphOps, editOptions)')
    expect(body).toContain('persistAssetRecord(effectiveAssetId,')
  })

  it('打开路径同样把 autoLayout 传给 applyGraphEditOps', () => {
    const body = graphEditBody()
    expect(body).toMatch(/applyGraphEditOps\(live(?:Target)?, graphOps, editOptions\)/)
    expect(body).toContain('payload.autoLayout')
  })

  it('task_run 与 graph_edit 都会自动打开画布编辑器以实时展示节点变化', () => {
    expect(RUNNER).toContain('openMcpWorkflowAssetEditor(effectiveAssetId)')
  })

  it('工具说明明确支持对打开中的画布实时编辑并执行', () => {
    expect(MCP).not.toContain('图正在编辑器中打开时会拒绝')
    expect(MCP).toContain('应用实时编辑操作')
  })
})

describe('applyGraphEditOps 画布节点参数映射、参考图自动连线与脏状态清理', () => {
  it('node_upsert 自动映射 prompt / aspectRatio / count 并返回 touchedNodeIds', () => {
    const doc = createDefaultScopedGraph('canvasAsset', 'canvas')
    const res = applyGraphEditOps(doc, [
      {
        op: 'node_upsert',
        nodeId: 'cat-img',
        typeId: 'asset.image',
        title: '可爱小猫',
        params: {
          prompt: '一只在阳光下打盹的橘猫，电影感柔和光线',
          aspectRatio: '16:9',
          count: 2
        }
      }
    ])
    expect(res.touchedNodeIds).toEqual(['cat-img'])
    const node = res.graph.nodes.find((n) => n.id === 'cat-img')
    expect(node).toBeDefined()
    expect(node?.params?.generateInstruction).toBe('一只在阳光下打盹的橘猫，电影感柔和光线')
    expect(node?.params?.generateAspectRatio).toBe('16:9')
    expect(node?.params?.generateCount).toBe(2)
  })

  it('node_upsert 传入 firstFrameImageUrl / lastFrameImageUrl 时自动创建锁定的上游参考图节点并连线', () => {
    const doc = createDefaultScopedGraph('canvasAsset', 'canvas')
    const res = applyGraphEditOps(doc, [
      {
        op: 'node_upsert',
        nodeId: 'cat-vid',
        typeId: 'asset.video',
        title: '小猫视频',
        params: {
          prompt: '小猫伸懒腰站起来',
          firstFrameImageUrl: 'Assets/Images/cat_start.png',
          lastFrameImageUrl: 'Assets/Images/cat_end.png',
          duration: 5
        }
      }
    ])
    const firstRef = res.graph.nodes.find((n) => n.id === 'cat-vid-first-frame')
    const lastRef = res.graph.nodes.find((n) => n.id === 'cat-vid-last-frame')
    expect(firstRef?.locked).toBe(true)
    expect(firstRef?.params?.previewRelativePath).toBe('Assets/Images/cat_start.png')
    expect(lastRef?.locked).toBe(true)
    expect(lastRef?.params?.previewRelativePath).toBe('Assets/Images/cat_end.png')
    expect(
      res.graph.edges.some(
        (e) =>
          e.source === 'cat-vid-first-frame' &&
          e.target === 'cat-vid' &&
          e.targetPort === 'in-first-frame'
      )
    ).toBe(true)
    expect(
      res.graph.edges.some(
        (e) =>
          e.source === 'cat-vid-last-frame' &&
          e.target === 'cat-vid' &&
          e.targetPort === 'in-last-frame'
      )
    ).toBe(true)
  })

  it('修改已执行节点的参数时自动清理该节点及下游节点的过期 runStates', () => {
    const base = createDefaultScopedGraph('canvasAsset', 'canvas')
    const created = applyGraphEditOps(base, [
      {
        op: 'node_upsert',
        nodeId: 'n1',
        typeId: 'asset.image',
        params: { prompt: '第一版小猫' }
      },
      {
        op: 'node_upsert',
        nodeId: 'n2',
        typeId: 'asset.video',
        params: { prompt: '小猫动起来' }
      },
      {
        op: 'edge_connect',
        fromNodeId: 'n1',
        fromPort: 'out',
        toNodeId: 'n2',
        toPort: 'in-first-frame'
      }
    ])
    const withRunStates = {
      ...created.graph,
      runStates: {
        n1: { status: 'done' as const, progress: 1 },
        n2: { status: 'done' as const, progress: 1 }
      }
    }
    const updated = applyGraphEditOps(withRunStates, [
      {
        op: 'node_update',
        nodeId: 'n1',
        params: { prompt: '第二版小猫（戴小帽子）' }
      }
    ])
    expect(updated.graph.runStates?.n1).toBeUndefined()
    expect(updated.graph.runStates?.n2).toBeUndefined()
  })

  it('画布上已有未执行、无产物的同类型孤立节点时，不传 nodeId 的 node_upsert 自动原地复用而非新建第二个节点', () => {
    const base = createDefaultScopedGraph('canvasAsset', 'canvas')
    const step1 = applyGraphEditOps(base, [
      {
        op: 'node_upsert',
        typeId: 'asset.image',
        title: '文生图 · 小猎犬',
        params: { prompt: '一只小猎犬' }
      }
    ])
    expect(step1.graph.nodes).toHaveLength(1)
    const firstId = step1.graph.nodes[0].id

    const step2 = applyGraphEditOps(step1.graph, [
      {
        op: 'node_upsert',
        typeId: 'asset.image',
        title: '画一只猫',
        params: { prompt: '一只橘白相间的猫' }
      }
    ])
    expect(step2.graph.nodes).toHaveLength(1)
    expect(step2.graph.nodes[0].id).toBe(firstId)
    expect(step2.graph.nodes[0].title).toBe('画一只猫')
    expect(step2.graph.nodes[0].params.generateInstruction).toBe('一只橘白相间的猫')
  })

  it('handleTaskRun 同时检查 taskStore.tasks 与 taskStore.completed，避免已完成任务被误报为 stopped', () => {
    expect(RUNNER).toContain('taskStore.completed.find((item) => item.id === result.id)')
  })
})
