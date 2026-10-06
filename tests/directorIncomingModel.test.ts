import { describe, expect, it } from 'vitest'
import {
  DIRECTOR_MODEL_IN_PORT,
  directorIncomingFromValue,
  pickDirectorIncomingModels,
  resolveDirectorIncomingModels
} from '../src/renderer/src/features/director/pickDirectorIncomingModel'

/**
 * 「3D 导演台接了 GLB，dive 进去什么都不显示」的排查回归。
 *
 * 根因：候选解析的**兜底分支**写的是 `source.assetType === 'model'`，
 * 但 3D 生成节点（`asset.model3d`）的 assetType 是 **`'model3d'`**
 * （`builtins.ts` 的 `assetType: meta.type`）—— 只有加工节点才是 `model`。
 * 于是「生成过、但运行态没留住」（重开工程 / 运行态被清）时取不到候选，
 * 舞台上一个物体都没有。
 *
 * 这段解析原先内联在 `useDirectorStageScene.ts`（依赖 three.js / Electron，测不了），
 * 所以口径不一致一直没被发现；现已抽成纯函数。
 */
function assetValue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'asset',
    assetType: 'model',
    assetId: 'asset-1',
    relativePath: 'Cache/Models/a.glb',
    ...over
  }
}

describe('directorIncomingFromValue', () => {
  it('接受 model 与 model3d 两种 assetType', () => {
    expect(directorIncomingFromValue(assetValue({ assetType: 'model' }) as never)?.assetId).toBe(
      'asset-1'
    )
    expect(directorIncomingFromValue(assetValue({ assetType: 'model3d' }) as never)?.assetId).toBe(
      'asset-1'
    )
  })

  it('拒绝非模型类资产（图片 / 视频 / 声音）', () => {
    for (const assetType of ['image', 'video', 'voice', 'screenplay']) {
      expect(directorIncomingFromValue(assetValue({ assetType }) as never)).toBeNull()
    }
  })

  it('拒绝非 asset 值（文本 / 数字）', () => {
    expect(directorIncomingFromValue({ kind: 'text', text: 'hi' } as never)).toBeNull()
    expect(directorIncomingFromValue(null)).toBeNull()
    expect(directorIncomingFromValue(undefined)).toBeNull()
  })

  it('带上 relativePath / title / bonePose / clip（有才带，不留空字段）', () => {
    const full = directorIncomingFromValue(
      assetValue({
        title: '主角',
        bonePose: { hips: { x: 0, y: 1, z: 0 } },
        clip: { name: 'walk', fps: 30, frameRange: [0, 40] }
      }) as never
    )
    expect(full).toMatchObject({
      assetId: 'asset-1',
      relativePath: 'Cache/Models/a.glb',
      name: '主角',
      clip: { name: 'walk', fps: 30, frameRange: [0, 40] }
    })
    expect(full?.bonePose).toBeTruthy()

    const bare = directorIncomingFromValue(
      assetValue({ relativePath: '  ', title: '  ', bonePose: {}, clip: undefined }) as never
    )
    expect(bare).toEqual({ assetId: 'asset-1', sourceTypeId: undefined })
  })
})

