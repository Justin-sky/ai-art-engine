import { describe, expect, it } from 'vitest'
import {
  canConnectNodes,
  createNodeFromType,
  executeSelectVideoNode,
  getNodePorts,
  GraphPortType,
  pickVideoItem,
  type GraphVideoItem,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('video.select node', () => {
  it('has videos in and video out ports', () => {
    const node = createNodeFromType('video.select', { x: 0, y: 0 })
    const ports = getNodePorts(node)
    expect(ports.map((p) => [p.direction, p.dataType])).toEqual([
      ['in', GraphPortType.videos],
      ['out', GraphPortType.video]
    ])
  })

  it('connects from video generate out-all and to video generate in-video', () => {
    const videoGenerate = createNodeFromType('asset.video', { x: 0, y: 0 })
    const select = createNodeFromType('video.select', { x: 120, y: 0 })
    const nextVideo = createNodeFromType('asset.video', { x: 240, y: 0 })
    expect(canConnectNodes(videoGenerate, select, { sourcePort: 'out-all' })).toBe(true)
    expect(canConnectNodes(videoGenerate, select, { sourcePort: 'out' })).toBe(false)
    expect(canConnectNodes(select, nextVideo, { targetPort: 'in-video' })).toBe(true)
  })

  it('defaults to the first video and can pick by id', () => {
    const items: GraphVideoItem[] = [
      { id: 'a', relativePath: 'videos/a.mp4' },
      { id: 'b', relativePath: 'videos/b.mp4' }
    ]
    expect(pickVideoItem(items)?.id).toBe('a')
    expect(pickVideoItem(items, 'b')?.id).toBe('b')
  })

  it('execute outputs the selected single video', () => {
    const node = createNodeFromType('video.select', { x: 0, y: 0 }, {
      params: { selectedVideoId: 'b' }
    })
    const patched: Record<string, unknown>[] = []
    const ctx: NodeExecuteContext = {
      node,
      inputs: {
        in: [
          {
            kind: 'videos',
            items: [
              { id: 'a', relativePath: 'videos/a.mp4' },
              { id: 'b', relativePath: 'videos/b.mp4' }
            ]
          }
        ]
      },
      patchNode: (patch) => {
        patched.push(patch.params ?? {})
      }
    }
    const result = executeSelectVideoNode(ctx)
    expect(result.out).toEqual({
      kind: 'video',
      id: 'b',
      createdAt: undefined,
      relativePath: 'videos/b.mp4'
    })
    expect(patched[0]).toMatchObject({
      selectedVideoId: 'b',
      previewRelativePath: 'videos/b.mp4'
    })
  })
})
