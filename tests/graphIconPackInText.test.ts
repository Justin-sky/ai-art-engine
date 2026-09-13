import { describe, expect, it } from 'vitest'
import { createNodeFromType, runGraph } from '../src/shared/graph'

describe('image.iconPack 多口输入取值', () => {
  it('in 口有图片时仍能从 in-text 口收集名单（不早退只读 in）', async () => {
    const names = createNodeFromType(
      'play.script',
      { x: 0, y: 0 },
      { id: 'names', params: { text: '火焰斩\n冰霜护盾\n雷击\n治疗术' } }
    )
    const sheet = createNodeFromType(
      'asset.image',
      { x: 200, y: 0 },
      { id: 'sheet', title: '整版' }
    )
    const pack = createNodeFromType(
      'image.iconPack',
      { x: 400, y: 0 },
      {
        id: 'pack',
        params: {
          iconPack: {
            rows: 3,
            cols: 3,
            edgeInset: 'auto',
            keyColor: 'auto',
            distance: 40,
            feather: 34,
            canvasSize: 0
          }
        }
      }
    )
    const captured: { names?: string[]; url?: string } = {}

    const result = await runGraph(
      {
        nodes: [names, sheet, pack],
        edges: [
          { id: 'e1', source: names.id, target: pack.id, sourcePort: 'out', targetPort: 'in-text' },
          { id: 'e2', source: sheet.id, target: pack.id, sourcePort: 'out', targetPort: 'in' }
        ],
        viewport: { x: 0, y: 0, zoom: 1 }
      },
      {
        stepDelayMs: 1,
        targetNodeId: pack.id,
        onlyTargetNode: true,
        priorNodeStates: {
          [sheet.id]: {
            status: 'done',
            outputs: {
              out: {
                kind: 'image',
                id: 'sheet-out',
                dataUrl: 'data:image/png;base64,AAAA',
                createdAt: '2026-09-09T00:00:00.000Z',
                relativePath: ''
              }
            }
          }
        },
        resolveImageUrls: async (items: Array<{ dataUrl?: string }>) =>
          items.map((item) => item.dataUrl ?? ''),
        composeImageIconPackSheet: async (arg: { sourceDataUrl: string; names: string[] }) => {
          captured.names = arg.names
          captured.url = arg.sourceDataUrl
          return { items: [], canvasSize: 1024, background: { r: 255, g: 255, b: 255 } }
        }
      } as never
    )

    expect(result.ok, result.error).toBe(true)
    expect(captured.url).toBe('data:image/png;base64,AAAA')
    expect(captured.names).toEqual(['火焰斩', '冰霜护盾', '雷击', '治疗术'])
  })
})
