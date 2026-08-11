import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  executeFrameAnimGenNode,
  resolveGalleryOutputsFromNodeParams,
  type NodeExecuteContext
} from '../src/shared/graph'

describe('frame.animGen gallery selection', () => {
  it('accumulates generated images, defaults out to newest, and switches on selection', async () => {
    const node = createNodeFromType('frame.animGen', { x: 0, y: 0 })
    let run = 0
    const ctx = {
      node,
      inputs: { in: [{ kind: 'image', dataUrl: 'data:image/png;base64,cmVm' }] },
      locale: 'zh-CN',
      signal: undefined,
      generateImage: async () => {
        run += 1
        return { images: [`data:image/png;base64,cnVu${run}`], model: 'm' }
      },
      saveRunMedia: async (opts: { dataUrl: string; key: string }) =>
        `Cache/Images/${opts.key}.png`,
      resolveGenerateSeed: () => 1,
      resolveHostAssetName: () => 'host',
      patchNode: (patch: { params: Record<string, unknown> }) => {
        node.params = { ...node.params, ...patch.params }
      }
    } as unknown as NodeExecuteContext

    await executeFrameAnimGenNode(ctx)
    const firstId = (node.params.generatedImages as Array<{ id: string }>)[0]?.id
    expect(firstId).toBeTruthy()

    await executeFrameAnimGenNode(ctx)
    const list = node.params.generatedImages as Array<{ id: string }>
    expect(list.length).toBe(2)

    // 默认输出最新一张
    const out1 = resolveGalleryOutputsFromNodeParams(node.params, {
      typeId: 'frame.animGen'
    }) as { out?: { id?: string } }
    expect(out1?.out?.id).toBe(list[1]?.id)

    // 选择第一张 → out 切换
    node.params.selectedImageId = firstId
    const out2 = resolveGalleryOutputsFromNodeParams(node.params, {
      typeId: 'frame.animGen'
    }) as { out?: { id?: string } }
    expect(out2?.out?.id).toBe(firstId)
  })
})
