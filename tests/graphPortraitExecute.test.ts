import { describe, expect, it } from 'vitest'
import { createNodeFromType, runGraph } from '../src/shared/graph'
import { portraitSourceHash } from '../src/shared/graph/execute/portrait'
import {
  canonicalFaceTemplate,
  normalizePortraitRetouch,
  type PortraitFaceAnalysis,
  type PortraitFacesPayload
} from '../src/shared/graph'

/**
 * image.portrait 执行器契约。
 *
 * 这个节点的像素活全在渲染层的 `bakePortraitRetouch` 钩子里，所以执行器测试要锁的是
 * **接线与决策**而不是画面本身：
 * 1. 无上游图 → GRAPH_PROCESS_NO_INPUT；
 * 2. 未注入烘焙能力 → 明确报错（绝不能静默透传上游，那等于交付一张没修过的图）；
 * 3. 关键点：没缓存要检测并写回 params，缓存命中（sourceHash 一致）就不再检测；
 * 4. 落盘：烘焙图 +（开了拼版时的）拼版图各落一份，路径回写节点参数；
 * 5. 种子稳定：同一份输入两次运行给同一个种子（否则颗粒会让 Cook 不可复现）。
 */

const SOURCE_URL = 'data:image/png;base64,AAAA'

function faceAnalysis(): PortraitFaceAnalysis {
  return {
    schema: 'canonical68',
    landmarks: canonicalFaceTemplate(),
    box: { x: 0.3, y: 0.2, w: 0.4, h: 0.5 },
    score: 0.97,
    modelId: 'test-face'
  }
}

function buildGraph() {
  const src = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'src', title: '原图' })
  const node = createNodeFromType('image.portrait', { x: 240, y: 0 }, { id: 'portrait' })
  return { src, node }
}

type RunStub = ReturnType<typeof buildStub>

function buildStub() {
  const saved: Array<{ key: string; dataUrl: string }> = []
  const patches: Array<{ nodeId: string; params?: Record<string, unknown> }> = []
  const bakeCalls: Array<{ seed: number; strokes: number; hasFace: boolean; stageLogs: number }> =
    []
  const detectCalls: string[] = []
  let bakeResult: {
    dataUrl: string
    sheetDataUrl: string | null
    width: number
    height: number
    landmarks: Array<[number, number]> | null
  } = {
    dataUrl: 'data:image/png;base64,BAKED',
    sheetDataUrl: null,
    width: 800,
    height: 1200,
    landmarks: canonicalFaceTemplate()
  }

  const stub = {
    stepDelayMs: 1,
    resolveImageUrls: async (items: Array<{ dataUrl?: string }>) =>
      items.map((item) => item.dataUrl ?? ''),
    detectPortraitFaces: async ({ sourceDataUrl }: { sourceDataUrl: string }) => {
      detectCalls.push(sourceDataUrl)
      return [faceAnalysis()]
    },
    bakePortraitRetouch: async (input: {
      seed: number
      strokes: unknown[]
      face: PortraitFaceAnalysis | null
      onStage?: (info: { stage: string; index: number; total: number }) => void
    }) => {
      let stageLogs = 0
      input.onStage?.({ stage: 'geometry', index: 1, total: 13 })
      stageLogs++
      bakeCalls.push({
        seed: input.seed,
        strokes: input.strokes.length,
        hasFace: !!input.face,
        stageLogs
      })
      return bakeResult
    },
    saveRunMedia: async (input: { dataUrl: string; key: string }) => {
      saved.push({ key: input.key, dataUrl: input.dataUrl })
      return `Assets/Portrait/${input.key}.png`
    },
    onNodePatch: (nodeId: string, patch: { params?: Record<string, unknown> }) => {
      patches.push({ nodeId, params: patch.params })
    }
  }
  return {
    stub,
    saved,
    patches,
    bakeCalls,
    detectCalls,
    setBakeResult: (value: typeof bakeResult) => {
      bakeResult = value
    }
  }
}

