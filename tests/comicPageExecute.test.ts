import { describe, expect, it } from 'vitest'
import {
  createComicPage,
  executeComicPageNode,
  serializeComicPage,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'

function comicNode(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'comic-1',
    typeId: 'comic.page',
    category: 'note',
    position: { x: 0, y: 0 },
    params
  } as GraphNode
}

describe('executeComicPageNode', () => {
  it('throws when there are no panels and no incoming images', async () => {
    const ctx = {
      node: comicNode({ comicPage: serializeComicPage(createComicPage()) }),
      inputs: {}
    } as unknown as NodeExecuteContext
    await expect(executeComicPageNode(ctx)).rejects.toThrow('GRAPH_COMIC_PAGE_EMPTY')
  })

  it('fills empty panels from incoming images and commits a composed PNG', async () => {
    const page = createComicPage({
      columns: 2,
      rows: 1,
      panels: [
        {
          id: 'p1',
          row: 0,
          col: 0,
          rowSpan: 1,
          colSpan: 1,
          imageUrl: 'keep.png',
          bubbles: []
        },
        {
          id: 'p2',
          row: 0,
          col: 1,
          rowSpan: 1,
          colSpan: 1,
          bubbles: []
        }
      ]
    })
    const node = comicNode({ comicPage: serializeComicPage(page) })
    let patched: Record<string, unknown> | undefined
    const composedPages: unknown[] = []
    const ctx = {
      node,
      inputs: {
        'in-image': [
          {
            kind: 'images',
            items: [
              { id: 'a', dataUrl: 'data:image/png;base64,aaa', relativePath: 'shots/a.png' },
              { id: 'b', dataUrl: 'data:image/png;base64,bbb', relativePath: 'shots/b.png' }
            ]
          }
        ]
      },
      composeComicPageImage: async (input: { page: { panels: Array<{ id: string; imageUrl?: string }> } }) => {
        composedPages.push(input.page)
        return { dataUrl: 'data:image/png;base64,ccc', width: 1080, height: 1440 }
      },
      patchNode: (patch: { params?: Record<string, unknown> }) => {
        patched = patch.params
        if (patch.params) node.params = { ...node.params, ...patch.params }
      }
    } as unknown as NodeExecuteContext

    const result = await executeComicPageNode(ctx)
    expect(result.out.kind).toBe('image')
    const filled = composedPages[0] as { panels: Array<{ id: string; imageUrl?: string }> }
    expect(filled.panels.find((item) => item.id === 'p1')?.imageUrl).toBe('keep.png')
    expect(filled.panels.find((item) => item.id === 'p2')?.imageUrl).toBe('shots/a.png')
    expect(patched?.previewDataUrl).toBeUndefined()
    expect((patched?.generatedImages as unknown[])?.length).toBe(1)
  })
})
