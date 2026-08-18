import { describe, expect, it, vi } from 'vitest'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  availableVideoFrameModes,
  clampVideoFrameMode,
  clampVideoGenerateParams,
  parseVideoGenerateParamCapabilities,
  readVideoGenerateParamsFromNode,
  videoGenerateParamsToNodePatch
} from '../src/shared/graph/videoGenerateParams'
import { getNodePortCenter } from '../src/shared/graph/create'
import {
  allowedVideoFramePortIds,
  getNodePorts,
  pruneVideoFrameEdges,
  resolveTypeDefPorts
} from '../src/shared/graph/ports'
import { resolveNodeType } from '../src/shared/graph/registry'
import '../src/shared/graph/builtins'
import type { GraphEdge, GraphNode } from '../src/shared/graph'
import {
  buildFrameIncomingEdgeRefs,
  buildIncomingEdgeRefs
} from '../src/renderer/src/features/graph/model/graphEditorHosts'
import { executeVideoGenerateNode } from '../src/shared/graph/execute'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'

describe('video frame mode clamp', () => {
  it('lists modes from supported_frame_images', () => {
    expect(availableVideoFrameModes(['first_frame', 'last_frame'])).toEqual([
      'none',
      'first',
      'first_last'
    ])
    expect(availableVideoFrameModes(['first_frame'])).toEqual(['none', 'first'])
    expect(availableVideoFrameModes([])).toEqual(['none'])
  })

  it('clamps unsupported first_last down to first when possible', () => {
    expect(clampVideoFrameMode('first_last', ['first_frame'])).toBe('first')
    expect(clampVideoFrameMode('first', ['first_frame'])).toBe('first')
    expect(clampVideoFrameMode('first_last', [])).toBe('none')
  })

  it('persists frameMode through node patch helpers', () => {
    const caps = parseVideoGenerateParamCapabilities({
      supported_frame_images: ['first_frame', 'last_frame'],
      supported_resolutions: ['720p']
    })
    const clamped = clampVideoGenerateParams(
      { frameMode: 'first_last', resolution: '720p' },
      caps
    )
    expect(clamped.frameMode).toBe('first_last')
    const patch = videoGenerateParamsToNodePatch(clamped)
    expect(patch.generateFrameMode).toBe('first_last')
    expect(readVideoGenerateParamsFromNode(patch).frameMode).toBe('first_last')
  })
})

describe('video frame ports', () => {
  function videoNode(frameMode: 'none' | 'first' | 'first_last'): GraphNode {
    return {
      id: 'v1',
      typeId: 'asset.video',
      category: 'asset',
      assetType: 'video',
      position: { x: 0, y: 0 },
      size: { w: 220, h: 180 },
      params: { generateFrameMode: frameMode }
    }
  }

  it('injects first/last ports and renames reference image', () => {
    const def = resolveNodeType(videoNode('first_last'))!
    const ports = resolveTypeDefPorts(def, videoNode('first_last').params, videoNode('first_last'))
    const ids = ports.filter((p) => p.direction === 'in').map((p) => p.id)
    expect(ids).toEqual([
      'in-text',
      VIDEO_FIRST_FRAME_PORT_ID,
      VIDEO_LAST_FRAME_PORT_ID,
      'in-image',
      'in-video',
      'in-voice'
    ])
    expect(ports.find((p) => p.id === 'in-image')?.label).toBe('Reference')
    expect(ports.find((p) => p.id === VIDEO_FIRST_FRAME_PORT_ID)?.multiple).toBe(false)
  })

  it('getNodePorts follows generateFrameMode', () => {
    expect(
      getNodePorts(videoNode('first'))
        .filter((p) => p.direction === 'in')
        .map((p) => p.id)
    ).toContain(VIDEO_FIRST_FRAME_PORT_ID)
    expect(
      getNodePorts(videoNode('none'))
        .filter((p) => p.direction === 'in')
        .map((p) => p.id)
    ).not.toContain(VIDEO_FIRST_FRAME_PORT_ID)
  })

  it('getNodePortCenter aligns with dynamic in ports (not static typeDef)', () => {
    const node = videoNode('first')
    const ports = getNodePorts(node).filter((p) => p.direction === 'in')
    const firstIdx = ports.findIndex((p) => p.id === VIDEO_FIRST_FRAME_PORT_ID)
    const imageIdx = ports.findIndex((p) => p.id === 'in-image')
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(imageIdx).toBeGreaterThan(firstIdx)

    const firstY = getNodePortCenter(node, 'left', VIDEO_FIRST_FRAME_PORT_ID).y
    const imageY = getNodePortCenter(node, 'left', 'in-image').y
    expect(imageY).toBeGreaterThan(firstY)
    // 端口在标题栏下方 body 区排布，首口 y 应大于标题栏高度
    expect(firstY).toBeGreaterThan(node.position.y + 30)
  })

  it('prunes stale frame edges when mode narrows', () => {
    const edges: GraphEdge[] = [
      {
        id: 'ff',
        source: 'a',
        target: 'v1',
        sourcePort: 'out',
        targetPort: VIDEO_FIRST_FRAME_PORT_ID
      },
      {
        id: 'lf',
        source: 'b',
        target: 'v1',
        sourcePort: 'out',
        targetPort: VIDEO_LAST_FRAME_PORT_ID
      },
      { id: 'ref', source: 'c', target: 'v1', sourcePort: 'out', targetPort: 'in-image' }
    ]
    expect(allowedVideoFramePortIds('first')).toEqual([VIDEO_FIRST_FRAME_PORT_ID])
    expect(pruneVideoFrameEdges(edges, 'v1', 'first').map((e) => e.id)).toEqual(['ff', 'ref'])
    expect(pruneVideoFrameEdges(edges, 'v1', 'none').map((e) => e.id)).toEqual(['ref'])
  })
})

