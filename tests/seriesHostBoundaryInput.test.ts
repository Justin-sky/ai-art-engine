import { describe, expect, it } from 'vitest'
import {
  applyBoundaryInputValues,
  boundaryInputNodeId,
  createDefaultScopedGraph,
  resolveBoundaryInputValuesFromParentGraph
} from '../src/shared/graph'
import { buildSeriesStarterGraph } from '../src/shared/graph/seriesStarter'

const SP = '00000000-0000-4000-8000-0000000000a1'
const WORLD = '00000000-0000-4000-8000-0000000000a2'
const NAR = '00000000-0000-4000-8000-0000000000a3'
const SCRIPT = '00000000-0000-4000-8000-0000000000a4'

function seriesParent(): ReturnType<typeof buildSeriesStarterGraph> {
  return buildSeriesStarterGraph({
    screenplay: { id: SP, name: 'SP', type: 'screenplay' },
    world: { id: WORLD, name: 'WORLD', type: 'world' },
    narrative: { id: NAR, name: 'NAR', type: 'narrative' },
    script: { id: SCRIPT, name: 'SCRIPT', type: 'script' }
  })
}

function worldBoundaryInput(): { params: Record<string, unknown> } {
  const inner = createDefaultScopedGraph('worldAsset', 'world')
  const node = inner.nodes.find((n) => n.id === boundaryInputNodeId('in'))
  expect(node).toBeDefined()
  return node as unknown as { params: Record<string, unknown> }
}

describe('剧集起步图：世界元素宿主的边界输入取值', () => {
  it('剧集起步图把剧本接到世界元素宿主的 in 口', () => {
    const parent = seriesParent()
    const world = parent.nodes.find((n) => n.assetId === WORLD)
    const screenplay = parent.nodes.find((n) => n.assetId === SP)
    expect(world).toBeDefined()
    expect(
      parent.edges.some(
        (edge) =>
          edge.source === screenplay!.id &&
          edge.target === world!.id &&
          (edge.targetPort ?? 'in') === 'in'
      )
    ).toBe(true)
  })

  it('剧本有内联正文时注入 params.text', () => {
    const parent = seriesParent()
    const sp = parent.nodes.find((n) => n.assetId === SP)!
    parent.runStates = {
      [sp.id]: { status: 'done', outputs: { out: { kind: 'text', text: 'ACT ONE' } } }
    }

    const values = resolveBoundaryInputValuesFromParentGraph(parent, WORLD)
    expect(values.in).toEqual({ kind: 'text', text: 'ACT ONE' })

    const inner = createDefaultScopedGraph('worldAsset', 'world')
    expect(applyBoundaryInputValues(inner.nodes, values)).toBe(true)
    const node = inner.nodes.find((n) => n.id === boundaryInputNodeId('in'))!
    expect(node.params.text).toBe('ACT ONE')
  })

  /**
   * 生成输出统一落盘 Cache 后，剧本正文不再内联，父图只能给出旁挂路径。
   * 此时注入只会写 previewRelativePath，预览与执行都必须能按路径取正文。
   */
  it('剧本正文只落盘时注入 previewRelativePath 而非 params.text', () => {
    const parent = seriesParent()
    const sp = parent.nodes.find((n) => n.assetId === SP)!
    const rel = 'Cache/Texts/sp_20260728-120000000.md'
    parent.runStates = {
      [sp.id]: { status: 'done', outputs: { out: { kind: 'text', text: '', relativePath: rel } } }
    }

    const values = resolveBoundaryInputValuesFromParentGraph(parent, WORLD)
    expect(values.in).toEqual({ kind: 'text', text: '', relativePath: rel })

    const inner = createDefaultScopedGraph('worldAsset', 'world')
    expect(applyBoundaryInputValues(inner.nodes, values)).toBe(true)
    const node = inner.nodes.find((n) => n.id === boundaryInputNodeId('in'))!
    expect(node.params.previewRelativePath).toBe(rel)
    expect(node.params.text ?? '').toBe('')
  })

  it('世界元素内图的边界输入口声明为文本类型', () => {
    const node = worldBoundaryInput()
    expect(node.params.hostBoundaryPort).toEqual({
      portId: 'in',
      dataType: 'text',
      multiple: true
    })
  })

  it('叙事宿主与世界元素同为文本入口，落盘剧本下同样只有路径', () => {
    const parent = seriesParent()
    const sp = parent.nodes.find((n) => n.assetId === SP)!
    const rel = 'Cache/Texts/sp_20260728-120000000.md'
    parent.runStates = {
      [sp.id]: { status: 'done', outputs: { out: { kind: 'text', text: '', relativePath: rel } } }
    }

    const values = resolveBoundaryInputValuesFromParentGraph(parent, NAR)
    expect(values.in).toEqual({ kind: 'text', text: '', relativePath: rel })

    const inner = createDefaultScopedGraph('narrativeAsset', 'narrative')
    expect(applyBoundaryInputValues(inner.nodes, values)).toBe(true)
    const node = inner.nodes.find((n) => n.id === boundaryInputNodeId('in'))!
    expect(node.params.previewRelativePath).toBe(rel)
    expect(node.params.text ?? '').toBe('')
  })

  /**
   * 目录类入口（worldEntities / narrativeEntity）的值始终带内联 JSON，
   * 不存在只有落盘路径的形态，因此分镜宿主一直能注入 params.text。
   */
  it('分镜宿主的目录类入口注入内联 JSON', () => {
    const parent = seriesParent()
    const world = parent.nodes.find((n) => n.assetId === WORLD)!
    const catalog = '[{"type":"prop","name":"umbrella"}]'
    parent.runStates = {
      [world.id]: { status: 'done', outputs: { out: { kind: 'worldEntities', text: catalog } } }
    }

    const values = resolveBoundaryInputValuesFromParentGraph(parent, SCRIPT)
    expect(values['in-worldEntities']).toEqual({ kind: 'worldEntities', text: catalog })

    const inner = createDefaultScopedGraph('scriptAsset', 'script')
    expect(applyBoundaryInputValues(inner.nodes, values)).toBe(true)
    const node = inner.nodes.find((n) => n.id === boundaryInputNodeId('in-worldEntities'))!
    expect(node.params.text).toBe(catalog)
    expect(node.params.previewRelativePath ?? '').toBe('')
  })
})
