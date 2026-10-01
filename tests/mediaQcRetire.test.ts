import { beforeAll, describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  getNodeType,
  isQcOverviewNode,
  listAddableNodeTypes,
  listNodeTypes,
  resolveNodeType,
  runGraph
} from '../src/shared/graph'
import { resolveNodeExecutor } from '../src/shared/graph/execute/registry'
import type { GraphDocument } from '../src/shared/graph/types'

/**
 * `media.review`（媒体质检）/ `media.rework`（媒体返工）已下线：
 * 不再出现在「添加节点」右键菜单与 MCP 的 `graph_node_types` 目录里。
 *
 * 与 `asset.gamePlay` 同一处理方式 —— **保留类型注册当兼容层**：
 * 旧工程里已经放下的质检 / 返工节点仍要能显示、能开 Inspector、能执行，
 * 「质检返工总览」也仍能统计它们。所以这里既锁「不可添加」，
 * 也锁「没有变成未知类型」。
 */
const RETIRED_TYPE_IDS = ['media.review', 'media.rework'] as const

describe('媒体质检 / 媒体返工下线', () => {
  // 内置类型是惰性注册的，getNodeType 本身不触发注册
  beforeAll(() => {
    listNodeTypes()
  })

  it('两类型不再可添加：右键菜单与 graph_node_types 都看不到', () => {
    for (const typeId of RETIRED_TYPE_IDS) {
      expect(getNodeType(typeId)?.addable).toBe(false)
    }
    for (const scope of ['workflow', 'canvasAsset'] as const) {
      const addable = listAddableNodeTypes(scope).map((def) => def.typeId)
      for (const typeId of RETIRED_TYPE_IDS) expect(addable).not.toContain(typeId)
    }
  })

  it('类型仍注册：旧图能显示、能解析端口、能开自己的 Inspector', () => {
    const review = getNodeType('media.review')
    const rework = getNodeType('media.rework')
    expect(review).toBeTruthy()
    expect(rework).toBeTruthy()
    expect(review?.inspectorId).toBe('studio.graph.mediaReview')
    expect(rework?.inspectorId).toBe('studio.graph.mediaRework')
    // 质检吃图片 + 视频、吐文本；返工是图片进图片出
    expect(review?.ports.map((port) => port.id)).toEqual(
      expect.arrayContaining(['in-image', 'in-video', 'out'])
    )
    expect(rework?.ports.map((port) => port.id)).toEqual(
      expect.arrayContaining(['in-image', 'out'])
    )
  })

  it('执行器仍在：旧工程里的质检 / 返工链照旧能跑', () => {
    for (const typeId of RETIRED_TYPE_IDS) {
      const node = createNodeFromType(typeId, { x: 0, y: 0 })
      expect(typeof resolveNodeExecutor(node, resolveNodeType(node))).toBe('function')
      expect(getNodeType(typeId)?.execute).toBeTypeOf('function')
    }
  })

  it('质检返工总览仍认得它们（旧画布的统计不因下线而空掉）', () => {
    for (const typeId of RETIRED_TYPE_IDS) {
      expect(isQcOverviewNode(createNodeFromType(typeId, { x: 0, y: 0 }))).toBe(true)
    }
    expect(isQcOverviewNode(createNodeFromType('note.text', { x: 0, y: 0 }))).toBe(false)
  })

  it('旧图运行不报「未知节点类型」', async () => {
    const review = createNodeFromType('media.review', { x: 0, y: 0 }, { id: 'qc-1' })
    const graph: GraphDocument = {
      nodes: [review],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 }
    }
    const result = await runGraph(graph, { targetNodeId: 'qc-1', stepDelayMs: 0 })
    expect(result.error ?? '').not.toMatch(/unknown|未知/i)
    expect(result.states['qc-1']?.status).not.toBe('idle')
  })
})
