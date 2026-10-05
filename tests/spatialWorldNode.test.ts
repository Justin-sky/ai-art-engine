import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildInstructionFinalPromptPreview,
  createNodeFromType,
  executeSpatialWorldGenerateNode,
  getNodePorts,
  getNodeType,
  listAddableNodeTypes,
  listNodeTypes,
  resolveInstructionFinalPreviewKind,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'
import type { VideoJobRecord } from '../src/shared/videoJob'
import { jobKind } from '../src/shared/videoJob'
import { videoJobRepository } from '../src/main/repositories/videoJobRepository'

function worldNode(params: Record<string, unknown> = {}, title = 'World'): GraphNode {
  return {
    id: 'world-1',
    typeId: 'asset.spatialWorld',
    category: 'asset',
    assetType: 'spatialWorld',
    title,
    position: { x: 0, y: 0 },
    params
  } as GraphNode
}

function imageInputs(urls: string[]) {
  return {
    'in-image': urls.map((url, i) => ({
      kind: 'image' as const,
      id: `img-${i}`,
      dataUrl: url,
      relativePath: ''
    }))
  }
}

describe('asset.spatialWorld node type', () => {
  // 内置类型是惰性注册的，getNodeType 本身不触发注册
  beforeAll(() => {
    listNodeTypes()
  })

  it('is registered, addable and exposes text/image/video in + model gallery out', () => {
    const def = getNodeType('asset.spatialWorld')
    expect(def).toBeTruthy()
    expect(def?.assetType).toBe('spatialWorld')
    expect(def?.addable).toBe(true)
    expect(
      listAddableNodeTypes('workflow').some((item) => item.typeId === 'asset.spatialWorld')
    ).toBe(true)

    const node = createNodeFromType('asset.spatialWorld', { x: 0, y: 0 })
    expect(getNodePorts(node).map((port) => [port.id, port.direction, port.dataType])).toEqual([
      ['in-text', 'in', 'text'],
      ['in-image', 'in', 'image'],
      ['in-video', 'in', 'video'],
      // 世界产物不是普通模型：出口是 spatialWorld（带 world_id），可单向接 model 口
      ['out', 'out', 'spatialWorld'],
      ['out-all', 'out', 'spatialWorld']
    ])
    expect(node.params.spatialWorldSeed).toBe(0)
  })

  it('resolves the world instruction preview kind and prompt', () => {
    const node = worldNode()
    expect(resolveInstructionFinalPreviewKind(node, null)).toBe('spatialWorld')
    // 世界生成必须有专属系统提示词：漏分支会静默落到剧本规范（「第一行必须是剧本名」）
    const preview = buildInstructionFinalPromptPreview({
      kind: 'spatialWorld',
      instructionRaw: 'a cozy cabin in a snowy pine forest',
      sources: [],
      locale: 'en-US'
    })
    expect(preview).toContain('3D world')
    expect(preview).toContain('cozy cabin')
    expect(preview).not.toContain('screenplay')
  })
})

