import { describe, expect, it, vi } from 'vitest'
import {
  GraphPortType,
  createNodeFromType,
  executeEmotionNode,
  executeLightingNode,
  executeMultiAngleNode,
  executePortraitTextureNode,
  getNodePorts,
  type NodeExecuteContext
} from '../src/shared/graph'

const REF = 'data:image/png;base64,ref'

function imageCtx(
  typeId:
    | 'image.multiAngle'
    | 'image.lighting'
    | 'image.portraitTexture'
    | 'image.emotion',
  generateImage?: NodeExecuteContext['generateImage']
): NodeExecuteContext {
  const node = createNodeFromType(typeId, { x: 0, y: 0 })
  return {
    node,
    inputs: {
      in: [{ kind: 'image', id: 'src', dataUrl: REF }]
    },
    generateImage
  }
}

describe('prompt image edit nodes', () => {
  for (const typeId of [
    'image.multiAngle',
    'image.lighting',
    'image.portraitTexture',
    'image.emotion'
  ] as const) {
    it(`${typeId} exposes gallery image outs`, () => {
      const node = createNodeFromType(typeId, { x: 0, y: 0 })
      expect(getNodePorts(node).map((p) => `${p.id}:${p.dataType}`)).toEqual([
        'in:image',
        'out:image',
        'out-all:images'
      ])
      expect(node.assetType).toBe('image')
    })
  }

  it('lighting calls generateImage with system + user prompt and reference', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,out']
    }))
    const ctx = imageCtx('image.lighting', generateImage)
    ctx.locale = 'zh-CN'
    const result = await executeLightingNode(ctx)
    expect(generateImage).toHaveBeenCalledTimes(1)
    const args = generateImage.mock.calls[0]![0]!
    expect(args.inputReferences).toEqual([REF])
    expect(String(args.prompt || '')).toContain('打光')
    expect(String(args.prompt || '')).toContain('\n\n')
    expect(result.out?.kind).toBe(GraphPortType.image)
    expect(result['out-all']?.kind).toBe(GraphPortType.images)
  })

  it('multiAngle / portrait / emotion call generateImage', async () => {
    const generateImage = vi.fn(async () => ({
      images: ['data:image/png;base64,out']
    }))
    await executeMultiAngleNode(imageCtx('image.multiAngle', generateImage))
    await executePortraitTextureNode(imageCtx('image.portraitTexture', generateImage))
    await executeEmotionNode(imageCtx('image.emotion', generateImage))
    expect(generateImage).toHaveBeenCalledTimes(3)
  })

  it('passthrough when generateImage missing', async () => {
    const result = await executeLightingNode(imageCtx('image.lighting'))
    expect(result.out?.kind).toBe(GraphPortType.image)
    if (result.out?.kind === 'image') {
      expect(result.out.dataUrl).toBe(REF)
    }
  })
})
