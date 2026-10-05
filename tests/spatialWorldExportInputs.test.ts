import { describe, expect, it } from 'vitest'
import { resolveGalleryOutputsFromNodeParams } from '../src/shared/graph/execute/helpers'
import type { GraphAssetValue } from '../src/shared/graph/execute/types'

/**
 * 「空间世界导出」报 GRAPH_WORLD_EXPORT_NO_WORLD 的那次失败：
 * 世界生成节点的产物（GLB 资产 + world_id）**已经落盘**，但单节点执行 / soft-resolve
 * 时上游不 cook，导出节点只能读上游节点的 `generatedModels` 重建输出 ——
 * 重建时漏掉 `spatialWorldId`，于是「明明刚生成过世界」却说没有世界。
 *
 * 这里锁住重建这一步：只要节点参数里存着 world_id，重建出来的资产值就必须带着它。
 */
const storedWorldParams = {
  generatedModels: [
    {
      id: 'gen-model:20261005-050900000',
      createdAt: '2026-10-05T05:09:00.000Z',
      relativePath: 'Cache/Models/空间世界生成.glb',
      assetId: 'db4ebd80-9e5c-4837-98f4-d131035cddeb',
      spatialWorldId: 'wl-world-42'
    }
  ],
  selectedModelId: 'gen-model:20261005-050900000'
}

describe('node-params gallery rebuild keeps the world id', () => {
  it('carries spatialWorldId through so the export node can find the world', () => {
    const outputs = resolveGalleryOutputsFromNodeParams(storedWorldParams)
    expect(outputs).not.toBeNull()

    const out = outputs!.out as GraphAssetValue
    expect(out).toMatchObject({
      kind: 'asset',
      assetType: 'model',
      assetId: 'db4ebd80-9e5c-4837-98f4-d131035cddeb',
      relativePath: 'Cache/Models/空间世界生成.glb',
      spatialWorldId: 'wl-world-42'
    })
    // 上游世界生成节点的 out-all 也要带同一个 id（导出节点两条入线都读）
    const all = outputs!['out-all'] as GraphAssetValue
    expect(all.spatialWorldId).toBe('wl-world-42')
  })

  it('does not invent a world id when the record has none', () => {
    const outputs = resolveGalleryOutputsFromNodeParams({
      generatedModels: [
        {
          id: 'gen-model:x',
          relativePath: 'Cache/Models/hero.glb',
          assetId: 'asset-1'
        }
      ],
      selectedModelId: 'gen-model:x'
    })
    const out = outputs!.out as GraphAssetValue
    expect(out.relativePath).toBe('Cache/Models/hero.glb')
    expect(out.spatialWorldId).toBeUndefined()
  })

  it('keeps the 3D-model gallery fields it already carried', () => {
    const outputs = resolveGalleryOutputsFromNodeParams({
      generatedModels: [
        {
          id: 'gen-model:y',
          relativePath: 'Cache/Models/rigged.glb',
          assetId: 'asset-2',
          providerTaskId: 'task-9',
          rigMeta: { armature: 'Armature', bones: ['Hips'], vertexGroups: [] }
        }
      ],
      selectedModelId: 'gen-model:y'
    })
    const out = outputs!.out as GraphAssetValue
    expect(out.providerTaskId).toBe('task-9')
    expect(out.rigMeta?.bones).toEqual(['Hips'])
  })
})