describe('executeSpatialWorldGenerateNode', () => {
  it('falls back to text passthrough when no world API is injected', async () => {
    const ctx = {
      node: worldNode({ generateInstruction: 'a quiet courtyard' }),
      inputs: {}
    } as unknown as NodeExecuteContext
    await expect(executeSpatialWorldGenerateNode(ctx)).resolves.toMatchObject({
      out: { kind: 'text', text: 'a quiet courtyard' }
    })
  })

  it('throws GRAPH_PROCESS_NO_INPUT with no prompt and no images', async () => {
    const ctx = {
      node: worldNode(),
      inputs: {},
      generateSpatialWorld: vi.fn()
    } as unknown as NodeExecuteContext
    await expect(executeSpatialWorldGenerateNode(ctx)).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })

  it('submits prompt + references + seed and keeps the model gallery', async () => {
    const generateSpatialWorld = vi.fn(async () => ({
      assetId: 'asset-world-1',
      relativePath: 'Cache/Models/world.glb',
      model: 'marble-1.1'
    }))
    const ctx = {
      node: worldNode(
        {
          generateInstruction: 'mystical forest',
          generateModel: 'marble-1.1',
          generateProviderInstanceId: 'wl-1',
          spatialWorldSeed: 1234
        },
        'Forest World'
      ),
      inputs: imageInputs(['https://cdn.example.com/a.jpg']),
      generateSpatialWorld,
      resolveHostAssetId: () => 'host-1'
    } as unknown as NodeExecuteContext

    const out = await executeSpatialWorldGenerateNode(ctx)

    expect(generateSpatialWorld).toHaveBeenCalledTimes(1)
    expect(generateSpatialWorld.mock.calls[0]![0]).toMatchObject({
      prompt: 'mystical forest',
      model: 'marble-1.1',
      providerInstanceId: 'wl-1',
      seed: 1234,
      displayName: 'Forest World',
      graphBinding: { nodeId: 'world-1', assetId: 'host-1' }
    })
    expect(out.out).toMatchObject({
      kind: 'asset',
      assetId: 'asset-world-1',
      assetType: 'model',
      relativePath: 'Cache/Models/world.glb'
    })
    expect(ctx.node.params.generatedModels).toHaveLength(1)
  })

  it('caps reference images at four and drops a zero seed', async () => {
    const generateSpatialWorld = vi.fn(async () => ({
      assetId: 'asset-world-2',
      relativePath: 'Cache/Models/world2.glb',
      model: 'marble-1.1'
    }))
    const ctx = {
      node: worldNode({ generateInstruction: 'x', spatialWorldSeed: 0 }),
      inputs: imageInputs([1, 2, 3, 4, 5].map((i) => `https://cdn.example.com/${i}.jpg`)),
      generateSpatialWorld
    } as unknown as NodeExecuteContext

    await executeSpatialWorldGenerateNode(ctx)
    const input = generateSpatialWorld.mock.calls[0]![0] as {
      seed?: number
      inputReferences?: Array<{ url: string }>
    }
    expect(input.seed).toBeUndefined()
    expect(input.inputReferences?.map((ref) => ref.url)).toEqual([
      'https://cdn.example.com/1.jpg',
      'https://cdn.example.com/2.jpg',
      'https://cdn.example.com/3.jpg',
      'https://cdn.example.com/4.jpg'
    ])
  })

  it('sends a single video reference and lets it win over images', async () => {
    const generateSpatialWorld = vi.fn(async () => ({
      assetId: 'asset-world-3',
      relativePath: 'Cache/Models/world3.glb',
      model: 'marble-1.1'
    }))
    const logs: string[] = []
    const ctx = {
      node: worldNode({ generateInstruction: 'a slow walk through a courtyard' }),
      inputs: {
        ...imageInputs(['https://cdn.example.com/a.jpg', 'https://cdn.example.com/b.jpg']),
        'in-video': [
          {
            kind: 'video',
            id: 'clip-1',
            dataUrl: '',
            relativePath: 'Assets/Clips/courtyard.mp4'
          }
        ]
      },
      generateSpatialWorld,
      log: (message: string) => logs.push(message)
    } as unknown as NodeExecuteContext

    await executeSpatialWorldGenerateNode(ctx)

    // 上游 world_prompt 四选一：给了视频就不再送图片，且视频给的是工程相对路径
    // （由主进程门面上传对象存储换公网 URL）
    expect(generateSpatialWorld.mock.calls[0]![0]).toMatchObject({
      inputReferences: [{ kind: 'video_url', url: 'Assets/Clips/courtyard.mp4' }]
    })
    // 被丢弃的图片不静默：运行日志要说明这次用的是视频
    expect(logs.join('\n')).toContain('ignoring 2 connected image(s)')
  })

  it('passes panoMode and disableRecaption through, defaulting pano to auto', async () => {
    const generateSpatialWorld = vi.fn(async () => ({
      assetId: 'asset-world-5',
      relativePath: 'Cache/Models/world5.glb',
      model: 'marble-1.1'
    }))
    const ctx = {
      node: worldNode({
        generateInstruction: 'a pano of a courtyard',
        spatialWorldPanoMode: 'always',
        spatialWorldDisableRecaption: true
      }),
      inputs: imageInputs(['https://cdn.example.com/pano.jpg']),
      generateSpatialWorld
    } as unknown as NodeExecuteContext

    await executeSpatialWorldGenerateNode(ctx)
    expect(generateSpatialWorld.mock.calls[0]![0]).toMatchObject({
      panoMode: 'always',
      disableRecaption: true
    })

    // 未设置（老工程）→ auto；recaption 保持上游默认（不下发 disable）
    const fresh = {
      node: worldNode({ generateInstruction: 'x' }),
      inputs: imageInputs(['https://cdn.example.com/a.jpg']),
      generateSpatialWorld
    } as unknown as NodeExecuteContext
    await executeSpatialWorldGenerateNode(fresh)
    expect(generateSpatialWorld.mock.calls[1]![0]).toMatchObject({
      panoMode: 'auto',
      disableRecaption: false
    })
  })

  it('records landed extras (splats / pano) on the node and logs their paths', async () => {
    const generateSpatialWorld = vi.fn(async () => ({
      assetId: 'asset-world-6',
      relativePath: 'Cache/Models/world6.glb',
      model: 'marble-1.1',
      extras: [
        { kind: 'splats', relativePath: 'Cache/Models/world6.spz' },
        { kind: 'pano', relativePath: 'Cache/Models/world6.pano.png' },
        // 下载失败的一项没有路径：不该进节点参数
        { kind: 'mesh', relativePath: undefined }
      ]
    }))
    const logs: string[] = []
    const ctx = {
      node: worldNode({ generateInstruction: 'a courtyard' }),
      inputs: {},
      generateSpatialWorld,
      log: (message: string) => logs.push(message)
    } as unknown as NodeExecuteContext

    await executeSpatialWorldGenerateNode(ctx)

    expect(ctx.node.params.spatialWorldExtras).toEqual([
      { kind: 'splats', relativePath: 'Cache/Models/world6.spz' },
      { kind: 'pano', relativePath: 'Cache/Models/world6.pano.png' }
    ])
    const text = logs.join('\n')
    expect(text).toContain('gaussian splats (SPZ) -> Cache/Models/world6.spz')
    expect(text).toContain('360 panorama (PNG) -> Cache/Models/world6.pano.png')
    // 主产物仍是模型画廊里的 GLB
    expect(ctx.node.params.generatedModels).toHaveLength(1)
  })

  it('carries the world id downstream so the export node can use it', async () => {
    const generateSpatialWorld = vi.fn(async () => ({
      assetId: 'asset-world-7',
      relativePath: 'Cache/Models/world7.glb',
      model: 'marble-1.1',
      spatialWorldId: 'w-777'
    }))
    const ctx = {
      node: worldNode({ generateInstruction: 'a courtyard' }),
      inputs: {},
      generateSpatialWorld
    } as unknown as NodeExecuteContext

    const out = await executeSpatialWorldGenerateNode(ctx)

    // 模型值上带 spatialWorldId：下游「空间世界导出」节点靠它调 worlds/{id}:export
    expect(out.out).toMatchObject({ kind: 'asset', spatialWorldId: 'w-777' })
    expect(ctx.node.params.generatedModels?.[0]).toMatchObject({ spatialWorldId: 'w-777' })
  })

  it('accepts a video-only input with no prompt', async () => {
    const generateSpatialWorld = vi.fn(async () => ({
      assetId: 'asset-world-4',
      relativePath: 'Cache/Models/world4.glb',
      model: 'marble-1.1'
    }))
    const ctx = {
      node: worldNode(),
      inputs: {
        'in-video': [
          { kind: 'video', id: 'clip-2', dataUrl: '', relativePath: 'Assets/Clips/only.mp4' }
        ]
      },
      generateSpatialWorld
    } as unknown as NodeExecuteContext

    await executeSpatialWorldGenerateNode(ctx)

    expect(generateSpatialWorld).toHaveBeenCalledTimes(1)
    expect(generateSpatialWorld.mock.calls[0]![0]).toMatchObject({
      prompt: '',
      inputReferences: [{ kind: 'video_url', url: 'Assets/Clips/only.mp4' }]
    })
  })
})

