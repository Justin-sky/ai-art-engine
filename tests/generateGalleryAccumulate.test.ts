import { describe, expect, it } from 'vitest'
import {
  executeVideoGenerateNode,
  executeVoiceGenerateNode,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

function baseNode(partial: Partial<GraphNode> & Pick<GraphNode, 'typeId' | 'id'>): GraphNode {
  return {
    category: 'asset',
    position: { x: 0, y: 0 },
    params: {},
    ...partial
  } as GraphNode
}

describe('generate node cumulative galleries', () => {
  it('video generate appends history, outs newest on out and full list on out-all', async () => {
    const node = baseNode({
      id: 'v1',
      typeId: 'asset.video',
      assetType: 'video',
      params: {
        generateInstruction: 'a clip',
        generatedVideos: [{ id: 'old', dataUrl: '', relativePath: 'Output/a.mp4' }],
        selectedVideoId: 'old'
      }
    })
    let patched: Record<string, unknown> | undefined
    const ctx = {
      node,
      inputs: {},
      generateVideo: async () => ({
        assetId: 'new-asset',
        relativePath: 'Output/b.mp4',
        model: 'test'
      }),
      patchNode: (patch: { params?: Record<string, unknown> }) => {
        patched = patch.params
        if (patch.params) node.params = { ...node.params, ...patch.params }
      }
    } as unknown as NodeExecuteContext

    const result = await executeVideoGenerateNode(ctx)
    expect(result.out.kind).toBe('video')
    if (result.out.kind !== 'video') return
    expect(result.out.relativePath).toBe('Output/b.mp4')
    expect(result.out.id).toBe('new-asset')

    const all = result['out-all']
    expect(all?.kind).toBe('videos')
    if (all?.kind !== 'videos') return
    expect(all.items).toHaveLength(2)
    expect(all.items.map((i) => i.relativePath)).toEqual(['Output/a.mp4', 'Output/b.mp4'])
    expect(patched?.selectedVideoId).toBe('new-asset')
    expect((patched?.generatedVideos as unknown[])?.length).toBe(2)
  })

  it('voice generate outs newest voice and cumulative out-all', async () => {
    const node = baseNode({
      id: 'a1',
      typeId: 'asset.voice',
      assetType: 'voice',
      params: {
        generateInstruction: 'hello',
        generatedVoices: [{ id: 'old-v', relativePath: 'Output/a.wav' }],
        selectedVoiceId: 'old-v'
      }
    })
    const ctx = {
      node,
      inputs: {},
      generateSpeech: async () => ({
        assetId: 'new-v',
        relativePath: 'Output/b.wav',
        model: 'test',
        voice: 'v1'
      }),
      patchNode: (patch: { params?: Record<string, unknown> }) => {
        if (patch.params) node.params = { ...node.params, ...patch.params }
      }
    } as unknown as NodeExecuteContext

    const result = await executeVoiceGenerateNode(ctx)
    expect(result.out.kind).toBe('voice')
    if (result.out.kind !== 'voice') return
    expect(result.out.id).toBe('new-v')
    expect(result.out.relativePath).toBe('Output/b.wav')

    const all = result['out-all']
    expect(all?.kind).toBe('voices')
    if (all?.kind !== 'voices') return
    expect(all.items).toHaveLength(2)
    expect(all.items.map((i) => i.relativePath)).toEqual(['Output/a.wav', 'Output/b.wav'])
    expect(node.params.selectedVoiceId).toBe('new-v')
  })
})
