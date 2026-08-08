import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  executeFramePullNode,
  isFramePullNode
} from '../src/shared/graph'
import type { NodeExecuteContext } from '../src/shared/graph'

function makeCtx(params?: Record<string, unknown>): NodeExecuteContext {
  const node = createNodeFromType('video.framePull', { x: 0, y: 0 }, { id: 'pull-1' })
  node.params = { ...node.params, ...(params ?? {}) }
  return {
    node,
    inputs: {},
    document: { nodes: [], edges: [] }
  }
}

describe('video.framePull node', () => {
  it('creates with defaults and is recognized by node role', () => {
    const node = createNodeFromType('video.framePull', { x: 0, y: 0 })
    expect(node.typeId).toBe('video.framePull')
    expect(isFramePullNode(node)).toBe(true)
    expect(node.params.frameNotes).toEqual({})
    expect(node.params.generatedImages ?? []).toEqual([])
  })

  it('emits captured frames as image gallery outputs', () => {
    const ctx = makeCtx({
      generatedImages: [
        { id: 'pull:12:1', dataUrl: 'data:image/png;base64,aaa', createdAt: '2026-08-08' },
        { id: 'pull:30:2', dataUrl: 'data:image/png;base64,bbb', createdAt: '2026-08-08' }
      ],
      selectedImageId: 'pull:12:1'
    })
    const out = executeFramePullNode(ctx)
    expect(out.out?.kind).toBe('image')
    expect(out['out-all']?.kind).toBe('images')
    // 图库语义：执行后强制选中最新一帧
    expect(ctx.node.params.selectedImageId).toBe('pull:30:2')
    const all = out['out-all'] as { items?: Array<{ id?: string }> } | undefined
    expect(all?.items?.map((item) => item.id)).toEqual(['pull:12:1', 'pull:30:2'])
  })

  it('returns an empty image when no frames captured', () => {
    const ctx = makeCtx({})
    const out = executeFramePullNode(ctx)
    expect(out.out?.kind).toBe('image')
    expect(out['out-all']).toBeUndefined()
  })
})
