import { describe, expect, it } from 'vitest'
import { ensureBuiltinNodeTypes } from '../src/shared/graph/builtinState'
import { createDefaultScopedGraph } from '../src/shared/graph/scopes'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  connectShotVideoReference,
  disconnectShotVideoReference,
  findShotWorkflowVideoNode,
  getVideoFrameAssetId,
  listVideoMentionContribution,
  readVideoGenerateParamsFromNode,
  setVideoFrameAsset
} from '../src/shared/graph'

ensureBuiltinNodeTypes()

const IMG = '11111111-1111-4111-8111-111111111111'
const FRAME1 = '22222222-2222-4222-8222-222222222222'
const FRAME2 = '33333333-3333-4333-8333-333333333333'

describe('shotVideoBridge', () => {
  it('finds the processing video node in default shot workflow', () => {
    const graph = createDefaultScopedGraph('shotWorkflow')
    const video = findShotWorkflowVideoNode(graph)
    expect(video?.typeId).toBe('asset.video')
  })

  it('connects references without occupying frame ports or @ slots incorrectly', () => {
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = connectShotVideoReference(graph, {
      id: IMG,
      type: 'image',
      name: 'Ref A'
    })
    graph = setVideoFrameAsset(graph, VIDEO_FIRST_FRAME_PORT_ID, {
      id: FRAME1,
      type: 'image',
      name: 'First'
    })
    const contrib = listVideoMentionContribution(graph)
    expect(contrib.genRefs.map((r) => r.assetId)).toEqual([IMG])
    expect(getVideoFrameAssetId(graph, VIDEO_FIRST_FRAME_PORT_ID)).toBe(FRAME1)
    const video = findShotWorkflowVideoNode(graph)!
    expect(readVideoGenerateParamsFromNode(video.params).frameMode).toBe('first')
  })

  it('sets last frame and upgrades frame mode to first_last', () => {
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = setVideoFrameAsset(graph, VIDEO_FIRST_FRAME_PORT_ID, {
      id: FRAME1,
      type: 'image',
      name: 'First'
    })
    graph = setVideoFrameAsset(graph, VIDEO_LAST_FRAME_PORT_ID, {
      id: FRAME2,
      type: 'image',
      name: 'Last'
    })
    expect(getVideoFrameAssetId(graph, VIDEO_LAST_FRAME_PORT_ID)).toBe(FRAME2)
    const video = findShotWorkflowVideoNode(graph)!
    expect(readVideoGenerateParamsFromNode(video.params).frameMode).toBe('first_last')
  })

  it('disconnects references without removing frame edges', () => {
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = connectShotVideoReference(graph, {
      id: IMG,
      type: 'image',
      name: 'Ref A'
    })
    graph = setVideoFrameAsset(graph, VIDEO_FIRST_FRAME_PORT_ID, {
      id: FRAME1,
      type: 'image',
      name: 'First'
    })
    graph = disconnectShotVideoReference(graph, IMG)
    expect(listVideoMentionContribution(graph).genRefs).toEqual([])
    expect(getVideoFrameAssetId(graph, VIDEO_FIRST_FRAME_PORT_ID)).toBe(FRAME1)
  })

  it('clearing frames reconciles generateFrameMode', () => {
    let graph = createDefaultScopedGraph('shotWorkflow')
    graph = setVideoFrameAsset(graph, VIDEO_FIRST_FRAME_PORT_ID, {
      id: FRAME1,
      type: 'image',
      name: 'First'
    })
    graph = setVideoFrameAsset(graph, VIDEO_FIRST_FRAME_PORT_ID, null)
    const video = findShotWorkflowVideoNode(graph)!
    expect(readVideoGenerateParamsFromNode(video.params).frameMode).toBe('none')
  })
})