describe('world generation job persistence', () => {
  function makeJob(overrides: Partial<VideoJobRecord> = {}): VideoJobRecord {
    const now = new Date().toISOString()
    return {
      version: 1,
      kind: 'spatialWorld',
      localJobId: 'w-1',
      providerJobId: 'op-1',
      pollingUrl: 'op-1',
      providerInstanceId: 'wl-1',
      model: 'marble-1.1',
      prompt: 'a cozy courtyard',
      status: 'submitted',
      progress: 8,
      source: 'graph',
      createdAt: now,
      submittedAt: now,
      updatedAt: now,
      ...overrides
    }
  }

  it('keeps the world kind and resumes polling from disk', () => {
    const root = mkdtempSync(join(tmpdir(), 'world-job-'))
    mkdirSync(join(root, '.aiartengine', 'video-jobs'), { recursive: true })

    videoJobRepository.write(root, makeJob())
    const active = videoJobRepository.listActive(root)
    expect(active).toHaveLength(1)
    expect(jobKind(active[0])).toBe('spatialWorld')
    expect(active[0].pollingUrl).toBe('op-1')

    videoJobRepository.write(root, {
      ...videoJobRepository.get(root, 'w-1')!,
      status: 'succeeded',
      progress: 100,
      assetId: 'asset-w',
      relativePath: 'Cache/Models/output.glb',
      error: undefined
    })
    expect(videoJobRepository.listActive(root)).toHaveLength(0)
    expect(videoJobRepository.list(root)[0]).toMatchObject({
      kind: 'spatialWorld',
      status: 'succeeded',
      relativePath: 'Cache/Models/output.glb'
    })
  })
})
