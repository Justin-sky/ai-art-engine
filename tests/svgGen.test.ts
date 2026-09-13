import { describe, expect, it } from 'vitest'
import {
  createNodeFromType,
  encodeSvgDataUrl,
  executeSvgGenNode,
  extractSvgMarkup,
  getNodePorts,
  GRAPH_OUT_ALL_PORT_ID,
  GraphPortType,
  normalizeSvgGenState,
  portsCompatible,
  svgGenToNodePatch,
  toPluralGraphPortDataType,
  toSingularGraphPortDataType,
  type NodeExecuteContext
} from '../src/shared/graph'

const SAMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="16" fill="#f60"/></svg>'

function createCtx(
  node: ReturnType<typeof createNodeFromType>,
  overrides: Record<string, unknown> = {}
): NodeExecuteContext {
  return {
    node,
    inputs: {},
    locale: 'zh-CN',
    resolveHostAssetName: () => 'host',
    patchNode: (patch: { params: Record<string, unknown> }) => {
      node.params = { ...node.params, ...patch.params }
    },
    ...overrides
  } as unknown as NodeExecuteContext
}

describe('extractSvgMarkup', () => {
  it('从 markdown 围栏与前后说明里抽出根标记', () => {
    expect(extractSvgMarkup(`好的，如下：\n\`\`\`svg\n${SAMPLE_SVG}\n\`\`\`\n希望有帮助`)).toBe(
      SAMPLE_SVG
    )
    expect(extractSvgMarkup(`前言 <svg><rect/></svg> 后记`)).toBe('<svg><rect/></svg>')
  })

  it('没有 svg 标记时返回空串', () => {
    expect(extractSvgMarkup('这里没有矢量图')).toBe('')
    expect(extractSvgMarkup('')).toBe('')
  })
})

describe('svg 端口类型', () => {
  it('单复数互转', () => {
    expect(toPluralGraphPortDataType(GraphPortType.svg)).toBe(GraphPortType.svgs)
    expect(toSingularGraphPortDataType(GraphPortType.svgs)).toBe(GraphPortType.svg)
  })

  it('image 口可接入 svg 口（图库 SVG 资产兼容），反向不放行', () => {
    expect(portsCompatible(GraphPortType.svg, GraphPortType.svg)).toBe(true)
    expect(portsCompatible(GraphPortType.image, GraphPortType.svg)).toBe(true)
    expect(portsCompatible(GraphPortType.svg, GraphPortType.image)).toBe(false)
  })
})

describe('svg.gen 参考图输入', () => {
  it('节点带 in-image 图片输入口', () => {
    const node = createNodeFromType('svg.gen', { x: 0, y: 0 })
    const inPorts = getNodePorts(node).filter((port) => port.direction === 'in')
    expect(inPorts.map((port) => [port.id, port.dataType])).toEqual([
      ['in', GraphPortType.text],
      ['in-image', GraphPortType.image]
    ])
  })

  it('接入参考图时解析成多模态 images 并追加参考图说明', async () => {
    const node = createNodeFromType('svg.gen', { x: 0, y: 0 })
    node.params.generateInstruction = '把参考图转成扁平矢量图标'
    const calls: Array<{ prompt: string; images?: string[] }> = []
    const ctx = createCtx(node, {
      inputs: {
        'in-image': [{ kind: 'image', dataUrl: 'data:image/png;base64,AAA' }]
      },
      resolveImageUrls: async () => ['data:image/png;base64,RESOLVED'],
      generateText: async (input: { prompt: string; images?: string[] }) => {
        calls.push({ prompt: input.prompt, images: input.images })
        return { text: SAMPLE_SVG, model: 'm' }
      }
    })

    const outputs = await executeSvgGenNode(ctx)
    expect(calls[0]?.images).toEqual(['data:image/png;base64,RESOLVED'])
    expect(calls[0]?.prompt).toContain('参考图')
    expect((outputs.out as { text: string }).text).toBe(SAMPLE_SVG)
  })

  it('没有参考图时不带 images 参数（纯文生 SVG 路径不变）', async () => {
    const node = createNodeFromType('svg.gen', { x: 0, y: 0 })
    node.params.generateInstruction = '画一个橙色圆'
    const calls: Array<{ images?: string[] }> = []
    const ctx = createCtx(node, {
      generateText: async (input: { images?: string[] }) => {
        calls.push({ images: input.images })
        return { text: SAMPLE_SVG, model: 'm' }
      }
    })

    await executeSvgGenNode(ctx)
    expect(calls[0]?.images).toBeUndefined()
  })
})

describe('encodeSvgDataUrl', () => {
  it('编码为 image/svg+xml base64，可被主进程按 MIME 落 .svg', () => {
    expect(encodeSvgDataUrl('<svg/>')).toBe(`data:image/svg+xml;base64,${btoa('<svg/>')}`)
  })
})

describe('svg.gen 画布参数', () => {
  it('尺寸夹取到范围内，越界回默认；补丁字段名对齐节点参数', () => {
    expect(normalizeSvgGenState({ width: 99999, height: 8, background: 'black' })).toEqual({
      width: 2048,
      height: 16,
      background: 'black'
    })
    expect(svgGenToNodePatch({ width: 256, height: 128, background: '' })).toEqual({
      svgGenWidth: 256,
      svgGenHeight: 128,
      svgGenBackground: ''
    })
  })
})

describe('executeSvgGenNode', () => {
  it('模型输出 → 落盘 .svg → out 为 svg、out-all 为 svgs，并写回预览', async () => {
    const node = createNodeFromType('svg.gen', { x: 0, y: 0 })
    const saved: string[] = []
    const ctx = createCtx(node, {
      generateText: async () => ({ text: `\`\`\`svg\n${SAMPLE_SVG}\n\`\`\``, model: 'm' }),
      saveRunMedia: async (opts: { dataUrl: string; key: string }) => {
        saved.push(opts.dataUrl)
        return `Cache/Images/${opts.key}.svg`
      }
    })

    const outputs = await executeSvgGenNode(ctx)
    expect(saved[0]?.startsWith('data:image/svg+xml;base64,')).toBe(true)

    const out = outputs.out as { kind: string; text: string; relativePath?: string }
    expect(out.kind).toBe('svg')
    expect(out.text).toBe(SAMPLE_SVG)
    expect(out.relativePath).toMatch(/\.svg$/)

    const all = outputs[GRAPH_OUT_ALL_PORT_ID] as { kind: string; items: unknown[] }
    expect(all.kind).toBe('svgs')
    expect(all.items).toHaveLength(1)
    expect(node.params.selectedSvgId).toBeTruthy()
    expect(node.params.previewDataUrl).toContain('data:image/svg+xml')
  })

  it('无模型时用指令里的源码直出；没有 svg 标记则报缺输入', async () => {
    const node = createNodeFromType('svg.gen', { x: 0, y: 0 })
    node.params.generateInstruction = SAMPLE_SVG
    const ctx = createCtx(node)

    const outputs = await executeSvgGenNode(ctx)
    expect((outputs.out as { text: string }).text).toBe(SAMPLE_SVG)

    node.params.generateInstruction = '没有矢量标记'
    await expect(executeSvgGenNode(ctx)).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })
})
