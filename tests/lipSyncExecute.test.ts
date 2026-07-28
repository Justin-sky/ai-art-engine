import { describe, expect, it, vi } from 'vitest'
import { createNodeFromType, executeLipSyncNode, getNodePorts } from '../src/shared/graph'
import type { NodeExecuteContext } from '../src/shared/graph/execute/types'

function baseCtx(
  overrides: Partial<NodeExecuteContext> & {
    inputs?: NodeExecuteContext['inputs']
    generateVideo?: NodeExecuteContext['generateVideo']
  } = {}
): NodeExecuteContext {
  const node = createNodeFromType('video.lipSync', { x: 0, y: 0 })
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

describe('video.lipSync node', () => {
  it('registers ports for image/video + audio + text → video (+ out-all)', () => {
    const node = createNodeFromType('video.lipSync', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.map((p) => p.id).sort()).toEqual(
      ['in-image', 'in-text', 'in-voice', 'in-video', 'out', 'out-all'].sort()
    )
    expect(node.params.generateAudio).toBe(true)
    expect(node.params.generateFrameMode).toBe('none')
  })

  it('requires image or video input', async () => {
    await expect(
      executeLipSyncNode(
        baseCtx({
          inputs: {
            'in-voice': [
              {
                kind: 'asset',
                assetId: 'a1',
                assetType: 'voice',
                relativePath: 'Assets/a.mp3'
              }
            ]
          },
          resolveAssetMediaUrl: async () => 'https://cdn.example.com/a.mp3',
          generateVideo: vi.fn()
        })
      )
    ).rejects.toThrow('GRAPH_LIPSYNC_NO_VISUAL')
  })

  it('requires audio input', async () => {
    await expect(
      executeLipSyncNode(
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
    ).rejects.toThrow('GRAPH_LIPSYNC_NO_AUDIO')
  })

  it('submits image_url + audio_url with lip-sync prompt', async () => {
    const generateVideo = vi.fn(async () => ({
      assetId: 'v1',
      relativePath: 'Assets/out.mp4',
      model: 'seedance-2'
    }))
    const out = await executeLipSyncNode(
      baseCtx({
        inputs: {
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
      { kind: 'image_url', url: 'data:image/png;base64,aaa' },
      { kind: 'audio_url', url: 'https://cdn.example.com/voice.mp3' }
    ])
    expect(arg.generateAudio).toBe(true)
    expect(String(arg.prompt)).toContain('图片1')
    expect(String(arg.prompt)).toContain('音频1')
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

  it('prefers video_url over image when both are connected', async () => {
    const generateVideo = vi.fn(async () => ({
      assetId: 'v2',
      relativePath: 'Assets/out2.mp4',
      model: 'seedance-2'
    }))
    await executeLipSyncNode(
      baseCtx({
        inputs: {
          'in-image': [
            {
              kind: 'image',
              dataUrl: 'data:image/png;base64,aaa',
              createdAt: new Date().toISOString()
            }
          ],
          'in-video': [
            {
              kind: 'video',
              relativePath: 'Assets/clip.mp4'
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

    const arg = generateVideo.mock.calls[0]![0]
    expect(arg.inputReferences).toEqual([
      { kind: 'video_url', url: 'Assets/clip.mp4' },
      { kind: 'audio_url', url: 'https://cdn.example.com/voice.mp3' }
    ])
    expect(String(arg.prompt)).toContain('视频1')
    expect(String(arg.prompt)).toContain('音频1')
    expect(String(arg.prompt)).not.toContain('图片1中的角色')
  })
})
