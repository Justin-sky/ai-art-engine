import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAGE2D_SCENE,
  createDefaultStage2dScene,
  readStage2dSceneFromNode,
  stage2dSceneToNodePatch,
  type Stage2dSceneState
} from '../src/shared/graph'

describe('stage.2d 节点参数态（graph/stage2d）', () => {
  it('createDefaultStage2dScene 落到默认画布 / ground 语义且层为空', () => {
    const scene = createDefaultStage2dScene()
    expect(scene).toEqual(DEFAULT_STAGE2D_SCENE)
    expect(scene.canvasWidth).toBe(1024)
    expect(scene.canvasHeight).toBe(1024)
    expect(scene.anchor).toBe('ground')
    expect(scene.groundRatio).toBe(0.06)
    expect(scene.layers).toEqual([])
    // 每次新建是独立对象，跨节点不共享引用
    const another = createDefaultStage2dScene()
    expect(another).not.toBe(scene)
    expect(another.layers).not.toBe(scene.layers)
  })

  it('readStage2dSceneFromNode 兼容缺参节点并回落默认', () => {
    expect(readStage2dSceneFromNode(undefined)).toEqual(DEFAULT_STAGE2D_SCENE)
    expect(readStage2dSceneFromNode({})).toEqual(DEFAULT_STAGE2D_SCENE)
    expect(readStage2dSceneFromNode(null)).toEqual(DEFAULT_STAGE2D_SCENE)
    const scene = readStage2dSceneFromNode({
      stage2dScene: { canvasWidth: 512, canvasHeight: 512 }
    })
    expect(scene.canvasWidth).toBe(512)
    expect(scene.canvasHeight).toBe(512)
    expect(scene.anchor).toBe(DEFAULT_STAGE2D_SCENE.anchor)
    expect(scene.layers).toEqual([])
  })

  it('toNodePatch 归一化后可回读：保层序、剔除无源层', () => {
    const raw: Stage2dSceneState = {
      canvasWidth: 640,
      canvasHeight: 480,
      anchor: 'center',
      groundRatio: 0.5,
      layers: [
        {
          id: 'bg',
          name: '背景',
          sourceUrl: 'sprites/bg.png',
          visible: true,
          align: { anchor: 'center', contentHeightRatio: 1, groundRatio: 0, fitWithinWidth: true }
        },
        {
          id: 'broken',
          name: '空',
          sourceUrl: '',
          visible: true,
          align: { anchor: 'center', contentHeightRatio: 1, groundRatio: 0, fitWithinWidth: true }
        }
      ]
    }
    const patch = stage2dSceneToNodePatch(raw)
    const scene = readStage2dSceneFromNode(patch)
    expect(patch.stage2dScene).toBeDefined()
    expect(scene).toMatchObject({
      canvasWidth: 640,
      canvasHeight: 480,
      anchor: 'center',
      groundRatio: 0.5
    })
    expect(scene.layers.length).toBe(1)
    expect(scene.layers[0]).toMatchObject({ id: 'bg', name: '背景', sourceUrl: 'sprites/bg.png' })
  })

  it('越界画布与非法层对齐夹取回落（复读归一化口径）', () => {
    const scene = readStage2dSceneFromNode({
      stage2dScene: {
        canvasWidth: 0,
        canvasHeight: 99999,
        layers: [
          {
            id: 'a',
            name: 'A',
            sourceUrl: 'sprites/a.png',
            align: {
              anchor: 'ground',
              contentHeightRatio: 3,
              groundRatio: 2,
              fitWithinWidth: false
            },
            visible: true
          }
        ]
      }
    })
    expect(scene.canvasWidth).toBe(16)
    expect(scene.canvasHeight).toBe(8192)
    expect(scene.layers[0]!.align).toMatchObject({
      anchor: 'ground',
      contentHeightRatio: 1,
      groundRatio: 0.5,
      fitWithinWidth: false
    })
  })
})