describe('resolveDirectorIncomingModels', () => {
  /**
   * 默认图：一个 3D 生成节点 → 导演台，接在 in-model 上。
   *
   * 覆盖 `nodes` 时**自动把线接到第一个非导演台节点**：第一版夹具覆盖了 nodes 却让
   * edges 仍指向默认的 `gen`，源节点找不到就被跳过，测试假失败（白排查一轮）。
   */
  const graph = (over: Record<string, unknown> = {}) => {
    const nodes = (over.nodes as Array<{ id: string; typeId?: string }>) ?? [
      { id: 'gen', typeId: 'asset.model3d', assetId: 'asset-1', assetType: 'model3d' },
      { id: 'director', typeId: 'asset.motion' }
    ]
    const source = nodes.find((n) => n.typeId !== 'asset.motion')?.id ?? 'gen'
    const { nodes: _nodes, ...rest } = over
    return {
      nodes,
      edges: [{ source, target: 'director', targetPort: DIRECTOR_MODEL_IN_PORT }],
      ...rest
    }
  }

  it('运行态里没有 out 时，靠节点自身的 model3d 资产兜底（这就是原来的缺口）', () => {
    const picked = resolveDirectorIncomingModels(graph(), 'director')
    expect(picked).toHaveLength(1)
    expect(picked[0].assetId).toBe('asset-1')
    expect(picked[0].sourceTypeId).toBe('asset.model3d')
  })

  it('兜底同样认 model（加工节点直挂资产）', () => {
    const picked = resolveDirectorIncomingModels(
      graph({
        nodes: [
          { id: 'rig', typeId: 'model.rigSkin', assetId: 'asset-9', assetType: 'model' },
          { id: 'director', typeId: 'asset.motion' }
        ]
      }),
      'director'
    )
    expect(picked[0]).toMatchObject({ assetId: 'asset-9', sourceTypeId: 'model.rigSkin' })
  })

  it('兜底**不**收非模型节点挂的资产', () => {
    const picked = resolveDirectorIncomingModels(
      graph({
        nodes: [
          { id: 'img', typeId: 'asset.image', assetId: 'img-1', assetType: 'image' },
          { id: 'director', typeId: 'asset.motion' }
        ]
      }),
      'director'
    )
    expect(picked).toEqual([])
  })

  it('运行输出优先于兜底，且带上 relativePath', () => {
    const picked = resolveDirectorIncomingModels(
      graph({
        runStates: {
          gen: {
            outputs: {
              out: {
                kind: 'asset',
                assetType: 'model3d',
                assetId: 'asset-1',
                relativePath: 'Cache/Models/run.glb',
                title: '运行产物'
              }
            }
          }
        }
      }),
      'director'
    )
    expect(picked[0]).toMatchObject({
      assetId: 'asset-1',
      relativePath: 'Cache/Models/run.glb',
      name: '运行产物'
    })
  })

  it('输出是多产物（output.items）时也能取到其中的模型', () => {
    // 形状对齐 flattenAssetValues：嵌套资产是 kind:'output' + items
    const picked = resolveDirectorIncomingModels(
      graph({
        nodes: [{ id: 'gen', typeId: 'asset.model3d', assetId: 'asset-1', assetType: 'model3d' }],
        runStates: {
          gen: {
            outputs: {
              out: {
                kind: 'output',
                items: [
                  { kind: 'asset', assetType: 'image', assetId: 'img-1' },
                  { kind: 'asset', assetType: 'model', assetId: 'nested-1' }
                ]
              }
            }
          }
        }
      }),
      'director'
    )
    expect(picked.map((i) => i.assetId)).toEqual(['nested-1'])
  })

  it('只认 in-model 端口：接在别的端口上的模型不算', () => {
    const picked = resolveDirectorIncomingModels(
      graph({
        edges: [{ source: 'gen', target: 'director', targetPort: 'in-panorama' }]
      }),
      'director'
    )
    expect(picked).toEqual([])
  })

  it('缺 targetPort 时按默认 in 处理（不等于 in-model，故不收）', () => {
    const picked = resolveDirectorIncomingModels(
      graph({ edges: [{ source: 'gen', target: 'director' }] }),
      'director'
    )
    expect(picked).toEqual([])
  })

  it('线接的是别的节点时不算', () => {
    const picked = resolveDirectorIncomingModels(graph(), 'other-director')
    expect(picked).toEqual([])
  })

  it('没有线 / 没有图 / 没有目标节点时返回空数组（不抛错）', () => {
    expect(resolveDirectorIncomingModels(graph({ edges: [] }), 'director')).toEqual([])
    expect(resolveDirectorIncomingModels(null, 'director')).toEqual([])
    expect(resolveDirectorIncomingModels(graph(), null)).toEqual([])
    expect(resolveDirectorIncomingModels(graph(), undefined)).toEqual([])
  })

  it('源节点不存在时跳过（不抛错）', () => {
    const picked = resolveDirectorIncomingModels(
      graph({
        edges: [{ source: 'missing', target: 'director', targetPort: DIRECTOR_MODEL_IN_PORT }]
      }),
      'director'
    )
    expect(picked).toEqual([])
  })

  it('同一 assetId 走运行态与兜底两条线时只留一条（去重）', () => {
    const picked = resolveDirectorIncomingModels(
      {
        nodes: [
          { id: 'gen', typeId: 'asset.model3d', assetId: 'asset-1', assetType: 'model3d' },
          { id: 'rig', typeId: 'model.rigSkin', assetId: 'asset-1', assetType: 'model' },
          { id: 'director', typeId: 'asset.motion' }
        ],
        edges: [
          { source: 'gen', target: 'director', targetPort: DIRECTOR_MODEL_IN_PORT },
          { source: 'rig', target: 'director', targetPort: DIRECTOR_MODEL_IN_PORT }
        ]
      },
      'director'
    )
    expect(picked).toHaveLength(1)
    // 加工更深的一条胜出
    expect(picked[0].sourceTypeId).toBe('model.rigSkin')
  })
})

describe('pickDirectorIncomingModels 保持原有排序行为', () => {
  it('同 assetId 取加工最深的一条', () => {
    const picked = pickDirectorIncomingModels([
      { assetId: 'c1', relativePath: 'raw.glb', sourceTypeId: 'asset.model3d' },
      { assetId: 'c1', relativePath: 'rigged.glb', sourceTypeId: 'model.rigSkin' },
      { assetId: 'c2', relativePath: 'other.glb', sourceTypeId: 'asset.model3d' }
    ])
    expect(picked).toHaveLength(2)
    expect(picked.find((i) => i.assetId === 'c1')?.relativePath).toBe('rigged.glb')
  })

  it('空 assetId 被丢掉', () => {
    expect(pickDirectorIncomingModels([{ assetId: '  ' }])).toEqual([])
  })
})
