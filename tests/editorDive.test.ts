import { describe, expect, it, vi } from 'vitest'
import {
  editorDiveAssetFrameKey,
  editorDiveRootKey,
  editorDiveViewFrameKey,
  isEditorDiveAssetFrame,
  isEditorDiveViewFrame,
  type EditorDiveFrame,
  type EditorDiveViewMeta
} from '../src/renderer/src/features/graph/model/editorDive'
import { editorDiveFlush } from '../src/renderer/src/features/graph/model/editorDiveFlush'

describe('editorDive keys', () => {
  it('builds stable root / asset keys', () => {
    expect(editorDiveRootKey('canvas', 'abc')).toBe('canvas-editor-abc')
    expect(editorDiveAssetFrameKey('canvas', 'abc')).toBe('asset:canvas:abc')
    expect(editorDiveAssetFrameKey('world', ' w ')).toBe('asset:world:w')
  })

  it('builds stable view keys', () => {
    const meta: EditorDiveViewMeta = {
      viewId: 'script.timeline',
      scriptAssetId: 'script-1'
    }
    const a = editorDiveViewFrameKey('canvas-editor-c', meta)
    const b = editorDiveViewFrameKey('canvas-editor-c', meta)
    expect(a).toBe(b)
    expect(a).toContain('script.timeline')
    expect(a).toContain('script-1')
  })

  it('includes host/node for node tools and media identity for preview', () => {
    const tool = editorDiveViewFrameKey('script-editor-x', {
      viewId: 'node.multiAngle',
      hostId: 'asset:x',
      nodeId: 'n1'
    })
    expect(tool).toContain('node.multiAngle')
    expect(tool).toContain('asset:x')
    expect(tool).toContain('n1')

    const preview = editorDiveViewFrameKey('script-editor-x', {
      viewId: 'media.preview',
      mediaKind: 'image',
      url: 'data:image/png;base64,xx',
      relativePath: 'Cache/a.png'
    })
    expect(preview).toContain('media.preview')
    expect(preview).toContain('Cache/a.png')
  })

  it('narrows frame types', () => {
    const asset: EditorDiveFrame = {
      type: 'asset',
      key: 'asset:canvas:a',
      assetId: 'a',
      kind: 'canvas',
      title: 'A'
    }
    const view: EditorDiveFrame = {
      type: 'view',
      key: 'k',
      viewId: 'script.timeline',
      title: 'Table',
      meta: { viewId: 'script.timeline', scriptAssetId: 'a' }
    }
    expect(isEditorDiveAssetFrame(asset)).toBe(true)
    expect(isEditorDiveViewFrame(asset)).toBe(false)
    expect(isEditorDiveViewFrame(view)).toBe(true)
    expect(isEditorDiveAssetFrame(view)).toBe(false)
  })
})

describe('editorDiveFlush', () => {
  it('invokes registered flush by frame key', async () => {
    const flush = vi.fn(async () => undefined)
    const unregister = editorDiveFlush.register('frame:a', { flush })
    await editorDiveFlush.flush('frame:a')
    expect(flush).toHaveBeenCalledTimes(1)
    unregister()
    await editorDiveFlush.flush('frame:a')
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('swallows flush errors', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const unregister = editorDiveFlush.register('frame:err', {
      flush: () => {
        throw new Error('boom')
      }
    })
    await expect(editorDiveFlush.flush('frame:err')).resolves.toBeUndefined()
    unregister()
    spy.mockRestore()
  })
})

describe('dive stack semantics (pure)', () => {
  function pushUnique(stack: EditorDiveFrame[], frame: EditorDiveFrame): EditorDiveFrame[] {
    const top = stack[stack.length - 1]
    if (top?.key === frame.key) return stack
    return [...stack, frame]
  }

  function popTo(stack: EditorDiveFrame[], index: number): EditorDiveFrame[] {
    if (!stack.length) return stack
    if (index >= stack.length - 1) return stack
    return index < 0 ? [] : stack.slice(0, index + 1)
  }

  it('does not duplicate same key on top', () => {
    const a: EditorDiveFrame = {
      type: 'view',
      key: 'v1',
      viewId: 'script.timeline',
      title: 'T',
      meta: { viewId: 'script.timeline', scriptAssetId: 's' }
    }
    const stack = pushUnique(pushUnique([], a), a)
    expect(stack).toHaveLength(1)
  })

  it('supports nested asset then view then pop', () => {
    const asset: EditorDiveFrame = {
      type: 'asset',
      key: 'asset:canvas:child',
      assetId: 'child',
      kind: 'canvas',
      title: 'Child'
    }
    const view: EditorDiveFrame = {
      type: 'view',
      key: 'view:table',
      viewId: 'script.timeline',
      title: 'Table',
      meta: { viewId: 'script.timeline', scriptAssetId: 'child' }
    }
    let stack = pushUnique([], asset)
    stack = pushUnique(stack, view)
    expect(stack.map((f) => f.key)).toEqual(['asset:canvas:child', 'view:table'])
    stack = popTo(stack, 0)
    expect(stack.map((f) => f.key)).toEqual(['asset:canvas:child'])
    stack = popTo(stack, -1)
    expect(stack).toEqual([])
  })
})
