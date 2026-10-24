import { describe, expect, it, vi } from 'vitest'
import {
  GraphPortType,
  createNodeFromType,
  executeCropNode,
  executeEmotionNode,
  executeLightingNode,
  executeMultiAngleNode,
  executePortraitTextureNode,
  getNodePorts,
  probeImageDimensionsFromDataUrl,
  type NodeExecuteContext
} from '../src/shared/graph'

const REF = 'data:image/png;base64,ref'

function imageCtx(
  typeId: 'image.multiAngle' | 'image.lighting' | 'image.portraitTexture' | 'image.emotion',
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

  it('crop node uses multimodal VLM visionGrounding to refine crop rect and recognize sceneName when generateInstruction is set', async () => {
    const node = createNodeFromType('image.process', { x: 0, y: 0 })
    node.title = '第1幕·古画取景（右段）'
    node.params = {
      ...node.params,
      imageProcessTool: 'crop',
      generateInstruction: '多模态识图选区（第1幕·古画右段）：识别16:9焦点选区与四字古风场景名',
      imageCrop: { cropX: 0.66, cropY: 0.06, cropW: 0.34, cropH: 0.88, aspectId: '16:9' }
    }
    const generateText = vi.fn(async () => ({
      text: '{"sceneName":"汴河柳岸","cropX":0.62,"cropY":0.08,"cropW":0.35,"cropH":0.84,"sceneSummary":"北宋汴京城郊柳岸石桥，驮队行旅踏桥而行"}'
    }))
    const composeImageCropCanvas = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,cropped'
    }))
    const patchNode = vi.fn()
    const result = await executeCropNode({
      node,
      inputs: {
        in: [{ kind: 'image', id: 'scroll', dataUrl: REF }]
      },
      generateText,
      composeImageCropCanvas,
      patchNode
    })
    expect(generateText).toHaveBeenCalledTimes(1)
    expect(generateText.mock.calls[0]![0]).toMatchObject({
      images: [REF],
      visionGrounding: true
    })
    expect(composeImageCropCanvas).toHaveBeenCalledWith({
      sourceDataUrl: REF,
      state: expect.objectContaining({
        cropX: 0.62,
        cropY: 0.08,
        cropW: 0.35,
        cropH: 0.84
      })
    })
    expect(node.title).toBe('第1幕 · 汴河柳岸')
    expect(node.params.text).toContain('北宋汴京城郊柳岸石桥')
    expect(result.out?.kind).toBe(GraphPortType.image)
    if (result.out?.kind === 'image') {
      expect(result.out.title).toBe('第1幕 · 汴河柳岸')
    }
  })

  it('probeImageDimensionsFromDataUrl detects ultra-wide PNG scroll header and constrains cropW to avoid wide-strip distortion', async () => {
    // 构造 6000x1000 (6:1 超宽幅手卷) 的最小 PNG IHDR 头
    const pngHeader = Buffer.alloc(32)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(pngHeader, 0)
    pngHeader.writeUInt32BE(13, 8)
    pngHeader.write('IHDR', 12, 'ascii')
    pngHeader.writeUInt32BE(6000, 16)
    pngHeader.writeUInt32BE(1000, 20)
    const ultraWideDataUrl = `data:image/png;base64,${pngHeader.toString('base64')}`

    expect(probeImageDimensionsFromDataUrl(ultraWideDataUrl)).toEqual({
      width: 6000,
      height: 1000
    })

    const node = createNodeFromType('image.process', { x: 0, y: 0 })
    node.title = '第2幕·古画取景（中段）'
    node.params = {
      ...node.params,
      imageProcessTool: 'crop',
      imageCrop: { cropX: 0.34, cropY: 0.1, cropW: 0.32, cropH: 0.8, aspectId: '16:9' }
    }
    // VLM 返回过宽的 cropW=0.46，自适应宽高比约束应将其收敛到 6:1 手卷下合理的 16:9 宽度区间
    const generateText = vi.fn(async () => ({
      text: '{"sceneName":"虹桥争渡","cropX":0.27,"cropY":0.10,"cropW":0.46,"cropH":0.78,"sceneSummary":"汴河虹桥舟楫争渡"}'
    }))
    const composeImageCropCanvas = vi.fn(async () => ({
      dataUrl: 'data:image/png;base64,cropped-ultrawide'
    }))
    await executeCropNode({
      node,
      inputs: {
        in: [{ kind: 'image', id: 'scroll-wide', dataUrl: ultraWideDataUrl }]
      },
      generateText,
      composeImageCropCanvas
    })
    expect(String(generateText.mock.calls[0]![0]?.prompt ?? '')).toContain('6000x1000')
    const passedCrop = composeImageCropCanvas.mock.calls[0]![0]!.state
    // idealW = (0.78 * 16/9) / 6.0 ≈ 0.231, maxW = idealW * 1.35 ≈ 0.312 < 0.46
    expect(passedCrop.cropW).toBeLessThan(0.33)
    expect(passedCrop.cropW).toBeGreaterThan(0.16)
  })
})
