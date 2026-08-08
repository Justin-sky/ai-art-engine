import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType, executeVideoReshootNode, getNodePorts } from '../src/shared/graph'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & {
    inputs?: NodeExecuteContext['inputs']
    generateVideo?: NodeExecuteContext['generateVideo']
  } = {}
): NodeExecuteContext {
  const node = createNodeFromType('video.reshoot', { x: 0, y: 0 })
  node.params = {
    ...node.params,
    reshootStartSec: 5,
    reshootEndSec: 9,
    generateInstruction: '将人物手中的黑色雨伞改成透明雨伞'
  }
  return {
    node,
    doc: { nodes: [node], edges: [], groups: [] },
    inputs: overrides.inputs ?? {},
    locale: 'zh-CN',
    generateVideo: overrides.generateVideo,
    resolveImageUrls: async (items) =>
      items.map((item) => item.dataUrl?.trim() || '').filter(Boolean),
    ...overrides
  }
}

describe('video.reshoot node', () => {
  it('registers ports for source video + references → video (+ out-all)', () => {
    const node = createNodeFromType('video.reshoot', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.map((p) => p.id).sort()).toEqual(
      ['in-image', 'in-text', 'in-voice', 'in-video', 'out', 'out-all'].sort()
    )
    expect(node.params.reshootStartSec).toBe(0)
    expect(node.params.reshootEndSec).toBe(0)
    expect(node.params.generateAudio).toBe(true)
  })

  it('requires a source video input', async () => {
    await expect(
      executeVideoReshootNode(
        baseCtx({
          inputs: {
            'in-image': [
              {
                kind: 'image',
                dataUrl: 'data:image/png;base64,aaa',
                createdAt: new Date().toISOString()
              }
            ]
          },
          generateVideo: vi.fn()
        })
      )
    ).rejects.toThrow('GRAPH_RESHOOT_NO_VIDEO')
  })

  it('submits source video first, then references, with timestamped prompt', async () => {
    const generateVideo = vi.fn(async () => ({
      assetId: 'v1',
      relativePath: 'Assets/out.mp4',
      model: 'seedance-2.5'
    }))
    const out = await executeVideoReshootNode(
      baseCtx({
        inputs: {
          'in-video': [
            {
              kind: 'video',
              relativePath: 'Assets/clip.mp4'
            }
          ],
          'in-image': [
            {
              kind: 'image',
              dataUrl: 'data:image/png;base64,aaa',
              createdAt: new Date().toISOString()
            }
          ],
          'in-voice': [
            {
              kind: 'asset',
              assetId: 't1',
              assetType: 'voice',
              relativePath: 'Assets/voice.mp3'
            }
          ]
        },
        resolveAssetMediaUrl: async () => 'https://cdn.example.com/voice.mp3',
        generateVideo
      })
    )

    expect(generateVideo).toHaveBeenCalledTimes(1)
    const arg = generateVideo.mock.calls[0]![0]
    expect(arg.inputReferences).toEqual([
      { kind: 'video_url', url: 'Assets/clip.mp4' },
      { kind: 'image_url', url: 'data:image/png;base64,aaa' },
      { kind: 'audio_url', url: 'https://cdn.example.com/voice.mp3' }
    ])
    expect(arg.generateAudio).toBe(true)
    expect(String(arg.prompt)).toContain('00:05—00:09')
    expect(String(arg.prompt)).toContain('黑色雨伞改成透明雨伞')
    expect(String(arg.prompt)).toContain('其余片段保持与原视频完全一致')
    expect(out.out).toMatchObject({
      kind: 'video',
      id: 'v1',
      relativePath: 'Assets/out.mp4'
    })
    expect(out['out-all']).toMatchObject({
      kind: 'videos',
      items: [{ id: 'v1', relativePath: 'Assets/out.mp4' }]
    })
  })

  it('falls back to non-timestamp prompt when segment is missing', async () => {
    const generateVideo = vi.fn(async () => ({
      assetId: 'v2',
      relativePath: 'Assets/out2.mp4',
      model: 'seedance-2.5'
    }))
    const ctx = baseCtx({
      inputs: {
        'in-video': [
          {
            kind: 'video',
            relativePath: 'Assets/clip.mp4'
          }
        ]
      },
      generateVideo
    })
    ctx.node.params = { ...ctx.node.params, reshootStartSec: 0, reshootEndSec: 0 }
    await executeVideoReshootNode(ctx)

    const arg = generateVideo.mock.calls[0]![0]
    expect(String(arg.prompt)).toContain('黑色雨伞改成透明雨伞')
    expect(String(arg.prompt)).not.toContain('00:05')
  })

  it('requires a video API when no generateVideo is available', async () => {
    await expect(
      executeVideoReshootNode(
        baseCtx({
          inputs: {
            'in-video': [
              {
                kind: 'video',
                relativePath: 'Assets/clip.mp4'
              }
            ]
          }
        })
      )
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })
})