describe('mention index excludes frame ports', () => {
  const edges: GraphEdge[] = [
    {
      id: 'ff',
      source: 'a',
      target: 'v1',
      sourcePort: 'out',
      targetPort: VIDEO_FIRST_FRAME_PORT_ID
    },
    { id: 'ref1', source: 'b', target: 'v1', sourcePort: 'out', targetPort: 'in-image' },
    {
      id: 'lf',
      source: 'c',
      target: 'v1',
      sourcePort: 'out',
      targetPort: VIDEO_LAST_FRAME_PORT_ID
    },
    { id: 'ref2', source: 'd', target: 'v1', sourcePort: 'out', targetPort: 'in-text' }
  ]

  it('buildIncomingEdgeRefs can exclude frame ports from @ numbering', () => {
    const refs = buildIncomingEdgeRefs(edges, 'v1', undefined, { excludeFramePorts: true })
    expect(refs.map((r) => ({ id: r.edgeId, index: r.index }))).toEqual([
      { id: 'ref1', index: 1 },
      { id: 'ref2', index: 2 }
    ])
  })

  it('buildFrameIncomingEdgeRefs returns first then last', () => {
    const refs = buildFrameIncomingEdgeRefs(edges, 'v1')
    expect(refs.map((r) => r.edgeId)).toEqual(['ff', 'lf'])
    expect(refs.every((r) => r.index === 0)).toBe(true)
  })
})

describe('executeVideoGenerateNode frame mapping', () => {
  it('maps frame ports to first/last URLs and drops image refs when last frame set', async () => {
    const generateVideo = vi.fn(async () => ({
      assetId: 'out-vid',
      relativePath: 'videos/x.mp4',
      model: 'm'
    }))
    const ctx: NodeExecuteContext = {
      node: {
        id: 'v1',
        typeId: 'asset.video',
        category: 'asset',
        assetType: 'video',
        position: { x: 0, y: 0 },
        params: {
          generateInstruction: '运镜推进',
          generateFrameMode: 'first_last',
          generateModel: 'm',
          generateProviderInstanceId: 'p1'
        }
      },
      inputs: {
        [VIDEO_FIRST_FRAME_PORT_ID]: [
          { kind: 'image', dataUrl: 'data:image/png;base64,first' }
        ],
        [VIDEO_LAST_FRAME_PORT_ID]: [
          { kind: 'image', dataUrl: 'data:image/png;base64,last' }
        ],
        'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,ref' }]
      },
      incomingByIndex: [
        { index: 1, value: { kind: 'image', dataUrl: 'data:image/png;base64,ref' } }
      ],
      generateVideo,
      resolveImageUrls: async (items) =>
        items.map((item) => ('dataUrl' in item ? item.dataUrl ?? '' : '')).filter(Boolean)
    }

    await executeVideoGenerateNode(ctx)
    expect(generateVideo).toHaveBeenCalledTimes(1)
    const arg = generateVideo.mock.calls[0]![0]
    expect(arg.firstFrameImageUrl).toBe('data:image/png;base64,first')
    expect(arg.lastFrameImageUrl).toBe('data:image/png;base64,last')
    // 尾帧模式不可混参考图
    expect(arg.inputReferences).toBeUndefined()
  })
})
