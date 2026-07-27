import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createNodeFromType,
  executeSelectVoiceNode,
  getNodePorts,
  GraphPortType,
  pickVoiceItem,
  type GraphVoiceItem,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('voice.select node', () => {
  it('has voices in and voice out ports', () => {
    const node = createNodeFromType('voice.select', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.voices],
      ['out', GraphPortType.voice]
    ])
  })

  it('connects from voice generate out-all and to voice generate / output', () => {
    const voiceGenerate = createNodeFromType('asset.voice', { x: 0, y: 0 })
    const select = createNodeFromType('voice.select', { x: 120, y: 0 })
    const nextVoice = createNodeFromType('asset.voice', { x: 240, y: 0 })
    const voiceOut = createNodeFromType('output.voice', { x: 360, y: 0 })
    expect(canConnectNodes(voiceGenerate, select, { sourcePort: 'out-all' })).toBe(true)
    expect(canConnectNodes(voiceGenerate, select, { sourcePort: 'out' })).toBe(false)
    expect(canConnectNodes(select, nextVoice, { targetPort: 'in-image' })).toBe(false)
    expect(canConnectNodes(select, voiceOut)).toBe(true)
  })

  it('defaults to the first voice and can pick by id', () => {
    const items: GraphVoiceItem[] = [
      { id: 'a', relativePath: 'voices/a.wav' },
      { id: 'b', relativePath: 'voices/b.wav' }
    ]
    expect(pickVoiceItem(items)?.id).toBe('a')
    expect(pickVoiceItem(items, 'b')?.id).toBe('b')
  })

  it('execute outputs the selected single voice', () => {
    const node = createNodeFromType('voice.select', { x: 0, y: 0 }, {
      params: { selectedVoiceId: 'b' }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [
          {
            kind: 'voices',
            items: [
              { id: 'a', relativePath: 'voices/a.wav' },
              { id: 'b', relativePath: 'voices/b.wav' }
            ]
          }
        ]
      },
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = executeSelectVoiceNode(ctx)
    expect(result.out).toEqual({
      kind: 'voice',
      id: 'b',
      createdAt: undefined,
      relativePath: 'voices/b.wav'
    })
    expect(patched[0]).toMatchObject({
      selectedVoiceId: 'b',
      previewRelativePath: 'voices/b.wav'
    })
  })
})
