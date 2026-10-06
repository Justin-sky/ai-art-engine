import { describe, expect, it } from 'vitest'
import {
  ANIM2D_GIF_OUT_PORT_ID,
  RUN_MEDIA_PATH_LIMIT,
  STAGE2D_FRAMES_OUT_PORT_ID,
  STAGE2D_SHEET_OUT_PORT_ID,
  SVG_ANIM_GIF_OUT_PORT_ID,
  collectRunMediaPaths,
  createNodeFromType,
  type GraphDocument,
  type GraphNode,
  type GraphNodeRunState,
  type GraphValue
} from '../src/shared/graph'

/**
 * 图运行产物 → 会话可见媒体路径的收集契约：
 * 对话流只看 MCP 活动，图运行产物必须由这里挑出来回传，因此「挑哪些、跳哪些」是行为契约。
 */

function makeGraph(nodes: GraphNode[]): GraphDocument {
  return { nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }
}

function statesOf(
  entries: Record<string, Record<string, GraphValue>>
): Record<string, GraphNodeRunState> {
  const states: Record<string, GraphNodeRunState> = {}
  for (const [nodeId, outputs] of Object.entries(entries)) {
    states[nodeId] = { status: 'done', outputs }
  }
  return states
}

describe('collectRunMediaPaths', () => {
  it('2D 帧动画：收集 GIF 动图产物，逐帧序列不单独出卡', () => {
    const anim = createNodeFromType('anim.2d', { x: 0, y: 0 }, { id: 'anim' })
    const paths = collectRunMediaPaths(
      makeGraph([anim]),
      statesOf({
        anim: {
          [ANIM2D_GIF_OUT_PORT_ID]: {
            kind: 'image',
            dataUrl: '',
            relativePath: 'Cache/Anim/anim.gif'
          }
        }
      })
    )

    expect(paths).toEqual(['Cache/Anim/anim.gif'])
  })

  it('2D 舞台：收集拼版 sheet，跳过逐帧序列端口', () => {
    const stage = createNodeFromType('stage.2d', { x: 0, y: 0 }, { id: 'stage' })
    const paths = collectRunMediaPaths(
      makeGraph([stage]),
      statesOf({
        stage: {
          [STAGE2D_FRAMES_OUT_PORT_ID]: {
            kind: 'images',
            items: [
              { dataUrl: '', relativePath: 'Cache/Frames/1.png' },
              { dataUrl: '', relativePath: 'Cache/Frames/2.png' }
            ]
          },
          [STAGE2D_SHEET_OUT_PORT_ID]: {
            kind: 'image',
            dataUrl: '',
            relativePath: 'Cache/Frames/sheet.png'
          }
        }
      })
    )

    expect(paths).toEqual(['Cache/Frames/sheet.png'])
  })

  it('输出节点成片：图片数组取末条（图库「最新」语义）', () => {
    const out = createNodeFromType('output.image', { x: 0, y: 0 }, { id: 'image-output' })
    const paths = collectRunMediaPaths(
      makeGraph([out]),
      statesOf({
        'image-output': {
          out: {
            kind: 'images',
            items: [
              { dataUrl: '', relativePath: 'Assets/Out/1.png' },
              { dataUrl: 'data:image/png;base64,AAAA' },
              { dataUrl: '', relativePath: 'Assets/Out/3.png' }
            ]
          }
        }
      })
    )

    expect(paths).toEqual(['Assets/Out/3.png'])
  })

  it('无作品级产物时兜底收集中间节点产出（只跑了单个生成节点）', () => {
    const gen = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'gen' })
    const paths = collectRunMediaPaths(
      makeGraph([gen]),
      statesOf({
        gen: {
          out: { kind: 'image', dataUrl: '', relativePath: 'Cache/Gen/one.png' }
        }
      })
    )

    expect(paths).toEqual(['Cache/Gen/one.png'])
  })

  it('已有作品级产物时不做中间图兜底', () => {
    const gen = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'gen' })
    const anim = createNodeFromType('anim.2d', { x: 200, y: 0 }, { id: 'anim' })
    const paths = collectRunMediaPaths(
      makeGraph([gen, anim]),
      statesOf({
        gen: {
          out: { kind: 'image', dataUrl: '', relativePath: 'Cache/Gen/one.png' }
        },
        anim: {
          [ANIM2D_GIF_OUT_PORT_ID]: {
            kind: 'image',
            dataUrl: '',
            relativePath: 'Cache/Anim/anim.gif'
          }
        }
      })
    )

    expect(paths).toEqual(['Cache/Anim/anim.gif'])
  })

  it('去重并按上限截断：同一路径只回一条', () => {
    const nodes: GraphNode[] = []
    const outputs: Record<string, Record<string, GraphValue>> = {}
    for (let i = 0; i < RUN_MEDIA_PATH_LIMIT + 3; i++) {
      const id = `gen-${i}`
      nodes.push(createNodeFromType('asset.image', { x: i * 100, y: 0 }, { id }))
      outputs[id] = {
        out: {
          kind: 'image',
          dataUrl: '',
          relativePath: i < 2 ? 'Cache/dup.png' : `Cache/${i}.png`
        }
      }
    }

    const paths = collectRunMediaPaths(makeGraph(nodes), statesOf(outputs))

    expect(paths).toHaveLength(RUN_MEDIA_PATH_LIMIT)
    expect(paths[0]).toBe('Cache/dup.png')
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('未物化（只有 dataUrl）的产出不进会话', () => {
    const gen = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'gen' })
    const paths = collectRunMediaPaths(
      makeGraph([gen]),
      statesOf({
        gen: { out: { kind: 'image', dataUrl: 'data:image/png;base64,AAAA' } }
      })
    )

    expect(paths).toEqual([])
  })

  it('SVG 生成：收集落盘 .svg（图库「新在前」，取首条即最新）', () => {
    const gen = createNodeFromType('svg.gen', { x: 0, y: 0 }, { id: 'svg-gen' })
    const paths = collectRunMediaPaths(
      makeGraph([gen]),
      statesOf({
        'svg-gen': {
          out: { kind: 'svg', text: '<svg/>', relativePath: 'Assets/SVG/b.svg' },
          'out-all': {
            kind: 'svgs',
            items: [
              { text: '<svg/>', relativePath: 'Assets/SVG/b.svg' },
              { text: '<svg/>', relativePath: 'Assets/SVG/a.svg' }
            ]
          }
        }
      })
    )

    expect(paths).toEqual(['Assets/SVG/b.svg'])
  })

  it('SVG 生成：只出源码未落盘时不进会话', () => {
    const gen = createNodeFromType('svg.gen', { x: 0, y: 0 }, { id: 'svg-gen' })
    const paths = collectRunMediaPaths(
      makeGraph([gen]),
      statesOf({
        'svg-gen': { out: { kind: 'svg', text: '<svg/>' } }
      })
    )

    expect(paths).toEqual([])
  })

  it('SVG 烘焙：GIF 与 2D 帧动画 GIF 同为作品级产物，两条都收', () => {
    const anim = createNodeFromType('anim.2d', { x: 0, y: 0 }, { id: 'anim' })
    const svgAnim = createNodeFromType('svg.anim', { x: 200, y: 0 }, { id: 'svg-anim' })
    const paths = collectRunMediaPaths(
      makeGraph([anim, svgAnim]),
      statesOf({
        anim: {
          [ANIM2D_GIF_OUT_PORT_ID]: {
            kind: 'image',
            dataUrl: '',
            relativePath: 'Cache/Anim/anim.gif'
          }
        },
        'svg-anim': {
          [SVG_ANIM_GIF_OUT_PORT_ID]: {
            kind: 'image',
            dataUrl: '',
            relativePath: 'Cache/SvgAnim/bake.gif'
          }
        }
      })
    )

    expect(paths).toEqual(['Cache/Anim/anim.gif', 'Cache/SvgAnim/bake.gif'])
  })

  /**
   * 「AI 对话流里没有预览生成的 splat 结果」的回归（第一层）。
   *
   * 3D 产物（GLB 网格 / PLY·SPZ 泼溅）在运行态里是 `kind: 'asset'`，而
   * `mediaPathOf` 的 switch **早先没有 `asset` 分支** → 落到 `default` 返回 undefined
   * → 3D 产物**连一条路径都不回报**：对话里既不显示预览、也不显示路径文本。
   *
   * 第二层是产物卡的扩展名判据（见 tests/chatSplatPreview.test.ts）。
   */
  describe('3D 产物（含高斯泼溅）也要进会话', () => {
    it('3D 生成节点：asset 值按 relativePath 收集', () => {
      const gen = createNodeFromType('asset.model3d', { x: 0, y: 0 }, { id: 'model-gen' })
      const paths = collectRunMediaPaths(
        makeGraph([gen]),
        statesOf({
          'model-gen': {
            out: {
              kind: 'asset',
              assetType: 'model',
              assetId: 'asset-1',
              relativePath: 'Cache/Models/char.glb'
            }
          }
        })
      )

      expect(paths).toEqual(['Cache/Models/char.glb'])
    })

    it('泼溅产物（.ply / .spz）同样被收集 —— 它们在对话里也走 ModelPreview', () => {
      const exp = createNodeFromType('spatialWorld.export', { x: 0, y: 0 }, { id: 'exp' })
      for (const relativePath of ['Cache/Models/world.ply', 'Cache/Models/world.spz']) {
        const paths = collectRunMediaPaths(
          makeGraph([exp]),
          statesOf({
            exp: {
              out: { kind: 'asset', assetType: 'model', assetId: 'a', relativePath }
            }
          })
        )
        expect(paths).toEqual([relativePath])
      }
    })

    it('输出节点的 3D 产物在 items 里，兜底也能取到', () => {
      const out = createNodeFromType('output.image', { x: 0, y: 0 }, { id: 'out' })
      const paths = collectRunMediaPaths(
        makeGraph([out]),
        statesOf({
          out: {
            out: {
              kind: 'output',
              outputKind: 'image',
              params: {},
              notes: [],
              items: [
                { kind: 'asset', assetType: 'model', assetId: 'm1', relativePath: 'Cache/M/a.glb' },
                {
                  kind: 'asset',
                  assetType: 'model',
                  assetId: 'm2',
                  relativePath: 'Cache/M/latest.ply'
                }
              ]
            }
          }
        })
      )

      // 末条 = 最新（与图片数组同一语义）
      expect(paths).toEqual(['Cache/M/latest.ply'])
    })

    it('图片优先于 items：两者都在时仍取图片，不改变既有行为', () => {
      const out = createNodeFromType('output.image', { x: 0, y: 0 }, { id: 'out' })
      const paths = collectRunMediaPaths(
        makeGraph([out]),
        statesOf({
          out: {
            out: {
              kind: 'output',
              outputKind: 'image',
              params: {},
              notes: [],
              images: [{ dataUrl: '', relativePath: 'Assets/Out/shot.png' }],
              items: [
                { kind: 'asset', assetType: 'model', assetId: 'm1', relativePath: 'Cache/M/a.glb' }
              ]
            }
          }
        })
      )

      expect(paths).toEqual(['Assets/Out/shot.png'])
    })

    it('没有 relativePath 的 asset 值不进会话（未物化）', () => {
      const gen = createNodeFromType('asset.model3d', { x: 0, y: 0 }, { id: 'model-gen' })
      const paths = collectRunMediaPaths(
        makeGraph([gen]),
        statesOf({
          'model-gen': { out: { kind: 'asset', assetType: 'model', assetId: 'asset-1' } }
        })
      )

      expect(paths).toEqual([])
    })
  })
})
