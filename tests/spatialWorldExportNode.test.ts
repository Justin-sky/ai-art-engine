import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  canConnectNodes,
  createNodeFromType,
  executeSpatialWorldExportNode,
  getNodePorts,
  getNodeType,
  GraphPortType,
  listAddableNodeTypes,
  listNodeTypes,
  portsCompatible,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

/**
 * 空间世界导出节点（`spatialWorld.export`）：官方 `POST /marble/v1/worlds/{world_id}:export` 两条路。
 * - mesh：HQ 贴图 / 顶点色网格（异步，最长约 1 小时）→ 登记模型资产，走模型画廊；
 * - splats：PLY 泼溅（同步）→ 落在上游世界产物旁边，不登记资产、透传上游模型。
 * world_id 只能由上游世界生成节点给出，拿不到就直接报错（绝不猜别人的世界）。
 *
 * 端口类型是 `spatialWorld` 而不是 `model`：世界产物带 world_id、语义上是「世界」，
 * 与导出端点天然成对。`spatialWorld → model` 单向兼容，所以导出后的网格照旧能接
 * 3D 加工节点与导演台；反向不允许（普通模型没有 world_id）。
 */
function exportNode(params: Record<string, unknown> = {}, title = 'World export'): GraphNode {
  return {
    id: 'wexport-1',
    typeId: 'spatialWorld.export',
    category: 'note',
    assetType: 'model',
    title,
    position: { x: 0, y: 0 },
    params
  } as GraphNode
}

const spatialWorldValue = {
  kind: 'asset' as const,
  assetId: 'asset-world-1',
  assetType: 'model' as const,
  relativePath: 'Cache/Models/world.glb',
  spatialWorldId: 'w-123',
  title: 'World'
}

describe('spatialWorld.export node type', () => {
  beforeAll(() => {
    listNodeTypes()
  })

  it('is registered as an addable processing node with world in/out', () => {
    const def = getNodeType('spatialWorld.export')
    expect(def).toBeTruthy()
    expect(def?.addable).toBe(true)
    expect(def?.inspectorId).toBe('studio.graph.spatialWorldExport')
    expect(
      listAddableNodeTypes('workflow').some((item) => item.typeId === 'spatialWorld.export')
    ).toBe(true)

    const node = createNodeFromType('spatialWorld.export', { x: 0, y: 0 })
    expect(getNodePorts(node).map((port) => [port.id, port.direction, port.dataType])).toEqual([
      // 入口只收空间世界口（带 world_id）；出口是 model —— 导出后的 GLB 才能继续编排
      ['in-world', 'in', 'spatialWorld'],
      ['out', 'out', 'model'],
      ['out-all', 'out', 'model']
    ])
    expect(node.params.spatialWorldExportMode).toBe('mesh')
    expect(node.params.spatialWorldExportVariant).toBe('textured')
  })

  it('keeps spatialWorld strictly typed and hands a model out of the export', () => {
    const exporter = createNodeFromType('spatialWorld.export', { x: 0, y: 0 })
    const worldNode = createNodeFromType('asset.spatialWorld', { x: -200, y: 0 })
    const model3dNode = createNodeFromType('asset.model3d', { x: -200, y: 200 })
    const convert = createNodeFromType('model.convert', { x: 200, y: 0 })

    // 世界 → 空间世界导出：同类型，直连
    expect(canConnectNodes(worldNode, exporter, 'out', 'in-world')).toBe(true)
    // 3D 模型 → 空间世界导出：普通模型没有 world_id，不给接
    expect(canConnectNodes(model3dNode, exporter, 'out', 'in-world')).toBe(false)
    // 世界产物严格同类型：不隐式兼容 model 口（要接导演台 / 3D 加工必须先过导出）
    expect(canConnectNodes(worldNode, convert, 'out', 'in-model')).toBe(false)
    // 空间世界导出的出口是 model：导出后的 GLB 才能继续编排
    expect(canConnectNodes(exporter, convert, 'out', 'in-model')).toBe(true)

    expect(portsCompatible(GraphPortType.spatialWorld, GraphPortType.spatialWorld)).toBe(true)
    expect(portsCompatible(GraphPortType.spatialWorld, GraphPortType.model)).toBe(false)
    expect(portsCompatible(GraphPortType.model, GraphPortType.spatialWorld)).toBe(false)
  })
})

