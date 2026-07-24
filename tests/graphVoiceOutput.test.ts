import { describe, expect, it, vi } from 'vitest'
import {
  executeOutputNode,
  executeVoiceGenerateNode,
  flattenVoicesValues,
  type NodeExecuteContext
} from '../src/shared/graph'
import type { GraphNode } from '../src/shared/graph/types'

function baseNode(partial?: Partial<GraphNode>): GraphNode {
  return {
    id: 'audio-gen-1',
    typeId: 'asset.voice',
    category: 'asset',
    title: '声音生成',
    x: 0,
    y: 0,
    w: 160,
    h: 120,
    params: {},
    ...partial
  }
}

describe('audio array IO', () => {
  it('flattens voices / asset / output.voices', () => {
    expect(
      flattenVoicesValues([
        { kind: 'voices', items: [{ id: 'a1', relativePath: 'Assets/a.mp3' }] },
        { kind: 'asset', assetId: 'a2', assetType: 'voice', relativePath: 'Assets/b.mp3' },
        {
          kind: 'output',
          outputKind: 'voice',
          items: [],
          notes: [],
          params: {},
          voices: [{ id: 'a3', relativePath: 'Assets/c.mp3' }]
        }
      ])
    ).toEqual([
      { id: 'a1', relativePath: 'Assets/a.mp3' },
      { id: 'a2', relativePath: 'Assets/b.mp3' },
      { id: 'a3', relativePath: 'Assets/c.mp3' }
    ])
  })

  it('generateSpeech result becomes voices and appends generatedVoices', async () => {
    const node = baseNode({
      params: { generateInstruction: '温柔女声' }
    })
    const patchNode = vi.fn()
    const ctx: NodeExecuteContext = {
      node,
      inputs: {},
      patchNode,
      generateSpeech: async () => ({
        assetId: 'voice-1',
        relativePath: 'Assets/Voice/Audio/voice.mp3',
        model: 'S_xxx',
        voice: 'S_xxx'
      })
    }
    const result = await executeVoiceGenerateNode(ctx)
    expect(result.out).toMatchObject({
      kind: 'voices',
      items: [{ id: 'voice-1', relativePath: 'Assets/Voice/Audio/voice.mp3' }]
    })
    expect(node.params.generatedVoices).toEqual([
      expect.objectContaining({
        id: 'voice-1',
        relativePath: 'Assets/Voice/Audio/voice.mp3'
      })
    ])
    expect(patchNode).toHaveBeenCalled()
  })

  it('audio output returns kind output with voices', () => {
    const node = baseNode({
      id: 'voice-output',
      typeId: 'output.voice',
      category: 'output',
      params: { outputKind: 'voice' }
    })
    const patchNode = vi.fn()
    const result = executeOutputNode({
      node,
      inputs: {
        in: [
          {
            kind: 'voices',
            items: [{ id: 'voice-1', relativePath: 'Assets/Voice/Audio/voice.mp3' }]
          }
        ]
      },
      patchNode
    })
    expect(result.out).toMatchObject({
      kind: 'output',
      outputKind: 'voice',
      voices: [{ id: 'voice-1', relativePath: 'Assets/Voice/Audio/voice.mp3' }],
      params: { previewRelativePath: 'Assets/Voice/Audio/voice.mp3' }
    })
    expect(patchNode).toHaveBeenCalledWith({
      params: { previewRelativePath: 'Assets/Voice/Audio/voice.mp3' }
    })
  })
})