async function runPortrait(
  run: RunStub,
  nodeParams?: Record<string, unknown>,
  stubOverride?: Record<string, unknown>
) {
  const { src, node } = buildGraph()
  if (nodeParams) node.params = { ...node.params, ...nodeParams }
  return {
    node,
    result: await runGraph(
      {
        nodes: [src, node],
        edges: [{ id: 'e1', source: src.id, target: node.id, sourcePort: 'out', targetPort: 'in' }],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...run.stub,
        ...stubOverride,
        targetNodeId: node.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [src.id]: {
            status: 'done',
            outputs: {
              out: {
                kind: 'image',
                id: 'src-out',
                dataUrl: SOURCE_URL,
                createdAt: '2026-10-03T00:00:00.000Z',
                relativePath: ''
              }
            }
          }
        }
      } as never
    )
  }
}

describe('image.portrait 执行器', () => {
  it('无上游图时报 GRAPH_PROCESS_NO_INPUT', async () => {
    const run = buildStub()
    const { src, node } = buildGraph()
    const result = await runGraph(
      {
        nodes: [src, node],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...run.stub,
        targetNodeId: node.id,
        onlyTargetNode: true
      } as never
    )
    expect(result.ok).toBe(false)
    expect(String(result.error)).toContain('GRAPH_PROCESS_NO_INPUT')
    expect(run.bakeCalls).toHaveLength(0)
  })

  it('未注入烘焙能力时明确报错，绝不透传上游', async () => {
    const run = buildStub()
    const result = await runPortrait(run, undefined, { bakePortraitRetouch: undefined })
    expect(result.result.ok).toBe(false)
    // 错误文案来自 SHARED_ERRORS.capabilityPortraitBake（zh 面）
    expect(String(result.result.error)).toContain('人像处理烘焙能力未注入')
  })

  it('正常烘焙：检测关键点并写回 params、落盘、回写产物路径、逐阶段写日志', async () => {
    const run = buildStub()
    const { node, result } = await runPortrait(run)
    expect(result.ok, result.error).toBe(true)

    // 关键点：未缓存 → 调了一次检测
    expect(run.detectCalls).toEqual([SOURCE_URL])
    expect(run.bakeCalls).toHaveLength(1)
    expect(run.bakeCalls[0]!.hasFace).toBe(true)
    expect(run.bakeCalls[0]!.stageLogs).toBe(1)

    // 落盘：一张烘焙图
    expect(run.saved.map((s) => s.dataUrl)).toEqual(['data:image/png;base64,BAKED'])

    // 节点参数：烘焙路径 + 关键点缓存（带源图指纹）
    const params = run.patches.map((p) => p.params ?? {})
    const baked = params.find((p) => 'portraitBakedRelativePath' in p)
    // 落盘名由 materialize 统一生成（含节点标题与时间戳），这里只锁「确实回写了产物路径」
    expect(String(baked?.portraitBakedRelativePath)).toMatch(/\.png$/)
    expect(node.params.portraitBakedRelativePath).toBe(baked?.portraitBakedRelativePath)
    const faces = params.find((p) => 'portraitFaces' in p)?.portraitFaces as PortraitFacesPayload
    expect(faces.sourceHash).toBe(portraitSourceHash(SOURCE_URL))
    expect(faces.faces).toHaveLength(1)
    expect(faces.picked).toBe(0)
    expect(node.params.portraitBakedRelativePath).toBe(baked?.portraitBakedRelativePath)
  })

  it('关键点缓存命中（sourceHash 一致）时不再检测', async () => {
    const run = buildStub()
    const cached: PortraitFacesPayload = {
      v: 1,
      sourceHash: portraitSourceHash(SOURCE_URL),
      faces: [faceAnalysis()],
      picked: 0,
      at: '2026-10-03T00:00:00.000Z'
    }
    const { result } = await runPortrait(run, { portraitFaces: cached })
    expect(result.ok, result.error).toBe(true)
    expect(run.detectCalls).toHaveLength(0)
    expect(run.bakeCalls[0]!.hasFace).toBe(true)
  })

  it('源图换了（指纹不一致）时缓存失效，重新检测', async () => {
    const run = buildStub()
    const stale: PortraitFacesPayload = {
      v: 1,
      sourceHash: 'old-hash',
      faces: [faceAnalysis()],
      picked: 0,
      at: '2026-10-03T00:00:00.000Z'
    }
    const { result } = await runPortrait(run, { portraitFaces: stale })
    expect(result.ok, result.error).toBe(true)
    expect(run.detectCalls).toHaveLength(1)
  })

  it('开启证件照拼版时额外落一张拼版图', async () => {
    const run = buildStub()
    run.setBakeResult({
      dataUrl: 'data:image/png;base64,SHEETCELL',
      sheetDataUrl: 'data:image/png;base64,SHEETPAPER',
      width: 295,
      height: 413,
      landmarks: canonicalFaceTemplate()
    })
    const { result } = await runPortrait(run, {
      portraitRetouch: normalizePortraitRetouch({ idPhotoSpecId: 'oneInch', idPhotoSheet: true })
    })
    expect(result.ok, result.error).toBe(true)
    expect(run.saved.map((s) => s.dataUrl)).toEqual([
      'data:image/png;base64,SHEETCELL',
      'data:image/png;base64,SHEETPAPER'
    ])
  })

  it('种子稳定：同参数两次运行得到同一个颗粒种子', async () => {
    const first = buildStub()
    const second = buildStub()
    await runPortrait(first)
    await runPortrait(second)
    expect(first.bakeCalls[0]!.seed).toBe(second.bakeCalls[0]!.seed)
    expect(first.bakeCalls[0]!.seed).toBeGreaterThan(0)
  })

  it('笔画随参数透传给烘焙钩子', async () => {
    const run = buildStub()
    const { result } = await runPortrait(run, {
      portraitStrokes: [
        {
          id: 's1',
          tool: 'liquify',
          mode: 'push',
          size: 0.2,
          hardness: 60,
          strength: 80,
          points: [{ x: 0.5, y: 0.5, dx: 0.03, dy: 0 }]
        }
      ]
    })
    expect(result.ok, result.error).toBe(true)
    expect(run.bakeCalls[0]!.strokes).toBe(1)
  })

  it('多张上游图 = 同一套参数批量精修（逐张烘焙并各自落盘）', async () => {
    const run = buildStub()
    const first = createNodeFromType('asset.image', { x: 0, y: 0 }, { id: 'first' })
    const second = createNodeFromType('asset.image', { x: 0, y: 200 }, { id: 'second' })
    const node = createNodeFromType('image.portrait', { x: 240, y: 0 }, { id: 'portrait' })

    const done = (dataUrl: string) => ({
      status: 'done',
      outputs: { out: { kind: 'image', id: dataUrl, dataUrl, createdAt: '', relativePath: '' } }
    })

    const result = await runGraph(
      {
        nodes: [first, second, node],
        edges: [
          { id: 'e1', source: first.id, target: node.id, sourcePort: 'out', targetPort: 'in' },
          { id: 'e2', source: second.id, target: node.id, sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        ...run.stub,
        targetNodeId: node.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [first.id]: done('data:image/png;base64,AAAA'),
          [second.id]: done('data:image/png;base64,BBBB')
        }
      } as never
    )

    expect(result.ok, result.error).toBe(true)
    // 两张图各烘焙一次、各落一份产物、各自做一次人脸检测
    expect(run.bakeCalls).toHaveLength(2)
    expect(run.saved).toHaveLength(2)
    expect(run.detectCalls).toHaveLength(2)
  })
})