describe('executeSpatialWorldExportNode', () => {
  it('refuses to guess a world id when nothing upstream provides one', async () => {
    const exportWorld = vi.fn()
    const ctx = {
      node: exportNode(),
      inputs: {
        'in-world': [
          { kind: 'asset', assetId: 'a-1', assetType: 'model', relativePath: 'Cache/Models/x.glb' }
        ]
      },
      exportWorld
    } as unknown as NodeExecuteContext

    await expect(executeSpatialWorldExportNode(ctx)).rejects.toThrow('GRAPH_WORLD_EXPORT_NO_WORLD')
    expect(exportWorld).not.toHaveBeenCalled()
  })

  it('reports a missing capability seam instead of silently passing through', async () => {
    const ctx = {
      node: exportNode(),
      inputs: { 'in-world': [spatialWorldValue] }
    } as unknown as NodeExecuteContext
    await expect(executeSpatialWorldExportNode(ctx)).rejects.toThrow(
      'GRAPH_WORLD_EXPORT_UNAVAILABLE'
    )
  })

  it('exports an HQ mesh and keeps it in the model gallery', async () => {
    const exportWorld = vi.fn(async () => ({
      assetId: 'asset-hq-1',
      relativePath: 'Cache/Models/world-hq.glb',
      model: 'marble-1.1'
    }))
    const logs: string[] = []
    const ctx = {
      node: exportNode({ spatialWorldExportVariant: 'vertex_colored' }, 'HQ export'),
      inputs: { 'in-world': [spatialWorldValue] },
      exportWorld,
      log: (message: string) => logs.push(message)
    } as unknown as NodeExecuteContext

    const out = await executeSpatialWorldExportNode(ctx)

    expect(exportWorld).toHaveBeenCalledTimes(1)
    expect(exportWorld.mock.calls[0]![0]).toMatchObject({
      spatialWorldId: 'w-123',
      assetType: 'mesh',
      format: 'glb',
      meshVariant: 'vertex_colored'
    })
    expect(out.out).toMatchObject({ kind: 'asset', assetId: 'asset-hq-1', assetType: 'model' })
    expect(ctx.node.params.spatialWorldExportRelativePath).toBe('Cache/Models/world-hq.glb')
    expect(logs.join('\n')).toContain('HQ mesh (vertex_colored) -> Cache/Models/world-hq.glb')
  })

  it('exports PLY splats next to the world and passes the upstream world through', async () => {
    const exportWorld = vi.fn(async () => ({
      relativePath: 'Cache/Models/world.ply',
      model: 'marble-1.1'
    }))
    const logs: string[] = []
    const ctx = {
      node: exportNode(
        { spatialWorldExportMode: 'splats', spatialWorldExportResolution: '500k' },
        'PLY export'
      ),
      inputs: { 'in-world': [spatialWorldValue] },
      exportWorld,
      log: (message: string) => logs.push(message)
    } as unknown as NodeExecuteContext

    const out = await executeSpatialWorldExportNode(ctx)

    expect(exportWorld.mock.calls[0]![0]).toMatchObject({
      spatialWorldId: 'w-123',
      assetType: 'splats',
      format: 'ply',
      resolution: '500k',
      sourceRelativePath: 'Cache/Models/world.glb'
    })
    // PLY 没有可登记的资产：透传上游世界值，链不断
    expect(out.out).toMatchObject({
      kind: 'asset',
      assetId: 'asset-world-1',
      relativePath: 'Cache/Models/world.glb',
      spatialWorldId: 'w-123'
    })
    expect(ctx.node.params.spatialWorldExportAssetType).toBe('splats')
    expect(logs.join('\n')).toContain('PLY splats (500k) -> Cache/Models/world.ply')
  })

  it('needs the upstream artifact path to place PLY splats', async () => {
    const exportWorld = vi.fn()
    const ctx = {
      node: exportNode({ spatialWorldExportMode: 'splats' }),
      inputs: {
        'in-world': [{ kind: 'asset', assetId: 'a-1', assetType: 'model', spatialWorldId: 'w-123' }]
      },
      exportWorld
    } as unknown as NodeExecuteContext

    await expect(executeSpatialWorldExportNode(ctx)).rejects.toThrow('GRAPH_WORLD_EXPORT_NO_SOURCE')
    expect(exportWorld).not.toHaveBeenCalled()
  })
  it('outputs the registered splat asset so the director stage can consume it', async () => {
    const exportWorld = vi.fn(async () => ({
      assetId: 'asset-splat-1',
      relativePath: 'Assets/Models/world.ply',
      model: 'marble-1.1'
    }))
    const ctx = {
      node: exportNode({ spatialWorldExportMode: 'splats' }),
      inputs: { 'in-world': [spatialWorldValue] },
      exportWorld
    } as unknown as NodeExecuteContext

    const out = await executeSpatialWorldExportNode(ctx)

    // 登记成资产后必须输出资产值（而不是透传上游世界），否则导演台的 in-model 口接不到
    expect(out.out).toMatchObject({
      kind: 'asset',
      assetId: 'asset-splat-1',
      assetType: 'model',
      relativePath: 'Assets/Models/world.ply'
    })
  })
})
